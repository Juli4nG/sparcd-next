// Runs an Uploader and a Tagger session against the fake S3 and writes the
// resulting package to SAMPLE_PACKAGE_DIR (default: <tmp>/sparcd-bucket-sample)
// so it can be checked with `uvx frictionless validate <dir>/datapackage.json`.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyFilePublic, cameraTime, deploymentId, ESTIMATED_TIME_COMMENT, estimateTimes, mergeDeployments, mergeMedia,
  originalKey, parseSites, readPackage, replaceObservations, savePackage, signIn, tagRows, timeRange, writeShare,
  type Deployment, type Lab, type Media, type Session, type Site, type Tag,
} from '../src';
import { fakeS3 } from './fakeS3';

const lab: Lab = {
  title: 'Example Wildlife Lab',
  timeZone: 'America/Phoenix',
  shareLicenses: [
    { name: 'CC-BY-NC-4.0', path: 'https://creativecommons.org/licenses/by-nc/4.0/', scope: 'data' },
    { name: 'CC-BY-NC-4.0', path: 'https://creativecommons.org/licenses/by-nc/4.0/', scope: 'media' },
  ],
};
const sites = parseSites(
  'locationID,locationName,latitude,longitude,deploymentGroups\n' +
    'juniper-draw,Juniper Draw,12.34567,-98.76543,area:East Range\n' +
    'mesa-top,"Mesa Top, north",12.40001,-98.70001,\n',
);
const about = { personName: 'Ana', lab };
const s3 = fakeS3();
const sampleDir = process.env.SAMPLE_PACKAGE_DIR ?? join(tmpdir(), 'sparcd-bucket-sample');
let session: Session;

beforeAll(async () => {
  vi.stubGlobal('fetch', s3.fetch);
  session = await signIn({ gate: true, endpoint: 'https://server.example.org', region: 'us-east-1' }, 'ana', 'pw');
});
afterAll(() => vi.unstubAllGlobals());

type CardPhoto = { name: string; exif?: string; offset?: string };

/** What the Uploader does with one card once its photo files are stored. */
async function uploadCard(site: Site, cardDate: string, photos: CardPhoto[]) {
  const shots = photos.map((p) => {
    const id = createHash('sha256').update(`${site.locationID}/${p.name}`).digest('hex');
    return { id, name: p.name, timestamp: cameraTime(p.exif, p.offset, lab.timeZone), lastModified: 0 };
  });
  const estimates = estimateTimes(shots, lab.timeZone);
  const deploymentID = deploymentId(site.locationID, cardDate);
  const media: Media[] = shots.map((s) => ({
    mediaID: s.id,
    deploymentID,
    timestamp: s.timestamp ?? estimates.get(s.id)!,
    filePath: originalKey(s.id, s.name.split('/').pop()!),
    filePublic: 'true',
    fileName: s.name.split('/').pop()!,
    fileMediatype: 'image/jpeg',
    mediaComments: s.timestamp ? '' : ESTIMATED_TIME_COMMENT,
  }));
  const [deploymentStart, deploymentEnd] = timeRange(media.map((m) => m.timestamp));
  const deployment: Deployment = {
    deploymentID, locationID: site.locationID, locationName: site.locationName,
    latitude: String(site.latitude), longitude: String(site.longitude), deploymentGroups: site.deploymentGroups,
    deploymentStart, deploymentEnd, cameraModel: 'Acme-TrailCam 2',
  };
  return savePackage(session.bucket, {
    deployments: (rows) => mergeDeployments(rows, [deployment], 'widen'),
    media: (rows) => mergeMedia(rows, media),
  }, about);
}

/** What the Tagger does when the owner saves one photo's tags. */
function tagPhoto(media: Media, tags: Tag[]) {
  const rows = tagRows(media, tags, 'ana', { timestamp: '2026-11-19T09:00:00-07:00' });
  return savePackage(session.bucket, {
    media: (current) => applyFilePublic(current, rows, [media.mediaID]),
    observations: (current) => replaceObservations(current, [media.mediaID], rows),
  }, about);
}

describe('a sample package', () => {
  it('writes package files in order, observations header-only on the first write', async () => {
    await uploadCard(sites[0], '2026-11-17', [
      { name: 'DCIM/100ACME/IMG_0001.JPG', exif: '2026:11:02 06:15:03' },
      { name: 'DCIM/100ACME/IMG_0002.JPG', exif: '2026:11:02 06:15:04' },
      { name: 'DCIM/100ACME/IMG_0003.JPG' },
      { name: 'DCIM/100ACME/IMG_0004.JPG', exif: '2026:11:09 21:40:10' },
      { name: 'DCIM/100ACME/IMG_0010.JPG', exif: '2026:11:17 07:02:00', offset: '-07:00' },
      { name: 'DCIM/100ACME/thumb.jpg', exif: '2026:11:17 07:05:00' },
    ]);
    const puts = s3.requests.filter((r) => r.method === 'PUT').map((r) => r.url.pathname.split('/').pop());
    expect(puts).toEqual(['deployments.csv', 'media.csv', 'observations.csv', 'datapackage.json']);
    expect(s3.text('sparcd-next-ana/observations.csv').trim().split('\n')).toHaveLength(1);
  });

  it('adds a second card and the owner tags', async () => {
    await uploadCard(sites[1], '2026-11-18', [
      { name: 'DCIM/IMG_0001.JPG', exif: '2026:11:05 12:00:00' },
      { name: 'DCIM/IMG_0002.JPG', exif: '2026:11:05 12:00:30' },
      { name: 'DCIM/IMG_0003.JPG', exif: '2026:11:06 18:20:00' },
      { name: 'DCIM/IMG_0004.JPG', exif: '2026:11:18 08:00:00' },
    ]);
    const { media } = await readPackage(session.bucket);
    expect(media).toHaveLength(10);
    await tagPhoto(media[0], [{ observationType: 'animal', scientificName: 'Lynx rufus', count: 1 }]);
    await tagPhoto(media[1], [{ observationType: 'human', scientificName: 'Homo sapiens' }, { observationType: 'animal', scientificName: 'Canis latrans', count: 2 }]);
    await tagPhoto(media[2], [{ observationType: 'unknown' }]);
    const rows = await tagPhoto(media[6], [{ observationType: 'blank' }]);

    expect(rows.observations).toHaveLength(5);
    expect(rows.media.find((m) => m.mediaID === media[1].mediaID)!.filePublic).toBe('false');
    expect(rows.media.filter((m) => m.mediaComments === ESTIMATED_TIME_COMMENT)).toHaveLength(1);
    expect(rows.media.find((m) => m.fileName === 'thumb.jpg')!.filePath).toMatch(/\/original-thumb\.jpg$/);
    const dp = JSON.parse(s3.text('sparcd-next-ana/datapackage.json'));
    expect(dp.temporal).toEqual({ start: '2026-11-02', end: '2026-11-18' });
    expect(dp.spatial.type).toBe('Polygon');

    mkdirSync(sampleDir, { recursive: true });
    for (const name of ['datapackage.json', 'deployments.csv', 'media.csv', 'observations.csv']) {
      writeFileSync(join(sampleDir, name), s3.objects.get(`sparcd-next-ana/${name}`)!.body);
    }
  });

  it('generates a share package', async () => {
    const share = {
      id: 'k3k3k3k3k3k3k3k3k3k3k3k3k3', createdAt: '2026-11-19T09:00:00-07:00', expiresAt: '2026-11-26T09:00:00-07:00',
      deploymentIDs: ['juniper-draw_2026-11-17'], positionDecimals: 1, image: 'view' as const,
    };
    const url = new URL(await writeShare(session.bucket, share, about));
    expect(url.pathname).toBe(`/sparcd-next-ana/shared/${share.id}/datapackage.json`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('604800');
    const dp = JSON.parse(s3.text(`sparcd-next-ana/shared/${share.id}/datapackage.json`));
    expect(dp.licenses).toHaveLength(2);
    expect(dp.spatial).toEqual({ type: 'Point', coordinates: [-98.8, 12.3] });
    const media = s3.text(`sparcd-next-ana/shared/${share.id}/media.csv`).trim().split('\n');
    expect(media).toHaveLength(6); // header + the 5 public photos of that card
    expect(Object.keys(JSON.parse(s3.text(`sparcd-next-ana/shared/${share.id}/thumbs.json`)))).toHaveLength(5);
    mkdirSync(join(sampleDir, 'share'), { recursive: true });
    writeFileSync(join(sampleDir, 'share', 'datapackage.json'), JSON.stringify(dp, null, 2));
  });
});
