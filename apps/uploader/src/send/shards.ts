import { AwsClient } from 'aws4fetch';
import { S3Error, type Session } from '@sparcd/bucket';

/**
 * Photo PUTs spread round-robin over the gate's extra ports (8443-8449) next
 * to 443, each request signed for its own host and port. Reads and the CSV
 * writes stay on 443 through `@sparcd/bucket`. A shard that fails its probe
 * or a request is dropped for the rest of the upload; 443 always stays.
 */
const EXTRA_PORTS = [8443, 8444, 8445, 8446, 8447, 8448, 8449];
const PROBE_MS = 4000;
const SHARD_PUT_MS = 120_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
/** `@sparcd/bucket` keeps this browser session's login here. */
const SIGNIN_KEY = 'sparcd-next.signin';

const encode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Shard = { origin: string; primary: boolean; alive: boolean };

export type Shards = {
  /** How many endpoints are taking photos right now. */
  live: () => number;
  put: (key: string, body: Uint8Array<ArrayBuffer>, sha256: string) => Promise<void>;
};

export async function openShards(session: Session): Promise<Shards> {
  const { login, password } = JSON.parse(sessionStorage.getItem(SIGNIN_KEY)!) as { login: string; password: string };
  const aws = new AwsClient({ accessKeyId: login, secretAccessKey: password, service: 's3', region: 'us-east-1', retries: 0 });
  const host = location.hostname;
  const shards: Shard[] = [
    { origin: location.origin, primary: true, alive: true },
    ...EXTRA_PORTS.map((port) => ({ origin: `https://${host}:${port}`, primary: false, alive: false })),
  ];

  // A signed whoami through each extra port also proves CORS and the signature check work there.
  await Promise.all(
    shards
      .filter((s) => !s.primary)
      .map(async (s) => {
        try {
          const req = await aws.sign(`${s.origin}/-/whoami`, { method: 'GET', headers: { 'x-amz-content-sha256': EMPTY_SHA }, aws: { allHeaders: true } });
          const res = await fetch(req, { cache: 'no-store', signal: AbortSignal.timeout(PROBE_MS) });
          s.alive = res.ok;
          await res.body?.cancel();
        } catch {
          s.alive = false;
        }
      }),
  );
  console.info('upload endpoints', shards.filter((s) => s.alive).map((s) => s.origin));

  let next = 0;
  const pick = (): Shard => {
    const live = shards.filter((s) => s.alive);
    return live[next++ % live.length];
  };
  const bucketPath = `/${encode(session.bucket.name)}`;

  return {
    live: () => shards.filter((s) => s.alive).length,
    async put(key, body, sha256) {
      const path = `${bucketPath}/${key.split('/').map(encode).join('/')}`;
      for (let attempt = 1; ; ) {
        const shard = pick();
        let status = 0;
        try {
          const req = await aws.sign(shard.origin + path, {
            method: 'PUT',
            body,
            headers: { 'content-type': 'image/jpeg', 'if-none-match': '*', 'x-amz-content-sha256': sha256 },
            aws: { allHeaders: true },
          });
          // A shard that stops answering mid-photo is dropped instead of holding up its lane.
          const res = await fetch(req, { cache: 'no-store', ...(!shard.primary && { signal: AbortSignal.timeout(SHARD_PUT_MS) }) });
          status = res.status;
          if (res.ok || res.status === 412) return void (await res.body?.cancel());
          // A photo too big, or any refusal on 443, is the photo's or the login's problem; any other refusal on a shard drops the shard.
          if (res.status === 413 || (shard.primary && res.status < 500 && res.status !== 429))
            throw new S3Error(res.status, `S3 ${res.status}: ${(await res.text()).slice(0, 300)}`);
          await res.body?.cancel();
        } catch (err) {
          if (err instanceof S3Error) throw err;
          if (shard.primary && attempt === MAX_ATTEMPTS) throw err;
        }
        if (!shard.primary) {
          shard.alive = false;
          console.warn('dropped upload endpoint', shard.origin, status || 'network');
          continue;
        }
        if (attempt === MAX_ATTEMPTS) throw new S3Error(status, `S3 ${status}`);
        await sleep(Math.random() * BASE_BACKOFF_MS * 2 ** attempt++);
      }
    },
  };
}

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
