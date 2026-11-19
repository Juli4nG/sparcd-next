import type { Species } from '@sparcd/bucket';
import { speciesTag, type PhotoTag } from '../data/tags';
import { normalizeBindableEventKey } from '../lib/keys';
import { appendSpeciesCountDigit, removeSpeciesCountDigit, speciesCountFromPrefix } from '../lib/speciesCountPrefix';

export type KeyAction = { kind: 'species'; species: Species } | { kind: 'conflict' };

/** What the workspace hands the key handler on every keypress. */
export type KeyContext = {
  view: 'grid' | 'focus';
  /** A photo the next tag would land on. */
  hasTarget: boolean;
  selectedCount: number;
  keyMap: Map<string, KeyAction>;
  capturingFor: string | null;
  countPrefix: string;
  search: string;
  displayed: Species[];
  searchInput: HTMLInputElement | null;
  modalOpen: boolean;
  focusedHas: (tagKey: string) => boolean;
  setCountPrefix: (value: string) => void;
  captureKey: (own: string, key: string) => void;
  stopCapture: () => void;
  /** Add-only, on the selection or the focused photo. */
  apply: (tag: PhotoTag) => void;
  /** Adds one, on the selection or the focused photo. */
  increment: (tag: PhotoTag) => void;
  move: (direction: 1 | -1) => void;
  clearSelection: () => void;
  openFocus: () => void;
  closeFocus: () => void;
  openCheatsheet: () => void;
  undo: () => void;
  saveNow: () => void;
};

type Target = EventTarget | null;
type Key = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'target' | 'preventDefault'>;

const isTyping = (t: Target) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

const isControl = (t: Target) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SELECT');
};

/** Where a standalone Shift or Control tap may tag: not while typing or behind a dialog. */
export const modifierTarget = (s: KeyContext, target: Target): boolean =>
  !s.modalOpen && !isTyping(target) && (!!s.capturingFor || s.hasTarget);

/** Shared by printable keydown and standalone modifier release (#628). */
export function applySpeciesBinding(s: KeyContext, key: string): boolean {
  const action = s.keyMap.get(key);
  if (action?.kind === 'conflict') return true;
  if (!action || !s.hasTarget) return false;
  const prefix = speciesCountFromPrefix(s.countPrefix);
  s.setCountPrefix('');
  const tag = speciesTag(action.species);
  if (prefix && s.selectedCount <= 1 && !s.focusedHas(tag.key) && tag.observationType !== 'blank') s.apply({ ...tag, count: prefix });
  else s.increment(tag);
  return true;
}

export function handleKey(e: Key, s: KeyContext): void {
  if (s.modalOpen) return;
  // Shift and Control act only on release, through the standalone gesture.
  if (e.key === 'Shift' || e.key === 'Control') return;

  if (s.capturingFor) {
    if (e.key === 'Escape') return s.stopCapture();
    const key = normalizeBindableEventKey(e);
    if (!key) return;
    e.preventDefault();
    if (/^\d$/.test(key)) return;
    s.captureKey(s.capturingFor, key);
    s.stopCapture();
    return;
  }

  if (isTyping(e.target)) {
    // Only the species search owns Enter and Escape; other fields keep their keys.
    if (e.target !== s.searchInput) return;
    if (e.key === 'Escape') s.searchInput?.blur();
    if (e.key === 'Enter') {
      e.preventDefault();
      // #627: Enter adds the top result exactly as the list shows it.
      const top = s.search.trim() ? s.displayed[0] : undefined;
      if (top) s.apply(speciesTag(top));
      s.searchInput?.blur();
    }
    return;
  }
  // A focused button, link or photo tile keeps its own Enter and Space.
  if ((e.key === 'Enter' || (e.key === ' ' && !e.shiftKey)) && isControl(e.target)) return;

  const unmodified = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (unmodified && s.selectedCount <= 1 && /^\d$/.test(e.key)) {
    e.preventDefault();
    if (!e.repeat) s.setCountPrefix(appendSpeciesCountDigit(s.countPrefix, e.key));
    return;
  }
  if (unmodified && s.countPrefix && e.key === 'Backspace') {
    e.preventDefault();
    s.setCountPrefix(removeSpeciesCountDigit(s.countPrefix));
    return;
  }

  const printable = normalizeBindableEventKey(e);
  const action = printable ? s.keyMap.get(printable) : undefined;
  if (action?.kind === 'conflict') return e.preventDefault();
  if (action && s.hasTarget) {
    e.preventDefault();
    if (!e.repeat) applySpeciesBinding(s, printable!);
    return;
  }

  if (e.key === '?') {
    e.preventDefault();
    return s.openCheatsheet();
  }
  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      s.undo();
    } else if (k === 's') {
      e.preventDefault();
      s.saveNow();
    }
    return;
  }
  if (e.altKey) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      return s.move(-1);
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      return s.move(1);
    case ' ':
      e.preventDefault();
      return s.searchInput?.focus();
    case 'Enter':
      if (s.view === 'grid') {
        e.preventDefault();
        s.openFocus();
      }
      return;
    case 'Escape':
      if (s.countPrefix) return s.setCountPrefix('');
      if (s.selectedCount) return s.clearSelection();
      if (s.view === 'focus') s.closeFocus();
  }
}
