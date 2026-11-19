import { useRef, useState, type DragEvent } from 'react';
import { scanDrop, scanFileList, type CardFile } from '../lib/scan';
import { folderName, formatBytes, number } from '../lib/words';
import { backButton, primaryButton } from '../ui/fn';

type Props = { card: CardFile[]; onCard: (c: CardFile[]) => void; onNext: () => void };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function ChooseCard({ card, onCard, onNext }: Props) {
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

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setHover(false);
    void take(scanDrop(e.dataTransfer.items));
  };

  if (state === 'idle' && card.length > 0) {
    const bytes = card.reduce((n, c) => n + c.file.size, 0);
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <p className="font-body text-[14px] text-inkSoft">
          {folderName(card) && (
            <>
              <span className="font-mono text-ink">{folderName(card)}</span> ·{' '}
            </>
          )}
          <span className="font-mono text-ink">{number(card.length)}</span> photos ·{' '}
          <span className="font-mono text-ink">{formatBytes(bytes)}</span>
        </p>
        <div className="flex justify-center gap-3">
          <button onClick={() => onCard([])} title="Choose a different folder" className={backButton}>
            Back
          </button>
          <button onClick={onNext} title="Continue to Describe" className={primaryButton}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  const noneFound = state === 'empty' || state === 'failed';
  return (
    <div className="max-w-2xl mx-auto">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a folder of photos to upload"
        onClick={() => picker.current!.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            picker.current!.click();
          }
        }}
        onDragOver={(e) => (e.preventDefault(), setHover(true))}
        onDragLeave={() => setHover(false)}
        onDrop={drop}
        className={`border ${
          hover ? 'border-accent bg-accentSoft' : noneFound ? 'border-warn bg-panel' : 'border-rule bg-panel'
        } px-8 py-16 text-center cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2`}
      >
        {state === 'looking' ? (
          <p className="font-body text-[15px] text-inkSoft">Scanning folder…</p>
        ) : noneFound ? (
          <>
            <p className="font-display text-[20px] text-warn mb-1">
              {state === 'failed' ? 'That folder couldn’t be read' : 'No images in that folder'}
            </p>
            <p className="font-body text-[14px] text-inkSoft mb-5">
              {state === 'failed' ? (
                'Check it’s still plugged in, then choose the folder again.'
              ) : (
                <>
                  The folder was read but held no <span className="font-mono">.jpg</span>/
                  <span className="font-mono">.jpeg</span> files. This tool uploads JPEG — choose another folder.
                </>
              )}
            </p>
            <span className="inline-block bg-ink text-paper border border-ink px-4 py-2 text-[14px] font-body font-[600]">
              Choose another folder
            </span>
          </>
        ) : (
          <>
            <p className="font-display text-[20px] text-ink mb-1">Drop a folder to upload</p>
            <p className="font-body text-[14px] text-inkSoft mb-5">
              or click Choose folder to browse. JPEG files in the folder and its sub-folders are included.
            </p>
            <span className="inline-block min-h-11 md:min-h-0 bg-ink text-paper border border-ink px-4 py-2 text-[14px] font-body font-[600]">
              Choose folder
            </span>
          </>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        aria-label="New upload folder"
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
