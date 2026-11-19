import { useState } from 'react';
import type { Site } from '@sparcd/bucket';
import { footer, input, primaryButton, backButton, sectionLabel } from '../ui/fn';

const pad = (n: number) => String(n).padStart(2, '0');

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Props = {
  sites: Site[];
  site?: Site;
  date: string;
  onBack: () => void;
  onNext: (site: Site, date: string) => void;
};

export function Describe({ sites, site, date: initialDate, onBack, onNext }: Props) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(site);
  const [date, setDate] = useState(initialDate);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sites
    .filter((s) => words.every((w) => `${s.locationName} ${s.locationID}`.toLowerCase().includes(w)))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today();
  const hint = !chosen
    ? 'Select a deployment location before continuing.'
    : !dateValid
      ? 'Pick a date collected that isn’t in the future.'
      : null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <section>
        <h2 className={sectionLabel}>Site ID (required)</h2>
        <div className="border border-rule bg-panel">
          <div className="p-2 border-b border-ruleSoft">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or id…"
              aria-label="Filter sites"
              className="w-full border border-rule bg-paper px-2.5 py-1.5 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ul role="listbox" aria-label="Sites" className="max-h-[280px] overflow-auto">
            {!shown.length && (
              <li className="px-3 py-2 font-body text-[13px] text-inkMute">No matching locations.</li>
            )}
            {shown.map((s) => {
              const selected = s.locationID === chosen?.locationID;
              return (
                <li
                  key={s.locationID}
                  role="option"
                  aria-selected={selected}
                  onClick={() => setChosen(s)}
                  className={`px-3 py-2 cursor-pointer border-b border-ruleSoft last:border-b-0 ${
                    selected ? 'bg-mark' : 'hover:bg-panelHover'
                  }`}
                >
                  <span className="block truncate font-body text-[14px] text-ink">{s.locationName}</span>
                  <span className="block truncate font-mono text-[12px] text-inkMute">{s.locationID}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section>
        <label htmlFor="dateCollected" className={`block ${sectionLabel}`}>
          Date collected (required)
        </label>
        <input
          id="dateCollected"
          type="date"
          required
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          className={input}
        />
        <p className="font-body text-[12px] text-inkMute mt-1.5">
          The date these images were collected in the field.
        </p>
      </section>

      {hint && (
        <p role="status" className="font-body text-[12px] text-warn">
          {hint}
        </p>
      )}
      <div className={footer}>
        <button onClick={onBack} className={backButton}>
          Back
        </button>
        <button
          disabled={!!hint}
          onClick={() => onNext(chosen!, date)}
          title={hint ?? 'Continue to upload'}
          className={primaryButton}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
