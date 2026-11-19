import type { Deployment, Observation, Table } from './csv';
import type { Lab } from './settings';
import { timeRange } from './times';

const CAMTRAP = 'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0';
const TABLES: Table[] = ['deployments', 'media', 'observations'];

type Point = { type: 'Point'; coordinates: [number, number] };
type Polygon = { type: 'Polygon'; coordinates: [number, number][][] };

function spatial(deployments: Deployment[]): Point | Polygon {
  const lons = deployments.map((d) => Number(d.longitude));
  const lats = deployments.map((d) => Number(d.latitude));
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  if (w === e && s === n) return { type: 'Point', coordinates: [w, s] };
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

export type DatapackageInput = {
  /** The bucket name, or a share package's name. */
  name: string;
  personName: string;
  lab: Lab;
  deployments: Deployment[];
  observations: Observation[];
  created?: Date;
  /** Share packages: each resource's signed URL. Adds `licenses` from `lab.shareLicenses`. */
  sharePaths?: Record<Table, string>;
  /** Share packages: the signed URL of `thumbs.json`, as the custom `sparcdThumbs` property. */
  shareThumbs?: string;
};

export function buildDatapackage(p: DatapackageInput): Record<string, unknown> {
  const [start] = timeRange(p.deployments.map((d) => d.deploymentStart));
  const [, end] = timeRange(p.deployments.map((d) => d.deploymentEnd));
  const species = [...new Set(p.observations.map((o) => o.scientificName ?? '').filter(Boolean))].sort();
  return {
    profile: `${CAMTRAP}/camtrap-dp-profile.json`,
    name: p.name,
    title: `Photos from ${p.personName}`,
    created: (p.created ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    contributors: [{ title: p.personName, role: 'rightsHolder' }],
    ...(p.sharePaths && { licenses: p.lab.shareLicenses }),
    project: {
      title: p.lab.title,
      samplingDesign: 'opportunistic',
      captureMethod: ['activityDetection'],
      individualAnimals: false,
      observationLevel: ['media'],
    },
    spatial: spatial(p.deployments),
    temporal: { start: start.slice(0, 10), end: end.slice(0, 10) },
    taxonomic: species.map((scientificName) => ({ scientificName })),
    resources: TABLES.map((name) => ({
      name,
      path: p.sharePaths?.[name] ?? `${name}.csv`,
      profile: 'tabular-data-resource',
      format: 'csv',
      mediatype: 'text/csv',
      encoding: 'utf-8',
      schema: `${CAMTRAP}/${name}-table-schema.json`,
    })),
    ...(p.shareThumbs && { sparcdThumbs: p.shareThumbs }),
  };
}
