import { useEffect, useState } from 'react';
import { readTable, type Session, type Site } from '@sparcd/bucket';
import { count } from '../lib/words';

type Card = { deploymentID: string; site: string; date: string; photos: number };

async function loadCards(session: Session, sites: Site[]): Promise<Card[]> {
  const [deployments, media] = await Promise.all([readTable(session.bucket, 'deployments'), readTable(session.bucket, 'media')]);
  const photos = new Map<string, number>();
  for (const m of media) photos.set(m.deploymentID, (photos.get(m.deploymentID) ?? 0) + 1);
  const names = new Map(sites.map((s) => [s.locationID, s.locationName]));
  return deployments
    .filter((d) => !d.deploymentGroups?.includes('share:'))
    .map((d) => ({
      deploymentID: d.deploymentID,
      site: d.locationName || names.get(d.locationID ?? '') || d.locationID || d.deploymentID,
      date: d.deploymentID.slice(-10),
      photos: photos.get(d.deploymentID) ?? 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.site.localeCompare(b.site));
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export function CardsSent({ session, sites, onBack }: { session: Session; sites: Site[]; onBack: () => void }) {
  const [cards, setCards] = useState<Card[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadCards(session, sites).then(setCards, () =>
      setError("Your cards couldn't be loaded. Check your internet and try again."),
    );
  }, [session, sites]);

  return (
    <>
      <h1>Cards sent</h1>
      {error && <p className="error">{error}</p>}
      {!cards && !error && <p className="quiet">Loading…</p>}
      {cards && !cards.length && <p className="quiet">You haven’t sent any cards yet.</p>}
      {cards && cards.length > 0 && (
        <table className="cards">
          <thead>
            <tr>
              <th>Site</th>
              <th>Card out</th>
              <th>Photos</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.deploymentID}>
                <td>{c.site}</td>
                <td>{longDate(c.date)}</td>
                <td>{count(c.photos, 'photo')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <span />
      </div>
    </>
  );
}
