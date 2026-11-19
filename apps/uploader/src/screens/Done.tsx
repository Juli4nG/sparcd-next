import type { Site } from '@sparcd/bucket';
import type { Outcome } from '../lib/send';
import { count, number } from '../lib/words';
import { backButton, primaryButton } from '../ui/fn';
import { Note } from '../ui/Note';

export function Done({ outcome, site, onAnother }: { outcome: Outcome; site: Site; onAnother: () => void }) {
  const { total, alreadySaved, leftOut, deploymentID, cardHasPhotos } = outcome;
  const kept = total - leftOut.length;
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="border border-ruleSoft bg-panel px-6 py-12 text-center">
        <p className="font-display text-[18px] text-ink mb-1">{kept ? 'Upload complete' : 'Upload failed'}</p>
        <p className="font-body text-[14px] text-inkSoft">
          {kept > 0 && alreadySaved === kept
            ? `All ${count(kept, 'file')} were already published. Nothing new to send from this card.`
            : `Published ${count(kept - alreadySaved, 'file')} to ${site.locationName}.`}
          {kept > 0 && alreadySaved > 0 && alreadySaved < kept && ` ${number(alreadySaved)} were already published before.`}
        </p>
      </div>
      {leftOut.length > 0 && (
        <div className="border border-warn/40 bg-paper px-3 py-2.5 space-y-1">
          <p className="font-body text-[13px] text-warn">
            {count(leftOut.length, 'file')} could not be read and {leftOut.length === 1 ? 'was' : 'were'} left out:
          </p>
          <ul className="font-mono text-[11px] text-inkSoft max-h-32 overflow-auto">
            {leftOut.map((name, i) => (
              <li key={i} className="truncate" title={name}>
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!kept && <Note tone="warn" message="No files could be published." />}
      <div className="flex justify-center gap-3">
        <button onClick={onAnother} className={backButton}>
          New upload
        </button>
        <button
          className={primaryButton}
          onClick={() => location.assign(cardHasPhotos ? `/tag/#card=${encodeURIComponent(deploymentID)}` : '/tag/')}
        >
          Tag these photos
        </button>
      </div>
    </div>
  );
}
