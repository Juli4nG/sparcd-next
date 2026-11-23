import { useEffect, useMemo, useState } from 'react';
import { PawTrail, focusRing, press } from '@sparcd/auth-ui';
import type { Deployment, Session } from '@sparcd/bucket';
import { readCards, type CardSummary } from './data/card';
import { deploymentLine, rangeOf } from './cardLine';

const ALL = '';

/** "Juniper Draw" from a card; the site filter's key. */
const siteOf = (c: CardSummary) => c.deployment.locationName || c.deployment.locationID || '';
const rangeOfCard = (c: CardSummary) => rangeOf(c.deployment.deploymentGroups);

const tagHref = (d: Deployment) => `#card=${encodeURIComponent(d.deploymentID)}`;

export function Home({ session }: { session: Session }) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [site, setSite] = useState(ALL);
  const [range, setRange] = useState(ALL);

  useEffect(() => {
    readCards(session.bucket).then(setCards, () => setFailed(true));
  }, [session]);

  const sites = useMemo(() => [...new Set((cards ?? []).map(siteOf))].filter(Boolean).sort(), [cards]);
  const ranges = useMemo(() => [...new Set((cards ?? []).map(rangeOfCard))].filter(Boolean).sort(), [cards]);
  const waiting = (cards ?? []).filter((c) => c.untagged > 0);
  const shown = waiting.filter((c) => (site === ALL || siteOf(c) === site) && (range === ALL || rangeOfCard(c) === range));
  const left = waiting.reduce((n, c) => n + c.untagged, 0);

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-6 py-10 flex flex-col gap-10">
        <a
          href={shown[0] ? tagHref(shown[0].deployment) : undefined}
          aria-disabled={!shown[0]}
          className={`h-32 flex flex-col items-center justify-center gap-1 border-2 ${
            shown[0] ? `bg-ink text-paper border-ink hover:opacity-90 ${press}` : 'bg-transparent text-inkMute border-ruleSoft cursor-default'
          } ${focusRing}`}
        >
          <span className="font-display text-title font-[600] leading-tight">Tag photos</span>
          <span className="text-detail h-6 opacity-80">{cards ? (left ? `${left.toLocaleString()} photos waiting` : 'Nothing waiting') : ''}</span>
        </a>

        <section aria-labelledby="to-tag" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 id="to-tag" className="font-display text-heading font-[600] text-ink">
              Photos to tag
            </h1>
            {(sites.length > 1 || ranges.length > 1) && (
              <div className="flex flex-wrap gap-3">
                {sites.length > 1 && <Filter label="Site" all="All sites" value={site} options={sites} onChange={setSite} />}
                {ranges.length > 1 && <Filter label="Range" all="All ranges" value={range} options={ranges} onChange={setRange} />}
              </div>
            )}
          </div>

          {failed ? (
            <p role="alert" className="text-body text-warn">
              We couldn't load your photos. Check your internet connection, then reload the page.
            </p>
          ) : !cards ? (
            <div role="status" className="grid justify-items-center gap-4 py-10">
              <PawTrail />
              <p className="text-body text-inkSoft">Loading…</p>
            </div>
          ) : !cards.length ? (
            <p className="text-body text-inkSoft">Nothing to tag yet. Upload some photos first.</p>
          ) : !waiting.length ? (
            <p className="text-body text-ok">Every photo is tagged. Thank you!</p>
          ) : !shown.length ? (
            <p className="text-body text-inkSoft">Nothing to tag for this choice.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((c) => (
                <li key={c.deployment.deploymentID} data-testid="card-row">
                  <a
                    href={tagHref(c.deployment)}
                    className={`flex items-center gap-6 px-5 py-4 bg-panel border border-rule hover:border-ink hover:bg-panelHover ${focusRing}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-lead leading-snug font-[600] text-ink">{deploymentLine(c.deployment, c.photos)}</span>
                      <span className="block text-detail text-inkSoft">
                        {c.untagged.toLocaleString()} of {c.photos.toLocaleString()} left to tag
                      </span>
                      <span aria-hidden className="mt-2 block h-1.5 max-w-[360px] bg-paperHover border border-ruleSoft overflow-hidden">
                        <span className="block h-full bg-ok" style={{ width: `${(c.tagged / c.photos) * 100}%` }} />
                      </span>
                    </span>
                    <span className="shrink-0 h-14 px-6 inline-flex items-center bg-ink text-paper text-body font-[600]">Tag</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Filter({ label, all, value, options, onChange }: { label: string; all: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-detail text-inkSoft">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-12 max-w-[16rem] px-3 bg-panel border border-rule text-detail text-ink ${focusRing}`}
      >
        <option value={ALL}>{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
