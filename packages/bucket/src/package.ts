import { parseTable, serializeTable, type PackageRows, type Table } from './csv';
import { buildDatapackage } from './datapackage';
import { newShareId, thumbKey } from './ids';
import { shareTables, type ShareRecipe } from './rows';
import type { Lab } from './settings';
import type { Bucket } from './storage';
import { formatInZone } from './times';

export type About = { personName: string; lab: Lab };

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** One writer per bucket across this browser's tabs (the Uploader and the Tagger share an origin). */
const exclusive = <T>(bucket: Bucket, fn: () => Promise<T>): Promise<T> =>
  globalThis.navigator?.locks ? (navigator.locks.request(`sparcd-next:${bucket.name}`, fn) as Promise<T>) : fn();

export async function readTable<T extends Table>(bucket: Bucket, table: T): Promise<PackageRows[T]> {
  const text = await bucket.getText(`${table}.csv`);
  return text === null ? ([] as unknown as PackageRows[T]) : parseTable(table, text);
}

export async function readPackage(bucket: Bucket): Promise<PackageRows> {
  const [deployments, media, observations] = await Promise.all([
    readTable(bucket, 'deployments'),
    readTable(bucket, 'media'),
    readTable(bucket, 'observations'),
  ]);
  return { deployments, media, observations };
}

export type Changes = { [T in Table]?: (current: PackageRows[T]) => PackageRows[T] };

/** Re-read, merge, write the whole file. A missing file is written even without a change. */
async function saveTable<T extends Table>(bucket: Bucket, table: T, change?: (current: PackageRows[T]) => PackageRows[T]) {
  const text = await bucket.getText(`${table}.csv`);
  const current = text === null ? ([] as unknown as PackageRows[T]) : parseTable(table, text);
  const rows = change ? change(current) : current;
  if (change || text === null) await bucket.putText(`${table}.csv`, serializeTable(table, rows));
  return rows;
}

/**
 * The one write path for package files: deployments, media, observations
 * (each re-read just before its merge), then datapackage.json. Photo files
 * must already be stored. Returns the rows as written.
 */
export function savePackage(bucket: Bucket, changes: Changes, about: About): Promise<PackageRows> {
  return exclusive(bucket, async () => {
    const deployments = await saveTable(bucket, 'deployments', changes.deployments);
    const media = await saveTable(bucket, 'media', changes.media);
    const observations = await saveTable(bucket, 'observations', changes.observations);
    const datapackage = buildDatapackage({ name: bucket.name, ...about, deployments, observations });
    await bucket.putText('datapackage.json', json(datapackage));
    return { deployments, media, observations };
  });
}

const WEEK = 604_800;

/**
 * Generates `shared/<id>/` from the owner's current rows and returns the signed URL of
 * its datapackage.json. The link to hand out is
 * `<origin>/tag/#share=<encodeURIComponent(url)>`.
 */
export function writeShare(bucket: Bucket, share: ShareRecipe, about: About): Promise<string> {
  return exclusive(bucket, async () => writeShareFiles(bucket, await readPackage(bucket), share, about));
}

async function writeShareFiles(bucket: Bucket, rows: PackageRows, share: ShareRecipe, about: About): Promise<string> {
  const dir = `shared/${share.id}`;
  const sign = (key: string) => bucket.presignGet(key, { expiresSeconds: WEEK });
  const tables = shareTables(rows, share);
  const thumbs: Record<string, string> = {};
  for (const m of tables.media) {
    m.filePath = await sign(m.filePath);
    thumbs[m.mediaID] = await sign(thumbKey(m.mediaID));
  }
  const tableNames: Table[] = ['deployments', 'media', 'observations'];
  const sharePaths = {} as Record<Table, string>;
  for (const table of tableNames) {
    await bucket.putText(`${dir}/${table}.csv`, serializeTable(table, tables[table]));
    sharePaths[table] = await sign(`${dir}/${table}.csv`);
  }
  await bucket.putText(`${dir}/thumbs.json`, json(thumbs));
  const shareThumbs = await sign(`${dir}/thumbs.json`);
  const name = `${bucket.name}-share-${share.id}`;
  const datapackage = buildDatapackage({ name, ...about, ...tables, sharePaths, shareThumbs });
  await bucket.putText(`${dir}/datapackage.json`, json(datapackage));
  return sign(`${dir}/datapackage.json`);
}

/**
 * Shares one card for 7 days: writes its share package and appends a recipe to
 * `shares.json`, under the same lock as package saves. Returns the signed URL
 * of the share's datapackage.json.
 */
export function createShare(bucket: Bucket, deploymentID: string, about: About, now = Date.now()): Promise<string> {
  return exclusive(bucket, async () => {
    const at = (ms: number) => formatInZone(ms, about.lab.timeZone);
    const share: ShareRecipe = {
      id: newShareId(),
      createdAt: at(now),
      expiresAt: at(now + WEEK * 1000),
      deploymentIDs: [deploymentID],
      positionDecimals: 1,
      image: 'view',
    };
    const { shares } = JSON.parse((await bucket.getText('shares.json')) ?? '{"shares":[]}') as { shares: ShareRecipe[] };
    const url = await writeShareFiles(bucket, await readPackage(bucket), share, about);
    await bucket.putText('shares.json', json({ shares: [...shares, share] }));
    return url;
  });
}
