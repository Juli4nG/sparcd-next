import { describe, expect, it } from 'vitest';
import { newPaceMemo, paceTick } from '../src/send/pace';
import type { Progress } from '../src/send/send';

type Sending = Exclude<Progress, { phase: 'reading' }>;
const AVG = 2_000_000;
const at = (done: number, over: Partial<Sending> = {}): Sending => ({ phase: 'sending', done, total: 1000, startedAt: 0, sentBefore: 0, ...over });

describe('paceTick speed', () => {
  it('only notes the start on the first look', () => {
    const m = newPaceMemo();
    expect(paceTick(m, at(0), 1000, AVG)).toBeUndefined();
    expect(m).toMatchObject({ at: 1000, done: 0 });
  });

  it('waits until two seconds have passed since the last look', () => {
    const m = newPaceMemo();
    paceTick(m, at(0), 1000, AVG);
    expect(paceTick(m, at(5), 2999, AVG)).toBeUndefined();
    expect(m).toMatchObject({ at: 1000, done: 0 });
    expect(paceTick(m, at(4), 3000, AVG)?.speed).toBe('4.0 MB per second');
  });

  it('shows nothing while no photo has finished', () => {
    const m = newPaceMemo();
    paceTick(m, at(0), 1000, AVG);
    expect(paceTick(m, at(0), 3000, AVG)).toBeUndefined();
  });

  it('smooths the rate: a quarter of the new reading, three quarters of the old', () => {
    const m = newPaceMemo();
    paceTick(m, at(0), 1000, AVG);
    paceTick(m, at(4), 3000, AVG); // 2 photos a second
    const next = paceTick(m, at(4), 5000, AVG); // none in the last two seconds
    expect(m.rate).toBeCloseTo(1.5);
    expect(next?.speed).toBe('3.0 MB per second');
  });
});

describe('paceTick time left', () => {
  /** A steady two photos a second from t=1s, looked at every two seconds. */
  function steady(upTo: number) {
    const m = newPaceMemo();
    const out: ({ speed: string; left?: string } | undefined)[] = [paceTick(m, at(0), 1000, AVG)];
    for (let now = 3000; now <= upTo; now += 2000) out.push(paceTick(m, at((now - 1000) / 500), now, AVG));
    return { m, out };
  }

  it('is held back for the first five seconds', () => {
    const { out } = steady(4000);
    expect(out.map((o) => o?.left)).toEqual([undefined, undefined]);
  });

  it('shows once three photos and five seconds are in', () => {
    const { out } = steady(5000);
    expect(out.at(-1)).toEqual({ speed: '4.0 MB per second', left: 'About 8 minutes left' });
  });

  it('is held back until three photos have gone since sending began', () => {
    const m = newPaceMemo();
    paceTick(m, at(10, { sentBefore: 10 }), 1000, AVG);
    expect(paceTick(m, at(12, { sentBefore: 10 }), 6000, AVG)?.left).toBeUndefined();
    expect(paceTick(m, at(14, { sentBefore: 10 }), 8000, AVG)?.left).toBeDefined();
  });

  it('changes at most every fifteen seconds', () => {
    const { m, out } = steady(5000);
    expect(out.at(-1)?.left).toBe('About 8 minutes left');
    for (let now = 7000; now < 20_000; now += 2000) expect(paceTick(m, at((now - 1000) / 500), now, AVG)?.left).toBeUndefined();
    expect(paceTick(m, at(40), 21_000, AVG)?.left).toBeDefined();
  });

  it('may grow by a quarter at most when progress stalls', () => {
    const { m } = steady(5000);
    expect(m.shownMs).toBe(496_000);
    const stalled = paceTick(m, at(8), 20_000, AVG);
    expect(m.shownMs).toBe(620_000);
    expect(stalled?.left).toBe('About 10 minutes left');
  });

  it('may shrink as far as the rate says', () => {
    const { m } = steady(5000);
    const faster = paceTick(m, at(508), 20_000, AVG);
    expect(m.shownMs).toBeLessThan(496_000 / 2);
    expect(faster?.left).toBeDefined();
  });
});
