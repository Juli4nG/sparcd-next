import { useEffect, useState } from 'react';
import { TAG_URL, focusRing, press } from '@sparcd/auth-ui';
import type { Deployment, Session } from '@sparcd/bucket';
import { deploymentLine } from './cardLine';
import { readUploads, type Counts } from './uploads';

const tagHref = (d: Deployment) => `${TAG_URL}#card=${encodeURIComponent(d.deploymentID)}`;

export function Home({ session }: { session: Session }) {
  const [uploads, setUploads] = useState<Deployment[] | null>(null);
  const [counts, setCounts] = useState<Map<string, Counts> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const read = readUploads(session.bucket);
    read.uploads.then(setUploads, () => {});
    read.counts.then(setCounts, () => setFailed(true));
  }, [session]);

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-6 py-10 flex flex-col gap-10">
        <a href="#send" className={`h-32 flex items-center justify-center bg-ink text-paper border-2 border-ink hover:opacity-90 ${press} ${focusRing}`}>
          <span className="font-display text-[34px] font-[600] leading-tight">Upload photos</span>
        </a>
        {!(uploads && !uploads.length) && <Uploads uploads={uploads} counts={counts} failed={failed} />}
      </div>
    </main>
  );
}

/** Every upload, closed until asked for. The list shows once deployments.csv is in; the counts follow. */
function Uploads({ uploads, counts, failed }: { uploads: Deployment[] | null; counts: Map<string, Counts> | null; failed: boolean }) {
  const count = (id: string, n: keyof Counts) => {
    const c = counts?.get(id);
    return c ? c[n].toLocaleString() : failed ? '' : '…';
  };
  return (
    <details className="group border-t border-rule pt-4" data-testid="uploads">
      <summary className={`list-none cursor-pointer min-h-12 inline-flex items-center gap-3 text-[20px] text-inkSoft hover:text-ink ${focusRing}`}>
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        Your uploads{uploads && ` (${uploads.length.toLocaleString()})`}
        {failed ? (
          <span role="alert" className="text-[18px] text-warn">
            We couldn't load them. Check your internet connection, then reload the page.
          </span>
        ) : (
          !uploads && (
            <span role="status" className="text-[18px] text-inkMute">
              Loading…
            </span>
          )
        )}
      </summary>
      {uploads && (
        <table className="mt-3 w-full text-left text-[17px]">
          <thead className="text-inkMute text-[15px]">
            <tr className="border-b border-ruleSoft">
              <th className="py-2 pr-4 font-[500]">Upload</th>
              <th className="py-2 pr-4 font-[500] text-right">Photos</th>
              <th className="py-2 font-[500] text-right">Tagged</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((d) => (
              <tr key={d.deploymentID} className="border-b border-ruleSoft">
                <td className="py-2.5 pr-4">
                  <a href={tagHref(d)} className={`text-ink underline underline-offset-4 decoration-ruleSoft hover:decoration-ink ${focusRing}`}>
                    {deploymentLine(d)}
                  </a>
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{count(d.deploymentID, 'photos')}</td>
                <td className="py-2.5 text-right tabular-nums">{count(d.deploymentID, 'tagged')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
