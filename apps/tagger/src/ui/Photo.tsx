import { useEffect, useState } from 'react';
import type { Card, ImageSize } from '../data/card';

/** A photo's signed image URL; undefined until it's signed, or when signing failed. */
export function useImageUrl(card: Card, mediaID: string, size: ImageSize): { url?: string; failed: boolean } {
  const [state, setState] = useState<{ key: string; url?: string; failed: boolean }>({ key: '', failed: false });
  const key = `${mediaID}/${size}`;
  useEffect(() => {
    let live = true;
    let objectUrl: string | undefined;
    card.imageUrl(mediaID, size).then(
      (url) => {
        if (url.startsWith('blob:')) objectUrl = url;
        if (live) setState({ key, url, failed: false });
        else if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
      () => live && setState({ key, failed: true }),
    );
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [card, mediaID, size, key]);
  return state.key === key ? state : { failed: false };
}

/** The grid's 4:3 thumbnail; the photo fades in over a quiet placeholder. */
export function Thumb({ card, mediaID, alt }: { card: Card; mediaID: string; alt: string }) {
  const { url, failed } = useImageUrl(card, mediaID, 'thumb');
  const [loaded, setLoaded] = useState<string>();
  const [broken, setBroken] = useState<string>();
  if (failed || (url && broken === url)) {
    return (
      <div className="aspect-[4/3] bg-paperHover border border-rule grid place-items-center text-[13px] text-warn">
        Photo didn't load
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] bg-paperHover border border-rule overflow-hidden">
      {loaded !== url && <div aria-hidden className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-ink fn-breathe" />}
      {url && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(url)}
          onError={() => setBroken(url)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${loaded === url ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
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
