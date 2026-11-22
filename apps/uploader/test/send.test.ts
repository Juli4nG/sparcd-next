import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@sparcd/bucket';
import { sendCard } from '../src/send/send';

const sha = (name: string) => createHash('sha256').update(name).digest('hex');

vi.mock('../src/send/pool', () => ({
  createPool: () => ({
    read: async (file: File) => ({ sha256: sha(file.name), dateTimeOriginal: '2026:11:17 10:00:00' }),
    derive: async (file: File) => {
      if (file.name === 'BAD.JPG') throw Object.assign(new Error('The source image could not be decoded.'), { name: 'InvalidStateError' });
      return { thumb: new ArrayBuffer(1), thumbSha256: 't', view: new ArrayBuffer(1), viewSha256: 'v', original: new ArrayBuffer(1), originalSha256: 'o' };
    },
    close: () => {},
  }),
}));

// Photos go through the shards, not the bucket; keep what they were given.
const puts: string[] = [];
vi.mock('../src/send/shards', () => ({
  openShards: async () => ({
    live: () => 1,
    put: async (key: string) => void puts.push(key),
  }),
}));

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

const send = (session: Session, deploymentID = 'x_2026-11-17') =>
  sendCard({
    session,
    lab,
    details: Promise.resolve({ site, deploymentID, comments: '' }),
    card,
    reads: new Map(),
    onProgress: () => {},
    signal: new AbortController().signal,
  });

beforeEach(() => void (puts.length = 0));

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
    expect(again.alreadySaved).toBe(2);
    expect(again.cardHasPhotos).toBe(true);
    expect(puts).toEqual([]);
    expect(store.has('datapackage.json')).toBe(true);
    expect((await send(session, 'x_2026-11-18')).cardHasPhotos).toBe(false);
  });
});
