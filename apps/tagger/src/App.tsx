import { useEffect, useRef, useState } from 'react';
import { Dialog, Message, Shell, focusRing } from '@sparcd/auth-ui';
import type { About, Session, Species } from '@sparcd/bucket';
import { loadCard, loadSettings, type Card } from './data/card';
import { saveEverything, unsavedEdits, useTagging } from './data/useTagging';
import { deploymentLine } from './cardLine';
import { Home } from './Home';
import { SimpleTag } from './tag/Simple';

/** '' is the list of photos to tag, '#card=<id>' tags one upload. The hash keeps the place on reload. */
const cardFromHash = () => {
  const card = /[#&]card=([^&]+)/.exec(location.hash);
  return card ? decodeURIComponent(card[1]) : null;
};

export function App() {
  const [cardId, setCardId] = useState(cardFromHash);
  const [leaving, setLeaving] = useState<{ go: () => void; failed: boolean } | null>(null);

  /** Leaving an upload waits for its tags to save; if they can't, the person decides. */
  const leave = async (go: () => void) => {
    if (!unsavedEdits()) return go();
    setLeaving({ go, failed: false });
    if (await saveEverything()) {
      setLeaving(null);
      go();
    } else setLeaving({ go, failed: true });
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    const onHash = () => void leaveRef.current(() => setCardId(cardFromHash()));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => window.scrollTo(0, 0), [cardId]);

  return (
    <>
      <Shell toolName="Tagger" beforeSignOut={(go) => void leave(go)}>
        {(session) => (cardId ? <CardPage key={cardId} session={session} cardId={cardId} /> : <Home session={session} />)}
      </Shell>
      {leaving && (
        <Leaving
          failed={leaving.failed}
          onRetry={() => leave(leaving.go)}
          onLeave={() => {
            setLeaving(null);
            leaving.go();
          }}
        />
      )}
    </>
  );
}

function CardPage({ session, cardId }: { session: Session; cardId: string }) {
  const [state, setState] = useState<{ card: Card | null; about: About; species: Species[] } | 'failed' | null>(null);
  useEffect(() => {
    Promise.all([loadSettings(session), loadCard(session, cardId)]).then(
      ([settings, card]) => setState({ ...settings, card }),
      () => setState('failed'),
    );
  }, [session, cardId]);

  if (!state) return <Message>Loading the photos…</Message>;
  if (state === 'failed') return <Message warn>We couldn't open these photos. Check your internet connection, then reload the page.</Message>;
  if (!state.card)
    return (
      <Message warn>
        These photos aren't here. <a className="text-accent underline" href="#">Go back to the start</a>.
      </Message>
    );
  return <CardScreen session={session} about={state.about} species={state.species} card={state.card} />;
}

function CardScreen({ session, about, species, card }: { session: Session; about: About; species: Species[]; card: Card }) {
  const tagging = useTagging(session, about, card);
  return <SimpleTag session={session} species={species} card={card} title={deploymentLine(card.deployment)} tagging={tagging} />;
}

function Leaving({ failed, onRetry, onLeave }: { failed: boolean; onRetry: () => void; onLeave: () => void }) {
  if (!failed)
    return (
      <Dialog label="Saving" onClose={() => {}}>
        <p role="status" className="px-6 py-8 text-[20px] text-center text-inkSoft">
          Saving…
        </p>
      </Dialog>
    );
  return (
    <Dialog label="Not saved" onClose={onRetry}>
      <p role="alert" className="px-6 pt-6 text-[20px] text-warn">
        We couldn't save your latest tags yet. This computer keeps them and saves them next time you open these photos.
      </p>
      <div className="flex justify-end gap-3 p-6">
        <button onClick={onRetry} className={`h-14 px-5 border border-ink bg-ink text-paper text-[20px] ${focusRing}`}>
          Try again
        </button>
        <button onClick={onLeave} className={`h-14 px-5 border border-rule text-[20px] ${focusRing}`}>
          Leave anyway
        </button>
      </div>
    </Dialog>
  );
}
