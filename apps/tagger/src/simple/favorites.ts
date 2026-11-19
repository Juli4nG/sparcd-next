import type { Observation, Species } from '@sparcd/bucket';
import { speciesKey, tagKey } from '../data/tags';

/**
 * The species this person tags most often at this site, most often first, then
 * the lab's keyboard species to fill up. "Nothing" has its own button.
 */
export function siteFavorites(species: Species[], observations: Observation[], siteCards: Set<string>, n: number): Species[] {
  const seen = new Map<string, number>();
  for (const o of observations) {
    if (!siteCards.has(o.deploymentID) || o.observationType === 'blank') continue;
    const key = tagKey(o.observationType as Species['observationType'], o.scientificName ?? '');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const pickable = species.filter((s) => s.observationType !== 'blank');
  const ranked = pickable.filter((s) => seen.has(speciesKey(s))).sort((a, b) => seen.get(speciesKey(b))! - seen.get(speciesKey(a))!);
  const fill = pickable.filter((s) => s.keyBinding && !ranked.includes(s));
  return [...new Set([...ranked, ...fill, ...pickable])].slice(0, n);
}
