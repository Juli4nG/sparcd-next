import { useEffect, useState } from 'react';
import { Shell } from '@sparcd/auth-ui';
import { Home } from './Home';
import { SendFlow } from './SendFlow';

/** '' is the start, '#send' uploads a folder. The hash keeps the place on reload. */
export function App() {
  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash]);
  return (
    <Shell toolName="Uploader" busy={sending}>
      {(session) => (hash === '#send' ? <SendFlow session={session} onSending={setSending} /> : <Home session={session} />)}
    </Shell>
  );
}
