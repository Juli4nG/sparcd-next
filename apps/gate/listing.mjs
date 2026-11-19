// Listings of the settings bucket, built here with `access/` stepped over.
// The gate paginates the upstream itself: handing back a filtered page with
// the upstream's continuation token would let a caller count what was removed.

import { ACCESS_PREFIX } from './rules.mjs';
import { escapeXml } from './sigv4.mjs';

/**
 * The first string that sorts after everything under `tree`: every key in
 * `access/` is less than `access0`, which is less than the next real key.
 */
export function afterTree(tree) {
  const last = tree.charCodeAt(tree.length - 1);
  return tree.slice(0, -1) + String.fromCharCode(last + 1);
}

export const encodeListingToken = (key) => Buffer.from(key, 'utf8').toString('base64url');

export function decodeListingToken(token) {
  if (typeof token !== 'string' || token === '') return null;
  const decoded = Buffer.from(token, 'base64url');
  // base64url decoding never throws, so the round trip is the validation.
  if (decoded.toString('base64url') !== token) return null;
  return decoded.toString('utf8');
}

export function buildListing({
  bucket, prefix = '', delimiter = '', keys, commonPrefixes,
  truncated = false, nextToken = null,
}) {
  const contents = keys.map((k) =>
    `<Contents><Key>${escapeXml(k.key)}</Key>`
    + `<LastModified>${escapeXml(k.lastModified ?? '1970-01-01T00:00:00.000Z')}</LastModified>`
    + `<ETag>${escapeXml(k.etag ?? '""')}</ETag>`
    + `<Size>${Number(k.size ?? 0)}</Size>`
    + '<StorageClass>STANDARD</StorageClass></Contents>').join('');
  const prefixes = commonPrefixes
    .map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
    + `<Name>${escapeXml(bucket)}</Name><Prefix>${escapeXml(prefix)}</Prefix>`
    + `<Delimiter>${escapeXml(delimiter)}</Delimiter>`
    + `<KeyCount>${keys.length + commonPrefixes.length}</KeyCount><MaxKeys>1000</MaxKeys>`
    + `<IsTruncated>${truncated ? 'true' : 'false'}</IsTruncated>`
    + (truncated && nextToken
      ? `<NextContinuationToken>${escapeXml(encodeListingToken(nextToken))}</NextContinuationToken>`
      : '')
    + contents + prefixes
    + '</ListBucketResult>';
}

/**
 * One page of a settings listing. When the walk reaches `access/`, the cursor
 * jumps past the whole tree in one move rather than paging through it.
 */
export async function listAroundAccess({
  upstream, bucket, prefix, delimiter, maxKeys, after,
}) {
  const hidden = (name) => name.startsWith(ACCESS_PREFIX);
  const keys = [];
  const commonPrefixes = [];
  let cursor = after ?? undefined;
  let truncated = false;
  // Where the caller got to. A folder is resumed past rather than into.
  let resumeAt = null;
  const entries = () => keys.length + commonPrefixes.length;

  for (let page = 0; page < 20; page += 1) {
    const got = await upstream.listPage(bucket, {
      prefix, delimiter, startAfter: cursor, maxKeys: 1000,
    });

    // Folders and keys are two halves of one page and both count against
    // max-keys. The upstream sorts UTF-8 bytes, which JS string comparison
    // does not, so the merge compares bytes.
    const items = [
      ...got.commonPrefixes.map((name) => ({ name })),
      ...got.keys.map((entry) => ({ name: entry.key, entry })),
    ].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));

    let jumped = false;
    for (const { name, entry } of items) {
      if (hidden(name)) {
        cursor = afterTree(ACCESS_PREFIX);
        if (entry) { jumped = true; break; }
        continue;
      }
      if (entries() >= maxKeys) { truncated = true; break; }
      if (entry) {
        keys.push(entry);
        cursor = name;
        resumeAt = name;
      } else {
        commonPrefixes.push(name);
        resumeAt = afterTree(name);
        cursor = resumeAt;
      }
    }
    if (truncated) break;
    if (!jumped && (!got.nextToken || items.length === 0)) break;
    if (page === 19) {
      truncated = true;
      resumeAt = resumeAt ?? cursor ?? after ?? '';
    }
  }

  return { keys, commonPrefixes, truncated, nextToken: truncated && resumeAt ? resumeAt : null };
}
