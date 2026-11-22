import { describe, expect, it } from 'vitest';
import { planSend, type Photo } from '../src/send/photos';

const id = (c: string) => c.repeat(64);
const photo = (c: string, name = `IMG_${c}.JPG`): Photo => ({
  path: `DCIM/${name}`,
  file: new File([], name),
  mediaID: id(c),
  timestamp: '2026-11-17T10:00:00-07:00',
  estimated: false,
});
const keys = (c: string, name = `IMG_${c}.JPG`) => [`Media/${id(c)}/${name}`, `Media/${id(c)}/thumb.jpg`, `Media/${id(c)}/view.jpg`];

describe('planSend', () => {
  it('sends a photo with nothing stored, all three files', () => {
    const a = photo('a');
    expect(planSend([a], new Set(), new Set()).send).toEqual([{ photo: a, missing: ['original', 'thumb', 'view'] }]);
  });

  it('sends only the files that are missing when the photo was partly stored', () => {
    const a = photo('a');
    const b = photo('b');
    const stored = new Set([keys('a')[0], keys('b')[1], keys('b')[2]]);
    expect(planSend([a, b], new Set(), stored).send).toEqual([
      { photo: a, missing: ['thumb', 'view'] },
      { photo: b, missing: ['original'] },
    ]);
  });

  it('puts a photo whose files are stored but whose row is missing in rowOnly, nothing to send', () => {
    const a = photo('a');
    expect(planSend([a], new Set(), new Set(keys('a')))).toEqual({ skip: [], rowOnly: [a], send: [] });
  });

  it('skips a photo that already has a row, whatever is stored', () => {
    const a = photo('a');
    expect(planSend([a], new Set([id('a')]), new Set())).toEqual({ skip: [a], rowOnly: [], send: [] });
    expect(planSend([a], new Set([id('a')]), new Set(keys('a')))).toEqual({ skip: [a], rowOnly: [], send: [] });
  });

  it('counts a second copy of a stored photo as a skip, not a second row', () => {
    const first = photo('c', 'IMG_1.JPG');
    const copy = photo('c', 'IMG_2.JPG');
    const plan = planSend([first, copy], new Set(), new Set(keys('c', 'IMG_1.JPG')));
    expect(plan.rowOnly).toEqual([first]);
    expect(plan.skip).toEqual([copy]);
  });

  it('keeps each photo in exactly one of the three lists, in card order', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => photo(x));
    const plan = planSend([a, b, c, d], new Set([id('a')]), new Set([...keys('b'), keys('c')[1]]));
    expect(plan.skip).toEqual([a]);
    expect(plan.rowOnly).toEqual([b]);
    expect(plan.send.map((s) => s.photo)).toEqual([c, d]);
  });

  it('plans nothing for an empty card', () => {
    expect(planSend([], new Set(), new Set())).toEqual({ skip: [], rowOnly: [], send: [] });
  });
});
