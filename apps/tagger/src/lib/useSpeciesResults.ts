import { useMemo } from 'react';
import Fuse from 'fuse.js';
import type { Species } from '@sparcd/bucket';

/** One result list shared by the visible panel and the search's Enter action (#627). */
export function useSpeciesResults(species: Species[], search: string): Species[] {
  const fuse = useMemo(
    () => new Fuse(species, { keys: ['name', 'scientificName'], threshold: 0.34, ignoreLocation: true }),
    [species],
  );
  return useMemo(() => {
    const query = search.trim();
    if (query) return fuse.search(query).map((r) => r.item);
    return [...species].sort((a, b) => a.name.localeCompare(b.name));
  }, [species, search, fuse]);
}
