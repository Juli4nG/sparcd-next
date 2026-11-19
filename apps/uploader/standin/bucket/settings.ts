import { parseCsv } from './csv';

export type ObservationType = 'animal' | 'human' | 'unknown' | 'blank';

export type Site = {
  locationID: string;
  locationName: string;
  latitude: number;
  longitude: number;
  deploymentGroups: string;
};

export type Species = {
  name: string;
  scientificName: string;
  speciesIconURL: string;
  keyBinding: string | null;
  observationType: ObservationType;
};

export type License = { name?: string; path?: string; title?: string; scope: 'data' | 'media' };

export type Lab = { title: string; timeZone: string; shareLicenses: License[] };

export const parseSites = (csv: string): Site[] =>
  parseCsv(csv).map((r) => ({
    locationID: r.locationID.trim(),
    locationName: r.locationName.trim(),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    deploymentGroups: (r.deploymentGroups ?? '').trim(),
  }));

type RawSpecies = Partial<Record<keyof Species, string | null>>;

export const parseSpecies = (json: string): Species[] =>
  (JSON.parse(json) as RawSpecies[]).map((s) => ({
    name: (s.name ?? '').trim(),
    scientificName: (s.scientificName ?? '').trim(),
    speciesIconURL: (s.speciesIconURL ?? '').trim(),
    keyBinding: s.keyBinding?.trim() || null,
    observationType: ((s.observationType ?? '').trim() || 'animal') as ObservationType,
  }));

export const parseLab = (json: string): Lab => JSON.parse(json) as Lab;
