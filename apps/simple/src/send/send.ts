import {
  S3Error,
  mergeDeployments,
  mergeMedia,
  readTable,
  savePackage,
  type Changes,
  type Lab,
  type PackageRows,
  type Session,
  type Site,
} from '@sparcd/bucket';
import type { ReadResult } from '../workers/photo.worker';
import { deploymentRow, keysOf, mediaRow, planSend, toPhotos, type Photo } from './photos';
import { createPool, type Pool } from './pool';
import { openShards, type Shards } from './shards';
import type { CardFile } from './scan';

export const CHECKPOINT_EVERY = 250;
/** Photos in flight: about three per endpoint, within what browser memory takes comfortably. */
const lanesFor = (endpoints: number) => Math.min(16, Math.max(6, endpoints * 3));

export type Progress =
  | { phase: 'reading'; done: number; total: number; startedAt: number }
  | { phase: 'sending' | 'waiting'; done: number; total: number; startedAt: number; sentBefore: number };

export type Outcome = {
  total: number;
  alreadySaved: number;
  /** File names of photos that couldn't be read, decoded, or stored because of their size. */
  leftOut: string[];
  deploymentID: string;
  /** False when every photo on the card was already saved under another card. */
  cardHasPhotos: boolean;
  timings: Record<string, number>;
};

export class PhotoError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** A problem with this one photo; the rest of the card can still go. NotFoundError stays fatal: it means the card is gone. */
const photoProblem = (err: unknown) =>
  (err instanceof S3Error && err.status === 413) ||
  (err instanceof Error && ['NotReadableError', 'EncodingError', 'InvalidStateError'].includes(err.name));

/** What the volunteer fills in while the photos go up. Photos are stored by fingerprint, so only the rows wait for this. */
export type Details = { site: Site; deploymentID: string; comments: string };

type Job = {
  session: Session;
  lab: Lab;
  details: Promise<Details>;
  card: CardFile[];
  /** Survives "Try again" so photos aren't read twice. */
  reads: Map<File, ReadResult>;
  onProgress: (p: Progress) => void;
  signal: AbortSignal;
};

async function readAll(job: Job, pool: Pool, unread: CardFile[]): Promise<void> {
  const total = job.card.length;
  const startedAt = performance.now();
  let done = job.card.filter((c) => job.reads.has(c.file)).length;
  job.onProgress({ phase: 'reading', done, total, startedAt });
  await Promise.all(
    job.card.map(async (c) => {
      if (job.reads.has(c.file)) return;
      try {
        job.reads.set(c.file, await pool.read(c.file));
      } catch (err) {
        if (!photoProblem(err)) throw new PhotoError(c.path, err);
        unread.push(c);
      }
      job.onProgress({ phase: 'reading', done: ++done, total, startedAt });
    }),
  );
}

export async function sendCard(job: Job): Promise<Outcome> {
  const { session } = job;
  let details: Details | undefined;
  void job.details.then((d) => (details = d));
  const pool = createPool();
  job.signal.addEventListener('abort', pool.close);
  const shards = await openShards(session);
  const t0 = performance.now();
  try {
    const unread: CardFile[] = [];
    await readAll(job, pool, unread);
    const t1 = performance.now();
    const readable = job.card.filter((c) => job.reads.has(c.file));
    const photos = toPhotos(readable, readable.map((c) => job.reads.get(c.file)!), job.lab.timeZone);
    const leftOut = unread.map((c) => c.file.name);
    const [known, stored] = await Promise.all([
      readTable(session.bucket, 'media').then((rows) => new Set(rows.map((m) => m.mediaID))),
      session.bucket.listKeys('Media/').then((keys) => new Set(keys)),
    ]);
    const plan = planSend(photos, known, stored);
    const cameraModel = photos.find((p) => p.camera)?.camera;

    const total = job.card.length;
    const sentBefore = unread.length + plan.skip.length + plan.rowOnly.length;
    let done = sentBefore;
    let startedAt = performance.now();
    job.onProgress({ phase: 'sending', done, total, startedAt, sentBefore });

    let saving: Promise<unknown> = Promise.resolve();
    const save = (photos: Photo[]): Promise<PackageRows> => {
      const { site, deploymentID, comments } = details!;
      const rows = photos.map((p) => mediaRow(p, deploymentID));
      const changes: Changes = rows.length
        ? {
            deployments: (d) => mergeDeployments(d, [{ ...deploymentRow(site, deploymentID, rows, cameraModel), deploymentComments: comments }], 'widen'),
            media: (m) => mergeMedia(m, rows),
          }
        : {};
      const saved = saving.then(() => savePackage(session.bucket, changes, { personName: session.name, lab: job.lab }));
      saving = saved;
      return saved;
    };

    const pending: Photo[] = [...plan.rowOnly];
    const sendOne = async ({ photo, missing }: (typeof plan.send)[number]) => {
      try {
        await putPhoto(shards, photo, missing, pool);
        pending.push(photo);
      } catch (err) {
        if (!photoProblem(err)) throw new PhotoError(photo.path, err);
        leftOut.push(photo.file.name);
      }
      job.onProgress({ phase: 'sending', done: ++done, total, startedAt, sentBefore });
      // Long uploads save rows as they go, once the details are in.
      if (details && pending.length >= CHECKPOINT_EVERY) await save(pending.splice(0));
    };

    let next = 0;
    let failure: unknown;
    const lane = async () => {
      while (next < plan.send.length && !failure && !job.signal.aborted) {
        try {
          await sendOne(plan.send[next++]);
        } catch (err) {
          failure ??= err;
        }
      }
    };
    await Promise.all(Array.from({ length: lanesFor(shards.live()) }, lane));
    await saving;
    if (failure) throw failure;
    job.onProgress({ phase: 'waiting', done, total, startedAt, sentBefore });
    details = await job.details;
    const { deploymentID } = details;
    for (let i = 0; i < pending.length; i += CHECKPOINT_EVERY) await save(pending.slice(i, i + CHECKPOINT_EVERY));
    const saved = await save([]);
    const t2 = performance.now();
    return {
      total,
      alreadySaved: plan.skip.length,
      leftOut,
      deploymentID,
      cardHasPhotos: saved.media.some((m) => m.deploymentID === deploymentID),
      timings: { readMs: t1 - t0, sendMs: t2 - t1, totalMs: t2 - t0 },
    };
  } finally {
    pool.close();
  }
}

/**
 * Every file is made before any is stored, so a photo that can't be decoded
 * never has its original stored. The original goes up without its camera data.
 */
async function putPhoto(shards: Shards, photo: Photo, missing: string[], pool: Pool) {
  const keys = keysOf(photo);
  const put = (key: string, body: ArrayBuffer, sha256: string) => shards.put(key, new Uint8Array(body), sha256);
  const d = await pool.derive(photo.file);
  await Promise.all([
    missing.includes('thumb') && put(keys.thumb, d.thumb, d.thumbSha256),
    missing.includes('view') && put(keys.view, d.view, d.viewSha256),
    missing.includes('original') && put(keys.original, d.original, d.originalSha256),
  ]);
}
