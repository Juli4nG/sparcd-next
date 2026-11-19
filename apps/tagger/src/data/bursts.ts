import { burstEventId, instant, type Media } from '@sparcd/bucket';

/** Photos taken within this long of their neighbour belong to one burst. */
export const BURST_GAP_MS = 60_000;

/** Photos `start` to `end` (inclusive) of a card, and the eventID their rows share when tagged together. */
export type Burst = { start: number; end: number; eventID: string };

/** Each photo's burst, for photos sorted by time; null for a photo taken on its own. */
export function burstsOf(photos: Media[]): (Burst | null)[] {
  const out: (Burst | null)[] = photos.map(() => null);
  let start = 0;
  for (let i = 1; i <= photos.length; i++) {
    if (i < photos.length && instant(photos[i].timestamp) - instant(photos[i - 1].timestamp) <= BURST_GAP_MS) continue;
    if (i - start > 1) {
      const burst = { start, end: i - 1, eventID: burstEventId(photos[start].deploymentID, photos[start].mediaID) };
      out.fill(burst, start, i);
    }
    start = i;
  }
  return out;
}
