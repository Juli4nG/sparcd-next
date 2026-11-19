import { useEffect, useState } from 'react';
import { readTable, type Session, type Site } from '@sparcd/bucket';
import { cardDescription } from '../lib/words';
import { Note } from '../ui/Note';

type Card = { deploymentID: string; description: string };

async function loadCards(session: Session, sites: Site[]): Promise<Card[]> {
  const [deployments, media] = await Promise.all([readTable(session.bucket, 'deployments'), readTable(session.bucket, 'media')]);
  const photos = new Map<string, number>();
  for (const m of media) photos.set(m.deploymentID, (photos.get(m.deploymentID) ?? 0) + 1);
  const names = new Map(sites.map((s) => [s.locationID, s.locationName]));
  return deployments
    .filter((d) => !d.deploymentGroups?.includes('share:'))
    .map((d) => {
      const site = d.locationName || names.get(d.locationID ?? '') || d.locationID || d.deploymentID;
      return {
        deploymentID: d.deploymentID,
        site,
        date: d.deploymentID.slice(-10),
        description: cardDescription(d.deploymentGroups ?? '', site, d.locationID ?? '', photos.get(d.deploymentID) ?? 0, d.deploymentID.slice(-10)),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.site.localeCompare(b.site));
}

export function CardsSent({ session, sites }: { session: Session; sites: Site[] }) {
  const [cards, setCards] = useState<Card[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadCards(session, sites).then(setCards, () =>
      setError("Your uploads couldn't be loaded. Check your internet and try again."),
    );
  }, [session, sites]);

  if (error)
    return (
      <div className="max-w-2xl mx-auto">
        <Note tone="warn" message={error} />
      </div>
    );
  if (!cards)
    return (
      <div className="max-w-2xl mx-auto">
        <p className="font-body text-[14px] text-inkSoft">Loading sessions…</p>
      </div>
    );
  if (!cards.length)
    return (
      <div className="max-w-2xl mx-auto">
        <div className="border border-ruleSoft bg-panel px-6 py-12 text-center">
          <p className="font-display text-[18px] text-ink mb-1">No uploads yet</p>
          <p className="font-body text-[14px] text-inkSoft">Cards you upload are listed here.</p>
        </div>
      </div>
    );

  return (
    <div className="max-w-2xl mx-auto">
      <ul className="space-y-3">
        {cards.map((c) => (
          <li key={c.deploymentID} className="border border-ruleSoft bg-panel px-4 py-3">
            <p className="font-body text-[14px] text-ink [overflow-wrap:anywhere]">{c.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
