import { useEffect, useState } from 'react';
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
  return (
    <div data-testid="applied-species" className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Chip key={t.key} tag={t} label={labelOf(t)} disabled={disabled} onSetCount={(n) => onSetCount(t.key, n)} onRemove={() => onRemove(t.key)} />
      ))}
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
  onSetCount: (n: number) => void;
  onRemove: () => void;
}) {
  const nothing = tag.observationType === 'blank';
  const [text, setText] = useState(String(tag.count));
  useEffect(() => setText(String(tag.count)), [tag.count]);
  const finish = (input: HTMLInputElement) => {
    const n = Number(text);
    if (!input.reportValidity()) return setText(String(tag.count));
    if (n !== tag.count) onSetCount(n);
  };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-3 pr-1 py-1 text-[15px] border ${nothing ? 'border-rule text-inkSoft' : 'border-ink text-ink'}`}>
      <span className="truncate max-w-[14rem]">{label}</span>
      {!nothing && (
        <input
          type="number"
          min={1}
          step={1}
          required
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => finish(e.currentTarget)}
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
