import { useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CardDate({ value, onBack, onNext }: { value: string; onBack: () => void; onNext: (d: string) => void }) {
  const [date, setDate] = useState(value);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today();

  return (
    <>
      <h1>When did you take the card out?</h1>
      <label className="field">
        Date
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <p className="error" role="alert">
        {date && !valid ? 'Pick a date that isn’t in the future.' : ''}
      </p>
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button className="primary" disabled={!valid} onClick={() => onNext(date)}>
          Next
        </button>
      </div>
    </>
  );
}
