import { describe, expect, it, vi } from 'vitest';
import { slots } from '../src/tag/slots';

describe('slots', () => {
  it('runs at most the limit at once, the rest in arrival order as slots free', () => {
    const take = slots(2);
    const started: number[] = [];
    const done = [0, 1, 2, 3].map((i) => take(() => started.push(i)));
    expect(started).toEqual([0, 1]);
    done[1]();
    expect(started).toEqual([0, 1, 2]);
    done[0]();
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('drops a waiting job that leaves, and frees no slot for it', () => {
    const take = slots(1);
    const started: number[] = [];
    const first = take(() => started.push(0));
    take(() => started.push(1))();
    take(() => started.push(2));
    expect(started).toEqual([0]);
    first();
    expect(started).toEqual([0, 2]);
    take(() => started.push(3));
    expect(started).toEqual([0, 2]);
  });

  it('takes the slot back from a job past its deadline and tells it; a job done in time never hears', () => {
    vi.useFakeTimers();
    try {
      const take = slots(1, 20_000);
      const started: number[] = [];
      const expired: number[] = [];
      const first = take(() => started.push(0), () => expired.push(0));
      const second = take(() => started.push(1), () => expired.push(1));
      vi.advanceTimersByTime(19_999);
      expect([started, expired]).toEqual([[0], []]);
      vi.advanceTimersByTime(1);
      expect([started, expired]).toEqual([[0, 1], [0]]);
      // A late done frees nothing: the slot is the second job's now.
      first();
      take(() => started.push(2), () => expired.push(2));
      expect(started).toEqual([0, 1]);
      second();
      expect(started).toEqual([0, 1, 2]);
      vi.advanceTimersByTime(19_999);
      expect(expired).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('frees a slot once however often done is called', () => {
    const take = slots(1);
    const started: number[] = [];
    const first = take(() => started.push(0));
    take(() => started.push(1));
    take(() => started.push(2));
    first();
    first();
    expect(started).toEqual([0, 1]);
  });
});
