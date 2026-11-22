import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { S3Error, deploymentId, parseLab, parseSites, type Lab, type Session, type Site } from '@sparcd/bucket';
import { useOnline } from '@sparcd/auth-ui';
import { Message, TAG_URL } from './App';
import { cardLine, rangeOf } from './cardLine';
import { scanDrop, scanFileList, type CardFile } from './send/scan';
import { PhotoError, sendCard, type Details, type Outcome, type Progress } from './send/send';
import { timeLeft } from './send/words';
import { PawStamp } from './ui/Paw';
import { bigPrimary, bigSecondary, focusRing, quietLink } from './ui/look';
import type { ReadResult } from './workers/photo.worker';

type Step = 'card' | 'site' | 'date' | 'notes' | 'send';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const photos = (n: number) => `${n.toLocaleString()} photo${n === 1 ? '' : 's'}`;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The folder the photos came from: the first part of their path, when they sit in one. */
function folderOf(card: CardFile[]): string {
  const first = card[0]?.path ?? '';
  return first.includes('/') ? first.slice(0, first.indexOf('/')) : '';
}

/** Liz's folders read "WHE19_09.28.26_119.images": Site ID, the day the card came out (MM.DD.YY), photo count. */
function guessFromFolder(folder: string, sites: Site[]): { site?: Site; date?: string } {
  const m = /^([^_]+)_(\d{2})\.(\d{2})\.(\d{2})(?:_|\.|$)/.exec(folder);
  if (!m) return {};
  const site = sites.find((s) => s.locationID.toLowerCase() === m[1].toLowerCase());
  const date = `20${m[4]}-${m[2]}-${m[3]}`;
  const valid = !Number.isNaN(Date.parse(`${date}T12:00:00`)) && date <= daysAgo(0);
  return { site, date: valid ? date : undefined };
}

type Deferred = { promise: Promise<Details>; resolve: (d: Details) => void };
const deferred = (): Deferred => {
  let resolve!: (d: Details) => void;
  const promise = new Promise<Details>((r) => (resolve = r));
  return { promise, resolve };
};

export function SendFlow({ session, onSending }: { session: Session; onSending: (on: boolean) => void }) {
  const [settings, setSettings] = useState<{ lab: Lab; sites: Site[] } | 'failed'>();
  const [step, setStep] = useState<Step>('card');
  const [guessDate, setGuessDate] = useState<string>();
  const [site, setSite] = useState<Site>();
  const [date, setDate] = useState(daysAgo(0));
  const [notes, setNotes] = useState('');
  const [card, setCard] = useState<CardFile[]>([]);
  const [started, setStarted] = useState(false);
  const [details] = useState(deferred);
  const lab = settings && settings !== 'failed' ? settings.lab : undefined;
  const upload = useUpload(session, lab, card, started, details.promise);

  useEffect(() => {
    Promise.all([session.settings.getText('lab.json'), session.settings.getText('sites.csv')]).then(
      ([lab, sites]) => setSettings({ lab: parseLab(lab!), sites: parseSites(sites!) }),
      () => setSettings('failed'),
    );
  }, [session]);
  const busy = started && !upload.outcome;
  useEffect(() => {
    onSending(busy);
  }, [busy, onSending]);
  useEffect(() => () => onSending(false), [onSending]);
  useWakeLock(busy && !upload.error?.signIn);
  useLeaveWarning(busy && !upload.error?.signIn);

  if (!settings) return <Message>Loading…</Message>;
  if (settings === 'failed') return <Message warn>We couldn't load the list of sites. Check your internet connection, then reload the page.</Message>;

  const folder = folderOf(card);
  const bar = <UploadBar upload={upload} card={card} />;

  if (step === 'card')
    return (
      <Screen back="#" question="Choose the folder of photos">
        <CardPicker
          card={card}
          onCard={setCard}
          onNext={() => {
            const guess = guessFromFolder(folderOf(card), settings.sites);
            if (guess.site) setSite(guess.site);
            setGuessDate(guess.date);
            if (guess.date) setDate(guess.date);
            setStarted(true);
            setStep('site');
          }}
        />
      </Screen>
    );
  if (step === 'site')
    return (
      <Screen question="Where was the camera?" folder={folder} bar={bar}>
        <SitePicker sites={settings.sites} chosen={site} onPick={(s) => (setSite(s), setStep('date'))} />
      </Screen>
    );
  if (step === 'date')
    return (
      <Screen onBack={() => setStep('site')} question="When were these photos collected?" folder={folder} bar={bar}>
        <DatePicker date={date} guess={guessDate} onPick={(d) => (setDate(d), setStep('notes'))} />
      </Screen>
    );
  const line = cardLine({ range: rangeOf(site!.deploymentGroups), name: site!.locationName, id: site!.locationID, photos: card.length, date });
  if (step === 'notes')
    return (
      <Screen onBack={() => setStep('date')} question="Anything to add?" folder={folder} bar={bar}>
        <div className="flex flex-col gap-5">
          <p className="text-[22px] text-ink">{line}</p>
          <label className="flex flex-col gap-2 text-[20px] text-inkSoft">
            Notes (you can leave this empty)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`w-full px-4 py-3 border-2 border-ink bg-panel text-[22px] text-ink ${focusRing}`}
            />
          </label>
          <div>
            <button
              onClick={() => {
                details.resolve({ site: site!, deploymentID: deploymentId(site!.locationID, date), comments: notes.trim() });
                setStep('send');
              }}
              className={`${bigPrimary} h-[72px] px-12 text-[26px]`}
            >
              Finish
            </button>
          </div>
        </div>
      </Screen>
    );
  if (upload.outcome) return <Done outcome={upload.outcome} line={line} />;
  return (
    <Screen question="Uploading your photos" folder={folder}>
      <BigProgress upload={upload} card={card} line={line} />
    </Screen>
  );
}

function Screen({ question, back, onBack, folder, bar, children }: { question: string; back?: string; onBack?: () => void; folder?: string; bar?: ReactNode; children: ReactNode }) {
  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 pt-6 pb-10">
        <div className="h-12 mb-4 flex items-center justify-between gap-4">
          {back !== undefined && (
            <a href={back} className={quietLink}>
              ← Back
            </a>
          )}
          {onBack && (
            <button onClick={onBack} className={quietLink}>
              ← Back
            </button>
          )}
          {folder && (
            <span className="ml-auto min-w-0 truncate text-[18px] text-inkSoft" data-testid="folder">
              Folder: <span className="font-mono text-[17px] text-ink">{folder}</span>
            </span>
          )}
        </div>
        {bar}
        <h1 className="font-display text-[38px] leading-tight font-[600] text-ink mb-6">{question}</h1>
        {children}
      </div>
    </main>
  );
}

function SitePicker({ sites, chosen, onPick }: { sites: Site[]; chosen?: Site; onPick: (s: Site) => void }) {
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sites
    .filter((s) => words.every((w) => `${s.locationName} ${s.locationID}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.locationID === chosen?.locationID) - Number(a.locationID === chosen?.locationID) || a.locationName.localeCompare(b.locationName));
  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a site name or Site ID"
        aria-label="Find a site"
        autoComplete="off"
        spellCheck={false}
        className="w-full h-16 px-4 border-2 border-ink bg-panel text-[22px] text-ink placeholder:text-inkMute focus:outline focus:outline-[3px] focus:outline-offset-2 focus:outline-accent"
      />
      <ul aria-label="Sites" className="h-[min(52dvh,440px)] overflow-y-auto border border-rule bg-panel">
        {!shown.length && <li className="px-4 py-4 text-[20px] text-inkSoft">No site has that name. Try a shorter word.</li>}
        {shown.map((s) => (
          <li key={s.locationID} className="border-b border-ruleSoft last:border-b-0">
            <button
              onClick={() => onPick(s)}
              className={`w-full min-h-16 px-4 py-2 flex items-center gap-3 text-left text-[22px] ${
                s.locationID === chosen?.locationID ? 'bg-mark text-ink' : 'text-ink hover:bg-paperHover'
              } ${focusRing} -outline-offset-[3px]`}
            >
              <span className="flex-1 min-w-0">
                {s.locationName}
                {rangeOf(s.deploymentGroups) && <span className="block text-[17px] text-inkSoft">{rangeOf(s.deploymentGroups)}</span>}
              </span>
              <span className="shrink-0 font-mono text-[18px] text-inkSoft">{s.locationID}</span>
              <span aria-hidden className="text-inkMute text-[26px]">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DatePicker({ date, guess, onPick }: { date: string; guess?: string; onPick: (d: string) => void }) {
  const [other, setOther] = useState(date !== daysAgo(0) && date !== daysAgo(1) && date !== guess ? date : '');
  const choice = (iso: string, label: string) => (
    <button onClick={() => onPick(iso)} className={`${bigSecondary.replace('bg-panel ', iso === date ? 'bg-mark ' : 'bg-panel ')} w-full justify-between`}>
      <span>{label}</span>
      <span className="text-[20px] font-[400] text-inkSoft">{longDay(iso)}</span>
    </button>
  );
  return (
    <div className="flex flex-col gap-4 max-w-[560px]">
      {guess && guess !== daysAgo(0) && guess !== daysAgo(1) && choice(guess, 'From the folder name')}
      {choice(daysAgo(0), 'Today')}
      {choice(daysAgo(1), 'Yesterday')}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="other-day" className="text-[20px] text-inkSoft">
          Another day:
        </label>
        <input
          id="other-day"
          type="date"
          value={other}
          max={daysAgo(0)}
          onChange={(e) => setOther(e.target.value)}
          className={`h-14 px-3 border border-rule bg-panel text-[20px] text-ink ${focusRing}`}
        />
        <button disabled={!/^\d{4}-\d{2}-\d{2}$/.test(other) || other > daysAgo(0)} onClick={() => onPick(other)} className={`${bigPrimary} h-14 px-6 text-[20px]`}>
          Next
        </button>
      </div>
    </div>
  );
}

function CardPicker({ card, onCard, onNext }: { card: CardFile[]; onCard: (c: CardFile[]) => void; onNext: () => void }) {
  const [state, setState] = useState<'idle' | 'looking' | 'empty' | 'failed'>('idle');
  const [hover, setHover] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  const take = async (found: Promise<CardFile[]> | CardFile[]) => {
    const scan = ++latest.current;
    setState('looking');
    try {
      const files = [...(await found)].sort((a, b) => collator.compare(a.path, b.path));
      if (scan !== latest.current) return;
      onCard(files);
      setState(files.length ? 'idle' : 'empty');
    } catch {
      if (scan !== latest.current) return;
      onCard([]);
      setState('failed');
    }
  };

  const found = state === 'idle' && card.length > 0;
  return (
    <div className="flex flex-col gap-6">
      <div
        onDragOver={(e) => (e.preventDefault(), setHover(true))}
        onDragLeave={() => setHover(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setHover(false);
          void take(scanDrop(e.dataTransfer.items));
        }}
        className={`h-[300px] flex flex-col items-center justify-center gap-5 px-8 text-center border-2 border-dashed ${
          hover ? 'border-accent bg-accentSoft' : state === 'empty' || state === 'failed' ? 'border-warn bg-panel' : 'border-rule bg-panel'
        }`}
      >
        {state === 'looking' ? (
          <>
            <PawStamp />
            <p className="text-[22px] text-inkSoft">Looking for photos…</p>
          </>
        ) : found ? (
          <>
            <p className="font-display text-[44px] leading-tight font-[600] text-ink" data-testid="found">
              {photos(card.length)} found
            </p>
            {folderOf(card) && (
              <p className="-mt-3 text-[20px] text-inkSoft">
                in <span className="font-mono text-[19px] text-ink">{folderOf(card)}</span>
              </p>
            )}
            <button onClick={onNext} className={`${bigPrimary} h-[72px] px-12 text-[26px]`}>
              Next
            </button>
          </>
        ) : (
          <>
            {(state === 'empty' || state === 'failed') && (
              <p className="text-[22px] text-warn">
                {state === 'failed' ? 'That folder couldn’t be read. Try again.' : 'No photos in that folder. Choose another one.'}
              </p>
            )}
            <button onClick={() => picker.current!.click()} className={`${bigPrimary} h-[72px] px-12 text-[26px]`}>
              Choose the folder
            </button>
            <p className="text-[20px] text-inkSoft">or drag it here</p>
          </>
        )}
      </div>
      <div className="h-12">
        {found && (
          <button onClick={() => picker.current!.click()} className={quietLink}>
            Choose a different folder
          </button>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        aria-label="Folder of photos"
        hidden
        // @ts-expect-error webkitdirectory is not in React's input attributes
        webkitdirectory=""
        onChange={(e) => {
          if (e.target.files) void take(scanFileList(e.target.files));
          e.target.value = '';
        }}
      />
    </div>
  );
}

type Problem = { message: string; signIn?: boolean };

function explain(err: unknown): Problem {
  const cause = err instanceof PhotoError ? err.cause : err;
  if (cause instanceof S3Error && cause.status === 403) return { message: 'You were signed out. Sign in again, then choose the same folder. Photos already uploaded are not uploaded twice.', signIn: true };
  if (cause instanceof Error && cause.name === 'NotFoundError') return { message: 'The photos couldn’t be read. Check the folder is still there. Uploading will try again by itself.' };
  return { message: 'Uploading paused for a moment. It will carry on by itself.' };
}

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let asking = false;
    let gone = false;
    const acquire = () => {
      if (asking || (lock && !lock.released) || document.visibilityState !== 'visible') return;
      asking = true;
      navigator.wakeLock.request('screen').then(
        (l) => {
          asking = false;
          if (gone) void l.release();
          else lock = l;
        },
        () => (asking = false),
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}

function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/** Reading photos is quick next to uploading them, so it fills only the first part of the bar. */
const READING_SHARE = 0.15;
const RETRY_MS = 8000;

type Upload = { progress?: Progress; error?: Problem; online: boolean; outcome?: Outcome };

/** Uploads the folder from the moment it's chosen; the rows wait for `details`. Carries on by itself after a pause. */
function useUpload(session: Session, lab: Lab | undefined, card: CardFile[], started: boolean, details: Promise<Details>): Upload {
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<Problem>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [attempt, setAttempt] = useState(0);
  const reads = useRef(new Map<File, ReadResult>());
  const online = useOnline();

  useEffect(() => {
    if (!started || !lab) return;
    const stop = new AbortController();
    setError(undefined);
    sendCard({
      session,
      lab,
      details,
      card,
      reads: reads.current,
      onProgress: (p) => !stop.signal.aborted && setProgress(p),
      signal: stop.signal,
    }).then(
      (o) => !stop.signal.aborted && setOutcome(o),
      (err) => {
        if (stop.signal.aborted) return;
        console.error(err);
        setError(explain(err));
      },
    );
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, started, !!lab]);

  useEffect(() => {
    if (!error || error.signIn || !online) return;
    const timer = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    return () => clearTimeout(timer);
  }, [error, online]);

  return { progress, error, online, outcome };
}

/**
 * Speed and time left in plain words. The rate is smoothed; time left shows
 * only once it has settled, changes at most every 15 seconds, and may grow by a
 * quarter at most, so it never leaps from minutes to hours.
 */
function usePace(progress: Progress | undefined, card: CardFile[]): { speed: string; left: string } {
  const [pace, setPace] = useState({ speed: '', left: '' });
  const avgBytes = card.length ? card.reduce((n, c) => n + c.file.size, 0) / card.length : 0;
  const memo = useRef<{ at: number; done: number; rate?: number; shownMs?: number; shownAt: number }>({ at: 0, done: 0, shownAt: 0 });
  const latest = useRef(progress);
  latest.current = progress;
  useEffect(() => {
    const id = setInterval(() => {
      const p = latest.current;
      const m = memo.current;
      const now = performance.now();
      if (!p || p.phase !== 'sending') return;
      if (!m.at) return void Object.assign(m, { at: now, done: p.done });
      const dt = (now - m.at) / 1000;
      if (dt < 2) return;
      const instant = (p.done - m.done) / dt;
      m.rate = m.rate === undefined ? instant : m.rate * 0.75 + instant * 0.25;
      Object.assign(m, { at: now, done: p.done });
      if (!m.rate) return;
      const speed = `${((m.rate * avgBytes) / 1_000_000).toFixed(1)} MB per second`;
      let left = pace.left;
      if (p.done - p.sentBefore >= 3 && now - p.startedAt >= 5_000 && (m.shownMs === undefined || now - m.shownAt >= 15_000)) {
        let ms = ((p.total - p.done) / m.rate) * 1000;
        if (m.shownMs !== undefined) ms = Math.min(ms, m.shownMs * 1.25);
        m.shownMs = ms;
        m.shownAt = now;
        left = timeLeft(ms);
      }
      setPace((old) => ({ speed, left: left || old.left }));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avgBytes]);
  return pace;
}

function counts(upload: Upload, card: CardFile[]) {
  const p = upload.progress;
  const total = p?.total ?? card.length;
  const done = p?.done ?? 0;
  const uploading = p?.phase === 'sending' || p?.phase === 'waiting';
  const already = p && p.phase !== 'reading' ? p.sentBefore : 0;
  const share = total ? done / total : 0;
  const pct = (uploading ? READING_SHARE + (1 - READING_SHARE) * share : READING_SHARE * share) * 100;
  return { total, done, uploading, already, pct, waiting: p?.phase === 'waiting' };
}

function Bar({ pct, thick }: { pct: number; thick?: boolean }) {
  return (
    <div
      className={`${thick ? 'h-10 border-2' : 'h-3 border'} bg-paperHover border-ink overflow-hidden`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span className="block h-full bg-ok transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The upload keeps going above the questions. */
function UploadBar({ upload, card }: { upload: Upload; card: CardFile[] }) {
  const c = counts(upload, card);
  const { speed, left } = usePace(upload.progress, card);
  return (
    <div className="h-[76px] mb-6 flex flex-col justify-center gap-2 px-4 border border-ruleSoft bg-panel" data-testid="upload-bar">
      <Bar pct={c.pct} />
      <p className="text-[18px] text-inkSoft tabular-nums truncate">
        {!upload.online
          ? 'No internet. Uploading will carry on when it’s back.'
          : c.waiting
            ? `All ${photos(c.total)} uploaded. Answer the questions to finish.`
            : c.uploading
              ? [`${c.done.toLocaleString()} of ${c.total.toLocaleString()} uploaded`, speed, left].filter(Boolean).join(' · ')
              : 'Getting the photos ready…'}
      </p>
    </div>
  );
}

function BigProgress({ upload, card, line }: { upload: Upload; card: CardFile[]; line: string }) {
  const c = counts(upload, card);
  const { speed, left } = usePace(upload.progress, card);
  const { error, online } = upload;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[22px] text-inkSoft">{line}</p>
      <Bar pct={c.pct} thick />
      <p className="h-12 font-display text-[36px] font-[600] text-ink tabular-nums" data-testid="sent-count">
        {c.uploading ? `${c.done.toLocaleString()} of ${c.total.toLocaleString()} uploaded` : 'Getting the photos ready…'}
      </p>
      <p className="h-8 text-[22px] text-ink tabular-nums" data-testid="pace">
        {[speed, left].filter(Boolean).join(' · ')}
      </p>
      <p className="h-8 text-[20px] text-inkSoft">{c.already > 0 && `${c.already.toLocaleString()} already saved`}</p>
      {error?.signIn ? (
        <div className="flex flex-col items-start gap-4">
          <p role="alert" className="text-[22px] text-warn">
            {error.message}
          </p>
          <a href="#" className={bigPrimary}>
            Back to the start
          </a>
        </div>
      ) : !online ? (
        <p role="status" className="text-[22px] text-warn">
          No internet. Uploading will carry on when it’s back.
        </p>
      ) : error ? (
        <p role="status" className="text-[22px] text-inkSoft">
          {error.message}
        </p>
      ) : (
        <p className="text-[22px] text-inkSoft">You can leave this open. The screen stays awake until it’s done.</p>
      )}
    </div>
  );
}

function Done({ outcome, line }: { outcome: Outcome; line: string }) {
  const saved = outcome.total - outcome.leftOut.length;
  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 pt-[72px] pb-10 flex flex-col items-start gap-6">
        <p aria-hidden className="w-20 h-20 grid place-items-center rounded-full bg-ok text-paper text-[44px]">
          ✓
        </p>
        <h1 className="font-display text-[44px] leading-tight font-[600] text-ink" data-testid="saved">
          {outcome.leftOut.length ? `${photos(saved)} are uploaded` : `All ${photos(outcome.total)} are uploaded`}
        </h1>
        <p className="-mt-2 text-[22px] text-inkSoft">{line}</p>
        {outcome.alreadySaved > 0 && <p className="text-[22px] text-inkSoft">{photos(outcome.alreadySaved)} were already uploaded before.</p>}
        {outcome.leftOut.length > 0 && (
          <p className="text-[22px] text-inkSoft">{photos(outcome.leftOut.length)} couldn’t be read, so they were left out.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-4">
          {outcome.cardHasPhotos && (
            <a href={`${TAG_URL}#card=${encodeURIComponent(outcome.deploymentID)}`} className={`${bigPrimary} h-[72px] px-12 text-[26px]`}>
              Tag them now
            </a>
          )}
          <a href="#" className={`${bigSecondary} h-[72px] text-[24px]`}>
            Back to the start
          </a>
        </div>
      </div>
    </main>
  );
}
