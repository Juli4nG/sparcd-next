import { burstEventId, instant, type Media } from '@sparcd/bucket';
import type { PhotoTag } from './tags';

/** Photos taken within this long of their neighbour belong to one burst. */
export const BURST_GAP_MS = 60_000;

/**
 * A card's bursts: runs of photos each taken within a minute of the one
 * before. `photos` is in card (time) order; each burst lists photo indices.
 */
export function groupBursts(photos: Pick<Media, 'timestamp'>[], gapMs = BURST_GAP_MS): number[][] {
  const bursts: number[][] = [];
  photos.forEach((p, i) => {
    const gap = i ? instant(p.timestamp) - instant(photos[i - 1].timestamp) : NaN;
    if (gap <= gapMs) bursts[bursts.length - 1].push(i);
    else bursts.push([i]);
  });
  return bursts;
}

/** Photos `start` to `end` (inclusive) of a card, and the eventID their rows share when tagged together. */
export type Burst = { start: number; end: number; eventID: string };

/** Each photo's burst, for photos sorted by time; null for a photo taken on its own. */
export function burstsOf(photos: Media[]): (Burst | null)[] {
  const out: (Burst | null)[] = photos.map(() => null);
  for (const run of groupBursts(photos)) {
    if (run.length < 2) continue;
    const [start, end] = [run[0], run[run.length - 1]];
    out.fill({ start, end, eventID: burstEventId(photos[start].deploymentID, photos[start].mediaID) }, start, end + 1);
  }
  return out;
}

/** A whole burst is tagged at once only while none of its photos has a tag. */
export const untaggedBurst = (burst: Burst, photos: Media[], tags: Map<string, PhotoTag[]>): boolean =>
  photos.slice(burst.start, burst.end + 1).every((p) => !tags.get(p.mediaID)?.length);
