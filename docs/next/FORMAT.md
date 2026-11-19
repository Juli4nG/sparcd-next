# SPARC'd Next: storage format

Every person has one bucket, and that bucket is always one valid
[Camtrap DP 1.0](https://camtrap-dp.tdwg.org/) package. Lab settings live in a
separate settings bucket. This file is the contract the Uploader, the Tagger,
the gate and `packages/bucket` are built against.

## Buckets

| bucket | holds | who writes |
| --- | --- | --- |
| `sparcd-next-<person code>` | one Camtrap DP package | its owner only |
| `sparcd-next-settings` | lab settings | the lab admin (gate CLI) |

Apps never hard-code a bucket name. With the gate they learn both names from
`/-/whoami` (see GATE.md); without it, from `config.json`.

### A person's bucket

```
datapackage.json
deployments.csv
media.csv
observations.csv
Media/<sha256>/<original file name>   the photo as it came off the card, EXIF intact
Media/<sha256>/thumb.jpg              320 px long side, no EXIF
Media/<sha256>/view.jpg               1600 px long side, no EXIF
shares.json                           share recipes (sharing only)
shared/<share id>/...                 one generated package per share
```

An empty bucket has no package files yet. The first saved card writes all four
package files.

### The settings bucket

```
lab.json        { "title", "timeZone", "shareLicenses" }
sites.csv       the site list
species.json    the species list
access/         gate only: people and their wrapped passwords. No person can read it.
```

`lab.json`:

```json
{
  "title": "Example Wildlife Lab",
  "timeZone": "America/Phoenix",
  "shareLicenses": [
    { "name": "CC-BY-NC-4.0", "path": "https://creativecommons.org/licenses/by-nc/4.0/", "scope": "data" },
    { "name": "CC-BY-NC-4.0", "path": "https://creativecommons.org/licenses/by-nc/4.0/", "scope": "media" }
  ]
}
```

`timeZone` is an IANA zone. It applies to camera times that carry no offset of
their own.

`sites.csv` (header row, UTF-8):

```
locationID,locationName,latitude,longitude,deploymentGroups
juniper-draw,Juniper Draw,31.84213,-110.61942,area:East Range
```

- `locationID` matches `^[a-z0-9]+(-[a-z0-9]+)*$`. It's part of every
  deploymentID, so it never changes once used.
- `deploymentGroups` uses the Camtrap form: `key:value` pairs joined by ` | `.
  It may be empty.

`species.json` keeps today's shape, one global list:

```json
[{ "name": "Bobcat", "scientificName": "Lynx rufus", "speciesIconURL": "https://…", "keyBinding": "C", "observationType": "animal" }]
```

- `observationType` is optional and defaults to `animal`. `Homo sapiens` is
  `human`, the "Unknown" entry is `unknown`, and "Ghost" (a false trigger) is
  `blank`.
- `scientificName` is the species key. Values are trimmed.
- `keyBinding` is one character or null. The Tagger also has its own
  standalone Shift and Control bindings (#628), which live in the Tagger, not
  in this file.

## IDs

| ID | rule | example |
| --- | --- | --- |
| person code | `^[a-z][a-z0-9]{1,19}$`. `settings`, `gate` and `admin` are reserved | `ana` |
| `mediaID` | lowercase hex SHA-256 of the original file's bytes | `9f2c…` (64 chars) |
| `deploymentID` | `<locationID>_<YYYY-MM-DD>`, using the date the card came out of the camera | `juniper-draw_2026-11-17` |
| `observationID` | `<mediaID>-<person code>-<n>`, n = 1, 2, … within that photo | `9f2c…-ana-1` |
| share id | 26 random lowercase base32 chars (128 bits) | `k3…` |

One SD card is one deployment. Sending a second card for the same site and date
adds to the same deployment.

The same photo (same `mediaID`) is stored once per bucket. If it's already in
`media.csv` it's skipped, and it keeps the deployment it first arrived with.

## Times

- Every time in a CSV is `YYYY-MM-DDTHH:MM:SS±HH:MM`: the camera's local wall
  clock with its offset. No fractional seconds and no `Z`.
- Camera time comes from EXIF `DateTimeOriginal`. Its offset is
  `OffsetTimeOriginal` when present, else `lab.json` `timeZone` at that
  instant.
- A photo with no camera time gets an estimate, using the existing logic from
  `apps/sparcd-uploader/src/lib/estimateCaptureTime.ts`:
  - Its neighbours in natural file-name order are interpolated.
  - If that isn't possible, the estimate is offset from the nearest photo, or
    falls back to the file's modified time.
  - Its `mediaComments` is `Time estimated from nearby photos.`
  - Times are never invented beyond that.
- `deploymentStart` and `deploymentEnd` are the earliest and latest media
  `timestamp` in that deployment, compared as instants.
- `classificationTimestamp` is the tagger's browser clock with its own offset.

## Derived images

They're written by the Uploader at upload time, in a worker with
`createImageBitmap` and `OffscreenCanvas`:

- They're JPEG, with the EXIF orientation applied, so no EXIF is needed.
- Never upscaled.
- `thumb.jpg`: long side 320 px, quality 0.75.
- `view.jpg`: long side 1600 px, quality 0.82.

The Tagger shows `thumb.jpg` in grids and `view.jpg` in the large view. It never
loads originals in a grid. Shares link to `view.jpg` and `thumb.jpg`, never to
an original, because originals keep their EXIF, which can include GPS.

An original is stored under its file name, except:

- Runs of dots collapse to one, because Camtrap DP forbids `..` in a
  `filePath`.
- A name of `thumb.jpg` or `view.jpg` in any case becomes `original-<name>`.

`fileName` always keeps the name as it was on the card.

## Package files

All CSVs follow these rules:

- UTF-8 with no BOM and `\n` line endings.
- A header row, with columns exactly as listed below and in that order.
- RFC 4180 quoting: a field is quoted only if it contains `,`, `"`, CR or LF.
- An empty field means missing.
- Booleans are `true` and `false`.
- Readers map columns by header name and ignore unknown columns. Writers always
  write the full standard set.

### deployments.csv (Camtrap DP 1.0, 24 columns)

```
deploymentID,locationID,locationName,latitude,longitude,coordinateUncertainty,deploymentStart,deploymentEnd,setupBy,cameraID,cameraModel,cameraDelay,cameraHeight,cameraDepth,cameraTilt,cameraHeading,detectionDistance,timestampIssues,baitUse,featureType,habitat,deploymentGroups,deploymentTags,deploymentComments
```

The Uploader fills:

- `deploymentID`, plus `locationID`, `locationName`, `latitude`, `longitude` and
  `deploymentGroups` from `sites.csv`.
- `deploymentStart` and `deploymentEnd`.
- `cameraModel`, as `<Make>-<Model>` from the first photo whose EXIF has both.

The rest are empty.

### media.csv (11 columns)

```
mediaID,deploymentID,captureMethod,timestamp,filePath,filePublic,fileName,fileMediatype,exifData,favorite,mediaComments
```

The Uploader fills:

- `mediaID` and `deploymentID`.
- `timestamp`.
- `filePath`, as `Media/<sha256>/<stored name>`, relative to the package root.
- `filePublic`, as `true`.
- `fileName`, the original name.
- `fileMediatype`, as `image/jpeg`.
- `mediaComments`, only for estimated times.

`filePublic` means "may be shown outside this bucket", for example in a share.
When the owner records a `human` observation on their own photo, the Tagger sets
`filePublic` to `false` on that row. It sets it back to `true` once no `human`
observation remains. Shares include only `filePublic = true` photos.

Tonight the Uploader accepts photos only (`.jpg` and `.jpeg`, any case). Other
files on the card are ignored.

### observations.csv (28 columns)

```
observationID,deploymentID,mediaID,eventID,eventStart,eventEnd,observationLevel,observationType,cameraSetupType,scientificName,count,lifeStage,sex,behavior,individualID,individualPositionRadius,individualPositionAngle,individualSpeed,bboxX,bboxY,bboxWidth,bboxHeight,classificationMethod,classifiedBy,classificationTimestamp,classificationProbability,observationTags,observationComments
```

The rows in a bucket are its owner's own tags, nobody else's.

The Tagger writes one row per species per photo:

- `observationLevel` is `media`.
- `eventStart` and `eventEnd` are both the media `timestamp`.
- `mediaID` and `deploymentID` come from the media row.
- `observationType` comes from the species entry (`animal`, `human`,
  `unknown` or `blank`).
- `scientificName` is filled for `animal` and `human`, and is empty
  otherwise.
- `count` is a whole number, 1 or more, and is empty for `blank`.
- `classificationMethod` is `human`, `classifiedBy` is the person code, and
  `classificationTimestamp` is the time of the edit.
- `eventID` is empty, except when one tag is applied to a whole burst. Then
  every row in the burst gets `<deploymentID>-<first 12 hex of the burst's
  first mediaID>`. The rows stay media-level.

"Nothing in this photo" is one row with `observationType` `blank`, no
`scientificName` and no `count`.

Tag state is read from `observationType`, with no extra status column:

- A photo with no rows is untagged.
- `blank` means nothing is in it.
- Anything else is tagged.

### datapackage.json

It's rewritten whenever the CSVs change.

```json
{
  "profile": "https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/camtrap-dp-profile.json",
  "name": "sparcd-next-ana",
  "title": "Photos from Ana",
  "created": "2026-11-19T07:10:00Z",
  "contributors": [{ "title": "Ana", "role": "rightsHolder" }],
  "project": {
    "title": "Example Wildlife Lab",
    "samplingDesign": "opportunistic",
    "captureMethod": ["activityDetection"],
    "individualAnimals": false,
    "observationLevel": ["media"]
  },
  "spatial": { "type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  "temporal": { "start": "2026-11-02", "end": "2026-11-17" },
  "taxonomic": [{ "scientificName": "Lynx rufus" }],
  "resources": [
    { "name": "deployments", "path": "deployments.csv", "profile": "tabular-data-resource", "format": "csv", "mediatype": "text/csv", "encoding": "utf-8",
      "schema": "https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/deployments-table-schema.json" },
    { "name": "media", "path": "media.csv", "...": "same shape, media-table-schema.json" },
    { "name": "observations", "path": "observations.csv", "...": "same shape, observations-table-schema.json" }
  ]
}
```

- `spatial` is a `Point` when every deployment is at one position, and
  otherwise the bounding-box `Polygon`.
- `temporal` takes its dates from the deployments' first and last times.
- `taxonomic` is required by the profile. It lists each distinct
  `scientificName` in `observations.csv`, sorted, and is `[]` when there are
  none.
- `name` is the bucket name. `title` and the contributor come from the person's
  display name, and `project.title` comes from `lab.json`.
- The published profile is the authority; this file follows it. Check a
  package with
  `uvx --with "jsonschema<4.18" frictionless validate datapackage.json`. The
  pin is needed because the 1.0 profile's `#$defs/version` reference is
  rejected by newer `jsonschema` releases.

## Writing safely

- **Order:**
  1. Photo files (original, `thumb.jpg`, `view.jpg`).
  2. `deployments.csv`.
  3. `media.csv`.
  4. `observations.csv`.
  5. `datapackage.json` last.

  A CSV row never points at something that isn't stored yet. On the first
  write, a header-only `observations.csv` is created before `datapackage.json`.
- **One writer per bucket.** Every CSV write re-reads the file (never from a
  browser cache), merges, and writes the whole file back. It doesn't rely on
  `If-Match`, because Ceph answers 412 to a quoted tag.
  - Saves hold a Web Lock named after the bucket, so the Uploader and the
    Tagger in two tabs of one browser take turns.
  - Two devices saving to one bucket at the same moment can still lose one
    save. That's an accepted limit for now.
  - A file that doesn't parse cleanly (an unclosed quote or a repeated
    column) is refused rather than rewritten.
- **Merge rules:**
  - `deployments.csv` is keyed by `deploymentID`. The Uploader widens an
    existing row's `deploymentStart` and `deploymentEnd` and keeps its other
    values. Copied rows (see sharing) are only inserted when absent.
  - `media.csv` is keyed by `mediaID`. It's insert-only, except for the owner's
    `filePublic` rule above.
  - `observations.csv`: saving a photo's tags replaces every row with that
    `mediaID`.
- **Row order on write:**
  - Deployments by `deploymentID`.
  - Media by `deploymentID`, then `timestamp`, then `mediaID`.
  - Observations by `deploymentID`, then `eventStart`, then `mediaID`, then
    `observationID`.
- **Write-once photos.** Every PUT under `Media/` carries `If-None-Match: *`. A
  412 means the file is already stored, and counts as success.
  - Photos go up as one PUT each, up to the gate's 64 MB body limit, with no
    multipart.
  - Ceph ignores `If-None-Match` on CompleteMultipartUpload, so multipart
    under `Media/` would allow overwrites. The gate refuses it.
- **Checkpoints.** The Uploader writes CSV rows every 250 photos and at the end.
  A row is written only once all three of its files are stored.
- **Resume.** At the start, the Uploader lists `Media/` once. A photo whose
  `mediaID` is in `media.csv` is skipped. A photo with all three files stored
  but no row only gets its row. Anything else is sent.
- **Content types** are always signed: `text/csv; charset=utf-8`,
  `application/json` and `image/jpeg`.

## Sharing

A share lets another volunteer tag one card without any access to the owner's
bucket.

`shares.json` holds the recipes:

```json
{ "shares": [{
  "id": "k3…",
  "createdAt": "2026-11-19T09:00:00-07:00",
  "expiresAt": "2026-11-26T09:00:00-07:00",
  "deploymentIDs": ["juniper-draw_2026-11-17"],
  "positionDecimals": 1,
  "image": "view"
}] }
```

The share package is generated by software into `shared/<id>/`:

- `datapackage.json`:
  - Same shape as the owner's, with `licenses` from `lab.json`
    `shareLicenses`.
  - Each resource `path` is a signed URL to the sibling CSV, valid for 7 days.
  - `spatial` is computed from the rounded positions.
  - `sparcdThumbs` (a custom property) is a signed URL to `thumbs.json`.
- `deployments.csv`:
  - Only the shared deployments.
  - `latitude` and `longitude` are rounded to `positionDecimals`, and
    `coordinateUncertainty` is `8000`.
  - `locationName` is empty.
  - `deploymentGroups` gets ` | share:<id>` appended (or `share:<id>` if it
    was empty).
- `media.csv`:
  - Only `filePublic = true` photos of those deployments, and never a photo
    with a stored `human` observation.
  - The share is built from the owner's current rows, read at the moment of
    sharing.
  - `filePath` is a signed URL to `Media/<sha256>/view.jpg`.
  - `mediaComments` is kept.
- `observations.csv`: header only, with no tags.
- `thumbs.json`: `{ "<mediaID>": "<signed URL to thumb.jpg>" }`, for the grid.
  This isn't a package resource.

`shares.json` and `shared/<id>/` are written together, under the same lock as
package saves.

The link the owner copies is
`<origin>/tag/#share=<encodeURIComponent(signed URL of shared/<id>/datapackage.json)>`.
The fragment keeps the signed URL out of server logs.

A recipient tags while signed in as themselves:

- Their tags go to their own `observations.csv`.
- The deployment and media rows they tagged are copied as-is into their own
  `deployments.csv` and `media.csv`, insert-only, so their package still
  validates.
- Copies carry the `share:<id>` group. The Tagger lists those cards as shared
  with you.
- Copies are never the authority.
- A copied media row keeps the share's signed `filePath`, which stops working
  when the share expires (7 days). The tags and rows stay valid; only the
  picture link goes stale.
- Getting tags back to the owner is the future tagging service, not this
  build.
