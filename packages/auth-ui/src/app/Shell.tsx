import { useEffect, useState, type ReactNode } from 'react';
import { loadConfig, restoreSession, signOut, type Config, type Session } from '@sparcd/bucket';
import { BrandSwitcher } from '../BrandSwitcher';
import { ConnectionChip } from '../ConnectionChip';
import { clearSharedConnection, loadSessionConnection, subscribeSharedConnection } from '../session';
import { loadSharedTheme, saveSharedTheme, type Theme } from '../theme';
import { GateSignIn } from './GateSignIn';
import { PawStamp } from './Paw';
import { focusRing } from './look';

loadSessionConnection();

export const START_URL = '/';
export const UPLOAD_URL = '/upload/';
export const TAG_URL = '/tag/';
const TOOLS = [
  { name: 'Start', href: START_URL },
  { name: 'Uploader', href: UPLOAD_URL },
  { name: 'Tagger', href: TAG_URL },
];

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

/**
 * Sign-in, then the header and the app. The sign-in lives in this tab's
 * sessionStorage, so it carries between the Uploader and the Tagger.
 * `beforeSignOut` lets an app finish its work first; `busy` blocks signing out.
 */
export function Shell({
  toolName,
  busy,
  beforeSignOut = (go) => go(),
  children,
}: {
  toolName: string;
  busy?: boolean;
  beforeSignOut?: (go: () => void) => void;
  children: (session: Session) => ReactNode;
}) {
  const [start, setStart] = useState<Start | null>(null);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    loadConfig()
      .then(async (config) => setStart({ config, session: await restoreSession(config) }))
      .catch(() => setStart({ failed: true }));
    // Logging out in one tab logs out every open tab, including duplicates that copied this one's sign-in.
    return subscribeSharedConnection((cfg) => {
      if (cfg) return;
      signOut();
      setStart((s) => (s && 'config' in s ? { config: s.config, session: null } : s));
    }, () => null);
  }, []);

  if (!start) return <Message>Loading…</Message>;
  if ('failed' in start)
    return <Message warn>We couldn't reach the server. Check your internet connection, then reload the page.</Message>;
  const { config, session } = start;
  if (!session) return <GateSignIn config={config} toolName={toolName} onSignedIn={(s) => setStart({ config, session: s })} />;

  const signOutNow = () =>
    beforeSignOut(() => {
      signOut();
      clearSharedConnection();
      location.hash = '';
      setStart({ config, session: null });
    });

  return (
    <div className="h-[100dvh] flex flex-col bg-paper">
      <header className="h-16 shrink-0 bg-panel border-b border-rule flex items-center gap-3 px-4 sm:gap-4 sm:px-5">
        <BrandSwitcher toolName={toolName} tools={TOOLS} />
        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <ConnectionChip
            identity={session.name}
            onDisconnect={signOutNow}
            disconnectDisabled={busy}
            disconnectExplanation="Wait until your photos are uploaded."
          />
          <button
            onClick={toggleTheme}
            className={`shrink-0 w-11 h-11 sm:w-12 sm:h-12 grid place-items-center border border-rule text-body text-inkSoft hover:text-ink ${focusRing}`}
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0">{children(session)}</div>
    </div>
  );
}

export function Message({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className="h-full grid place-content-center justify-items-center gap-5 p-8 bg-paper">
      {!warn && <PawStamp />}
      <p role={warn ? 'alert' : 'status'} className={`text-body max-w-[36rem] text-center ${warn ? 'text-warn' : 'text-inkSoft'}`}>
        {children}
      </p>
    </div>
  );
}
