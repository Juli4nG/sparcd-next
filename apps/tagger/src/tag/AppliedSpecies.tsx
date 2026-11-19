import { useEffect, useState } from 'react';

const MAX_COUNT = 999;
import type { PhotoTag } from '../data/tags';

export const NOTHING_LABEL = 'Nothing in this photo';

/** The focused photo's tags as chips: each with its own count and a ✕. */
export function AppliedSpecies({
  tags,
  labelOf,
  disabled,
  onSetCount,
  onRemove,
}: {
  tags: PhotoTag[];
  labelOf: (tag: PhotoTag) => string;
  disabled: boolean;
  onSetCount: (key: string, count: number) => void;
  onRemove: (key: string) => void;
}) {
  const [refused, setRefused] = useState(false);
  return (
    <div data-testid="applied-species" className="min-h-11 flex flex-wrap items-center gap-1.5">
      {!tags.length && <span className="text-[15px] text-inkMute">Not tagged yet</span>}
      {tags.map((t) => (
        <Chip
          key={t.key}
          tag={t}
          label={labelOf(t)}
          disabled={disabled}
          onSetCount={(n) => {
            setRefused(n === null);
            if (n !== null) onSetCount(t.key, n);
          }}
          onRemove={() => onRemove(t.key)}
        />
      ))}
      {refused && (
        <p role="alert" className="basis-full text-[15px] text-warn">
          How many must be a whole number from 1 to {MAX_COUNT}.
        </p>
      )}
    </div>
  );
}

function Chip({
  tag,
  label,
  disabled,
  onSetCount,
  onRemove,
}: {
  tag: PhotoTag;
  label: string;
  disabled: boolean;
  /** Null when the typed count was refused. */
  onSetCount: (n: number | null) => void;
  onRemove: () => void;
}) {
  const nothing = tag.observationType === 'blank';
  const [text, setText] = useState(String(tag.count));
  useEffect(() => setText(String(tag.count)), [tag.count]);
  const finish = () => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
      setText(String(tag.count));
      return onSetCount(null);
    }
    onSetCount(n);
  };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-3 pr-1 py-1 text-[15px] border ${nothing ? 'border-rule text-inkSoft' : 'border-ink text-ink'}`}>
      <span className="truncate max-w-[14rem]">{label}</span>
      {!nothing && (
        <input
          type="number"
          min={1}
          max={MAX_COUNT}
          step={1}
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={`How many: ${label}`}
          className="w-14 bg-paper border border-rule px-1.5 py-1 text-[15px] font-mono text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      )}
      <button
        disabled={disabled}
        onClick={onRemove}
        className="w-9 h-9 grid place-items-center text-inkMute hover:text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        title="Remove this species"
        aria-label={`Remove ${label}`}
      >
        ✕
      </button>
    </span>
  );
}
