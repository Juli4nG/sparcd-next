# sparcd-next: context for Claude Code

## What this project is

SPARC'd Next takes camera-trap photos from SD card to tagged data. A volunteer
signs in, uploads a folder of photos to their own storage with the **Uploader**,
and tags them with the **Tagger**. Each person's storage is one valid Camtrap DP
1.0 package at all times. The **gate** gives each person their own login in
front of storage that has one key for a whole project. The **Explorer** is a
marimo notebook that reads Camtrap DP CSVs and shows a map and species
dashboard.

## Layout

- `apps/uploader` (`/upload/`), `apps/tagger` (`/tag/`): Vite + React + TypeScript.
  On screen they say upload and uploaded, never card or send.
- `apps/gate`: a plain Node (24) SigV4 access proxy with a CLI, a local recipe
  (`local/`) and a server recipe (`deploy/`).
- `apps/sparcd-home`: static start page at `/` with a button per app; plain
  HTML, no build.
- `apps/sparcd-explorer`: marimo notebook, Python via uv.
- `packages/bucket` (`@sparcd/bucket`): sign-in, S3 client, package
  read/write, settings. The Uploader and Tagger are built on it.
- `packages/camtrap` (`@sparcd/camtrap`): the Camtrap DP data contract.
- `packages/auth-ui` (`@sparcd/auth-ui`): the shared sign-in, header shell,
  dialog and look (`src/app/`), plus the Tailwind preset.
- `e2e/`: Playwright browser tests against the local stack.
- `docs/next/`: the contracts. `FORMAT.md` is the bucket layout, `GATE.md` is
  the gate's rules and endpoints, `LOOK.md` is the look every screen follows.
  Other files in `docs/` are history.

## Storage model

- One bucket per person, `sparcd-next-<person code>`, holding one Camtrap DP
  package plus `Media/<sha256>/` files. Lab settings are in
  `sparcd-next-settings`.
- Apps learn bucket names from the gate's `/-/whoami`, or from `config.json`
  when there is no gate. They never hard-code them.
- The login name is the person code; the password is the SigV4 secret. The
  gate verifies each request, applies the access table, and signs again with
  the project key. Photos are write-once (`If-None-Match: *`) and nothing is
  deleted through the gate.

## Run and deploy

- Local: `node apps/gate/local/up.mjs` starts MinIO, the gate and Caddy on
  `http://localhost:8080`; `node apps/gate/local/down.mjs` stops them.
- Deploy: `apps/gate/deploy/` (Ubuntu VM, Caddy, systemd). Use
  `server.example.org` for example hosts in docs.

## Toolchain

- **pnpm 10** + **Turborepo 2** at the root; Node 24.
- **uv** for the Explorer's Python environment (`apps/sparcd-explorer`).
- Tests: vitest in the packages and the two apps, Playwright in `e2e/`,
  `node --test` in the gate. CI is `.github/workflows/next-test.yml`.

## Storage access scope

The system's storage is the `sparcd-next-*` buckets in the Jetstream2 project
used for this work. Touch only those; the gate's `BUCKET_ALLOW` enforces the
same prefix. Other buckets in the project are out of scope. Credentials live in
gitignored env files under `~/.secrets/` and never go in the repo, a prompt, or
a commit.

## Working rules

- Each app does one thing well. When a new need appears, add an app rather
  than growing one.
- Screens follow `docs/next/LOOK.md`: shared pieces from `@sparcd/auth-ui`,
  sizes from the type scale, colours from tokens. The look tests enforce it.
- Prefer designs that ship as a static bundle with no server-side state; the
  gate is the one server piece.
- Per-feature optimization beats shared abstractions. Two apps may duplicate
  small logic to stay tight.
- Don't add fallbacks, validation or compatibility shims for cases that can't
  happen. Trust data shapes the contracts in `docs/next/` already fix.
- Tight, direct prose. No filler, no trailing summaries when a diff speaks for
  itself.
- Comments explain a non-obvious *why*, not what the code says.
- Commit golden fixtures with their line endings intact (`.gitattributes`
  keeps them as committed).
