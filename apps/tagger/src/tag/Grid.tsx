import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Media } from '@sparcd/bucket';
import type { Card } from '../data/card';
import { tagState, type PhotoTag } from '../data/tags';
import { TaggedMark, Thumb } from '../ui/Photo';

export type PickMods = { shift: boolean; add: boolean };

const GAP = 8;
const CELL_MIN = 200;
const LABEL_H = 34;

/**
 * The card as a grid of thumbnails. Only the rows on screen mount, so a
 * 5,000-photo card scrolls smoothly, and a tag change re-renders only its tile.
 */
export function Grid({
  card,
  visible,
  tags,
  focus,
  selected,
  summarize,
  onPick,
  onFocusTile,
  onOpen,
}: {
  card: Card;
  visible: number[];
  tags: Map<string, PhotoTag[]>;
  focus: number;
  selected: Set<number>;
  summarize: (tags: PhotoTag[]) => string;
  onPick: (index: number, mods: PickMods) => void;
  onFocusTile: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = parentRef.current!;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, width - 2 * GAP);
  const cols = Math.max(1, Math.floor((inner + GAP) / (CELL_MIN + GAP)));
  const cellW = (inner - (cols - 1) * GAP) / cols;
  const rowH = Math.round(cellW * 0.75 + 8 + LABEL_H + GAP);
  const rows = Math.ceil(visible.length / cols);
  const rowOf = useMemo(() => new Map(visible.map((index, at) => [index, Math.floor(at / cols)])), [visible, cols]);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 4,
  });
  useEffect(() => virtualizer.measure(), [rowH, virtualizer]);

  useEffect(() => {
    const row = rowOf.get(focus);
    if (row !== undefined) virtualizer.scrollToIndex(row, { align: 'auto' });
    // A tile left holding DOM focus would open the wrong photo on Enter.
    const held = document.activeElement as HTMLElement | null;
    if (held?.dataset.index && Number(held.dataset.index) !== focus) held.blur();
  }, [focus, rowOf, virtualizer]);

  return (
    <div ref={parentRef} data-testid="photo-grid" className="h-full overflow-y-auto min-h-0 bg-panel">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.index}
            className="grid px-2"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: rowH,
              paddingTop: GAP,
              columnGap: GAP,
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {visible.slice(row.index * cols, row.index * cols + cols).map((index) => {
              const photo = card.photos[index];
              return (
                <Tile
                  key={photo.mediaID}
                  card={card}
                  photo={photo}
                  index={index}
                  tags={tags.get(photo.mediaID)}
                  active={index === focus}
                  selected={selected.has(index)}
                  summarize={summarize}
                  onPick={onPick}
                  onFocusTile={onFocusTile}
                  onOpen={onOpen}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const Tile = memo(function Tile({
  card,
  photo,
  index,
  tags,
  active,
  selected,
  summarize,
  onPick,
  onFocusTile,
  onOpen,
}: {
  card: Card;
  photo: Media;
  index: number;
  tags: PhotoTag[] | undefined;
  active: boolean;
  selected: boolean;
  summarize: (tags: PhotoTag[]) => string;
  onPick: (index: number, mods: PickMods) => void;
  onFocusTile: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const state = tagState(tags);
  const label = state === 'untagged' ? 'Not tagged yet' : summarize(tags!);
  const name = photo.fileName ?? '';
  return (
    <button
      data-testid="photo-tile"
      data-index={index}
      data-tag-state={state}
      onClick={(e) => {
        // A keyboard Enter or Space on a tile opens it, like a double click.
        if (e.detail === 0) return onOpen(index);
        if (e.detail > 1) return;
        onPick(index, { shift: e.shiftKey, add: e.metaKey || e.ctrlKey });
      }}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && onFocusTile(index)}
      onDoubleClick={(e) => !e.shiftKey && !e.metaKey && !e.ctrlKey && onOpen(index)}
      aria-current={active ? 'true' : undefined}
      aria-pressed={selected}
      aria-label={`${name}: ${label}`}
      title={name}
      className={`relative flex flex-col text-left border p-1 min-w-0 ${
        selected ? 'border-accent ring-2 ring-inset ring-accent bg-mark' : active ? 'border-ink border-2 bg-mark' : 'border-rule hover:bg-panelHover'
      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2`}
    >
      <span className="relative block">
        <Thumb card={card} mediaID={photo.mediaID} alt={name} />
        {state !== 'untagged' && <TaggedMark className="absolute top-1 left-1 w-1/5 aspect-square" />}
      </span>
      <span className={`mt-1 block truncate text-[15px] leading-[26px] ${state === 'untagged' ? 'text-inkMute' : 'text-ink'}`}>{label}</span>
    </button>
  );
});
