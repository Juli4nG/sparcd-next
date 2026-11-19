import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Media } from '@sparcd/bucket';
import type { Card } from '../data/card';
import { TaggedMark, useImageUrl } from '../ui/Photo';

const navButton =
  'absolute top-1/2 z-20 w-14 h-14 -translate-y-1/2 grid place-items-center rounded-full border border-rule bg-paper/70 text-[30px] leading-none text-inkSoft shadow-sm hover:bg-paper hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** One photo large (view.jpg), with the species list beside it. */
export function FocusView({
  card,
  photo,
  position,
  count,
  tagged,
  onPrev,
  onNext,
  onClose,
  panel,
  tools,
}: {
  card: Card;
  photo: Media;
  position: number;
  count: number;
  tagged: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  panel: ReactNode;
  tools: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => closeRef.current?.focus(), []);
  const label = `Photo ${position.toLocaleString()} of ${count.toLocaleString()}`;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-paper text-ink" role="dialog" aria-modal="true" aria-label="Large photo">
      <div className="shrink-0 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-rule bg-panel px-3 py-1.5">
        <div className="min-w-0 truncate text-[15px] font-mono text-inkSoft" title={photo.fileName}>
          {photo.fileName}
        </div>
        <div role="progressbar" aria-label="Photo position" aria-valuemin={1} aria-valuenow={position} aria-valuemax={count} aria-valuetext={label} className="w-[min(30vw,280px)] text-center text-[15px] text-inkSoft">
          <span className="block whitespace-nowrap">{label}</span>
          <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ruleSoft">
            <span className="block h-full bg-accent" style={{ width: `${(position / count) * 100}%` }} />
          </span>
        </div>
        <div className="flex items-center justify-end gap-3">
          {tools}
          <button
            ref={closeRef}
            onClick={onClose}
            className="min-h-11 px-3 inline-flex items-center gap-2 border border-rule text-[16px] text-inkSoft hover:border-ink hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            title="Back to all photos (Esc)"
          >
            <span aria-hidden className="text-[22px] leading-none">×</span> Close
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative min-h-0 min-w-0 grid place-items-center p-4 overflow-hidden">
          <LargePhoto card={card} photo={photo} tagged={tagged} />
          {onPrev && (
            <button onClick={onPrev} className={`${navButton} left-3`} title="Previous photo (←)" aria-label="Previous photo">
              ‹
            </button>
          )}
          {onNext && (
            <button onClick={onNext} className={`${navButton} right-3`} title="Next photo (→)" aria-label="Next photo">
              ›
            </button>
          )}
        </div>
        {panel}
      </div>
    </div>,
    document.body,
  );
}

function LargePhoto({ card, photo, tagged }: { card: Card; photo: Media; tagged: boolean }) {
  const { url, failed } = useImageUrl(card, photo.mediaID, 'view');
  const [loaded, setLoaded] = useState<string>();
  const [broken, setBroken] = useState<string>();
  if (failed || (url && broken === url)) return <p className="text-[16px] text-warn">This photo didn't load. Check your internet connection, then try again.</p>;
  return (
    <>
      {url && (
        <span className="relative max-w-full max-h-full">
          <img
            src={url}
            alt={photo.fileName}
            onLoad={() => setLoaded(url)}
            onError={() => setBroken(url)}
            className="block max-w-full max-h-[calc(100dvh-7rem)] object-contain select-none"
            draggable={false}
          />
          {tagged && loaded === url && <TaggedMark className="absolute top-1 left-1 w-[clamp(28px,4vw,56px)] aspect-square" />}
        </span>
      )}
      {loaded !== url && <p role="status" className="absolute inset-0 grid place-items-center text-[15px] text-inkMute bg-paper">Loading the photo…</p>}
    </>
  );
}
