import { useEffect, useRef, useState } from 'react';
import { S3Error, deploymentId, type Lab, type Session, type Site } from '@sparcd/bucket';
import type { CardFile } from '../lib/scan';
import { PhotoError, sendCard, type Outcome, type Progress } from '../lib/send';
import { useOnline } from '@sparcd/auth-ui';
import { folderName, formatBytes, number, timeLeft } from '../lib/words';
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
  onSignIn: () => void;
};

type Problem = { message: string; signIn?: boolean; connection?: boolean };

const RETRY_MS = 15_000;

function explain(err: unknown): Problem {
  const cause = err instanceof PhotoError ? err.cause : err;
  if (cause instanceof S3Error && cause.status === 403)
    return { message: 'Your sign-in has stopped working. Sign in again to carry on.', signIn: true };
  if (cause instanceof Error && cause.name === 'NotFoundError')
    return { message: 'The card couldn’t be read. Make sure it’s still plugged in, then press Try again.' };
  return { message: '', connection: true };
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

export function Send({ session, lab, site, date, card, onDone, onSignIn }: Props) {
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<Problem>();
  const [attempt, setAttempt] = useState(0);
  const reads = useRef(new Map<File, ReadResult>());
  const [eta, setEta] = useState<string>();
  const latest = useRef<Progress>();
  latest.current = progress;
  const online = useOnline();
  const stopped = !!error && !error.connection;

  useWakeLock(!stopped);
  useLeaveWarning(!stopped);

  // A dropped connection carries on by itself: when the browser is back online, or after a pause.
  useEffect(() => {
    if (!error?.connection) return;
    const again = () => setAttempt((a) => a + 1);
    if (!online) {
      window.addEventListener('online', again, { once: true });
      return () => window.removeEventListener('online', again);
    }
    const timer = setTimeout(again, RETRY_MS);
    return () => clearTimeout(timer);
  }, [error, online]);

  // The rate swings while photos are being hashed and after a retry, so the time left is
  // smoothed and shown only once a few readings in a row agree.
  useEffect(() => {
    let smoothed: number | undefined;
    let steady = 0;
    let phase: string | undefined;
    const id = setInterval(() => {
      const p = latest.current;
      if (!p) return;
      if (p.phase !== phase) {
        phase = p.phase;
        smoothed = undefined;
        steady = 0;
        setEta(undefined);
      }
      const base = p.phase === 'sending' ? p.sentBefore : 0;
      const elapsed = performance.now() - p.startedAt;
      if (p.done - base < 5 || elapsed < 10_000) return;
      const rate = (p.done - base) / elapsed;
      smoothed = smoothed === undefined ? rate : smoothed * 0.85 + rate * 0.15;
      steady = Math.abs(rate - smoothed) / smoothed < 0.2 ? steady + 1 : 0;
      if (steady >= 5) setEta(timeLeft((p.total - p.done) / smoothed));
    }, 1000);
    return () => clearInterval(id);
  }, [attempt]);

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
      (outcome) => {
        if (stop.signal.aborted) return;
        console.info('uploader timings', JSON.stringify(outcome.timings));
        onDone(outcome);
      },
      (err) => {
        if (stop.signal.aborted) return;
        console.error(err);
        const problem = explain(err);
        setError(problem);
      },
    );
    return () => stop.abort();
  }, [attempt]);

  const total = progress?.total ?? card.length;
  const done = progress?.done ?? 0;
  const pct = total ? (done / total) * 100 : 0;
  const bytes = card.reduce((n, c) => n + c.file.size, 0);
  const folder = folderName(card);

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
        <p className="font-body text-[13px] text-inkSoft">
          {number(card.length)} photo{card.length === 1 ? '' : 's'} · {formatBytes(bytes)}
        </p>
        <dl className="space-y-1.5 font-body text-[13px]">
          {folder && (
            <div className="flex items-baseline gap-3">
              <dt className="text-inkSoft w-28 shrink-0">Folder</dt>
              <dd className="font-mono text-ink min-w-0 break-all">{folder}</dd>
            </div>
          )}
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Site ID</dt>
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
        <p className="font-body text-[13px] text-inkSoft">
          <span className="font-mono text-ink">{number(done)}</span> of{' '}
          <span className="font-mono text-ink">{number(total)}</span>{' '}
          {progress?.phase === 'sending' ? 'photos sent' : 'photos ready'}
        </p>
        <div
          className="h-2 bg-paperHover border border-ruleSoft overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className={`block h-full ${stopped ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
        </div>
        {!online && <Note tone="warn" message="No internet. Sending will carry on when it’s back." />}
        {stopped ? (
          <>
            <Note tone="warn" message={error!.message} />
            <div className="flex justify-end">
              {error!.signIn ? (
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
            {eta && <p className="font-body text-[13px] text-inkSoft">{eta}</p>}
            <p className="font-body text-[13px] text-inkSoft">Keep this page open until it’s done.</p>
          </>
        )}
      </section>
    </div>
  );
}
