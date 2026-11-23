import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Media } from '@sparcd/bucket';
import { focusRing } from '@sparcd/auth-ui';
import type { Card } from '../data/card';
import type { PhotoTag } from '../data/tags';
import { PlayBadge, TaggedMark, Thumb } from './Photo';
import { PhotoIcon, Pill } from './Pill';
import { filterCounts, filtered, gridColumns, isVideo, tileLabel, type GridFilter } from './view';

const GAP = 12;
const PAD = 20;
/** Rows mounted beyond each edge of the screen. Each tile asks for its thumbnail, so this stays small. */
const BUFFER = 1;

const FILTERS: { id: GridFilter; label: string }[] = [
  { id: 'left', label: 'Left to tag' },
  { id: 'tagged', label: 'Tagged' },
  { id: 'all', label: 'All' },
];

type Props = {
  card: Card;
  photos: Media[];
  tags: Map<string, PhotoTag[]>;
  focus: number;
  filter: GridFilter;
  onFilter: (f: GridFilter) => void;
  nameOf: (t: PhotoTag) => string;
  onPick: (i: number) => void;
  onClose: () => void;
};

/** Every photo in the upload as thumbnails, for seeing and jumping. Only the rows on screen are mounted. */
export function PhotoGrid({ card, photos, tags, focus, filter, onFilter, nameOf, onPick, onClose }: Props) {
  const counts = useMemo(() => filterCounts(photos, tags), [photos, tags]);
  const shown = useMemo(() => filtered(photos, tags, filter), [photos, tags, filter]);
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const aimed = useRef<GridFilter | null>(null);

  const width = Math.max(0, size.w - 2 * PAD);
  const cols = gridColumns(width);
  const rowH = ((width - (cols - 1) * GAP) / cols) * 0.75 + GAP;
  const rows = Math.ceil(shown.length / cols);
  // From the real scroll position each render, so a resize that changes the row height keeps the screen filled.
  const topRow = Math.max(0, Math.floor((scrollTop - PAD) / rowH));

  useLayoutEffect(() => {
    const el = scroller.current!;
    const measure = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      setScrollTop(el.scrollTop);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);
  // On opening, and on each filter, the current photo (or the next one shown) sits mid-screen.
  useLayoutEffect(() => {
    if (!size.w || aimed.current === filter) return;
    aimed.current = filter;
    const at = shown.findIndex((i) => i >= focus);
    const row = Math.floor((at < 0 ? shown.length - 1 : at) / cols);
    scroller.current!.scrollTop = Math.max(0, PAD + row * rowH - (size.h - rowH) / 2);
    setScrollTop(scroller.current!.scrollTop);
  }, [size, filter, shown, focus, cols, rowH]);

  const first = Math.max(0, topRow - BUFFER);
  const last = Math.min(rows, topRow + Math.ceil(size.h / rowH) + 1 + BUFFER);
  const focused = useRef(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="grid">
      <div className="shrink-0 flex flex-wrap items-center gap-3 px-5 py-3 border-b border-rule">
        {/* Where All photos sat over the photo, so it reads as switching the view back, not as leaving the upload. */}
        <Pill className="shrink-0 border border-rule" onClick={onClose} label="One photo" icon={<PhotoIcon />} />
        <div role="group" aria-label="Show" className="flex-1 min-w-[min(100%,30rem)] grid grid-cols-3 border border-rule divide-x divide-rule">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`min-h-12 px-2 py-1 leading-tight text-detail ${filter === f.id ? 'bg-ink text-paper font-[600]' : 'bg-panel text-ink hover:bg-paperHover'} ${focusRing}`}
            >
              {f.label} <span className="tabular-nums">({counts[f.id].toLocaleString()})</span>
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: PAD }}
      >
        {!shown.length && (
          <p className="text-body text-inkSoft">{filter === 'left' ? 'Every photo is tagged.' : 'No photo is tagged yet.'}</p>
        )}
        <div className="relative" style={{ height: Math.max(0, rows * rowH - GAP) }}>
          <ol
            aria-label="All photos"
            className="absolute inset-x-0 top-0 grid"
            style={{ gap: GAP, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, transform: `translateY(${first * rowH}px)` }}
          >
            {shown.slice(first * cols, last * cols).map((i) => {
              const p = photos[i];
              const label = tileLabel(tags.get(p.mediaID), nameOf);
              const current = i === focus;
              return (
                <li key={p.mediaID}>
                  <button
                    ref={(el) => {
                      // Keyboard users start on the current photo.
                      if (el && current && !focused.current) {
                        focused.current = true;
                        el.focus({ preventScroll: true });
                      }
                    }}
                    onClick={() => onPick(i)}
                    aria-current={current ? 'true' : undefined}
                    aria-label={`${isVideo(p) ? 'Video' : 'Photo'} ${(i + 1).toLocaleString()}${label ? `, ${label}` : ''}`}
                    className={`relative block w-full ${current ? 'outline outline-[4px] outline-offset-2 outline-accent' : ''} ${focusRing}`}
                  >
                    <Thumb card={card} mediaID={p.mediaID} alt="" />
                    {isVideo(p) && <PlayBadge className="absolute top-1 right-1 w-7 h-7" />}
                    {label && (
                      <>
                        <TaggedMark className="absolute top-1 left-1 w-7 h-7" />
                        <span className="absolute inset-x-0 bottom-0 truncate px-2 py-1 bg-frame/80 text-left text-small font-[550] text-white">{label}</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
