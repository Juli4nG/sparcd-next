import { sameTags, type PhotoTag } from './tags';

/** Edits not yet saved, kept in the browser so closing the page loses nothing: photo ID → tags and edit time. */
export type Draft = Record<string, { tags: PhotoTag[]; at: string }>;

export const draftKey = (code: string, deploymentID: string) => `sparcd-next.tagger.draft.${code}.${deploymentID}`;

export function readDraft(key: string): Draft {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Draft;
  } catch {
    return {};
  }
}

export function writeDraft(key: string, draft: Draft): void {
  try {
    if (Object.keys(draft).length) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    /* the beforeunload prompt still guards this visit */
  }
}

/** The stored tags with the draft laid over them, and the photos whose draft still needs saving. */
export function restoreDraft(stored: Map<string, PhotoTag[]>, draft: Draft): { tags: Map<string, PhotoTag[]>; unsaved: string[] } {
  const tags = new Map(stored);
  const unsaved: string[] = [];
  for (const [id, entry] of Object.entries(draft)) {
    if (sameTags(stored.get(id), entry.tags)) continue;
    tags.set(id, entry.tags);
    unsaved.push(id);
  }
  return { tags, unsaved };
}
