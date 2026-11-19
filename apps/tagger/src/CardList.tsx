import { PawStamp } from './ui/Paw';
import { useEffect, useState } from 'react';
import { createShare, readPackage, type Deployment, type Session } from '@sparcd/bucket';
import { cardSummaries, loadSettings, type CardSummary } from './data/card';
import { shareLink, sharedSummaries, type SharedSummary } from './data/share';
import { cardTitle } from './dates';
import { ShareDialog } from './share/ShareDialog';
import { SharedList } from './share/SharedList';

export function CardList({ session }: { session: Session }) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [shared, setShared] = useState<SharedSummary[]>([]);
  const [sharing, setSharing] = useState<{ deployment: Deployment; result: Promise<string | null> } | null>(null);
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
        <h1 className="font-display text-[20px] font-[600] text-ink mb-5">Your cards</h1>
        {failed ? (
          <p role="alert" className="text-[14px] text-warn">We couldn't load your cards. Check your internet connection, then reload the page.</p>
        ) : !cards ? (
          <div role="status" className="grid justify-items-center gap-4 py-12">
            <PawStamp />
            <p className="font-body text-[14px] text-inkSoft">Loading your cards…</p>
          </div>
        ) : !cards.length ? (
          <p className="text-[14px] text-inkSoft">
            You don't have any cards yet. <a className="text-accent underline" href="/upload/">Send a card's photos</a> first, then come back here to tag them.
          </p>
        ) : (
          <ul className="space-y-3">
            {cards.map((c) => (
              <li key={c.deployment.deploymentID} data-testid="card-row" className="border border-ruleSoft bg-panel px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="min-w-0 flex-1">
                  <h2 className="font-body text-[14px] font-[600] text-ink truncate">{cardTitle(c.deployment)}</h2>
                  <p className="font-body text-[12px] text-inkSoft">
                    {c.photos.toLocaleString()} photos · {c.tagged.toLocaleString()} tagged · {c.untagged.toLocaleString()} not tagged yet
                  </p>
                  <div aria-hidden className="mt-2 h-1.5 bg-paperHover border border-ruleSoft overflow-hidden max-w-[360px]">
                    <div className="h-full bg-ok" style={{ width: `${c.photos ? (c.tagged / c.photos) * 100 : 0}%` }} />
                  </div>
                </div>
                <button
                  onClick={() => {
                    const result = loadSettings(session)
                      .then(({ about }) => createShare(session.bucket, c.deployment.deploymentID, about))
                      .then(shareLink, () => null);
                    setSharing({ deployment: c.deployment, result });
                  }}
                  className="min-h-11 md:min-h-0 border border-ink text-ink px-3.5 py-2.5 md:py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  Share for tagging
                </button>
                <a
                  href={`#card=${encodeURIComponent(c.deployment.deploymentID)}`}
                  className="min-h-11 md:min-h-0 inline-flex items-center bg-ink text-paper border border-ink px-3.5 py-2.5 md:py-1.5 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  {c.untagged ? 'Tag these photos' : 'Look at these photos'}
                </a>
              </li>
            ))}
          </ul>
        )}
        {shared.length > 0 && <SharedList cards={shared} />}
      </div>
      {sharing && <ShareDialog {...sharing} onClose={() => setSharing(null)} />}
    </main>
  );
}
