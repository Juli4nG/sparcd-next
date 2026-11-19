import { useEffect, useState } from 'react';
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
import { CardDate, today } from './screens/CardDate';
import { Done } from './screens/Done';
import { Send } from './screens/Send';
import { SignIn } from './screens/SignIn';
import { SitePicker } from './screens/SitePicker';

type Step = 'site' | 'date' | 'card' | 'send' | 'done' | 'cards';
type Settings = { lab: Lab; sites: Site[] };

const STEP_NUMBER: Partial<Record<Step, number>> = { site: 2, date: 3, card: 4, send: 5 };

async function loadSettings(session: Session): Promise<Settings> {
  const [lab, sites] = await Promise.all([session.settings.getText('lab.json'), session.settings.getText('sites.csv')]);
  return { lab: parseLab(lab!), sites: parseSites(sites!) };
}

export function App() {
  const [config, setConfig] = useState<Config>();
  const [session, setSession] = useState<Session | null>();
  const [settings, setSettings] = useState<Settings>();
  const [problem, setProblem] = useState<string>();
  const [step, setStep] = useState<Step>('site');
  const [back, setBack] = useState<Step>('site');
  const [site, setSite] = useState<Site>();
  const [date, setDate] = useState(today);
  const [card, setCard] = useState<CardFile[]>([]);
  const [outcome, setOutcome] = useState<Outcome>();

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
    setStep('site');
  };

  const leave = () => {
    signOut();
    setSession(null);
    startOver();
  };

  let body;
  if (problem) body = <p className="error">{problem}</p>;
  else if (session === undefined || !config) body = <p className="quiet">Loading…</p>;
  else if (session === null) body = <SignIn config={config} onSignedIn={setSession} />;
  else if (!settings) body = <p className="quiet">Loading…</p>;
  else if (step === 'site')
    body = <SitePicker sites={settings.sites} value={site} onNext={(s) => (setSite(s), setStep('date'))} />;
  else if (step === 'date')
    body = <CardDate value={date} onBack={() => setStep('site')} onNext={(d) => (setDate(d), setStep('card'))} />;
  else if (step === 'card')
    body = (
      <ChooseCard
        card={card}
        onCard={setCard}
        onBack={() => setStep('date')}
        onNext={() => setStep('send')}
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
        onDone={(o) => (setOutcome(o), setStep('done'))}
        onSignIn={() => (signOut(), setSession(null), setStep('card'))}
      />
    );
  else if (step === 'done') body = <Done outcome={outcome!} onAnother={startOver} />;
  else body = <CardsSent session={session} sites={settings.sites} onBack={() => setStep(back)} />;

  const sending = step === 'send';
  return (
    <div className="app">
      <header className="top">
        <span className="brand">Send photos</span>
        {session && !sending && (
          <nav>
            {step !== 'cards' && (
              <button className="link" onClick={() => (setBack(step === 'done' ? 'site' : step), setStep('cards'))}>
                Cards sent
              </button>
            )}
            <button className="link" onClick={leave}>
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="panel">
        {session && STEP_NUMBER[step] && <p className="step">Step {STEP_NUMBER[step]} of 5</p>}
        {!session && session !== undefined && <p className="step">Step 1 of 5</p>}
        {body}
      </main>
    </div>
  );
}
