import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Site } from '@sparcd/bucket';
import { folderOf, guessFromFolder } from '../src/send/folder';

const site = (locationID: string): Site => ({ locationID, locationName: locationID, latitude: 31.5, longitude: -110.5, deploymentGroups: '' });
const sites = [site('WHE19'), site('owl-canyon')];
const file = (path: string) => ({ path, file: new File([], 'x.JPG') });

describe('folderOf', () => {
  it('is the first part of the path when the photos sit in a folder', () => {
    expect(folderOf([file('WHE19_09.28.26_119.images/DCIM/IMG_1.JPG')])).toBe('WHE19_09.28.26_119.images');
    expect(folderOf([file('owl/IMG_1.JPG'), file('other/IMG_2.JPG')])).toBe('owl');
  });

  it('is empty for loose photos or no photos', () => {
    expect(folderOf([file('IMG_1.JPG')])).toBe('');
    expect(folderOf([])).toBe('');
  });
});

describe('guessFromFolder', () => {
  // Local noon on 2026-11-21: the check compares against the local calendar day.
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 10, 21, 12) }));
  afterEach(() => vi.useRealTimers());

  it('reads the Site ID and the card date from Liz\'s folder names', () => {
    expect(guessFromFolder('WHE19_09.28.26_119.images', sites)).toEqual({ site: sites[0], date: '2026-09-28' });
    expect(guessFromFolder('owl-canyon_11.19.26_6.images', sites)).toEqual({ site: sites[1], date: '2026-11-19' });
  });

  it('accepts a name that ends, or goes on with a dot, right after the date', () => {
    expect(guessFromFolder('WHE19_09.28.26', sites).date).toBe('2026-09-28');
    expect(guessFromFolder('WHE19_09.28.26.images', sites).date).toBe('2026-09-28');
  });

  it('matches the Site ID whatever its case', () => {
    expect(guessFromFolder('whe19_09.28.26_119.images', sites).site).toBe(sites[0]);
    expect(guessFromFolder('OWL-CANYON_11.19.26_6.images', sites).site).toBe(sites[1]);
  });

  it('keeps the date when the site is unknown', () => {
    expect(guessFromFolder('ZZZ99_09.28.26_119.images', sites)).toEqual({ site: undefined, date: '2026-09-28' });
  });

  it('takes today but not a day still to come', () => {
    expect(guessFromFolder('WHE19_11.21.26_1.images', sites).date).toBe('2026-11-21');
    expect(guessFromFolder('WHE19_11.22.26_1.images', sites)).toEqual({ site: sites[0], date: undefined });
  });

  it('keeps the site but drops a date that is not a day', () => {
    expect(guessFromFolder('WHE19_13.45.26_1.images', sites)).toEqual({ site: sites[0], date: undefined });
    expect(guessFromFolder('WHE19_00.00.26_1.images', sites)).toEqual({ site: sites[0], date: undefined });
  });

  it('guesses nothing from a folder that is not named that way', () => {
    for (const name of ['', 'DCIM', '100CUDDY', 'WHE19_9.28.26_119.images', 'WHE19_09.28.2026_119', 'WHE19-09.28.26', '_09.28.26_1'])
      expect(guessFromFolder(name, sites)).toEqual({});
  });
});
