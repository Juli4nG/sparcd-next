import { useState, type FormEvent } from 'react';
import { S3Error, signIn, type Config, type Session } from '@sparcd/bucket';

export function SignIn({ config, onSignedIn }: { config: Config; onSignedIn: (s: Session) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSignedIn(await signIn(config, login, password));
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof S3Error && err.status === 403
          ? "That name and password didn't match. Check them and try again."
          : "Couldn't reach the server. Check your internet and try again.",
      );
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      <label className="field">
        Login name
        <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" required />
      </label>
      <label className="field">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <p className="error" role="alert">
        {error}
      </p>
      <div className="actions">
        <span />
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}
