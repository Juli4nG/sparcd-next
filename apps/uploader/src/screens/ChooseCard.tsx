import { useRef, useState, type DragEvent } from 'react';
import { scanDrop, scanFileList, type CardFile } from '../lib/scan';
import { count } from '../lib/words';

type Props = { card: CardFile[]; onCard: (c: CardFile[]) => void; onBack: () => void; onNext: () => void };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function ChooseCard({ card, onCard, onBack, onNext }: Props) {
  const [state, setState] = useState<'idle' | 'looking' | 'empty' | 'failed'>('idle');
  const [over, setOver] = useState(false);
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
        <button className="big" onClick={() => picker.current!.click()}>
          Choose the card
        </button>
        <input
          ref={picker}
          type="file"
          hidden
          // @ts-expect-error webkitdirectory is not in React's input attributes
          webkitdirectory=""
          onChange={(e) => {
            if (e.target.files) void take(scanFileList(e.target.files));
            e.target.value = '';
          }}
        />
        <p className="quiet">or drag the card’s folder here</p>
      </div>
      <p className="status" aria-live="polite">
        {state === 'looking' && 'Looking for photos…'}
        {state === 'empty' && 'No photos found there. Choose the card’s folder.'}
        {state === 'failed' && 'We couldn’t read that card. Check it’s plugged in, then choose it again.'}
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
