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
  return 'Upload stopped because the connection dropped. Check your internet, then retry.';
}

export function startRun(job: { session: Session; lab: Lab; site: Site; date: string; card: CardFile[] }) {
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
      useRun.setState({ running: false, error: explain(err) });
    },
  );
}

export function cancelRun() {
  stop?.abort();
  stop = null;
  useRun.setState({ running: false, error: 'Upload paused. Photos already stored stay stored; retry to finish.' });
}

export function clearRun() {
  stop?.abort();
  stop = null;
  reads = new Map();
  useRun.setState({ running: false, progress: null, outcome: null, error: null });
}
