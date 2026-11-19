import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { About, Session, Species } from '@sparcd/bucket';
import type { Card } from '../data/card';
import type { SaveStatus } from '../data/saver';
import { addTag, incrementTag, NOTHING, removeTag, setCount, speciesKey, tagState, type PhotoTag } from '../data/tags';
import { useTagging } from '../data/useTagging';
import { effectiveKey, keyLabel, resolveKeys, useKeyOverrides } from '../lib/keys';
import { nearestVisibleIndex, nextVisibleIndex, toggleSelectionWithFocus, visibleRangeSet } from '../lib/selection';
import { StandaloneModifierGesture } from '../lib/standaloneModifier';
import { useSpeciesResults } from '../lib/useSpeciesResults';
import { Dialog, DialogHeader } from '../ui/Dialog';
import { AppliedSpecies, NOTHING_LABEL } from './AppliedSpecies';
import { Cheatsheet } from './Cheatsheet';
import { FocusView } from './FocusView';
import { Grid, type PickMods } from './Grid';
import { applySpeciesBinding, handleKey, modifierTarget, type KeyAction, type KeyContext } from './keyboard';
import { SpeciesPanel } from './SpeciesPanel';

type Filter = 'all' | 'untagged' | 'tagged';
type Conflict = { own: string; key: string; name: string; others: Species[] };

const NONE: PhotoTag[] = [];
const ADVANCE_KEY = 'sparcd-next.tagger.advance';

const matches = (tags: PhotoTag[] | undefined, filter: Filter) =>
  filter === 'all' || (filter === 'untagged') === (tagState(tags) === 'untagged');

function readAdvance(): boolean {
  try {
    return localStorage.getItem(ADVANCE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function Tag({ session, about, species, card, title }: { session: Session; about: About; species: Species[]; card: Card; title: string }) {
  const tagging = useTagging(session, about, card);
  const { tags, edit } = tagging;
  const keys = useKeyOverrides();
  const photos = card.photos;

  const [view, setView] = useState<'grid' | 'focus'>('grid');
  const [focus, setFocus] = useState(() => Math.max(0, photos.findIndex((p) => !card.tags.get(p.mediaID)?.length)));
  const [anchor, setAnchor] = useState(focus);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [countPrefix, setCountPrefix] = useState('');
  const [capturingFor, setCapturingFor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [zoom, setZoom] = useState<Species | null>(null);
  const [cheatsheet, setCheatsheet] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [advance, setAdvance] = useState(readAdvance);
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleOf = useCallback(
    (all: Map<string, PhotoTag[]>) => photos.flatMap((p, i) => (matches(all.get(p.mediaID), filter) ? [i] : [])),
    [photos, filter],
  );
  const visible = useMemo(() => visibleOf(tags), [visibleOf, tags]);
  const visibleSet = useMemo(() => new Set(visible), [visible]);
  const counts = useMemo(() => {
    const untagged = photos.filter((p) => tagState(tags.get(p.mediaID)) === 'untagged').length;
    return { all: photos.length, untagged, tagged: photos.length - untagged };
  }, [photos, tags]);

  const current = photos[focus];
  const currentTags = (current && tags.get(current.mediaID)) || NONE;
  const hasTarget = selected.size > 0 || visibleSet.has(focus);

  // A pending count belongs to the photo it was typed on.
  useEffect(() => setCountPrefix(''), [focus]);
  useEffect(() => {
    if (selected.size > 1) setCountPrefix('');
  }, [selected.size]);
  // A filter change can hide the focused photo: land on the nearest one shown.
  useEffect(() => {
    setSelected((s) => (s.size ? new Set([...s].filter((i) => visibleSet.has(i))) : s));
    if (visibleSet.has(focus) || !visible.length) return;
    const nearest = nearestVisibleIndex(visible, focus)!;
    setFocus(nearest);
    setAnchor(nearest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const byKey = useMemo(() => new Map(species.map((s) => [speciesKey(s), s])), [species]);
  const labelOf = useCallback(
    (t: PhotoTag) => (t.observationType === 'blank' ? NOTHING_LABEL : (byKey.get(t.key)?.name ?? (t.scientificName || 'Unknown'))),
    [byKey],
  );
  const summarize = useCallback(
    (list: PhotoTag[]) => {
      const head = `${labelOf(list[0])}${list[0].count > 1 ? ` ×${list[0].count}` : ''}`;
      return list.length > 1 ? `${head} +${list.length - 1}` : head;
    },
    [labelOf],
  );

  const resolved = useMemo(() => resolveKeys(species, keys.overrides), [species, keys.overrides]);
  const keyMap = useMemo(() => {
    const map = new Map<string, KeyAction>();
    for (const [key, s] of resolved.byKey) map.set(key, { kind: 'species', species: s });
    for (const key of resolved.shared.keys()) map.set(key, { kind: 'conflict' });
    return map;
  }, [resolved]);
  const displayed = useSpeciesResults(species, search);

  // --- Moving and choosing ---------------------------------------------------
  const goTo = (i: number) => {
    setFocus(i);
    setAnchor(i);
    setSelected(new Set());
  };
  const step = (direction: 1 | -1) => {
    const target = nextVisibleIndex(visible, focus, direction);
    if (target !== undefined) goTo(target);
  };
  const targetIds = () =>
    (selected.size ? [...selected].sort((a, b) => a - b) : visibleSet.has(focus) ? [focus] : []).map((i) => photos[i].mediaID);

  /** After a tag, move on once, skipping photos the filter now hides. */
  const advanceFrom = (after: Map<string, PhotoTag[]>) => {
    const next = nextVisibleIndex(visibleOf(after), focus, 1);
    if (next === undefined) setSelected(new Set());
    else goTo(next);
  };

  const apply = (tag: PhotoTag) => {
    const ids = targetIds();
    if (!ids.length) return;
    const moves = advance && (selected.size > 0 || !currentTags.some((t) => t.key === tag.key));
    const after = edit(ids, (list) => addTag(list, tag));
    if (moves) advanceFrom(after);
  };
  const increment = (tag: PhotoTag) => {
    const ids = targetIds();
    if (!ids.length) return;
    const after = edit(ids, (list) => incrementTag(list, tag));
    if (advance) advanceFrom(after);
  };
  const clearAll = () => edit(targetIds(), () => NONE);

  const pick = useCallback(
    (i: number, mods: PickMods) => {
      if (mods.shift) {
        setSelected(visibleRangeSet(visible, anchor, i));
        setFocus(i);
      } else if (mods.add) {
        setSelected(toggleSelectionWithFocus(selected, focus, i));
        setFocus(i);
        setAnchor(i);
      } else goTo(i);
    },
    [visible, anchor, selected, focus],
  );
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const stablePick = useCallback((i: number, mods: PickMods) => pickRef.current(i, mods), []);

  // --- The large view ------------------------------------------------------
  const openFocus = useCallback((i?: number) => {
    if (i !== undefined) {
      setFocus(i);
      setAnchor(i);
    }
    window.history.pushState({ taggerFocus: true }, '');
    setView('focus');
  }, []);
  const closeFocus = () => window.history.back();
  useEffect(() => {
    const onPop = () => setView('grid');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useLayoutEffect(() => {
    if (view === 'grid') requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-index="${focusRef.current}"]`)?.focus());
  }, [view]);

  // --- Keys ----------------------------------------------------------------
  const captureKey = (own: string, key: string) => {
    const target = byKey.get(own)!;
    const others = species.filter((s) => speciesKey(s) !== own && effectiveKey(s, keys.overrides) === key);
    if (others.length) setConflict({ own, key, name: target.name, others });
    else keys.assign(own, key);
  };
  const keyFor = (s: Species) => {
    const key = effectiveKey(s, keys.overrides);
    return key && keyLabel(key);
  };
  const conflictFor = (s: Species) => {
    const key = effectiveKey(s, keys.overrides);
    const owners = key ? resolved.shared.get(key) : undefined;
    return owners ? `This key is also on ${owners.filter((o) => o !== s).map((o) => o.name).join(', ')}. Choose a new key.` : null;
  };

  const modalOpen = !!conflict || !!zoom || cheatsheet;
  const context: KeyContext = {
    view,
    hasTarget,
    selectedCount: selected.size,
    keyMap,
    capturingFor,
    countPrefix,
    search,
    displayed,
    searchInput: searchRef.current,
    modalOpen,
    focusedHas: (key) => currentTags.some((t) => t.key === key),
    setCountPrefix,
    captureKey,
    stopCapture: () => setCapturingFor(null),
    apply,
    increment,
    move: step,
    clearSelection: () => setSelected(new Set()),
    openFocus: () => openFocus(),
    closeFocus,
    openCheatsheet: () => setCheatsheet(true),
    undo: tagging.undo,
    saveNow: tagging.saveNow,
  };
  const contextRef = useRef(context);
  contextRef.current = context;

  // A Shift or Control tap counts only if nothing it would act on changed in between (#628).
  const gestureContext = useMemo(
    () => ({}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, current?.mediaID, selected, capturingFor, keyMap, modalOpen],
  );
  const gestureContextRef = useRef(gestureContext);
  gestureContextRef.current = gestureContext;
  const gesture = useRef(new StandaloneModifierGesture<object>());
  useLayoutEffect(() => gesture.current.observe(gestureContext), [gestureContext]);

  useEffect(() => {
    const g = gesture.current;
    const contextFor = (target: EventTarget | null) => (modifierTarget(contextRef.current, target) ? gestureContextRef.current : null);
    const onKeyCapture = (e: KeyboardEvent) => g.keyDown(e, contextFor(e.target));
    const onKey = (e: KeyboardEvent) => handleKey(e, contextRef.current);
    const onKeyUp = (e: KeyboardEvent) => {
      const key = g.keyUp(e, contextFor(e.target));
      if (!key) return;
      const s = contextRef.current;
      if (s.capturingFor) {
        e.preventDefault();
        s.captureKey(s.capturingFor, key);
        s.stopCapture();
      } else if (applySpeciesBinding(s, key)) e.preventDefault();
    };
    const cancel = () => g.cancel();
    const reset = () => g.reset();
    const pointerDown = (e: PointerEvent) => g.pointerDown(e.pointerId);
    const pointerUp = (e: PointerEvent) => g.pointerUp(e.pointerId);
    const cancelEvents = ['click', 'auxclick', 'contextmenu', 'wheel', 'dragstart', 'focusin', 'compositionstart'] as const;
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerUp, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    for (const name of cancelEvents) document.addEventListener(name, cancel, { capture: true, passive: true });
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', pointerUp, true);
      window.removeEventListener('pointercancel', pointerUp, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      for (const name of cancelEvents) document.removeEventListener(name, cancel, true);
    };
  }, []);

  // --- Layout ----------------------------------------------------------------
  const position = visible.indexOf(focus) + 1;
  const panel = (
    <SpeciesPanel
      displayed={displayed}
      search={search}
      onSearch={setSearch}
      searchRef={searchRef}
      keyFor={keyFor}
      conflictFor={conflictFor}
      capturingFor={capturingFor}
      onStartCapture={setCapturingFor}
      onClearKey={keys.clear}
      keysUnsaved={keys.unsaved}
      applied={new Set(currentTags.map((t) => t.key))}
      selectionCount={selected.size}
      disabled={!hasTarget}
      selectedKey={highlighted}
      onSelect={setHighlighted}
      onApply={(s) => apply({ key: speciesKey(s), observationType: s.observationType, scientificName: s.scientificName, count: 1 })}
      onZoom={setZoom}
      header={
        <div className="space-y-2">
          {countPrefix && selected.size <= 1 && (
            <span role="status" className="inline-block border border-accent px-2 py-1 text-[15px] font-mono text-accent">
              How many: {countPrefix}
            </span>
          )}
          {current && (
            <AppliedSpecies
              key={current.mediaID}
              tags={currentTags}
              labelOf={labelOf}
              disabled={!visibleSet.has(focus)}
              onSetCount={(key, n) => edit([current.mediaID], (list) => setCount(list, key, n))}
              onRemove={(key) => edit([current.mediaID], (list) => removeTag(list, key))}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => apply(NOTHING)}
              disabled={!hasTarget}
              className="min-h-11 px-3 border border-ink text-[16px] text-ink hover:bg-panelHover disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {NOTHING_LABEL}
            </button>
            <button
              onClick={clearAll}
              disabled={!hasTarget}
              className="min-h-11 px-2 text-[15px] text-inkSoft hover:text-warn underline decoration-dotted disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              title={selected.size ? `Remove every species from the ${selected.size} chosen photos` : 'Remove every species from this photo'}
            >
              Clear Species
            </button>
          </div>
        </div>
      }
    />
  );
  const tools = (
    <>
      <SaveIndicator status={tagging.status} />
      <button
        onClick={tagging.undo}
        disabled={!tagging.canUndo}
        className="min-h-11 px-3 border border-rule text-[16px] text-inkSoft hover:border-ink hover:text-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        title="Undo the last change (Ctrl+Z)"
      >
        ↶ Undo
      </button>
    </>
  );

  return (
    <div className="h-full flex flex-col min-h-0" aria-hidden={view === 'focus'}>
      <div className="shrink-0 border-b border-rule bg-panel flex flex-wrap items-center gap-3 px-3 py-2">
        <a href="#" className="min-h-11 inline-flex items-center px-2 text-[16px] text-accent underline">
          ← Your cards
        </a>
        <h1 className="font-display text-[22px] font-[600] text-ink truncate">{title}</h1>
        <div className="inline-flex border border-rule" role="group" aria-label="Show">
          {(
            [
              ['all', 'All photos'],
              ['untagged', 'Not tagged yet'],
              ['tagged', 'Tagged'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`min-h-11 px-3 text-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${filter === value ? 'bg-ink text-paper' : 'text-inkSoft hover:bg-panelHover'}`}
            >
              {label} ({counts[value].toLocaleString()})
            </button>
          ))}
        </div>
        <span className="min-w-[10rem] text-[16px] text-inkSoft">
          {selected.size > 0 ? <span className="text-accent">{selected.size} chosen</span> : position > 0 && `Photo ${position.toLocaleString()} of ${visible.length.toLocaleString()}`}
        </span>
        <label className="inline-flex items-center gap-2 min-h-11 text-[16px] text-inkSoft">
          <input
            type="checkbox"
            checked={advance}
            onChange={(e) => {
              setAdvance(e.target.checked);
              try {
                localStorage.setItem(ADVANCE_KEY, String(e.target.checked));
              } catch {
                /* the choice lasts for this visit */
              }
            }}
            className="w-5 h-5 accent-[var(--accent)]"
          />
          Go to the next photo after tagging
        </label>
        <div className="ml-auto flex items-center gap-3">
          {tools}
          <button
            onClick={() => setCheatsheet(true)}
            className="min-h-11 min-w-11 px-3 border border-rule text-[16px] text-inkSoft hover:border-ink hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            title="Keyboard shortcuts (?)"
          >
            ? Keys
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_400px]">
        {visible.length ? (
          <Grid
            card={card}
            visible={visible}
            tags={tags}
            focus={focus}
            selected={selected}
            summarize={summarize}
            onPick={stablePick}
            onOpen={openFocus}
          />
        ) : (
          <div className="p-6 text-[17px] text-inkSoft">
            <p role="status">{filter === 'untagged' ? 'Every photo on this card is tagged.' : 'No photos are tagged yet.'}</p>
            <button onClick={() => setFilter('all')} className="mt-3 min-h-11 px-3 border border-rule">
              Show all photos
            </button>
          </div>
        )}
        {view === 'grid' && panel}
      </div>

      {view === 'focus' && current && (
        <FocusView
          card={card}
          photo={current}
          position={Math.max(1, position)}
          count={visible.length}
          tagged={tagState(currentTags) !== 'untagged'}
          onPrev={nextVisibleIndex(visible, focus, -1) !== undefined ? () => step(-1) : undefined}
          onNext={nextVisibleIndex(visible, focus, 1) !== undefined ? () => step(1) : undefined}
          onClose={closeFocus}
          panel={panel}
          tools={tools}
        />
      )}
      {cheatsheet && <Cheatsheet onClose={() => setCheatsheet(false)} />}
      {zoom && (
        <Dialog label={`${zoom.name} picture`} onClose={() => setZoom(null)} wide>
          <DialogHeader title={zoom.name} onClose={() => setZoom(null)} />
          <div className="p-4 grid place-items-center">
            <img src={zoom.speciesIconURL} alt={zoom.name} className="max-w-full max-h-[70svh] object-contain border border-rule" />
          </div>
        </Dialog>
      )}
      {conflict && (
        <Dialog label="Key already used" onClose={() => setConflict(null)}>
          <DialogHeader title="That key is already used" onClose={() => setConflict(null)} />
          <p className="px-5 py-4 text-[17px]">
            The key <kbd className="px-1.5 border border-ink font-mono">{keyLabel(conflict.key)}</kbd> is on {conflict.others.map((o) => o.name).join(', ')}.
            Move it to {conflict.name}?
          </p>
          <div className="flex justify-end gap-3 px-5 pb-5">
            <button onClick={() => setConflict(null)} className="min-h-11 px-4 border border-rule text-[16px]">
              Keep it where it is
            </button>
            <button
              onClick={() => {
                keys.assign(conflict.own, conflict.key, conflict.others.map(speciesKey));
                setConflict(null);
              }}
              className="min-h-11 px-4 border border-ink bg-ink text-paper text-[16px]"
            >
              Move it to {conflict.name}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = { idle: '', saving: 'Saving…', saved: 'Saved ✓', error: "Couldn't save just now. Trying again; keep this page open." }[status];
  return (
    <span role="status" data-save-status={status} className={`text-[16px] ${status === 'error' ? 'text-warn max-w-[20rem]' : 'min-w-[6rem] text-ok'}`}>
      {text}
    </span>
  );
}
