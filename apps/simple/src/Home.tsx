import { useEffect, useMemo, useState } from 'react';
import { readPackage, type Session } from '@sparcd/bucket';
import { cardSummaries, type CardSummary } from './data/card';
import { deploymentLine, rangeOf } from './cardLine';
import { PawStamp } from './ui/Paw';
import { focusRing, press } from './ui/look';

const ALL = '';

/** "Juniper Draw" from a card; the site filter's key. */
const siteOf = (c: CardSummary) => c.deployment.locationName || c.deployment.locationID || '';
const rangeOfCard = (c: CardSummary) => rangeOf(c.deployment.deploymentGroups);

const tagHref = (c: CardSummary) => `#card=${encodeURIComponent(c.deployment.deploymentID)}`;

export function Home({ session }: { session: Session }) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [site, setSite] = useState(ALL);
  const [range, setRange] = useState(ALL);

  useEffect(() => {
    readPackage(session.bucket).then(
      (rows) => setCards(cardSummaries(rows)),
      () => setFailed(true),
    );
  }, [session]);

  const sites = useMemo(() => [...new Set((cards ?? []).map(siteOf))].filter(Boolean).sort(), [cards]);
  const ranges = useMemo(() => [...new Set((cards ?? []).map(rangeOfCard))].filter(Boolean).sort(), [cards]);
  const waiting = (cards ?? []).filter((c) => c.untagged > 0);
  const shown = waiting.filter((c) => (site === ALL || siteOf(c) === site) && (range === ALL || rangeOfCard(c) === range));
  const left = waiting.reduce((n, c) => n + c.untagged, 0);

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-6 py-10 flex flex-col gap-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a href="#send" className={`h-32 flex flex-col items-center justify-center gap-1 bg-ink text-paper border-2 border-ink hover:opacity-90 ${press} ${focusRing}`}>
            <span className="font-display text-[30px] font-[600] leading-tight">Upload photos</span>
          </a>
          <a
            href={shown[0] ? tagHref(shown[0]) : undefined}
            aria-disabled={!shown[0]}
            className={`h-32 flex flex-col items-center justify-center gap-1 border-2 ${
              shown[0] ? `bg-panel text-ink border-ink hover:bg-paperHover ${press}` : 'bg-transparent text-inkMute border-ruleSoft cursor-default'
            } ${focusRing}`}
          >
            <span className="font-display text-[30px] font-[600] leading-tight">Tag photos</span>
            <span className="text-[18px] text-inkSoft h-6">
              {cards ? (left ? `${left.toLocaleString()} photos waiting` : 'Nothing waiting') : ''}
            </span>
          </a>
        </div>

        <section aria-labelledby="to-tag" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 id="to-tag" className="font-display text-[28px] font-[600] text-ink">
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
            <p role="alert" className="text-[20px] text-warn">
              We couldn't load your photos. Check your internet connection, then reload the page.
            </p>
          ) : !cards ? (
            <div role="status" className="grid justify-items-center gap-4 py-10">
              <PawStamp />
              <p className="text-[20px] text-inkSoft">Loading…</p>
            </div>
          ) : !cards.length ? (
            <p className="text-[20px] text-inkSoft">Nothing to tag yet. Upload some photos first.</p>
          ) : !waiting.length ? (
            <p className="text-[20px] text-ok">Every photo is tagged. Thank you!</p>
          ) : !shown.length ? (
            <p className="text-[20px] text-inkSoft">Nothing to tag for this choice.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((c) => (
                <li key={c.deployment.deploymentID} data-testid="card-row">
                  <a
                    href={tagHref(c)}
                    className={`flex items-center gap-6 px-5 py-4 bg-panel border border-rule hover:border-ink hover:bg-panelHover ${focusRing}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[21px] leading-snug font-[600] text-ink">{deploymentLine(c.deployment, c.photos)}</span>
                      <span className="block text-[18px] text-inkSoft">
                        {c.untagged.toLocaleString()} of {c.photos.toLocaleString()} left to tag
                      </span>
                      <span aria-hidden className="mt-2 block h-1.5 max-w-[360px] bg-paperHover border border-ruleSoft overflow-hidden">
                        <span className="block h-full bg-ok" style={{ width: `${(c.tagged / c.photos) * 100}%` }} />
                      </span>
                    </span>
                    <span className="shrink-0 h-14 px-6 inline-flex items-center bg-ink text-paper text-[20px] font-[600]">Tag</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!!cards?.length && <Sent cards={cards} />}
      </div>
    </main>
  );
}

function Filter({ label, all, value, options, onChange }: { label: string; all: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[18px] text-inkSoft">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-12 max-w-[16rem] px-3 bg-panel border border-rule text-[18px] text-ink ${focusRing}`}
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

/** Every upload, closed until asked for. */
function Sent({ cards }: { cards: CardSummary[] }) {
  return (
    <details className="group border-t border-rule pt-4">
      <summary className={`list-none cursor-pointer min-h-12 inline-flex items-center gap-3 text-[20px] text-inkSoft hover:text-ink ${focusRing}`}>
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        Your uploads ({cards.length.toLocaleString()})
      </summary>
      <table className="mt-3 w-full text-left text-[17px]">
        <thead className="text-inkMute text-[15px]">
          <tr className="border-b border-ruleSoft">
            <th className="py-2 pr-4 font-[500]">Upload</th>
            <th className="py-2 pr-4 font-[500] text-right">Photos</th>
            <th className="py-2 font-[500] text-right">Tagged</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.deployment.deploymentID} className="border-b border-ruleSoft">
              <td className="py-2.5 pr-4">
                <a href={tagHref(c)} className={`text-ink underline underline-offset-4 decoration-ruleSoft hover:decoration-ink ${focusRing}`}>
                  {deploymentLine(c.deployment)}
                </a>
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{c.photos.toLocaleString()}</td>
              <td className="py-2.5 text-right tabular-nums">{c.tagged.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
