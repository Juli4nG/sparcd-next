import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nowTimestamp, type About, type Session } from '@sparcd/bucket';
import { saveTags, type Card } from './card';
import { draftKey, readDraft, restoreDraft, writeDraft, type Draft } from './draft';
import { Saver, type SaveStatus } from './saver';
import { sameTags, type PhotoTag } from './tags';

const NONE: PhotoTag[] = [];
const UNDO_LIMIT = 50;

type Step = Map<string, PhotoTag[]>;

const open = new Set<Saver>();

export const unsavedEdits = (): boolean => [...open].some((s) => s.busy);

/** Before leaving a card or signing out: saves every open card's edits. False when a save failed. */
export async function saveEverything(): Promise<boolean> {
  return (await Promise.all([...open].map((s) => s.drain()))).every(Boolean);
}

/**
 * A card's tags in memory, with undo and autosave. Every screen that tags a
 * card goes through this: `edit` changes some photos, and the saver writes
 * them to the package shortly after. Unsaved edits also wait in a browser
 * draft, so closing the page loses nothing; reopening the card saves them.
 */
export function useTagging(session: Session, about: About, card: Card) {
  const key = draftKey(session.code, card.deployment.deploymentID);
  const [start] = useState(() => {
    const draft = readDraft(key);
    const { tags, unsaved } = restoreDraft(card.tags, draft);
    return { tags, draft: Object.fromEntries(unsaved.map((id) => [id, draft[id]])) as Draft };
  });
  const [tags, setTags] = useState(start.tags);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [undoCount, setUndoCount] = useState(0);
  const tagsRef = useRef(tags);
  const draft = useRef(start.draft);
  const editedAt = useRef(new Map(Object.entries(start.draft).map(([id, d]) => [id, d.at])));
  const undoStack = useRef<Step[]>([]);

  const saver = useMemo(
    () =>
      new Saver(async (ids) => {
        const sent = ids.map((id) => draft.current[id]);
        await saveTags(session, about, card, ids, (id) => tagsRef.current.get(id) ?? NONE, (id) => editedAt.current.get(id) ?? nowTimestamp());
        // A photo edited again while this save ran keeps its newer draft.
        ids.forEach((id, i) => draft.current[id] === sent[i] && delete draft.current[id]);
        writeDraft(key, draft.current);
      }, setStatus),
    [session, about, card, key],
  );

  const commit = useCallback(
    (next: Map<string, PhotoTag[]>, changed: string[]) => {
      const at = nowTimestamp();
      for (const id of changed) {
        editedAt.current.set(id, at);
        draft.current[id] = { tags: next.get(id) ?? NONE, at };
      }
      writeDraft(key, draft.current);
      tagsRef.current = next;
      // The other tagging screen opened on this card starts from these, not the ones it loaded with.
      card.tags = next;
      setTags(next);
      saver.mark(changed);
    },
    [saver, key, card],
  );

  /** Returns every photo's tags after the change. */
  const edit = useCallback(
    (ids: string[], change: (tags: PhotoTag[]) => PhotoTag[]): Map<string, PhotoTag[]> => {
      const before: Step = new Map();
      const next = new Map(tagsRef.current);
      for (const id of ids) {
        const old = next.get(id) ?? NONE;
        const updated = change(old);
        if (sameTags(old, updated)) continue;
        before.set(id, old);
        next.set(id, updated);
      }
      if (!before.size) return tagsRef.current;
      undoStack.current = [...undoStack.current.slice(1 - UNDO_LIMIT), before];
      setUndoCount(undoStack.current.length);
      commit(next, [...before.keys()]);
      return next;
    },
    [commit],
  );

  const undo = useCallback(() => {
    const step = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!step) return;
    const next = new Map(tagsRef.current);
    for (const [id, old] of step) next.set(id, old);
    commit(next, [...step.keys()]);
  }, [commit]);

  useEffect(() => {
    open.add(saver);
    const unsaved = Object.keys(draft.current);
    if (unsaved.length) saver.mark(unsaved);
    const flush = () => void saver.flush();
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver.busy) return;
      flush();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onBeforeUnload);
      open.delete(saver);
      flush();
      saver.dispose();
    };
  }, [saver]);

  return { tags, edit, undo, canUndo: undoCount > 0, status, saveNow: () => void saver.flush() };
}

export type Tagging = ReturnType<typeof useTagging>;
