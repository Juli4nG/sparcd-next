export const number = (n: number) => n.toLocaleString('en-US');

export const count = (n: number, noun: string) => `${number(n)} ${noun}${n === 1 ? '' : 's'}`;

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
