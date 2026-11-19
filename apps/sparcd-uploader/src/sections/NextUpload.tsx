// The Upload step on the new storage: one card is one deployment in the
// person's own bucket, sent by the same pipeline as apps/uploader. Upload.tsx
// keeps the old screen.
import { useEffect, useMemo, useState } from 'react';
import { deploymentId } from '@sparcd/bucket';
import { useStore } from '../store';
import { useNext } from '../next/session';
import { cancelRun, clearRun, startRun, useRun } from '../next/run';
import { findAllowedLocation } from '../lib/allowedLocations';
import { formatBytes } from '../lib/scanFiles';
import { Note } from '../components/RunMonitor';
import { UploadCompleteDialog } from '../components/UploadCompleteDialog';
import { siteLocation } from './NextAssign';

const sectionLabel = 'font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-2';
const isPhoto = (name: string) => /\.jpe?g$/i.test(name);

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let gone = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      navigator.wakeLock.request('screen').then((l) => (gone ? void l.release() : (lock = l)), () => {});
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

/** Rounded so it reads like a person would say it: "About 20 minutes left". */
function timeLeft(ms: number) {
  const min = ms / 60_000;
  if (min < 1.5) return 'About a minute left';
  if (min < 10) return `About ${Math.round(min)} minutes left`;
  if (min < 90) return `About ${Math.round(min / 5) * 5} minutes left`;
  const h = Math.round(min / 30) / 2;
  return `About ${h} hour${h === 1 ? '' : 's'} left`;
}

export function NextUpload() {
  const files = useStore((s) => s.files);
  const setStep = useStore((s) => s.setStep);
  const nextBatch = useStore((s) => s.nextBatch);
  const selectedLocationId = useStore((s) => s.selectedLocationId);
  const dateCollected = useStore((s) => s.dateCollected);
  const { session, lab, sites } = useNext();
  const { running, progress, outcome, error } = useRun();
  const [completeDismissed, setCompleteDismissed] = useState(false);
  const [now, setNow] = useState(performance.now());

  const site = sites?.find((s) => s.locationID === selectedLocationId);
  const location = site ? findAllowedLocation([siteLocation(site)], selectedLocationId) : null;
  const card = useMemo(
    () => files.filter((f) => isPhoto(f.fileName)).map((f) => ({ path: f.relPath, file: f.file })),
    [files],
  );
  const skippedOther = files.length - card.length;
  const started = running || !!progress || !!outcome || !!error;

  useWakeLock(running);
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    const tick = setInterval(() => setNow(performance.now()), 1000);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearInterval(tick);
    };
  }, [running]);

  if (!site || !dateCollected || !session || !lab) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Note tone="warn" message={session && lab ? 'Missing a site or date collected. Go back to Describe.' : 'Loading your storage…'} />
        <button
          onClick={() => setStep('assign')}
          className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover"
        >
          Back
        </button>
      </div>
    );
  }

  const start = () => {
    setCompleteDismissed(false);
    startRun({ session, lab, site, date: dateCollected, card });
  };

  const total = progress?.total ?? card.length;
  const done = outcome ? total : (progress?.done ?? 0);
  const pct = total > 0 ? (done / total) * 100 : 0;
  const phase = outcome ? 'done' : error ? 'paused' : progress?.phase === 'sending' ? 'uploading' : running ? 'preparing' : 'idle';
  // Shown only while sending, once enough photos have gone to judge the pace
  // (an early guess jumped from minutes to hours, #655). The average over the
  // whole send moves slowly, so the estimate stays steady.
  let eta: string | null = null;
  if (running && progress?.phase === 'sending') {
    const sent = progress.done - progress.sentBefore;
    const elapsed = now - progress.startedAt;
    if (sent >= 10 && elapsed > 20_000) eta = timeLeft(((progress.total - progress.done) * elapsed) / sent);
  }
  const stored = outcome ? outcome.total - outcome.alreadySaved - outcome.leftOut.length : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-7">
      <section className="space-y-3">
        <h2 className={sectionLabel}>Upload</h2>
        <p className="font-body text-[13px] text-inkSoft">
          {card.length} photo{card.length === 1 ? '' : 's'} ready · {formatBytes(card.reduce((n, c) => n + c.file.size, 0))}
          {skippedOther > 0 && ` (${skippedOther} other file${skippedOther === 1 ? '' : 's'} not uploaded: photos only)`}
        </p>
        <dl className="space-y-1.5 font-body text-[13px]">
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Storage</dt>
            <dd className="text-ink min-w-0 break-words">{session.name}</dd>
          </div>
          {location && (
            <div className="flex items-baseline gap-3">
              <dt className="text-inkSoft w-28 shrink-0">Site ID</dt>
              <dd className="min-w-0">
                <span className="block break-words text-ink">{location.name}</span>
                <span className="block break-all font-mono text-[12px] text-inkMute">{location.id}</span>
              </dd>
            </div>
          )}
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Date collected</dt>
            <dd className="text-ink min-w-0">{dateCollected}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Deployment</dt>
            <dd className="font-mono text-ink min-w-0 break-all">{deploymentId(site.locationID, dateCollected)}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-inkSoft w-28 shrink-0">Timezone</dt>
            <dd className="text-ink min-w-0">{lab.timeZone}</dd>
          </div>
        </dl>
      </section>

      {started && (
        <section className="space-y-3" aria-label="Upload progress">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="font-body text-[13px] text-inkSoft">
              <span className="font-mono text-ink uppercase tracking-[0.12em] text-[11px]">{phase}</span>
              {' · '}
              <span className="font-mono text-ok">{done}</span> of <span className="font-mono">{total}</span>{' '}
              {progress?.phase === 'reading' && running ? 'read' : 'done'}
            </p>
            {eta && <p className="shrink-0 font-body text-[13px] text-ink">{eta}</p>}
          </div>
          <div className="h-2 bg-paperHover border border-ruleSoft overflow-hidden">
            <span
              className={`block h-full ${error ? 'bg-warn' : 'bg-accent'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {running && <Note message="Keep this page open until the upload is done." />}
          {outcome && (
            <Note
              message={`Saved ${stored} new photo${stored === 1 ? '' : 's'}.${
                outcome.alreadySaved ? ` Already saved: ${outcome.alreadySaved}.` : ''
              }`}
            />
          )}
          {outcome && outcome.leftOut.length > 0 && (
            <Note
              tone="warn"
              message={`${outcome.leftOut.length} photo${outcome.leftOut.length === 1 ? '' : 's'} couldn't be read and were left out: ${outcome.leftOut.slice(0, 10).join(', ')}${outcome.leftOut.length > 10 ? '…' : ''}`}
            />
          )}
          {error && <Note tone="warn" message={error} />}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ruleSoft pt-5">
        <button
          onClick={() => setStep('assign')}
          disabled={started}
          className={`border border-ink text-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
            started ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          Back
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button
              onClick={cancelRun}
              className="border border-warn text-warn px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Cancel
            </button>
          ) : outcome ? (
            <button
              onClick={() => {
                clearRun();
                nextBatch();
              }}
              className="bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              Next batch
            </button>
          ) : (
            <button
              onClick={start}
              disabled={card.length === 0}
              className={`bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
                card.length === 0 ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              {error ? 'Retry upload' : 'Start upload'}
            </button>
          )}
        </div>
      </div>

      {outcome && !completeDismissed && (
        <UploadCompleteDialog
          doneCount={outcome.total - outcome.leftOut.length}
          collectionId={outcome.deploymentID}
          onClose={() => setCompleteDismissed(true)}
        />
      )}
    </div>
  );
}
