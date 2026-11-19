import { useEffect, useState } from 'react';
import { readTable, type Session, type Site } from '@sparcd/bucket';
import { number } from '../lib/words';
import { Note } from '../ui/Note';

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
          <li key={c.deploymentID} className="border border-ruleSoft bg-panel px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] text-ink truncate" title={c.deploymentID}>
                  {c.deploymentID}
                </p>
                <p className="font-body text-[12px] text-inkSoft [overflow-wrap:anywhere]">{c.site}</p>
                <p className="font-body text-[12px] text-inkSoft">{longDate(c.date)}</p>
              </div>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border border-ok/50 text-ok">
                complete
              </span>
            </div>
            <p className="font-body text-[12px] text-inkSoft">
              <span className="font-mono text-ink">{number(c.photos)}</span> files
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
