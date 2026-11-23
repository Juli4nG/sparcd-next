import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftKey, readDraft, restoreDraft, writeDraft } from '../src/data/draft';
import type { PhotoTag } from '../src/data/tags';

const coyote: PhotoTag = { key: 'Canis latrans', observationType: 'animal', scientificName: 'Canis latrans', count: 1 };

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

describe('the draft kept in the browser', () => {
  afterEach(() => vi.unstubAllGlobals());

  function storage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    return items;
  }

  it('is named by the person and the card', () => {
    expect(draftKey('ana', 'juniper-draw_2026-11-17')).toBe('sparcd-next.tagger.draft.ana.juniper-draw_2026-11-17');
  });

  it('writes the edits and reads them back', () => {
    const items = storage();
    const draft = { a: { tags: [coyote], at: '2026-11-19T10:00:00Z' } };
    writeDraft('k', draft);
    expect(items.has('k')).toBe(true);
    expect(readDraft('k')).toEqual(draft);
  });

  it('removes the entry once no edit is left', () => {
    const items = storage({ k: '{"a":{"tags":[],"at":"x"}}' });
    writeDraft('k', {});
    expect(items.has('k')).toBe(false);
    expect(readDraft('k')).toEqual({});
  });
});
