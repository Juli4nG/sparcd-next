// People: `access/people/<code>.json` in the settings bucket, with the
// password wrapped under ACCESS_MASTER_KEY. The CLI writes them; the gate
// lists the folder every few seconds and re-reads only what changed.

import { randomBytes, randomInt, webcrypto } from 'node:crypto';

import { ACCESS_PREFIX } from './rules.mjs';
import { WORDS } from './words.mjs';

export const PEOPLE_PREFIX = `${ACCESS_PREFIX}people/`;
export const personKey = (code) => `${PEOPLE_PREFIX}${code}.json`;

/** Four common words, about 41 bits from a list of 1,400. */
export function newPassword() {
  return Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join('-');
}

export function loadMasterKey(base64) {
  const raw = Buffer.from(String(base64 ?? ''), 'base64');
  if (raw.length !== 32) throw new Error('ACCESS_MASTER_KEY must be 32 bytes, base64');
  return webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** `v1.<iv b64url>.<ciphertext+tag b64url>` */
export async function wrapSecret(masterKey, secret) {
  const iv = randomBytes(12);
  const ct = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, masterKey, Buffer.from(secret, 'utf8'),
  );
  return `v1.${iv.toString('base64url')}.${Buffer.from(ct).toString('base64url')}`;
}

export async function unwrapSecret(masterKey, wrapped) {
  const [version, iv, ct] = String(wrapped ?? '').split('.');
  if (version !== 'v1' || !iv || !ct) throw new Error('unrecognised wrapped secret');
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
    masterKey,
    Buffer.from(ct, 'base64url'),
  );
  return Buffer.from(plain).toString('utf8');
}

/**
 * The gate's view of the people. `fresh()` turns false when the last good
 * refresh is older than `staleMs`; the server then refuses everyone, because a
 * pause it cannot see is a pause it would not honour.
 */
export function makePeople({ upstream, settingsBucket, masterKey, pollMs = 5000, staleMs = 30000 }) {
  const byCode = new Map();
  const unwrapped = new Map();
  let lastOk = 0;
  let timer = null;
  let running = null;

  async function doRefresh() {
    const listed = await upstream.listAll(settingsBucket, PEOPLE_PREFIX);
    const seen = new Set();
    await Promise.all(listed.map(async ({ key, etag }) => {
      const code = /^access\/people\/([a-z][a-z0-9]{1,19})\.json$/.exec(key)?.[1];
      if (!code) return;
      seen.add(code);
      if (byCode.get(code)?.etag === etag) return;
      const got = await upstream.getJson(settingsBucket, key);
      if (got.status === 404) { seen.delete(code); return; }
      byCode.set(code, { person: { ...got.value, code }, etag });
    }));
    for (const code of byCode.keys()) if (!seen.has(code)) byCode.delete(code);
    lastOk = Date.now();
  }

  const refresh = () => {
    running ??= doRefresh().finally(() => { running = null; });
    return running;
  };

  return {
    refresh,
    fresh: () => Date.now() - lastOk <= staleMs,
    get: (code) => byCode.get(code)?.person ?? null,
    async secret(code) {
      const wrapped = byCode.get(code)?.person?.wrappedSecret;
      if (!wrapped) return null;
      if (!unwrapped.has(wrapped)) unwrapped.set(wrapped, await unwrapSecret(masterKey, wrapped));
      return unwrapped.get(wrapped);
    },
    start(log) {
      timer ??= setInterval(() => { refresh().catch((err) => log('people refresh failed', err)); }, pollMs);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
