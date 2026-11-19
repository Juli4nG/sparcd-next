import { useState } from 'react';
import type { Species } from '@sparcd/bucket';
import { speciesKey } from '../data/tags';

/** Species key → bound key; `''` means "no key", overriding species.json. */
export type KeyOverrides = Record<string, string>;

const STORAGE_KEY = 'sparcd-next.tagger.keys';

function namedKey(key: string): string | null {
  const name = key.trim().toUpperCase();
  return name === 'SHIFT' ? 'Shift' : name === 'CONTROL' || name === 'CTRL' ? 'Control' : null;
}

export function normalizeEventKey(key: string): string | null {
  return namedKey(key) ?? ([...key].length === 1 && !/^\s$/u.test(key) ? key.toLocaleLowerCase() : null);
}

/** The binding a keypress stands for. Alt, Meta and Control combinations stay with the browser. */
export function normalizeBindableEventKey(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): string | null {
  if (event.altKey || event.metaKey) return null;
  if (event.key === 'Control') return event.shiftKey ? null : 'Control';
  return event.ctrlKey ? null : normalizeEventKey(event.key);
}

/** Digits are kept for counts, so they never bind. */
export function effectiveKey(species: Species, overrides: KeyOverrides): string | null {
  const own = speciesKey(species);
  const raw = Object.prototype.hasOwnProperty.call(overrides, own) ? overrides[own] : (species.keyBinding ?? '');
  const key = raw ? (namedKey(raw) ?? ([...raw].length === 1 ? raw.toLocaleLowerCase() : null)) : null;
  return key && !/^\d$/.test(key) ? key : null;
}

export type ResolvedKeys = {
  /** Keys owned by exactly one species: the only ones that act. */
  byKey: Map<string, Species>;
  /** Keys two or more species claim. Nobody gets them until one gives way. */
  shared: Map<string, Species[]>;
};

export function resolveKeys(species: Species[], overrides: KeyOverrides): ResolvedKeys {
  const owners = new Map<string, Species[]>();
  for (const s of species) {
    const key = effectiveKey(s, overrides);
    if (key) owners.set(key, [...(owners.get(key) ?? []), s]);
  }
  const resolved: ResolvedKeys = { byKey: new Map(), shared: new Map() };
  for (const [key, list] of owners) {
    if (list.length > 1) resolved.shared.set(key, list);
    else resolved.byKey.set(key, list[0]);
  }
  return resolved;
}

export const keyLabel = (key: string): string => (key.length === 1 ? key.toUpperCase() : key);

function readOverrides(): KeyOverrides {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** The person's own key choices, kept in this browser. `unsaved` means the browser refused to store them. */
export function useKeyOverrides() {
  const [overrides, setOverrides] = useState<KeyOverrides>(readOverrides);
  const [unsaved, setUnsaved] = useState(false);
  const write = (next: KeyOverrides) => {
    setOverrides(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setUnsaved(false);
    } catch {
      setUnsaved(true);
    }
  };
  return {
    overrides,
    unsaved,
    /** Gives `key` to one species; the species in `displaced` lose it. */
    assign: (own: string, key: string, displaced: string[] = []) =>
      write({ ...overrides, ...Object.fromEntries(displaced.map((d) => [d, ''])), [own]: key }),
    clear: (own: string) => write({ ...overrides, [own]: '' }),
  };
}
