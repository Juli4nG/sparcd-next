import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { S3Error, deploymentId, parseLab, parseSites, type Lab, type Session, type Site } from '@sparcd/bucket';
import { Message } from './App';
import { scanDrop, scanFileList, type CardFile } from './send/scan';
import { PhotoError, sendCard, type Outcome, type Progress } from './send/send';
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

export function SendFlow({ session, onSending }: { session: Session; onSending: (on: boolean) => void }) {
  const [settings, setSettings] = useState<{ lab: Lab; sites: Site[] } | 'failed'>();
  const [step, setStep] = useState<Step>('site');
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
  useEffect(() => onSending(step === 'send'), [step, onSending]);
  useEffect(() => () => onSending(false), [onSending]);

  if (!settings) return <Message>Loading…</Message>;
  if (settings === 'failed') return <Message warn>We couldn't load the list of sites. Check your internet connection, then reload the page.</Message>;

  if (step === 'site')
    return (
      <Screen back="#" question="Where was the camera?">
        <SitePicker sites={settings.sites} chosen={site} onPick={(s) => (setSite(s), setStep('date'))} />
      </Screen>
    );
  if (step === 'date')
    return (
      <Screen onBack={() => setStep('site')} question="When did you take the card out?">
        <DatePicker date={date} onPick={(d) => (setDate(d), setStep('card'))} />
      </Screen>
    );
  if (step === 'card')
    return (
      <Screen onBack={() => setStep('date')} question="Put the card in and choose it">
        <CardPicker card={card} onCard={setCard} onSend={() => setStep('send')} />
      </Screen>
    );
  if (step === 'send')
    return (
      <Screen question="Sending your photos">
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
  return <Done outcome={outcome!} />;
}

function Screen({ question, back, onBack, children }: { question: string; back?: string; onBack?: () => void; children: ReactNode }) {
  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 pt-6 pb-10">
        <div className="h-12 mb-4">
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
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type to find a site"
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
              <span className="flex-1 min-w-0">{s.locationName}</span>
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

function DatePicker({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const [other, setOther] = useState(date !== daysAgo(0) && date !== daysAgo(1) ? date : '');
  const choice = (iso: string, label: string) => (
    <button onClick={() => onPick(iso)} className={`${bigSecondary} w-full justify-between ${iso === date ? 'bg-mark' : ''}`}>
      <span>{label}</span>
      <span className="text-[20px] font-[400] text-inkSoft">{longDay(iso)}</span>
    </button>
  );
  return (
    <div className="flex flex-col gap-4 max-w-[560px]">
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

function CardPicker({ card, onCard, onSend }: { card: CardFile[]; onCard: (c: CardFile[]) => void; onSend: () => void }) {
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
            <p className="font-display text-[44px] font-[600] text-ink" data-testid="found">
              {photos(card.length)} found
            </p>
            <button onClick={onSend} className={`${bigPrimary} h-[72px] px-12 text-[26px]`}>
              Send them
            </button>
          </>
        ) : (
          <>
            {(state === 'empty' || state === 'failed') && (
              <p className="text-[22px] text-warn">
                {state === 'failed' ? 'That card couldn’t be read. Check it is still in, then try again.' : 'No photos there. Choose the card itself.'}
              </p>
            )}
            <button onClick={() => picker.current!.click()} className={`${bigPrimary} h-[72px] px-12 text-[26px]`}>
              Choose the card
            </button>
            <p className="text-[20px] text-inkSoft">or drag it here</p>
          </>
        )}
      </div>
      <div className="h-12">
        {found && (
          <button onClick={() => picker.current!.click()} className={quietLink}>
            Choose a different card
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
  if (cause instanceof S3Error && cause.status === 403) return { message: 'You were signed out. Sign in again, then send the card again.', signIn: true };
  if (cause instanceof Error && cause.name === 'NotFoundError') return { message: 'The card couldn’t be read. Check it is still in, then press Try again.' };
  return { message: 'Sending stopped because the internet dropped. Press Try again.' };
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

function Sending({ session, lab, site, date, card, onDone }: { session: Session; lab: Lab; site: Site; date: string; card: CardFile[]; onDone: (o: Outcome) => void }) {
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<Problem>();
  const [attempt, setAttempt] = useState(0);
  const reads = useRef(new Map<File, ReadResult>());

  useWakeLock(!error);
  useLeaveWarning(!error);

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

  const total = progress?.total ?? card.length;
  const done = progress?.done ?? 0;
  const sendingNow = progress?.phase === 'sending';
  const share = total ? done / total : 0;
  const pct = (sendingNow ? READING_SHARE + (1 - READING_SHARE) * share : READING_SHARE * share) * 100;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[24px] text-inkSoft">
        {site.locationName} · {longDay(date)}
      </p>
      <div
        className="h-10 bg-paperHover border-2 border-ink overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <span className={`block h-full ${error ? 'bg-warn' : 'bg-ok'} transition-[width] duration-300 ease-out`} style={{ width: `${pct}%` }} />
      </div>
      <p className="h-12 font-display text-[36px] font-[600] text-ink tabular-nums" data-testid="sent-count">
        {sendingNow ? `${done.toLocaleString()} of ${total.toLocaleString()} sent` : 'Getting the photos ready…'}
      </p>
      {error ? (
        <div className="flex flex-col items-start gap-4">
          <p role="alert" className="text-[22px] text-warn">
            {error.message}
          </p>
          {error.signIn ? (
            <a href="#" className={bigPrimary}>
              Back to the start
            </a>
          ) : (
            <button className={bigPrimary} onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <p className="text-[22px] text-inkSoft">You can leave this open. The screen stays awake until it’s done.</p>
      )}
    </div>
  );
}

function Done({ outcome }: { outcome: Outcome }) {
  const saved = outcome.total - outcome.leftOut.length;
  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 pt-[72px] pb-10 flex flex-col items-start gap-6">
        <p aria-hidden className="w-20 h-20 grid place-items-center rounded-full bg-ok text-paper text-[44px]">
          ✓
        </p>
        <h1 className="font-display text-[44px] leading-tight font-[600] text-ink" data-testid="saved">
          {outcome.leftOut.length ? `${photos(saved)} are saved` : `All ${photos(outcome.total)} are saved`}
        </h1>
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
