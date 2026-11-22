import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { openAdmin } from '../apps/gate/cli.mjs';
import { ORIGIN, localGateEnv } from '../apps/gate/local/up.mjs';
import { PERSON_FILE } from './tests/person';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** A fresh person per run, so every run starts from an empty bucket. The password goes only to a gitignored file. */
export default async function globalSetup() {
  try {
    await fetch(`${ORIGIN}/-/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error(`nothing answers on ${ORIGIN}; start it with \`node apps/gate/local/up.mjs\``);
  }
  const code = `e2e${randomBytes(4).toString('hex')}`;
  const password = await openAdmin(localGateEnv()).add(code, 'E2E Tester');
  mkdirSync(dirname(PERSON_FILE), { recursive: true });
  writeFileSync(PERSON_FILE, JSON.stringify({ code, password }), { mode: 0o600 });

  // The gate re-reads people every 5 s; sign-in is refused until it has.
  const aws = new AwsClient({ accessKeyId: code, secretAccessKey: password, service: 's3', region: 'us-east-1' });
  for (let i = 0; i < 40; i++) {
    const res = await aws.fetch(`${ORIGIN}/-/whoami`, { headers: { 'x-amz-content-sha256': EMPTY_SHA } });
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the gate never accepted ${code}`);
}
