import { useEffect, useState, type ReactNode } from 'react';
import {
  BrandSwitcher,
  ConnectionChip,
  clearSharedConnection,
  loadSessionConnection,
  loadSharedTheme,
  saveSharedTheme,
  type Theme,
} from '@sparcd/auth-ui';
import {
  loadConfig,
  parseLab,
  parseSites,
  restoreSession,
  signOut,
  type Config,
  type Lab,
  type Session,
  type Site,
} from '@sparcd/bucket';
import type { CardFile } from './lib/scan';
import type { Outcome } from './lib/send';
import { CardsSent } from './screens/CardsSent';
import { ChooseCard } from './screens/ChooseCard';
import { Describe, today } from './screens/Describe';
import { Done } from './screens/Done';
import { Send } from './screens/Send';
import { GateSignIn } from './ui/GateSignIn';
import { StatePill, type UploadState } from './ui/StatePill';
import { StepIndicator, type WizardStep } from './ui/StepIndicator';

type Step = 'card' | 'describe' | 'send' | 'done';
type Section = 'new' | 'history';
type Settings = { lab: Lab; sites: Site[] };

const WIZARD: Record<Step, WizardStep | undefined> = { card: 'drop', describe: 'assign', send: 'upload', done: undefined };

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'new', label: 'New upload' },
  { id: 'history', label: 'History' },
];

async function loadSettings(session: Session): Promise<Settings> {
  const [lab, sites] = await Promise.all([session.settings.getText('lab.json'), session.settings.getText('sites.csv')]);
  return { lab: parseLab(lab!), sites: parseSites(sites!) };
}

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

export function App() {
  const [config, setConfig] = useState<Config>();
  const [session, setSession] = useState<Session | null>();
  const [settings, setSettings] = useState<Settings>();
  const [problem, setProblem] = useState<string>();
  const [section, setSection] = useState<Section>('new');
  const [step, setStep] = useState<Step>('card');
  const [site, setSite] = useState<Site>();
  const [date, setDate] = useState(today);
  const [card, setCard] = useState<CardFile[]>([]);
  const [outcome, setOutcome] = useState<Outcome>();
  const [failed, setFailed] = useState(false);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    loadConfig()
      .then(async (c) => {
        setConfig(c);
        setSession(await restoreSession(c));
      })
      .catch(() => setProblem("This page couldn't reach the server. Check your internet and reload the page."));
  }, []);

  useEffect(() => {
    if (!session) return;
    setSettings(undefined);
    loadSettings(session).then(setSettings, () =>
      setProblem("The list of sites couldn't be loaded. Check your internet and reload the page."),
    );
  }, [session]);

  const startOver = () => {
    setCard([]);
    setOutcome(undefined);
    setDate(today());
    setStep('card');
    setSection('new');
  };

  const leave = () => {
    signOut();
    clearSharedConnection();
    setSession(null);
    startOver();
  };

  if (problem)
    return (
      <Centered>
        <p className="font-body text-[14px] text-warn">{problem}</p>
      </Centered>
    );
  if (session === undefined || !config)
    return (
      <Centered>
        <p className="font-body text-[14px] text-inkSoft">Loading…</p>
      </Centered>
    );
  if (session === null) return <GateSignIn config={config} toolName="Uploader" onSignedIn={setSession} />;

  const sending = section === 'new' && step === 'send';
  const uploadState: UploadState = sending ? (failed ? 'failed' : 'uploading') : step === 'done' ? 'complete' : 'ready';

  let body: ReactNode;
  if (!settings) body = <p className="font-body text-[14px] text-inkSoft">Loading…</p>;
  else if (section === 'history') body = <CardsSent session={session} sites={settings.sites} />;
  else if (step === 'card')
    body = <ChooseCard card={card} onCard={setCard} onNext={() => setStep('describe')} />;
  else if (step === 'describe')
    body = (
      <Describe
        sites={settings.sites}
        site={site}
        date={date}
        onBack={() => setStep('card')}
        onNext={(s, d) => (setSite(s), setDate(d), setFailed(false), setStep('send'))}
      />
    );
  else if (step === 'send')
    body = (
      <Send
        session={session}
        lab={settings.lab}
        site={site!}
        date={date}
        card={card}
        onFailed={setFailed}
        onDone={(o) => (setOutcome(o), setStep('done'))}
        onSignIn={() => (signOut(), clearSharedConnection(), setSession(null), setStep('describe'))}
      />
    );
  else body = <Done outcome={outcome!} site={site!} onAnother={startOver} />;

  return (
    <div className="min-h-[100svh] flex flex-col bg-paper">
      <header className="min-h-14 shrink-0 bg-panel border-b border-rule flex flex-wrap items-center gap-y-2 py-2 px-4 md:h-14 md:flex-nowrap md:items-stretch md:py-0">
        <div className="flex items-center pr-6">
          <BrandSwitcher toolName="Uploader" />
        </div>

        {!sending && (
          <>
            <select
              aria-label="Section"
              value={section}
              onChange={(e) => setSection(e.target.value as Section)}
              className="md:hidden min-h-11 bg-panel text-ink text-[14px] font-body border border-rule px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <nav className="hidden md:flex items-stretch" aria-label="Sections">
              {SECTIONS.map((s) => {
                const active = s.id === section;
                return (
                  <button
                    key={s.id}
                    onClick={() => (s.id === 'new' && step === 'done' ? startOver() : setSection(s.id))}
                    aria-current={active ? 'page' : undefined}
                    className={`relative px-4 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 ${
                      active ? 'text-ink font-[600]' : 'text-inkSoft hover:text-ink'
                    }`}
                  >
                    {s.label}
                    {active && <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-ink" />}
                  </button>
                );
              })}
            </nav>
          </>
        )}

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
          <StatePill state={uploadState} />
          <ConnectionChip identity={session.name} onDisconnect={leave} disconnectDisabled={sending} />
          <button
            onClick={toggleTheme}
            className="w-11 h-11 sm:w-8 sm:h-8 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <div className="px-6 py-6">
          {section === 'new' && WIZARD[step] && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <StepIndicator current={WIZARD[step]!} />
            </div>
          )}
          {body}
        </div>
      </main>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-[100svh] bg-paper grid place-items-center p-6">{children}</div>;
}
