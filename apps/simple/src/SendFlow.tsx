import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { S3Error, deploymentId, parseLab, parseSites, type Lab, type Session, type Site } from '@sparcd/bucket';
import { useOnline } from '@sparcd/auth-ui';
import { Message } from './App';
import { cardLine, rangeOf } from './cardLine';
import { scanDrop, scanFileList, type CardFile } from './send/scan';
import { PhotoError, sendCard, type Outcome, type Progress } from './send/send';
import { timeLeft } from './send/words';
import { PawStamp } from './ui/Paw';
import { bigPrimary, bigSecondary, focusRing, quietLink } from './ui/look';
import type { ReadResult } from './workers/photo.worker';

type Step = 'site' | 'date' | 'card' | 'send' | 'done';

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

export function SendFlow({ session, onSending }: { session: Session; onSending: (on: boolean) => void }) {
  const [settings, setSettings] = useState<{ lab: Lab; sites: Site[] } | 'failed'>();
  const [step, setStep] = useState<Step>('card');
  const [guessDate, setGuessDate] = useState<string>();
  const [site, setSite] = useState<Site>();
  const [date, setDate] = useState(daysAgo(0));
  const [card, setCard] = useState<CardFile[]>([]);
  const [outcome, setOutcome] = useState<Outcome>();

  useEffect(() => {
    Promise.all([session.settings.getText('lab.json'), session.settings.getText('sites.csv')]).then(
      ([lab, sites]) => setSettings({ lab: parseLab(lab!), sites: parseSites(sites!) }),
      () => setSettings('failed'),
    );
  }, [session]);
  useEffect(() => {
    onSending(step === 'send');
  }, [step, onSending]);
  useEffect(() => () => onSending(false), [onSending]);

  if (!settings) return <Message>Loading…</Message>;
  if (settings === 'failed') return <Message warn>We couldn't load the list of sites. Check your internet connection, then reload the page.</Message>;

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
            setStep('site');
          }}
        />
      </Screen>
    );
  if (step === 'site')
    return (
      <Screen onBack={() => setStep('card')} question="Where was the camera?" folder={folderOf(card)}>
        <SitePicker sites={settings.sites} chosen={site} onPick={(s) => (setSite(s), setStep('date'))} />
      </Screen>
    );
  if (step === 'date')
    return (
      <Screen onBack={() => setStep('site')} question="When were these photos collected?" folder={folderOf(card)}>
        <DatePicker date={date} guess={guessDate} onPick={(d) => (setDate(d), setStep('send'))} />
      </Screen>
    );
  if (step === 'send')
    return (
      <Screen question="Uploading your photos" folder={folderOf(card)}>
        <Sending
          session={session}
          lab={settings.lab}
          site={site!}
          date={date}
          card={card}
          onDone={(o) => (setOutcome(o), setStep('done'))}
        />
      </Screen>
    );
  return <Done outcome={outcome!} line={cardLine({ range: rangeOf(site!.deploymentGroups), name: site!.locationName, id: site!.locationID, photos: outcome!.total, date })} />;
}

function Screen({ question, back, onBack, folder, children }: { question: string; back?: string; onBack?: () => void; folder?: string; children: ReactNode }) {
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
        aria-label="Card"
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
  if (cause instanceof S3Error && cause.status === 403) return { message: 'You were signed out. Sign in again, then choose the same card. Photos already saved are not sent twice.', signIn: true };
  if (cause instanceof Error && cause.name === 'NotFoundError') return { message: 'The photos couldn’t be read. Check the memory card is still in. Uploading will try again by itself.' };
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

/** Checking photos is quick next to sending them, so it fills only the first part of the bar. */
const READING_SHARE = 0.15;
const RETRY_MS = 8000;

/**
 * A calm time left: the rate is smoothed, nothing shows until it has settled,
 * the words change at most every 15 seconds, and a new guess may grow by a
 * quarter at most, so it never leaps from minutes to hours.
 */
function useTimeLeft(progress: Progress | undefined): string {
  const [text, setText] = useState('');
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
      m.rate = m.rate === undefined ? instant : m.rate * 0.85 + instant * 0.15;
      Object.assign(m, { at: now, done: p.done });
      if (p.done - p.sentBefore < 6 || now - p.startedAt < 20_000 || !m.rate) return;
      if (m.shownMs !== undefined && now - m.shownAt < 15_000) return;
      let ms = ((p.total - p.done) / m.rate) * 1000;
      if (m.shownMs !== undefined) ms = Math.min(ms, m.shownMs * 1.25);
      m.shownMs = ms;
      m.shownAt = now;
      setText(timeLeft(ms));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

function Sending({ session, lab, site, date, card, onDone }: { session: Session; lab: Lab; site: Site; date: string; card: CardFile[]; onDone: (o: Outcome) => void }) {
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<Problem>();
  const [attempt, setAttempt] = useState(0);
  const reads = useRef(new Map<File, ReadResult>());
  const online = useOnline();
  const eta = useTimeLeft(progress);

  useWakeLock(!error?.signIn);
  useLeaveWarning(!error?.signIn);

  useEffect(() => {
    const stop = new AbortController();
    setError(undefined);
    sendCard({
      session,
      lab,
      site,
      deploymentID: deploymentId(site.locationID, date),
      card,
      reads: reads.current,
      onProgress: (p) => !stop.signal.aborted && setProgress(p),
      signal: stop.signal,
    }).then(
      (outcome) => !stop.signal.aborted && onDone(outcome),
      (err) => {
        if (stop.signal.aborted) return;
        console.error(err);
        setError(explain(err));
      },
    );
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Sending carries on by itself: after a short pause, or once the internet is back.
  useEffect(() => {
    if (!error || error.signIn || !online) return;
    const timer = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    return () => clearTimeout(timer);
  }, [error, online]);

  const total = progress?.total ?? card.length;
  const done = progress?.done ?? 0;
  const sendingNow = progress?.phase === 'sending';
  const already = progress?.phase === 'sending' ? progress.sentBefore : 0;
  const share = total ? done / total : 0;
  const pct = (sendingNow ? READING_SHARE + (1 - READING_SHARE) * share : READING_SHARE * share) * 100;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[22px] text-inkSoft">
        {cardLine({ range: rangeOf(site.deploymentGroups), name: site.locationName, id: site.locationID, photos: card.length, date })}
      </p>
      <div
        className="h-10 bg-paperHover border-2 border-ink overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <span className="block h-full bg-ok transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="h-12 font-display text-[36px] font-[600] text-ink tabular-nums" data-testid="sent-count">
        {sendingNow ? `${done.toLocaleString()} of ${total.toLocaleString()} uploaded` : 'Getting the photos ready…'}
      </p>
      <p className="h-8 text-[22px] text-inkSoft">
        {[already > 0 && `${already.toLocaleString()} already saved`, eta].filter(Boolean).join(' · ')}
      </p>
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
            <a href={`#card=${encodeURIComponent(outcome.deploymentID)}`} className={`${bigPrimary} h-[72px] px-12 text-[26px]`}>
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
