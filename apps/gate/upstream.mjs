// The one upstream. Every byte that leaves this process for storage goes
// through here, signed with the project key. Redirects are returned, not chased.

import { createHash, hkdfSync } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

/**
 * `DATA_KEY`: 32 bytes in base64. Every stored object is encrypted with a key
 * derived from it per bucket (S3 SSE-C), so the project key alone reads only
 * ciphertext. `none` turns this off, for storage reached without TLS (the local
 * MinIO), which SSE-C refuses.
 */
export function loadDataKey(value) {
  if (value === 'none') return null;
  const key = Buffer.from(value ?? '', 'base64');
  if (key.length !== 32) throw new Error('DATA_KEY must be 32 bytes in base64, or "none"');
  return key;
}

/** The SSE-C headers for one bucket's objects. */
export function bucketKeyHeaders(dataKey, bucket) {
  const key = Buffer.from(hkdfSync('sha256', dataKey, '', `sparcd-next/data/v1/${bucket}`, 32));
  return {
    'x-amz-server-side-encryption-customer-algorithm': 'AES256',
    'x-amz-server-side-encryption-customer-key': key.toString('base64'),
    'x-amz-server-side-encryption-customer-key-md5': createHash('md5').update(key).digest('base64'),
  };
}

/**
 * Ceph RGW answers 412 to a PUT whose `If-Match` carries the double quotes S3
 * documents, even when the tag is current; the bare tag compares correctly.
 * `*` is a wildcard and travels untouched.
 */
export function normalizeIfMatch(value) {
  if (value === null || value === undefined) return value;
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, '').replace(/^"([\s\S]*)"$/, '$1'))
    .filter((tag) => tag !== '')
    .join(', ');
}

export function makeUpstream({ endpoint, region = 'us-east-1', accessKeyId, secretAccessKey, dataKey }) {
  if (dataKey === undefined) throw new Error('makeUpstream needs dataKey (a key, or null for none)');
  const base = new URL(endpoint);
  const credentials = { accessKeyId, secretAccessKey, service: 's3', region };
  // Client traffic is never retried here: a proxied PUT is the caller's to
  // retry. The gate's own small reads keep aws4fetch's default retries.
  const passthrough = new AwsClient({ ...credentials, retries: 0 });
  const aws = new AwsClient(credentials);

  const url = (bucket, key = '', query) => {
    const u = new URL(base);
    u.pathname = `/${bucket}${key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''}`;
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  };

  // `allHeaders` signs every header, not aws4fetch's default set: Ceph RGW
  // refuses a PUT whose `content-type` is present but unsigned. Nothing here
  // sets `content-length`, `connection` or `host`, which the runtime rewrites
  // after signing.
  const keys = new Map();
  const signAll = (u, init) => {
    const headers = new Headers(init.headers);
    // Object reads and writes carry the bucket's key; listings and bucket
    // calls have no object and carry none. Unencrypted objects stored before
    // DATA_KEY existed still read back: RGW ignores the key for them.
    const [, bucket, key] = /^\/([^/]+)\/(.+)$/.exec(new URL(u).pathname) ?? [];
    const method = (init.method ?? 'GET').toUpperCase();
    if (dataKey && key && ['GET', 'HEAD', 'PUT'].includes(method)) {
      if (!keys.has(bucket)) keys.set(bucket, bucketKeyHeaders(dataKey, bucket));
      for (const [name, value] of Object.entries(keys.get(bucket))) headers.set(name, value);
    }
    return {
      ...init, headers, signal: AbortSignal.timeout(60_000), redirect: 'manual',
      aws: { ...init.aws, allHeaders: true },
    };
  };
  const send = (u, init = {}) => passthrough.fetch(u, signAll(u, init));
  const sendMeta = (u, init = {}) => aws.fetch(u, signAll(u, init));

  return {
    origin: base,
    url,
    send,

    async getJson(bucket, key) {
      const res = await sendMeta(url(bucket, key));
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new Error(`GET ${bucket}/${key} → ${res.status}`);
      return { status: res.status, etag: res.headers.get('etag'), value: JSON.parse(await res.text()) };
    },

    /**
     * @param guard `{ ifMatch }` for a replace, `{ ifNoneMatch: '*' }` for a
     *              create. Returns the new ETag, or false on 412/409.
     */
    async put(bucket, key, body, { contentType = 'application/json', ...guard } = {}) {
      const headers = { 'content-type': contentType };
      if (guard.ifMatch) headers['if-match'] = normalizeIfMatch(guard.ifMatch);
      if (guard.ifNoneMatch) headers['if-none-match'] = guard.ifNoneMatch;
      // Bytes, not a string: for a string body Node's fetch appends its own
      // content-type after signing, which RGW rejects as unsigned.
      const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
      const res = await sendMeta(url(bucket, key), { method: 'PUT', body: bytes, headers });
      if (res.status === 412 || res.status === 409) return false;
      if (!res.ok) throw new Error(`PUT ${bucket}/${key} → ${res.status} ${await res.text()}`);
      return res.headers.get('etag');
    },

    /** True when the bucket was made, false when it already existed and is ours. */
    async createBucket(bucket) {
      const res = await sendMeta(url(bucket), { method: 'PUT' });
      if (res.ok) return true;
      const text = await res.text();
      if (res.status === 409 && text.includes('BucketAlreadyOwnedByYou')) return false;
      throw new Error(`create bucket ${bucket} → ${res.status} ${text}`);
    },

    /** One listing page, with the fields a client's SDK reads back. */
    async listPage(bucket, {
      prefix = '', delimiter = '', token, startAfter, maxKeys = 1000,
    } = {}) {
      const query = { 'list-type': '2', prefix, 'max-keys': String(maxKeys) };
      if (delimiter) query.delimiter = delimiter;
      if (token) query['continuation-token'] = token;
      if (startAfter) query['start-after'] = startAfter;
      const res = await sendMeta(url(bucket, '', query));
      if (!res.ok) throw new Error(`LIST ${bucket}/${prefix} → ${res.status}`, { cause: res });
      const xml = await res.text();
      const keys = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => {
        const pick = (tag) => {
          const hit = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(m[1]);
          return hit ? decodeEntities(hit[1]) : undefined;
        };
        const key = pick('Key');
        if (key === undefined) throw new Error('listing entry has no Key');
        return {
          key,
          size: Number(pick('Size') ?? 0),
          lastModified: pick('LastModified'),
          etag: pick('ETag'),
        };
      });
      return {
        keys,
        commonPrefixes: [...xml.matchAll(/<CommonPrefixes><Prefix>([\s\S]*?)<\/Prefix><\/CommonPrefixes>/g)]
          .map((m) => decodeEntities(m[1])),
        nextToken: /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeEntities(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '')
          : null,
      };
    },

    async listAll(bucket, prefix) {
      const all = [];
      let token;
      do {
        const page = await this.listPage(bucket, { prefix, token });
        all.push(...page.keys);
        token = page.nextToken;
      } while (token);
      return all;
    },
  };
}

// MinIO, like any Go encoder, writes `"` as `&#34;`; every ETag in a listing
// arrives that way.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
