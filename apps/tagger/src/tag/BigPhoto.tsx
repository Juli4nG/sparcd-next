import { useEffect, useRef, useState } from 'react';
import type { Media } from '@sparcd/bucket';
import { focusRing } from '@sparcd/auth-ui';
import type { Card } from '../data/card';
import { useImageUrl } from './Photo';
import { BRIGHTEN, DOUBLE_TAP_ZOOM, NO_ZOOM, ORIGINAL_AT, brightenFilter, clampZoom, contained, zoomAt, type Size, type Zoom } from './view';

type Point = { x: number; y: number };
type Gesture = { start: Zoom; from: Point; dist: number; moved: boolean };

const TAP_MS = 300;
const TAP_SLOP = 24;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The large photo. Pinch, the wheel or a double tap zooms it up to 4×, and a drag moves around while zoomed.
 * Past 1.5× the full-size original loads over view.jpg. A new photo remounts it, which resets the zoom.
 */
export function BigPhoto({ card, photo, alt, brighten, onShown }: { card: Card; photo: Media; alt: string; brighten: number; onShown: () => void }) {
  // A failed load signs a fresh link once by itself; after that the person asks for it.
  const { url, failed, retry, onError } = useImageUrl(card, photo.mediaID, 'view');
  const [loaded, setLoaded] = useState<string>();
  const [image, setImage] = useState<Size>();
  const [zoom, setZoomState] = useState(NO_ZOOM);
  const [glide, setGlide] = useState(false);
  const [big, setBig] = useState(false);
  if (zoom.s > ORIGINAL_AT && !big) setBig(true);

  const box = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ at: number; p: Point } | null>(null);

  const setZoom = (z: Zoom, animate = false) => {
    zoomRef.current = z;
    setZoomState(z);
    setGlide(animate);
  };
  /** The photo's and the box's sizes; null until the photo has loaded. */
  const sizes = () => {
    if (!image || !box.current) return null;
    const b = { w: box.current.clientWidth, h: box.current.clientHeight };
    return { photo: contained(image, b), box: b };
  };
  /** Relative to the box's centre, where the transform's origin is. */
  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  const begin = (moved: boolean) => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = { start: zoomRef.current, from: b ? mid(a, b) : a, dist: b ? dist(a, b) : 0, moved };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !sizes()) return;
    box.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, at(e));
    begin(pointers.current.size > 1);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const s = sizes();
    if (!g || !s || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, at(e));
    const [a, b] = [...pointers.current.values()];
    if (b) return setZoom(zoomAt(g.start, (g.start.s * dist(a, b)) / g.dist, g.from, s.photo, s.box, mid(a, b)));
    if (dist(a, g.from) > TAP_SLOP / 2) g.moved = true;
    if (g.moved && g.start.s > 1) setZoom(clampZoom({ ...g.start, x: g.start.x + a.x - g.from.x, y: g.start.y + a.y - g.from.y }, s.photo, s.box));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!pointers.current.delete(e.pointerId) || !g) return;
    // Lifting one finger of a pinch carries on as a drag with the other.
    if (pointers.current.size) return begin(true);
    gesture.current = null;
    const s = sizes();
    if (g.moved || e.type === 'pointercancel' || !s) return;
    const p = at(e);
    const last = lastTap.current;
    if (last && e.timeStamp - last.at < TAP_MS && dist(p, last.p) < TAP_SLOP) {
      lastTap.current = null;
      setZoom(zoomRef.current.s > 1 ? NO_ZOOM : zoomAt(zoomRef.current, DOUBLE_TAP_ZOOM, p, s.photo, s.box), true);
    } else lastTap.current = { at: e.timeStamp, p };
  };

  // React's wheel listener is passive, and zooming must keep the page from scrolling.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  onWheel.current = (e) => {
    const s = sizes();
    const z = zoomRef.current;
    // At 1×, scrolling down still scrolls the page.
    if (!s || (!e.ctrlKey && z.s === 1 && e.deltaY > 0)) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 40 : 1);
    setZoom(zoomAt(z, z.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), at(e), s.photo, s.box));
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [failed]);

  if (failed)
    return (
      <div className="absolute inset-0 grid place-content-center justify-items-center gap-5 p-8 text-center">
        <p className="text-[20px] text-paper/80">This photo didn't load. Check your internet connection.</p>
        <button onClick={retry} className={`h-14 px-6 border-2 border-paper/80 text-paper text-[20px] font-[600] hover:bg-paper/10 ${focusRing}`}>
          Try again
        </button>
      </div>
    );
  const zoomed = zoom.s > 1;
  return (
    <>
      {loaded !== url && <div aria-hidden className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-paper fn-breathe" />}
      <svg aria-hidden width="0" height="0" className="absolute">
        {BRIGHTEN.slice(1).map((b, i) => (
          <filter key={b.state} id={`brighten-${i + 1}`} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="gamma" exponent={b.gamma} />
              <feFuncG type="gamma" exponent={b.gamma} />
              <feFuncB type="gamma" exponent={b.gamma} />
            </feComponentTransfer>
          </filter>
        ))}
      </svg>
      <div
        ref={box}
        data-testid="zoom"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // At 1× a vertical swipe still scrolls the page on a phone.
        style={{ touchAction: zoomed ? 'none' : 'pan-y' }}
        className={`absolute inset-0 overflow-hidden ${zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
      >
        <div
          data-testid="photo-layer"
          style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`, filter: brightenFilter(brighten) }}
          className={`absolute inset-0 ${glide ? 'transition-transform duration-200 ease-out motion-reduce:transition-none' : ''}`}
        >
          {url && (
            <img
              src={url}
              alt={alt}
              draggable={false}
              onLoad={(e) => {
                setImage({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                setLoaded(url);
                onShown();
              }}
              onError={onError}
              className={`absolute inset-0 w-full h-full object-contain select-none transition-opacity duration-200 ease-out motion-reduce:transition-none ${loaded === url ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
          {big && image && <Original card={card} mediaID={photo.mediaID} aspect={image.w / image.h} />}
        </div>
      </div>
      {zoomed && (
        <button
          onClick={() => setZoom(NO_ZOOM, true)}
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 h-12 px-5 rounded-full bg-paper/85 text-[18px] font-[600] text-ink shadow hover:bg-paper ${focusRing}`}
        >
          Zoom out
        </button>
      )}
    </>
  );
}

/** The full-size photo, shown over view.jpg once it has loaded. */
function Original({ card, mediaID, aspect }: { card: Card; mediaID: string; aspect: number }) {
  const { url, onError } = useImageUrl(card, mediaID, 'original');
  const [shown, setShown] = useState(false);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      data-testid="original"
      data-loaded={shown}
      // The stored original has no EXIF, so one the camera meant to be turned would show on its side; view.jpg stays then.
      onLoad={(e) => setShown(Math.abs(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight - aspect) < 0.02)}
      onError={onError}
      className={`absolute inset-0 w-full h-full object-contain select-none ${shown ? '' : 'invisible'}`}
    />
  );
}
