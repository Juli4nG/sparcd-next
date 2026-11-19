import { AwsClient } from 'aws4fetch';

export type Config = {
  gate: boolean;
  endpoint: string;
  region: string;
  settingsBucket?: string;
  bucketPrefix?: string;
};

export class S3Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'S3Error';
  }
}

type Bytes = Uint8Array<ArrayBuffer>;

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MULTIPART_ABOVE = 16 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

const encode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const queryString = (query: Record<string, string>) => {
  const pairs = Object.entries(query).map(([k, v]) => (v === '' ? encode(k) : `${encode(k)}=${encode(v)}`));
  return pairs.length ? `?${pairs.join('&')}` : '';
};

export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ok(res: Response, ...allowed: number[]): Promise<Response> {
  if (res.ok || allowed.includes(res.status)) return res;
  throw new S3Error(res.status, `S3 ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const xmlValues = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) =>
    m[1].replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) =>
      e[0] !== '#' ? XML_ENTITIES[e] : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
    ),
  );

type SendOptions = {
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Bytes;
  /** Hex SHA-256 of `body`, when the caller already has it. */
  sha256?: string;
};

class Connection {
  readonly aws: AwsClient;

  constructor(
    readonly endpoint: string,
    region: string,
    login: string,
    password: string,
  ) {
    this.aws = new AwsClient({ accessKeyId: login, secretAccessKey: password, service: 's3', region, retries: 0 });
  }

  url(path: string, query: Record<string, string> = {}): string {
    return this.endpoint.replace(/\/+$/, '') + path + queryString(query);
  }

  /** Signs every header (the gate wants content-type signed) and a real body hash; retries network errors, 429 and 5xx. */
  async send(path: string, { method = 'GET', query, headers, body, sha256 }: SendOptions = {}): Promise<Response> {
    const hash = sha256 ?? (await sha256Hex(body ?? new Uint8Array()));
    for (let attempt = 1; ; attempt++) {
      const request = await this.aws.sign(this.url(path, query), {
        method,
        body,
        headers: { ...headers, 'x-amz-content-sha256': hash },
        aws: { allHeaders: true },
      });
      try {
        const res = await fetch(request);
        if ((res.status < 500 && res.status !== 429) || attempt === MAX_ATTEMPTS) return res;
        await res.body?.cancel();
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) throw err;
      }
      await sleep(Math.random() * BASE_BACKOFF_MS * 2 ** attempt);
    }
  }
}

export type PutOptions = {
  contentType: string;
  sha256?: string;
  /** Write-once: `If-None-Match: *`, and an existing object returns `'exists'`. */
  ifNoneMatch?: boolean;
};

export class Bucket {
  constructor(
    private readonly connection: Connection,
    readonly name: string,
  ) {}

  private path(key?: string): string {
    return `/${encode(this.name)}${key ? `/${key.split('/').map(encode).join('/')}` : ''}`;
  }

  /** Null when the object doesn't exist. */
  async getText(key: string): Promise<string | null> {
    const res = await ok(await this.connection.send(this.path(key)), 404);
    return res.status === 404 ? null : res.text();
  }

  /** `.csv` goes up as `text/csv; charset=utf-8`, anything else as `application/json`. */
  async putText(key: string, text: string): Promise<void> {
    const contentType = key.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json';
    await this.putObject(key, new TextEncoder().encode(text), { contentType });
  }

  async putObject(key: string, body: Blob | Bytes, opts: PutOptions): Promise<'stored' | 'exists'> {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer());
    if (bytes.byteLength > MULTIPART_ABOVE) return this.putMultipart(key, bytes, opts);
    const res = await ok(
      await this.connection.send(this.path(key), {
        method: 'PUT',
        headers: { 'content-type': opts.contentType, ...(opts.ifNoneMatch && { 'if-none-match': '*' }) },
        body: bytes,
        sha256: opts.sha256,
      }),
      412,
    );
    return res.status === 412 ? 'exists' : 'stored';
  }

  private async putMultipart(key: string, bytes: Bytes, opts: PutOptions): Promise<'stored' | 'exists'> {
    const path = this.path(key);
    const created = await ok(
      await this.connection.send(path, { method: 'POST', query: { uploads: '' }, headers: { 'content-type': opts.contentType } }),
    );
    const [uploadId] = xmlValues(await created.text(), 'UploadId');
    let outcome: 'stored' | 'exists' | undefined;
    try {
      const parts: string[] = [];
      for (let n = 1, at = 0; at < bytes.byteLength; n++, at += PART_SIZE) {
        const query = { partNumber: String(n), uploadId };
        const res = await ok(await this.connection.send(path, { method: 'PUT', query, body: bytes.subarray(at, at + PART_SIZE) }));
        parts.push(`<Part><PartNumber>${n}</PartNumber><ETag>${res.headers.get('etag')}</ETag></Part>`);
      }
      const res = await ok(
        await this.connection.send(path, {
          method: 'POST',
          query: { uploadId },
          headers: { 'content-type': 'application/xml', ...(opts.ifNoneMatch && { 'if-none-match': '*' }) },
          body: new TextEncoder().encode(`<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>`),
        }),
        412,
      );
      // CompleteMultipartUpload can fail with a 200 that carries an <Error> body.
      const text = await res.text();
      if (res.status === 200 && text.includes('<Error>')) throw new S3Error(500, `S3 multipart: ${text.slice(0, 300)}`);
      outcome = res.status === 412 ? 'exists' : 'stored';
    } finally {
      if (outcome !== 'stored') await this.connection.send(path, { method: 'DELETE', query: { uploadId } }).catch(() => {});
    }
    return outcome;
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token = '';
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
      const xml = await (await ok(await this.connection.send(this.path(), { query }))).text();
      keys.push(...xmlValues(xml, 'Key'));
      [token = ''] = xmlValues(xml, 'NextContinuationToken');
    } while (token);
    return keys;
  }

  /**
   * A presigned GET URL. `hourStable` floors X-Amz-Date to the hour so `<img>`
   * sources stay identical, and browser-cached, within the hour.
   */
  async presignGet(key: string, { expiresSeconds = 7200, hourStable = false } = {}): Promise<string> {
    const url = this.connection.url(this.path(key), { 'X-Amz-Expires': String(expiresSeconds) });
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const datetime = hourStable ? hour.toISOString().replace(/[:-]|\.\d{3}/g, '') : undefined;
    return (await this.connection.aws.sign(url, { method: 'GET', aws: { signQuery: true, datetime } })).url;
  }
}

/** `/config.json` at the origin; absent means a gate at this origin. */
export async function loadConfig(origin: string = location.origin): Promise<Config> {
  const res = await fetch(new URL('/config.json', origin));
  if (res.status === 404) return { gate: true, endpoint: origin, region: 'us-east-1' };
  return (await ok(res)).json();
}

export type Session = { name: string; code: string; bucket: Bucket; settings: Bucket };

const SIGNIN_KEY = 'sparcd-next.signin';

/** Throws `S3Error` with status 403 for a wrong login or password. */
export async function signIn(config: Config, login: string, password: string): Promise<Session> {
  login = login.trim().toLowerCase();
  password = password.trim();
  const connection = new Connection(config.endpoint, config.region, login, password);
  let who: { name: string; code: string; bucket: string; settingsBucket: string };
  if (config.gate) {
    who = await (await ok(await connection.send('/-/whoami'))).json();
  } else {
    who = { name: login, code: login, bucket: `${config.bucketPrefix}${login}`, settingsBucket: config.settingsBucket! };
    await ok(await connection.send(`/${encode(who.bucket)}`, { query: { 'list-type': '2', 'max-keys': '1' } }));
  }
  // Absent under Node (tests, scripts).
  globalThis.sessionStorage?.setItem(SIGNIN_KEY, JSON.stringify({ login, password }));
  return {
    name: who.name,
    code: who.code,
    bucket: new Bucket(connection, who.bucket),
    settings: new Bucket(connection, who.settingsBucket),
  };
}

/** Signs in again from this browser session's saved login, or returns null. */
export async function restoreSession(config: Config): Promise<Session | null> {
  const saved = globalThis.sessionStorage?.getItem(SIGNIN_KEY);
  if (!saved) return null;
  const { login, password } = JSON.parse(saved) as { login: string; password: string };
  try {
    return await signIn(config, login, password);
  } catch (err) {
    if (!(err instanceof S3Error && err.status === 403)) throw err;
    signOut();
    return null;
  }
}

export function signOut(): void {
  globalThis.sessionStorage?.removeItem(SIGNIN_KEY);
}
