import { useEffect, useState } from 'react';
import { loadConfig, restoreSession, signOut, type About, type Config, type Session, type Species } from '@sparcd/bucket';
import { CardList } from './CardList';
import { loadCard, loadSettings, type Card } from './data/card';
import { shareFromHash } from './data/share';
import { cardTitle } from './dates';
import { SharePage } from './share/SharePage';
import { SignIn } from './SignIn';
import { Tag } from './tag/Tag';

type Start = { config: Config; session: Session | null } | { failed: true };

const cardFromHash = () => {
  const m = /[#&]card=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};

export function App() {
  const [start, setStart] = useState<Start | null>(null);
  const [cardId, setCardId] = useState(cardFromHash);
  const [shareUrl, setShareUrl] = useState(shareFromHash);

  useEffect(() => {
    loadConfig()
      .then(async (config) => setStart({ config, session: await restoreSession(config) }))
      .catch(() => setStart({ failed: true }));
    const onHash = () => {
      setCardId(cardFromHash());
      setShareUrl(shareFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!start) return <Message>Loading…</Message>;
  if ('failed' in start) return <Message warn>We couldn't reach the server. Check your internet connection, then reload the page.</Message>;
  const { config, session } = start;
  if (!session) return <SignIn config={config} onSignedIn={(s) => setStart({ config, session: s })} />;

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 flex items-center gap-4 px-4 py-2 bg-ink text-paper">
        <a href="#" className="font-display text-[22px] font-[600]">
          SPARC'd Tagger
        </a>
        <span className="ml-auto text-[17px]">{session.name}</span>
        <button
          onClick={() => {
            signOut();
            setStart({ config, session: null });
          }}
          className="min-h-11 px-3 border border-paper/50 text-[16px] hover:bg-paper/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper"
        >
          Sign out
        </button>
      </header>
      <div className="flex-1 min-h-0">{shareUrl ? <SharePage key={shareUrl} session={session} url={shareUrl} /> : cardId ? <CardPage key={cardId} session={session} cardId={cardId} /> : <CardList session={session} />}</div>
    </div>
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
  if (state === 'failed') return <Message warn>We couldn't open this card. Check your internet connection, then reload the page.</Message>;
  if (!state.card)
    return (
      <Message warn>
        This card isn't in your photos. <a className="text-accent underline" href="#">Go back to your cards</a>.
      </Message>
    );
  return <Tag session={session} about={state.about} species={state.species} card={state.card} title={cardTitle(state.card.deployment)} />;
}

export function Message({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="h-full grid place-items-center p-8">
      <p role={warn ? 'alert' : 'status'} className={`text-[19px] max-w-[36rem] text-center ${warn ? 'text-warn' : 'text-inkMute'}`}>
        {children}
      </p>
    </div>
  );
}
