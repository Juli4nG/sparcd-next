import type { Deployment, Media, Observation, PackageRows } from './csv';
import { observationId } from './ids';
import type { ObservationType } from './settings';
import { instant, nowTimestamp } from './times';

const earlier = (a: string, b: string) => (instant(b) < instant(a) ? b : a);
const later = (a: string, b: string) => (instant(b) > instant(a) ? b : a);

/**
 * `widen` (the Uploader): a known deployment keeps its values and widens its
 * start and end. `insert` (rows copied from a share): only absent rows are added.
 */
export function mergeDeployments(existing: Deployment[], incoming: Deployment[], mode: 'widen' | 'insert'): Deployment[] {
  const byId = new Map(existing.map((d) => [d.deploymentID, d]));
  for (const d of incoming) {
    const old = byId.get(d.deploymentID);
    if (!old) byId.set(d.deploymentID, d);
    else if (mode === 'widen') {
      byId.set(d.deploymentID, {
        ...old,
        deploymentStart: earlier(old.deploymentStart, d.deploymentStart),
        deploymentEnd: later(old.deploymentEnd, d.deploymentEnd),
      });
    }
  }
  return [...byId.values()];
}

/** Insert-only: a photo already in the bucket keeps its first row. */
export function mergeMedia(existing: Media[], incoming: Media[]): Media[] {
  const known = new Set(existing.map((m) => m.mediaID));
  const added = incoming.filter((m) => !known.has(m.mediaID) && known.add(m.mediaID));
  return [...existing, ...added];
}

/** Saving photos' tags replaces every row with those mediaIDs. */
export function replaceObservations(existing: Observation[], mediaIDs: Iterable<string>, rows: Observation[]): Observation[] {
  const ids = new Set(mediaIDs);
  return [...existing.filter((o) => !ids.has(o.mediaID)), ...rows];
}

/**
 * The owner's rule: their own photo with a `human` row is `filePublic=false`,
 * and goes back to `true` once none remains. Pass only the owner's own photos.
 */
export function applyFilePublic(media: Media[], observations: Observation[], mediaIDs: Iterable<string>): Media[] {
  const ids = new Set(mediaIDs);
  const human = new Set(observations.filter((o) => o.observationType === 'human').map((o) => o.mediaID));
  return media.map((m) => (ids.has(m.mediaID) ? { ...m, filePublic: String(!human.has(m.mediaID)) } : m));
}

export type Tag = { observationType: ObservationType; scientificName?: string; count?: number };

/** One media-level row per tag, as the Tagger writes them. An empty `tags` untags the photo. */
export function tagRows(
  media: Media,
  tags: Tag[],
  code: string,
  opts: { eventID?: string; timestamp?: string } = {},
): Observation[] {
  const classificationTimestamp = opts.timestamp ?? nowTimestamp();
  return tags.map((t, i) => ({
    observationID: observationId(media.mediaID, code, i + 1),
    deploymentID: media.deploymentID,
    mediaID: media.mediaID,
    eventID: opts.eventID ?? '',
    eventStart: media.timestamp,
    eventEnd: media.timestamp,
    observationLevel: 'media',
    observationType: t.observationType,
    scientificName: t.observationType === 'animal' || t.observationType === 'human' ? (t.scientificName ?? '') : '',
    count: t.observationType === 'blank' ? '' : String(t.count ?? 1),
    classificationMethod: 'human',
    classifiedBy: code,
    classificationTimestamp,
  }));
}

export type ShareRecipe = {
  id: string;
  createdAt: string;
  expiresAt: string;
  deploymentIDs: string[];
  positionDecimals: number;
  image: 'view';
};

/**
 * The CSV rows of a share package: public photos without a human tag. Each
 * `filePath` is the image's key, for the caller to sign.
 */
export function shareTables(rows: PackageRows, share: ShareRecipe): PackageRows {
  const ids = new Map(share.deploymentIDs.map((id, i) => [id, `${share.id}-${i + 1}`]));
  const human = new Set(rows.observations.filter((o) => o.observationType === 'human').map((o) => o.mediaID));
  const round = (v: string) => Number(v).toFixed(share.positionDecimals);
  const group = `share:${share.id}`;
  return {
    deployments: rows.deployments
      .filter((d) => ids.has(d.deploymentID))
      .map((d) => ({
        ...d,
        deploymentID: ids.get(d.deploymentID)!,
        locationID: '',
        latitude: round(d.latitude),
        longitude: round(d.longitude),
        coordinateUncertainty: '8000',
        locationName: '',
        deploymentGroups: d.deploymentGroups ? `${d.deploymentGroups} | ${group}` : group,
      })),
    media: rows.media
      .filter((m) => ids.has(m.deploymentID) && m.filePublic === 'true' && !human.has(m.mediaID))
      // A video is shared as its still, so the row describes a JPEG.
      .map((m) => ({
        ...m,
        deploymentID: ids.get(m.deploymentID)!,
        filePath: `Media/${m.mediaID}/${share.image}.jpg`,
        fileMediatype: 'image/jpeg',
      })),
    observations: [],
  };
}
