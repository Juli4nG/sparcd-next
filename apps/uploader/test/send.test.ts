import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@sparcd/bucket';
import { IN_FLIGHT_BYTES, MAX_FILE_BYTES, sendCard } from '../src/send/send';

const sha = (name: string) => createHash('sha256').update(name).digest('hex');
const MiB = 2 ** 20;

/** Bytes of files the pool is working on right now, and the most there ever were. */
const busy = { now: 0, max: 0, files: 0, maxFiles: 0 };
const frames: string[] = [];

vi.mock('../src/send/pool', () => ({
  createPool: () => ({
    read: async (file: File) => ({ sha256: sha(file.name), dateTimeOriginal: '2026:11:17 10:00:00' }),
    derive: async (file: File, frame?: unknown) => {
      if (file.name === 'BAD.JPG') throw Object.assign(new Error('The source image could not be decoded.'), { name: 'InvalidStateError' });
      if (file.name === 'PACKED.MOV') throw Object.assign(new Error('MP4 movie header is compressed'), { name: 'CameraDataError' });
      if (frame) frames.push(file.name);
      busy.now += file.size;
      busy.max = Math.max(busy.max, busy.now);
      busy.maxFiles = Math.max(busy.maxFiles, ++busy.files);
      await new Promise((r) => setTimeout(r, 5));
      busy.now -= file.size;
      busy.files--;
      return { thumb: new Blob(), thumbSha256: 't', view: new Blob(), viewSha256: 'v', original: new Blob(), originalSha256: 'o' };
    },
    close: () => {},
  }),
}));

vi.mock('../src/send/still', () => ({ stillFrame: async () => ({ still: true }) }));

// Photos go through the shards, not the bucket; keep what they were given.
const puts: string[] = [];
const types = new Map<string, string>();
vi.mock('../src/send/shards', () => ({
  openShards: async () => ({
    live: () => 1,
    put: async (key: string, _body: unknown, _sha: string, contentType: string) => {
      puts.push(key);
      types.set(key, contentType);
    },
  }),
}));

/** A file that says it is `size` bytes without holding them. */
const sized = (name: string, size: number) => {
  const file = new File([name], name);
  Object.defineProperty(file, 'size', { value: size });
  return { path: `DCIM/${name}`, file };
};

function fakeSession() {
  const store = new Map<string, string>();
  const bucket = {
    name: 'sparcd-next-test',
    getText: async (key: string) => store.get(key) ?? null,
    putText: async (key: string, text: string) => void store.set(key, text),
    listKeys: async (prefix: string) => [...store.keys()].filter((k) => k.startsWith(prefix)),
  };
  return { store, session: { name: 'Ben', bucket } as unknown as Session };
}

const card = ['IMG_1.JPG', 'BAD.JPG', 'IMG_2.JPG'].map((n) => ({ path: `DCIM/${n}`, file: new File([n], n) }));
const site = { locationID: 'x', locationName: 'X', latitude: 31.5, longitude: -110.5, deploymentGroups: '' };
const lab = { title: 'Lab', timeZone: 'America/Phoenix', shareLicenses: [] };

const send = (session: Session, deploymentID = 'x_2026-11-17', files = card) =>
  sendCard({
    session,
    lab,
    details: Promise.resolve({ site, deploymentID, comments: '' }),
    card: files,
    reads: new Map(),
    onProgress: () => {},
    signal: new AbortController().signal,
  });

beforeEach(() => {
  puts.length = 0;
  frames.length = 0;
  Object.assign(busy, { now: 0, max: 0, files: 0, maxFiles: 0 });
});

describe('sendCard', () => {
  it('leaves out a photo that cannot be decoded, without storing its original', async () => {
    const { store, session } = fakeSession();
    const outcome = await send(session);
    expect(outcome.leftOut).toEqual(['BAD.JPG']);
    expect(outcome.cardHasPhotos).toBe(true);
    expect(puts.some((k) => k.startsWith(`Media/${sha('BAD.JPG')}/`))).toBe(false);
    expect(puts.filter((k) => k.startsWith(`Media/${sha('IMG_1.JPG')}/`))).toHaveLength(3);
    expect(store.get('media.csv')!.trim().split('\n')).toHaveLength(3);
    expect(store.has('datapackage.json')).toBe(true);
  });

  it('still writes datapackage.json when every photo was already saved', async () => {
    const { store, session } = fakeSession();
    await send(session);
    store.delete('datapackage.json');
    puts.length = 0;
    const again = await send(session);
    expect(again.alreadySaved).toEqual(['IMG_1.JPG', 'IMG_2.JPG']);
    expect(again.cardHasPhotos).toBe(true);
    expect(puts).toEqual([]);
    expect(store.has('datapackage.json')).toBe(true);
    expect((await send(session, 'x_2026-11-18')).cardHasPhotos).toBe(false);
  });

  it('finishes without writing a package when a fresh bucket gets no usable photo', async () => {
    const { store, session } = fakeSession();
    const outcome = await send(session, 'x_2026-11-17', card.filter((c) => c.file.name === 'BAD.JPG'));
    expect(outcome.leftOut).toEqual(['BAD.JPG']);
    expect(outcome.cardHasPhotos).toBe(false);
    expect([...store.keys()]).toEqual([]);
  });

  it('uploads a video with its still, its own content type, and a video row', async () => {
    const { store, session } = fakeSession();
    const files = [...card.filter((c) => c.file.name !== 'BAD.JPG'), sized('CLIP_1.MP4', 10), sized('CLIP_2.MOV', 10)];
    const outcome = await send(session, 'x_2026-11-17', files);
    expect(outcome.leftOut).toEqual([]);
    expect(frames.sort()).toEqual(['CLIP_1.MP4', 'CLIP_2.MOV']);
    const mp4 = `Media/${sha('CLIP_1.MP4')}`;
    expect(types.get(`${mp4}/CLIP_1.MP4`)).toBe('video/mp4');
    expect(types.get(`${mp4}/thumb.jpg`)).toBe('image/jpeg');
    expect(types.get(`${mp4}/view.jpg`)).toBe('image/jpeg');
    expect(types.get(`Media/${sha('CLIP_2.MOV')}/CLIP_2.MOV`)).toBe('video/quicktime');
    expect(types.get(`Media/${sha('IMG_1.JPG')}/IMG_1.JPG`)).toBe('image/jpeg');
    const csv = store.get('media.csv')!;
    expect(csv).toContain(',CLIP_1.MP4,video/mp4,');
    expect(csv).toContain(',CLIP_2.MOV,video/quicktime,');
  });

  it('never uploads a video whose camera data could not be removed, and names it apart', async () => {
    const { store, session } = fakeSession();
    const outcome = await send(session, 'x_2026-11-17', [...card, sized('PACKED.MOV', 10)]);
    expect(outcome.notCleaned).toEqual(['PACKED.MOV']);
    expect(outcome.leftOut).toEqual(['BAD.JPG']);
    expect(puts.some((k) => k.includes(sha('PACKED.MOV')))).toBe(false);
    expect(store.get('media.csv')).not.toContain('PACKED.MOV');
  });

  it('leaves out a file over the size limit without reading it, and counts it as done', async () => {
    const { store, session } = fakeSession();
    const done: number[] = [];
    const outcome = await sendCard({
      session,
      lab,
      details: Promise.resolve({ site, deploymentID: 'x_2026-11-17', comments: '' }),
      card: [sized('BIG.MP4', MAX_FILE_BYTES + 1), sized('OK.MP4', MAX_FILE_BYTES)],
      reads: new Map(),
      onProgress: (p) => p.phase === 'sending' && done.push(p.done),
      signal: new AbortController().signal,
    });
    expect(outcome.tooBig).toEqual(['BIG.MP4']);
    expect(outcome.leftOut).toEqual([]);
    expect(puts.some((k) => k.includes(sha('BIG.MP4')))).toBe(false);
    expect(store.get('media.csv')).toContain(',OK.MP4,video/mp4,');
    expect(done.at(-1)).toBe(2);
  });

  it('keeps the bytes of files in flight within the budget, and sends a bigger file alone', async () => {
    const { session } = fakeSession();
    await send(session, 'x_2026-11-17', Array.from({ length: 9 }, (_, i) => sized(`V${i}.MP4`, 64 * MiB)));
    expect(busy.max).toBe(IN_FLIGHT_BYTES);
    expect(busy.maxFiles).toBe(3);

    Object.assign(busy, { max: 0, maxFiles: 0 });
    await send(session, 'x_2026-11-18', [sized('A.MP4', 200 * MiB), sized('B.MP4', 1 * MiB), sized('C.MP4', 250 * MiB)]);
    expect(busy.maxFiles).toBe(1);
    expect(busy.max).toBe(250 * MiB);
  });
});
