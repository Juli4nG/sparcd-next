import { describe, expect, it } from 'vitest';
import type { Media } from '@sparcd/bucket';
import { burstsOf, untaggedBurst } from '../src/data/bursts';
import type { PhotoTag } from '../src/data/tags';
import { simpleFlag } from '../src/lib/simpleFlag';

const photo = (c: string, second: number): Media => ({
  mediaID: c.repeat(64), deploymentID: 'site_2026-11-17', timestamp: `2026-04-01T06:00:${String(second).padStart(2, '0')}-07:00`,
  filePath: 'x', filePublic: 'true', fileMediatype: 'image/jpeg',
});
const deer: PhotoTag = { key: 'Odocoileus hemionus', observationType: 'animal', scientificName: 'Odocoileus hemionus', count: 1 };

describe('untaggedBurst', () => {
  it('offers the whole burst only while none of its photos has a tag', () => {
    const photos = [photo('a', 0), photo('b', 5), photo('c', 10)];
    const burst = burstsOf(photos)[0]!;
    expect(untaggedBurst(burst, photos, new Map())).toBe(true);
    expect(untaggedBurst(burst, photos, new Map([[photos[2].mediaID, []]]))).toBe(true);
    expect(untaggedBurst(burst, photos, new Map([[photos[1].mediaID, [deer]]]))).toBe(false);
  });
});

describe('simpleFlag', () => {
  it('finds and removes the flag wherever it sits', () => {
    expect(simpleFlag('#simple&card=a_b')).toEqual({ simple: true, rest: '#card=a_b' });
    expect(simpleFlag('#card=a_b&simple')).toEqual({ simple: true, rest: '#card=a_b' });
    expect(simpleFlag('#share=https%3A%2F%2Fx&simple')).toEqual({ simple: true, rest: '#share=https%3A%2F%2Fx' });
    expect(simpleFlag('#card=simpleton')).toEqual({ simple: false, rest: '#card=simpleton' });
  });
});
