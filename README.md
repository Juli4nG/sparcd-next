# SPARC'd Next

Camera-trap photos from SD card to tagged data, in two steps. A volunteer signs
in, sends a card's photos to their own storage, and tags what's in them. Their
storage stays one valid [Camtrap DP 1.0](https://camtrap-dp.tdwg.org/) package
at every moment, so any tool that reads Camtrap DP can read it.

## The apps

- **`apps/uploader`** (served at `/upload/`) sends an SD card's photos to the
  person's own bucket. It reads each photo's EXIF, hashes it, makes a thumbnail
  and a viewing copy, and saves the card as one deployment in the package.
- **`apps/tagger`** (served at `/tag/`) opens a card and tags its photos with
  species and counts, with keyboard shortcuts and autosave. Tags save back to
  the same package.
- **`apps/gate`** is a small access proxy for storage that has one key for a
  whole project. Each person signs in with their own login and password and
  reaches only their own bucket plus the readable part of the lab's settings
  bucket.
- **`apps/sparcd-home`** is the landing page at `/`, with a large button for
  each app.
- **`apps/sparcd-explorer`** is a [marimo](https://marimo.io) notebook that
  loads a collection's Camtrap DP CSVs and shows a hex-binned map, a species
  dashboard and drill-in tabs. It runs locally or as a static Pyodide bundle.

| package | what |
| --- | --- |
| `packages/bucket` (`@sparcd/bucket`) | the storage library: sign-in, S3 client, reading and writing the package, settings, ids and times |
| `packages/camtrap` (`@sparcd/camtrap`) | the Camtrap DP data contract: CSV readers and writers, merge, time shift |

## Storage

- Each person has one bucket, `sparcd-next-<person code>`, holding one Camtrap
  DP package: `datapackage.json`, `deployments.csv`, `media.csv`,
  `observations.csv`, and `Media/<sha256>/` with the original photo, a thumbnail
  and a viewing copy.
- Lab settings (title, time zone, site list, species list) live in
  `sparcd-next-settings`, written by the lab admin with the gate CLI.
- The login name is the person code and the password is the SigV4 secret. The
  gate checks each request's signature against that password and the access
  rules, then signs it again with the project key. Photos are write-once and
  nothing is ever deleted through it.
- With storage that has per-user keys (MinIO, AWS), the apps talk to it
  directly and no gate is needed.

The contracts are in [`docs/next/`](./docs/next/):
[`FORMAT.md`](./docs/next/FORMAT.md) for the bucket layout and
[`GATE.md`](./docs/next/GATE.md) for the gate's rules and endpoints.

## Run it locally

Needs Node 24, pnpm 10 and an internet connection for the first run (it
downloads pinned MinIO and Caddy).

```sh
pnpm install
node apps/gate/local/up.mjs     # MinIO, the gate and Caddy; seeds settings, ana and ben
node apps/gate/local/down.mjs   # stops them; data stays
```

Everything is then at `http://localhost:8080`: `/` home, `/upload/`, `/tag/`.
Logins and passwords for `ana` and `ben` are in
`~/.secrets/sparcd-next-local.env`. Details, including running a Vite dev
server against the gate, are in [`apps/gate/README.md`](./apps/gate/README.md).

To make a synthetic SD card of 12 MP photos:
`uv run --with pillow scripts/make-test-card.py <card-folder> [count]`.

## Deploy

[`apps/gate/deploy/`](./apps/gate/deploy/) has the server recipe for an Ubuntu
VM: Caddy for TLS and the built apps, the gate as a systemd service, an install
script and a smoke test. The server recipe in `apps/gate/README.md` walks
through it, using `server.example.org` as the host.

The Explorer publishes to GitHub Pages from `.github/workflows/pages.yml`.

## Tests

```sh
pnpm --filter "@sparcd/camtrap" --filter "@sparcd/bucket" test
pnpm --filter uploader test
pnpm --filter tagger test
pnpm --filter gate test          # unit; `test:e2e` runs against MinIO
pnpm --filter sparcd-home test
```

`.github/workflows/next-test.yml` runs the libraries, apps and the gate's unit
tests on every push, along with typechecks.

## Toolchain

- **Node** 24 and **pnpm** 10 for the workspace; **Turborepo** for tasks
- **Vite**, **React** and **TypeScript** for the Uploader and Tagger
- **uv** and **marimo** for the Explorer

## Docs

- [`VOCABULARY.md`](./VOCABULARY.md): terms used across the tools
- [`docs/next/`](./docs/next/): the current contracts
- [`docs/`](./docs/): earlier design notes and meeting records, kept as history
