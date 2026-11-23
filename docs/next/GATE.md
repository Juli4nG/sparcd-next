# SPARC'd Next: the gate

The apps are plain S3 clients. Point them at any S3-compatible storage (MinIO,
AWS) with your own keys and they work without a gate.

The gate exists for storage that has only **one key for a whole project**, like
Jetstream2's Ceph RGW, where that key also reaches real, encrypted lab data. It
gives each person their own login and lets that login reach only their own
bucket. It does this by:

1. Checking each request's SigV4 signature against the person's own password.
2. Checking the request against the rules below.
3. Signing it again with the one project key.

It lives in `apps/gate`, slimmed from `apps/sparcd-shard-proxy/access`. It keeps
that code's SigV4 verify-then-re-sign, namespace guard, header allowlists,
people store and CLI.

## Login

- The **login name is the person code** (`ana`) and serves as the SigV4 access
  key ID. The **password is the SigV4 secret**.
- The apps lowercase and trim the login name, and trim the password.
- The CLI makes passwords of four common words joined by hyphens
  (`maple-river-stone-cloud`). They're easy to read aloud over the phone, at
  about 40 bits or more.
- The apps keep `{ login, password }` in `sessionStorage` under
  `sparcd-next.signin`, so a person stays signed in for the browser session.
  Both apps share it because they're served from one origin.

## Where things are

One origin serves everything:

| path | what |
| --- | --- |
| `/` | home page with links to the two apps |
| `/upload/` | Uploader |
| `/tag/` | Tagger |
| `/config.json` | optional. Absent means "gate at this origin" |
| `/-/…` | gate JSON endpoints |
| `/sparcd-next-…` | S3, path-style, through the gate |

Caddy terminates TLS (HTTP/2 on 443), serves the built apps, and reverse-proxies
`/-/*` and `/sparcd-next-*` to the gate on `127.0.0.1:8787`. The origin is the
same for everything, so there's no CORS. Caddy must pass `Host` through
unchanged, because it's signed.

`config.json` lets the apps run without a gate:

```json
{ "gate": false, "endpoint": "https://minio.example.org", "region": "us-east-1",
  "settingsBucket": "sparcd-next-settings", "bucketPrefix": "sparcd-next-" }
```

Without a gate:

- The person code is the login name.
- The bucket is `bucketPrefix + code`.
- The display name is the code.

With the gate (the default), everything comes from whoami.

## Endpoints

- `GET /-/health` → `{ "ok": true }`, unsigned.
- `GET /-/whoami`, signed with the person's key (`x-amz-content-sha256` of the
  empty body) →
  `{ "name": "Ana", "code": "ana", "bucket": "sparcd-next-ana", "settingsBucket": "sparcd-next-settings" }`.
  A wrong password returns 403. The Uploader and Tagger use this as their
  sign-in check.

Everything else under `/-/` returns 404. The old join, invite, admin and
activity endpoints are removed.

## Rules

A request that matches nothing below gets a 403 in S3 XML shape.

| bucket | allowed |
| --- | --- |
| the person's own `sparcd-next-<code>` | GetObject, HeadObject, ListObjectsV2, HeadBucket, GetBucketLocation, PutObject |
| `sparcd-next-settings` | GetObject, HeadObject, ListObjectsV2, except anything under `access/` |
| anything else | nothing |

- Clients upload each object with one PUT. Bucket listings require
  `list-type=2` and HeadBucket requires an empty query.
- **Write-once photos:**
  - A PutObject under `Media/` must carry `If-None-Match: *`, and is refused
    without it.
  - The client gets the upstream's 412 back when the file already exists.
- **Refused for everyone:**
  - DeleteObject, so nothing is ever deleted through the gate.
  - CopyObject and ListBuckets.
  - Bucket create and delete, ACL, policy, versioning and tagging.
  - Unknown operations and unknown or repeated query parameters.
  - GET or HEAD with a nonzero Content-Length or any Transfer-Encoding.
- **The namespace guard is a hard wall:**
  - Every bucket must start with `sparcd-next-` and match `BUCKET_ALLOW`.
  - The gate and CLI reject a `SETTINGS_BUCKET` that a person could own.
    The suffix must be invalid as a person code or reserved (`settings`,
    `gate`, or `admin`).
  - A response naming any other bucket is a 502.
- **Payload hashing:**
  - UNSIGNED-PAYLOAD is refused on header-signed requests. Clients send the
    real body hash. For a photo or video PUT that is the hash of the stored
    file, with its camera data removed, so it is not the `mediaID`.
  - Streaming payloads are refused.
- **Presigned query-string URLs:**
  - GET and HEAD only, verified with the person's key.
  - `X-Amz-Expires` is at most 7,200 s.
  - Exception: up to 604,800 s (7 days) for keys matching
    `^Media/[0-9a-f]{64}/(thumb|view)\.jpg$` or starting `shared/`. Originals
    never get a long-lived link.
  - Apps presign `<img>` sources with `X-Amz-Date` floored to the hour and a
    7,200 s expiry. That keeps URLs stable, so the browser cache hits within
    the hour.
- Only presigned GetObject 200 or 206 responses under `Media/` get
  `Cache-Control: private, max-age=7200, immutable`. Other responses use
  `Cache-Control: no-store`.
- Responses use `X-Content-Type-Options: nosniff`. GetObject and HeadObject
  responses carrying upstream object data or metadata also use
  `Content-Security-Policy: sandbox; default-src 'none'`.
- Upstream errors use S3 XML with a gate message. Upstream fetches have a
  60-second deadline and return 504 if it expires before the response starts.
- A paused person gets 403 on everything.

## Encryption at rest

Every object the gate or its CLI reads or writes is stored encrypted with S3
customer keys (SSE-C, AES-256), which Jetstream2's Ceph RGW supports over TLS.

- `DATA_KEY` (32 bytes, base64) lives only in the gate's env file. Each
  bucket's key is HKDF-SHA256(`DATA_KEY`, info `sparcd-next/data/v1/<bucket>`).
- The gate adds the key to every object GET, HEAD and PUT on the way upstream,
  so the apps and signed links work unchanged. Listings and bucket calls carry
  no key. Clients cannot send a key of their own: `x-amz-server-side-encryption-*`
  headers are refused.
- Someone holding only the project key sees ciphertext: a GET or HEAD without
  the bucket's key is refused by storage.
- It does not protect against someone who controls the gate's host, which holds
  both keys, nor against a person reading their own photos, which is the point.
- **Back up `DATA_KEY` offline** (a password manager and a sealed copy). Losing
  it loses every stored photo and table. Changing it needs a re-encryption run
  and is not supported yet.
- Objects stored before `DATA_KEY` existed still read: RGW ignores a customer
  key for an unencrypted object. `node cli.mjs encrypt-stored` encrypts them in
  place, safe while the gate runs.
- `DATA_KEY=none` turns encryption off. It is for local MinIO without TLS,
  which refuses customer keys.

## People and buckets

- **People records:**
  - Stored in the settings bucket at `access/people/<code>.json`:
    `{ schemaVersion: 1, code, name, status: "active"|"paused", wrappedSecret, createdAt, updatedAt }`.
  - `wrappedSecret` is AES-256-GCM under `ACCESS_MASTER_KEY`.
  - Only the gate reads or writes `access/`.
- **Bucket:** a person's bucket is `sparcd-next-<code>`, created by the CLI with
  the project key.

CLI (`node apps/gate/cli.mjs …`, run where the gate's env file is):

| command | does |
| --- | --- |
| `init` | creates `sparcd-next-settings` if missing |
| `add <code> --name "Ana"` | creates `sparcd-next-<code>` and the person, and prints the password once |
| `password <code>` | sets a new password and prints it once |
| `pause <code>` / `resume <code>` | stops or restores access. The bucket is untouched |
| `list` | code, name, status |
| `settings put <file>…` | uploads `lab.json`, `sites.csv` or `species.json` to the settings bucket root |
| `encrypt-stored` | encrypts objects stored before `DATA_KEY` was set; safe to repeat |

- The CLI refuses any bucket name outside `sparcd-next-`, using the same
  namespace guard.
- It never deletes a bucket or an object.

## Configuration (environment, 0600 file)

| variable | example |
| --- | --- |
| `UPSTREAM` | `https://<object store host>:<port>` |
| `S3_REGION` | `us-east-1` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the project key, never logged |
| `ACCESS_MASTER_KEY` | base64, 32 bytes |
| `DATA_KEY` | base64, 32 bytes; `none` only for storage without TLS |
| `SETTINGS_BUCKET` | `sparcd-next-settings` |
| `BUCKET_ALLOW` | `sparcd-next-*` |
| `ALLOWED_HOSTS` | `server.example.org` (the Host clients sign) |
| `PORT` | `8787` |
| `MAX_BODY_BYTES` | `268435456` (256 MiB, the default): one request body; bigger is a 413 |
| `MAX_BUFFERED_BYTES` | `536870912` (512 MiB, the default): all bodies held in memory at once. A person may hold a quarter of it, or one whole body if that is more; past that a PUT gets 503 `SlowDown` |

Node uses its bundled CA list. If the upstream's certificate chain fails, run
the gate with `NODE_OPTIONS=--use-system-ca`.

## Running it locally

`apps/gate/README.md` gives one recipe for MinIO, the gate and both apps on one
origin. It's the same layout as the server, so the 5,000-photo test runs
against the real gate code.
