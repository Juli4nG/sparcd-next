import type { Bucket, PutOptions } from '@sparcd/bucket';

/** Extra HTTPS ports the gate also answers on, as the old Uploader's shards did. */
const SHARD_PORTS = [8443, 8444, 8445, 8446, 8447, 8448, 8449];
/** Photos in flight per endpoint. */
export const PER_ENDPOINT = 3;

export type Shards = {
  put: (key: string, body: Uint8Array<ArrayBuffer>, opts: PutOptions) => Promise<unknown>;
  count: () => number;
};

/**
 * Photo PUTs go round-robin over the gate's ports that answer this sign-in; reads and
 * the package CSVs stay on `home`. A shard that fails is dropped and the PUT goes to
 * the next one, so only `home` failing can stop an upload.
 */
export async function openShards(home: Bucket): Promise<Shards> {
  const url = new URL(home.endpoint);
  const extra = url.protocol === 'https:' ? SHARD_PORTS.map((port) => home.at(`https://${url.hostname}:${port}`)) : [];
  const answers = await Promise.all(extra.map((b) => b.reachable(4000)));
  let live = [home, ...extra.filter((_, i) => answers[i])];
  console.info('upload endpoints', live.map((b) => b.endpoint));
  let turn = 0;
  return {
    count: () => live.length,
    async put(key, body, opts) {
      for (;;) {
        const bucket = live[turn++ % live.length];
        try {
          return await bucket.putObject(key, body, opts);
        } catch (err) {
          if (bucket === home) throw err;
          if (!live.includes(bucket)) continue;
          live = live.filter((b) => b !== bucket);
          console.warn('upload endpoint dropped', bucket.endpoint, err);
        }
      }
    },
  };
}
