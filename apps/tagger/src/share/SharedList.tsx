import { BROKEN_LINK, linkExpired, type SharedSummary } from '../data/share';
import { cardTitle } from '../dates';

/** Cards other people shared, which the person has tagged in; reopened from the link saved in this browser. */
export function SharedList({ cards }: { cards: SharedSummary[] }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-[20px] font-[600] text-ink mb-5">Shared with you</h2>
      <ul className="space-y-3">
        {cards.map((c) => (
          <li key={c.deployment.deploymentID} data-testid="shared-row" className="border border-ruleSoft bg-panel px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-body text-[14px] font-[600] text-ink truncate">{cardTitle(c.deployment)}</h3>
              <p className="font-body text-[12px] text-inkSoft">{c.tagged.toLocaleString()} photos tagged by you</p>
              {(!c.link || linkExpired(c.link)) && (
                <p className="font-body text-[12px] text-warn">
                  {c.link ? BROKEN_LINK : "The link isn't saved on this computer. Ask the person who sent it to send it again."}
                </p>
              )}
            </div>
            {c.link && !linkExpired(c.link) && (
              <a
                href={`#share=${encodeURIComponent(c.link)}`}
                className="min-h-11 md:min-h-0 inline-flex items-center bg-ink text-paper border border-ink px-3.5 py-2.5 md:py-1.5 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Keep tagging
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
