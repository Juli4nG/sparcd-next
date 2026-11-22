import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { AwsClient } from 'aws4fetch';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { verifySignature, canonicalQueryString, encodeRfc3986, sha256hex } from '../sigv4.mjs';
import {
  makeGuard, bucketFromPath, keyFromPath, safeKeySegments, safeRequestTarget,
  namesOtherBucket,
} from '../namespace.mjs';
import {
  classify, decide, presignLimit, cacheControl, settingsPrefixAllowed,
} from '../rules.mjs';
import { afterTree, decodeListingToken, encodeListingToken, listAroundAccess } from '../listing.mjs';
import { loadMasterKey, wrapSecret, unwrapSecret, newPassword } from '../people.mjs';
import { WORDS } from '../words.mjs';
import { normalizeIfMatch, bucketKeyHeaders, makeUpstream } from '../upstream.mjs';
import { createGate } from '../server.mjs';
import { openAdmin } from '../cli.mjs';

const KEY = { accessKeyId: 'ana', secretAccessKey: 'maple-river-stone-cloud' };
const lookup = (id) => (id === KEY.accessKeyId ? KEY.secretAccessKey : null);
const aws = new AwsClient({ ...KEY, service: 's3', region: 'us-east-1' });

test('server and CLI reject settings buckets that a person could own or outside the prefix', async () => {
  for (const settingsBucket of ['lab-settings', 'sparcd-next-ana']) {
    await assert.rejects(createGate({ settingsBucket, allow: '*', dataKey: 'none' }), /SETTINGS_BUCKET/);
    assert.throws(() => openAdmin({ SETTINGS_BUCKET: settingsBucket, BUCKET_ALLOW: '*' }), /SETTINGS_BUCKET/);
  }
});

test('object requests carry a key made for their bucket; listings carry none; plain http is refused', async (t) => {
  const dataKey = Buffer.alloc(32, 7);
  const md5 = (bucket) => bucketKeyHeaders(dataKey, bucket)['x-amz-server-side-encryption-customer-key-md5'];
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (req) => {
    const url = new URL(req.url);
    seen.push([req.method, url.pathname + url.search, req.headers.get('x-amz-server-side-encryption-customer-key-md5')]);
    return new Response('', { status: 200, headers: { etag: '"e"' } });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const options = { endpoint: 'https://objects.example.org', accessKeyId: 'k', secretAccessKey: 's', dataKey };
  const up = makeUpstream(options);
  await up.send(up.url('sparcd-next-ana', 'Media/x/thumb.jpg'));
  await up.send(new URL('https://objects.example.org/sparcd-next-%61na/Media/x/view.jpg'), { method: 'PUT', body: Buffer.from('x') });
  await up.put('sparcd-next-settings', 'lab.json', '{}');
  await up.listPage('sparcd-next-ana', { prefix: 'Media/' });
  assert.deepEqual(seen.map(([, , m]) => m), [md5('sparcd-next-ana'), md5('sparcd-next-ana'), md5('sparcd-next-settings'), null]);
  assert.notEqual(md5('sparcd-next-ana'), md5('sparcd-next-ben'));
  assert.throws(() => makeUpstream({ ...options, endpoint: 'http://objects.example.org' }), /https/);
});

test('gate HTTP requests and responses', async (t) => {
  const masterKey = Buffer.alloc(32, 9).toString('base64');
  const wrappedSecret = await wrapSecret(await loadMasterKey(masterKey), KEY.secretAccessKey);
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('prefix') === 'access/people/') {
      return res.end('<Contents><Key>access/people/ana.json</Key><ETag>person</ETag></Contents>');
    }
    if (url.pathname.endsWith('/ana.json')) return res.end(JSON.stringify({ status: 'active', wrappedSecret }));
    if (url.pathname.endsWith('/slow')) return;
    if (url.pathname.endsWith('/slow-error')) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      return res.write('<Error>');
    }
    if (url.pathname.endsWith('/missing') || url.pathname.endsWith('/invalid-code')) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      const code = url.pathname.endsWith('/missing') ? 'NoSuchKey' : 'Invalid-123';
      return res.end(`<Error><Code>${code}</Code><Message>private upstream detail</Message></Error>`);
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<script>alert(1)</script>');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    upstream.closeAllConnections();
    upstream.close(resolve);
  }));
  const gate = await createGate({
    ...KEY, masterKey, dataKey: 'none', upstream: `http://127.0.0.1:${upstream.address().port}`,
    allowedHosts: 'gate.test', log: () => {},
  });
  t.after(() => gate.close());
  const port = await gate.listen(0);
  const bucket = '/sparcd-next-ana';
  const media = `${bucket}/Media/test.html`;
  const call = async (path, { method = 'GET', presigned = false, body, headers = {}, sign = true } = {}) => {
    const target = new URL(path, 'http://gate.test');
    if (presigned) target.searchParams.set('X-Amz-Expires', '7200');
    if (sign) {
      const req = presigned ? await aws.sign(target, { method, aws: { signQuery: true } })
        : await signed(target, { method });
      target.search = new URL(req.url).search;
      headers = { ...Object.fromEntries(req.headers), ...headers };
    }
    return new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port, method, path: target.pathname + target.search,
        headers: { host: 'gate.test', ...headers },
      }, (res) => {
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.end(body);
    });
  };

  await t.test('a client cannot send a storage key of its own', async () => {
    const sent = await call(media, { headers: { 'x-amz-server-side-encryption-customer-algorithm': 'AES256' } });
    assert.equal(sent.status, 403);
  });

  await t.test('removed operations and a plain bucket GET return 403', async () => {
    for (const [method, path] of [
      ['DELETE', `${media}?uploadId=`], ['PUT', `${media}?partNumber=1&uploadId=x`], ['GET', bucket],
    ]) {
      const res = await call(path, { method });
      assert.equal(res.status, 403);
      assert.match(res.text, /unknown operation/);
    }
  });

  await t.test('duplicate names and GET or HEAD bodies are refused before signature verification', async () => {
    const duplicate = await call(`${bucket}?prefix=a&%70refix=b`, { sign: false });
    assert.equal(duplicate.status, 403);
    assert.match(duplicate.text, /duplicate query parameter/);
    assert.equal((await call(media, { headers: { 'content-length': '1' }, body: 'x', sign: false })).status, 400);
    assert.equal((await call(media, { method: 'HEAD', headers: { 'transfer-encoding': 'chunked' }, sign: false })).status, 400);
  });

  await t.test('object responses are sandboxed and only presigned Media GETs are cached', async () => {
    for (const [method, presigned] of [['GET', false], ['GET', true], ['HEAD', false]]) {
      const res = await call(media, { method, presigned });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-security-policy'], "sandbox; default-src 'none'");
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['cache-control'], presigned ? 'private, max-age=7200, immutable' : 'no-store');
    }
  });

  await t.test('upstream errors only keep a valid S3 code', async () => {
    for (const [key, code] of [['missing', 'NoSuchKey'], ['invalid-code', 'InternalError']]) {
      const res = await call(`${bucket}/${key}`);
      assert.equal(res.status, 404);
      assert.equal(res.headers['content-type'], 'application/xml');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.match(res.text, new RegExp(`<Error><Code>${code}</Code><Message>Not Found</Message></Error>$`));
    }
  });

  await t.test('upstream requests time out with S3 XML', { timeout: 10_000 }, async (subtest) => {
    // undici's Request follows its signal through a weak reference, so after a
    // garbage collection the abort can be lost and the test waits for Node's
    // 300 s request timeout. Holding every request and its controller keeps the
    // abort deterministic.
    const held = [];
    subtest.mock.method(AbortSignal, 'timeout', (ms) => {
      assert.equal(ms, 60_000);
      const controller = new AbortController();
      held.push(controller);
      // With --expose-gc, collect first: the worst case for a lost abort.
      setTimeout(() => {
        globalThis.gc?.();
        controller.abort(new DOMException('timed out', 'TimeoutError'));
      }, 100);
      return controller.signal;
    });
    const realFetch = globalThis.fetch;
    subtest.mock.method(globalThis, 'fetch', (input, init) => {
      held.push(input);
      return realFetch(input, init);
    });
    for (const key of ['slow', 'slow-error']) {
      const res = await call(`${bucket}/${key}`);
      assert.equal(res.status, 504);
      assert.match(res.text, /<Error><Code>GatewayTimeout<\/Code><Message>/);
    }
  });
});

async function signed(url, init = {}) {
  const body = init.body;
  const req = await aws.sign(url, {
    ...init,
    headers: { 'x-amz-content-sha256': await sha256hex(body ?? ''), ...init.headers },
  });
  return {
    method: req.method,
    url: new URL(req.url),
    headers: req.headers,
    body: body === undefined ? undefined : Buffer.from(body),
    lookupSecret: lookup,
  };
}

describe('sigv4 header form', () => {
  test('a well-formed signature verifies', async () => {
    const out = await verifySignature(await signed('https://server.example.org/sparcd-next-ana/x.json'));
    assert.equal(out.error, undefined);
    assert.equal(out.accessKeyId, 'ana');
    assert.equal(out.presigned, false);
  });

  test('a tampered signature is rejected', async () => {
    const input = await signed('https://server.example.org/b/k');
    input.headers.set('authorization', `${input.headers.get('authorization').slice(0, -4)}dead`);
    assert.equal((await verifySignature(input)).error, 'signature mismatch');
  });

  test('a wrong password is rejected', async () => {
    const input = await signed('https://server.example.org/b/k');
    input.lookupSecret = () => 'maple-river-stone-clouds';
    assert.equal((await verifySignature(input)).error, 'signature mismatch');
  });

  test('an unsigned x-amz header is rejected', async () => {
    const input = await signed('https://server.example.org/b/k');
    input.headers.set('x-amz-acl', 'public-read');
    assert.match((await verifySignature(input)).error, /unsigned x-amz header: x-amz-acl/);
  });

  test('a stale date is rejected', async () => {
    const input = await signed('https://server.example.org/b/k');
    const result = await verifySignature({ ...input, now: Date.now() + 20 * 60 * 1000 });
    assert.equal(result.error, 'x-amz-date outside the window');
  });

  test('a body that does not match the declared hash is rejected', async () => {
    const input = await signed('https://server.example.org/b/k', { method: 'PUT', body: 'hello' });
    assert.equal((await verifySignature(input)).error, undefined);
    assert.equal(
      (await verifySignature({ ...input, body: Buffer.from('hellp') })).error,
      'body does not match x-amz-content-sha256',
    );
  });

  test('UNSIGNED-PAYLOAD is refused', async () => {
    const input = await signed('https://server.example.org/b/k', {
      method: 'PUT', body: 'blob', headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    });
    assert.equal((await verifySignature(input)).error, 'UNSIGNED-PAYLOAD is not accepted');
  });

  test('a streaming payload hash is refused', async () => {
    const input = await signed('https://server.example.org/b/k', {
      method: 'PUT', body: 'x', headers: { 'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD' },
    });
    assert.match((await verifySignature(input)).error, /^unsupported x-amz-content-sha256/);
  });
});

describe('sigv4 presigned form', () => {
  const presign = async (url, expires, method = 'GET') => {
    const u = new URL(url);
    u.searchParams.set('X-Amz-Expires', String(expires));
    const req = await aws.sign(u.toString(), { method, aws: { signQuery: true } });
    return { method, url: new URL(req.url), headers: new Headers(), lookupSecret: lookup, allowPresigned: true };
  };

  test('verifies and reports its expiry', async () => {
    const out = await verifySignature(await presign('https://server.example.org/b/a.jpg', 7200));
    assert.equal(out.error, undefined);
    assert.equal(out.presigned, true);
    assert.equal(out.expires, 7200);
  });

  test('more than seven days is refused outright', async () => {
    const input = await presign('https://server.example.org/b/a.jpg', 604801);
    assert.equal((await verifySignature(input)).error, 'X-Amz-Expires exceeds seven days');
  });

  test('an expired URL is refused', async () => {
    const input = await presign('https://server.example.org/b/a.jpg', 60);
    assert.equal((await verifySignature({ ...input, now: Date.now() + 120000 })).error, 'presigned URL has expired');
  });

  test('a presigned PUT is refused', async () => {
    const input = await presign('https://server.example.org/b/a.jpg', 60, 'PUT');
    assert.equal((await verifySignature(input)).error, 'presigned URLs are read-only');
  });

  test('off unless opted in, as for /-/whoami', async () => {
    const input = await presign('https://server.example.org/-/whoami', 60);
    assert.equal(
      (await verifySignature({ ...input, allowPresigned: false })).error,
      'missing or unparseable Authorization header',
    );
  });

  test('a URL from the AWS SDK presigner verifies and classifies', async () => {
    const client = new S3Client({
      endpoint: 'https://server.example.org', region: 'us-east-1', forcePathStyle: true,
      credentials: KEY,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const url = new URL(await getSignedUrl(
      client, new GetObjectCommand({ Bucket: 'sparcd-next-ana', Key: 'Media/x/thumb.jpg' }), { expiresIn: 7200 },
    ));
    const headers = new Headers();
    const out = await verifySignature({ method: 'GET', url, headers, lookupSecret: lookup, allowPresigned: true });
    assert.equal(out.error, undefined);
    assert.equal(
      classify({ method: 'GET', bucket: 'sparcd-next-ana', key: 'Media/x/thumb.jpg', query: url.searchParams, headers }),
      'GetObject',
    );
  });
});

describe('canonical query string', () => {
  test('duplicate values sort after the key', () => {
    assert.equal(canonicalQueryString(new URL('https://h/p?partNumber=2&partNumber=1&a=z')), 'a=z&partNumber=1&partNumber=2');
  });
  test("!'()* are percent-encoded", () => {
    assert.equal(encodeRfc3986("a!'()*b"), 'a%21%27%28%29%2Ab');
  });
});

describe('namespace guard', () => {
  const inNamespace = makeGuard('sparcd-next-*');

  test('only sparcd-next-* buckets pass', () => {
    assert.equal(inNamespace('sparcd-next-ana'), true);
    assert.equal(inNamespace('sparcd-next-settings'), true);
    for (const name of ['sparcd-other', 'lab-encrypted-data', 'sparcd-next', 'xsparcd-next-ana', 'SPARCD-NEXT-ANA']) {
      assert.equal(inNamespace(name), false, name);
      assert.equal(makeGuard('*')(name), false, name);
    }
  });

  test('crafted bucket segments never become an allowed bucket', () => {
    for (const path of ['/../etc/passwd', '/sparcd-next-a%2F..%2Fother/k', '//k', '/sparcd-next-..x/k', '/sparcd-next-/k']) {
      const bucket = bucketFromPath(path);
      assert.equal(bucket === null || !inNamespace(bucket), true, path);
    }
  });

  test('keys keep their slashes and decode per segment', () => {
    assert.equal(keyFromPath('/b/Media/a%20b/c.jpg'), 'Media/a b/c.jpg');
    assert.equal(keyFromPath('/b'), '');
  });

  test('traversal, backslashes, NUL and leading slashes are refused', () => {
    for (const key of ['Media/../x', 'Media/./x', 'a\\b', 'a\u0000b', '/x', '..']) assert.equal(safeKeySegments(key), false, key);
    for (const key of ['Media/abc/IMG 0001.JPG', 'shared/x/ñ.csv', '']) assert.equal(safeKeySegments(key), true, key);
  });

  test('a backslash or authority in the target is refused before parsing', () => {
    for (const target of ['/\\evil/x', '//evil/x', 'http://evil/x']) assert.equal(safeRequestTarget(target), false, target);
    assert.equal(safeRequestTarget('/sparcd-next-ana/x'), true);
  });

  test('responses are checked for other buckets', () => {
    assert.equal(namesOtherBucket('<ListBucketResult><Name>sparcd-next-ana</Name></ListBucketResult>', 'sparcd-next-ana'), false);
    assert.equal(namesOtherBucket('<Error><BucketName>lab-private</BucketName></Error>', 'sparcd-next-ana'), true);
  });
});

describe('classify', () => {
  const call = (method, bucket, key, query = '', headers = new Headers()) =>
    classify({ method, bucket, key, query: new URLSearchParams(query), headers });

  test('the operations we know', () => {
    assert.equal(call('GET', null, ''), 'ListBuckets');
    assert.equal(call('GET', 'b', '', 'list-type=2&prefix=x'), 'ListObjectsV2');
    assert.equal(call('GET', 'b', '', 'location='), 'GetBucketLocation');
    assert.equal(call('HEAD', 'b', ''), 'HeadBucket');
    assert.equal(call('GET', 'b', 'k'), 'GetObject');
    assert.equal(call('HEAD', 'b', 'k'), 'HeadObject');
    assert.equal(call('PUT', 'b', 'k'), 'PutObject');
    assert.equal(call('DELETE', 'b', 'k'), 'DeleteObject');
    assert.equal(call('PUT', 'b', 'k', '', new Headers({ 'x-amz-copy-source': '/o/k' })), 'CopyObject');
  });

  test('unknown parameters and bucket-level writes are unclassifiable', () => {
    for (const query of ['acl=', 'policy=', 'versioning=', 'tagging=', 'cors=', 'versions=',
      'uploads=', 'uploadId=', 'partNumber=1', 'max-parts=1', 'part-number-marker=1',
      'response-content-type=text/html']) {
      assert.equal(call('GET', 'b', '', query), null, query);
      assert.equal(call('PUT', 'b', 'k', query), null, query);
    }
    assert.equal(call('PUT', 'b', ''), null, 'CreateBucket');
    assert.equal(call('DELETE', 'b', ''), null, 'DeleteBucket');
    assert.equal(call('POST', 'b', '', 'delete='), null, 'DeleteObjects');
    assert.equal(call('HEAD', 'b', '', 'x-id=HeadBucket'), null);
    assert.equal(call('GET', 'b', '', 'list-type=1'), null);
  });
});

describe('the rules', () => {
  const ana = { code: 'ana', status: 'active' };
  const allow = (op, bucket, key = '', extra = {}) =>
    decide(ana, { op, bucket, key, settingsBucket: 'sparcd-next-settings', ifNoneMatch: null, ...extra }).allow;

  test('own bucket: read, list, write, never delete', () => {
    for (const op of ['GetObject', 'HeadObject', 'ListObjectsV2', 'HeadBucket', 'GetBucketLocation', 'PutObject']) {
      assert.equal(allow(op, 'sparcd-next-ana', 'media.csv'), true, op);
    }
    for (const op of ['DeleteObject', 'CopyObject', 'ListBuckets', null]) {
      assert.equal(allow(op, 'sparcd-next-ana', 'media.csv'), false, op);
    }
  });

  test('only the own bucket', () => {
    assert.equal(allow('GetObject', 'sparcd-next-ben', 'media.csv'), false);
    assert.equal(allow('ListObjectsV2', 'sparcd-next-ben'), false);
    assert.equal(allow('GetObject', 'sparcd-next-anab', 'media.csv'), false);
  });

  test('settings: read-only, and access/ belongs to the gate', () => {
    assert.equal(allow('GetObject', 'sparcd-next-settings', 'lab.json'), true);
    assert.equal(allow('ListObjectsV2', 'sparcd-next-settings'), true);
    assert.equal(allow('PutObject', 'sparcd-next-settings', 'lab.json'), false);
    assert.equal(allow('GetObject', 'sparcd-next-settings', 'access/people/ana.json'), false);
    assert.equal(allow('HeadObject', 'sparcd-next-settings', 'access/people/ana.json'), false);
    assert.equal(settingsPrefixAllowed(''), true);
    assert.equal(settingsPrefixAllowed('lab'), true);
    assert.equal(settingsPrefixAllowed('access/'), false);
    assert.equal(settingsPrefixAllowed('acc'), false);
  });

  test('Media/ PUTs need a signed If-None-Match: *', () => {
    assert.equal(allow('PutObject', 'sparcd-next-ana', 'Media/abc/IMG_1.JPG'), false);
    assert.equal(allow('PutObject', 'sparcd-next-ana', 'Media/abc/IMG_1.JPG', { ifNoneMatch: '"x"' }), false);
    assert.equal(allow('PutObject', 'sparcd-next-ana', 'Media/abc/IMG_1.JPG', { ifNoneMatch: '*' }), true);
    assert.equal(allow('PutObject', 'sparcd-next-ana', 'observations.csv'), true);
  });

  test('a paused person gets nothing', () => {
    const paused = { code: 'ana', status: 'paused' };
    assert.equal(decide(paused, { op: 'GetObject', bucket: 'sparcd-next-ana', key: 'x', settingsBucket: 's' }).allow, false);
  });

  test('long presigns only for thumbs, views and shared/', () => {
    const sha = 'a'.repeat(64);
    assert.equal(presignLimit(`Media/${sha}/thumb.jpg`), 604800);
    assert.equal(presignLimit(`Media/${sha}/view.jpg`), 604800);
    assert.equal(presignLimit('shared/k3x/media.csv'), 604800);
    assert.equal(presignLimit(`Media/${sha}/IMG_0001.JPG`), 7200);
    assert.equal(presignLimit(`Media/${sha}/thumb.jpg.bak`), 7200);
    assert.equal(presignLimit('Media/ABC/thumb.jpg'), 7200);
    assert.equal(presignLimit('observations.csv'), 7200);
  });

  test('only successful presigned Media/ GETs are cached', () => {
    assert.equal(cacheControl('GetObject', 'Media/x/view.jpg', 206, true), 'private, max-age=7200, immutable');
    assert.equal(cacheControl('GetObject', 'Media/x/view.jpg', 404, true), 'no-store');
    assert.equal(cacheControl('HeadObject', 'Media/x/view.jpg', 200, true), 'no-store');
    assert.equal(cacheControl('GetObject', 'media.csv', 200, true), 'no-store');
  });
});

describe('settings listings step over access/', () => {
  const page = (keys, prefixes = [], nextToken = null) => ({
    keys: keys.map((key) => ({ key, size: 1, etag: '"e"' })), commonPrefixes: prefixes, nextToken,
  });

  test('access/ keys and folders never come back, and the walk jumps the tree', async () => {
    const calls = [];
    const upstream = {
      async listPage(bucket, { startAfter }) {
        calls.push(startAfter);
        return startAfter === afterTree('access/')
          ? page(['lab.json', 'sites.csv', 'species.json'])
          : page(['access/people/ana.json', 'access/people/ben.json'], [], 'more');
      },
    };
    const got = await listAroundAccess({ upstream, bucket: 's', prefix: '', delimiter: '', maxKeys: 1000 });
    assert.deepEqual(got.keys.map((k) => k.key), ['lab.json', 'sites.csv', 'species.json']);
    assert.deepEqual(calls, [undefined, 'access0']);
    const folders = await listAroundAccess({
      upstream: { listPage: async () => page(['lab.json'], ['access/']) },
      bucket: 's', prefix: '', delimiter: '/', maxKeys: 1000,
    });
    assert.deepEqual(folders.commonPrefixes, []);
    assert.deepEqual(folders.keys.map((k) => k.key), ['lab.json']);
  });

  test('the continuation token is ours and round-trips', () => {
    assert.equal(decodeListingToken(encodeListingToken('sites.csv')), 'sites.csv');
    assert.equal(decodeListingToken('not base64url!'), null);
  });
});

describe('passwords', () => {
  test('the word list is unique, plain and at least 2^10 long', () => {
    assert.equal(new Set(WORDS).size, WORDS.length);
    assert.ok(WORDS.length >= 1024, `${WORDS.length} words`);
    for (const word of WORDS) assert.match(word, /^[a-z]{3,7}$/);
  });

  test('four words joined by hyphens', () => {
    assert.match(newPassword(), /^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/);
  });

  test('a wrapped password round-trips and only under its master key', async () => {
    const key = await loadMasterKey(Buffer.alloc(32, 7).toString('base64'));
    const other = await loadMasterKey(Buffer.alloc(32, 8).toString('base64'));
    const wrapped = await wrapSecret(key, 'maple-river-stone-cloud');
    assert.match(wrapped, /^v1\.[\w-]+\.[\w-]+$/);
    assert.equal(await unwrapSecret(key, wrapped), 'maple-river-stone-cloud');
    await assert.rejects(unwrapSecret(other, wrapped));
    assert.throws(() => loadMasterKey('c2hvcnQ='), /32 bytes/);
  });
});

test('If-Match loses its quotes on the way to RGW, and * survives', () => {
  assert.equal(normalizeIfMatch('"abc"'), 'abc');
  assert.equal(normalizeIfMatch('*'), '*');
});
