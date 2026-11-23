import { describe, expect, it } from 'vitest';
import type { Observation, Species } from '@sparcd/bucket';
import { siteFavorites } from '../src/tag/favorites';

const sp = (name: string, scientificName: string, keyBinding: string | null, observationType: Species['observationType'] = 'animal'): Species => ({
  name, scientificName, speciesIconURL: '', keyBinding, observationType,
});
const coyote = sp('Coyote', 'Canis latrans', 'Y');
const bobcat = sp('Bobcat', 'Lynx rufus', 'L');
const deer = sp('Deer', 'Odocoileus hemionus', null);
const fox = sp('Fox', 'Vulpes vulpes', null);
const nothing = sp('Nothing', '', 'Shift', 'blank');
const unknown = sp('Unknown', '', null, 'unknown');
const all = [coyote, bobcat, deer, fox, nothing, unknown];

const obs = (deploymentID: string, observationType: string, scientificName: string): Observation => ({
  observationID: `${deploymentID}-${scientificName}-${Math.random()}`, deploymentID, mediaID: 'm', eventStart: 'x', eventEnd: 'x', observationLevel: 'media', observationType, scientificName,
});
const times = (n: number, ...args: [string, string, string]) => Array.from({ length: n }, () => obs(...args));
const names = (list: Species[]) => list.map((s) => s.name);

describe('siteFavorites', () => {
  const site = new Set(['juniper_1', 'juniper_2']);

  it('puts what this site tags most often first, then the lab\'s keyboard species, then the rest', () => {
    const rows = [...times(3, 'juniper_1', 'animal', 'Odocoileus hemionus'), ...times(1, 'juniper_2', 'animal', 'Lynx rufus')];
    expect(names(siteFavorites(all, rows, site, 10))).toEqual(['Deer', 'Bobcat', 'Coyote', 'Fox', 'Unknown']);
  });

  it('stops at n', () => {
    const rows = [...times(3, 'juniper_1', 'animal', 'Odocoileus hemionus'), ...times(1, 'juniper_2', 'animal', 'Lynx rufus')];
    expect(names(siteFavorites(all, rows, site, 2))).toEqual(['Deer', 'Bobcat']);
    expect(names(siteFavorites(all, rows, site, 3))).toEqual(['Deer', 'Bobcat', 'Coyote']);
  });

  it('counts only the cards at this site', () => {
    const rows = [...times(5, 'owl_1', 'animal', 'Vulpes vulpes'), ...times(1, 'juniper_1', 'animal', 'Canis latrans')];
    expect(names(siteFavorites(all, rows, site, 2))).toEqual(['Coyote', 'Bobcat']);
  });

  it('starts from the keyboard species when nothing was tagged here yet', () => {
    expect(names(siteFavorites(all, [], site, 4))).toEqual(['Coyote', 'Bobcat', 'Deer', 'Fox']);
  });

  it('keeps "Nothing" out: its own button covers it, whether tagged or listed', () => {
    const rows = times(9, 'juniper_1', 'blank', '');
    const result = siteFavorites(all, rows, site, 10);
    expect(names(result)).not.toContain('Nothing');
    expect(names(result)).toEqual(['Coyote', 'Bobcat', 'Deer', 'Fox', 'Unknown']);
  });

  it('ranks a species with no scientific name by its type', () => {
    const rows = times(2, 'juniper_1', 'unknown', '');
    expect(names(siteFavorites(all, rows, site, 1))).toEqual(['Unknown']);
  });

  it('lists each species once and returns what there is when n is larger', () => {
    const rows = times(2, 'juniper_1', 'animal', 'Canis latrans');
    const result = siteFavorites(all, rows, site, 99);
    expect(names(result)).toEqual(['Coyote', 'Bobcat', 'Deer', 'Fox', 'Unknown']);
  });
});
