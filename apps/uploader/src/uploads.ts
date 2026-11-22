import { instant, readTable, type Bucket, type Deployment } from '@sparcd/bucket';

export type Counts = { photos: number; tagged: number };

/** A row copied in from a share is not one of the person's own uploads. */
const isShared = (d: Deployment): boolean => /(^|\|)\s*share:/.test(d.deploymentGroups ?? '');

/** The person's own uploads, newest first. */
export const ownUploads = (deployments: Deployment[]): Deployment[] =>
  deployments.filter((d) => !isShared(d)).sort((a, b) => instant(b.deploymentEnd) - instant(a.deploymentEnd));

/**
 * The upload list as soon as deployments.csv arrives, and each upload's photo
 * and tagged counts once media.csv and observations.csv do. All three are read
 * at once, each a single time. A photo with any observation row is tagged.
 */
export function readUploads(bucket: Bucket): { uploads: Promise<Deployment[]>; counts: Promise<Map<string, Counts>> } {
  const deployments = readTable(bucket, 'deployments');
  const counts = Promise.all([deployments, readTable(bucket, 'media'), readTable(bucket, 'observations')]).then(([deployments, media, observations]) => {
    const tagged = new Set(observations.map((o) => o.mediaID));
    const counts = new Map(ownUploads(deployments).map((d): [string, Counts] => [d.deploymentID, { photos: 0, tagged: 0 }]));
    for (const m of media) {
      const c = counts.get(m.deploymentID);
      if (!c) continue;
      c.photos++;
      if (tagged.has(m.mediaID)) c.tagged++;
    }
    return counts;
  });
  return { uploads: deployments.then(ownUploads), counts };
}
