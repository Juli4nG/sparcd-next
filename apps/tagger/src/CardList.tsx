import { useEffect, useState } from 'react';
import { readPackage, type Deployment, type Session } from '@sparcd/bucket';
import { cardSummaries, type CardSummary } from './data/card';
import { sharedSummaries, type SharedSummary } from './data/share';
import { cardTitle } from './dates';
import { ShareDialog } from './share/ShareDialog';
import { SharedList } from './share/SharedList';

export function CardList({ session }: { session: Session }) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [shared, setShared] = useState<SharedSummary[]>([]);
  const [sharing, setSharing] = useState<Deployment | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    readPackage(session.bucket).then(
      (rows) => {
        setCards(cardSummaries(rows));
        setShared(sharedSummaries(rows));
      },
      () => setFailed(true),
    );
  }, [session]);

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-6 py-8">
        <h1 className="font-display text-[32px] font-[600] text-ink mb-6">Your cards</h1>
        {failed ? (
          <p role="alert" className="text-[18px] text-warn">We couldn't load your cards. Check your internet connection, then reload the page.</p>
        ) : !cards ? (
          <p role="status" className="text-[18px] text-inkMute">Loading your cards…</p>
        ) : !cards.length ? (
          <p className="text-[18px] text-inkSoft">
            You don't have any cards yet. <a className="text-accent underline" href="/upload/">Send a card's photos</a> first, then come back here to tag them.
          </p>
        ) : (
          <ul className="space-y-3">
            {cards.map((c) => (
              <li key={c.deployment.deploymentID} data-testid="card-row" className="bg-panel border border-rule p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[22px] font-[600] text-ink truncate">{cardTitle(c.deployment)}</h2>
                  <p className="text-[17px] text-inkSoft">
                    {c.photos.toLocaleString()} photos · {c.tagged.toLocaleString()} tagged · {c.untagged.toLocaleString()} not tagged yet
                  </p>
                  <div aria-hidden className="mt-2 h-2 bg-ruleSoft rounded-full overflow-hidden max-w-[360px]">
                    <div className="h-full bg-ok" style={{ width: `${c.photos ? (c.tagged / c.photos) * 100 : 0}%` }} />
                  </div>
                </div>
                <button
                  onClick={() => setSharing(c.deployment)}
                  className="min-h-14 px-5 border border-ink text-ink text-[18px] font-[600] hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  Share for tagging
                </button>
                <a
                  href={`#card=${encodeURIComponent(c.deployment.deploymentID)}`}
                  className="min-h-14 px-6 inline-flex items-center bg-ink text-paper text-[18px] font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  {c.untagged ? 'Tag these photos' : 'Look at these photos'}
                </a>
              </li>
            ))}
          </ul>
        )}
        {shared.length > 0 && <SharedList cards={shared} />}
      </div>
      {sharing && <ShareDialog session={session} deployment={sharing} onClose={() => setSharing(null)} />}
    </main>
  );
}
