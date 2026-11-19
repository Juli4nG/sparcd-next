import '../../../packages/auth-ui/src/offline-fonts.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { restore } from './lib/next';
import { useStore } from './store';
import './index.css';

const queryClient = new QueryClient();

// SPARC'd Next: sign back in from this tab's session before the first render,
// so every storage call below has a session.
void restore().then((ok) => {
  if (!ok && useStore.getState().s3Config) useStore.setState({ s3Config: null });
  render();
});

const render = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
