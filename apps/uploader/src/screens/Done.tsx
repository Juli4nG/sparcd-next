import type { Outcome } from '../lib/send';
import { count, number } from '../lib/words';

function headline(total: number, kept: number, alreadySaved: number): string {
  if (!kept) return 'No photos could be saved';
  if (alreadySaved === kept) return kept === 1 ? 'This photo was already saved' : `These ${count(kept, 'photo')} were already saved`;
  if (kept < total) return `${count(kept, 'photo')} ${kept === 1 ? 'is' : 'are'} saved`;
  return total === 1 ? 'The photo is saved' : `All ${number(total)} photos are saved`;
}

export function Done({ outcome, onAnother }: { outcome: Outcome; onAnother: () => void }) {
  const { total, alreadySaved, leftOut, deploymentID, cardHasPhotos } = outcome;
  const kept = total - leftOut.length;
  return (
    <>
      <p className="tick" aria-hidden>
        {kept ? '✓' : ''}
      </p>
      <h1>{headline(total, kept, alreadySaved)}</h1>
      <p className="quiet">
        {kept > 0 && alreadySaved === kept
          ? 'Nothing new to send from this card.'
          : alreadySaved > 0 && `${number(alreadySaved)} of them were already saved before.`}
      </p>
      {leftOut.length > 0 && (
        <>
          <p className="error">
            {count(leftOut.length, 'photo')} couldn’t be read and {leftOut.length === 1 ? 'was' : 'were'} left out:
          </p>
          <ul className="left-out">
            {leftOut.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button onClick={onAnother}>Send another card</button>
        <button
          className="primary"
          onClick={() => location.assign(cardHasPhotos ? `/tag/#card=${encodeURIComponent(deploymentID)}` : '/tag/')}
        >
          Tag these photos
        </button>
      </div>
    </>
  );
}
