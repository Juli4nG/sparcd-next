import { describe, expect, it, vi } from 'vitest';
import { serializeTable, type Deployment, type Media, type Observation, type Session } from '@sparcd/bucket';
import { cardSummaries, loadCard, readCards } from '../src/data/card';

const dep = (id: string, end: string, locationID: string, groups = ''): Deployment => ({
  deploymentID: id, locationID, latitude: '1', longitude: '2', deploymentStart: '2026-11-01T06:00:00-07:00', deploymentEnd: end, deploymentGroups: groups,
});
const photo = (mediaID: string, deploymentID: string, timestamp: string, fileName = `${mediaID}.JPG`): Media => ({
  mediaID, deploymentID, timestamp, fileName, filePath: `Media/${mediaID}/${fileName}`, filePublic: 'true', fileMediatype: 'image/jpeg',
});
const obs = (n: number, mediaID: string, deploymentID: string, observationType = 'animal', scientificName = 'Canis latrans'): Observation => ({
  observationID: `${mediaID}-ana-${n}`, deploymentID, mediaID, eventStart: '2026-11-01T06:00:00-07:00', eventEnd: '2026-11-01T06:00:00-07:00',
  observationLevel: 'media', observationType, scientificName, count: '1',
});

const A = dep('juniper_2026-11-01', '2026-11-01T07:00:00-07:00', 'juniper');
const B = dep('juniper_2026-11-10', '2026-11-10T07:00:00-07:00', 'juniper');
const C = dep('owl_2026-11-17', '2026-11-17T07:00:00-07:00', 'owl');
const S = dep('juniper_2026-11-18', '2026-11-18T07:00:00-07:00', 'juniper', 'area: Santa Ritas|share:k3');

const media = [
  photo('m1', A.deploymentID, '2026-11-01T10:00:05-07:00', 'IMG_2.JPG'),
  photo('m2', A.deploymentID, '2026-11-01T10:00:00-07:00', 'IMG_10.JPG'),
  photo('m3', A.deploymentID, '2026-11-01T10:00:00-07:00', 'IMG_2.JPG'),
  photo('m4', B.deploymentID, '2026-11-10T10:00:00-07:00'),
  photo('m5', C.deploymentID, '2026-11-17T10:00:00-07:00'),
  photo('m6', S.deploymentID, '2026-11-18T10:00:00-07:00'),
  photo('m7', 'gone_2026-01-01', '2026-01-01T10:00:00-07:00'),
];
const observations = [
  obs(1, 'm1', A.deploymentID),
  obs(1, 'm2', A.deploymentID, 'blank', ''),
  obs(1, 'm4', B.deploymentID, 'animal', 'Lynx rufus'),
  obs(1, 'm5', C.deploymentID),
];

/** A session whose bucket holds the package; every read is recorded, and settings must never be touched. */
function fakeSession() {
  const files: Record<string, string> = {
    'deployments.csv': serializeTable('deployments', [A, B, C, S]),
    'media.csv': serializeTable('media', media),
    'observations.csv': serializeTable('observations', observations),
  };
  const bucket = {
    name: 'sparcd-next-ana',
    getText: vi.fn(async (key: string) => files[key] ?? null),
    putText: vi.fn(),
    putObject: vi.fn(),
    listKeys: vi.fn(),
    presignGet: vi.fn(),
  };
  const settings = { getText: vi.fn(), listKeys: vi.fn() };
  return { bucket, settings, session: { name: 'Ana', code: 'ana', bucket, settings } as unknown as Session };
}

const readOnlyTheThreeTables = ({ bucket, settings }: ReturnType<typeof fakeSession>) => {
  expect(bucket.getText.mock.calls.map((c) => c[0]).sort()).toEqual(['deployments.csv', 'media.csv', 'observations.csv']);
  for (const fn of [bucket.putText, bucket.putObject, bucket.listKeys, bucket.presignGet, settings.getText, settings.listKeys]) expect(fn).not.toHaveBeenCalled();
};

describe('loadCard', () => {
  it('reads the three CSVs once each and nothing else', async () => {
    const s = fakeSession();
    await loadCard(s.session, A.deploymentID);
    readOnlyTheThreeTables(s);
  });

  it('is null for a card the person does not have, after the same three reads', async () => {
    const s = fakeSession();
    expect(await loadCard(s.session, 'nowhere_2026-01-01')).toBeNull();
    readOnlyTheThreeTables(s);
  });

  it('returns the card\'s photos only, by time, ties by file name in natural order', async () => {
    const { session } = fakeSession();
    const card = (await loadCard(session, A.deploymentID))!;
    expect(card.deployment.deploymentID).toBe(A.deploymentID);
    expect(card.photos.map((p) => p.mediaID)).toEqual(['m3', 'm2', 'm1']);
  });

  it('reads tags for this card\'s photos only', async () => {
    const { session } = fakeSession();
    const card = (await loadCard(session, A.deploymentID))!;
    expect([...card.tags.keys()]).toEqual(['m1', 'm2']);
    expect(card.tags.get('m2')).toEqual([{ key: 'blank', observationType: 'blank', scientificName: '', count: 1 }]);
  });

  it('holds every deployment at the same location as the card, shares included, and all observations', async () => {
    const { session } = fakeSession();
    const card = (await loadCard(session, A.deploymentID))!;
    expect([...card.site.cards].sort()).toEqual([A.deploymentID, B.deploymentID, S.deploymentID]);
    expect(card.site.observations.map((o) => o.mediaID)).toEqual(['m1', 'm2', 'm4', 'm5']);
  });

  it('marks a card copied from a share as not the person\'s own', async () => {
    const { session } = fakeSession();
    expect((await loadCard(session, A.deploymentID))!.own).toBe(true);
    expect((await loadCard(session, S.deploymentID))!.own).toBe(false);
  });
});

describe('readCards', () => {
  it('reads the three CSVs once each and nothing else', async () => {
    const s = fakeSession();
    await readCards(s.bucket as never);
    readOnlyTheThreeTables(s);
  });

  it('counts each own card\'s photos, with "nothing in this photo" counting as tagged', async () => {
    const { bucket } = fakeSession();
    const cards = await readCards(bucket as never);
    expect(cards.map((c) => [c.deployment.deploymentID, c.photos, c.tagged, c.untagged])).toEqual([
      [C.deploymentID, 1, 1, 0],
      [B.deploymentID, 1, 1, 0],
      [A.deploymentID, 3, 2, 1],
    ]);
  });
});

describe('cardSummaries', () => {
  it('lists own cards newest first, leaves out shares and photos of unknown cards, and counts a card with no photos as zero', () => {
    const rows = { deployments: [A, S, B], media: [media[0], media[5], media[6]], observations: [] };
    expect(cardSummaries(rows).map((c) => [c.deployment.deploymentID, c.photos, c.tagged, c.untagged])).toEqual([
      [B.deploymentID, 0, 0, 0],
      [A.deploymentID, 1, 0, 1],
    ]);
  });
});
