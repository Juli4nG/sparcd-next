import { useEffect, useState } from 'react';
import type { Card, ImageSize } from '../data/card';

type ImageState = { url?: string; failed: boolean; retry: () => void };

/**
 * A photo's signed image URL; undefined until it's signed. `failed` when
 * signing or loading failed. A load error signs a fresh URL once by itself,
 * since a long session can outlive a signature; after that `retry` does.
 */
export function useImageUrl(card: Card, mediaID: string, size: ImageSize): ImageState & { onError: () => void } {
  const [state, setState] = useState<{ key: string; url?: string; failed: boolean }>({ key: '', failed: false });
  const [attempt, setAttempt] = useState({ key: '', n: 0 });
  const key = `${mediaID}/${size}`;
  const n = attempt.key === key ? attempt.n : 0;
  useEffect(() => {
    let live = true;
    card.imageUrl(mediaID, size, n > 0).then(
      (url) => live && setState({ key, url, failed: false }),
      () => live && setState({ key, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [card, mediaID, size, key, n]);
  const retry = () => setAttempt({ key, n: n + 1 });
  // The first retry waits a moment, so a burst the server turned away (HTTP 429) isn't repeated at once.
  const onError = () => (n === 0 ? setTimeout(retry, 1500) : setState({ key, url: state.url, failed: true }));
  return { ...(state.key === key ? state : { failed: false }), retry, onError };
}

function TryAgain({ onClick }: { onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      data-testid="photo-retry"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="min-h-9 px-2 inline-flex items-center border border-rule bg-paper text-[14px] text-ink underline"
    >
      Try again
    </span>
  );
}

/** The grid's 4:3 thumbnail; the photo fades in over a quiet placeholder. */
export function Thumb({ card, mediaID, alt }: { card: Card; mediaID: string; alt: string }) {
  const { url, failed, retry, onError } = useImageUrl(card, mediaID, 'thumb');
  const [loaded, setLoaded] = useState<string>();
  // Only tiles that stay on screen for a moment ask for their photo, so flicking through 5,000 photos doesn't flood the server.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 150);
    return () => clearTimeout(t);
  }, []);
  if (failed) {
    return (
      <div className="aspect-[4/3] bg-paperHover border border-rule flex flex-col items-center justify-center gap-1 text-[13px] text-warn">
        Photo didn't load
        <TryAgain onClick={retry} />
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] bg-paperHover border border-rule overflow-hidden">
      {loaded !== url && <div aria-hidden className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-ink fn-breathe" />}
      {url && settled && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(url)}
          onError={onError}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${loaded === url ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}

/** Marks a video's tile, in the corner across from the check mark. */
export function PlayBadge({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden data-testid="play-badge" className={`pointer-events-none inline-flex ${className}`}>
      <svg viewBox="0 0 32 32" className="w-full h-full">
        <circle cx="16" cy="16" r="14.5" fill="#172018" fillOpacity="0.75" stroke="white" strokeWidth="2" />
        <path d="M12.5 9.5v13l10.5-6.5z" fill="white" />
      </svg>
    </span>
  );
}

/** The old Tagger's "has species" check mark, drawn over a tile's corner. */
export function TaggedMark({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none inline-flex text-ok ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" className="w-full h-full" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 16 7 7L26 8" stroke="#172018" strokeWidth="9" />
        <path d="m6 16 7 7L26 8" stroke="white" strokeWidth="7" />
        <path d="m6 16 7 7L26 8" stroke="currentColor" strokeWidth="4" />
      </svg>
    </span>
  );
}
