import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Saver, type SaveStatus } from '../src/data/saver';

function setup(save: (ids: string[]) => Promise<void>) {
  const statuses: SaveStatus[] = [];
  const saver = new Saver(save, (s) => statuses.push(s), { debounceMs: 1000, retryMs: [2000, 5000] });
  return { saver, statuses };
}

describe('Saver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches every photo edited in the quiet window into one save', async () => {
    const save = vi.fn(async (_ids: string[]) => {});
    const { saver, statuses } = setup(save);
    saver.mark(['a']);
    await vi.advanceTimersByTimeAsync(600);
    saver.mark(['b', 'a']);
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(['a', 'b']);
    expect(statuses).toEqual(['saving', 'saved']);
  });

  it('keeps one save in flight; edits made meanwhile go in the next one', async () => {
    let finish!: () => void;
    const save = vi.fn((_ids: string[]) => new Promise<void>((resolve) => (finish = resolve)));
    const { saver } = setup(save);
    saver.mark(['a']);
    void saver.flush();
    saver.mark(['b']);
    void saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls.map((c) => c[0])).toEqual([['a'], ['b']]);
  });

  it('retries a failed batch by itself and reports when it gets through', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { saver, statuses } = setup(save);
    saver.mark(['a', 'b']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses).toEqual(['saving', 'error']);
    expect(saver.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual(['a', 'b']);
    expect(statuses).toEqual(['saving', 'error', 'saved']);
    expect(saver.busy).toBe(false);
  });
});
