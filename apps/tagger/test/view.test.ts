import { describe, expect, it } from 'vitest';
import type { Media } from '@sparcd/bucket';
import { NOTHING, type PhotoTag } from '../src/data/tags';
import { BRIGHTEN, MAX_ZOOM, NO_ZOOM, brightenFilter, clampZoom, contained, filterCounts, filtered, gridColumns, kindOf, nextBrighten, tileLabel, zoomAt } from '../src/tag/view';

const box = { w: 800, h: 600 };
const photo = { w: 800, h: 450 }; // a 16:9 photo in a 4:3 box, letterboxed top and bottom

describe('zoom', () => {
  it('fits the photo inside the box', () => {
    expect(contained({ w: 1600, h: 900 }, box)).toEqual(photo);
    expect(contained({ w: 900, h: 1600 }, box)).toEqual({ w: 337.5, h: 600 });
  });

  it('keeps the scale between 1× and 4×', () => {
    expect(clampZoom({ s: 0.5, x: 0, y: 0 }, photo, box).s).toBe(1);
    expect(clampZoom({ s: 9, x: 0, y: 0 }, photo, box).s).toBe(MAX_ZOOM);
  });

  it('pans no further than the photo’s edge, and keeps a side smaller than the box centred', () => {
    // At 2× the photo is 1600 × 900: 400 px spare each side across, 150 px up and down.
    expect(clampZoom({ s: 2, x: 999, y: -999 }, photo, box)).toEqual({ s: 2, x: 400, y: -150 });
    expect(clampZoom({ s: 2, x: -50, y: 20 }, photo, box)).toEqual({ s: 2, x: -50, y: 20 });
    // At 1.2× it's 540 px tall, still inside the 600 px box: no vertical pan.
    expect(clampZoom({ s: 1.2, x: 10, y: 30 }, photo, box)).toEqual({ s: 1.2, x: 10, y: 0 });
    expect(clampZoom({ s: 1, x: 10, y: 10 }, photo, box)).toEqual(NO_ZOOM);
  });

  it('zooms about a point, keeping that spot of the photo under it', () => {
    const at = { x: 200, y: 100 };
    const z = zoomAt(NO_ZOOM, 2, at, photo, box);
    expect(z).toEqual({ s: 2, x: -200, y: -100 });
    // The photo point under `at` before (200, 100) maps back to `at` after: 2 × 200 + (−200) = 200.
    expect(z.s * at.x + z.x).toBe(at.x);
    expect(zoomAt(z, 1, at, photo, box)).toEqual(NO_ZOOM);
  });

  it('a pinch moves the spot under the fingers with their midpoint, within the edges', () => {
    expect(zoomAt(NO_ZOOM, 2, { x: 0, y: 0 }, photo, box, { x: 50, y: 20 })).toEqual({ s: 2, x: 50, y: 20 });
    expect(zoomAt(NO_ZOOM, 2, { x: 0, y: 0 }, photo, box, { x: 900, y: 0 })).toEqual({ s: 2, x: 400, y: 0 });
  });
});

describe('brighten', () => {
  it('steps off, brighter, brightest, then off', () => {
    expect([0, 1, 2].map(nextBrighten)).toEqual([1, 2, 0]);
    expect(BRIGHTEN.map((b) => b.label)).toEqual(['Brighten', 'Brighter', 'Brightest']);
    expect(BRIGHTEN.map((b) => b.gamma)).toEqual([1, 0.6, 0.4]);
    expect([0, 1, 2].map(brightenFilter)).toEqual([undefined, 'url(#brighten-1)', 'url(#brighten-2)']);
  });
});

const media = (n: number): Media => ({
  mediaID: `m${n}`,
  deploymentID: 'site_2026-11-17',
  timestamp: '2026-04-01T06:00:00-07:00',
  filePath: 'x',
  filePublic: 'true',
  fileMediatype: 'image/jpeg',
});
const coyote: PhotoTag = { key: 'Canis latrans', observationType: 'animal', scientificName: 'Canis latrans', count: 1 };
const deer: PhotoTag = { key: 'Odocoileus', observationType: 'animal', scientificName: 'Odocoileus', count: 2 };
const fox: PhotoTag = { key: 'Vulpes', observationType: 'animal', scientificName: 'Vulpes', count: 1 };
const names: Record<string, string> = { 'Canis latrans': 'Coyote', Odocoileus: 'Mule deer', Vulpes: 'Gray fox' };
const nameOf = (t: PhotoTag) => names[t.key];

describe('grid', () => {
  const photos = [0, 1, 2, 3, 4].map(media);
  const tags = new Map<string, PhotoTag[]>([
    ['m1', [coyote]],
    ['m3', [NOTHING]],
    ['m4', []],
  ]);

  it('counts the photos left to tag, tagged, and all; Nothing counts as tagged', () => {
    expect(filterCounts(photos, tags)).toEqual({ left: 3, tagged: 2, all: 5 });
    expect(filterCounts([], tags)).toEqual({ left: 0, tagged: 0, all: 0 });
  });

  it('shows each filter’s photos in upload order', () => {
    expect(filtered(photos, tags, 'left')).toEqual([0, 2, 4]);
    expect(filtered(photos, tags, 'tagged')).toEqual([1, 3]);
    expect(filtered(photos, tags, 'all')).toEqual([0, 1, 2, 3, 4]);
  });

  it('labels a tile with its first species, and +N for more', () => {
    expect(tileLabel(undefined, nameOf)).toBe('');
    expect(tileLabel([], nameOf)).toBe('');
    expect(tileLabel([NOTHING], nameOf)).toBe('Nothing');
    expect(tileLabel([coyote], nameOf)).toBe('Coyote');
    expect(tileLabel([deer, coyote], nameOf)).toBe('Mule deer +1');
    expect(tileLabel([deer, coyote, fox], nameOf)).toBe('Mule deer +2');
  });

  it('has three columns at phone width and more on wider screens', () => {
    expect(gridColumns(350)).toBe(3);
    expect(gridColumns(0)).toBe(3);
    expect(gridColumns(1240)).toBe(6);
  });
});

describe('kind', () => {
  it('names a row by its media type', () => {
    const row = (fileMediatype: string) => ({ fileMediatype }) as Media;
    expect(['image/jpeg', 'video/mp4', 'video/quicktime'].map((t) => kindOf(row(t)))).toEqual(['photo', 'video', 'video']);
  });
});
