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
