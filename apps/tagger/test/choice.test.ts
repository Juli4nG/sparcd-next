import { describe, expect, it } from 'vitest';
import { groupBursts } from '../src/data/bursts';
import { restoreDraft } from '../src/data/draft';
import type { PhotoTag } from '../src/data/tags';
import { tagTargets } from '../src/lib/selection';

const coyote: PhotoTag = { key: 'Canis latrans', observationType: 'animal', scientificName: 'Canis latrans', count: 1 };

describe('groupBursts', () => {
  it('runs photos within a minute of the one before into one burst', () => {
    const at = (s: number) => ({ timestamp: new Date(Date.UTC(2026, 3, 1, 6, 0, s)).toISOString() });
    expect(groupBursts([at(0), at(30), at(90), at(200), at(210), at(271)])).toEqual([[0, 1, 2], [3, 4], [5]]);
  });
});

describe('tagTargets', () => {
  it('tags only the chosen photos the filter still shows, else the focused photo when shown', () => {
    expect(tagTargets(new Set([4, 1, 7]), 7, new Set([1, 2, 4]))).toEqual([1, 4]);
    expect(tagTargets(new Set([7]), 2, new Set([1, 2]))).toEqual([2]);
    expect(tagTargets(new Set(), 7, new Set([1, 2]))).toEqual([]);
  });
});

describe('restoreDraft', () => {
  it('lays unsaved edits over the stored tags and queues only the ones that differ', () => {
    const stored = new Map([['a', [coyote]], ['b', []]]);
    const { tags, unsaved } = restoreDraft(stored, {
      a: { tags: [coyote], at: '2026-11-19T10:00:00Z' },
      b: { tags: [{ ...coyote, count: 2 }], at: '2026-11-19T10:00:01Z' },
      c: { tags: [coyote], at: '2026-11-19T10:00:02Z' },
    });
    expect(unsaved).toEqual(['b', 'c']);
    expect(tags.get('b')).toEqual([{ ...coyote, count: 2 }]);
    expect(tags.get('a')).toBe(stored.get('a'));
  });
});
