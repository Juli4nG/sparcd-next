import type { S3Config } from '@sparcd/types';
import { loadSpeciesVocabulary } from '@sparcd/s3-safe';
import { getClient } from './s3';
import { currentSession, speciesJson } from './next';
import { parseSpecies, type SpeciesResult } from '@sparcd/s3-safe';
export { parseSpecies, SpeciesShapeError, SPECIES_KEY } from '@sparcd/s3-safe';
export type { RawSpecies, Species, SkippedSpecies, SpeciesParse, SpeciesResult } from '@sparcd/s3-safe';

// SPARC'd Next: the lab's species.json in the settings bucket.
export async function fetchSpecies(_cfg: S3Config, _collectionKey?: string | null): Promise<SpeciesResult> {
  const settingsBucket = currentSession().settings.name;
  return { ...parseSpecies(await speciesJson()), settingsBucket, sourceBucket: settingsBucket, sourceKey: 'species.json' };
}
void loadSpeciesVocabulary;
void getClient;
