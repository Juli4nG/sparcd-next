import { useState } from 'react';
import type { Site } from '@sparcd/bucket';

export function SitePicker({ sites, value, onNext }: { sites: Site[]; value?: Site; onNext: (s: Site) => void }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(value);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sites
    .filter((s) => words.every((w) => s.locationName.toLowerCase().includes(w)))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  return (
    <>
      <h1>Where was the camera?</h1>
      <label className="field">
        Find a site
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type part of the name" />
      </label>
      <ul className="choices" aria-label="Sites">
        {shown.map((s) => (
          <li key={s.locationID}>
            <button
              className={s.locationID === chosen?.locationID ? 'choice chosen' : 'choice'}
              aria-pressed={s.locationID === chosen?.locationID}
              onClick={() => setChosen(s)}
            >
              {s.locationName}
            </button>
          </li>
        ))}
        {!shown.length && <li className="quiet">No site matches “{query}”.</li>}
      </ul>
      <div className="actions">
        <span />
        <button className="primary" disabled={!chosen} onClick={() => onNext(chosen!)}>
          Next
        </button>
      </div>
    </>
  );
}
