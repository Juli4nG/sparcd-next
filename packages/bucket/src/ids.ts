const RESERVED_CODES = new Set(['settings', 'gate', 'admin']);

export const isPersonCode = (code: string): boolean => /^[a-z][a-z0-9]{1,19}$/.test(code) && !RESERVED_CODES.has(code);

export const isLocationId = (id: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);

export const isMediaId = (id: string): boolean => /^[0-9a-f]{64}$/.test(id);

/** `<locationID>_<YYYY-MM-DD>`, the day the card came out of the camera. */
export const deploymentId = (locationID: string, date: string): string => `${locationID}_${date}`;

/** `n` counts from 1 within one photo. */
export const observationId = (mediaID: string, code: string, n: number): string => `${mediaID}-${code}-${n}`;

/** Shared by every row of a burst tagged at once. */
export const burstEventId = (deploymentID: string, firstMediaID: string): string =>
  `${deploymentID}-${firstMediaID.slice(0, 12)}`;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** 26 lowercase base32 chars, 130 random bits. */
export const newShareId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(26)), (b) => BASE32[b & 31]).join('');

/** Originals named like a derived image are stored as `original-<name>`. */
export const storedName = (fileName: string): string =>
  /^(thumb|view)\.jpg$/i.test(fileName) ? `original-${fileName}` : fileName;

export const originalKey = (mediaID: string, fileName: string): string => `Media/${mediaID}/${storedName(fileName)}`;
export const thumbKey = (mediaID: string): string => `Media/${mediaID}/thumb.jpg`;
export const viewKey = (mediaID: string): string => `Media/${mediaID}/view.jpg`;
