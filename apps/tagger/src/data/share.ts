import { instant, isMediaId, isPersonCode, parseTable, readTable, type Deployment, type PackageRows, type Session } from '@sparcd/bucket';
import { byTime, isShared, type Card } from './card';
import { tagState, tagsFromRows } from './tags';

export class LinkGone extends Error {}

export const BROKEN_LINK = "This link doesn't work any more. Ask the person who sent it for a new one.";

export const shareLink = (datapackageUrl: string): string =>
  `${location.origin}/tag/#share=${encodeURIComponent(datapackageUrl)}`;

export const shareFromHash = (): string | null => {
  const m = /[#&]share=([^&]*)/.exec(location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
};

/** From the signed URL's own X-Amz-Date and X-Amz-Expires. */
export function linkExpired(url: string, now = Date.now()): boolean {
  const q = new URL(url).searchParams;
  const d = q.get('X-Amz-Date') ?? '';
  const signed = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
  return !(signed + Number(q.get('X-Amz-Expires')) * 1000 > now);
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { redirect: 'error', credentials: 'omit', cache: 'no-store' });
  if (res.status >= 500) throw new Error();
  if (!res.ok) throw new LinkGone();
  return res;
}

async function getJson(url: string): Promise<unknown> {
  const text = await (await get(url)).text();
  try {
    return JSON.parse(text);
  } catch {
    throw new LinkGone();
  }
}

/** A shared card from its signed datapackage.json URL, with the person's own tags on it. */
export async function loadShareCard(session: Session, url: string, endpoint: string): Promise<Card> {
  const origin = new URL(endpoint).origin;
  const pathOf = (value: unknown) => {
    if (typeof value !== 'string') throw new LinkGone();
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      throw new LinkGone();
    }
    if (!/^https?:$/.test(target.protocol) || target.origin !== origin || target.username || target.password) throw new LinkGone();
    return target.pathname;
  };
  const match = /^\/(sparcd-next-([a-z0-9]+))\/shared\/([a-z2-7]{26})\/datapackage\.json$/.exec(pathOf(url));
  if (!match || !isPersonCode(match[2])) throw new LinkGone();
  const [, bucket, , id] = match;
  const folder = `/${bucket}/shared/${id}/`;
  const packagePath = (value: unknown) => {
    const path = pathOf(value);
    if (!path.startsWith(folder) || path === folder || path.includes('%')) throw new LinkGone();
  };
  const imagePath = new RegExp(`^/${bucket}/Media/[0-9a-f]{64}/(thumb|view)\\.jpg$`);

  const dp = await getJson(url) as { resources: { name: string; path: string }[]; sparcdThumbs: string } | null;
  if (!dp || !Array.isArray(dp.resources)) throw new LinkGone();
  packagePath(dp.sparcdThumbs);
  for (const resource of dp.resources) packagePath(resource?.path);
  const table = async <T extends 'deployments' | 'media'>(name: T) => {
    const resource = dp.resources.find((r) => r.name === name);
    if (!resource) throw new LinkGone();
    const text = await (await get(resource.path)).text();
    try {
      return parseTable(name, text);
    } catch {
      throw new LinkGone();
    }
  };
  const [deployments, media, thumbsData] = await Promise.all([
    table('deployments'),
    table('media'),
    getJson(dp.sparcdThumbs),
  ]);
  if (!deployments.length || deployments.some((d) => !d.deploymentID || !isShared(d)
    || !Number.isFinite(instant(`${d.deploymentStart.slice(0, 10)}T00:00:00Z`)))) throw new LinkGone();
  if (!thumbsData || typeof thumbsData !== 'object' || Array.isArray(thumbsData)) throw new LinkGone();
  const thumbs = new Map(Object.entries(thumbsData) as [string, string][]);
  for (const value of thumbs.values()) if (!imagePath.test(pathOf(value))) throw new LinkGone();
  const deploymentIDs = new Set(deployments.map((d) => d.deploymentID));
  for (const m of media) {
    if (!deploymentIDs.has(m.deploymentID) || !isMediaId(m.mediaID) || !Number.isFinite(instant(m.timestamp))
      || !imagePath.test(pathOf(m.filePath)) || !thumbs.has(m.mediaID)) throw new LinkGone();
  }

  const mine = await readTable(session.bucket, 'observations');
  const views = new Map(media.map((m) => [m.mediaID, m.filePath]));
  return {
    deployment: deployments[0],
    photos: media.sort(byTime),
    tags: tagsFromRows(mine.filter((o) => views.has(o.mediaID))),
    own: false,
    imageUrl: async (id, size) => (size === 'thumb' ? thumbs : views).get(id)!,
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
