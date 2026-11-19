/**
 * A large second card for checking the grid at scale: `count` photo rows whose
 * thumb.jpg and view.jpg are copies of the first card's, under new IDs. No
 * originals are stored; the Tagger never loads them.
 *
 *   SEED_ENDPOINT=… SEED_LOGIN=… SEED_PASSWORD=… pnpm --filter tagger exec vite-node scripts/seed-bulk.ts 5000
 */
import { createHash } from 'node:crypto';
import {
  deploymentId,
  formatInZone,
  instant,
  mergeDeployments,
  mergeMedia,
  readPackage,
  savePackage,
  signIn,
  thumbKey,
  viewKey,
  type Lab,
  type Media,
} from '@sparcd/bucket';

const count = Number(process.argv[2] ?? 5000);
const endpoint = process.env.SEED_ENDPOINT!;
if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) throw new Error('seed-bulk writes test photos; point SEED_ENDPOINT at a local MinIO (localhost or 127.0.0.1).');
const session = await signIn(
  { gate: false, endpoint, region: 'us-east-1', settingsBucket: 'sparcd-next-settings', bucketPrefix: 'sparcd-next-' },
  process.env.SEED_LOGIN!,
  process.env.SEED_PASSWORD!,
);
const lab = JSON.parse((await session.settings.getText('lab.json'))!) as Lab;
const sources = (await readPackage(session.bucket)).media.slice(0, 200);
const images = await Promise.all(
  sources.map(async (m) => ({
    thumb: new Uint8Array(await (await fetch(await session.bucket.presignGet(thumbKey(m.mediaID)))).arrayBuffer()),
    view: new Uint8Array(await (await fetch(await session.bucket.presignGet(viewKey(m.mediaID)))).arrayBuffer()),
  })),
);

const start = instant('2026-05-01T05:00:00-07:00');
const id = deploymentId('cottonwood-tank', '2026-05-04');
const media: Media[] = [];
for (let n = 0; n < count; n += 25) {
  await Promise.all(
    Array.from({ length: Math.min(25, count - n) }, async (_, k) => {
      const i = n + k;
      const mediaID = createHash('sha256').update(`bulk-${i}`).digest('hex');
      const { thumb, view } = images[i % images.length];
      await session.bucket.putObject(thumbKey(mediaID), thumb, { contentType: 'image/jpeg' });
      await session.bucket.putObject(viewKey(mediaID), view, { contentType: 'image/jpeg' });
      media.push({
        mediaID,
        deploymentID: id,
        timestamp: formatInZone(start + i * 60_000, lab.timeZone),
        filePath: `Media/${mediaID}/IMG_${String(i + 1).padStart(4, '0')}.JPG`,
        filePublic: 'true',
        fileName: `IMG_${String(i + 1).padStart(4, '0')}.JPG`,
        fileMediatype: 'image/jpeg',
      });
    }),
  );
}
const times = media.map((m) => m.timestamp).sort((a, b) => instant(a) - instant(b));
const deployment = {
  deploymentID: id,
  locationID: 'cottonwood-tank',
  locationName: 'Cottonwood Tank',
  latitude: '31.6',
  longitude: '-110.4',
  deploymentStart: times[0],
  deploymentEnd: times[times.length - 1],
};
await savePackage(
  session.bucket,
  { deployments: (d) => mergeDeployments(d, [deployment], 'widen'), media: (m) => mergeMedia(m, media) },
  { personName: session.name, lab },
);
console.log(`seeded ${media.length} photos into card ${id}`);
