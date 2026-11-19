import { describe, expect, it } from 'vitest';
import { buildDatapackage, type Deployment, type Lab, type Observation } from '../src';

const lab: Lab = {
  title: 'Example Wildlife Lab',
  timeZone: 'America/Phoenix',
  shareLicenses: [
    { name: 'CC-BY-NC-4.0', path: 'https://creativecommons.org/licenses/by-nc/4.0/', scope: 'data' },
    { name: 'CC-BY-NC-4.0', path: 'https://creativecommons.org/licenses/by-nc/4.0/', scope: 'media' },
  ],
};
const d = (id: string, lat: string, lon: string, start: string, end: string): Deployment => ({
  deploymentID: id, latitude: lat, longitude: lon, deploymentStart: start, deploymentEnd: end,
});
const obs = (scientificName: string): Observation => ({
  observationID: 'o', deploymentID: 'a', mediaID: 'm', eventStart: '', eventEnd: '', observationLevel: 'media',
  observationType: scientificName ? 'animal' : 'blank', scientificName,
});
const created = new Date(Date.UTC(2026, 10, 19, 7, 10, 0, 123));

describe('buildDatapackage', () => {
  it('describes one position as a Point', () => {
    const p = buildDatapackage({
      name: 'sparcd-next-ana', personName: 'Ana', lab, created, observations: [],
      deployments: [d('a', '31.5', '-110.25', '2026-11-02T06:00:00-07:00', '2026-11-17T23:30:00-07:00')],
    });
    expect(p).toMatchObject({
      profile: 'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/camtrap-dp-profile.json',
      name: 'sparcd-next-ana',
      title: 'Photos from Ana',
      created: '2026-11-19T07:10:00Z',
      contributors: [{ title: 'Ana', role: 'rightsHolder' }],
      project: { title: 'Example Wildlife Lab', samplingDesign: 'opportunistic' },
      spatial: { type: 'Point', coordinates: [-110.25, 31.5] },
      temporal: { start: '2026-11-02', end: '2026-11-17' },
      taxonomic: [],
    });
    expect(p.licenses).toBeUndefined();
    expect(p.resources).toEqual(
      ['deployments', 'media', 'observations'].map((name) => ({
        name, path: `${name}.csv`, profile: 'tabular-data-resource', format: 'csv', mediatype: 'text/csv', encoding: 'utf-8',
        schema: `https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/${name}-table-schema.json`,
      })),
    );
  });

  it('uses the bounding box, the extreme instants and the distinct species', () => {
    const p = buildDatapackage({
      name: 'sparcd-next-ana', personName: 'Ana', lab,
      deployments: [
        d('a', '31', '-111', '2026-11-02T06:00:00-07:00', '2026-11-10T06:00:00-07:00'),
        d('b', '32', '-110', '2026-11-01T23:30:00-06:00', '2026-11-17T01:00:00+00:00'),
      ],
      observations: [obs('Lynx rufus'), obs(''), obs('Canis latrans'), obs('Lynx rufus')],
    });
    expect(p.spatial).toEqual({ type: 'Polygon', coordinates: [[[-111, 31], [-110, 31], [-110, 32], [-111, 32], [-111, 31]]] });
    expect(p.temporal).toEqual({ start: '2026-11-01', end: '2026-11-17' });
    expect(p.taxonomic).toEqual([{ scientificName: 'Canis latrans' }, { scientificName: 'Lynx rufus' }]);
  });

  it('gives share packages URL paths and the share licenses', () => {
    const sharePaths = { deployments: 'https://s/d', media: 'https://s/m', observations: 'https://s/o' };
    const p = buildDatapackage({
      name: 'sparcd-next-ana-share-k3', personName: 'Ana', lab, observations: [], sharePaths,
      deployments: [d('a', '31.8', '-110.6', '2026-11-02T06:00:00-07:00', '2026-11-17T06:00:00-07:00')],
    });
    expect(p.licenses).toEqual(lab.shareLicenses);
    expect((p.resources as { path: string }[]).map((r) => r.path)).toEqual(Object.values(sharePaths));
  });
});
