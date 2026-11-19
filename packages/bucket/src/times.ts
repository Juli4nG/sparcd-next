import { captureTimestampInZone, normalizeCaptureTimestamp } from '@sparcd/camtrap';

/** Times are `YYYY-MM-DDTHH:MM:SS±HH:MM`; compare them as instants, never as text. */
export const instant = (timestamp: string): number => Date.parse(timestamp);

export const ESTIMATED_TIME_COMMENT = 'Time estimated from nearby photos.';

function offsetText(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const offsetMinutes = (timestamp: string): number => {
  const [, sign, h, m] = /([+-])(\d{2}):(\d{2})$/.exec(timestamp)!;
  return (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(m));
};

export function formatAtOffset(ms: number, minutes: number): string {
  const wall = new Date(Math.floor(ms / 1000) * 1000 + minutes * 60_000).toISOString().slice(0, 19);
  return wall + offsetText(minutes);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneOffsetMinutes(ms: number, timeZone: string): number {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

export const formatInZone = (ms: number, timeZone: string): string =>
  formatAtOffset(ms, zoneOffsetMinutes(ms, timeZone));

/** `YYYY-MM-DD` of an instant in a zone, e.g. the day a card came out of the camera. */
export const localDate = (ms: number, timeZone: string): string => formatInZone(ms, timeZone).slice(0, 10);

/** The browser clock with its own offset, for `classificationTimestamp`. */
export const nowTimestamp = (): string => formatAtOffset(Date.now(), -new Date().getTimezoneOffset());

const stripFraction = (t: string) => t.replace(/\.\d+/, '');

/**
 * Camera time from raw EXIF strings (exifr with `reviveValues: false`):
 * `DateTimeOriginal` (`YYYY:MM:DD HH:MM:SS`) with `OffsetTimeOriginal` when present,
 * else the lab zone at that instant. Null when the camera wrote no usable time.
 */
export function cameraTime(dateTimeOriginal: unknown, offsetTimeOriginal: unknown, timeZone: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(dateTimeOriginal ?? ''));
  if (!m) return null;
  const wall = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const offset = String(offsetTimeOriginal ?? '');
  try {
    return stripFraction(
      /^[+-]\d{2}:\d{2}$/.test(offset) ? normalizeCaptureTimestamp(wall + offset) : captureTimestampInZone(wall, timeZone),
    );
  } catch {
    // Cameras with an unset clock write values like 0000:00:00 00:00:00.
    return null;
  }
}

/** Earliest and latest of some timestamps, compared as instants. */
export function timeRange(timestamps: string[]): [string, string] {
  const sorted = [...timestamps].sort((a, b) => instant(a) - instant(b));
  return [sorted[0], sorted[sorted.length - 1]];
}

export type Shot = {
  id: string;
  /** Relative path on the card; neighbours are found in natural order of this. */
  name: string;
  timestamp: string | null;
  lastModified: number;
};

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Times for shots without a camera time, ported from the old Uploader's
 * estimateCaptureTime: interpolate between the neighbours that have one, else
 * step 10 minutes per photo from the nearest one, else the file's modified time
 * in the lab zone. Estimates carry their reference neighbour's offset.
 */
export function estimateTimes(shots: Shot[], timeZone: string): Map<string, string> {
  const ordered = [...shots].sort((a, b) => collator.compare(a.name, b.name));
  const estimates = new Map<string, string>();
  let previous: Shot | undefined;
  let start = 0;
  while (start < ordered.length) {
    if (ordered[start].timestamp) {
      previous = ordered[start++];
      continue;
    }
    let end = start;
    while (end < ordered.length && !ordered[end].timestamp) end++;
    const next = ordered[end] as Shot | undefined;
    const p = previous?.timestamp;
    const n = next?.timestamp;
    const k = end - start;
    for (let j = start; j < end; j++) {
      const i = j - start + 1;
      let estimate: string;
      if (p && n) estimate = formatAtOffset(instant(p) + (i * (instant(n) - instant(p))) / (k + 1), offsetMinutes(p));
      else if (p) estimate = formatAtOffset(instant(p) + 600_000 * i, offsetMinutes(p));
      else if (n) estimate = formatAtOffset(instant(n) - 600_000 * (k + 1 - i), offsetMinutes(n));
      else estimate = formatInZone(ordered[j].lastModified, timeZone);
      estimates.set(ordered[j].id, estimate);
    }
    start = end;
  }
  return estimates;
}
