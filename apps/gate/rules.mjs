// What an S3 request is, and whether this person may make it. Both steps fail
// closed: `classify` returns null for anything it does not recognise, including
// any query parameter not on the known list (`?acl`, `?policy`, `?versioning`),
// and `decide` denies whatever the table below does not allow.

export const BUCKET_PREFIX = 'sparcd-next-';
export const ACCESS_PREFIX = 'access/';
export const PERSON_CODE = /^[a-z][a-z0-9]{1,19}$/;
export const RESERVED_CODES = new Set(['settings', 'gate', 'admin']);

export const DEFAULT_PRESIGN_S = 7200;
export const LONG_PRESIGN_S = 604800;
const LONG_PRESIGN_KEY = /^(Media\/[0-9a-f]{64}\/(thumb|view)\.jpg$|shared\/)/;

const KNOWN_QUERY = new Set([
  'list-type', 'prefix', 'delimiter', 'max-keys', 'continuation-token',
  'start-after', 'encoding-type', 'fetch-owner', 'marker',
  'location',
  'x-id',
  'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires',
  'X-Amz-SignedHeaders', 'X-Amz-Signature', 'X-Amz-Security-Token',
  // The AWS SDK presigner hoists its UNSIGNED-PAYLOAD declaration into the query.
  'X-Amz-Content-Sha256',
]);

/** One operation name, or null when the request names none the gate serves. */
export function classify({ method, bucket, key, query, headers }) {
  for (const name of query.keys()) {
    if (!KNOWN_QUERY.has(name)) return null;
  }
  if (!bucket) return method === 'GET' ? 'ListBuckets' : null;

  if (!key) {
    if (method === 'HEAD' && query.size === 0) return 'HeadBucket';
    if (method === 'GET' && query.has('location')) return 'GetBucketLocation';
    if (method === 'GET' && query.get('list-type') === '2') return 'ListObjectsV2';
    return null;
  }

  // CopyObject wears PutObject's clothes; the source header is the only tell.
  if (headers.get('x-amz-copy-source')) return 'CopyObject';

  if (method === 'GET') return 'GetObject';
  if (method === 'HEAD') return 'HeadObject';
  if (method === 'PUT') return 'PutObject';
  if (method === 'DELETE') return 'DeleteObject';
  return null;
}

const OWN_OPS = new Set([
  'GetObject', 'HeadObject', 'ListObjectsV2', 'HeadBucket', 'GetBucketLocation',
  'PutObject',
]);
const SETTINGS_OPS = new Set(['GetObject', 'HeadObject', 'ListObjectsV2']);

export const ownBucket = (code) => `${BUCKET_PREFIX}${code}`;

/**
 * @param person   { code, status }
 * @param request  { op, bucket, key, settingsBucket, ifNoneMatch }
 *                 `ifNoneMatch` is the header's value only when it was signed.
 */
export function decide(person, { op, bucket, key, settingsBucket, ifNoneMatch }) {
  if (!op) return deny('unknown operation');
  if (person.status !== 'active') return deny(`person is ${person.status}`);

  if (bucket === ownBucket(person.code)) {
    if (!OWN_OPS.has(op)) return deny(`${op} is not served`);
    if (op === 'PutObject' && key.startsWith('Media/') && ifNoneMatch !== '*') {
      return deny('photos are write-once: If-None-Match: * is required under Media/');
    }
    return { allow: true };
  }

  if (bucket === settingsBucket) {
    if (!SETTINGS_OPS.has(op)) return deny('the settings bucket is read-only');
    if (key.startsWith(ACCESS_PREFIX)) return deny('access/ belongs to the gate');
    return { allow: true };
  }

  return deny('not your bucket');
}

function deny(reason) {
  return { allow: false, reason };
}

/** The longest presign this key may carry. */
export const presignLimit = (key) => (LONG_PRESIGN_KEY.test(key) ? LONG_PRESIGN_S : DEFAULT_PRESIGN_S);

export function cacheControl(op, key, status, presigned) {
  return presigned && op === 'GetObject' && (status === 200 || status === 206) && key.startsWith('Media/')
    ? 'private, max-age=7200, immutable'
    : 'no-store';
}

/**
 * Whether a settings listing may run at all. A prefix inside `access/`, or one
 * that can only be heading there, is refused rather than answered empty.
 */
export function settingsPrefixAllowed(prefix) {
  if (prefix.startsWith(ACCESS_PREFIX)) return false;
  return prefix === '' || !ACCESS_PREFIX.startsWith(prefix);
}
