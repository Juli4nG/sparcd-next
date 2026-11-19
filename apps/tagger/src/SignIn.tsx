import { useState } from 'react';
import { S3Error, signIn, type Config, type Session } from '@sparcd/bucket';

const field =
  'w-full bg-paper border border-rule px-3 py-3 text-[18px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export function SignIn({ config, onSignedIn }: { config: Config; onSignedIn: (session: Session) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await signIn(config, login, password));
    } catch (err) {
      setError(
        err instanceof S3Error && err.status === 403
          ? "That login name or password didn't work. Check them and try again."
          : "We couldn't reach the server. Check your internet connection and try again.",
      );
      setBusy(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-[440px] bg-panel border border-rule p-8 space-y-5">
        <h1 className="font-display text-[32px] font-[600] text-ink">Sign in to tag photos</h1>
        <label className="block space-y-1.5">
          <span className="block text-[18px] text-inkSoft">Login name</span>
          <input className={field} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-[18px] text-inkSoft">Password</span>
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <p role="alert" className="min-h-[1.5em] text-[17px] text-warn">
          {error}
        </p>
        <button type="submit" disabled={busy} className="w-full min-h-14 bg-ink text-paper text-[19px] font-[600] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
