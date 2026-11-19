#!/usr/bin/env node
// Lab admin commands, run with the gate's environment:
//   node --env-file=/etc/sparcd-next/gate.env cli.mjs <command>
// A new password is the only thing written to stdout; everything else goes to
// stderr. Nothing here deletes a bucket or an object.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { configFromEnv, withDefaults } from './server.mjs';
import { makeGuard } from './namespace.mjs';
import { makeUpstream, loadDataKey, normalizeIfMatch } from './upstream.mjs';
import { ownBucket, PERSON_CODE, RESERVED_CODES } from './rules.mjs';
import {
  PEOPLE_PREFIX, personKey, newPassword, loadMasterKey, wrapSecret,
} from './people.mjs';

const SETTINGS_FILES = {
  'lab.json': 'application/json',
  'sites.csv': 'text/csv; charset=utf-8',
  'species.json': 'application/json',
};

// Jetstream2 answers 429 to bursts; wait and try again rather than stop.
async function patient(call) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await call();
    if (![429, 503].includes(res.status) || attempt === 8) return res;
    await res.arrayBuffer();
    await new Promise((resolve) => { setTimeout(resolve, 1000 * attempt); });
  }
}

// Headers an object keeps when encrypt-stored rewrites it.
const KEEP_ON_REWRITE = new Set([
  'content-type', 'content-disposition', 'content-language', 'cache-control', 'expires',
]);

const USAGE = `usage: node cli.mjs <command>
  init                       create the settings bucket if missing
  add <code> --name "Ana"    create sparcd-next-<code> and the person; prints the password once
  password <code>            set a new password; prints it once
  pause <code>               stop access (the bucket is untouched)
  resume <code>              restore access
  list                       code, name, status
  settings put <file>...     upload lab.json, sites.csv or species.json
  encrypt-stored             encrypt files stored before DATA_KEY was set (safe to repeat)`;

export function openAdmin(env = process.env) {
  const config = withDefaults(configFromEnv(env));
  const inNamespace = makeGuard(config.allow);
  if (!inNamespace(config.settingsBucket)) throw new Error('SETTINGS_BUCKET is outside BUCKET_ALLOW');
  const credentials = {
    endpoint: config.upstream,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  const dataKey = loadDataKey(config.dataKey);
  const upstream = makeUpstream({ ...credentials, dataKey });
  const settings = config.settingsBucket;
  const guarded = (bucket) => {
    if (!inNamespace(bucket)) throw new Error(`${bucket} is outside BUCKET_ALLOW`);
    return bucket;
  };
  const checkCode = (code) => {
    if (!PERSON_CODE.test(code ?? '') || RESERVED_CODES.has(code)) {
      throw new Error('a person code is 2-20 lowercase letters and digits, starting with a letter, '
        + `and not one of ${[...RESERVED_CODES].join(', ')}`);
    }
    return code;
  };

  async function readPerson(code) {
    const got = await upstream.getJson(guarded(settings), personKey(checkCode(code)));
    if (got.status === 404) throw new Error(`no person ${code}`);
    return got;
  }

  async function update(code, change) {
    const { value, etag } = await readPerson(code);
    const next = { ...value, ...(await change(value)), updatedAt: new Date().toISOString() };
    if (!await upstream.put(settings, personKey(code), JSON.stringify(next), { ifMatch: etag })) {
      throw new Error(`${code} changed underneath this edit; run it again`);
    }
  }

  const wrapped = async (password) => wrapSecret(await loadMasterKey(config.masterKey), password);

  return {
    init: () => upstream.createBucket(guarded(settings)),

    async add(code, name) {
      checkCode(code);
      if (!name?.trim()) throw new Error('--name is required');
      await upstream.createBucket(guarded(ownBucket(code)));
      const password = newPassword();
      const now = new Date().toISOString();
      const person = {
        schemaVersion: 1,
        code,
        name: name.trim(),
        status: 'active',
        wrappedSecret: await wrapped(password),
        createdAt: now,
        updatedAt: now,
      };
      const ok = await upstream.put(guarded(settings), personKey(code), JSON.stringify(person), { ifNoneMatch: '*' });
      if (!ok) throw new Error(`${code} already exists; use \`password ${code}\` for a new password`);
      return password;
    },

    async password(code) {
      const password = newPassword();
      await update(code, async () => ({ wrappedSecret: await wrapped(password) }));
      return password;
    },

    setStatus: (code, status) => update(code, () => ({ status })),

    async list() {
      const keys = await upstream.listAll(guarded(settings), PEOPLE_PREFIX);
      const people = await Promise.all(keys.map(({ key }) => upstream.getJson(settings, key)));
      return people.filter((p) => p.status !== 404).map(({ value: { code, name, status } }) => ({ code, name, status }));
    },

    /**
     * Encrypts every object stored before DATA_KEY was set, in the settings
     * bucket and each person's bucket, in place, keeping its headers. Stop the
     * gate while it runs: If-Match leaves alone a file whose bytes changed, but
     * not a rewrite of identical bytes with new headers. Safe to repeat.
     */
    async encryptStored(say) {
      if (!dataKey) throw new Error('DATA_KEY is "none": there is no key to encrypt with');
      const raw = makeUpstream({ ...credentials, dataKey: null });
      const codes = (await this.list()).map((p) => p.code);
      for (const bucket of [settings, ...codes.map(ownBucket)].map(guarded)) {
        const keys = await upstream.listAll(bucket, '');
        const count = { encrypted: 0, already: 0, changed: 0 };
        let next = 0;
        const lane = async () => {
          while (next < keys.length) {
            const { key } = keys[next++];
            const head = await patient(() => raw.send(raw.url(bucket, key), { method: 'HEAD' }));
            if (head.status === 404) continue;
            // RGW refuses a keyless HEAD of an object stored with a customer
            // key; this key must then read it.
            if (head.status === 400) {
              const keyed = await patient(() => upstream.send(upstream.url(bucket, key), { method: 'HEAD' }));
              if (keyed.ok) { count.already += 1; continue; }
              if (keyed.status === 404) continue;
              throw new Error(`${bucket}/${key} is encrypted with another key (HEAD → ${keyed.status})`);
            }
            if (!head.ok) throw new Error(`HEAD ${bucket}/${key} → ${head.status}`);
            const got = await patient(() => raw.send(raw.url(bucket, key), { headers: { 'accept-encoding': 'identity' } }));
            if (got.status === 404) continue;
            if (!got.ok) throw new Error(`GET ${bucket}/${key} → ${got.status}`);
            // fetch would hand back decoded bytes; nothing in SPARC'd Next stores these.
            if (got.headers.get('content-encoding')) throw new Error(`${bucket}/${key} has a content-encoding; encrypt it by hand`);
            const etag = got.headers.get('etag');
            if (!etag) throw new Error(`GET ${bucket}/${key} returned no ETag`);
            const headers = { 'if-match': normalizeIfMatch(etag) };
            for (const [name, value] of got.headers) {
              if (KEEP_ON_REWRITE.has(name) || name.startsWith('x-amz-meta-')) headers[name] = value;
            }
            const body = Buffer.from(await got.arrayBuffer());
            const put = await patient(() => upstream.send(upstream.url(bucket, key), { method: 'PUT', body, headers }));
            if (put.status === 412) { count.changed += 1; continue; }
            if (!put.ok) throw new Error(`PUT ${bucket}/${key} → ${put.status} ${await put.text()}`);
            count.encrypted += 1;
          }
        };
        await Promise.all(Array.from({ length: 4 }, lane));
        say(`${bucket}: ${count.encrypted} encrypted, ${count.already} already encrypted, ${count.changed} changed meanwhile`);
      }
    },

    async putSettings(files) {
      for (const file of files) {
        const name = basename(file);
        const type = SETTINGS_FILES[name];
        if (!type) throw new Error(`${name}: only ${Object.keys(SETTINGS_FILES).join(', ')}`);
        const bytes = await readFile(file);
        if (name.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
        await upstream.put(guarded(settings), name, bytes, { contentType: type });
      }
    },
  };
}

async function main(argv) {
  const { positionals, values } = parseArgs({
    args: argv, allowPositionals: true, options: { name: { type: 'string' } },
  });
  const [command, ...rest] = positionals;
  const say = (line) => process.stderr.write(`${line}\n`);
  const admin = openAdmin();

  switch (command) {
    case 'init':
      await admin.init();
      say('the settings bucket is ready');
      return;
    case 'add':
      process.stdout.write(`${await admin.add(rest[0], values.name)}\n`);
      say(`added ${rest[0]}; the password above is shown once`);
      return;
    case 'password':
      process.stdout.write(`${await admin.password(rest[0])}\n`);
      say(`new password for ${rest[0]}; shown once`);
      return;
    case 'pause':
    case 'resume':
      await admin.setStatus(rest[0], command === 'pause' ? 'paused' : 'active');
      say(`${rest[0]} is ${command === 'pause' ? 'paused' : 'active'}; the gate sees it within a few seconds`);
      return;
    case 'list':
      for (const p of await admin.list()) process.stdout.write(`${p.code}\t${p.name}\t${p.status}\n`);
      return;
    case 'encrypt-stored':
      await admin.encryptStored(say);
      return;
    case 'settings':
      if (rest[0] !== 'put' || rest.length < 2) break;
      await admin.putSettings(rest.slice(1));
      say(`uploaded ${rest.slice(1).map((f) => basename(f)).join(', ')}`);
      return;
    default:
  }
  say(USAGE);
  process.exitCode = 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
  });
}
