// A path-style S3 stand-in for `fetch`: objects in a Map, enough of
// ListObjectsV2 and multipart for the client, every request recorded.
export function fakeS3() {
  const objects = new Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }>();
  const parts = new Map<string, Uint8Array[]>();
  const requests: { method: string; url: URL; headers: Headers; body: Uint8Array }[] = [];
  const failures: number[] = [];
  const xml = (s: string) => new Response(s, { headers: { 'content-type': 'application/xml' } });

  async function fetch(input: Request): Promise<Response> {
    const url = new URL(input.url);
    const body = new Uint8Array(await input.arrayBuffer());
    requests.push({ method: input.method, url, headers: input.headers, body });
    const status = failures.shift();
    if (status) return new Response('fail', { status });
    if (url.pathname === '/-/whoami') {
      return Response.json({ name: 'Ana', code: 'ana', bucket: 'sparcd-next-ana', settingsBucket: 'sparcd-next-settings' });
    }
    const [, bucket, ...rest] = url.pathname.split('/').map(decodeURIComponent);
    const key = `${bucket}/${rest.join('/')}`;
    const q = url.searchParams;
    if (input.method === 'GET' && rest.length === 0) {
      const prefix = `${bucket}/${q.get('prefix') ?? ''}`;
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(q.get('continuation-token') ?? 0);
      const page = all.slice(start, start + 2);
      const next = start + 2 < all.length ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : '';
      const keys = page.map((k) => `<Contents><Key>${k.slice(bucket.length + 1).replace(/&/g, '&amp;')}</Key></Contents>`);
      return xml(`<ListBucketResult>${keys.join('')}${next}</ListBucketResult>`);
    }
    if (input.method === 'GET') {
      const o = objects.get(key);
      return o ? new Response(o.body) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    }
    const exists = input.headers.get('if-none-match') === '*' && objects.has(key);
    if (input.method === 'POST' && q.has('uploads')) {
      parts.set('u1', []);
      return xml(`<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>`);
    }
    if (input.method === 'PUT' && q.has('partNumber')) {
      parts.get(q.get('uploadId')!)![Number(q.get('partNumber')) - 1] = body;
      return new Response('', { headers: { etag: `"part${q.get('partNumber')}"` } });
    }
    if (input.method === 'POST' && q.has('uploadId')) {
      if (exists) return new Response('', { status: 412 });
      const whole = new Uint8Array(await new Blob(parts.get(q.get('uploadId')!)! as BlobPart[]).arrayBuffer());
      objects.set(key, { body: whole, contentType: 'multipart' });
      return xml('<CompleteMultipartUploadResult/>');
    }
    if (input.method === 'DELETE') return new Response(null, { status: 204 });
    if (exists) return new Response('', { status: 412 });
    objects.set(key, { body, contentType: input.headers.get('content-type') ?? '' });
    return new Response('');
  }

  const text = (key: string) => new TextDecoder().decode(objects.get(key)?.body);
  return { objects, requests, failures, fetch, text };
}
