// The namespace guard. BUCKET_ALLOW names every bucket this process may touch;
// nothing outside it is read, written, listed or named in a response. Anything
// that is not a plain, valid, lowercase bucket name is rejected rather than
// normalised: `%2F`, `../`, uppercase and empty all fail the same check.

import { BUCKET_PREFIX } from './rules.mjs';

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export function validBucketName(name) {
  return typeof name === 'string'
    && BUCKET_NAME.test(name)
    && !name.includes('..')
    && !name.includes('.-')
    && !name.includes('-.');
}

function globToRegExp(glob) {
  const body = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

/** `(bucket) => boolean` for a comma list of globs such as `sparcd-next-*`. */
export function makeGuard(spec) {
  const globs = String(spec).split(',').map((g) => g.trim()).filter(Boolean).map(globToRegExp);
  if (globs.length === 0) throw new Error('BUCKET_ALLOW is empty');
  return (bucket) => validBucketName(bucket) && bucket.startsWith(BUCKET_PREFIX)
    && globs.some((re) => re.test(bucket));
}

/**
 * The path-style bucket segment, decoded once and validated. Null for the
 * service root and for anything that is not a plain bucket name.
 */
export function bucketFromPath(pathname) {
  const raw = pathname.split('/')[1] ?? '';
  if (!raw) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return validBucketName(decoded) ? decoded : null;
}

/** The object key of a path-style request path, decoded per segment. */
export function keyFromPath(pathname) {
  const rest = pathname.split('/').slice(2);
  if (rest.length === 0) return '';
  try {
    return rest.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

/** True when an XML response names a bucket other than the caller's. */
export function namesOtherBucket(xml, bucket) {
  for (const [, , value] of xml.matchAll(/<(Name|Bucket|BucketName)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    if (value !== bucket) return true;
  }
  return false;
}

/**
 * The request target, judged on the raw bytes. `new URL('/\\evil/x', base)`
 * hands back host `evil`, so a check after parsing checks the attacker's host.
 */
export function safeRequestTarget(target) {
  if (typeof target !== 'string') return false;
  if (!target.startsWith('/')) return false;
  if (target.startsWith('//')) return false;
  return !target.includes('\\');
}

/**
 * Object keys the gate will carry. `.` and `..` segments would let a key escape
 * the prefix a rule just authorised; a backslash reads as a separator on some
 * clients; NUL and a leading slash are never meant.
 */
export function safeKeySegments(key) {
  if (typeof key !== 'string') return false;
  if (key === '') return true;
  if (key.startsWith('/')) return false;
  if (key.includes('\\') || key.includes('\u0000')) return false;
  return key.split('/').every((segment) => segment !== '.' && segment !== '..');
}
