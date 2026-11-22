import { describe, expect, it } from 'vitest';
import { count, formatBytes, number, timeLeft } from '../src/send/words';

const MIN = 60_000;

describe('timeLeft', () => {
  it('says less than a minute below half a minute', () => {
    expect(timeLeft(0)).toBe('Less than a minute left');
    expect(timeLeft(29_999)).toBe('Less than a minute left');
  });

  it('rounds to the nearest minute under an hour', () => {
    expect(timeLeft(30_000)).toBe('About 1 minute left');
    expect(timeLeft(89_000)).toBe('About 1 minute left');
    expect(timeLeft(90_000)).toBe('About 2 minutes left');
    expect(timeLeft(59 * MIN)).toBe('About 59 minutes left');
  });

  it('switches to hours and minutes from sixty minutes, dropping a zero remainder', () => {
    expect(timeLeft(60 * MIN)).toBe('About 1 hour left');
    expect(timeLeft(61 * MIN)).toBe('About 1 hour 1 minute left');
    expect(timeLeft(125 * MIN)).toBe('About 2 hours 5 minutes left');
    expect(timeLeft(1500 * MIN)).toBe('About 25 hours left');
  });

  it('rounds 59.6 minutes up into an hour rather than showing 60 minutes', () => {
    expect(timeLeft(59.6 * MIN)).toBe('About 1 hour left');
  });
});

describe('count and number', () => {
  it('pluralizes and groups thousands', () => {
    expect(count(1, 'photo')).toBe('1 photo');
    expect(count(0, 'photo')).toBe('0 photos');
    expect(count(1234, 'photo')).toBe('1,234 photos');
    expect(number(1234567)).toBe('1,234,567');
  });
});

describe('formatBytes', () => {
  it('uses one decimal under ten, none above, and steps up each 1024', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatBytes(2000 * 1024 ** 3)).toBe('2000 GB');
  });
});
