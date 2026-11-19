import { useEffect, useRef, useState } from 'react';
import { loadConfig, restoreSession, signOut, type About, type Config, type Session, type Species } from '@sparcd/bucket';
import { CardList } from './CardList';
import { loadCard, loadSettings, type Card } from './data/card';
import { shareFromHash } from './data/share';
import { saveEverything, unsavedEdits, useTagging } from './data/useTagging';
import { cardTitle } from './dates';
import { simpleFlag } from './lib/simpleFlag';
import { SharePage } from './share/SharePage';
import { SimpleTag } from './simple/Simple';
import { Tag } from './tag/Tag';
import { Dialog } from './ui/Dialog';
import { GateSignIn } from './ui/GateSignIn';
import { PawStamp } from './ui/Paw';
import {
  BrandSwitcher,
  ConnectionChip,
  clearSharedConnection,
  loadSessionConnection,
  loadSharedTheme,
  saveSharedTheme,
  type Theme,
} from '@sparcd/auth-ui';

loadSessionConnection();

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => loadSharedTheme() ?? 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      saveSharedTheme(next);
      return next;
    });
  return [theme, toggle];
}

type Start = { config: Config; session: Session | null } | { failed: true };

const cardFromHash = () => {
  const m = /[#&]card=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};
const simpleFromHash = () => simpleFlag(location.hash).simple;

export function App() {
  const [start, setStart] = useState<Start | null>(null);
  const [cardId, setCardId] = useState(cardFromHash);
  const [simple, setSimple] = useState(simpleFromHash);
  const [shareUrl, setShareUrl] = useState(shareFromHash);
  const [leaving, setLeaving] = useState<{ go: () => void; failed: boolean } | null>(null);
  const [theme, toggleTheme] = useTheme();

  /** Leaving a card waits for its tags to save; if they can't, the person decides. */
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
  const open = useRef({ cardId, shareUrl });
  open.current = { cardId, shareUrl };

  useEffect(() => {
    loadConfig()
      .then(async (config) => setStart({ config, session: await restoreSession(config) }))
      .catch(() => setStart({ failed: true }));
    const onHash = () => {
      const next = cardFromHash();
      const share = shareFromHash();
      const nextSimple = simpleFromHash();
      // Switching screens keeps the card and its tagging state open: nothing to save first.
      if (next === open.current.cardId && share === open.current.shareUrl) return setSimple(nextSimple);
      void leaveRef.current(() => {
        setCardId(next);
        setShareUrl(share);
        setSimple(nextSimple);
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!start) return <Message>Loading…</Message>;
  if ('failed' in start) return <Message warn>We couldn't reach the server. Check your internet connection, then reload the page.</Message>;
  const { config, session } = start;
  if (!session) return <GateSignIn config={config} toolName="Tagger" onSignedIn={(s) => setStart({ config, session: s })} />;
  const tagOpen = shareUrl !== null || !!cardId;

  return (
    <div className="h-[100dvh] flex flex-col bg-paper">
      <header className="min-h-14 shrink-0 bg-panel border-b border-rule flex flex-wrap items-stretch px-4">
        <div className="flex items-center pr-6">
          <BrandSwitcher toolName="Tagger" />
        </div>

        <nav className="flex items-stretch" aria-label="Sections">
          {[
            { label: 'Browse', active: !tagOpen, href: '#' },
            { label: 'Tag', active: tagOpen, href: undefined },
          ].map((s) => (
            <a
              key={s.label}
              href={s.href}
              aria-current={s.active ? 'page' : undefined}
              aria-disabled={!s.href && !s.active}
              className={`relative flex items-center px-4 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 ${
                s.active ? 'text-ink font-[600]' : s.href ? 'text-inkSoft hover:text-ink' : 'text-inkSoft opacity-40 cursor-not-allowed'
              }`}
            >
              {s.label}
              {s.active && <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-ink" />}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <ConnectionChip
            identity={session.name}
            onDisconnect={() =>
              leave(() => {
                signOut();
                clearSharedConnection();
                setStart({ config, session: null });
              })
            }
          />
          <button
            onClick={toggleTheme}
            className="w-11 h-11 md:w-8 md:h-8 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0">{shareUrl !== null ? <SharePage key={shareUrl} session={session} url={shareUrl} endpoint={config.endpoint} simple={simple} /> : cardId ? <CardPage key={cardId} session={session} cardId={cardId} simple={simple} /> : <CardList session={session} />}</div>
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
    </div>
  );
}

function CardPage({ session, cardId, simple }: { session: Session; cardId: string; simple: boolean }) {
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
  return <CardScreen session={session} about={state.about} species={state.species} card={state.card} simple={simple} />;
}

/** One tagging state per open card, whichever screen shows it. */
export function CardScreen({ session, about, species, card, simple }: { session: Session; about: About; species: Species[]; card: Card; simple: boolean }) {
  const tagging = useTagging(session, about, card);
  const title = cardTitle(card.deployment);
  return simple ? (
    <SimpleTag session={session} species={species} card={card} title={title} tagging={tagging} />
  ) : (
    <Tag species={species} card={card} title={title} tagging={tagging} />
  );
}

function Leaving({ failed, onRetry, onLeave }: { failed: boolean; onRetry: () => void; onLeave: () => void }) {
  if (!failed)
    return (
      <Dialog label="Saving" onClose={() => {}}>
        <p role="status" className="px-5 py-6 text-[15px] text-center text-inkSoft">
          Saving…
        </p>
      </Dialog>
    );
  return (
    <Dialog label="Not saved" onClose={onRetry}>
      <p role="alert" className="px-5 pt-5 text-[15px] text-warn">
        We couldn't save your latest tags; this browser keeps them and saves them when you next open this card.
      </p>
      <div className="flex justify-end gap-3 p-5">
        <button onClick={onRetry} className="min-h-11 md:min-h-8 px-4 border border-ink bg-ink text-paper text-[14px]">
          Try again
        </button>
        <button onClick={onLeave} className="min-h-11 md:min-h-8 px-4 border border-rule text-[14px]">
          Leave anyway
        </button>
      </div>
    </Dialog>
  );
}

export function Message({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="h-full grid place-content-center justify-items-center gap-4 p-8 bg-paper">
      {!warn && <PawStamp />}
      <p
        role={warn ? 'alert' : 'status'}
        className={`font-body text-[14px] max-w-[36rem] text-center ${warn ? 'text-warn' : 'text-inkSoft'}`}
      >
        {children}
      </p>
    </div>
  );
}
