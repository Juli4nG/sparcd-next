import type { Deployment } from '@sparcd/bucket';
import { isShared } from './data/card';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Juniper Draw · 17 November 2026": the site, and the day the card came out of the camera. */
export function cardTitle(d: Deployment): string {
  if (isShared(d)) {
    return `Shared card · ${day.format(new Date(`${d.deploymentEnd.slice(0, 10)}T00:00:00Z`))}`;
  }
  const date = d.deploymentID.slice(-10);
  const site = d.locationName || (d.locationID ?? '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return `${site} · ${day.format(new Date(`${date}T00:00:00Z`))}`;
}

/** "Santa Rita Mountains – Cholla Flat – cholla-flat – 46 photos – November 19, 2026", as volunteers describe a card. */
export function cardDescription(d: Deployment, photos: number): string {
  const range = /(?:^|\|)\s*area:([^|]*)/.exec(d.deploymentGroups ?? '')?.[1].trim();
  const site = d.locationName || (d.locationID ?? '');
  const date = day.format(new Date(`${d.deploymentID.slice(-10)}T00:00:00Z`));
  return [range, site, d.locationID ?? '', `${photos.toLocaleString()} photo${photos === 1 ? '' : 's'}`, date].filter(Boolean).join(' – ');
}
