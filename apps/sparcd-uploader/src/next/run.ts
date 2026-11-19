import { create } from 'zustand';
import { S3Error, deploymentId, type Lab, type Session, type Site } from '@sparcd/bucket';
import type { ReadResult } from './photo.worker';
import type { CardFile } from './scan';
import { PhotoError, sendCard, type Outcome, type Progress } from './send';

type RunState = {
  running: boolean;
  progress: Progress | null;
  outcome: Outcome | null;
  error: string | null;
};

export const useRun = create<RunState>(() => ({ running: false, progress: null, outcome: null, error: null }));

let stop: AbortController | null = null;
// Kept across "Retry" so photos aren't read twice.
let reads = new Map<File, ReadResult>();

function explain(err: unknown): string {
  const cause = err instanceof PhotoError ? err.cause : err;
  if (cause instanceof S3Error && cause.status === 403) return 'Your sign-in has stopped working. Disconnect, sign in again, then retry.';
  if (cause instanceof Error && cause.name === 'NotFoundError')
    return 'The card couldn’t be read. Make sure it’s still plugged in, then retry.';
  return DROPPED;
}

const DROPPED = "No internet. Sending will carry on when it's back.";
const RETRY_AFTER_MS = 15_000;

/** After a dropped connection, start again by itself once the browser is back online, or after a short wait. */
function carryOnLater(job: Job, controller: AbortController) {
  const again = () => {
    window.removeEventListener('online', again);
    clearTimeout(timer);
    // Cancelled, cleared or started again meanwhile.
    if (stop === controller) startRun(job);
  };
  const timer = setTimeout(() => (navigator.onLine ? again() : undefined), RETRY_AFTER_MS);
  window.addEventListener('online', again);
}

type Job = { session: Session; lab: Lab; site: Site; date: string; card: CardFile[] };

export function startRun(job: Job) {
  stop?.abort();
  const controller = new AbortController();
  stop = controller;
  useRun.setState({ running: true, progress: null, outcome: null, error: null });
  sendCard({
    ...job,
    deploymentID: deploymentId(job.site.locationID, job.date),
    reads,
    onProgress: (progress) => !controller.signal.aborted && useRun.setState({ progress }),
    signal: controller.signal,
  }).then(
    (outcome) => {
      if (controller.signal.aborted) return;
      console.info('uploader timings', JSON.stringify(outcome.timings));
      useRun.setState({ running: false, outcome });
    },
    (err) => {
      if (controller.signal.aborted) return;
      console.error(err);
      const error = explain(err);
      useRun.setState({ running: false, error });
      if (error === DROPPED) carryOnLater(job, controller);
    },
  );
}

export function cancelRun() {
  stop?.abort();
  stop = null;
  useRun.setState({ running: false, error: 'Upload paused. Photos already sent stay saved. Press Retry upload to finish.' });
}

export function clearRun() {
  stop?.abort();
  stop = null;
  reads = new Map();
  useRun.setState({ running: false, progress: null, outcome: null, error: null });
}
