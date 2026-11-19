import type { Observation, ObservationType, Species, Tag } from '@sparcd/bucket';

/**
 * One species on one photo. `key` identifies it within the photo and in the
 * species list: the scientific name for animals and people, else the type, so
 * "Nothing in this photo" (blank) and Unknown round-trip through rows that
 * carry no scientificName.
 */
export type PhotoTag = { key: string; observationType: ObservationType; scientificName: string; count: number };

const named = (type: ObservationType) => type === 'animal' || type === 'human';

export const tagKey = (type: ObservationType, scientificName: string): string => (named(type) ? scientificName : type);

export const speciesKey = (s: Species): string => tagKey(s.observationType, s.scientificName);

export const speciesTag = (s: Species, count = 1): PhotoTag => ({
  key: speciesKey(s),
  observationType: s.observationType,
  scientificName: named(s.observationType) ? s.scientificName : '',
  count,
});

export const NOTHING: PhotoTag = { key: 'blank', observationType: 'blank', scientificName: '', count: 1 };

const rowNumber = (o: Observation) => Number(o.observationID.slice(o.observationID.lastIndexOf('-') + 1));

/** Each photo's tags, in the order they were written. */
export function tagsFromRows(observations: Observation[]): Map<string, PhotoTag[]> {
  const byMedia = new Map<string, Observation[]>();
  for (const o of observations) byMedia.set(o.mediaID, [...(byMedia.get(o.mediaID) ?? []), o]);
  const tags = new Map<string, PhotoTag[]>();
  for (const [id, rows] of byMedia) {
    tags.set(
      id,
      rows
        .sort((a, b) => rowNumber(a) - rowNumber(b))
        .map((o) => {
          const type = o.observationType as ObservationType;
          const scientificName = named(type) ? (o.scientificName ?? '') : '';
          return { key: tagKey(type, scientificName), observationType: type, scientificName, count: Number(o.count) || 1 };
        }),
    );
  }
  return tags;
}

/** Each photo's eventID, when all its rows share one: a burst tag made elsewhere that rewriting the photo's tags keeps. */
export function eventsFromRows(observations: Observation[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const { mediaID, eventID = '' } of observations) seen.set(mediaID, seen.has(mediaID) && seen.get(mediaID) !== eventID ? '' : eventID);
  return new Map([...seen].filter(([, id]) => id));
}

export const toBucketTags = (tags: PhotoTag[]): Tag[] =>
  tags.map((t) => ({ observationType: t.observationType, scientificName: t.scientificName, count: t.count }));

/** Add-only: a species already on the photo is left as it is. Nothing is exclusive; any species clears it. */
export function addTag(tags: PhotoTag[], tag: PhotoTag): PhotoTag[] {
  if (tag.observationType === 'blank') return tags.length === 1 && tags[0].key === tag.key ? tags : [{ ...NOTHING }];
  const real = tags.filter((t) => t.observationType !== 'blank');
  return real.some((t) => t.key === tag.key) ? (real.length === tags.length ? tags : real) : [...real, tag];
}

/** Keypress: adds at count 1, or adds one to the count when it's already there. */
export function incrementTag(tags: PhotoTag[], tag: PhotoTag): PhotoTag[] {
  if (tag.observationType === 'blank' || !tags.some((t) => t.key === tag.key)) return addTag(tags, { ...tag, count: 1 });
  return tags.map((t) => (t.key === tag.key ? { ...t, count: t.count + 1 } : t));
}

export const removeTag = (tags: PhotoTag[], key: string): PhotoTag[] => tags.filter((t) => t.key !== key);

export const setCount = (tags: PhotoTag[], key: string, count: number): PhotoTag[] =>
  tags.map((t) => (t.key === key ? { ...t, count } : t));

export type TagState = 'untagged' | 'nothing' | 'tagged';

export function tagState(tags: PhotoTag[] | undefined): TagState {
  if (!tags?.length) return 'untagged';
  return tags.every((t) => t.observationType === 'blank') ? 'nothing' : 'tagged';
}

export const sameTags = (a: PhotoTag[] = [], b: PhotoTag[] = []): boolean =>
  a.length === b.length && a.every((t, i) => t.key === b[i].key && t.count === b[i].count);
