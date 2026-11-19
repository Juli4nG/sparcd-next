import { useState, type DragEvent } from 'react';
import { scanDrop, scanFileList, type CardFile } from '../lib/scan';
import { count } from '../lib/words';

type Props = { card: CardFile[]; onCard: (c: CardFile[]) => void; onBack: () => void; onNext: () => void };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function ChooseCard({ card, onCard, onBack, onNext }: Props) {
  const [state, setState] = useState<'idle' | 'looking' | 'empty'>('idle');
  const [over, setOver] = useState(false);

  const take = async (found: Promise<CardFile[]> | CardFile[]) => {
    setState('looking');
    const files = [...(await found)].sort((a, b) => collator.compare(a.path, b.path));
    onCard(files);
    setState(files.length ? 'idle' : 'empty');
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(scanDrop(e.dataTransfer.items));
  };

  return (
    <>
      <h1>Choose the card</h1>
      <div
        className={over ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <label className="button big">
          Choose the card
          <input
            type="file"
            hidden
            // @ts-expect-error webkitdirectory is not in React's input attributes
            webkitdirectory=""
            onChange={(e) => e.target.files && void take(scanFileList(e.target.files))}
          />
        </label>
        <p className="quiet">or drag the card’s folder here</p>
      </div>
      <p className="status" aria-live="polite">
        {state === 'looking' && 'Looking for photos…'}
        {state === 'empty' && 'No photos found there. Choose the card’s folder.'}
        {state === 'idle' && card.length > 0 && `${count(card.length, 'photo')} found`}
      </p>
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button className="primary" disabled={!card.length || state === 'looking'} onClick={onNext}>
          Send photos
        </button>
      </div>
    </>
  );
}
