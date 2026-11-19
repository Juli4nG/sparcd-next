# Tagger

Volunteers sign in, pick one of their cards, and tag its photos with the
tagging screen they already know. Tags save to their own bucket, which stays
one valid Camtrap DP 1.0 package (`docs/next/FORMAT.md`).

Served at `/tag/`. `/tag/#card=<deploymentID>` opens a card directly.

## Code

- `src/data/`: everything a tagging screen needs, with no UI.
  `loadSettings` and `loadCard` read a card; `useTagging(session, about, card)`
  keeps its tags in memory with undo and batched autosave (`Saver`).
  `tags.ts` maps tags to and from observation rows.
- `src/tag/`: the screen: grid, large photo, species panel, keyboard.
- `src/lib/`: key bindings, the standalone Shift/Control gesture (#628),
  count prefix, selection helpers, species search (#627).

## Run it without the gate

With a gate at `127.0.0.1:8787`, `pnpm --filter tagger dev` is enough. Without
one, point the app at MinIO through a local `config.json`:

1. Put `minio.exe` in `apps/tagger/.local/bin/`, and `SEED_LOGIN` /
   `SEED_PASSWORD` in `apps/tagger/.local/minio.env`. Start MinIO with those as
   its root user and password, on `127.0.0.1:9310`.
2. Write `apps/tagger/.local/config.json`:
   `{ "gate": false, "endpoint": "http://127.0.0.1:9310", "region": "us-east-1", "settingsBucket": "sparcd-next-settings", "bucketPrefix": "sparcd-next-" }`.
   The dev server serves it as `/config.json`, and answers 404 when it's absent.
3. Seed a card (settings bucket, thumbs and views made like the Uploader's):
   `SEED_ENDPOINT=http://127.0.0.1:9310 pnpm --filter tagger seed <card folder> <species.json>`.
   `scripts/seed-bulk.ts 5000` adds a 5,000-photo card for checking scale.
4. `pnpm --filter tagger dev`, then open `http://localhost:5190/tag/`.

`scripts/verify.mjs` drives the whole flow in headless Chromium and downloads
the package; `scripts/perf.mjs` measures the big card.
