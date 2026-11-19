import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readPackage, savePackage, signIn, type Deployment, type Lab, type Media, type Session } from '@sparcd/bucket';
import { fakeS3 } from '../../../packages/bucket/test/fakeS3';
import { saveTags, type Card } from '../src/data/card';
import { linkExpired } from '../src/data/share';
import type { PhotoTag } from '../src/data/tags';

const lab: Lab = { title: 'Example Lab', timeZone: 'America/Phoenix', shareLicenses: [] };
const about = { personName: 'Ana', lab };
const s3 = fakeS3();
let session: Session;

const id = 'juniper-draw_2026-11-17';
const deployment = (groups: string): Deployment => ({
  deploymentID: id, locationID: 'juniper-draw', latitude: '12.3', longitude: '-98.8', deploymentGroups: groups,
  deploymentStart: '2026-11-02T06:00:00-07:00', deploymentEnd: '2026-11-17T07:00:00-07:00',
});
const photo = (c: string, filePath: string): Media => ({
  mediaID: c.repeat(64), deploymentID: id, timestamp: '2026-11-02T06:00:00-07:00', filePath, filePublic: 'true', fileMediatype: 'image/jpeg',
});
const mine = photo('a', `Media/${'a'.repeat(64)}/original.jpg`);
const copied = photo('b', 'https://server.example.org/sparcd-next-olive/Media/b/view.jpg?X-Amz-Signature=0');
const human: PhotoTag[] = [{ key: 'Homo sapiens', observationType: 'human', scientificName: 'Homo sapiens', count: 1 }];

beforeAll(async () => {
  vi.stubGlobal('fetch', s3.fetch);
  session = await signIn({ gate: true, endpoint: 'https://server.example.org', region: 'us-east-1' }, 'ana', 'pw');
});
afterAll(() => vi.unstubAllGlobals());

describe('saving tags on a shared card', () => {
  it('decides ownership per photo, even when the shared card has the same id as one of the person\'s own', async () => {
    await savePackage(session.bucket, { deployments: () => [deployment('')], media: () => [mine] }, about);
    const card: Card = { deployment: deployment('share:k3'), photos: [copied], tags: new Map(), own: false, imageUrl: async () => '' };
    await saveTags(session, about, card, [copied.mediaID], () => human, () => '2026-11-19T09:00:00-07:00');
    const own: Card = { ...card, deployment: deployment(''), photos: [mine], own: true };
    await saveTags(session, about, own, [mine.mediaID], () => human, () => '2026-11-19T09:00:00-07:00');

    const rows = await readPackage(session.bucket);
    expect(rows.deployments.map((d) => d.deploymentGroups)).toEqual(['']);
    expect(rows.media.map((m) => [m.mediaID[0], m.filePublic])).toEqual([['a', 'false'], ['b', 'true']]);
    expect(rows.observations).toHaveLength(2);
  });

  it('reads expiry from the link itself', () => {
    const link = 'https://x/s/datapackage.json?X-Amz-Date=20261119T160000Z&X-Amz-Expires=604800&X-Amz-Signature=0';
    expect(linkExpired(link, Date.parse('2026-11-26T15:59:59Z'))).toBe(false);
    expect(linkExpired(link, Date.parse('2026-11-26T16:00:01Z'))).toBe(true);
  });
});
