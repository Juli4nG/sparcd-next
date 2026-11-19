import { describe, expect, it } from 'vitest';
import { COLUMNS, parseCsv, parseTable, serializeTable, toCsv, type Media } from '../src';

describe('csv', () => {
  it('refuses malformed files instead of reading them wrongly', () => {
    expect(() => parseCsv('a,b\n"1,2\n3,4\n')).toThrow(/unclosed quote/);
    expect(() => parseCsv('a,a\n1,2\n')).toThrow(/repeats/);
  });

  it('has the Camtrap DP 1.0 column counts', () => {
    expect([COLUMNS.deployments.length, COLUMNS.media.length, COLUMNS.observations.length]).toEqual([24, 11, 28]);
  });

  it('quotes only fields that need it and round-trips them', () => {
    const rows = [{ a: 'plain', b: 'with, comma', c: 'say "hi"' }, { a: 'two\nlines', b: '', c: 'cr\rhere' }];
    const text = toCsv(['a', 'b', 'c'], rows);
    expect(text).toBe('a,b,c\nplain,"with, comma","say ""hi"""\n"two\nlines",,"cr\rhere"\n');
    expect(parseCsv(text)).toEqual(rows);
  });

  it('reads CRLF, a BOM, unknown columns and missing columns', () => {
    const text = '﻿mediaID,extra,timestamp\r\nm1,x,2026-11-02T06:15:03-07:00\r\n\r\n';
    const [row] = parseTable('media', text);
    expect(row.mediaID).toBe('m1');
    expect(row.timestamp).toBe('2026-11-02T06:15:03-07:00');
    expect(row.fileName).toBe('');
    expect(Object.keys(row)).toEqual([...COLUMNS.media]);
  });

  it('writes the full column set in FORMAT.md row order, comparing times as instants', () => {
    const media = (mediaID: string, deploymentID: string, timestamp: string): Media => ({
      mediaID, deploymentID, timestamp, filePath: `Media/${mediaID}/a.jpg`, filePublic: 'true', fileMediatype: 'image/jpeg',
    });
    const text = serializeTable('media', [
      media('c', 'site-b_2026-11-17', '2026-11-02T06:00:00-07:00'),
      // 06:30-06:00 is 12:30Z, before 06:00-07:00 (13:00Z) though its text sorts after.
      media('b', 'site-a_2026-11-17', '2026-11-02T06:30:00-06:00'),
      media('a', 'site-a_2026-11-17', '2026-11-02T06:00:00-07:00'),
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toBe(COLUMNS.media.join(','));
    expect(lines.slice(1, 4).map((l) => l.split(',')[0])).toEqual(['b', 'a', 'c']);
    expect(lines[1].split(',')).toHaveLength(11);
    expect(text.endsWith('\n')).toBe(true);
  });
});
