/**
 * A first-come queue that lets at most `limit` jobs run at once. `take` calls `start` when a slot
 * is free and returns `done`, which frees the slot, or leaves the queue if `start` hasn't run yet.
 * A job still running `deadlineMs` after it started loses its slot, and then `expire` is called.
 */
export function slots(limit: number, deadlineMs = Infinity) {
  let busy = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    while (busy < limit && waiting.length) {
      busy++;
      waiting.shift()!();
    }
  };
  return function take(start: () => void, expire = () => {}): () => void {
    let state: 'waiting' | 'running' | 'done' = 'waiting';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      state = 'running';
      if (deadlineMs < Infinity) {
        timer = setTimeout(() => {
          done();
          expire();
        }, deadlineMs);
      }
      start();
    };
    const done = () => {
      clearTimeout(timer);
      if (state === 'running') busy--;
      else if (state === 'waiting') waiting.splice(waiting.indexOf(run), 1);
      state = 'done';
      next();
    };
    waiting.push(run);
    next();
    return done;
  };
}

/**
 * Thumbnails load a few at a time, so a full grid doesn't reach storage as one burst it answers with HTTP 429.
 * One that hasn't loaded in 20 s gives up its slot, so a stalled request can't hold up the rest.
 */
export const thumbSlots = slots(6, 20_000);
