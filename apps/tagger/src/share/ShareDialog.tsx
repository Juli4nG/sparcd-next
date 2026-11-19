import { useEffect, useState } from 'react';
import { createShare, type Deployment, type Session } from '@sparcd/bucket';
import { loadSettings } from '../data/card';
import { shareLink } from '../data/share';
import { cardTitle } from '../dates';
import { Dialog, DialogHeader } from '../ui/Dialog';

/** Makes a new 7-day link for one of the person's own cards, ready to copy. */
export function ShareDialog({ session, deployment, onClose }: { session: Session; deployment: Deployment; onClose: () => void }) {
  const [link, setLink] = useState<string | 'failed' | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    loadSettings(session)
      .then(({ about }) => createShare(session.bucket, deployment.deploymentID, about))
      .then((url) => setLink(shareLink(url)), () => setLink('failed'));
  }, [session, deployment]);

  const copy = async () => {
    await navigator.clipboard.writeText(link!);
    setCopied(true);
  };

  return (
    <Dialog label="Share for tagging" onClose={onClose}>
      <DialogHeader title={`Share ${cardTitle(deployment)}`} onClose={onClose} />
      <div className="p-5 space-y-4 text-[18px] text-inkSoft">
        <p>
          Anyone you send this link to can tag these photos for 7 days. They won't see exactly where the camera was, or any photo you marked as
          having people in it.
        </p>
        {link === 'failed' ? (
          <p role="alert" className="text-warn">We couldn't make a link. Check your internet connection, then try again.</p>
        ) : !link ? (
          <p role="status" className="text-inkMute">Making the link…</p>
        ) : (
          <>
            <input
              readOnly
              aria-label="Link to send"
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full bg-panel border border-rule px-3 py-3 text-[16px] text-ink font-mono"
            />
            <button
              onClick={copy}
              className="w-full min-h-14 bg-ink text-paper text-[19px] font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
