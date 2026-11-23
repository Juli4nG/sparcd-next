import { useEffect, useRef, useState } from 'react';
import { PawPads } from '@sparcd/auth-ui';
import type { Card, ImageSize } from '../data/card';
import { thumbSlots } from './slots';

type ImageState = { url?: string; failed: boolean; retry: () => void };

/**
 * A photo's signed image URL; undefined until it's signed. `failed` when
 * signing or loading failed. A load error signs a fresh URL by itself, twice,
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
  // Each retry waits longer, for a random part of it, so images the server turned away together (HTTP 429) come back spread out.
  const onError = () => (n < 2 ? setTimeout(retry, 1000 * 2 ** n * (1 + Math.random())) : setState({ key, url: state.url, failed: true }));
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
      className="min-h-9 px-2 inline-flex items-center border border-rule bg-paper text-small text-ink underline"
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
  const [turn, setTurn] = useState<string>();
  const done = useRef(() => {});
  useEffect(() => {
    if (!url || !settled) return;
    done.current = thumbSlots(
      () => setTurn(url),
      () => {
        setTurn(undefined);
        onError();
      },
    );
    return done.current;
  }, [url, settled]);
  if (failed) {
    return (
      <div className="aspect-[4/3] bg-paperHover border border-rule flex flex-col items-center justify-center gap-1 text-small text-warn">
        Photo didn't load
        <TryAgain onClick={retry} />
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] bg-paperHover border border-rule overflow-hidden">
      {loaded !== url && (
        <svg aria-hidden viewBox="25 28 58 59" className="absolute inset-0 m-auto w-[44%] h-[44%] max-w-8 max-h-8 fill-ink fn-breathe">
          <PawPads />
        </svg>
      )}
      {url && turn === url && (
        <img
          src={url}
          alt={alt}
          decoding="async"
          onLoad={() => {
            done.current();
            setLoaded(url);
          }}
          onError={() => {
            done.current();
            onError();
          }}
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
        <circle cx="16" cy="16" r="14.5" className="fill-frame" fillOpacity="0.75" stroke="white" strokeWidth="2" />
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
        <path d="m6 16 7 7L26 8" className="stroke-frame" strokeWidth="9" />
        <path d="m6 16 7 7L26 8" stroke="white" strokeWidth="7" />
        <path d="m6 16 7 7L26 8" stroke="currentColor" strokeWidth="4" />
      </svg>
    </span>
  );
}
