import { parseTable, readTable, type Deployment, type PackageRows, type Session } from '@sparcd/bucket';
import { byTime, isShared, type Card } from './card';
import { tagState, tagsFromRows } from './tags';

/** The share link answered with an error: expired, or never valid. */
export class LinkGone extends Error {}

export const shareLink = (datapackageUrl: string): string =>
  `${location.origin}/tag/#share=${encodeURIComponent(datapackageUrl)}`;

export const shareFromHash = (): string | null => {
  const m = /[#&]share=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};

/** From the signed URL's own X-Amz-Date and X-Amz-Expires. */
export function linkExpired(url: string, now = Date.now()): boolean {
  const q = new URL(url).searchParams;
  const d = q.get('X-Amz-Date') ?? '';
  const signed = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
  return !(signed + Number(q.get('X-Amz-Expires')) * 1000 > now);
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new LinkGone();
  return res;
}

/** A shared card from its signed datapackage.json URL, with the person's own tags on it. */
export async function loadShareCard(session: Session, url: string): Promise<Card> {
  const dp = (await (await get(url)).json()) as { resources: { name: string; path: string }[]; sparcdThumbs: string };
  const table = async <T extends 'deployments' | 'media'>(name: T) =>
    parseTable(name, await (await get(dp.resources.find((r) => r.name === name)!.path)).text());
  const [deployments, media, thumbs, mine] = await Promise.all([
    table('deployments'),
    table('media'),
    get(dp.sparcdThumbs).then((r) => r.json() as Promise<Record<string, string>>),
    readTable(session.bucket, 'observations'),
  ]);
  const views = new Map(media.map((m) => [m.mediaID, m.filePath]));
  return {
    deployment: deployments[0],
    photos: media.sort(byTime),
    tags: tagsFromRows(mine.filter((o) => views.has(o.mediaID))),
    own: false,
    imageUrl: async (id, size) => (size === 'thumb' ? thumbs[id] : views.get(id)!),
  };
}

const LINKS_KEY = 'sparcd-next.tagger.shareLinks';

const shareId = (d: Deployment) => /share:(\w+)/.exec(d.deploymentGroups ?? '')?.[1] ?? '';

/** Share links opened in this browser, by share id, so a shared card can be reopened. */
function savedLinks(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function rememberLink(card: Card, url: string): void {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify({ ...savedLinks(), [shareId(card.deployment)]: url }));
  } catch {
    // Only a convenience: the card can still be opened from the link itself.
  }
}

export type SharedSummary = { deployment: Deployment; tagged: number; link?: string };

/** Cards copied in from shares, with how many of their photos the person has tagged. */
export function sharedSummaries(rows: PackageRows): SharedSummary[] {
  const links = savedLinks();
  const tags = tagsFromRows(rows.observations);
  return rows.deployments.filter(isShared).map((deployment) => ({
    deployment,
    tagged: rows.media.filter((m) => m.deploymentID === deployment.deploymentID && tagState(tags.get(m.mediaID)) !== 'untagged').length,
    link: links[shareId(deployment)],
  }));
}
