import PhotoWorker from '../workers/photo.worker?worker';
import type { Derived, ReadResult, WorkerRequest, WorkerResponse } from '../workers/photo.worker';

type Job = { req: WorkerRequest; resolve: (v: never) => void; reject: (e: Error) => void };

export type Pool = {
  read: (file: File) => Promise<ReadResult>;
  derive: (file: File, frame?: ImageBitmap) => Promise<Derived>;
  close: () => void;
};

export const poolSize = () => Math.max(2, Math.min((navigator.hardwareConcurrency || 4) - 1, 6));

export function createPool(size = poolSize()): Pool {
  const queue: Job[] = [];
  const idle: Worker[] = [];
  const busy = new Map<Worker, Job>();

  const pump = () => {
    while (idle.length && queue.length) {
      const worker = idle.pop()!;
      const job = queue.shift()!;
      busy.set(worker, job);
      worker.postMessage(job.req, job.req.kind === 'derive' && job.req.frame ? [job.req.frame] : []);
    }
  };

  const finish = (worker: Worker, settle: (job: Job) => void) => {
    const job = busy.get(worker)!;
    busy.delete(worker);
    idle.push(worker);
    settle(job);
    pump();
  };

  for (let i = 0; i < size; i++) {
    const worker = new PhotoWorker();
    worker.onmessage = (e: MessageEvent<WorkerResponse>) =>
      finish(worker, (job) => {
        if (e.data.ok) return job.resolve(e.data.value as never);
        job.reject(Object.assign(new Error(e.data.error), { name: e.data.name }));
      });
    worker.onerror = (e) => finish(worker, (job) => job.reject(new Error(e.message || 'worker crashed')));
    idle.push(worker);
  }

  const run = <T,>(req: WorkerRequest) =>
    new Promise<T>((resolve, reject) => {
      queue.push({ req, resolve: resolve as (v: never) => void, reject });
      pump();
    });

  return {
    read: (file) => run<ReadResult>({ kind: 'read', file }),
    derive: (file, frame) => run<Derived>({ kind: 'derive', file, frame }),
    close: () => {
      const stopped = new DOMException('Stopped', 'AbortError');
      for (const job of [...queue.splice(0), ...busy.values()]) job.reject(stopped);
      for (const w of [...idle, ...busy.keys()]) w.terminate();
    },
  };
}
