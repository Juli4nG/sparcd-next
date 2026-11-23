// MinIO and Caddy for the local recipe, downloaded once into local/bin/ and
// checked against the hashes their releases publish. MinIO no longer ships
// binaries, so this is the pgsty community build the old access tests pinned.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const BIN = join(import.meta.dirname, 'bin');
const exe = process.platform === 'win32' ? '.exe' : '';

const MINIO = 'https://github.com/pgsty/silo/releases/download/RELEASE.2026-08-04T00-00-00Z/minio_20260804000000.0.0_';
const CADDY = 'https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_';

const RELEASES = {
  'win32-x64': {
    minio: { url: `${MINIO}windows_amd64.tar.gz`, sha256: 'c2160a4ccbb80ce1d45f69cc35137cb5ba68f638cc2f86ebfb3d0523ce3e0d74' },
    caddy: { url: `${CADDY}windows_amd64.zip`, sha512: '98753d5d42650383d00619ac70917a217141f9e92314185bf6c1b8b439cfcfdf8393da0ebb4675c8cb3b23d29a19aabe99dc5aca64fa1bfc3a1ba22509b06871' },
  },
  'linux-x64': {
    minio: { url: `${MINIO}linux_amd64.tar.gz`, sha256: '3c1d229209db049618cb9c6d4132fa2882b15cdded337511486e811c187eec08' },
    caddy: { url: `${CADDY}linux_amd64.tar.gz`, sha512: '0e85544340290a16ce4bfb76fe7d65e9de1bf3a6e67f5ccfff30b30d27ea4c73e078077b7bf3e58ae60b6b12e44327705287059c775bca5782e8ee85ea7edd75' },
  },
  'darwin-arm64': {
    minio: { url: `${MINIO}darwin_arm64.tar.gz`, sha256: 'a1965c422ec9ca80068bcd2c2c115655748283916256cebd75c171cc629ade6e' },
    caddy: { url: `${CADDY}mac_arm64.tar.gz`, sha512: '166a8fdd183dc597ebe3a12d71e2e8eb313ab673ae8d3e286cb92bb0078d04233c23347543f7d7e8285b44136416e6718b0d106afe973de8ede4d81b6809c6bb' },
  },
};

export const binPath = (name) => join(BIN, `${name}${exe}`);

async function fetchOne(name, { url, ...hash }) {
  const [algo, expected] = Object.entries(hash)[0];
  process.stderr.write(`downloading ${name} from ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash(algo).update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`${name}: ${algo} mismatch, got ${actual}`);
  // Its own empty folder, so nothing else in the archive lands next to the bins.
  const dir = mkdtempSync(join(BIN, `.${name}-`));
  const archive = join(dir, url.split('/').pop());
  writeFileSync(archive, bytes);
  // Windows' own bsdtar reads zip; Git Bash's GNU tar, often first on PATH, does not.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', dir, `${name}${exe}`]);
  renameSync(join(dir, `${name}${exe}`), binPath(name));
  rmSync(dir, { recursive: true });
}

export async function ensureBins() {
  const release = RELEASES[`${process.platform}-${process.arch}`];
  if (!release) throw new Error(`no pinned binaries for ${process.platform}-${process.arch}`);
  mkdirSync(BIN, { recursive: true });
  for (const name of ['minio', 'caddy']) {
    if (!existsSync(binPath(name))) await fetchOne(name, release[name]);
  }
}

if (import.meta.main) await ensureBins();
