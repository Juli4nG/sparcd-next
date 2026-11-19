// Checks a running gate through its public origin, as one demo login:
//   SMOKE_ENDPOINT=https://server.example.org SMOKE_LOGIN=ana SMOKE_PASSWORD=... node deploy/smoke.mjs
// It writes two small objects to the login's own bucket and reuses them on
// every run: smoke/check.txt and one write-once Media/<sha256>/thumb.jpg.

import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

const endpoint = (process.env.SMOKE_ENDPOINT ?? '').replace(/\/$/, '');
const login = process.env.SMOKE_LOGIN;
const password = process.env.SMOKE_PASSWORD;
const other = process.env.SMOKE_OTHER ?? 'nobody';
if (!endpoint || !login || !password) {
  process.stderr.write('set SMOKE_ENDPOINT, SMOKE_LOGIN and SMOKE_PASSWORD\n');
  process.exit(2);
}

const sha = (data) => createHash('sha256').update(data).digest('hex');
const client = (secretAccessKey) =>
  new AwsClient({ accessKeyId: login, secretAccessKey, service: 's3', region: 'us-east-1' });
const me = client(password);

async function call(method, path, { body, headers = {}, as = me } = {}) {
  const res = await as.fetch(`${endpoint}${path}`, {
    method,
    body,
    headers: { 'x-amz-content-sha256': sha(body ?? ''), ...headers },
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function presignedGet(path, expires) {
  const u = new URL(`${endpoint}${path}`);
  u.searchParams.set('X-Amz-Expires', String(expires));
  const signed = await me.sign(u.toString(), { method: 'GET', aws: { signQuery: true } });
  return fetch(signed.url);
}
const presigned = async (path, expires) => (await presignedGet(path, expires)).status;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `  (${detail})`}\n`);
}

const health = await fetch(`${endpoint}/-/health`);
check('health', health.status === 200, health.status);

const who = await call('GET', '/-/whoami');
const whoami = who.status === 200 ? JSON.parse(who.text) : {};
check('whoami', whoami.code === login && whoami.bucket === `sparcd-next-${login}`, `${who.status} ${who.text}`);
const wrong = await call('GET', '/-/whoami', { as: client(`${password}x`) });
check('whoami with a wrong password is 403', wrong.status === 403, wrong.status);

const own = `/${whoami.bucket}`;
const settings = `/${whoami.settingsBucket}`;
const note = `smoke ${new Date().toISOString()}`;
const put = await call('PUT', `${own}/smoke/check.txt`, { body: note, headers: { 'content-type': 'text/plain' } });
check('put in own bucket', put.status === 200, put.status);
const got = await call('GET', `${own}/smoke/check.txt`);
check('get it back', got.status === 200 && got.text === note, got.status);
check('not cached', got.headers.get('cache-control') === 'no-store', got.headers.get('cache-control'));

const theirs = await call('GET', `/sparcd-next-${other}/smoke/check.txt`);
check("another person's bucket is 403", theirs.status === 403, theirs.status);
const theirPut = await call('PUT', `/sparcd-next-${other}/smoke/check.txt`, { body: 'x' });
check("writing another person's bucket is 403", theirPut.status === 403, theirPut.status);
const del = await call('DELETE', `${own}/smoke/check.txt`);
check('DeleteObject is 403', del.status === 403, del.status);
const still = await call('HEAD', `${own}/smoke/check.txt`);
check('and the object is still there', still.status === 200, still.status);
// Through the front, `/` is the home page and other buckets never reach the
// gate at all; the gate's own 403 for both is covered by test/e2e.test.mjs.
const buckets = await call('GET', '/');
check('ListBuckets is not served', !buckets.text.includes('ListAllMyBucketsResult'), buckets.status);
const outside = await call('GET', '/sparcd-other/x');
check('a bucket outside sparcd-next-* is not served', outside.status >= 400, outside.status);

const person = await call('GET', `${settings}/access/people/${login}.json`);
check('settings access/ is 403', person.status === 403, person.status);
const accessList = await call('GET', `${settings}?list-type=2&prefix=access/`);
check('listing settings access/ is 403', accessList.status === 403, accessList.status);
const rootList = await call('GET', `${settings}?list-type=2`);
check('settings listing hides access/', rootList.status === 200 && !rootList.text.includes('access/'), rootList.status);
const lab = await call('GET', `${settings}/lab.json`);
check('settings lab.json is readable', lab.status === 200, lab.status);
const settingsPut = await call('PUT', `${settings}/lab.json`, { body: '{}' });
check('settings is read-only', settingsPut.status === 403, settingsPut.status);

const photo = Buffer.from('sparcd-next smoke thumbnail');
const media = `${own}/Media/${sha(photo)}/thumb.jpg`;
const bare = await call('PUT', media, { body: photo, headers: { 'content-type': 'image/jpeg' } });
check('Media/ PUT without If-None-Match is 403', bare.status === 403, bare.status);
const first = await call('PUT', media, { body: photo, headers: { 'content-type': 'image/jpeg', 'if-none-match': '*' } });
check('Media/ PUT with If-None-Match: * is written once', first.status === 200 || first.status === 412, first.status);
const again = await call('PUT', media, { body: photo, headers: { 'content-type': 'image/jpeg', 'if-none-match': '*' } });
check('a second Media/ PUT is 412', again.status === 412, again.status);
const thumb = await call('GET', media);
check('header-signed Media/ GET is not cached', thumb.headers.get('cache-control') === 'no-store',
  thumb.headers.get('cache-control'));
check('object responses are sandboxed', (thumb.headers.get('content-security-policy') ?? '').startsWith('sandbox'),
  thumb.headers.get('content-security-policy'));
const presignedThumb = await presignedGet(media, 7200);
check('presigned Media/ GET is cached for two hours',
  presignedThumb.headers.get('cache-control') === 'private, max-age=7200, immutable',
  presignedThumb.headers.get('cache-control'));

check('a 7-day presign of a thumb works', await presigned(media, 604800) === 200);
check('a 7-day presign of anything else is 403', await presigned(`${own}/smoke/check.txt`, 604800) === 403);
check('a 2-hour presign of anything works', await presigned(`${own}/smoke/check.txt`, 7200) === 200);

process.stdout.write(failed ? `${failed} check(s) failed\n` : 'all checks passed\n');
process.exitCode = failed ? 1 : 0;
