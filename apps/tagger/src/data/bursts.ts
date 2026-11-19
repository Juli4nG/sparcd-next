import { instant, type Media } from '@sparcd/bucket';

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
