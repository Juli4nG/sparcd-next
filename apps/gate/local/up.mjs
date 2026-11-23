// Start MinIO, the gate and Caddy in the background on one origin,
// http://localhost:8080, then seed the settings bucket and the demo people.
// Secrets live in ~/.secrets/sparcd-next-local.env and are never printed.
// `node local/down.mjs` stops all three.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { AwsClient } from 'aws4fetch';

import { ensureBins, binPath } from './bins.mjs';
import { openAdmin } from '../cli.mjs';

const GATE_DIR = resolve(import.meta.dirname, '..');
const REPO = resolve(GATE_DIR, '../..');
const RUN = join(import.meta.dirname, 'run');
const PIDS = join(RUN, 'pids.json');
const DATA = process.env.SPARCD_LOCAL_DATA ?? join(homedir(), 'avante-media', 'sparcd-next', 'local', 'minio');
export const SECRETS = join(homedir(), '.secrets', 'sparcd-next-local.env');
export const ORIGIN = 'http://localhost:8080';
const DEMO = [['ana', 'Ana'], ['ben', 'Ben']];

// The front, its 127.0.0.1 spelling, the gate itself, and the ports Vite dev
// servers pick, since a dev server proxies with its own Host.
const ALLOWED_HOSTS = 'localhost:8080,127.0.0.1:8080,127.0.0.1:8787,'
  + 'localhost:5191,localhost:5192,localhost:5173,localhost:5174,localhost:5175,localhost:5176';

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

function readSecrets() {
  return existsSync(SECRETS) ? parseEnv(readFileSync(SECRETS, 'utf8')) : {};
}

function writeSecrets(values) {
  mkdirSync(dirname(SECRETS), { recursive: true });
  const text = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  writeFileSync(SECRETS, `${text}\n`, { mode: 0o600 });
}

function start(name, command, args, env) {
  const log = openSync(join(RUN, `${name}.log`), 'a');
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function waitFor(name, url, init) {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url, { ...init, signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not come up; see ${join(RUN, `${name}.log`)}`);
}

/** The gate's environment on the local stack; `openAdmin(localGateEnv())` manages people there. */
export function localGateEnv(secrets = readSecrets()) {
  return {
    UPSTREAM: 'http://127.0.0.1:9000',
    S3_ACCESS_KEY_ID: secrets.MINIO_ROOT_USER,
    S3_SECRET_ACCESS_KEY: secrets.MINIO_ROOT_PASSWORD,
    ACCESS_MASTER_KEY: secrets.ACCESS_MASTER_KEY,
    // Local MinIO runs without TLS, and storage refuses customer keys over plain HTTP.
    DATA_KEY: 'none',
    ALLOWED_HOSTS,
  };
}

async function main() {
  mkdirSync(RUN, { recursive: true });
  if (existsSync(PIDS) && Object.values(JSON.parse(readFileSync(PIDS, 'utf8'))).some(alive)) {
    throw new Error('already running; `node local/down.mjs` first');
  }
  await ensureBins();
  mkdirSync(DATA, { recursive: true });

  const secrets = readSecrets();
  secrets.MINIO_ROOT_USER ??= 'sparcdlocal';
  secrets.MINIO_ROOT_PASSWORD ??= randomBytes(24).toString('base64url');
  secrets.ACCESS_MASTER_KEY ??= randomBytes(32).toString('base64');
  writeSecrets(secrets);

  const gateEnv = localGateEnv(secrets);
  const pids = {};
  const record = () => writeFileSync(PIDS, JSON.stringify(pids));

  pids.minio = start('minio', binPath('minio'),
    ['server', DATA, '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001'],
    { MINIO_ROOT_USER: secrets.MINIO_ROOT_USER, MINIO_ROOT_PASSWORD: secrets.MINIO_ROOT_PASSWORD });
  record();
  await waitFor('minio', 'http://127.0.0.1:9000/minio/health/ready');

  const admin = openAdmin(gateEnv);
  await admin.init();
  await admin.putSettings(['lab.json', 'sites.csv', 'species.json']
    .map((f) => join(GATE_DIR, 'settings-example', f)));
  const existing = new Set((await admin.list()).map((p) => p.code));
  for (const [code, name] of DEMO) {
    const field = `${code.toUpperCase()}_PASSWORD`;
    if (!existing.has(code)) secrets[field] = await admin.add(code, name);
    else if (!secrets[field]) secrets[field] = await admin.password(code);
  }
  writeSecrets(secrets);

  pids.gate = start('gate', process.execPath, [join(GATE_DIR, 'server.mjs')], gateEnv);
  record();
  await waitFor('gate', 'http://127.0.0.1:8787/-/health');

  pids.caddy = start('caddy', binPath('caddy'),
    ['run', '--config', join(import.meta.dirname, 'Caddyfile.local'), '--adapter', 'caddyfile'],
    { SPARCD_REPO: REPO.replaceAll('\\', '/') });
  record();

  const ana = new AwsClient({
    accessKeyId: 'ana', secretAccessKey: secrets.ANA_PASSWORD, service: 's3', region: 'us-east-1',
  });
  await waitFor('caddy', `${ORIGIN}/-/health`);
  // The gate refuses UNSIGNED-PAYLOAD, which aws4fetch declares by default.
  const whoami = await ana.fetch(`${ORIGIN}/-/whoami`, {
    headers: { 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  });
  if (!whoami.ok) throw new Error(`whoami as ana → ${whoami.status}`);

  process.stdout.write(`up: ${ORIGIN}  (MinIO data ${DATA})\n`
    + `whoami as ana: ${JSON.stringify(await whoami.json())}\n`
    + `logins ana, ben; passwords in ${SECRETS}\n`
    + `logs in ${RUN}; stop with \`node local/down.mjs\`\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`local up failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}
