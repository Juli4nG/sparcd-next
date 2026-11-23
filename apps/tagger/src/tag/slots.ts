/**
 * A first-come queue that lets at most `limit` jobs run at once. `take` calls `start` when a slot
 * is free and returns `done`, which frees the slot, or leaves the queue if `start` hasn't run yet.
 */
export function slots(limit: number) {
  let busy = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    while (busy < limit && waiting.length) {
      busy++;
      waiting.shift()!();
    }
  };
  return function take(start: () => void): () => void {
    let state: 'waiting' | 'running' | 'done' = 'waiting';
    const run = () => {
      state = 'running';
      start();
    };
    waiting.push(run);
    next();
    return () => {
      if (state === 'running') busy--;
      else if (state === 'waiting') waiting.splice(waiting.indexOf(run), 1);
      state = 'done';
      next();
    };
  };
}

/** Thumbnails load a few at a time, so a full grid doesn't reach storage as one burst it answers with HTTP 429. */
export const thumbSlots = slots(6);
