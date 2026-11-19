/**
 * Local test data for the Tagger, until the Uploader can write it: a settings
 * bucket and one person's bucket holding one card as a Camtrap DP package,
 * with thumb.jpg and view.jpg made the way the Uploader makes them.
 *
 *   SEED_ENDPOINT=http://127.0.0.1:9310 SEED_LOGIN=ana SEED_PASSWORD=… \
 *   pnpm --filter tagger seed <card folder> <species.json>
 *
 * The login must be allowed to create buckets (MinIO's root user, no gate).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { AwsClient } from 'aws4fetch';
import {
  cameraTime,
  deploymentId,
  estimateTimes,
  ESTIMATED_TIME_COMMENT,
  localDate,
  instant,
  mergeDeployments,
  mergeMedia,
  originalKey,
  savePackage,
  sha256Hex,
  signIn,
  thumbKey,
  timeRange,
  viewKey,
  type Lab,
  type Media,
  type Shot,
} from '@sparcd/bucket';

const [cardDir, speciesFile] = process.argv.slice(2);
const endpoint = process.env.SEED_ENDPOINT!;
const login = process.env.SEED_LOGIN!;
const password = process.env.SEED_PASSWORD!;
const region = 'us-east-1';

const lab: Lab = { title: 'Example Wildlife Lab', timeZone: 'America/Phoenix', shareLicenses: [] };
const sites = [
  { locationID: 'juniper-draw', locationName: 'Juniper Draw', latitude: '31.5', longitude: '-110.5', deploymentGroups: 'area:East Range' },
  { locationID: 'cottonwood-tank', locationName: 'Cottonwood Tank', latitude: '31.6', longitude: '-110.4', deploymentGroups: '' },
];
const TYPES: Record<string, string> = { Casper: 'blank', 'Homo sapiens': 'human', Incognita: 'unknown' };

const aws = new AwsClient({ accessKeyId: login, secretAccessKey: password, service: 's3', region });

async function createBucket(name: string) {
  const res = await aws.fetch(`${endpoint}/${name}`, { method: 'PUT' });
  if (!res.ok && res.status !== 409) throw new Error(`create ${name}: ${res.status} ${await res.text()}`);
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function main() {
  await createBucket('sparcd-next-settings');
  await createBucket(`sparcd-next-${login}`);
  const session = await signIn({ gate: false, endpoint, region, settingsBucket: 'sparcd-next-settings', bucketPrefix: 'sparcd-next-' }, login, password);

  const species = JSON.parse(await readFile(speciesFile, 'utf8')) as Record<string, unknown>[];
  const typed = species.map((s) => (TYPES[String(s.scientificName)] ? { ...s, observationType: TYPES[String(s.scientificName)] } : s));
  await session.settings.putText('lab.json', `${JSON.stringify(lab, null, 2)}\n`);
  await session.settings.putText('species.json', `${JSON.stringify(typed, null, 2)}\n`);
  const columns = Object.keys(sites[0]);
  await session.settings.putText('sites.csv', [columns.join(','), ...sites.map((s) => Object.values(s).join(','))].join('\n') + '\n');

  const dir = join(cardDir, 'DCIM', '100RECNX');
  const names = (await readdir(dir)).filter((n) => /\.jpe?g$/i.test(n));
  const shots: (Shot & { fileName: string; make?: string })[] = [];
  await inBatches(names, 8, async (fileName) => {
    const bytes = new Uint8Array(await readFile(join(dir, fileName)));
    const id = await sha256Hex(bytes);
    const exif = await exifr.parse(bytes, { reviveValues: false, pick: ['DateTimeOriginal', 'OffsetTimeOriginal', 'Make', 'Model'] }).catch(() => undefined);
    const thumb = await sharp(bytes).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    const view = await sharp(bytes).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    await session.bucket.putObject(originalKey(id, fileName), bytes, { contentType: 'image/jpeg', sha256: id });
    await session.bucket.putObject(thumbKey(id), new Uint8Array(thumb), { contentType: 'image/jpeg' });
    await session.bucket.putObject(viewKey(id), new Uint8Array(view), { contentType: 'image/jpeg' });
    shots.push({
      id,
      name: fileName,
      fileName,
      timestamp: cameraTime(exif?.DateTimeOriginal, exif?.OffsetTimeOriginal, lab.timeZone),
      lastModified: Date.now(),
      make: exif?.Make && exif?.Model ? `${exif.Make}-${exif.Model}` : undefined,
    });
  });

  const estimates = estimateTimes(shots, lab.timeZone);
  const times = shots.map((s) => s.timestamp ?? estimates.get(s.id)!);
  const [start, end] = timeRange(times);
  const site = sites[0];
  const deployment = {
    deploymentID: deploymentId(site.locationID, localDate(instant(end), lab.timeZone)),
    locationID: site.locationID,
    locationName: site.locationName,
    latitude: site.latitude,
    longitude: site.longitude,
    deploymentStart: start,
    deploymentEnd: end,
    cameraModel: shots.find((s) => s.make)?.make ?? '',
    deploymentGroups: site.deploymentGroups,
  };
  const media: Media[] = shots.map((s, i) => ({
    mediaID: s.id,
    deploymentID: deployment.deploymentID,
    timestamp: times[i],
    filePath: originalKey(s.id, s.fileName),
    filePublic: 'true',
    fileName: s.fileName,
    fileMediatype: 'image/jpeg',
    mediaComments: s.timestamp ? '' : ESTIMATED_TIME_COMMENT,
  }));
  await savePackage(
    session.bucket,
    { deployments: (d) => mergeDeployments(d, [deployment], 'widen'), media: (m) => mergeMedia(m, media) },
    { personName: session.name, lab },
  );
  console.log(`seeded ${media.length} photos into card ${deployment.deploymentID}`);
}

await main();
