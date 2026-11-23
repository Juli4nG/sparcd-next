/** Boxes whose payload is only more boxes, walked to find metadata nested inside `moov`. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf']);
/** Boxes that carry camera data: user data (QuickTime `©xyz` location, maker tags), metadata, vendor boxes. */
const METADATA = new Set(['udta', 'meta', 'uuid']);
/** Free space, where some cameras leave logs: the payload is zeroed. */
const FREE_SPACE = new Set(['free', 'skip']);
/** Handlers of tracks whose samples can hold GPS: timed metadata, and the text and subtitle tracks some cameras use. */
const DATA_HANDLERS = new Set(['meta', 'sbtl', 'text', 'subt']);
/** Sample formats of the same: GoPro GPMF, Google CAMM, generic and QuickTime metadata, timed text. */
const DATA_SAMPLES = new Set(['gpmd', 'camm', 'mett', 'mebx', 'tx3g', 'text', 'wvtt', 'stpp']);
/** Real files nest a few levels and hold a few hundred boxes; a file past these is left out. */
const MAX_DEPTH = 16;
const MAX_BOXES = 100_000;

type Box = { type: string; start: number; payload: number; end: number };

// A per-file failure the Uploader already knows how to skip.
const unreadable = (message: string) => Object.assign(new Error(message), { name: 'EncodingError' });

/** The name of the error for a video whose camera data can't be found to remove. It is never uploaded. */
export const NOT_CLEANED = 'CameraDataError';
const notCleaned = (message: string) => Object.assign(new Error(message), { name: NOT_CLEANED });

const wholeFile = (b: Uint8Array): Box => ({ type: '', start: 0, payload: 0, end: b.length });
const typeAt = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** Reads one file's boxes, counting every box visited against MAX_BOXES. */
function reader(b: Uint8Array) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let visited = 0;

  /** The boxes laid end to end in [from, to). Size 1 means a 64-bit size follows the type; size 0 runs to `to`. */
  function* boxes(from: number, to: number): Generator<Box> {
    for (let i = from; i < to; ) {
      if (++visited > MAX_BOXES) throw unreadable('MP4 has too many boxes');
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
      yield { type: typeAt(b, i + 4), start: i, payload, end };
      i = end;
    }
  }

  const find = (type: string, inside?: Box) => {
    if (!inside) return undefined;
    for (const box of boxes(inside.payload, inside.end)) if (box.type === type) return box;
    return undefined;
  };

  return { view, boxes, find };
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
    const { view, find } = reader(bytes);
    const mvhd = find('mvhd', find('moov', wholeFile(bytes)));
    if (!mvhd || mvhd.end - mvhd.payload < 12) return undefined;
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
 * with a zeroed payload, every `free` and `skip` box's payload is zeroed, and
 * every sample of a timed metadata, text or subtitle track (GPS and the like,
 * stored in `mdat`) is zeroed in place. Sizes don't change, so chunk offsets
 * stay valid and the video still plays. A compressed movie header, or such a
 * track whose samples can't all be found, throws NOT_CLEANED. Works in place,
 * so a large video is held once.
 */
export function stripMp4(input: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(input);
  const r = reader(out);
  const tracks: Box[] = [];
  const mdats: Box[] = [];
  let fragmented = false;
  const walk = (from: number, to: number, depth: number) => {
    if (depth > MAX_DEPTH) throw unreadable('MP4 nests too deep');
    for (const box of r.boxes(from, to)) {
      if (box.type === 'cmov') throw notCleaned('MP4 movie header is compressed');
      if (box.type === 'mvex' || box.type === 'moof') fragmented = true;
      if (box.type === 'trak') tracks.push(box);
      if (METADATA.has(box.type)) {
        out.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
        out.fill(0, box.payload, box.end);
      } else if (FREE_SPACE.has(box.type)) out.fill(0, box.payload, box.end);
      else if (box.type === 'mdat') mdats.push(box);
      else if (CONTAINERS.has(box.type)) walk(box.payload, box.end, depth + 1);
    }
  };
  walk(0, out.length, 0);
  // After the walk, so zeroing samples can't hide a box from it.
  const ranges: [number, number][] = [];
  for (const trak of tracks) {
    const stbl = r.find('stbl', r.find('minf', r.find('mdia', trak)));
    if (!holdsCameraData(r, out, trak, stbl)) continue;
    // Fragments carry samples that the sample table doesn't list.
    if (fragmented) throw notCleaned('MP4 is fragmented and has a metadata track');
    sampleRanges(r, ranges, stbl);
  }
  // All are checked before any is zeroed: a sample table pointing outside
  // the media data is a malformed file, left out whole.
  let mdat: Box | undefined;
  for (const [from, to] of ranges) {
    const inside = (m?: Box) => !!m && from >= m.payload && to <= m.end;
    if (!inside(mdat)) mdat = mdats.find(inside);
    if (!mdat) throw unreadable('MP4 sample lies outside mdat');
  }
  for (const [from, to] of ranges) out.fill(0, from, to);
  return out;
}

type Reader = ReturnType<typeof reader>;

// Boxes inside a video or audio sample entry (`avc1` extensions and the like)
// are left as they are: the accepted remaining risk.
function holdsCameraData(r: Reader, b: Uint8Array, trak: Box, stbl?: Box): boolean {
  const hdlr = r.find('hdlr', r.find('mdia', trak));
  if (hdlr && hdlr.end - hdlr.payload >= 12 && DATA_HANDLERS.has(typeAt(b, hdlr.payload + 8))) return true;
  const stsd = r.find('stsd', stbl);
  if (!stsd || stsd.end - stsd.payload < 8) return false;
  for (const entry of r.boxes(stsd.payload + 8, stsd.end)) if (DATA_SAMPLES.has(entry.type)) return true;
  return false;
}

/** Adds every sample range of a track, chunk by chunk: `stco`/`co64` place chunks, `stsc` counts their samples, `stsz` sizes them. */
function sampleRanges(r: Reader, ranges: [number, number][], stbl?: Box) {
  const { view } = r;
  const stsz = r.find('stsz', stbl);
  const stsc = r.find('stsc', stbl);
  const stco = r.find('stco', stbl) ?? r.find('co64', stbl);
  if (!stsz || !stsc || !stco) throw notCleaned('MP4 metadata track has no sample table this reads');
  // Each table is a version and flags, a count or two, then its entries, all inside its box.
  const need = (box: Box, bytes: number) => {
    if (box.payload + bytes > box.end) throw unreadable('MP4 sample table runs past its box');
  };
  need(stsz, 12);
  need(stsc, 8);
  need(stco, 8);
  const uniform = view.getUint32(stsz.payload + 4);
  const samples = view.getUint32(stsz.payload + 8);
  if (!uniform) need(stsz, 12 + samples * 4);
  const runs = view.getUint32(stsc.payload + 4);
  need(stsc, 8 + runs * 12);
  const wide = stco.type === 'co64';
  const chunks = view.getUint32(stco.payload + 4);
  need(stco, 8 + chunks * (wide ? 8 : 4));

  const firstChunk = (run: number) => view.getUint32(stsc.payload + 8 + run * 12);
  let sample = 0;
  let run = 0;
  for (let chunk = 0; chunk < chunks && sample < samples; chunk++) {
    while (run + 1 < runs && firstChunk(run + 1) <= chunk + 1) run++;
    const n = Math.min(runs ? view.getUint32(stsc.payload + 8 + run * 12 + 4) : 0, samples - sample);
    let bytes = n * uniform;
    if (!uniform) for (let k = 0; k < n; k++) bytes += view.getUint32(stsz.payload + 12 + (sample + k) * 4);
    sample += n;
    const at = wide ? Number(view.getBigUint64(stco.payload + 8 + chunk * 8)) : view.getUint32(stco.payload + 8 + chunk * 4);
    if (bytes) ranges.push([at, at + bytes]);
  }
  if (sample < samples) throw unreadable('MP4 sample table places fewer samples than it counts');
}
