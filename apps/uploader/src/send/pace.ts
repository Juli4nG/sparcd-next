import type { Progress } from './send';
import { timeLeft } from './words';

export type PaceMemo = { at: number; done: number; rate?: number; shownMs?: number; shownAt: number };

export const newPaceMemo = (): PaceMemo => ({ at: 0, done: 0, shownAt: 0 });

/**
 * One once-a-second look at the upload. The rate is smoothed; time left shows
 * only once it has settled, changes at most every 15 seconds, and may grow by a
 * quarter at most, so it never leaps from minutes to hours. `left` is absent
 * when the shown time stays as it was; nothing is returned while there is no
 * new rate to show.
 */
export function paceTick(
  m: PaceMemo,
  p: Exclude<Progress, { phase: 'reading' }>,
  now: number,
  avgBytes: number,
): { speed: string; left?: string } | undefined {
  if (!m.at) return void Object.assign(m, { at: now, done: p.done });
  const dt = (now - m.at) / 1000;
  if (dt < 2) return;
  const instant = (p.done - m.done) / dt;
  m.rate = m.rate === undefined ? instant : m.rate * 0.75 + instant * 0.25;
  Object.assign(m, { at: now, done: p.done });
  if (!m.rate) return;
  const speed = `${((m.rate * avgBytes) / 1_000_000).toFixed(1)} MB per second`;
  let left: string | undefined;
  if (p.done - p.sentBefore >= 3 && now - p.startedAt >= 5_000 && (m.shownMs === undefined || now - m.shownAt >= 15_000)) {
    let ms = ((p.total - p.done) / m.rate) * 1000;
    if (m.shownMs !== undefined) ms = Math.min(ms, m.shownMs * 1.25);
    m.shownMs = ms;
    m.shownAt = now;
    left = timeLeft(ms);
  }
  return { speed, left };
}
