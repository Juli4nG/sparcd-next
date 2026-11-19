import type { Outcome } from '../lib/send';
import { count, number } from '../lib/words';

export function Done({ outcome, onAnother }: { outcome: Outcome; onAnother: () => void }) {
  const { total, alreadySaved, deploymentID } = outcome;
  const nothingNew = alreadySaved === total;
  return (
    <>
      <p className="tick" aria-hidden>
        ✓
      </p>
      <h1>
        {nothingNew
          ? `${total === 1 ? 'This photo was' : `These ${count(total, 'photo')} were`} already saved`
          : total === 1
            ? 'The photo is saved'
            : `All ${number(total)} photos are saved`}
      </h1>
      <p className="quiet">
        {nothingNew
          ? 'Nothing new to send from this card.'
          : alreadySaved > 0 && `${number(alreadySaved)} of them were already saved before.`}
      </p>
      <div className="actions">
        <button onClick={onAnother}>Send another card</button>
        <button className="primary" onClick={() => location.assign(`/tag/#card=${encodeURIComponent(deploymentID)}`)}>
          Tag these photos
        </button>
      </div>
    </>
  );
}
