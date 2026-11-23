import { describe, expect, it } from 'vitest';
import { stripJpeg } from '../src/send/stripJpeg';

const seg = (marker: number, payload: string) => {
  const body = new TextEncoder().encode(payload);
  return [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
};
const SOS = [0xff, 0xda, 0x00, 0x02, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
const jpeg = new Uint8Array([
  0xff, 0xd8,
  ...seg(0xe0, 'JFIF\0x'),
  ...seg(0xe1, 'Exif\0\0GPS 31.1234 -110.5678 serial 42'),
  ...seg(0xe2, 'ICC_PROFILE\0p'),
  ...seg(0xe2, 'FPXR\0x'),
  ...seg(0xed, 'Photoshop 3.0\0iptc'),
  ...seg(0xfe, 'a comment'),
  ...seg(0xdb, 'tables'),
  ...seg(0xc0, 'frame'),
  ...SOS,
  0xff, 0xd9,
  ...new TextEncoder().encode('trailing camera data'),
]);
const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

describe('stripJpeg', () => {
  it('keeps what a decoder needs and drops camera data, comments and trailing bytes', () => {
    const out = text(stripJpeg(jpeg.slice().buffer));
    for (const kept of ['JFIF', 'ICC_PROFILE', 'tables', 'frame']) expect(out).toContain(kept);
    for (const gone of ['Exif', 'GPS', 'FPXR', 'Photoshop', 'comment', 'trailing']) expect(out).not.toContain(gone);
    expect(out.endsWith('\x56\xff\xd9')).toBe(true);
  });

  it('walks every scan of a progressive photo, dropping metadata between scans', () => {
    const between = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xdb, 'tables'),
      ...SOS.slice(0, -1),
      ...seg(0xfe, 'mid comment ÿÙ fake end'),
      ...seg(0xc4, 'huffman'),
      ...SOS,
      0xff, 0xd9,
    ]);
    const out = text(stripJpeg(between.slice().buffer));
    expect(out).not.toContain('comment');
    expect(out).toContain('huffman');
    expect(out.split('ÿÚ')).toHaveLength(3);
    expect(out.endsWith('VÿÙ')).toBe(true);
  });

  it('refuses something that is not a whole JPEG', () => {
    expect(() => stripJpeg(new TextEncoder().encode('not a photo').buffer)).toThrow();
    expect(() => stripJpeg(jpeg.slice(0, 40).buffer)).toThrow();
  });
});
