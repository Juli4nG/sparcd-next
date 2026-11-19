import { useEffect, useRef, useState } from 'react';
import { S3Error, deploymentId, type Lab, type Session, type Site } from '@sparcd/bucket';
import type { CardFile } from '../lib/scan';
import { PhotoError, sendCard, type Outcome, type Progress } from '../lib/send';
import { formatBytes, number, timeLeft } from '../lib/words';
import { primaryButton, sectionLabel } from '../ui/fn';
import { Note } from '../ui/Note';
import type { ReadResult } from '../workers/photo.worker';

type Props = {
  session: Session;
  lab: Lab;
  site: Site;
  date: string;
  card: CardFile[];
  onDone: (o: Outcome) => void;
  onFailed: (failed: boolean) => void;
  onSignIn: () => void;
};

type Problem = { message: string; signIn?: boolean };

function explain(err: unknown): Problem {
  const cause = err instanceof PhotoError ? err.cause : err;
  if (cause instanceof S3Error && cause.status === 403)
    return { message: 'Your sign-in has stopped working. Sign in again to carry on.', signIn: true };
  if (cause instanceof Error && cause.name === 'NotFoundError')
    return { message: 'The card couldn’t be read. Make sure it’s still plugged in, then press Try again.' };
  return { message: 'Sending stopped because the connection dropped. Check your internet, then press Try again.' };
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

export function Send({ session, lab, site, date, card, onDone, onFailed, onSignIn }: Props) {
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<Problem>();
  const [attempt, setAttempt] = useState(0);
  const reads = useRef(new Map<File, ReadResult>());
  const [now, setNow] = useState(performance.now());

  useWakeLock(!error);
  useLeaveWarning(!error);

  useEffect(() => {
    const stop = new AbortController();
    setError(undefined);
    onFailed(false);
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
      (outcome) => {
        if (stop.signal.aborted) return;
        console.info('uploader timings', JSON.stringify(outcome.timings));
        onDone(outcome);
      },
      (err) => {
        if (stop.signal.aborted) return;
        console.error(err);
        setError(explain(err));
        onFailed(true);
      },
    );
    return () => stop.abort();
  }, [attempt]);

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const total = progress?.total ?? card.length;
  const done = progress?.done ?? 0;
  let eta = 'Working out the time left…';
  if (progress) {
    const base = progress.phase === 'sending' ? progress.sentBefore : 0;
    const elapsed = now - progress.startedAt;
    const rate = (progress.done - base) / elapsed;
    if (progress.done - base >= 3 && elapsed > 3000) eta = timeLeft((progress.total - progress.done) / rate);
  }

  const pct = total ? (done / total) * 100 : 0;
  const bytes = card.reduce((n, c) => n + c.file.size, 0);

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
        <p className="font-body text-[13px] text-inkSoft">
          {number(card.length)} file{card.length === 1 ? '' : 's'} ready · {formatBytes(bytes)}
        </p>
        <dl className="space-y-1.5 font-body text-[13px]">
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Location</dt>
            <dd className="min-w-0">
              <span className="block break-words text-ink">{site.locationName}</span>
              <span className="block break-all font-mono text-[12px] text-inkMute">{site.locationID}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Date collected</dt>
            <dd className="text-ink min-w-0">{date}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[13px] text-inkSoft">
            <span className="font-mono text-ink uppercase tracking-[0.12em] text-[11px]">
              {error ? 'error' : progress?.phase === 'sending' ? 'uploading' : 'preparing'}
            </span>
            {' · '}
            <span className="font-mono text-ok">{number(done)}</span> done
          </p>
          <p className="shrink-0 font-mono text-[12px] text-inkSoft">
            {number(done)} / {number(total)}
          </p>
        </div>
        <div
          className="h-2 bg-paperHover border border-ruleSoft overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className={`block h-full ${error ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
        </div>
        {error ? (
          <>
            <Note tone="warn" message={error.message} />
            <div className="flex justify-end">
              {error.signIn ? (
                <button className={primaryButton} onClick={onSignIn}>
                  Sign in again
                </button>
              ) : (
                <button className={primaryButton} onClick={() => setAttempt((a) => a + 1)}>
                  Try again
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="font-mono text-[12px] text-inkSoft">{eta}</p>
            <Note message="Keep this page open until it’s done." />
          </>
        )}
      </section>
    </div>
  );
}
