import { describe, expect, it } from 'vitest';
import {
  applyFilePublic,
  burstEventId,
  deploymentId,
  isLocationId,
  isPersonCode,
  mergeDeployments,
  mergeMedia,
  newShareId,
  replaceObservations,
  shareTables,
  storedName,
  tagRows,
  type Deployment,
  type Media,
} from '../src';

const M1 = '1'.repeat(64);
const M2 = '2'.repeat(64);

const deployment = (start: string, end: string, extra: Partial<Deployment> = {}): Deployment => ({
  deploymentID: 'juniper-draw_2026-11-17', latitude: '31.84213', longitude: '-110.61942',
  deploymentStart: start, deploymentEnd: end, ...extra,
});
const media = (mediaID: string, extra: Partial<Media> = {}): Media => ({
  mediaID, deploymentID: 'juniper-draw_2026-11-17', timestamp: '2026-11-02T06:00:00-07:00',
  filePath: `Media/${mediaID}/IMG_1.JPG`, filePublic: 'true', fileMediatype: 'image/jpeg', ...extra,
});

describe('ids', () => {
  it('follows FORMAT.md', () => {
    expect(deploymentId('juniper-draw', '2026-11-17')).toBe('juniper-draw_2026-11-17');
    expect(burstEventId('juniper-draw_2026-11-17', M1)).toBe('juniper-draw_2026-11-17-111111111111');
    expect(newShareId()).toMatch(/^[a-z2-7]{26}$/);
    expect([isPersonCode('ana'), isPersonCode('a'), isPersonCode('admin'), isPersonCode('9ana')]).toEqual([true, false, false, false]);
    expect([isLocationId('juniper-draw'), isLocationId('Juniper'), isLocationId('a--b')]).toEqual([true, false, false]);
    expect([storedName('THUMB.JPG'), storedName('view.jpg'), storedName('IMG_1.JPG')]).toEqual([
      'original-THUMB.JPG', 'original-view.jpg', 'IMG_1.JPG',
    ]);
  });
});

describe('merge', () => {
  it('widens a known deployment and keeps its other values', () => {
    const old = deployment('2026-11-02T06:00:00-07:00', '2026-11-10T06:00:00-07:00', { cameraModel: 'Acme-T1' });
    const [merged] = mergeDeployments([old], [deployment('2026-11-01T05:00:00-06:00', '2026-11-05T00:00:00-07:00', { cameraModel: 'Other' })], 'widen');
    expect(merged).toEqual({ ...old, deploymentStart: '2026-11-01T05:00:00-06:00' });
  });

  it('only inserts copied deployments that are absent', () => {
    const old = deployment('2026-11-02T06:00:00-07:00', '2026-11-10T06:00:00-07:00');
    const copy = deployment('2026-11-01T00:00:00-07:00', '2026-11-20T00:00:00-07:00');
    const other = { ...copy, deploymentID: 'mesa_2026-11-17' };
    expect(mergeDeployments([old], [copy, other], 'insert')).toEqual([old, other]);
  });

  it('keeps media insert-only', () => {
    const first = media(M1);
    expect(mergeMedia([first], [media(M1, { deploymentID: 'mesa_2026-11-17' }), media(M2), media(M2)])).toEqual([first, media(M2)]);
  });

  it('replaces every observation row of the saved photos', () => {
    const tagged = [...tagRows(media(M1), [{ observationType: 'animal', scientificName: 'Lynx rufus' }, { observationType: 'human', scientificName: 'Homo sapiens' }], 'ana'),
      ...tagRows(media(M2), [{ observationType: 'blank' }], 'ana')];
    const retagged = tagRows(media(M1), [{ observationType: 'unknown', count: 2 }], 'ana');
    const result = replaceObservations(tagged, [M1], retagged);
    expect(result.map((o) => o.observationID)).toEqual([`${M2}-ana-1`, `${M1}-ana-1`]);
    expect(replaceObservations(result, [M1], []).map((o) => o.mediaID)).toEqual([M2]);
  });

  it('turns filePublic off for a human row and back on once none remains', () => {
    const rows = [media(M1), media(M2)];
    const human = tagRows(media(M1), [{ observationType: 'human', scientificName: 'Homo sapiens' }], 'ana');
    const hidden = applyFilePublic(rows, human, [M1, M2]);
    expect(hidden.map((m) => m.filePublic)).toEqual(['false', 'true']);
    expect(applyFilePublic(hidden, [], [M1]).map((m) => m.filePublic)).toEqual(['true', 'true']);
  });
});

describe('tagRows', () => {
  it('writes media-level rows per FORMAT.md', () => {
    const at = '2026-11-19T09:00:00-07:00';
    const [animal, blank, unknown, human] = tagRows(
      media(M1),
      [
        { observationType: 'animal', scientificName: 'Lynx rufus', count: 2 },
        { observationType: 'blank', scientificName: 'ignored' },
        { observationType: 'unknown' },
        { observationType: 'human', scientificName: 'Homo sapiens' },
      ],
      'ana',
      { timestamp: at, eventID: 'e1' },
    );
    expect(animal).toMatchObject({
      observationID: `${M1}-ana-1`, deploymentID: 'juniper-draw_2026-11-17', mediaID: M1, eventID: 'e1',
      eventStart: '2026-11-02T06:00:00-07:00', eventEnd: '2026-11-02T06:00:00-07:00', observationLevel: 'media',
      scientificName: 'Lynx rufus', count: '2', classificationMethod: 'human', classifiedBy: 'ana', classificationTimestamp: at,
    });
    expect([blank.scientificName, blank.count]).toEqual(['', '']);
    expect([unknown.scientificName, unknown.count]).toEqual(['', '1']);
    expect([human.scientificName, human.count, human.observationID]).toEqual(['Homo sapiens', '1', `${M1}-ana-4`]);
  });
});

describe('shareTables', () => {
  it('keeps only shared, public rows with rounded positions', () => {
    const share = { id: 'k3', createdAt: '', expiresAt: '', deploymentIDs: ['juniper-draw_2026-11-17'], positionDecimals: 1, image: 'view' as const };
    const d = deployment('2026-11-02T06:00:00-07:00', '2026-11-10T06:00:00-07:00', { locationName: 'Juniper Draw', deploymentGroups: 'area:East' });
    const out = shareTables(
      { deployments: [d, { ...d, deploymentID: 'mesa_2026-11-17' }], media: [media(M1), media(M2, { filePublic: 'false' })], observations: [] },
      share,
    );
    expect(out.deployments).toEqual([{ ...d, latitude: '31.8', longitude: '-110.6', coordinateUncertainty: '8000', locationName: '', deploymentGroups: 'area:East | share:k3' }]);
    expect(out.media.map((m) => m.filePath)).toEqual([`Media/${M1}/view.jpg`]);
    expect(out.observations).toEqual([]);
  });
});
