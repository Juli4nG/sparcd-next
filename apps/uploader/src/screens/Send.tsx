import { useEffect, useRef, useState } from 'react';
import { S3Error, deploymentId, type Lab, type Session, type Site } from '@sparcd/bucket';
import type { CardFile } from '../lib/scan';
import { PhotoError, sendCard, type Outcome, type Progress } from '../lib/send';
import { number, timeLeft } from '../lib/words';
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

export function Send({ session, lab, site, date, card, onDone, onSignIn }: Props) {
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

  return (
    <>
      <h1>{progress?.phase === 'sending' ? 'Sending photos' : 'Getting photos ready'}</h1>
      <progress className="bar" max={total} value={done} />
      <p className="count">
        {number(done)} of {number(total)}
      </p>
      {error ? (
        <>
          <p className="error" role="alert">
            {error.message}
          </p>
          <div className="actions">
            <span />
            {error.signIn ? (
              <button className="primary" onClick={onSignIn}>
                Sign in again
              </button>
            ) : (
              <button className="primary" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="quiet">{eta}</p>
          <p className="quiet">Keep this page open until it’s done.</p>
        </>
      )}
    </>
  );
}
