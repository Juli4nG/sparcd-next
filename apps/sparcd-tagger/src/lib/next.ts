// The bridge from this Tagger's per-upload SPARC'd files to the SPARC'd Next
// storage (docs/next/FORMAT.md). The person's bucket is the one collection,
// each deployment is one "upload", and the upload's media.csv /
// observations.csv / deployments.csv / UploadMeta.json are generated from the
// package on read. A write of observations.csv becomes one package save; the
// other files are derived, so their writes are accepted and dropped.

import {
  applyFilePublic,
  instant,
  loadConfig,
  nowTimestamp,
  parseLab,
  parseSpecies as parseNextSpecies,
  readPackage,
  replaceObservations,
  restoreSession,
  savePackage,
  signIn,
  thumbKey,
  viewKey,
  S3Error,
  type About,
  type Config,
  type Media as NextMedia,
  type ObservationType,
  type PackageRows,
  type Session,
  type Tag,
  tagRows,
} from '@sparcd/bucket';
import {
  buildUploadMeta,
  parseObservations,
  serializeDeployments,
  serializeMedia,
  serializeObservations,
  serializeUploadMeta,
  type Observation as OldObservation,
} from '@sparcd/camtrap';
import type { ConnectionProbeResult, S3Config } from '@sparcd/types';

export const COLLECTION_UUID = 'next';
const UPLOADS = `Collections/${COLLECTION_UUID}/Uploads/`;

let session: Session | null = null;
let config: Config | null = null;

const gateConfig = (): Config => config ?? { gate: true, endpoint: location.origin, region: 'us-east-1' };

export function currentSession(): Session {
  if (!session) throw new Error('Not signed in.');
  return session;
}

export const hasSession = () => session !== null;

/** The Connection screen's credential check: access key = login, secret key = password. */
export async function testSignIn(cfg: S3Config): Promise<ConnectionProbeResult> {
  try {
    session = await signIn(gateConfig(), cfg.accessKey, cfg.secretKey);
    clearPackageCache();
    return { ok: true };
  } catch (err) {
    if (err instanceof S3Error && err.status === 403) return { ok: false, category: 'credentials-rejected' };
    if (err instanceof S3Error) return { ok: false, category: 'unexpected', detail: `HTTP ${err.status}` };
    return { ok: false, category: 'unreachable' };
  }
}

/** Reload keeps the person signed in for this tab. */
export async function restore(): Promise<boolean> {
  try {
    config = await loadConfig();
  } catch {
    config = null;
  }
  session = await restoreSession(gateConfig()).catch(() => null);
  return session !== null;
}

export function forget(): void {
  session = null;
  clearPackageCache();
}

// --- Package reads ---------------------------------------------------------

let packageRead: { at: number; rows: Promise<PackageRows> } | null = null;

/** One read serves the burst of per-card queries that follow a page load. */
export function packageRows(): Promise<PackageRows> {
  if (packageRead && Date.now() - packageRead.at < 3000) return packageRead.rows;
  const rows = readPackage(currentSession().bucket);
  packageRead = { at: Date.now(), rows };
  rows.catch(() => { if (packageRead?.rows === rows) packageRead = null; });
  return rows;
}

export function clearPackageCache(): void {
  packageRead = null;
}

let speciesText: Promise<string> | null = null;
export function speciesJson(): Promise<string> {
  speciesText ??= currentSession().settings.getText('species.json').then((t) => t ?? '[]');
  speciesText.catch(() => { speciesText = null; });
  return speciesText;
}

async function speciesTypes(): Promise<Map<string, { name: string; type: ObservationType }>> {
  return new Map(parseNextSpecies(await speciesJson()).map((s) => [s.scientificName, { name: s.name, type: s.observationType ?? 'animal' }]));
}

let about: Promise<About> | null = null;
function aboutPerson(): Promise<About> {
  const s = currentSession();
  about ??= s.settings.getText('lab.json').then((lab) => ({ personName: s.name, lab: parseLab(lab!) }));
  about.catch(() => { about = null; });
  return about;
}

// --- Collection and uploads ------------------------------------------------

export const uploadPrefixOf = (deploymentID: string) => `${UPLOADS}${deploymentID}/`;
export const deploymentOf = (uploadPrefix: string) => uploadPrefix.slice(UPLOADS.length).replace(/\/$/, '');

/** The derived image that stands in for a media key: the thumbnail in grids, the 1600 px view otherwise. */
export function presignMedia(key: string, size: 'thumb' | 'view'): Promise<string> {
  const sha = key.split('/')[1];
  return currentSession().bucket.presignGet(size === 'thumb' ? thumbKey(sha) : viewKey(sha), { hourStable: true });
}

const byTime = (a: NextMedia, b: NextMedia) =>
  instant(a.timestamp) - instant(b.timestamp) || (a.fileName ?? '').localeCompare(b.fileName ?? '', 'en', { numeric: true });

export type UploadFiles = { media: string; observations: string; deployments: string; uploadMeta: string };

/** The four per-upload files the Tag workspace grounds on, generated from the package. */
export async function uploadFiles(uploadPrefix: string): Promise<UploadFiles> {
  const rows = await packageRows();
  const types = await speciesTypes();
  const ghost = [...types].find(([, s]) => s.type === 'blank');
  const unknown = [...types].find(([, s]) => s.type === 'unknown');
  const id = deploymentOf(uploadPrefix);
  const deployment = rows.deployments.find((d) => d.deploymentID === id);
  const photos = rows.media.filter((m) => m.deploymentID === id).sort(byTime);
  const keyOf = new Map(photos.map((m) => [m.mediaID, m.filePath]));
  const observations: OldObservation[] = rows.observations
    .filter((o) => keyOf.has(o.mediaID))
    .map((o) => {
      const scientificName = o.observationType === 'blank' ? ghost?.[0] ?? 'Casper'
        : o.observationType === 'unknown' ? unknown?.[0] ?? 'Incognita' : o.scientificName ?? '';
      const name = types.get(scientificName)?.name;
      return {
        observationId: o.observationID,
        mediaId: keyOf.get(o.mediaID)!,
        deploymentId: id,
        timestamp: o.eventStart ?? '',
        observationType: 'animal',
        scientificName,
        count: Number(o.count) || 1,
        tags: name ? `[COMMONNAME:${name}]` : '',
        classifiedBy: o.classifiedBy || undefined,
        classificationTimestamp: o.classificationTimestamp || undefined,
      };
    });
  const tagged = new Set(observations.map((o) => o.mediaId)).size;
  const session = currentSession();
  return {
    media: serializeMedia(photos.map((m) => ({
      mediaId: m.filePath,
      deploymentId: id,
      mediaPath: m.filePath,
      fileName: m.fileName ?? '',
      timestamp: m.timestamp,
      mimeType: m.fileMediatype ?? 'image/jpeg',
      comments: '',
    }))),
    observations: lastWrittenFor(uploadPrefix, serializeObservations(observations)),
    deployments: deployment ? serializeDeployments([{
      deploymentId: id,
      locationId: deployment.locationID ?? '',
      locationName: deployment.locationName ?? '',
      latitude: deployment.latitude ? Number(deployment.latitude) : null,
      longitude: deployment.longitude ? Number(deployment.longitude) : null,
      elevation: 0,
    }]) : '',
    uploadMeta: serializeUploadMeta(buildUploadMeta({
      uploadUser: session.name,
      date: new Date(instant(deployment?.deploymentEnd ?? photos.at(-1)?.timestamp ?? new Date().toISOString())),
      imageCount: photos.length,
      imagesWithSpecies: tagged,
      bucket: session.bucket.name,
      uploadPath: uploadPrefix,
      description: `${deployment?.locationName ?? id} - collected ${id.split('_').at(-1)}`,
    })),
  };
}

// The Tagger's own body for observations.csv carries more than the package
// keeps (review markers, its own timestamps). While the package still says
// what that body said, hand the body back, so Undo and the conflict check see
// exactly what this tab wrote.
const lastWritten = new Map<string, { generated: string; body: string }>();
function lastWrittenFor(uploadPrefix: string, generated: string): string {
  const last = lastWritten.get(uploadPrefix);
  return last?.generated === generated ? last.body : generated;
}

const tagKey = (tags: { s: string; c: number }[]) => tags.map((t) => `${t.s}:${t.c}`).sort().join('|');

/**
 * Save the upload's observations.csv as the person's own rows in the package:
 * only photos whose species or counts changed are rewritten, so untouched
 * photos keep their classification time.
 */
export async function saveObservations(uploadPrefix: string, body: string): Promise<void> {
  const session = currentSession();
  clearPackageCache();
  const rows = await packageRows();
  const types = await speciesTypes();
  const id = deploymentOf(uploadPrefix);
  const photos = rows.media.filter((m) => m.deploymentID === id);
  const byKey = new Map(photos.map((m) => [m.filePath, m]));
  const wanted = new Map<string, { s: string; c: number }[]>(photos.map((m) => [m.mediaID, []]));
  for (const o of parseObservations(body)) {
    const m = byKey.get(o.mediaId);
    if (!m || o.observationType !== 'animal' || !o.scientificName) continue;
    wanted.get(m.mediaID)!.push({ s: o.scientificName, c: o.count || 1 });
  }
  const current = new Map<string, { s: string; c: number }[]>(photos.map((m) => [m.mediaID, []]));
  for (const o of rows.observations) {
    const list = current.get(o.mediaID);
    if (!list) continue;
    const s = o.observationType === 'blank' ? [...types].find(([, t]) => t.type === 'blank')?.[0] ?? 'Casper'
      : o.observationType === 'unknown' ? [...types].find(([, t]) => t.type === 'unknown')?.[0] ?? 'Incognita' : o.scientificName ?? '';
    list.push({ s, c: Number(o.count) || 1 });
  }
  const changed = photos.filter((m) => tagKey(wanted.get(m.mediaID)!) !== tagKey(current.get(m.mediaID)!));
  const remember = async () => {
    lastWritten.delete(uploadPrefix);
    lastWritten.set(uploadPrefix, { generated: (await uploadFiles(uploadPrefix)).observations, body });
  };
  if (!changed.length) return remember();
  const at = nowTimestamp();
  const newRows = changed.flatMap((m) => tagRows(m, wanted.get(m.mediaID)!.map((t): Tag => {
    const observationType = types.get(t.s)?.type ?? 'animal';
    return { observationType, scientificName: t.s, count: t.c };
  }), session.code, { timestamp: at }));
  const ids = changed.map((m) => m.mediaID);
  await savePackage(session.bucket, {
    observations: (o) => replaceObservations(o, ids, newRows),
    media: (m) => applyFilePublic(m, newRows, ids),
  }, await aboutPerson());
  clearPackageCache();
  await remember();
}
