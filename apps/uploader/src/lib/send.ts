import {
  mergeDeployments,
  mergeMedia,
  readTable,
  savePackage,
  type Lab,
  type Media,
  type Session,
  type Site,
} from '@sparcd/bucket';
import type { ReadResult } from '../workers/photo.worker';
import { deploymentRow, keysOf, mediaRow, planSend, toPhotos, type Photo } from './photos';
import { createPool } from './pool';
import type { CardFile } from './scan';

export const CHECKPOINT_EVERY = 250;
const PARALLEL = 6;

export type Progress =
  | { phase: 'reading'; done: number; total: number; startedAt: number }
  | { phase: 'sending'; done: number; total: number; startedAt: number; sentBefore: number };

export type Outcome = { total: number; alreadySaved: number; deploymentID: string; timings: Record<string, number> };

export class PhotoError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

type Job = {
  session: Session;
  lab: Lab;
  site: Site;
  deploymentID: string;
  card: CardFile[];
  /** Survives "Try again" so photos aren't read twice. */
  reads: Map<File, ReadResult>;
  onProgress: (p: Progress) => void;
  signal: AbortSignal;
};

async function readAll(job: Job, pool: ReturnType<typeof createPool>): Promise<ReadResult[]> {
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
        throw new PhotoError(c.path, err);
      }
      job.onProgress({ phase: 'reading', done: ++done, total, startedAt });
    }),
  );
  return job.card.map((c) => job.reads.get(c.file)!);
}

export async function sendCard(job: Job): Promise<Outcome> {
  const { session, deploymentID } = job;
  const pool = createPool();
  job.signal.addEventListener('abort', pool.close);
  const t0 = performance.now();
  try {
    const reads = await readAll(job, pool);
    const t1 = performance.now();
    const photos = toPhotos(job.card, reads, job.lab.timeZone);
    const [known, stored] = await Promise.all([
      readTable(session.bucket, 'media').then((rows) => new Set(rows.map((m) => m.mediaID))),
      session.bucket.listKeys('Media/').then((keys) => new Set(keys)),
    ]);
    const plan = planSend(photos, known, stored);
    const cameraModel = photos.find((p) => p.camera)?.camera;

    const total = photos.length;
    const sentBefore = plan.skip.length + plan.rowOnly.length;
    let done = sentBefore;
    const startedAt = performance.now();
    job.onProgress({ phase: 'sending', done, total, startedAt, sentBefore });

    const pending: Media[] = plan.rowOnly.map((p) => mediaRow(p, deploymentID));
    let saving: Promise<void> = Promise.resolve();
    const checkpoint = () => {
      const rows = pending.splice(0);
      const deployment = deploymentRow(job.site, deploymentID, rows, cameraModel);
      saving = saving.then(async () => {
        await savePackage(
          session.bucket,
          { deployments: (d) => mergeDeployments(d, [deployment], 'widen'), media: (m) => mergeMedia(m, rows) },
          { personName: session.name, lab: job.lab },
        );
      });
      return saving;
    };

    const sendOne = async ({ photo, missing }: (typeof plan.send)[number]) => {
      try {
        await putPhoto(session, photo, missing, pool);
      } catch (err) {
        throw new PhotoError(photo.path, err);
      }
      pending.push(mediaRow(photo, deploymentID));
      job.onProgress({ phase: 'sending', done: ++done, total, startedAt, sentBefore });
      if (pending.length >= CHECKPOINT_EVERY) await checkpoint();
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
    await Promise.all(Array.from({ length: PARALLEL }, lane));
    await saving;
    if (failure) throw failure;
    if (pending.length) await checkpoint();
    const t2 = performance.now();
    return {
      total,
      alreadySaved: plan.skip.length,
      deploymentID,
      timings: { readMs: t1 - t0, sendMs: t2 - t1, totalMs: t2 - t0 },
    };
  } finally {
    pool.close();
  }
}

async function putPhoto(session: Session, photo: Photo, missing: string[], pool: ReturnType<typeof createPool>) {
  const keys = keysOf(photo);
  const derived = missing.includes('thumb') || missing.includes('view') ? await pool.derive(photo.file) : undefined;
  const puts: Promise<unknown>[] = [];
  const put = (key: string, body: Blob | Uint8Array<ArrayBuffer>, sha256: string) =>
    puts.push(session.bucket.putObject(key, body, { contentType: 'image/jpeg', sha256, ifNoneMatch: true }));
  if (missing.includes('original')) put(keys.original, photo.file, photo.mediaID);
  if (derived && missing.includes('thumb')) put(keys.thumb, new Uint8Array(derived.thumb), derived.thumbSha256);
  if (derived && missing.includes('view')) put(keys.view, new Uint8Array(derived.view), derived.viewSha256);
  await Promise.all(puts);
}
