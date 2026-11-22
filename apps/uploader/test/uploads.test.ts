import { describe, expect, it, vi } from 'vitest';
import { serializeTable, type Bucket, type Deployment, type Media, type Observation } from '@sparcd/bucket';
import { ownUploads, readUploads } from '../src/uploads';

const dep = (id: string, end: string, groups = ''): Deployment => ({
  deploymentID: id,
  latitude: '1',
  longitude: '2',
  deploymentStart: '2026-11-01T06:00:00-07:00',
  deploymentEnd: end,
  deploymentGroups: groups,
});
const media = (mediaID: string, deploymentID: string): Media => ({
  mediaID,
  deploymentID,
  timestamp: '2026-11-01T06:00:00-07:00',
  filePath: `Media/${mediaID}/x.jpg`,
  filePublic: 'true',
  fileMediatype: 'image/jpeg',
});
const obs = (n: number, mediaID: string, deploymentID: string): Observation => ({
  observationID: `${deploymentID}-${n}`,
  deploymentID,
  mediaID,
  eventStart: '2026-11-01T06:00:00-07:00',
  eventEnd: '2026-11-01T06:00:00-07:00',
  observationLevel: 'media',
  observationType: 'animal',
});

const old = dep('a_2026-11-01', '2026-11-01T07:00:00-07:00');
const mid = dep('b_2026-11-10', '2026-11-10T07:00:00-07:00', 'area: Santa Ritas');
const newest = dep('c_2026-11-17', '2026-11-17T07:00:00-07:00');
const shared = dep('d_2026-11-18', '2026-11-18T07:00:00-07:00', 'area: Santa Ritas|share:k3');

/** A bucket whose files arrive when the test says so; every read is recorded. */
function fakeBucket() {
  const files: Record<string, (text: string | null) => void> = {};
  const reads: string[] = [];
  const bucket = {
    name: 'sparcd-next-ana',
    getText: vi.fn((key: string) => {
      reads.push(key);
      return new Promise<string | null>((resolve) => (files[key] = resolve));
    }),
    putText: vi.fn(),
    putObject: vi.fn(),
    listKeys: vi.fn(),
  };
  return { bucket: bucket as unknown as Bucket & typeof bucket, files, reads };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('readUploads', () => {
  it('reads deployments.csv, media.csv and observations.csv once each, all started together, and writes nothing', () => {
    const { bucket, reads } = fakeBucket();
    readUploads(bucket);
    expect(reads).toEqual(['deployments.csv', 'media.csv', 'observations.csv']);
    expect(bucket.putText).not.toHaveBeenCalled();
    expect(bucket.putObject).not.toHaveBeenCalled();
    expect(bucket.listKeys).not.toHaveBeenCalled();
  });

  it('hands over the uploads as soon as deployments.csv arrives, before the other two files', async () => {
    const { bucket, files, reads } = fakeBucket();
    const { uploads, counts } = readUploads(bucket);
    let countsDone = false;
    void counts.then(() => (countsDone = true));
    files['deployments.csv'](serializeTable('deployments', [old, newest]));
    expect((await uploads).map((d) => d.deploymentID)).toEqual(['c_2026-11-17', 'a_2026-11-01']);
    await tick();
    expect(countsDone).toBe(false);
    files['media.csv'](serializeTable('media', []));
    files['observations.csv'](serializeTable('observations', []));
    await counts;
    expect(reads).toHaveLength(3);
  });

  it('counts each upload\'s photos, and a photo with any observation row is tagged once', async () => {
    const { bucket, files } = fakeBucket();
    const { counts } = readUploads(bucket);
    files['deployments.csv'](serializeTable('deployments', [old, mid, newest]));
    files['media.csv'](
      serializeTable('media', [media('m1', old.deploymentID), media('m2', old.deploymentID), media('m3', old.deploymentID), media('m4', mid.deploymentID), media('m5', 'gone_2026-01-01')]),
    );
    files['observations.csv'](
      serializeTable('observations', [obs(1, 'm1', old.deploymentID), obs(2, 'm1', old.deploymentID), obs(1, 'm2', old.deploymentID), obs(1, 'm9', 'gone_2026-01-01')]),
    );
    expect([...(await counts)]).toEqual([
      ['c_2026-11-17', { photos: 0, tagged: 0 }],
      ['b_2026-11-10', { photos: 1, tagged: 0 }],
      ['a_2026-11-01', { photos: 3, tagged: 2 }],
    ]);
  });

  it('leaves out rows copied from a share, in the list and in the counts', async () => {
    const { bucket, files } = fakeBucket();
    const { uploads, counts } = readUploads(bucket);
    files['deployments.csv'](serializeTable('deployments', [old, shared]));
    files['media.csv'](serializeTable('media', [media('m1', old.deploymentID), media('m2', shared.deploymentID)]));
    files['observations.csv'](serializeTable('observations', [obs(1, 'm2', shared.deploymentID)]));
    expect((await uploads).map((d) => d.deploymentID)).toEqual(['a_2026-11-01']);
    expect([...(await counts).keys()]).toEqual(['a_2026-11-01']);
  });

  it('treats files that do not exist yet as no uploads', async () => {
    const { bucket, files } = fakeBucket();
    const { uploads, counts } = readUploads(bucket);
    for (const key of ['deployments.csv', 'media.csv', 'observations.csv']) files[key](null);
    expect(await uploads).toEqual([]);
    expect([...(await counts)]).toEqual([]);
  });
});

describe('ownUploads', () => {
  it('drops shares and sorts by the end of the deployment, newest first', () => {
    expect(ownUploads([old, shared, newest, mid]).map((d) => d.deploymentID)).toEqual(['c_2026-11-17', 'b_2026-11-10', 'a_2026-11-01']);
  });

  it('recognizes a share marker among other groups, with or without spaces', () => {
    const groups = ['share:k', 'area: X|share:k', 'area: X| share:k', 'a|b|share:k'];
    for (const g of groups) expect(ownUploads([dep('x_2026-01-01', '2026-01-01T07:00:00-07:00', g)])).toEqual([]);
    for (const g of ['', 'area: share:x', 'area: Santa Ritas|trail']) expect(ownUploads([dep('x_2026-01-01', '2026-01-01T07:00:00-07:00', g)])).toHaveLength(1);
  });
});
