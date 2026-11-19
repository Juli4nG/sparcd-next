import type { Deployment } from '@sparcd/bucket';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "28 September 2026" from "2026-09-28". */
export const longDate = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));

/** The mountain range: the first of the deploymentGroups that isn't a share marker. */
export const rangeOf = (groups: string | undefined) =>
  (groups ?? '')
    .split('|')
    .map((g) => g.trim())
    .find((g) => g && !g.startsWith('share:')) ?? '';

/** Liz's card description: "Mountain range – Site name – Site ID – photo count – date". */
export function cardLine(parts: { range: string; name: string; id: string; photos?: number; date: string }): string {
  const count = parts.photos === undefined ? '' : `${parts.photos.toLocaleString()} photo${parts.photos === 1 ? '' : 's'}`;
  return [parts.range, parts.name, parts.id, count, longDate(parts.date)].filter(Boolean).join(' – ');
}

export const deploymentLine = (d: Deployment, photos?: number) =>
  cardLine({ range: rangeOf(d.deploymentGroups), name: d.locationName ?? '', id: d.locationID ?? '', photos, date: d.deploymentID.slice(-10) });
