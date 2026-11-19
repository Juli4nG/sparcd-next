import { create } from 'zustand';
import {
  S3Error,
  loadConfig,
  parseLab,
  parseSites,
  restoreSession,
  signIn,
  signOut,
  type Lab,
  type Session,
  type Bucket,
  type Site,
} from '@sparcd/bucket';
import type { ConnectionProbeResult, S3Config } from '@sparcd/types';
import { useStore } from '../store';

type NextState = {
  session: Session | null;
  lab: Lab | null;
  sites: Site[] | null;
  settingsError: string | null;
};

export const useNext = create<NextState>(() => ({ session: null, lab: null, sites: null, settingsError: null }));

async function loadSettings(session: Session) {
  useNext.setState({ lab: null, sites: null, settingsError: null });
  try {
    const [lab, sites] = await Promise.all([session.settings.getText('lab.json'), session.settings.getText('sites.csv')]);
    useNext.setState({ lab: parseLab(lab!), sites: parseSites(sites!) });
  } catch {
    useNext.setState({ settingsError: "The list of sites couldn't be loaded. Check your internet and reload the page." });
  }
}

// The same gate answers on these ports too. A browser opens more connections
// to more origins, so photos go up in parallel, as with the old Uploader.
const SHARD_PORTS = [8443, 8444, 8445, 8446, 8447, 8448, 8449];
const SHARD_WAIT_MS = 5000;

/**
 * The person's bucket on the page's own origin plus each upload shard that
 * answers. A port blocked on the volunteer's network is left out, so sending
 * never waits on it.
 */
export async function uploadBuckets(session: Session): Promise<Bucket[]> {
  const { login, password } = JSON.parse(sessionStorage.getItem('sparcd-next.signin')!) as { login: string; password: string };
  const shard = (port: number) =>
    Promise.race([
      signIn({ gate: true, endpoint: `https://${location.hostname}:${port}`, region: 'us-east-1' }, login, password).then((s) => s.bucket),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SHARD_WAIT_MS)),
    ]).catch(() => null);
  const shards = await Promise.all(SHARD_PORTS.map(shard));
  return [session.bucket, ...shards.filter((b): b is Bucket => b !== null)];
}

function adopt(session: Session) {
  useNext.setState({ session });
  void loadSettings(session);
}

/** The sign-in screen's credential check: the access key is the login name, the secret is the password. */
export async function checkSignIn(config: S3Config): Promise<ConnectionProbeResult> {
  try {
    adopt(await signIn(await loadConfig(), config.accessKey, config.secretKey));
    return { ok: true };
  } catch (err) {
    if (err instanceof S3Error && (err.status === 403 || err.status === 401)) return { ok: false, category: 'credentials-rejected' };
    if (err instanceof S3Error) return { ok: false, category: 'unexpected', detail: `HTTP ${err.status}` };
    return { ok: false, category: 'unreachable' };
  }
}

/** A reload keeps the old store's connection; bring the storage session back with it, or sign out. */
export async function resumeSession() {
  if (useNext.getState().session || !useStore.getState().s3Config) return;
  const session = await restoreSession(await loadConfig()).catch(() => null);
  if (session) adopt(session);
  else useStore.getState().disconnect();
}

useStore.subscribe((s, prev) => {
  if (prev.s3Config && !s.s3Config) {
    signOut();
    useNext.setState({ session: null, lab: null, sites: null, settingsError: null });
  }
});
