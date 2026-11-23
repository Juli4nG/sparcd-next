/**
 * Runs jobs while the bytes they hold stay within `limit`, first come first
 * served. A job bigger than the whole limit runs alone.
 */
export function byteBudget(limit: number) {
  let used = 0;
  let running = 0;
  const waiting: { bytes: number; go: () => void }[] = [];
  const fits = (bytes: number) => running === 0 || used + bytes <= limit;
  const start = (bytes: number) => ((used += bytes), running++);
  return async function run<T>(bytes: number, job: () => Promise<T>): Promise<T> {
    if (!waiting.length && fits(bytes)) start(bytes);
    else await new Promise<void>((go) => waiting.push({ bytes, go }));
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
