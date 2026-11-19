// No sockets: signatures, the namespace guard, classification and the rules.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AwsClient } from 'aws4fetch';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { verifySignature, canonicalQueryString, encodeRfc3986, sha256hex } from '../sigv4.mjs';
import {
  makeGuard, bucketFromPath, keyFromPath, safeKeySegments, safeRequestTarget,
  scrubErrorDetail, namesOtherBucket,
} from '../namespace.mjs';
import {
  classify, decide, presignLimit, cacheControl, settingsPrefixAllowed,
} from '../rules.mjs';
import { afterTree, decodeListingToken, encodeListingToken, listAroundAccess } from '../listing.mjs';
import { loadMasterKey, wrapSecret, unwrapSecret, newPassword } from '../people.mjs';
import { WORDS } from '../words.mjs';
import { normalizeIfMatch } from '../upstream.mjs';

const KEY = { accessKeyId: 'ana', secretAccessKey: 'maple-river-stone-cloud' };
const lookup = (id) => (id === KEY.accessKeyId ? KEY.secretAccessKey : null);
const aws = new AwsClient({ ...KEY, service: 's3', region: 'us-east-1' });

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

  test('responses are scrubbed and checked for other buckets', () => {
    const xml = '<Error><Code>NoSuchKey</Code><Resource>/sparcd-next-ana/k</Resource><HostId>h</HostId></Error>';
    assert.equal(scrubErrorDetail(xml), '<Error><Code>NoSuchKey</Code></Error>');
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
    assert.equal(call('GET', 'b', '', 'uploads='), 'ListMultipartUploads');
    assert.equal(call('HEAD', 'b', ''), 'HeadBucket');
    assert.equal(call('GET', 'b', 'k'), 'GetObject');
    assert.equal(call('HEAD', 'b', 'k'), 'HeadObject');
    assert.equal(call('PUT', 'b', 'k'), 'PutObject');
    assert.equal(call('POST', 'b', 'k', 'uploads='), 'CreateMultipartUpload');
    assert.equal(call('PUT', 'b', 'k', 'uploadId=x&partNumber=1'), 'UploadPart');
    assert.equal(call('POST', 'b', 'k', 'uploadId=x'), 'CompleteMultipartUpload');
    assert.equal(call('DELETE', 'b', 'k', 'uploadId=x'), 'AbortMultipartUpload');
    assert.equal(call('GET', 'b', 'k', 'uploadId=x'), 'ListParts');
    assert.equal(call('DELETE', 'b', 'k'), 'DeleteObject');
    assert.equal(call('PUT', 'b', 'k', '', new Headers({ 'x-amz-copy-source': '/o/k' })), 'CopyObject');
  });

  test('unknown parameters and bucket-level writes are unclassifiable', () => {
    for (const query of ['acl=', 'policy=', 'versioning=', 'tagging=', 'cors=', 'versions=']) {
      assert.equal(call('GET', 'b', '', query), null, query);
      assert.equal(call('PUT', 'b', 'k', query), null, query);
    }
    assert.equal(call('PUT', 'b', ''), null, 'CreateBucket');
    assert.equal(call('DELETE', 'b', ''), null, 'DeleteBucket');
    assert.equal(call('POST', 'b', '', 'delete='), null, 'DeleteObjects');
  });
});

describe('the rules', () => {
  const ana = { code: 'ana', status: 'active' };
  const allow = (op, bucket, key = '', extra = {}) =>
    decide(ana, { op, bucket, key, settingsBucket: 'sparcd-next-settings', ifNoneMatch: null, ...extra }).allow;

  test('own bucket: read, list, write and multipart, never delete', () => {
    for (const op of ['GetObject', 'HeadObject', 'ListObjectsV2', 'HeadBucket', 'GetBucketLocation', 'PutObject',
      'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'AbortMultipartUpload', 'ListParts']) {
      assert.equal(allow(op, 'sparcd-next-ana', 'media.csv'), true, op);
    }
    for (const op of ['DeleteObject', 'CopyObject', 'ListMultipartUploads', 'ListBuckets', null]) {
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

  test('Media/ objects are cached immutable, everything else no-store', () => {
    assert.equal(cacheControl('GetObject', 'Media/x/view.jpg', 200), 'private, max-age=604800, immutable');
    assert.equal(cacheControl('GetObject', 'Media/x/view.jpg', 206), 'private, max-age=604800, immutable');
    assert.equal(cacheControl('GetObject', 'Media/x/view.jpg', 404), 'no-store');
    assert.equal(cacheControl('HeadObject', 'Media/x/view.jpg', 200), 'no-store');
    assert.equal(cacheControl('GetObject', 'media.csv', 200), 'no-store');
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
