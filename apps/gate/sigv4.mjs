// SigV4 verification of the caller's request, against the person's password.
// WebCrypto only (crypto.subtle, TextEncoder).

const encoder = new TextEncoder();

export const toHex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmac(key, data) {
  const imported = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(data)));
}

export async function sha256hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// encodeURIComponent leaves !'()* alone; SigV4 wants them percent-encoded.
export const encodeRfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// S3's own tolerance. A signature stays replayable inside the window.
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

// The outer bound on any presigned URL. Which keys may use more than two hours
// is a rule, decided per key in rules.mjs.
export const MAX_PRESIGN_EXPIRY_S = 604800;

// The `x-amz-*` the caller signed for its own signature, or that describe a
// body the gate is about to re-frame.
export const DROP_FROM_CLIENT = new Set([
  'authorization',
  'x-amz-content-sha256',
  'x-amz-date',
  'x-amz-security-token',
  'x-amz-decoded-content-length',
  'content-length',
  'host',
]);

// Comparing hex strings with === leaks the signature a character at a time.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseAuthorization(header) {
  const match = /^AWS4-HMAC-SHA256\s+(.*)$/.exec(header ?? '');
  if (!match) return null;
  const fields = {};
  for (const part of match[1].split(',')) {
    const [key, ...rest] = part.trim().split('=');
    fields[key] = rest.join('=');
  }
  if (!fields.Credential || !fields.SignedHeaders || !fields.Signature) return null;
  return {
    credential: fields.Credential.split('/'),
    signedHeaders: fields.SignedHeaders.split(';'),
    signature: fields.Signature,
  };
}

/**
 * The access key id a request claims, without verifying anything, so an
 * unknown key costs a lookup rather than a buffered upload.
 */
export function peekAccessKeyId({ headers, url }) {
  const credential = url.searchParams.get('X-Amz-Credential')
    ?? parseAuthorization(headers.get('authorization'))?.credential?.join('/');
  if (!credential) return null;
  const [accessKeyId] = credential.split('/');
  return accessKeyId || null;
}

export function canonicalQueryString(url, omit) {
  return [...url.searchParams]
    .filter(([key]) => key !== omit)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    // Sort by encoded key, then by encoded value: `?partNumber=2&partNumber=1`
    // is legitimate, and both the AWS SDK and aws4fetch sort values too.
    .sort(([ka, va], [kb, vb]) =>
      ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function parseAmzDate(value) {
  const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? '');
  if (!parts) return null;
  return Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6]);
}

// An unsigned `x-amz-*` is one an attacker can add to a captured request, and
// the gate would launder it into an authentic upstream request.
function unsignedAmzHeader(headers, signed) {
  for (const [name] of headers) {
    if (DROP_FROM_CLIENT.has(name)) continue;
    if (name.startsWith('x-amz-') && !signed.has(name)) return name;
  }
  return null;
}

async function signatureFor({ secretAccessKey, scopeParts, amzDate, canonicalRequest }) {
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scopeParts.join('/'),
    await sha256hex(canonicalRequest),
  ].join('\n');
  let key = encoder.encode(`AWS4${secretAccessKey}`);
  for (const part of scopeParts) key = await hmac(key, part);
  return toHex(await hmac(key, stringToSign));
}

/**
 * Recompute the caller's SigV4 signature and compare it.
 *
 * Returns `{ accessKeyId, presigned, expires, signedHeaders }` when authentic,
 * or `{ error }`. `url` must be the request exactly as it arrived; `host` is
 * read from it, not from the header. A header-signed request must declare the
 * real body hash: UNSIGNED-PAYLOAD and streaming payloads are refused.
 */
export async function verifySignature({
  method, url, headers, body, lookupSecret, allowPresigned = false, now = Date.now(),
}) {
  const presigned = allowPresigned && url.searchParams.has('X-Amz-Algorithm');
  // A presigned URL is a bearer token that travels in logs and chat messages.
  if (presigned && method !== 'GET' && method !== 'HEAD') {
    return { error: 'presigned URLs are read-only' };
  }

  let credential;
  let signedHeaders;
  let signature;
  let amzDate;
  let payloadHash;
  let omitFromQuery;
  let expires = null;

  if (presigned) {
    if (url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256') {
      return { error: 'unsupported presign algorithm' };
    }
    credential = (url.searchParams.get('X-Amz-Credential') ?? '').split('/');
    signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';').filter(Boolean);
    signature = url.searchParams.get('X-Amz-Signature') ?? '';
    amzDate = url.searchParams.get('X-Amz-Date');
    payloadHash = 'UNSIGNED-PAYLOAD';
    omitFromQuery = 'X-Amz-Signature';
    if (!signature || credential.length !== 5 || signedHeaders.length === 0) {
      return { error: 'incomplete presigned query' };
    }
    expires = Number(url.searchParams.get('X-Amz-Expires'));
    if (!Number.isInteger(expires) || expires <= 0) return { error: 'missing X-Amz-Expires' };
    if (expires > MAX_PRESIGN_EXPIRY_S) return { error: 'X-Amz-Expires exceeds seven days' };
    const signedAt = parseAmzDate(amzDate);
    if (signedAt === null) return { error: 'missing or malformed X-Amz-Date' };
    if (now > signedAt + expires * 1000) return { error: 'presigned URL has expired' };
    if (signedAt - now > MAX_CLOCK_SKEW_MS) return { error: 'presigned URL is not yet valid' };
  } else {
    const auth = parseAuthorization(headers.get('authorization'));
    if (!auth) return { error: 'missing or unparseable Authorization header' };
    ({ credential, signedHeaders, signature } = auth);
    amzDate = headers.get('x-amz-date');
    payloadHash = headers.get('x-amz-content-sha256');
    if (!payloadHash) return { error: 'missing x-amz-content-sha256' };
  }

  const [accessKeyId, date, region, service, terminator] = credential;
  if (service !== 's3' || terminator !== 'aws4_request') {
    return { error: 'unexpected credential scope' };
  }

  const signed = new Set(signedHeaders);
  const required = presigned ? ['host'] : ['host', 'x-amz-date', 'x-amz-content-sha256'];
  for (const name of required) {
    if (!signed.has(name)) return { error: `${name} is not in SignedHeaders` };
  }
  const rogue = unsignedAmzHeader(headers, signed);
  if (rogue) return { error: `unsigned x-amz header: ${rogue}` };

  if (!presigned) {
    const signedAt = parseAmzDate(amzDate);
    if (signedAt === null) return { error: 'missing or malformed x-amz-date' };
    if (Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) return { error: 'x-amz-date outside the window' };
    if (amzDate.slice(0, 8) !== date) return { error: 'x-amz-date does not match the credential scope' };

    // The signature covers the declared hash, not the bytes. Checking the
    // declaration against the body stops a captured PUT being replayed inside
    // the window with different contents.
    if (payloadHash === 'UNSIGNED-PAYLOAD') return { error: 'UNSIGNED-PAYLOAD is not accepted' };
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      return { error: `unsupported x-amz-content-sha256: ${payloadHash}` };
    }
    if (await sha256hex(body ?? new ArrayBuffer(0)) !== payloadHash) {
      return { error: 'body does not match x-amz-content-sha256' };
    }
  }

  const secretAccessKey = await lookupSecret(accessKeyId);
  if (!secretAccessKey) return { error: 'unknown access key' };

  const canonicalHeaders = signedHeaders
    .map((name) => {
      const value = name === 'host' ? url.host : (headers.get(name) ?? '');
      return `${name}:${value.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQueryString(url, omitFromQuery),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const expected = await signatureFor({
    secretAccessKey,
    scopeParts: [date, region, service, terminator],
    amzDate,
    canonicalRequest,
  });
  if (!constantTimeEqual(expected, signature)) return { error: 'signature mismatch' };
  return { accessKeyId, presigned, expires, signedHeaders: signed };
}
