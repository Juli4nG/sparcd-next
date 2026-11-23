import type { Media } from '@sparcd/bucket';
import { tagState, type PhotoTag } from '../data/tags';

// Zoom on the big photo. The transform is translate(x, y) scale(s) about the box's centre.

export const MAX_ZOOM = 4;
/** Past this the full-size original is worth loading over view.jpg's 1600 px. */
export const ORIGINAL_AT = 1.5;
export const DOUBLE_TAP_ZOOM = 2.5;

export type Zoom = { s: number; x: number; y: number };
export type Size = { w: number; h: number };

export const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };

/** The photo's size inside the box, as object-contain draws it. */
export function contained(image: Size, box: Size): Size {
  const k = Math.min(box.w / image.w, box.h / image.h);
  return { w: image.w * k, h: image.h * k };
}

/** Scale within 1–4×, and a pan that never shows past the photo's edge; a side smaller than the box stays centred. */
export function clampZoom({ s, x, y }: Zoom, photo: Size, box: Size): Zoom {
  s = Math.min(MAX_ZOOM, Math.max(1, s));
  const room = (side: number, boxSide: number) => Math.max(0, (side * s - boxSide) / 2);
  const rx = room(photo.w, box.w);
  const ry = room(photo.h, box.h);
  return { s, x: Math.min(rx, Math.max(-rx, x)), y: Math.min(ry, Math.max(-ry, y)) };
}

type Point = { x: number; y: number };

/**
 * Zoom to `s` so the spot of the photo under `from` ends up under `to` (both relative to the box's
 * centre): the same point for the wheel and a double tap, the fingers' moving midpoint for a pinch.
 */
export function zoomAt(z: Zoom, s: number, from: Point, photo: Size, box: Size, to: Point = from): Zoom {
  const k = Math.min(MAX_ZOOM, Math.max(1, s)) / z.s;
  return clampZoom({ s: z.s * k, x: to.x - (from.x - z.x) * k, y: to.y - (from.y - z.y) * k }, photo, box);
}

// Brighten: off, brighter, brightest. It lasts from photo to photo, since night photos come in runs.

export const BRIGHTEN = [
  { label: 'Brighten', state: 'off', filter: undefined },
  { label: 'Brighter', state: 'brighter', filter: 'brightness(1.5) contrast(1.1)' },
  { label: 'Brightest', state: 'brightest', filter: 'brightness(2.2) contrast(1.2)' },
] as const;

export const nextBrighten = (level: number): number => (level + 1) % BRIGHTEN.length;

// The grid of every photo in the upload.

export type GridFilter = 'left' | 'tagged' | 'all';

export function filterCounts(photos: Media[], tags: Map<string, PhotoTag[]>): Record<GridFilter, number> {
  const left = photos.filter((p) => tagState(tags.get(p.mediaID)) === 'untagged').length;
  return { left, tagged: photos.length - left, all: photos.length };
}

/** Each shown photo's place in the upload. */
export function filtered(photos: Media[], tags: Map<string, PhotoTag[]>, filter: GridFilter): number[] {
  const out: number[] = [];
  photos.forEach((p, i) => {
    const untagged = tagState(tags.get(p.mediaID)) === 'untagged';
    if (filter === 'all' || untagged === (filter === 'left')) out.push(i);
  });
  return out;
}

/** "Coyote", "Coyote +1", or "Nothing"; empty for an untagged photo. */
export function tileLabel(tags: PhotoTag[] | undefined, nameOf: (t: PhotoTag) => string): string {
  if (!tags?.length) return '';
  if (tagState(tags) === 'nothing') return 'Nothing';
  return tags.length > 1 ? `${nameOf(tags[0])} +${tags.length - 1}` : nameOf(tags[0]);
}

/** Three columns at phone width, then one more for every ~200 px. */
export const gridColumns = (width: number): number => Math.max(3, Math.floor(width / 200));
