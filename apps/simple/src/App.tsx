import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ConnectionChip,
  clearSharedConnection,
  loadSessionConnection,
  loadSharedTheme,
  saveSharedTheme,
  type Theme,
} from '@sparcd/auth-ui';
import { loadConfig, restoreSession, signOut, type About, type Config, type Session, type Species } from '@sparcd/bucket';
import logo from '../../../packages/auth-ui/src/assets/sparcd.png';
import { loadCard, loadSettings, type Card } from './data/card';
import { saveEverything, unsavedEdits, useTagging } from './data/useTagging';
import { cardTitle } from './dates';
import { Home } from './Home';
import { SendFlow } from './SendFlow';
import { SimpleTag } from './tag/Simple';
import { Dialog } from './ui/Dialog';
import { GateSignIn } from './ui/GateSignIn';
import { PawStamp } from './ui/Paw';
import { focusRing } from './ui/look';

loadSessionConnection();

export const TOOL_NAME = 'Camera traps';

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

/** '' is home, '#send' sends a card, '#card=<id>' tags one. The hash keeps the place on reload. */
type Route = { page: 'home' } | { page: 'send' } | { page: 'card'; id: string };

function routeFromHash(): Route {
  const card = /[#&]card=([^&]+)/.exec(location.hash);
  if (card) return { page: 'card', id: decodeURIComponent(card[1]) };
  if (location.hash === '#send') return { page: 'send' };
  return { page: 'home' };
}

export function App() {
  const [start, setStart] = useState<Start | null>(null);
  const [route, setRoute] = useState(routeFromHash);
  const [sending, setSending] = useState(false);
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

  useEffect(() => {
    loadConfig()
      .then(async (config) => setStart({ config, session: await restoreSession(config) }))
      .catch(() => setStart({ failed: true }));
    const onHash = () => void leaveRef.current(() => setRoute(routeFromHash()));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => window.scrollTo(0, 0), [route]);

  if (!start) return <Message>Loading…</Message>;
  if ('failed' in start)
    return <Message warn>We couldn't reach the server. Check your internet connection, then reload the page.</Message>;
  const { config, session } = start;
  if (!session) return <GateSignIn config={config} toolName={TOOL_NAME} onSignedIn={(s) => setStart({ config, session: s })} />;

  const signOutNow = () =>
    leave(() => {
      signOut();
      clearSharedConnection();
      location.hash = '';
      setStart({ config, session: null });
    });

  return (
    <div className="h-[100dvh] flex flex-col bg-paper">
      <header className="h-16 shrink-0 bg-panel border-b border-rule flex items-center gap-4 px-5">
        <a
          href="#"
          onClick={(e) => sending && e.preventDefault()}
          aria-label="Start"
          className={`flex items-center gap-2.5 px-1.5 py-1 text-ink ${sending ? 'cursor-default' : 'hover:bg-paperHover'} ${focusRing}`}
        >
          <img src={logo} alt="" className="h-8 w-auto" />
          <span className="font-display text-[24px] font-[600] leading-none whitespace-nowrap">SPARC'd</span>
        </a>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <ConnectionChip
            identity={session.name}
            onDisconnect={signOutNow}
            disconnectDisabled={sending}
            disconnectExplanation="Wait until your photos are sent."
          />
          <button
            onClick={toggleTheme}
            className={`w-12 h-12 grid place-items-center border border-rule text-[20px] text-inkSoft hover:text-ink ${focusRing}`}
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        {route.page === 'card' ? (
          <CardPage key={route.id} session={session} cardId={route.id} />
        ) : route.page === 'send' ? (
          <SendFlow session={session} onSending={setSending} />
        ) : (
          <Home session={session} />
        )}
      </div>
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
  return <SimpleTag session={session} species={species} card={card} title={cardTitle(card.deployment)} tagging={tagging} />;
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

export function Message({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className="h-full grid place-content-center justify-items-center gap-5 p-8 bg-paper">
      {!warn && <PawStamp />}
      <p role={warn ? 'alert' : 'status'} className={`text-[20px] max-w-[36rem] text-center ${warn ? 'text-warn' : 'text-inkSoft'}`}>
        {children}
      </p>
    </div>
  );
}
