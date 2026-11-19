import { useEffect, useMemo, useRef, useState } from 'react';
import { readPackage, type Media, type Session, type Species } from '@sparcd/bucket';
import { burstsOf, untaggedBurst, type Burst } from '../data/bursts';
import type { Card } from '../data/card';
import type { SaveStatus } from '../data/saver';
import { addTag, NOTHING, removeTag, setCount as setTagCount, speciesTag, tagState, type PhotoTag } from '../data/tags';
import type { Tagging } from '../data/useTagging';
import { simpleFlag } from '../lib/simpleFlag';
import { useSpeciesResults } from '../lib/useSpeciesResults';
import { MAX_COUNT } from '../tag/AppliedSpecies';
import { Dialog, dialogOpen } from '../ui/Dialog';
import { TaggedMark, Thumb, useImageUrl } from '../ui/Photo';
import { siteFavorites } from './favorites';
import './simple.css';

const FAVORITES = 6;
const STRIP = 9;
/** Longer runs are a camera on a timer, not one visit: their photos are tagged one by one. */
const MAX_BURST = 12;
const UNDO_LIMIT = 50;
const NONE: PhotoTag[] = [];
const NOTHING_HERE = 'Nothing here';
/** A new photo takes tags only once it shows, and not sooner than this: a second click meant for the last photo lands on nothing. */
const SETTLE_MS = 300;

const focusRing = 'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent';
const press = 'transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none';

type Props = { session: Session; species: Species[]; card: Card; title: string; tagging: Tagging };

/** The simpler tagging screen: one photo at a time, a few big answers, and it moves on by itself. */
export function SimpleTag(props: Props) {
  const { session, species, card } = props;
  // A shared card, or one with no site, has no history of the person's own to rank by.
  const bySite = card.own && !!card.deployment.locationID;
  const labKeys = () => siteFavorites(species, [], new Set(), FAVORITES);
  const [favorites, setFavorites] = useState<Species[] | null>(() => (bySite ? null : labKeys()));
  useEffect(() => {
    if (!bySite) return;
    const fallback = () => setFavorites(labKeys());
    readPackage(session.bucket).then((rows) => {
      const site = new Set(rows.deployments.filter((d) => d.locationID === card.deployment.locationID).map((d) => d.deploymentID));
      setFavorites(siteFavorites(species, rows.observations, site, FAVORITES));
    }, fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, species, card, bySite]);
  if (!favorites)
    return (
      <p role="status" className="h-full grid place-items-center text-[20px] text-inkMute">
        Loading the photos…
      </p>
    );
  return <Screen {...props} favorites={favorites} />;
}

function Screen({ species, card, title, tagging, favorites }: Props & { favorites: Species[] }) {
  const { tags } = tagging;
  const photos = card.photos;
  const bursts = useMemo(() => burstsOf(photos), [photos]);
  const byKey = useMemo(() => new Map(species.map((s) => [speciesTag(s).key, s])), [species]);

  const [focus, setFocus] = useState(() => Math.max(0, photos.findIndex((p) => tagState(tags.get(p.mediaID)) === 'untagged')));
  const [count, setCount] = useState(1);
  const [justOne, setJustOne] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [loaded, setLoaded] = useState<string>();
  const [settled, setSettled] = useState<string>();
  const [receipt, setReceiptState] = useState<{ text: string; n: number } | null>(null);
  const setReceipt = (text: string) => setReceiptState((r) => ({ text, n: (r?.n ?? 0) + 1 }));
  const [keysUsed, setKeysUsed] = useState(false);
  const undoFocus = useRef<number[]>([]);
  const latest = useRef(tags);
  useEffect(() => {
    latest.current = tags;
  }, [tags]);

  const current: Media | undefined = photos[focus];
  const currentTags = (current && tags.get(current.mediaID)) || NONE;
  const untagged = tagState(currentTags) === 'untagged';
  const run = bursts[focus];
  const burst = run && run.end - run.start < MAX_BURST && untaggedBurst(run, photos, tags) ? run : null;
  const wholeBurst = !!burst && justOne !== burst.eventID;
  const shown = !!current && loaded === current.mediaID && settled === current.mediaID;
  const burstIds = (b: Burst) => photos.slice(b.start, b.end + 1).map((p) => p.mediaID);
  const tagged = useMemo(() => photos.filter((p) => tagState(tags.get(p.mediaID)) !== 'untagged').length, [photos, tags]);
  const finished = photos.length > 0 && tagged === photos.length;

  useEffect(() => {
    const id = current?.mediaID;
    const timer = setTimeout(() => setSettled(id), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [current?.mediaID]);
  // The next few large photos, so moving on shows them at once.
  useEffect(() => {
    for (const p of photos.slice(focus + 1, focus + 7))
      card.imageUrl(p.mediaID, 'view').then(
        (url) => void (new Image().src = url),
        () => {},
      );
  }, [card, photos, focus]);

  const no = (i: number) => (i + 1).toLocaleString();
  const nameOf = (t: PhotoTag) => (t.observationType === 'blank' ? NOTHING_HERE : (byKey.get(t.key)?.name ?? (t.scientificName || 'Unknown')));
  const moveTo = (i: number) => {
    setFocus(i);
    setCount(1);
  };
  const go = (i: number) => moveTo(Math.min(photos.length - 1, Math.max(0, i)));

  const change = (ids: string[], fn: (list: PhotoTag[]) => PhotoTag[], note: string) => {
    if (!shown) return null;
    const before = latest.current;
    const after = tagging.edit(ids, fn);
    if (after === before) return null;
    latest.current = after;
    undoFocus.current = [...undoFocus.current.slice(1 - UNDO_LIMIT), focus];
    setReceipt(note);
    return after;
  };

  const apply = (tag: PhotoTag) => {
    if (!current) return;
    const whole = wholeBurst ? burst : null;
    const label = tag.observationType === 'blank' ? NOTHING_HERE : `${tag.count > 1 ? `${tag.count} × ` : ''}${nameOf(tag)}`;
    const where = whole ? `photos ${no(whole.start)} to ${no(whole.end)}` : `photo ${no(focus)}`;
    const after = change(
      whole ? burstIds(whole) : [current.mediaID],
      (list) => addTag(list, whole ? { ...tag, eventID: whole.eventID } : tag),
      `${label} on ${where}`,
    );
    if (!after || !untagged) return;
    for (let k = 1; k < photos.length; k++) {
      const i = (focus + k) % photos.length;
      if (tagState(after.get(photos[i].mediaID)) === 'untagged') return moveTo(i);
    }
  };
  const pickSpecies = (s: Species) => apply(speciesTag(s, count));

  const undo = () => {
    if (!tagging.canUndo) return;
    tagging.undo();
    const back = undoFocus.current.pop();
    if (back !== undefined) moveTo(back);
    setReceipt('Undone');
  };

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (picker || dialogOpen()) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return undo();
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
    const digit = /^[0-9]$/.test(e.key) && !e.repeat ? Number(e.key) : -1;
    if (digit > 0 && digit <= favorites.length) pickSpecies(favorites[digit - 1]);
    else if (digit === 0) apply(NOTHING);
    else if (e.key === 'ArrowRight') go(focus + 1);
    else if (e.key === 'ArrowLeft') go(focus - 1);
    else if (e.key === '/') setPicker(true);
    else return;
    e.preventDefault();
    setKeysUsed(true);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const applied = new Set(currentTags.map((t) => t.key));

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 h-16 flex items-center gap-5 px-5 border-b border-rule bg-panel">
        <a href="#" className={`shrink-0 min-h-11 inline-flex items-center text-[20px] text-accent underline underline-offset-4 ${focusRing}`}>
          ← Your cards
        </a>
        <h1 className="min-w-0 truncate font-display text-[24px] font-[600] text-ink">{title}</h1>
        <Progress done={tagged} total={photos.length} />
        <SaveIndicator status={tagging.status} />
        <a href={simpleFlag(location.hash).rest} className={`shrink-0 min-h-11 inline-flex items-center text-[18px] text-inkSoft underline underline-offset-4 hover:text-ink ${focusRing}`}>
          Back to the usual screen
        </a>
      </div>

      {current ? (
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 min-[900px]:overflow-visible min-[900px]:grid-cols-[minmax(0,1fr)_clamp(440px,34vw,500px)]">
          <section className="min-w-0 flex flex-col gap-3 px-5 pt-4 pb-4 min-[900px]:min-h-0" aria-label="Photo">
            <div className="relative aspect-[4/3] bg-ink overflow-hidden min-[900px]:aspect-auto min-[900px]:flex-1 min-[900px]:min-h-0">
              <BigPhoto key={current.mediaID} card={card} photo={current} alt={`Photo ${no(focus)}`} onShown={() => setLoaded(current.mediaID)} />
              <NavButton side="left" hidden={focus === 0} onClick={() => go(focus - 1)} />
              <NavButton side="right" hidden={focus === photos.length - 1} onClick={() => go(focus + 1)} />
            </div>
            <div className="shrink-0 h-12 flex items-center gap-4">
              <span className="shrink-0 text-[20px] text-inkSoft tabular-nums">
                Photo {no(focus)} of {photos.length.toLocaleString()} <span className="text-inkMute">· {clock(current.timestamp)}</span>
              </span>
              <span role="status" className="ml-auto min-w-0 truncate text-[20px] text-ink" data-testid="receipt">
                {receipt && (
                  <span key={receipt.n} className="fn-rise inline-flex items-center gap-2">
                    {receipt.text !== 'Undone' && <span className="text-ok" aria-hidden>✓</span>}
                    {receipt.text}
                  </span>
                )}
              </span>
              <button
                onClick={undo}
                disabled={!tagging.canUndo}
                title="Undo (Ctrl+Z)"
                className={`shrink-0 h-12 px-4 border border-ink bg-paper text-[20px] text-ink hover:bg-paperHover disabled:border-ruleSoft disabled:text-inkMute disabled:bg-transparent ${press} ${focusRing}`}
              >
                ↶ Undo
              </button>
            </div>
            <Strip card={card} photos={photos} tags={tags} bursts={bursts} focus={focus} onPick={go} />
          </section>

          <aside className="border-t border-rule px-6 py-5 flex flex-col gap-4 min-[900px]:min-h-0 min-[900px]:overflow-y-auto min-[900px]:border-t-0 min-[900px]:border-l" aria-label="What’s in this photo?">
            {/* Room for two lines either way, so the thank-you doesn't push the answers down. */}
            <h2 className={`h-[4.75rem] shrink-0 font-display text-[30px] leading-tight font-[600] ${finished ? 'text-ok' : 'text-ink'}`}>
              {finished ? 'Every photo is tagged. Thank you!' : 'What’s in this photo?'}
            </h2>

            {untagged ? (
              <div className="h-14 flex items-center justify-between gap-3">
                <span className="text-[20px] text-ink">How many?</span>
                <Stepper value={count} onChange={setCount} label="How many animals" />
              </div>
            ) : (
              <div className="min-h-14 flex flex-col gap-2">
                {currentTags.map((t) => (
                  <div key={t.key} className="h-14 flex items-center gap-3 pl-3 bg-panel border border-rule">
                    <span className="text-ok text-[20px]" aria-hidden>
                      ✓
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[20px] font-[550] text-ink">{nameOf(t)}</span>
                    {t.observationType !== 'blank' && (
                      <Stepper
                        inRow
                        value={t.count}
                        label={`How many ${nameOf(t)}`}
                        onChange={(n) => change([current.mediaID], (list) => setTagCount(list, t.key, n), `${n} × ${nameOf(t)} on photo ${no(focus)}`)}
                      />
                    )}
                    <button
                      onClick={() => change([current.mediaID], (list) => removeTag(list, t.key), `Took ${nameOf(t)} off photo ${no(focus)}`)}
                      aria-label={`Take ${nameOf(t)} off this photo`}
                      className={`h-14 w-14 shrink-0 grid place-items-center text-[24px] text-inkSoft hover:text-warn hover:bg-paperHover ${focusRing}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              {favorites.map((s, i) => (
                <BigChoice key={s.scientificName + s.name} on={applied.has(speciesTag(s).key)} hint={keysUsed ? String(i + 1) : null} onClick={() => pickSpecies(s)}>
                  <SpeciesPicture species={s} size={44} />
                  <span className="min-w-0 line-clamp-2 leading-[1.15]">{s.name}</span>
                </BigChoice>
              ))}
              <BigChoice strong on={applied.has(NOTHING.key)} hint={keysUsed ? '0' : null} onClick={() => apply(NOTHING)}>
                <span className="w-full text-center">{NOTHING_HERE}</span>
              </BigChoice>
              <BigChoice quiet onClick={() => setPicker(true)}>
                <span className="w-full text-center">Something else…</span>
              </BigChoice>
            </div>
            {burst && <BurstChoice burst={burst} whole={wholeBurst} onChange={(whole) => setJustOne(whole ? null : burst.eventID)} />}
            {finished && (
              <a href="#" className={`self-start inline-flex h-14 items-center px-5 bg-ink text-paper text-[20px] ${focusRing}`}>
                Back to your cards
              </a>
            )}
          </aside>
        </div>
      ) : (
        <p className="p-8 text-[20px] text-inkSoft">This card has no photos.</p>
      )}

      {picker && (
        <SomethingElse
          species={species}
          onClose={() => setPicker(false)}
          onPick={(s) => {
            setPicker(false);
            pickSpecies(s);
          }}
        />
      )}
    </div>
  );
}

function clock(timestamp: string): string {
  const [h, m] = timestamp.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="ml-auto shrink-0 flex flex-col items-end gap-1.5" data-testid="progress">
      <span className="text-[20px] text-ink tabular-nums whitespace-nowrap">
        <b className="font-[650]">{done.toLocaleString()}</b> of {total.toLocaleString()} photos tagged
      </span>
      <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-ruleSoft">
        <span
          className="block h-full origin-left bg-ok transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${total ? done / total : 0})` }}
        />
      </span>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = { idle: '', saving: 'Saving…', saved: 'Saved ✓', error: "Couldn't save yet. Keep this page open." }[status];
  return (
    <span role="status" data-save-status={status} className={`shrink-0 text-[20px] ${status === 'error' ? 'text-warn max-w-[16rem] leading-tight' : 'w-[6.5rem] text-ok'}`}>
      {text}
    </span>
  );
}

function BigPhoto({ card, photo, alt, onShown }: { card: Card; photo: Media; alt: string; onShown: () => void }) {
  const { url, failed } = useImageUrl(card, photo.mediaID, 'view');
  const [loaded, setLoaded] = useState<string>();
  const [broken, setBroken] = useState<string>();
  if (failed || (url && broken === url))
    return <p className="absolute inset-0 grid place-items-center p-8 text-center text-[20px] text-paper/80">This photo didn't load. Check your internet connection.</p>;
  return (
    <>
      {loaded !== url && <div aria-hidden className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-paper fn-breathe" />}
      {url && (
        <img
          src={url}
          alt={alt}
          draggable={false}
          onLoad={() => {
            setLoaded(url);
            onShown();
          }}
          onError={() => setBroken(url)}
          className={`absolute inset-0 w-full h-full object-contain select-none transition-opacity duration-200 ease-out motion-reduce:transition-none ${loaded === url ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </>
  );
}

function NavButton({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      title={side === 'left' ? 'Previous photo (←)' : 'Next photo (→)'}
      className={`absolute top-1/2 ${side === 'left' ? 'left-3' : 'right-3'} -translate-y-1/2 w-14 h-14 grid place-items-center rounded-full bg-paper/80 text-[34px] leading-none text-ink shadow hover:bg-paper ${hidden ? 'invisible' : ''} ${focusRing}`}
    >
      <span aria-hidden className="-mt-1">
        {side === 'left' ? '‹' : '›'}
      </span>
    </button>
  );
}

function Strip({ card, photos, tags, bursts, focus, onPick }: {
  card: Card;
  photos: Media[];
  tags: Map<string, PhotoTag[]>;
  bursts: (Burst | null)[];
  focus: number;
  onPick: (i: number) => void;
}) {
  const start = Math.min(Math.max(0, focus - 2), Math.max(0, photos.length - STRIP));
  const here = bursts[focus];
  return (
    <ol className="shrink-0 grid grid-cols-9 gap-2" aria-label="Photos on this card" data-testid="strip">
      {photos.slice(start, start + STRIP).map((p, k) => {
        const i = start + k;
        const b = bursts[i];
        const done = tagState(tags.get(p.mediaID)) !== 'untagged';
        return (
          <li key={p.mediaID}>
            <button
              onClick={() => onPick(i)}
              aria-current={i === focus ? 'true' : undefined}
              aria-label={`Photo ${i + 1}${done ? ', tagged' : ''}`}
              className={`relative block w-full ${i === focus ? 'outline outline-[3px] outline-offset-2 outline-accent' : 'opacity-85 hover:opacity-100'} ${focusRing}`}
            >
              <Thumb card={card} mediaID={p.mediaID} alt="" />
              {done && <TaggedMark className="absolute top-1 left-1 w-[26%] aspect-square" />}
            </button>
            <span
              aria-hidden
              className={`mt-2 block h-1.5 ${b ? (b === here ? 'bg-accent' : 'bg-ruleSoft') : ''} ${b && i < b.end && k < STRIP - 1 ? '-mr-2' : ''}`}
            />
          </li>
        );
      })}
    </ol>
  );
}

function BurstChoice({ burst, whole, onChange }: { burst: Burst; whole: boolean; onChange: (whole: boolean) => void }) {
  const size = burst.end - burst.start + 1;
  const option = (on: boolean) =>
    `h-14 px-3 text-[20px] ${on ? 'bg-accent text-paper font-[600]' : 'bg-panel text-ink hover:bg-paperHover'} ${focusRing}`;
  return (
    <div className="mt-2 flex flex-col gap-3 border-l-4 border-accent pl-4" data-testid="burst">
      <p className="text-[20px] leading-tight text-ink">
        These {size} photos were taken together.
      </p>
      <div role="group" aria-label="Which photos to tag" className="grid grid-cols-2 border border-accent">
        <button aria-pressed={whole} onClick={() => onChange(true)} className={option(whole)}>
          Tag all {size}
        </button>
        <button aria-pressed={!whole} onClick={() => onChange(false)} className={option(!whole)}>
          Just this one
        </button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label, inRow }: { value: number; onChange: (n: number) => void; label: string; inRow?: boolean }) {
  const step = `w-14 h-14 grid place-items-center text-[28px] leading-none text-ink hover:bg-paperHover disabled:text-ruleSoft disabled:hover:bg-transparent ${focusRing}`;
  return (
    <div role="group" aria-label={label} className={`shrink-0 flex items-center bg-panel ${inRow ? 'self-stretch border-x border-ruleSoft' : 'border border-rule'}`}>
      <button onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="One fewer" className={step}>
        −
      </button>
      <output aria-live="polite" className="w-12 text-center text-[24px] font-[600] tabular-nums text-ink">
        {value}
      </output>
      <button onClick={() => onChange(value + 1)} disabled={value >= MAX_COUNT} aria-label="One more" className={step}>
        +
      </button>
    </div>
  );
}

function BigChoice({ children, on, strong, quiet, hint, onClick }: {
  children: React.ReactNode;
  on?: boolean;
  strong?: boolean;
  quiet?: boolean;
  hint?: string | null;
  onClick: () => void;
}) {
  const look = on
    ? 'bg-ink text-paper border-ink'
    : strong
      ? 'bg-panel text-ink border-ink border-2 hover:bg-paperHover'
      : quiet
        ? 'bg-transparent text-ink border-rule border-dashed hover:bg-paperHover hover:border-ink'
        : 'bg-panel text-ink border-rule shadow-[0_1px_0_var(--ruleSoft)] hover:border-ink';
  return (
    <button
      onClick={onClick}
      aria-pressed={quiet ? undefined : !!on}
      className={`relative h-16 [@media(min-height:860px)]:h-[76px] flex items-center gap-3 px-2.5 border text-left text-[20px] font-[550] ${look} ${press} ${focusRing}`}
    >
      {children}
      {hint && (
        <kbd aria-hidden className={`absolute top-1 right-1.5 font-mono text-[13px] ${on ? 'text-paper/70' : 'text-inkMute'}`}>
          {hint}
        </kbd>
      )}
    </button>
  );
}

function SpeciesPicture({ species, size }: { species: Species; size: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="shrink-0 grid place-items-center overflow-hidden bg-paperHover border border-ruleSoft font-display text-[22px] text-inkSoft"
    >
      {species.speciesIconURL && !broken ? (
        <img src={species.speciesIconURL} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" />
      ) : (
        species.name[0]
      )}
    </span>
  );
}

function SomethingElse({ species, onPick, onClose }: { species: Species[]; onPick: (s: Species) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const pickable = useMemo(() => species.filter((s) => s.observationType !== 'blank'), [species]);
  const results = useSpeciesResults(pickable, search);
  return (
    <Dialog label="Something else" onClose={onClose} wide>
      <div className="relative p-6">
        <h2 className="font-display text-[30px] font-[600] text-ink">What did you see?</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !results[0]) return;
            e.preventDefault();
            onPick(results[0]);
          }}
          aria-label="Search species"
          placeholder="Type a name, like fox"
          className="mt-4 w-full h-16 px-4 border-2 border-ink bg-panel text-[22px] text-ink placeholder:text-inkMute focus:outline focus:outline-[3px] focus:outline-offset-2 focus:outline-accent"
        />
        <ul className="mt-4 h-[min(52dvh,440px)] overflow-y-auto grid grid-cols-2 content-start gap-2 pr-1" aria-label="Species">
          {results.map((s) => (
            <li key={s.scientificName + s.name}>
              <button onClick={() => onPick(s)} className={`w-full h-16 flex items-center gap-3 px-2.5 border border-rule bg-panel text-left text-[20px] text-ink hover:border-ink hover:bg-paperHover ${press} ${focusRing}`}>
                <SpeciesPicture species={s} size={44} />
                <span className="min-w-0 line-clamp-2 leading-[1.15]">{s.name}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="col-span-2 py-6 text-[20px] text-inkSoft">Nothing matches that name. Try a shorter word.</li>}
        </ul>
        <button onClick={onClose} aria-label="Close" className={`absolute top-5 right-5 w-14 h-14 grid place-items-center border border-rule text-[22px] text-inkSoft hover:text-ink ${focusRing}`}>
          ✕
        </button>
      </div>
    </Dialog>
  );
}
