// The gate in front of a throwaway MinIO (local/bin/minio, from local/bins.mjs).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { ensureBins, binPath } from '../local/bins.mjs';
import { createGate } from '../server.mjs';
import { openAdmin } from '../cli.mjs';
import { makeUpstream } from '../upstream.mjs';

const ROOT = { S3_ACCESS_KEY_ID: 'gatetestroot', S3_SECRET_ACCESS_KEY: 'gatetestrootsecret' };
const sha = (data) => createHash('sha256').update(data).digest('hex');

const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let minio;
let dataDir;
let gate;
let origin;
let admin;
const pw = {};

before(async () => {
  await ensureBins();
  dataDir = mkdtempSync(join(tmpdir(), 'gate-e2e-'));
  const s3Port = await freePort();
  minio = spawn(binPath('minio'), ['server', dataDir, '--address', `127.0.0.1:${s3Port}`, '--console-address', `127.0.0.1:${await freePort()}`], {
    env: { ...process.env, MINIO_ROOT_USER: ROOT.S3_ACCESS_KEY_ID, MINIO_ROOT_PASSWORD: ROOT.S3_SECRET_ACCESS_KEY },
    stdio: 'ignore',
  });
  const upstreamUrl = `http://127.0.0.1:${s3Port}`;
  for (let i = 0; ; i += 1) {
    try { if ((await fetch(`${upstreamUrl}/minio/health/ready`)).ok) break; } catch {}
    if (i > 60) throw new Error('MinIO did not start');
    await new Promise((r) => setTimeout(r, 500));
  }

  // MinIO over plain HTTP refuses customer keys, so this suite runs without one.
  const env = { ...ROOT, UPSTREAM: upstreamUrl, ACCESS_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'), DATA_KEY: 'none' };
  admin = openAdmin(env);
  await admin.init();
  pw.ana = await admin.add('ana', 'Ana');
  pw.ben = await admin.add('ben', 'Ben');
  // A bucket outside the namespace, as real lab data would be.
  const root = makeUpstream({ endpoint: upstreamUrl, accessKeyId: ROOT.S3_ACCESS_KEY_ID, secretAccessKey: ROOT.S3_SECRET_ACCESS_KEY, dataKey: null });
  await root.createBucket('lab-canary');
  await root.put('lab-canary', 'secret.txt', 'never read', { contentType: 'text/plain' });
  await root.put('sparcd-next-settings', 'lab.json', '{"title":"t"}');

  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  gate = await createGate({
    upstream: upstreamUrl, accessKeyId: ROOT.S3_ACCESS_KEY_ID, secretAccessKey: ROOT.S3_SECRET_ACCESS_KEY,
    masterKey: env.ACCESS_MASTER_KEY, dataKey: 'none', allowedHosts: `127.0.0.1:${port}`, log: () => {},
  });
  await gate.listen(port);
});

after(async () => {
  await gate?.close();
  minio?.kill();
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(dataDir, { recursive: true, force: true });
});

const as = (login, password = pw[login]) =>
  new AwsClient({ accessKeyId: login, secretAccessKey: password, service: 's3', region: 'us-east-1' });

async function call(method, path, { body, headers = {}, who = 'ana', password } = {}) {
  const res = await as(who, password).fetch(`${origin}${path}`, {
    method, body, headers: { 'x-amz-content-sha256': sha(body ?? ''), ...headers },
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function presigned(path, expires) {
  const u = new URL(`${origin}${path}`);
  u.searchParams.set('X-Amz-Expires', String(expires));
  return (await fetch((await as('ana').sign(u.toString(), { method: 'GET', aws: { signQuery: true } })).url)).status;
}

test('health, whoami, and nothing else under /-/', async () => {
  assert.equal((await fetch(`${origin}/-/health`)).status, 200);
  const who = await call('GET', '/-/whoami');
  assert.deepEqual(JSON.parse(who.text), {
    name: 'Ana', code: 'ana', bucket: 'sparcd-next-ana', settingsBucket: 'sparcd-next-settings',
  });
  assert.equal((await call('GET', '/-/whoami', { password: `${pw.ana}x` })).status, 403);
  assert.equal((await call('GET', '/-/whoami', { who: 'zed', password: 'a-b-c-d' })).status, 403);
  assert.equal((await call('GET', '/-/admin/people')).status, 404);
});

test('the AWS SDK works against its own bucket and only there', async () => {
  const s3 = new S3Client({
    endpoint: origin, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: 'ana', secretAccessKey: pw.ana },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  await s3.send(new PutObjectCommand({ Bucket: 'sparcd-next-ana', Key: 'media.csv', Body: 'mediaID\n', ContentType: 'text/csv' }));
  const got = await s3.send(new GetObjectCommand({ Bucket: 'sparcd-next-ana', Key: 'media.csv' }));
  assert.equal(await got.Body.transformToString(), 'mediaID\n');
  assert.equal(got.CacheControl, 'no-store');
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: 'sparcd-next-ana' }));
  assert.deepEqual(listed.Contents.map((c) => c.Key), ['media.csv']);
  await assert.rejects(s3.send(new ListObjectsV2Command({ Bucket: 'sparcd-next-ben' })), { name: 'AccessDenied' });
});

test('no delete, no other bucket, no ListBuckets, nothing outside the namespace', async () => {
  await call('PUT', '/sparcd-next-ana/keep.txt', { body: 'k' });
  assert.equal((await call('DELETE', '/sparcd-next-ana/keep.txt')).status, 403);
  assert.equal((await call('HEAD', '/sparcd-next-ana/keep.txt')).status, 200);
  assert.equal((await call('PUT', '/sparcd-next-ben/x.txt', { body: 'x' })).status, 403);
  assert.equal((await call('GET', '/sparcd-next-ben/x.txt')).status, 403);
  assert.equal((await call('GET', '/')).status, 403);
  const canary = await call('GET', '/lab-canary/secret.txt');
  assert.equal(canary.status, 403);
  assert.equal(canary.text.includes('never read'), false);
  assert.equal((await call('PUT', '/sparcd-next-ana/copy.txt', { headers: { 'x-amz-copy-source': '/lab-canary/secret.txt' } })).status, 403);
});

test('settings: readable, read-only, access/ hidden', async () => {
  assert.equal((await call('GET', '/sparcd-next-settings/lab.json')).status, 200);
  assert.equal((await call('PUT', '/sparcd-next-settings/lab.json', { body: '{}' })).status, 403);
  assert.equal((await call('GET', '/sparcd-next-settings/access/people/ana.json')).status, 403);
  assert.equal((await call('GET', '/sparcd-next-settings?list-type=2&prefix=access/')).status, 403);
  const root = await call('GET', '/sparcd-next-settings?list-type=2');
  assert.equal(root.status, 200);
  assert.match(root.text, /<Key>lab\.json<\/Key>/);
  assert.equal(root.text.includes('access'), false);
  const folders = await call('GET', '/sparcd-next-settings?list-type=2&delimiter=/');
  assert.equal(folders.text.includes('access'), false);
});

test('Media/ is write-once and header-signed reads use no-store', async () => {
  const photo = Buffer.from('a photo');
  const key = `/sparcd-next-ana/Media/${sha(photo)}/thumb.jpg`;
  const headers = { 'content-type': 'image/jpeg' };
  assert.equal((await call('PUT', key, { body: photo, headers })).status, 403);
  assert.equal((await call('PUT', key, { body: photo, headers: { ...headers, 'if-none-match': '*' } })).status, 200);
  assert.equal((await call('PUT', key, { body: photo, headers: { ...headers, 'if-none-match': '*' } })).status, 412);
  const got = await call('GET', key);
  assert.equal(got.headers.get('cache-control'), 'no-store');
  assert.equal((await call('GET', key, { headers: { range: 'bytes=0-1' } })).status, 206);
});

test('presign limits depend on the key', async () => {
  const thumb = `/sparcd-next-ana/Media/${sha('a photo')}/thumb.jpg`;
  assert.equal(await presigned(thumb, 604800), 200);
  assert.equal(await presigned('/sparcd-next-ana/keep.txt', 7200), 200);
  assert.equal(await presigned('/sparcd-next-ana/keep.txt', 7201), 403);
  assert.equal(await presigned(`/sparcd-next-ana/Media/${sha('big')}/IMG_0001.JPG`, 604800), 403);
});

test('pause and a new password take effect on the next refresh', async () => {
  await admin.setStatus('ben', 'paused');
  await gate.people.refresh();
  assert.equal((await call('GET', '/-/whoami', { who: 'ben' })).status, 403);
  await admin.setStatus('ben', 'active');
  const old = pw.ben;
  pw.ben = await admin.password('ben');
  await gate.people.refresh();
  assert.equal((await call('GET', '/-/whoami', { who: 'ben', password: old })).status, 403);
  assert.equal((await call('GET', '/-/whoami', { who: 'ben' })).status, 200);
  assert.deepEqual((await admin.list()).map((p) => p.code).sort(), ['ana', 'ben']);
});
