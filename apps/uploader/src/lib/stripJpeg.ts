const ICC = 'ICC_PROFILE\0';

/** Segments a decoder needs: tables and frame headers, JFIF, the color profile, Adobe's color transform. */
function keep(marker: number, payload: Uint8Array): boolean {
  if (marker === 0xfe) return false;
  if (marker < 0xe0 || marker > 0xef) return true;
  if (marker === 0xe0 || marker === 0xee) return true;
  return marker === 0xe2 && String.fromCharCode(...payload.subarray(0, ICC.length)) === ICC;
}

/**
 * The photo without camera data: no EXIF (time, GPS, camera serial, maker
 * notes), XMP, IPTC, comments, or bytes after the image. The time the tables
 * need is read before this. Image data is copied unchanged.
 */
export function stripJpeg(input: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(input);
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG');
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    if (i + 4 > b.length || b[i] !== 0xff) throw new Error('JPEG ends before its image data');
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda) {
      // Inside image data a 0xFF byte is followed by 0x00 or a restart marker,
      // so the first FF D9 after the scan header is the end of the image.
      let end = i + 2;
      while (end + 1 < b.length && !(b[end] === 0xff && b[end + 1] === 0xd9)) end += 1;
      if (end + 1 >= b.length) throw new Error('JPEG has no end marker');
      parts.push(b.subarray(i, end + 2));
      break;
    }
    const end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (end > b.length) throw new Error('JPEG segment runs past the end');
    if (keep(marker, b.subarray(i + 4, end))) parts.push(b.subarray(i, end));
    i = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
