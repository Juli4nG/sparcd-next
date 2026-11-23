import type { Site } from '@sparcd/bucket';
import type { CardFile } from './scan';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

/** The folder the photos came from: the first part of their path, when they sit in one. */
export function folderOf(card: CardFile[]): string {
  const first = card[0]?.path ?? '';
  return first.includes('/') ? first.slice(0, first.indexOf('/')) : '';
}

/** Liz's folders read "WHE19_09.28.26_119.images": Site ID, the day the card came out (MM.DD.YY), photo count. */
export function guessFromFolder(folder: string, sites: Site[]): { site?: Site; date?: string } {
  const m = /^([^_]+)_(\d{2})\.(\d{2})\.(\d{2})(?:_|\.|$)/.exec(folder);
  if (!m) return {};
  const site = sites.find((s) => s.locationID.toLowerCase() === m[1].toLowerCase());
  const date = `20${m[4]}-${m[2]}-${m[3]}`;
  const valid = !Number.isNaN(Date.parse(`${date}T12:00:00`)) && date <= daysAgo(0);
  return { site, date: valid ? date : undefined };
}
