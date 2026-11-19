import { describe, expect, it } from 'vitest';
import { tagRows, type Media } from '@sparcd/bucket';
import { addTag, incrementTag, NOTHING, removeTag, setCount, tagsFromRows, toBucketTags, type PhotoTag } from '../src/data/tags';

const coyote: PhotoTag = { key: 'Canis latrans', observationType: 'animal', scientificName: 'Canis latrans', count: 1 };
const unknown: PhotoTag = { key: 'unknown', observationType: 'unknown', scientificName: '', count: 2 };
const media: Media = {
  mediaID: 'f'.repeat(64),
  deploymentID: 'site_2026-11-17',
  timestamp: '2026-04-01T06:00:00-07:00',
  filePath: 'x',
  filePublic: 'true',
  fileMediatype: 'image/jpeg',
};

describe('tags', () => {
  it('Nothing in this photo replaces species, and a species replaces it', () => {
    expect(addTag([coyote], NOTHING)).toEqual([NOTHING]);
    expect(incrementTag([NOTHING], coyote)).toEqual([coyote]);
    expect(incrementTag([coyote], coyote)).toEqual([{ ...coyote, count: 2 }]);
    expect(addTag([coyote], { ...coyote, count: 5 })).toEqual([coyote]);
  });

  it('round-trips through observation rows, including tags with no scientific name', () => {
    const tags = [coyote, unknown];
    expect(tagsFromRows(tagRows(media, toBucketTags(tags), 'ana').reverse()).get(media.mediaID)).toEqual(tags);
    expect(tagsFromRows(tagRows(media, toBucketTags([NOTHING]), 'ana')).get(media.mediaID)).toEqual([NOTHING]);
  });
});

describe('eventIDs', () => {
  it('belong to each tag: read back from its own row and kept through edits to the other tags', () => {
    const rows = [
      ...tagRows(media, toBucketTags([coyote]), 'jd', { eventID: 'burst-1' }),
      { ...tagRows(media, toBucketTags([coyote, unknown]), 'jd')[1], eventID: '' },
    ];
    const read = tagsFromRows(rows).get(media.mediaID)!;
    const burst = { ...coyote, eventID: 'burst-1' };
    expect(read).toEqual([burst, unknown]);

    const fox: PhotoTag = { key: 'Vulpes vulpes', observationType: 'animal', scientificName: 'Vulpes vulpes', count: 1 };
    expect(addTag(read, fox)).toEqual([burst, unknown, fox]);
    expect(incrementTag(read, unknown)).toEqual([burst, { ...unknown, count: 3 }]);
    expect(incrementTag(read, coyote)).toEqual([{ ...burst, count: 2 }, unknown]);
    expect(setCount(read, coyote.key, 4)).toEqual([{ ...burst, count: 4 }, unknown]);
    expect(removeTag(read, unknown.key)).toEqual([burst]);
  });
});
