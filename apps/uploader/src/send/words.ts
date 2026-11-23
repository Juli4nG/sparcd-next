import { isVideo } from './scan';

export const number = (n: number) => n.toLocaleString('en-US');

export const count = (n: number, noun: string) => `${number(n)} ${noun}${n === 1 ? '' : 's'}`;

export type Tally = { photos: number; videos: number };

export const tally = (names: string[]): Tally => {
  const videos = names.filter(isVideo).length;
  return { photos: names.length - videos, videos };
};

/** "3 photos", "2 videos", or "3 photos and 2 videos". */
export const files = ({ photos, videos }: Tally): string =>
  !videos ? count(photos, 'photo') : !photos ? count(videos, 'video') : `${count(photos, 'photo')} and ${count(videos, 'video')}`;

/** "The video is uploaded", "All 3 photos are uploaded", "2 photos are uploaded" (when some were left out). */
export function uploadedLine(saved: Tally, all: Tally): string {
  const one = (t: Tally) => t.photos + t.videos === 1;
  if (saved.photos !== all.photos || saved.videos !== all.videos) return `${files(saved)} ${one(saved) ? 'is' : 'are'} uploaded`;
  return one(all) ? `The ${all.photos ? 'photo' : 'video'} is uploaded` : `All ${files(all)} are uploaded`;
}

/** "was" for one file, "were" for more. */
export const wasWere = (names: string[]) => (names.length === 1 ? 'was' : 'were');

export function timeLeft(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'Less than a minute left';
  if (minutes < 60) return `About ${count(minutes, 'minute')} left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `About ${count(hours, 'hour')}${rest ? ` ${count(rest, 'minute')}` : ''} left`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
