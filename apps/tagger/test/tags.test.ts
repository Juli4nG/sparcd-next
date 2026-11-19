import { describe, expect, it } from 'vitest';
import { tagRows, type Media } from '@sparcd/bucket';
import { addTag, incrementTag, NOTHING, tagsFromRows, toBucketTags, type PhotoTag } from '../src/data/tags';

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
