import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nowTimestamp, type About, type Session } from '@sparcd/bucket';
import { saveTags, type Card } from './card';
import { Saver, type SaveStatus } from './saver';
import { sameTags, type PhotoTag } from './tags';

const NONE: PhotoTag[] = [];
const UNDO_LIMIT = 50;

type Step = Map<string, PhotoTag[]>;

/**
 * A card's tags in memory, with undo and autosave. Every screen that tags a
 * card goes through this: `edit` changes some photos, and the saver writes
 * them to the package shortly after.
 */
export function useTagging(session: Session, about: About, card: Card) {
  const [tags, setTags] = useState(card.tags);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [undoCount, setUndoCount] = useState(0);
  const tagsRef = useRef(tags);
  const editedAt = useRef(new Map<string, string>());
  const undoStack = useRef<Step[]>([]);

  const saver = useMemo(
    () =>
      new Saver(
        (ids) =>
          saveTags(session, about, card, ids, (id) => tagsRef.current.get(id) ?? NONE, (id) => editedAt.current.get(id) ?? nowTimestamp()),
        setStatus,
      ),
    [session, about, card],
  );

  const commit = useCallback(
    (next: Map<string, PhotoTag[]>, changed: string[]) => {
      const at = nowTimestamp();
      for (const id of changed) editedAt.current.set(id, at);
      tagsRef.current = next;
      // The other tagging screen opened on this card starts from these, not the ones it loaded with.
      card.tags = next;
      setTags(next);
      saver.mark(changed);
    },
    [saver, card],
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
      flush();
      saver.dispose();
    };
  }, [saver]);

  return { tags, edit, undo, canUndo: undoCount > 0, status, saveNow: () => void saver.flush() };
}

export type Tagging = ReturnType<typeof useTagging>;
