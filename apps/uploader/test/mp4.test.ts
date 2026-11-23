import { describe, expect, it } from 'vitest';
import { mp4Time, stripMp4 } from '../src/send/mp4';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const payload = cat(...children);
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, payload.length + 8);
  head.set(ascii(type), 4);
  return cat(head, payload);
}

/** A box with size 1 and its real size in the 64-bit field after the type. */
function largeBox(type: string, payload: Uint8Array): Uint8Array {
  const head = new Uint8Array(16);
  const view = new DataView(head.buffer);
  view.setUint32(0, 1);
  head.set(ascii(type), 4);
  view.setBigUint64(8, BigInt(payload.length + 16));
  return cat(head, payload);
}

const secondsSince1904 = (iso: string) => (Date.parse(`${iso}Z`) - Date.UTC(1904, 0, 1)) / 1000;

function mvhd(version: 0 | 1, seconds: number): Uint8Array {
  const body = new Uint8Array(version ? 4 + 8 + 8 + 4 + 8 : 4 + 4 + 4 + 4 + 4);
  const view = new DataView(body.buffer);
  body[0] = version;
  if (version) view.setBigUint64(4, BigInt(seconds));
  else view.setUint32(4, seconds);
  return box('mvhd', body);
}

const ftyp = box('ftyp', ascii('isom'), new Uint8Array(4), ascii('isommp41'));
const mdat = (n: number) => box('mdat', new Uint8Array(n).fill(0xab));

describe('mp4Time', () => {
  it('reads a version 0 mvhd creation time as wall-clock text', () => {
    const file = cat(ftyp, mdat(32), box('moov', mvhd(0, secondsSince1904('2026-11-17T06:30:05'))));
    expect(mp4Time(file)).toBe('2026:11:17 06:30:05');
  });

  it('reads a version 1 (64-bit) creation time, past a 64-bit mdat', () => {
    const file = cat(ftyp, largeBox('mdat', new Uint8Array(40)), box('moov', mvhd(1, secondsSince1904('2031-02-03T23:59:59'))));
    expect(mp4Time(file)).toBe('2031:02:03 23:59:59');
  });

  it('treats zero, a time before 2000, and a file without mvhd as missing', () => {
    expect(mp4Time(cat(ftyp, box('moov', mvhd(0, 0))))).toBeUndefined();
    expect(mp4Time(cat(ftyp, box('moov', mvhd(0, secondsSince1904('1999-12-31T23:59:59')))))).toBeUndefined();
    expect(mp4Time(cat(ftyp, mdat(8)))).toBeUndefined();
    expect(mp4Time(ascii('not a video at all'))).toBeUndefined();
  });
});

describe('stripMp4', () => {
  const location = box('\xa9xyz', new Uint8Array(4), ascii('+00.0000+000.0000/'));

  it('turns udta, meta and uuid into zeroed free boxes of the same size, top level and inside moov and trak, and leaves every other byte alone', () => {
    const file = cat(
      ftyp,
      box('uuid', ascii('vendor-serial-0001')),
      mdat(64),
      box(
        'moov',
        mvhd(0, secondsSince1904('2026-11-17T06:30:05')),
        box('trak', box('tkhd', new Uint8Array(20).fill(7)), box('meta', ascii('handler')), box('mdia', box('mdhd', new Uint8Array(12).fill(9)))),
        box('udta', location, box('meta', ascii('ilst-camera'))),
      ),
      box('udta', ascii('top-level user data')),
    );
    const out = stripMp4(file.slice().buffer);
    expect(out.length).toBe(file.length);

    const text = new TextDecoder('latin1').decode(out);
    for (const gone of ['+00.0000', '\xa9xyz', 'udta', 'meta', 'uuid', 'vendor-serial', 'ilst-camera', 'top-level user data']) {
      expect(text).not.toContain(gone);
    }

    // Only the metadata boxes' type names and payloads changed; everything else is byte for byte the same.
    const differing = [...file.keys()].filter((i) => file[i] !== out[i]);
    const metaRanges: [number, number][] = [];
    const scan = (from: number, to: number) => {
      const v = new DataView(file.buffer);
      for (let i = from; i < to; ) {
        const size = v.getUint32(i);
        const type = String.fromCharCode(...file.subarray(i + 4, i + 8));
        if (['udta', 'meta', 'uuid'].includes(type)) metaRanges.push([i + 4, i + size]);
        else if (['moov', 'trak', 'mdia'].includes(type)) scan(i + 8, i + size);
        i += size;
      }
    };
    scan(0, file.length);
    expect(metaRanges).toHaveLength(4);
    expect(differing.every((i) => metaRanges.some(([a, b]) => i >= a && i < b))).toBe(true);
    for (const [a, b] of metaRanges) {
      expect(text.slice(a, a + 4)).toBe('free');
      expect(out.subarray(a + 4, b).every((x) => x === 0)).toBe(true);
    }
  });

  it('handles a 64-bit size and a last box of size 0 that runs to the end', () => {
    const last = box('udta', location);
    new DataView(last.buffer).setUint32(0, 0);
    const file = cat(ftyp, largeBox('uuid', ascii('xmp-gps-data')), box('moov', mvhd(0, 0)), last);
    const out = stripMp4(file.slice().buffer);
    const text = new TextDecoder('latin1').decode(out);
    expect(text).not.toContain('xmp-gps');
    expect(text).not.toContain('+00.0000');
    expect(out.subarray(0, ftyp.length)).toEqual(ftyp);
    // The large box keeps its 64-bit size, the last box its size 0.
    expect(new DataView(out.buffer).getBigUint64(ftyp.length + 8)).toBe(BigInt(16 + 12));
    expect(new DataView(out.buffer).getUint32(file.length - last.length)).toBe(0);
  });

  it('refuses a file whose boxes run past its end', () => {
    const file = cat(ftyp, mdat(16)).subarray(0, ftyp.length + 10);
    expect(() => stripMp4(file.slice().buffer)).toThrow(expect.objectContaining({ name: 'EncodingError' }));
  });
});
