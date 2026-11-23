/**
 * Runs jobs while the bytes they hold stay within `limit`, first come first
 * served. A job bigger than the whole limit runs alone. Once `signal` aborts,
 * waiting jobs and later ones reject instead of starting.
 */
export function byteBudget(limit: number, signal?: AbortSignal) {
  let used = 0;
  let running = 0;
  const waiting: { bytes: number; go: () => void; stop: (reason: unknown) => void }[] = [];
  const fits = (bytes: number) => running === 0 || used + bytes <= limit;
  const start = (bytes: number) => ((used += bytes), running++);
  signal?.addEventListener('abort', () => {
    for (const w of waiting.splice(0)) w.stop(signal.reason);
  });
  return async function run<T>(bytes: number, job: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    if (!waiting.length && fits(bytes)) start(bytes);
    else await new Promise<void>((go, stop) => waiting.push({ bytes, go, stop }));
    try {
      return await job();
    } finally {
      used -= bytes;
      running--;
      while (waiting.length && fits(waiting[0].bytes)) {
        const next = waiting.shift()!;
        start(next.bytes);
        next.go();
      }
    }
  };
}
