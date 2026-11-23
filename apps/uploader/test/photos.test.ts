import { describe, expect, it } from 'vitest';
import { deploymentRow, mediaRow, planSend, toPhotos, type Photo } from '../src/send/photos';

const id = (c: string) => c.repeat(64);
const photo = (c: string, name = `IMG_${c}.JPG`): Photo => ({
  path: `DCIM/${name}`,
  file: new File([], name),
  mediaID: id(c),
  timestamp: '2026-11-17T10:00:00-07:00',
  estimated: false,
});

describe('planSend', () => {
  it('skips rows already in media.csv, rows-only fully stored photos, sends the rest', () => {
    const a = photo('a');
    const b = photo('b');
    const c = photo('c');
    const stored = new Set([`Media/${id('b')}/IMG_b.JPG`, `Media/${id('b')}/thumb.jpg`, `Media/${id('b')}/view.jpg`, `Media/${id('c')}/IMG_c.JPG`]);
    const plan = planSend([a, b, c], new Set([id('a')]), stored);
    expect(plan.skip).toEqual([a]);
    expect(plan.rowOnly).toEqual([b]);
    expect(plan.send).toEqual([{ photo: c, missing: ['thumb', 'view'] }]);
  });

  it('sends a second copy of the same photo once', () => {
    const first = photo('d', 'IMG_1.JPG');
    const copy = photo('d', 'IMG_2.JPG');
    const plan = planSend([first, copy], new Set(), new Set());
    expect(plan.send.map((s) => s.photo)).toEqual([first]);
    expect(plan.skip).toEqual([copy]);
  });

  it('keys an original named like a derived image as original-<name>', () => {
    const p = photo('e', 'thumb.jpg');
    const stored = new Set([`Media/${id('e')}/original-thumb.jpg`, `Media/${id('e')}/thumb.jpg`, `Media/${id('e')}/view.jpg`]);
    expect(planSend([p], new Set(), stored).rowOnly).toEqual([p]);
    expect(mediaRow(p, 'x_2026-11-17').filePath).toBe(`Media/${id('e')}/original-thumb.jpg`);
  });
});

describe('rows', () => {
  it('estimates a photo with no camera time and marks it', () => {
    const card = ['IMG_1.JPG', 'IMG_2.JPG', 'IMG_3.JPG'].map((n) => ({ path: n, file: new File([], n) }));
    const photos = toPhotos(
      card,
      [
        { sha256: id('1'), dateTimeOriginal: '2026:11:17 10:00:00', make: 'Acme', model: 'Cam' },
        { sha256: id('2') },
        { sha256: id('3'), dateTimeOriginal: '2026:11:17 10:10:00' },
      ],
      'America/Phoenix',
    );
    expect(photos.map((p) => p.timestamp)).toEqual([
      '2026-11-17T10:00:00-07:00',
      '2026-11-17T10:05:00-07:00',
      '2026-11-17T10:10:00-07:00',
    ]);
    expect(mediaRow(photos[1], 'x').mediaComments).toBe('Time estimated from nearby photos.');
    expect(photos[0].camera).toBe('Acme-Cam');
    const site = { locationID: 'x', locationName: 'X', latitude: 31.5, longitude: -110.5, deploymentGroups: '' };
    const d = deploymentRow(site, 'x_2026-11-17', photos.map((p) => mediaRow(p, 'x_2026-11-17')), 'Acme-Cam');
    expect([d.deploymentStart, d.deploymentEnd]).toEqual(['2026-11-17T10:00:00-07:00', '2026-11-17T10:10:00-07:00']);
  });
});

describe('mediaRow', () => {
  it('gives each file its media type by extension', () => {
    expect(mediaRow(photo('a', 'IMG_1.JPG'), 'x').fileMediatype).toBe('image/jpeg');
    expect(mediaRow(photo('b', 'VID_1.MP4'), 'x').fileMediatype).toBe('video/mp4');
    expect(mediaRow(photo('c', 'clip.mov'), 'x').fileMediatype).toBe('video/quicktime');
    expect(mediaRow(photo('d', 'VID_1.MP4'), 'x').filePath).toBe(`Media/${id('d')}/VID_1.MP4`);
  });
});

