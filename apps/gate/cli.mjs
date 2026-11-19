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
import { makeUpstream } from './upstream.mjs';
import { ownBucket, PERSON_CODE, RESERVED_CODES } from './rules.mjs';
import {
  PEOPLE_PREFIX, personKey, newPassword, loadMasterKey, wrapSecret,
} from './people.mjs';

const SETTINGS_FILES = {
  'lab.json': 'application/json',
  'sites.csv': 'text/csv; charset=utf-8',
  'species.json': 'application/json',
};

const USAGE = `usage: node cli.mjs <command>
  init                       create the settings bucket if missing
  add <code> --name "Ana"    create sparcd-next-<code> and the person; prints the password once
  password <code>            set a new password; prints it once
  pause <code>               stop access (the bucket is untouched)
  resume <code>              restore access
  list                       code, name, status
  settings put <file>...     upload lab.json, sites.csv or species.json`;

export function openAdmin(env = process.env) {
  const config = withDefaults(configFromEnv(env));
  const inNamespace = makeGuard(config.allow);
  if (!inNamespace(config.settingsBucket)) throw new Error('SETTINGS_BUCKET is outside BUCKET_ALLOW');
  const upstream = makeUpstream({
    endpoint: config.upstream,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
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
