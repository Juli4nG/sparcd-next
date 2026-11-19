import {
  applyFilePublic,
  instant,
  parseLab,
  parseSpecies,
  readPackage,
  replaceObservations,
  savePackage,
  tagRows,
  thumbKey,
  viewKey,
  type About,
  type Bucket,
  type Deployment,
  type Media,
  type PackageRows,
  type Session,
  type Species,
} from '@sparcd/bucket';
import { eventsFromRows, tagState, tagsFromRows, toBucketTags, type PhotoTag } from './tags';

export type ImageSize = 'thumb' | 'view';

/**
 * One card's photos and tags, as any tagging screen needs them. `own` is false
 * for a card copied in from a share: those photos aren't the person's, so the
 * owner's filePublic rule doesn't apply. `imageUrl` is where each photo's
 * derived images come from, so a share can sign its own; `fresh` signs anew
 * after an image failed to load. `events` keeps each photo's burst (eventID)
 * when its tags are rewritten.
 */
export type Card = {
  deployment: Deployment;
  photos: Media[];
  tags: Map<string, PhotoTag[]>;
  events: Map<string, string>;
  own: boolean;
  imageUrl: (mediaID: string, size: ImageSize, fresh?: boolean) => Promise<string>;
};

export type CardSummary = { deployment: Deployment; photos: number; tagged: number; untagged: number };

export const isShared = (d: Deployment): boolean => /(^|\|)\s*share:/.test(d.deploymentGroups ?? '');

/** The settings every tagging screen needs: who to credit in the package, and the species list. */
export async function loadSettings(session: Session): Promise<{ about: About; species: Species[] }> {
  const [lab, species] = await Promise.all([session.settings.getText('lab.json'), session.settings.getText('species.json')]);
  return { about: { personName: session.name, lab: parseLab(lab!) }, species: parseSpecies(species ?? '[]') };
}

/** The person's own cards, newest first. */
export function cardSummaries(rows: PackageRows): CardSummary[] {
  const tags = tagsFromRows(rows.observations);
  const byCard = new Map<string, CardSummary>();
  for (const d of rows.deployments) if (!isShared(d)) byCard.set(d.deploymentID, { deployment: d, photos: 0, tagged: 0, untagged: 0 });
  for (const m of rows.media) {
    const card = byCard.get(m.deploymentID);
    if (!card) continue;
    card.photos++;
    if (tagState(tags.get(m.mediaID)) === 'untagged') card.untagged++;
    else card.tagged++;
  }
  return [...byCard.values()].sort((a, b) => instant(b.deployment.deploymentEnd) - instant(a.deployment.deploymentEnd));
}

const byTime = (a: Media, b: Media) =>
  instant(a.timestamp) - instant(b.timestamp) || (a.fileName ?? '').localeCompare(b.fileName ?? '', 'en', { numeric: true });

const hour = () => Math.floor(Date.now() / 3_600_000);

/** Hour-stable signed URLs, so `<img>` sources repeat within the hour and the browser cache hits. */
export function bucketImages(bucket: Bucket): Card['imageUrl'] {
  const cache = new Map<string, { hour: number; url: Promise<string> }>();
  return (mediaID, size, fresh) => {
    const key = size === 'thumb' ? thumbKey(mediaID) : viewKey(mediaID);
    const hit = cache.get(key);
    if (!fresh && hit?.hour === hour()) return hit.url;
    const url = bucket.presignGet(key, { hourStable: !fresh });
    cache.set(key, { hour: hour(), url });
    url.catch(() => cache.get(key)?.url === url && cache.delete(key));
    return url;
  };
}

/** Null when the person has no such card. */
export async function loadCard(session: Session, deploymentID: string): Promise<Card | null> {
  const rows = await readPackage(session.bucket);
  const deployment = rows.deployments.find((d) => d.deploymentID === deploymentID);
  if (!deployment) return null;
  const photos = rows.media.filter((m) => m.deploymentID === deploymentID).sort(byTime);
  const ids = new Set(photos.map((m) => m.mediaID));
  const observations = rows.observations.filter((o) => ids.has(o.mediaID));
  return {
    deployment,
    photos,
    tags: tagsFromRows(observations),
    events: eventsFromRows(observations),
    own: !isShared(deployment),
    imageUrl: bucketImages(session.bucket),
  };
}

/**
 * One package write for every photo in `ids`: re-read, replace those photos'
 * rows, apply the owner's filePublic rule, then datapackage.json.
 */
export async function saveTags(
  session: Session,
  about: About,
  card: Card,
  ids: string[],
  tagsOf: (id: string) => PhotoTag[],
  editedAt: (id: string) => string,
): Promise<void> {
  const media = new Map(card.photos.map((m) => [m.mediaID, m]));
  const rows = ids.flatMap((id) =>
    tagRows(media.get(id)!, toBucketTags(tagsOf(id)), session.code, { timestamp: editedAt(id), eventID: card.events.get(id) }),
  );
  await savePackage(
    session.bucket,
    {
      ...(card.own && { media: (m: Media[]) => applyFilePublic(m, rows, ids) }),
      observations: (o) => replaceObservations(o, ids, rows),
    },
    about,
  );
}
