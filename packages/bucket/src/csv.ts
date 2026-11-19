import { instant } from './times';

export const COLUMNS = {
  deployments: [
    'deploymentID', 'locationID', 'locationName', 'latitude', 'longitude', 'coordinateUncertainty',
    'deploymentStart', 'deploymentEnd', 'setupBy', 'cameraID', 'cameraModel', 'cameraDelay',
    'cameraHeight', 'cameraDepth', 'cameraTilt', 'cameraHeading', 'detectionDistance',
    'timestampIssues', 'baitUse', 'featureType', 'habitat', 'deploymentGroups', 'deploymentTags',
    'deploymentComments',
  ],
  media: [
    'mediaID', 'deploymentID', 'captureMethod', 'timestamp', 'filePath', 'filePublic', 'fileName',
    'fileMediatype', 'exifData', 'favorite', 'mediaComments',
  ],
  observations: [
    'observationID', 'deploymentID', 'mediaID', 'eventID', 'eventStart', 'eventEnd',
    'observationLevel', 'observationType', 'cameraSetupType', 'scientificName', 'count',
    'lifeStage', 'sex', 'behavior', 'individualID', 'individualPositionRadius',
    'individualPositionAngle', 'individualSpeed', 'bboxX', 'bboxY', 'bboxWidth', 'bboxHeight',
    'classificationMethod', 'classifiedBy', 'classificationTimestamp', 'classificationProbability',
    'observationTags', 'observationComments',
  ],
} as const;

export type Table = keyof typeof COLUMNS;

type RowOf<C extends string, Required extends C> = Record<Required, string> & Partial<Record<C, string>>;

export type Deployment = RowOf<
  (typeof COLUMNS.deployments)[number],
  'deploymentID' | 'latitude' | 'longitude' | 'deploymentStart' | 'deploymentEnd'
>;
export type Media = RowOf<
  (typeof COLUMNS.media)[number],
  'mediaID' | 'deploymentID' | 'timestamp' | 'filePath' | 'filePublic' | 'fileMediatype'
>;
export type Observation = RowOf<
  (typeof COLUMNS.observations)[number],
  'observationID' | 'deploymentID' | 'mediaID' | 'eventStart' | 'eventEnd' | 'observationLevel' | 'observationType'
>;
export type PackageRows = { deployments: Deployment[]; media: Media[]; observations: Observation[] };

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[i++];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') endRow();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quote');
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Rows keyed by header name. Accepts a leading BOM and CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const [header, ...body] = parseRows(text.replace(/^﻿/, ''));
  if (!header) return [];
  if (new Set(header).size !== header.length) throw new Error('CSV repeats a column name');
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(columns: readonly string[], rows: Partial<Record<string, string>>[]): string {
  return [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ''))]
    .map((cells) => cells.map(cell).join(',') + '\n')
    .join('');
}

/** Rows with every standard column (missing ones empty) and nothing else. */
export function parseTable<T extends Table>(table: T, text: string): PackageRows[T] {
  const columns: readonly string[] = COLUMNS[table];
  return parseCsv(text).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? '']))) as PackageRows[T];
}

const byText = (a = '', b = '') => (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: string, b: string) => instant(a) - instant(b);

const ORDER: { [T in Table]: (a: PackageRows[T][number], b: PackageRows[T][number]) => number } = {
  deployments: (a, b) => byText(a.deploymentID, b.deploymentID),
  media: (a, b) =>
    byText(a.deploymentID, b.deploymentID) || byTime(a.timestamp, b.timestamp) || byText(a.mediaID, b.mediaID),
  observations: (a, b) =>
    byText(a.deploymentID, b.deploymentID) ||
    byTime(a.eventStart, b.eventStart) ||
    byText(a.mediaID, b.mediaID) ||
    byText(a.observationID, b.observationID),
};

/** The whole file: standard columns, FORMAT.md row order. */
export function serializeTable<T extends Table>(table: T, rows: PackageRows[T]): string {
  const sorted = [...rows].sort(ORDER[table] as (a: unknown, b: unknown) => number);
  return toCsv(COLUMNS[table], sorted as Partial<Record<string, string>>[]);
}
