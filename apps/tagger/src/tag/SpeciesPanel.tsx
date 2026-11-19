import type { ReactNode, RefObject } from 'react';
import type { Species } from '@sparcd/bucket';
import { speciesKey } from '../data/tags';

// The species list stays browsable, not only searchable: volunteers scan it to
// recognise an animal. Each row has its reference picture, both names, and its key.

export type SpeciesPanelProps = {
  displayed: Species[];
  search: string;
  onSearch: (value: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  keyFor: (s: Species) => string | null;
  conflictFor: (s: Species) => string | null;
  capturingFor: string | null;
  onStartCapture: (own: string) => void;
  onClearKey: (own: string) => void;
  keysUnsaved: boolean;
  applied: Set<string>;
  selectionCount: number;
  disabled: boolean;
  selectedKey: string | null;
  onSelect: (own: string) => void;
  onApply: (s: Species) => void;
  onZoom: (s: Species) => void;
  header: ReactNode;
};

export function SpeciesPanel(p: SpeciesPanelProps) {
  return (
    <div data-testid="species-panel" className="h-full flex flex-col border-l border-rule bg-panel min-h-0">
      {p.keysUnsaved && (
        <div role="alert" className="px-3 py-2 border-b border-warn text-[14px] text-warn">
          This browser couldn't keep your key choices. They'll reset when you reload.
        </div>
      )}
      {p.selectionCount > 1 && (
        <div className="px-3 py-2 bg-mark border-b border-rule text-[15px] text-accent">Tags go on all {p.selectionCount} chosen photos</div>
      )}
      <div className="p-3 border-b border-rule space-y-3">
        <input
          ref={p.searchRef}
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          placeholder="Search species…  (Space)"
          className="w-full bg-paper border border-rule px-3 py-2.5 text-[17px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search species"
        />
        {p.header}
        <p className="text-[13px] tracking-[0.12em] uppercase text-inkSoft">Available species</p>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {p.displayed.map((s) => {
          const own = speciesKey(s);
          return (
            <Row
              key={own}
              species={s}
              badge={p.keyFor(s)}
              conflict={p.conflictFor(s)}
              capturing={p.capturingFor === own}
              applied={p.applied.has(own)}
              selected={p.selectedKey === own}
              disabled={p.disabled}
              onSelect={() => p.onSelect(own)}
              onApply={() => p.onApply(s)}
              onZoom={() => p.onZoom(s)}
              onStartCapture={() => p.onStartCapture(own)}
              onClearKey={() => p.onClearKey(own)}
            />
          );
        })}
        {!p.displayed.length && <p className="p-4 text-[15px] text-inkMute">No species match “{p.search.trim()}”.</p>}
      </div>
    </div>
  );
}

type RowProps = {
  species: Species;
  badge: string | null;
  conflict: string | null;
  capturing: boolean;
  applied: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onApply: () => void;
  onZoom: () => void;
  onStartCapture: () => void;
  onClearKey: () => void;
};

function Row(p: RowProps) {
  const { name, scientificName, speciesIconURL } = p.species;
  const hidden = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';
  return (
    <div className={`group relative flex items-center gap-3 px-3 py-2 border-b border-ruleSoft ${p.selected ? 'bg-mark ring-2 ring-inset ring-accent' : 'hover:bg-panelHover'}`}>
      {speciesIconURL && (
        <button
          type="button"
          onClick={p.onZoom}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 z-10 cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title="See a larger picture"
          aria-label={`See a larger picture of ${name}`}
        />
      )}
      <button
        onClick={p.onSelect}
        disabled={p.disabled}
        aria-pressed={p.selected}
        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2"
      >
        {speciesIconURL ? (
          <img src={speciesIconURL} alt="" loading="lazy" className="w-12 h-12 object-cover border border-rule bg-paperHover shrink-0" />
        ) : (
          <span className="w-12 h-12 grid place-items-center border border-rule bg-paperHover text-inkMute shrink-0">—</span>
        )}
        <span className="min-w-0">
          <span className="block text-[17px] text-ink truncate">{name}</span>
          {scientificName && <span className="block text-[13px] text-inkMute italic truncate">{scientificName}</span>}
        </span>
        {p.applied && (
          <span className="ml-auto text-accent text-[17px] shrink-0" aria-label="On this photo" title="On this photo">
            ✓
          </span>
        )}
      </button>
      <div className="flex items-center gap-1 shrink-0">
        {p.capturing ? (
          <span className="text-[14px] text-accent animate-pulse">press a key, or tap Shift/Control…</span>
        ) : (
          <>
            <button
              onClick={p.onStartCapture}
              className={`min-h-11 px-1 text-[13px] text-inkSoft hover:text-ink underline decoration-dotted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${hidden}`}
              title="Choose a key for this species"
            >
              {p.badge ? 'change key' : 'set key'}
            </button>
            {p.badge && (
              <button
                onClick={p.onClearKey}
                className={`w-8 h-11 text-[14px] text-inkMute hover:text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${hidden}`}
                title="Remove this key"
                aria-label={`Remove the key for ${name}`}
              >
                ✕
              </button>
            )}
            <button
              onClick={p.onApply}
              disabled={p.disabled}
              className="w-11 h-11 grid place-items-center text-[22px] text-accent hover:bg-paperHover disabled:text-inkMute focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              title={p.applied ? `${name} is already on this photo` : `Add ${name}`}
              aria-label={p.applied ? `${name} is already on this photo` : `Add ${name}`}
            >
              +
            </button>
            <span className="inline-flex w-16 shrink-0 justify-center">
              {p.badge && (
                <kbd
                  className={`px-1 h-7 min-w-7 grid place-items-center border text-[13px] font-mono ${p.conflict ? 'border-inkMute text-inkMute line-through' : 'border-ink text-ink'}`}
                  title={p.conflict ?? undefined}
                >
                  {p.badge}
                </kbd>
              )}
            </span>
            {p.conflict && <span className="sr-only">{p.conflict}</span>}
          </>
        )}
      </div>
    </div>
  );
}
