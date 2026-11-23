import type { Deployment } from '@sparcd/bucket';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "28 September 2026" from "2026-09-28". */
export const longDate = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));

/** The mountain range: the first of the deploymentGroups that isn't a share marker, without its "area:" label. */
export const rangeOf = (groups: string | undefined) =>
  ((groups ?? '')
    .split('|')
    .map((g) => g.trim())
    .find((g) => g && !g.startsWith('share:')) ?? '').replace(/^[a-z]+:\s*/i, '');

/** Liz's card description: "Mountain range – Site name – Site ID – photo count – date". */
export function cardLine(parts: { range: string; name: string; id: string; count?: string; date: string }): string {
  return [parts.range, parts.name, parts.id, parts.count, longDate(parts.date)].filter(Boolean).join(' – ');
}

export const deploymentLine = (d: Deployment) =>
  cardLine({ range: rangeOf(d.deploymentGroups), name: d.locationName ?? '', id: d.locationID ?? '', date: d.deploymentID.slice(-10) });
