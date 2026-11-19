const startsWith = (payload: Uint8Array, tag: string) =>
  payload.length >= tag.length && String.fromCharCode(...payload.subarray(0, tag.length)) === tag;

/** Segments a decoder needs: tables and frame headers, JFIF, the color profile, Adobe's color transform. */
function keep(marker: number, payload: Uint8Array): boolean {
  if (marker === 0xfe) return false;
  if (marker < 0xe0 || marker > 0xef) return true;
  if (marker === 0xe0) return startsWith(payload, 'JFIF\0');
  if (marker === 0xe2) return startsWith(payload, 'ICC_PROFILE\0');
  if (marker === 0xee) return startsWith(payload, 'Adobe');
  return false;
}

// A per-photo failure the Uploader already knows how to skip.
const unreadable = (message: string) => Object.assign(new Error(message), { name: 'EncodingError' });

/**
 * The photo without camera data: no EXIF (time, GPS, camera serial, maker
 * notes), XMP, IPTC, comments, or bytes after the image. The time the tables
 * need is read before this. Image data is copied unchanged; a progressive
 * photo's later scans and tables are walked the same way as the first.
 */
export function stripJpeg(input: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(input);
  if (b[0] !== 0xff || b[1] !== 0xd8) throw unreadable('not a JPEG');
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    if (i + 2 > b.length || b[i] !== 0xff) throw unreadable('JPEG ends before its end marker');
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      break;
    }
    if (i + 4 > b.length) throw unreadable('JPEG ends inside a segment');
    let end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (end > b.length) throw unreadable('JPEG segment runs past the end');
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker: 0xFF is followed by a
      // stuffed 0x00 or a restart marker inside it, by anything else after it.
      while (end < b.length && !(b[end] === 0xff && b[end + 1] !== 0x00 && (b[end + 1] < 0xd0 || b[end + 1] > 0xd7))) {
        end += 1;
      }
      parts.push(b.subarray(i, end));
    } else if (keep(marker, b.subarray(i + 4, end))) {
      parts.push(b.subarray(i, end));
    }
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
