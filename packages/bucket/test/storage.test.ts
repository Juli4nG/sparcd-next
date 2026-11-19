import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Error, signIn, type Config } from '../src';
import { fakeS3 } from './fakeS3';

const gate: Config = { gate: true, endpoint: 'https://server.example.org', region: 'us-east-1' };
let s3: ReturnType<typeof fakeS3>;

beforeEach(() => {
  s3 = fakeS3();
  vi.stubGlobal('fetch', s3.fetch);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => vi.restoreAllMocks());

const signedHeaders = (h: Headers) => /SignedHeaders=([^,]+)/.exec(h.get('authorization')!)![1].split(';');

describe('storage', () => {
  it('signs in through whoami with a real empty-body hash', async () => {
    const session = await signIn(gate, '  Ana ', ' maple-river-stone-cloud ');
    expect([session.name, session.code, session.bucket.name, session.settings.name]).toEqual(['Ana', 'ana', 'sparcd-next-ana', 'sparcd-next-settings']);
    const [req] = s3.requests;
    expect(req.url.pathname).toBe('/-/whoami');
    expect(req.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update('').digest('hex'));
    expect(req.headers.get('authorization')).toContain('Credential=ana/');
  });

  it('reports a wrong password as a 403', async () => {
    s3.failures.push(403);
    await expect(signIn(gate, 'ana', 'nope')).rejects.toMatchObject({ name: 'S3Error', status: 403 });
  });

  it('derives the session from config without a gate', async () => {
    const config: Config = { gate: false, endpoint: 'https://minio.example.org/', region: 'us-east-1', settingsBucket: 'sparcd-next-settings', bucketPrefix: 'sparcd-next-' };
    const session = await signIn(config, 'ana', 'secret');
    expect([session.name, session.code, session.bucket.name]).toEqual(['ana', 'ana', 'sparcd-next-ana']);
    expect(s3.requests[0].url.href).toBe('https://minio.example.org/sparcd-next-ana?list-type=2&max-keys=1');
  });

  it('PUTs with an encoded path, signed content-type and a real hash; write-once returns exists', async () => {
    const { bucket } = await signIn(gate, 'ana', 'pw');
    const body = new TextEncoder().encode('jpeg bytes');
    const sha = createHash('sha256').update(body).digest('hex');
    const key = `Media/${sha}/My Photo (1)+&.JPG`;
    expect(await bucket.putObject(key, body, { contentType: 'image/jpeg', sha256: sha })).toBe('stored');
    const put = s3.requests.at(-1)!;
    expect(put.url.pathname).toBe(`/sparcd-next-ana/Media/${sha}/My%20Photo%20%281%29%2B%26.JPG`);
    expect(put.headers.get('x-amz-content-sha256')).toBe(sha);
    expect(signedHeaders(put.headers)).toEqual(expect.arrayContaining(['content-type', 'if-none-match', 'x-amz-content-sha256', 'host']));
    expect(await bucket.putObject(key, new Blob([body]), { contentType: 'image/jpeg' })).toBe('exists');
    expect(s3.requests.at(-1)!.headers.get('x-amz-content-sha256')).toBe(sha);
  });

  it('reads text, with null for a missing object', async () => {
    const { bucket } = await signIn(gate, 'ana', 'pw');
    await bucket.putText('media.csv', 'mediaID\n');
    expect(s3.objects.get('sparcd-next-ana/media.csv')!.contentType).toBe('text/csv; charset=utf-8');
    expect(await bucket.getText('media.csv')).toBe('mediaID\n');
    expect(await bucket.getText('deployments.csv')).toBeNull();
  });

  it('retries 5xx and gives up after five attempts', async () => {
    const { bucket } = await signIn(gate, 'ana', 'pw');
    s3.failures.push(503, 500);
    await bucket.putText('lab.json', '{}');
    expect(s3.objects.has('sparcd-next-ana/lab.json')).toBe(true);
    s3.failures.push(503, 503, 503, 503, 503);
    await expect(bucket.getText('lab.json')).rejects.toBeInstanceOf(S3Error);
  });

  it('lists keys across pages', async () => {
    const { bucket } = await signIn(gate, 'ana', 'pw');
    for (const k of ['Media/a/1.jpg', 'Media/a/thumb.jpg', 'Media/b/R&D.jpg', 'media.csv']) await bucket.putText(k, '');
    expect(await bucket.listKeys('Media/')).toEqual(['Media/a/1.jpg', 'Media/a/thumb.jpg', 'Media/b/R&D.jpg']);
  });

  it('sends a large photo in one PUT, and only Media/ is write-once', async () => {
    const { bucket } = await signIn(gate, 'ana', 'pw');
    const big = new Uint8Array(17 * 1024 * 1024).map((_, i) => i % 251);
    expect(await bucket.putObject('Media/x/big.jpg', big, { contentType: 'image/jpeg' })).toBe('stored');
    expect(s3.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(await bucket.putObject('Media/x/big.jpg', big, { contentType: 'image/jpeg' })).toBe('exists');
    await bucket.putText('media.csv', 'mediaID\n');
    expect(s3.requests.at(-1)!.headers.get('if-none-match')).toBeNull();
  });

  it('presigns hour-stable URLs', async () => {
    const { bucket } = await signIn(gate, 'ana', 'pw');
    const a = new URL(await bucket.presignGet('Media/x/thumb.jpg', { hourStable: true }));
    const b = new URL(await bucket.presignGet('Media/x/thumb.jpg', { hourStable: true }));
    expect(a.href).toBe(b.href);
    expect(a.pathname).toBe('/sparcd-next-ana/Media/x/thumb.jpg');
    expect(a.searchParams.get('X-Amz-Date')).toMatch(/^\d{8}T\d{2}0000Z$/);
    expect(a.searchParams.get('X-Amz-Expires')).toBe('7200');
    const week = new URL(await bucket.presignGet('shared/k3/datapackage.json', { expiresSeconds: 604_800 }));
    expect(week.searchParams.get('X-Amz-Expires')).toBe('604800');
  });
});
