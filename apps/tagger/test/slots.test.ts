import { describe, expect, it } from 'vitest';
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
