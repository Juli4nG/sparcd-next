// The gate. One project key upstream, one login per person.
//
// Every request arrives signed with the person's password. The gate verifies
// it, checks it against rules.mjs, then signs it again with the project key,
// which never leaves this process. Caddy fronts it on the same origin as the
// apps and passes Host through unchanged, because Host is what the caller signed.

import { createServer, STATUS_CODES } from 'node:http';
import { Readable, pipeline } from 'node:stream';

import { verifySignature, peekAccessKeyId, escapeXml, DROP_FROM_CLIENT } from './sigv4.mjs';
import {
  makeGuard, bucketFromPath, keyFromPath, namesOtherBucket,
  safeKeySegments, safeRequestTarget,
} from './namespace.mjs';
import {
  classify, decide, ownBucket, presignLimit, cacheControl, settingsPrefixAllowed,
  BUCKET_PREFIX, PERSON_CODE, RESERVED_CODES,
} from './rules.mjs';
import { buildListing, decodeListingToken, listAroundAccess } from './listing.mjs';
import { makePeople, loadMasterKey } from './people.mjs';
import { makeUpstream, normalizeIfMatch } from './upstream.mjs';

// Ordinary headers that may travel upstream, and only when the caller signed
// them. `range` on a GET is the one exception, in proxyFetch.
const FORWARD_HEADERS = new Set([
  'content-type', 'content-md5', 'cache-control', 'content-disposition',
  'content-encoding', 'content-language', 'expires',
  'range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since',
]);

// The `x-amz-*` allowlist. Anything else is refused rather than stripped, so a
// client that grows a new header fails visibly.
const AMZ_FORWARD_PREFIXES = ['x-amz-meta-', 'x-amz-checksum-'];
const AMZ_FORWARD_EXACT = new Set(['x-amz-sdk-checksum-algorithm']);
const AMZ_ACCEPT_AND_DROP = new Set([...DROP_FROM_CLIENT, 'x-amz-user-agent']);
const forwardableAmz = (name) =>
  AMZ_FORWARD_EXACT.has(name) || AMZ_FORWARD_PREFIXES.some((p) => name.startsWith(p));

// What may come back. `Server`, `x-amz-id-2` and the like hint at the storage
// behind this; `content-encoding` is absent because fetch has decoded the body.
const RESPONSE_HEADERS = new Set([
  'content-type', 'content-length', 'etag', 'last-modified', 'content-range',
  'accept-ranges', 'content-disposition', 'x-amz-request-id', 'x-amz-version-id',
]);
const RESPONSE_PREFIXES = ['x-amz-meta-', 'x-amz-checksum-'];

export function configFromEnv(env = process.env) {
  return {
    upstream: env.UPSTREAM,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    masterKey: env.ACCESS_MASTER_KEY,
    settingsBucket: env.SETTINGS_BUCKET,
    allow: env.BUCKET_ALLOW,
    allowedHosts: env.ALLOWED_HOSTS,
    port: env.PORT && Number(env.PORT),
    maxBodyBytes: env.MAX_BODY_BYTES && Number(env.MAX_BODY_BYTES),
    maxBufferedBytes: env.MAX_BUFFERED_BYTES && Number(env.MAX_BUFFERED_BYTES),
  };
}

export function withDefaults(input) {
  const config = {
    region: 'us-east-1',
    settingsBucket: 'sparcd-next-settings',
    allow: 'sparcd-next-*',
    port: 8787,
    maxBodyBytes: 67108864,
    maxBufferedBytes: 536870912,
    bodyIdleMs: 10000,
    pollMs: 5000,
    staleMs: 30000,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '')),
  };
  const suffix = config.settingsBucket.slice(BUCKET_PREFIX.length);
  if (!config.settingsBucket.startsWith(BUCKET_PREFIX)
      || (PERSON_CODE.test(suffix) && !RESERVED_CODES.has(suffix))) {
    throw new Error('SETTINGS_BUCKET must start with sparcd-next- and cannot be a person bucket');
  }
  return config;
}

export async function createGate(input) {
  const config = withDefaults(input);
  const allowedHosts = new Set(
    String(config.allowedHosts ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  if (allowedHosts.size === 0) {
    throw new Error('ALLOWED_HOSTS is required: SigV4 binds a signature to the Host dialled');
  }
  const inNamespace = makeGuard(config.allow);
  if (!inNamespace(config.settingsBucket)) throw new Error('SETTINGS_BUCKET is outside BUCKET_ALLOW');

  const log = config.log ?? ((message, err) => {
    process.stderr.write(`[gate] ${message}${err ? `: ${err?.message ?? err}` : ''}\n`);
  });

  const upstream = makeUpstream({
    endpoint: config.upstream,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  const people = makePeople({
    upstream,
    settingsBucket: config.settingsBucket,
    masterKey: await loadMasterKey(config.masterKey),
    pollMs: config.pollMs,
    staleMs: config.staleMs,
  });
  await people.refresh();

  // The ceiling on request bodies held in memory at once, charged as bytes
  // arrive rather than against a declared Content-Length, which costs the
  // sender nothing. Each person gets at most a quarter.
  const budget = makeBudget(config.maxBufferedBytes);
  const perKeyCap = Math.max(1, Math.floor(config.maxBufferedBytes / 4));
  let settingsListings = 0;

  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    handle(req, res).catch((err) => {
      // The detail goes to the operator, never to the caller.
      log('request failed', err);
      if (res.headersSent) return res.destroy();
      if (err.name === 'TimeoutError') {
        return respondXml(res, 504, 'GatewayTimeout', 'upstream request timed out');
      }
      return respondXml(res, 500, 'InternalError', 'the request could not be completed');
    });
  });
  server.on('clientError', (err, socket) => socket.destroy());

  async function handle(req, res) {
    // origin-form only, judged on the raw bytes: an absolute-form or `//host`
    // target would change the Host the signature is checked against.
    if (!safeRequestTarget(req.url)) {
      return respondXml(res, 400, 'InvalidURI', 'request target must be origin-form');
    }
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) return respondXml(res, 403, 'AccessDenied', 'unknown host');
    const url = new URL(req.url, `http://${host}`);
    if (url.host !== host) return respondXml(res, 400, 'InvalidURI', 'request target must be origin-form');

    const isApi = url.pathname.startsWith('/-/');
    const refuse = (status, code, message) => {
      req.resume();
      return isApi ? respondJson(res, status, { error: message }) : respondXml(res, status, code, message);
    };
    if (new Set(url.searchParams.keys()).size !== url.searchParams.size) {
      return refuse(403, 'AccessDenied', 'duplicate query parameter');
    }
    const bodyless = req.method === 'GET' || req.method === 'HEAD';
    if (bodyless && (Number(req.headers['content-length'] ?? 0) !== 0
        || req.headers['transfer-encoding'] !== undefined)) {
      return refuse(400, 'InvalidRequest', 'GET and HEAD cannot carry a request body');
    }
    if (isApi && url.pathname === '/-/health' && req.method === 'GET') {
      return respondJson(res, 200, { ok: true });
    }
    if (isApi && !(url.pathname === '/-/whoami' && req.method === 'GET')) {
      req.resume();
      return respondJson(res, 404, { error: 'not found' });
    }

    if (!people.fresh()) return refuse(503, 'ServiceUnavailable', 'access data could not be refreshed');

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(','));
      else if (value !== undefined) headers.set(name, value);
    }

    // Resolve the person before reading a byte of body: an unknown or paused
    // login costs a map lookup, not a buffered upload.
    const claimed = peekAccessKeyId({ headers, url });
    const claimedPerson = claimed ? people.get(claimed) : null;
    if (!claimedPerson) return refuse(403, 'InvalidAccessKeyId', 'unknown login');
    if (claimedPerson.status !== 'active') return refuse(403, 'AccessDenied', `login is ${claimedPerson.status}`);

    let body;
    if (!bodyless) {
      if (Number(req.headers['content-length'] ?? 0) > config.maxBodyBytes) {
        return refuse(413, 'EntityTooLarge', 'request body exceeds MAX_BODY_BYTES');
      }
      const account = budget.open(claimed, perKeyCap);
      res.on('close', () => account.release());
      const read = await readBody(req, config.maxBodyBytes, account, config.bodyIdleMs);
      if (read.error === 'too-large') return refuseBody(req, res, 413, 'EntityTooLarge', 'request body exceeds MAX_BODY_BYTES');
      if (read.error === 'busy') return refuseBody(req, res, 503, 'SlowDown', 'too much request body in flight');
      if (read.error === 'idle') return refuseBody(req, res, 408, 'RequestTimeout', 'the request body stalled');
      if (read.error) return undefined;
      body = read.body;
    }

    const verified = await verifySignature({
      method: req.method, url, headers, body,
      lookupSecret: (id) => people.secret(id),
      allowPresigned: !isApi,
    });
    if (verified.error) return refuse(403, 'SignatureDoesNotMatch', verified.error);
    const person = people.get(verified.accessKeyId);
    if (person?.status !== 'active') return refuse(403, 'AccessDenied', 'login is not active');

    if (isApi) {
      return respondJson(res, 200, {
        name: person.name,
        code: person.code,
        bucket: ownBucket(person.code),
        settingsBucket: config.settingsBucket,
      });
    }
    return handleS3({ req, res, url, headers, body, person, verified });
  }

  async function handleS3({ req, res, url, headers, body, person, verified }) {
    const bucket = bucketFromPath(url.pathname);
    const key = keyFromPath(url.pathname);
    const denied = (reason) => {
      log(`denied ${person.code} ${req.method} ${bucket ?? '-'}: ${reason}`);
      return respondXml(res, 403, 'AccessDenied', reason);
    };

    if (!bucket) return denied(url.pathname === '/' ? 'ListBuckets is not served' : 'invalid bucket name');
    if (!inNamespace(bucket)) return denied('bucket is outside the namespace');
    if (key === null || !safeKeySegments(key)) return denied('unusable object key');
    for (const [name] of headers) {
      if (!name.startsWith('x-amz-')) continue;
      if (AMZ_ACCEPT_AND_DROP.has(name) || forwardableAmz(name)) continue;
      return denied(`header not accepted: ${name}`);
    }
    if (verified.presigned && verified.expires > presignLimit(key)) {
      return denied(`X-Amz-Expires exceeds ${presignLimit(key)} s for this key`);
    }

    const op = classify({ method: req.method, bucket, key, query: url.searchParams, headers });
    const verdict = decide(person, {
      op, bucket, key,
      settingsBucket: config.settingsBucket,
      ifNoneMatch: verified.signedHeaders.has('if-none-match') ? headers.get('if-none-match') : null,
    });
    if (!verdict.allow) return denied(verdict.reason);

    if (op === 'ListObjectsV2' && bucket === config.settingsBucket) {
      return handleSettingsListing({ res, url, bucket, denied });
    }

    // Only the query changes on the way upstream; the path goes as signed, and
    // the equality check is the traversal guard.
    const target = new URL(upstream.origin);
    target.pathname = url.pathname;
    if (target.pathname !== url.pathname) return denied('request path is not canonical');
    for (const [k, v] of url.searchParams) {
      // RGW answers 501 for parameters it does not know, and the AWS SDK adds
      // `?x-id=<Operation>` to everything.
      if (k === 'x-id' || k.startsWith('X-Amz-')) continue;
      target.searchParams.append(k, v);
    }
    const out = new Headers();
    for (const [name, value] of headers) {
      if (AMZ_ACCEPT_AND_DROP.has(name)) continue;
      // An unsigned header is one someone else added to a captured request.
      // `range` on a GET only narrows a read the signature already allows,
      // and a presigned URL signs nothing but `host`.
      if (!verified.signedHeaders.has(name) && !(name === 'range' && req.method === 'GET')) continue;
      if (!(FORWARD_HEADERS.has(name) || forwardableAmz(name))) continue;
      out.set(name, name === 'if-match' ? normalizeIfMatch(value) : value);
    }
    const upstreamRes = await upstream.send(target, { method: req.method, headers: out, body });

    if (!upstreamRes.ok && upstreamRes.status !== 304) return respondUpstreamError(res, upstreamRes);

    const responseHeaders = pickHeaders(upstreamRes);
    responseHeaders['cache-control'] = cacheControl(op, key, upstreamRes.status, verified.presigned);
    if (op === 'GetObject' || op === 'HeadObject') {
      responseHeaders['content-security-policy'] = "sandbox; default-src 'none'";
    }

    // Object bytes stream straight through. Everything else that has a body
    // is small XML, and the only thing that can name another bucket.
    const objectBody = op === 'GetObject' && upstreamRes.ok;
    if (req.method !== 'HEAD' && upstreamRes.status !== 304 && !objectBody) {
      const xml = await upstreamRes.text();
      if (namesOtherBucket(xml, bucket)) {
        log(`upstream response for ${bucket} named another bucket`);
        return respondXml(res, 502, 'InternalError', 'the upstream answer was unusable');
      }
      responseHeaders['content-length'] = Buffer.byteLength(xml);
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(xml);
    }
    res.writeHead(upstreamRes.status, responseHeaders);
    if (!upstreamRes.body) return res.end();
    pipeline(Readable.fromWeb(upstreamRes.body), res, (err) => {
      if (!err) return;
      log('response stream failed', err);
      res.destroy();
    });
    return undefined;
  }

  async function handleSettingsListing({ res, url, bucket, denied }) {
    const prefix = url.searchParams.get('prefix') ?? '';
    if (!settingsPrefixAllowed(prefix)) return denied('access/ belongs to the gate');
    if (settingsListings >= 4) return respondXml(res, 503, 'SlowDown', 'too many listings in flight');
    settingsListings += 1;
    try {
      const delimiter = url.searchParams.get('delimiter') ?? '';
      const requested = Number(url.searchParams.get('max-keys') ?? 1000);
      const maxKeys = Math.min(Math.max(Number.isFinite(requested) ? requested : 1000, 1), 1000);
      const page = await listAroundAccess({
        upstream, bucket, prefix, delimiter, maxKeys,
        after: decodeListingToken(url.searchParams.get('continuation-token')),
      });
      const xml = buildListing({ bucket, prefix, delimiter, ...page });
      res.writeHead(200, {
        'content-type': 'application/xml',
        'content-length': Buffer.byteLength(xml),
        'cache-control': 'no-store',
      });
      return res.end(xml);
    } catch (err) {
      if (err.name === 'TimeoutError') throw err;
      if (err.cause instanceof Response) return respondUpstreamError(res, err.cause);
      log('settings listing failed', err);
      return respondXml(res, 502, 'InternalError', 'the upstream answer was unusable');
    } finally {
      settingsListings -= 1;
    }
  }

  return {
    server,
    people,
    listen(port = config.port) {
      people.start(log);
      return new Promise((resolve, reject) => {
        const onError = (err) => { people.stop(); reject(err); };
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve(server.address().port);
        });
      });
    },
    async close() {
      people.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function pickHeaders(upstreamRes) {
  const out = {};
  for (const [name, value] of upstreamRes.headers) {
    if (RESPONSE_HEADERS.has(name) || RESPONSE_PREFIXES.some((p) => name.startsWith(p))) {
      out[name] = value;
    }
  }
  return out;
}

function refuseBody(req, res, status, code, message) {
  res.setHeader('Connection', 'close');
  respondXml(res, status, code, message);
  res.on('finish', () => req.destroy());
  return undefined;
}

function respondXml(res, status, code, message) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code>`
    + `<Message>${escapeXml(message)}</Message></Error>`;
  res.writeHead(status, {
    'content-type': 'application/xml',
    'content-length': Buffer.byteLength(xml),
    'cache-control': 'no-store',
  });
  res.end(xml);
}

async function respondUpstreamError(res, upstreamRes) {
  const xml = await upstreamRes.text();
  const code = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(xml)?.[1] ?? 'InternalError';
  return respondXml(res, upstreamRes.status, code, STATUS_CODES[upstreamRes.status] ?? 'Upstream error');
}

function respondJson(res, status, value) {
  const json = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
  });
  res.end(json);
}

// Buffered before verification, because verification hashes it. The same
// buffer then goes upstream with a Content-Length, never chunked, which RGW
// rejects.
function readBody(req, limit, account, idleMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let timer = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // A socket that announces a body and goes quiet would otherwise hold its
    // slot until Node's 300 s request timeout.
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => done({ error: 'idle' }), idleMs);
    };
    arm();
    req.on('data', (chunk) => {
      arm();
      size += chunk.length;
      if (size > limit) { done({ error: 'too-large' }); return; }
      if (!account.charge(chunk.length)) { done({ error: 'busy' }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => done({ body: Buffer.concat(chunks) }));
    req.on('aborted', () => done({ error: 'aborted' }));
    req.on('error', () => done({ error: 'aborted' }));
  });
}

/** Bytes actually held, globally and per login. `release` is idempotent. */
function makeBudget(total) {
  let used = 0;
  const perKey = new Map();
  return {
    open(keyId, cap) {
      let charged = 0;
      return {
        charge(n) {
          const mine = perKey.get(keyId) ?? 0;
          if (used + n > total || mine + n > cap) return false;
          used += n;
          perKey.set(keyId, mine + n);
          charged += n;
          return true;
        },
        release() {
          if (charged === 0) return;
          used -= charged;
          const mine = (perKey.get(keyId) ?? 0) - charged;
          if (mine > 0) perKey.set(keyId, mine); else perKey.delete(keyId);
          charged = 0;
        },
      };
    },
  };
}

if (import.meta.main) {
  const config = configFromEnv();
  const fail = (message, err) => process.stderr.write(`[gate] ${message}: ${err?.message ?? err}\n`);
  process.on('unhandledRejection', (err) => fail('unhandled rejection', err));
  process.on('uncaughtException', (err) => { fail('uncaught exception', err); process.exit(1); });
  try {
    const gate = await createGate(config);
    const port = await gate.listen();
    process.stdout.write(`gate on 127.0.0.1:${port} → ${new URL(config.upstream).origin}\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => { gate.close().then(() => process.exit(0)); });
    }
  } catch (err) {
    fail('could not start', err);
    process.exit(1);
  }
}
