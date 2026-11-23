import { describe, expect, it } from 'vitest';
import { byteBudget } from '../src/send/budget';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Jobs that start when the budget lets them and finish when told. */
function harness(limit: number) {
  const run = byteBudget(limit);
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const job = (name: string, bytes: number) =>
    run(bytes, () => {
      started.push(name);
      return new Promise<void>((r) => finish.set(name, r));
    });
  return { started, finish: (name: string) => finish.get(name)!(), job };
}

describe('byteBudget', () => {
  it('runs jobs together while their bytes fit, then the next as bytes come back', async () => {
    const h = harness(100);
    void h.job('a', 40);
    void h.job('b', 50);
    void h.job('c', 30);
    await tick();
    expect(h.started).toEqual(['a', 'b']);
    h.finish('a');
    await tick();
    expect(h.started).toEqual(['a', 'b', 'c']);
  });

  it('runs a job bigger than the limit alone, and nothing joins it', async () => {
    const h = harness(100);
    void h.job('a', 10);
    void h.job('big', 150);
    void h.job('b', 1);
    await tick();
    expect(h.started).toEqual(['a']);
    h.finish('a');
    await tick();
    expect(h.started).toEqual(['a', 'big']);
    h.finish('big');
    await tick();
    expect(h.started).toEqual(['a', 'big', 'b']);
  });

  it('serves in order, so a small job does not overtake a waiting big one', async () => {
    const h = harness(100);
    void h.job('a', 60);
    void h.job('b', 60);
    void h.job('small', 10);
    await tick();
    expect(h.started).toEqual(['a']);
  });

  it('gives the bytes back when a job fails', async () => {
    const run = byteBudget(100);
    await expect(run(100, async () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(await run(100, async () => 'ok')).toBe('ok');
  });
});
