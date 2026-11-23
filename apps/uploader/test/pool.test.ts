import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../src/send/pool';

/** A worker that takes jobs and never answers, as a terminated one doesn't. */
vi.mock('../src/workers/photo.worker?worker', () => ({
  default: class {
    onmessage = null;
    onerror = null;
    postMessage() {}
    terminate() {}
  },
}));

describe('createPool', () => {
  it('rejects running, queued and later jobs once closed', async () => {
    const pool = createPool(1);
    const file = new File(['x'], 'IMG_1.JPG');
    const running = pool.read(file);
    const queued = pool.read(file);
    pool.close();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pool.derive(file)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
