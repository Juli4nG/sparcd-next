import { describe, expect, it } from 'vitest';
import { cameraTime, estimateTimes, formatInZone, instant, localDate, nowTimestamp, timeRange } from '../src';

describe('cameraTime', () => {
  it('uses OffsetTimeOriginal when the camera wrote one', () => {
    expect(cameraTime('2026:11:02 06:15:03', '+02:00', 'America/Phoenix')).toBe('2026-11-02T06:15:03+02:00');
  });

  it('applies the lab zone at that instant, DST included', () => {
    expect(cameraTime('2026:07:01 12:00:00', undefined, 'America/Denver')).toBe('2026-07-01T12:00:00-06:00');
    expect(cameraTime('2026:12:01 12:00:00', undefined, 'America/Denver')).toBe('2026-12-01T12:00:00-07:00');
    expect(cameraTime('2026:07:01 12:00:00', undefined, 'America/Phoenix')).toBe('2026-07-01T12:00:00-07:00');
    expect(cameraTime('2026:12:01 12:00:00', undefined, 'America/Phoenix')).toBe('2026-12-01T12:00:00-07:00');
  });

  it('returns null when there is no usable camera time', () => {
    expect(cameraTime(undefined, undefined, 'America/Phoenix')).toBeNull();
    expect(cameraTime('0000:00:00 00:00:00', undefined, 'America/Phoenix')).toBeNull();
  });
});

describe('time helpers', () => {
  it('formats instants without fractions or Z', () => {
    const ms = Date.UTC(2026, 10, 17, 2, 30, 0, 999);
    expect(formatInZone(ms, 'America/Phoenix')).toBe('2026-11-16T19:30:00-07:00');
    expect(localDate(ms, 'America/Phoenix')).toBe('2026-11-16');
    expect(formatInZone(ms, 'UTC')).toBe('2026-11-17T02:30:00+00:00');
    expect(nowTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('compares as instants', () => {
    expect(timeRange(['2026-11-02T06:00:00-07:00', '2026-11-02T06:30:00-06:00'])).toEqual([
      '2026-11-02T06:30:00-06:00',
      '2026-11-02T06:00:00-07:00',
    ]);
  });
});

describe('estimateTimes', () => {
  const shot = (name: string, timestamp: string | null, lastModified = 0) => ({ id: name, name, timestamp, lastModified });

  it('interpolates between neighbours in natural file-name order', () => {
    const estimates = estimateTimes(
      [
        shot('DCIM/IMG_10.JPG', '2026-11-02T06:10:00-07:00'),
        shot('DCIM/IMG_9.JPG', null),
        shot('DCIM/IMG_8.JPG', '2026-11-02T06:00:00-07:00'),
      ],
      'America/Phoenix',
    );
    expect([...estimates]).toEqual([['DCIM/IMG_9.JPG', '2026-11-02T06:05:00-07:00']]);
  });

  it('steps 10 minutes from the nearest photo when only one side has a time', () => {
    const estimates = estimateTimes(
      [shot('a1.jpg', null), shot('a2.jpg', null), shot('a3.jpg', '2026-11-02T06:30:00+02:00'), shot('a4.jpg', null)],
      'America/Phoenix',
    );
    expect(estimates.get('a1.jpg')).toBe('2026-11-02T06:10:00+02:00');
    expect(estimates.get('a2.jpg')).toBe('2026-11-02T06:20:00+02:00');
    expect(estimates.get('a4.jpg')).toBe('2026-11-02T06:40:00+02:00');
  });

  it('falls back to the modified time in the lab zone', () => {
    const estimates = estimateTimes([shot('x.jpg', null, Date.UTC(2026, 6, 1, 18))], 'America/Denver');
    expect(estimates.get('x.jpg')).toBe('2026-07-01T12:00:00-06:00');
    expect(instant(estimates.get('x.jpg')!)).toBe(Date.UTC(2026, 6, 1, 18));
  });
});
