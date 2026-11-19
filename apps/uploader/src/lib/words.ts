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
