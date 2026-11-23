import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Error, type Session } from '@sparcd/bucket';
import { openShards } from '../src/send/shards';

const config = vi.hoisted(() => ({ gate: true }));
vi.mock('@sparcd/bucket', async (actual) => ({ ...(await actual<object>()), loadConfig: async () => config }));

const HOST = 'server.example.org';
const EXTRA = [8443, 8444, 8445, 8446, 8447, 8448, 8449];
const session = { bucket: { name: 'sparcd-next-ana' } } as unknown as Session;
const bytes = new Blob([new Uint8Array([1, 2, 3])]);
const SHA = 'a'.repeat(64);
const JPEG = 'image/jpeg';

type Call = { method: string; host: string; path: string; headers: Headers };
type Answer = number | 'network';
let calls: Call[];

/** Stubs the page: its sign-in, its host name, and `fetch`, which answers per request and never leaves the process. */
function page(answer: (c: Call) => Answer = () => 200) {
  calls = [];
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => (k === 'sparcd-next.signin' ? JSON.stringify({ login: 'ana', password: 'pw' }) : null) });
  vi.stubGlobal('location', { hostname: HOST, origin: `https://${HOST}` });
  vi.stubGlobal('fetch', async (req: Request) => {
    const url = new URL(req.url);
    const call = { method: req.method, host: url.host, path: url.pathname, headers: req.headers };
    calls.push(call);
    const a = answer(call);
    if (a === 'network') throw new TypeError('fetch failed');
    return new Response(a === 200 ? '' : 'refused', { status: a });
  });
}

const puts = () => calls.filter((c) => c.method === 'PUT');
const probes = () => calls.filter((c) => c.method === 'GET');
const origin = (port?: number) => (port ? `${HOST}:${port}` : HOST);
/** Only these extra ports answer their probe. */
const onlyExtra =
  (ports: number[], then: (c: Call) => Answer = () => 200) =>
  (c: Call): Answer =>
    c.method === 'GET' ? (ports.some((p) => c.host === origin(p)) ? 200 : 'network') : then(c);

beforeEach(() => {
  config.gate = true;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openShards probing', () => {
  it('probes each extra port with a signed whoami, never 443, and counts the ones that answer', async () => {
    page();
    const shards = await openShards(session);
    expect(probes().map((c) => c.host).sort()).toEqual(EXTRA.map((p) => origin(p)).sort());
    expect(probes().every((c) => c.path === '/-/whoami' && c.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=ana/'))).toBe(true);
    expect(shards.live()).toBe(8);
  });

  it('never uses an extra port that fails its probe, whether it errors, answers 5xx or refuses', async () => {
    page((c) => {
      if (c.method !== 'GET') return 200;
      if (c.host === origin(8443)) return 'network';
      if (c.host === origin(8444)) return 500;
      if (c.host === origin(8445)) return 403;
      return 200;
    });
    const shards = await openShards(session);
    expect(shards.live()).toBe(5);
    for (let i = 0; i < 10; i++) await shards.put(`Media/${i}/view.jpg`, bytes, SHA, JPEG);
    const used = new Set(puts().map((c) => c.host));
    expect([...used].sort()).toEqual([origin(), origin(8446), origin(8447), origin(8448), origin(8449)].sort());
  });

  it('works through 443 alone when every extra port fails its probe', async () => {
    page(onlyExtra([]));
    const shards = await openShards(session);
    expect(shards.live()).toBe(1);
    await shards.put('Media/a/view.jpg', bytes, SHA, JPEG);
    await shards.put('Media/b/view.jpg', bytes, SHA, JPEG);
    expect(puts().map((c) => c.host)).toEqual([origin(), origin()]);
  });
});

describe('openShards put', () => {
  it('spreads photos round-robin over the live endpoints, 443 first', async () => {
    page();
    const shards = await openShards(session);
    for (let i = 0; i < 16; i++) await shards.put(`Media/${i}/view.jpg`, bytes, SHA, JPEG);
    const order = [origin(), ...EXTRA.map((p) => origin(p))];
    expect(puts().map((c) => c.host)).toEqual([...order, ...order]);
  });

  it('signs each request for its own host and sends the bucket path, the sha, the content type and the write-once header', async () => {
    page();
    const shards = await openShards(session);
    await shards.put('Media/ab c/IMG 1.JPG', bytes, SHA, JPEG);
    await shards.put('Media/ab c/VID 1.MP4', bytes, SHA, 'video/mp4');
    const [first, second] = puts();
    expect(first.path).toBe('/sparcd-next-ana/Media/ab%20c/IMG%201.JPG');
    expect(second.host).toBe(origin(8443));
    expect(first.headers.get('content-type')).toBe('image/jpeg');
    expect(second.headers.get('content-type')).toBe('video/mp4');
    for (const c of [first, second]) {
      expect(c.headers.get('x-amz-content-sha256')).toBe(SHA);
      expect(c.headers.get('if-none-match')).toBe('*');
      expect(c.headers.get('authorization')).toContain('Credential=ana/');
    }
    expect(first.headers.get('authorization')).not.toBe(second.headers.get('authorization'));
  });

  it.each([['a network error', 'network' as const], ['a 5xx', 503], ['a refusal', 403]])(
    'drops an extra port that fails a PUT with %s and sends the same photo to another endpoint',
    async (_name, failure) => {
      page(onlyExtra([8443], (c) => (c.host === origin(8443) ? failure : 200)));
      const shards = await openShards(session);
      expect(shards.live()).toBe(2);
      await shards.put('Media/a/view.jpg', bytes, SHA, JPEG);
      await shards.put('Media/b/view.jpg', bytes, SHA, JPEG);
      await shards.put('Media/c/view.jpg', bytes, SHA, JPEG);
      expect(puts().map((c) => [c.path.split('/')[3], c.host])).toEqual([
        ['a', origin()],
        ['b', origin(8443)],
        ['b', origin()],
        ['c', origin()],
      ]);
      expect(shards.live()).toBe(1);
    },
  );

  it('treats a 412, the photo already being stored, as stored, on any endpoint, with no retry', async () => {
    page(onlyExtra([8443], () => 412));
    const shards = await openShards(session);
    await shards.put('Media/a/view.jpg', bytes, SHA, JPEG);
    await shards.put('Media/a/view.jpg', bytes, SHA, JPEG);
    expect(puts().map((c) => c.host)).toEqual([origin(), origin(8443)]);
    expect(shards.live()).toBe(2);
  });

  it('throws on a 403 from 443 at once: the login is the problem, not the endpoint', async () => {
    page(onlyExtra([], () => 403));
    const shards = await openShards(session);
    await expect(shards.put('Media/a/view.jpg', bytes, SHA, JPEG)).rejects.toMatchObject({ name: 'S3Error', status: 403 });
    expect(puts()).toHaveLength(1);
  });

  it('throws on a 413 from 443 or from an extra port, and keeps the extra port', async () => {
    page(onlyExtra([8443], () => 413));
    const shards = await openShards(session);
    const primary = shards.put('Media/a/view.jpg', bytes, SHA, JPEG);
    await expect(primary).rejects.toBeInstanceOf(S3Error);
    await expect(primary).rejects.toMatchObject({ status: 413 });
    await expect(shards.put('Media/b/view.jpg', bytes, SHA, JPEG)).rejects.toMatchObject({ status: 413 });
    expect(puts().map((c) => c.host)).toEqual([origin(), origin(8443)]);
    expect(shards.live()).toBe(2);
  });

  describe('on 443 alone', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0));

    it('retries a 5xx, a 429 or a network error and succeeds once it answers', async () => {
      const answers: Answer[] = [503, 429, 'network', 200];
      page(onlyExtra([], () => answers.shift()!));
      const shards = await openShards(session);
      await shards.put('Media/a/view.jpg', bytes, SHA, JPEG);
      expect(puts()).toHaveLength(4);
    });

    it('gives up after five attempts with the last status', async () => {
      page(onlyExtra([], () => 503));
      const shards = await openShards(session);
      await expect(shards.put('Media/a/view.jpg', bytes, SHA, JPEG)).rejects.toMatchObject({ name: 'S3Error', status: 503 });
      expect(puts()).toHaveLength(5);
    });

    it('gives up after five network errors with that error', async () => {
      page(onlyExtra([], () => 'network'));
      const shards = await openShards(session);
      await expect(shards.put('Media/a/view.jpg', bytes, SHA, JPEG)).rejects.toBeInstanceOf(TypeError);
      expect(puts()).toHaveLength(5);
    });
  });
});

describe('openShards without a gate', () => {
  it('stores each photo through the signed-in bucket, write-once, and probes nothing', async () => {
    page();
    config.gate = false;
    const putObject = vi.fn(async () => 'stored' as const);
    const shards = await openShards({ bucket: { name: 'sparcd-next-ana', putObject } } as unknown as Session);
    await shards.put('Media/x/view.jpg', bytes, SHA, JPEG);
    expect(shards.live()).toBe(1);
    expect(putObject).toHaveBeenCalledWith('Media/x/view.jpg', bytes, { contentType: 'image/jpeg', sha256: SHA });
    expect(calls).toEqual([]);
  });
});
