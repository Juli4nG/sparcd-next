import type { Deployment } from '@sparcd/bucket';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Juniper Draw · 17 November 2026": the site, and the day the card came out of the camera. */
export function cardTitle(d: Deployment): string {
  const date = d.deploymentID.slice(-10);
  // A shared card has no place name, so its site id is made readable.
  const site = d.locationName || (d.locationID ?? '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return `${site} · ${day.format(new Date(`${date}T00:00:00Z`))}`;
}
