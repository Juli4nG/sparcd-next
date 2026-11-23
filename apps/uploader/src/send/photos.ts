import {
  ESTIMATED_TIME_COMMENT,
  cameraTime,
  estimateTimes,
  originalKey,
  thumbKey,
  timeRange,
  viewKey,
  type Deployment,
  type Media,
  type Site,
} from '@sparcd/bucket';
import type { ReadResult } from '../workers/photo.worker';
import { mediaTypeOf, type CardFile } from './scan';

export type Photo = {
  path: string;
  file: File;
  mediaID: string;
  timestamp: string;
  estimated: boolean;
  camera?: string;
};

export function toPhotos(card: CardFile[], reads: ReadResult[], timeZone: string): Photo[] {
  const camera = reads.map((r) => cameraTime(r.dateTimeOriginal, r.offsetTimeOriginal, timeZone));
  const estimates = estimateTimes(
    card.map((c, i) => ({ id: c.path, name: c.path, timestamp: camera[i], lastModified: c.file.lastModified })),
    timeZone,
  );
  return card.map((c, i) => ({
    path: c.path,
    file: c.file,
    mediaID: reads[i].sha256,
    timestamp: camera[i] ?? estimates.get(c.path)!,
    estimated: !camera[i],
    camera: reads[i].make && reads[i].model ? `${reads[i].make}-${reads[i].model}` : undefined,
  }));
}

export type PhotoKeys = { original: string; thumb: string; view: string };

export const keysOf = (p: Photo): PhotoKeys => ({
  original: originalKey(p.mediaID, p.file.name),
  thumb: thumbKey(p.mediaID),
  view: viewKey(p.mediaID),
});

export type Plan = {
  /** Already in media.csv, or a second copy of a photo on this card. */
  skip: Photo[];
  /** All three files stored but no row yet. */
  rowOnly: Photo[];
  /** Needs at least one file; `missing` lists which. */
  send: { photo: Photo; missing: (keyof PhotoKeys)[] }[];
};

export function planSend(photos: Photo[], knownMediaIDs: Set<string>, storedKeys: Set<string>): Plan {
  const plan: Plan = { skip: [], rowOnly: [], send: [] };
  const seen = new Set<string>();
  for (const photo of photos) {
    if (knownMediaIDs.has(photo.mediaID) || seen.has(photo.mediaID)) {
      plan.skip.push(photo);
      continue;
    }
    seen.add(photo.mediaID);
    const keys = keysOf(photo);
    const missing = (Object.keys(keys) as (keyof PhotoKeys)[]).filter((k) => !storedKeys.has(keys[k]));
    if (missing.length) plan.send.push({ photo, missing });
    else plan.rowOnly.push(photo);
  }
  return plan;
}

export const mediaRow = (p: Photo, deploymentID: string): Media => ({
  mediaID: p.mediaID,
  deploymentID,
  timestamp: p.timestamp,
  filePath: keysOf(p).original,
  filePublic: 'true',
  fileName: p.file.name,
  fileMediatype: mediaTypeOf(p.file.name),
  mediaComments: p.estimated ? ESTIMATED_TIME_COMMENT : '',
});

export function deploymentRow(site: Site, deploymentID: string, rows: Media[], cameraModel = ''): Deployment {
  const [deploymentStart, deploymentEnd] = timeRange(rows.map((r) => r.timestamp));
  return {
    deploymentID,
    locationID: site.locationID,
    locationName: site.locationName,
    latitude: String(site.latitude),
    longitude: String(site.longitude),
    deploymentStart,
    deploymentEnd,
    cameraModel,
    deploymentGroups: site.deploymentGroups,
  };
}
