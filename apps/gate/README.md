# Gate

A small SigV4 access proxy for object storage that has one key for a whole
project. Each person signs in with their own login and password, and reaches
only their own bucket `sparcd-next-<code>` plus the readable part of
`sparcd-next-settings`. The gate checks each request's signature against the
person's password, checks it against the rules, and signs it again with the
project key, which never leaves the process.

The contract is [`docs/next/GATE.md`](../../docs/next/GATE.md); the bucket
layout is [`docs/next/FORMAT.md`](../../docs/next/FORMAT.md).

| file | what |
| --- | --- |
| `server.mjs` | the HTTP server: verify, decide, re-sign, stream back |
| `sigv4.mjs` | signature verification, header and presigned |
| `namespace.mjs` | bucket guard, path parsing, response bucket checks |
| `rules.mjs` | request → S3 operation, and the access table |
| `listing.mjs` | settings-bucket listings with `access/` stepped over |
| `people.mjs` | people records, wrapped passwords, the password generator |
| `upstream.mjs` | the one upstream client |
| `cli.mjs` | lab admin commands |

## Configuration

Environment variables, kept in a 0600 file:

| variable | default | |
| --- | --- | --- |
| `UPSTREAM` | | `https://<object store host>:<port>` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | the project key |
| `ACCESS_MASTER_KEY` | | 32 bytes, base64: `openssl rand -base64 32` |
| `ALLOWED_HOSTS` | | the Host clients sign, e.g. `server.example.org` |
| `S3_REGION` | `us-east-1` | |
| `SETTINGS_BUCKET` | `sparcd-next-settings` | |
| `BUCKET_ALLOW` | `sparcd-next-*` | nothing outside it is ever touched |
| `PORT` | `8787` | always bound to 127.0.0.1 |
| `MAX_BODY_BYTES` | 64 MiB | one request body |
| `MAX_BUFFERED_BYTES` | 512 MiB | all bodies in flight; a quarter per person |

If the upstream's certificate chain fails, run with
`NODE_OPTIONS=--use-system-ca`.

People are re-read every 5 s, so `pause`, `resume` and `password` take effect
within a few seconds. If the gate can't refresh them for 30 s it answers 503
until it can.

## CLI

```sh
node --env-file=<env file> cli.mjs init                  # creates the settings bucket if missing
node --env-file=<env file> cli.mjs add ana --name "Ana"  # bucket + person; prints the password once
node --env-file=<env file> cli.mjs password ana          # new password, printed once
node --env-file=<env file> cli.mjs pause ana             # or resume
node --env-file=<env file> cli.mjs list
node --env-file=<env file> cli.mjs settings put lab.json sites.csv species.json
```

The password is the only thing on stdout. The CLI never deletes anything.
`settings-example/` holds a made-up lab, sites and species list to start from.

## Local recipe (Windows, Apple-silicon Mac or Linux x64)

One origin, `http://localhost:8080`, laid out like the server:

| path | goes to |
| --- | --- |
| `/-/*`, `/sparcd-next-*` | the gate on 127.0.0.1:8787, then MinIO on 127.0.0.1:9000 |
| `/upload/` | `apps/uploader/dist`, SPA fallback |
| `/tag/` | `apps/tagger/dist`, SPA fallback |
| `/` | `apps/sparcd-home` |

```sh
pnpm install
node apps/gate/local/up.mjs     # starts all three in the background, seeds settings, ana and ben
node apps/gate/local/down.mjs   # stops them; data stays
```

- The front is Caddy with `local/Caddyfile.local`, the same routing as
  production's `deploy/Caddyfile`, so what works locally is what ships.
- `up.mjs` downloads pinned MinIO (the pgsty community build; MinIO no longer
  ships binaries) and Caddy into `local/bin/`, checked against their published
  hashes.
- MinIO data goes to `~/avante-media/sparcd-next/local/minio`, or to
  `SPARCD_LOCAL_DATA` when set.
- The MinIO root key, the master key and the passwords for `ana` and `ben` are
  in `~/.secrets/sparcd-next-local.env` as `ANA_PASSWORD` and `BEN_PASSWORD`.
  Re-running `up.mjs` keeps them.
- Logs and PIDs are in `local/run/`. The MinIO console is on
  `http://127.0.0.1:9001`.

Check the whole chain:

```sh
set -a; . ~/.secrets/sparcd-next-local.env; set +a
SMOKE_ENDPOINT=http://localhost:8080 SMOKE_LOGIN=ana SMOKE_PASSWORD="$ANA_PASSWORD" SMOKE_OTHER=ben \
  node apps/gate/deploy/smoke.mjs
```

### Vite dev servers

A dev server proxies to the gate with its own Host, which is what the browser
signs. Ports 5173 to 5176 are in the local `ALLOWED_HOSTS`.

```js
// vite.config.ts
server: {
  proxy: {
    '/-': 'http://127.0.0.1:8787',
    '/sparcd-next-': 'http://127.0.0.1:8787',
  },
},
```

Leave `changeOrigin` off: rewriting Host breaks every signature.

### What the apps must send

- `x-amz-content-sha256` with the real body hash on every header-signed
  request, including `/-/whoami` (the hash of the empty body). UNSIGNED-PAYLOAD
  and streaming payloads are refused, so turn off the AWS SDK's flexible
  checksums (`requestChecksumCalculation: 'WHEN_REQUIRED'`) and hash Blob
  bodies yourself.
- One PUT per object, with a signed `If-None-Match: *` under `Media/`.
- `list-type=2` for bucket listings and an empty query for HeadBucket.
- Presigned URLs: GET or HEAD, at most 7,200 s, or 604,800 s for
  `Media/<sha256>/thumb.jpg`, `Media/<sha256>/view.jpg` and `shared/…`.

## Server recipe (Ubuntu 24.04)

Files are in `deploy/`. On the VM, from a checkout of this repo:

```sh
sudo SITE_ADDRESS=server.example.org bash apps/gate/deploy/install.sh
sudoedit /etc/sparcd-next/gate.env          # fill in UPSTREAM and the project key
sudo systemctl restart sparcd-gate
sudo node --env-file=/etc/sparcd-next/gate.env /opt/sparcd-next/gate/cli.mjs init
sudo node --env-file=/etc/sparcd-next/gate.env /opt/sparcd-next/gate/cli.mjs \
  settings put /opt/sparcd-next/gate/settings-example/{lab.json,sites.csv,species.json}
sudo node --env-file=/etc/sparcd-next/gate.env /opt/sparcd-next/gate/cli.mjs add ana --name "Ana"
```

- `install.sh` installs Node 24 and Caddy, creates the `sparcd` user, copies
  the gate to `/opt/sparcd-next/gate`, writes `/etc/sparcd-next/gate.env`
  (root, 0600, with a fresh `ACCESS_MASTER_KEY`) if it doesn't exist, and
  installs `sparcd-gate.service` and the Caddyfile.
- Built apps go in `/srv/sparcd-next/upload`, `/srv/sparcd-next/tag` and
  `/srv/sparcd-next/home`.
- Re-running `install.sh` updates the code and keeps the env file.
- Then run `deploy/smoke.mjs` against `https://server.example.org` as a demo
  login.
