/** Boxes whose payload is only more boxes, walked to find metadata nested inside `moov`. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf']);
/** Boxes that carry camera data: user data (QuickTime `©xyz` location, maker tags), metadata, vendor boxes. */
const METADATA = new Set(['udta', 'meta', 'uuid']);

type Box = { type: string; start: number; payload: number; end: number };

// A per-file failure the Uploader already knows how to skip.
const unreadable = (message: string) => Object.assign(new Error(message), { name: 'EncodingError' });

const typeAt = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** The boxes laid end to end in [from, to). Size 1 means a 64-bit size follows the type; size 0 runs to `to`. */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  for (let i = from; i < to; ) {
    if (i + 8 > to) throw unreadable('MP4 ends inside a box header');
    let size = view.getUint32(i);
    let payload = i + 8;
    if (size === 1) {
      if (i + 16 > to) throw unreadable('MP4 ends inside a box header');
      size = Number(view.getBigUint64(i + 8));
      payload = i + 16;
    } else if (size === 0) size = to - i;
    const end = i + size;
    if (end < payload || end > to) throw unreadable('MP4 box runs past the end');
    out.push({ type: typeAt(b, i + 4), start: i, payload, end });
    i = end;
  }
  return out;
}

const EPOCH_1904 = Date.UTC(1904, 0, 1);
const EARLIEST = Date.UTC(2000, 0, 1);
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The movie's `mvhd` creation time as an EXIF-style `YYYY:MM:DD HH:MM:SS`.
 * Trail cameras write local wall-clock time there, so it carries no offset
 * and takes the lab zone like a photo's DateTimeOriginal. Zero or anything
 * before 2000 is an unset clock: undefined.
 */
export function mp4Time(bytes: Uint8Array): string | undefined {
  try {
    const moov = boxes(bytes, 0, bytes.length).find((x) => x.type === 'moov');
    const mvhd = moov && boxes(bytes, moov.payload, moov.end).find((x) => x.type === 'mvhd');
    if (!mvhd || mvhd.end - mvhd.payload < 12) return undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const seconds = bytes[mvhd.payload] === 1 ? Number(view.getBigUint64(mvhd.payload + 4)) : view.getUint32(mvhd.payload + 4);
    const ms = EPOCH_1904 + seconds * 1000;
    if (ms < EARLIEST) return undefined;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  } catch {
    return undefined;
  }
}

/**
 * The video without camera data: every `udta`, `meta` and `uuid` box, at the
 * top level or anywhere inside `moov`, becomes a `free` box of the same size
 * with a zeroed payload. Sizes don't change, so chunk offsets stay valid.
 */
export function stripMp4(input: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(input.slice(0));
  const walk = (from: number, to: number) => {
    for (const box of boxes(out, from, to)) {
      if (METADATA.has(box.type)) {
        out.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
        out.fill(0, box.payload, box.end);
      } else if (CONTAINERS.has(box.type)) walk(box.payload, box.end);
    }
  };
  walk(0, out.length);
  return out;
}
