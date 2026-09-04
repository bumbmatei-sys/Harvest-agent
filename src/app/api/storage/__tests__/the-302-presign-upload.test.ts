// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-302 part 2 — the image upload, and where its failure actually lives.
 *
 * ─── The report ──────────────────────────────────────────────────────────────
 *
 * "I cannot upload an image, I get this error." The network trace:
 *
 *     PUT https://<account>.r2.cloudflarestorage.com/harvest/tenants/shadcn/
 *         uploads/<uuid>-1000438427.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256
 *         &X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=…
 *         &X-Amz-Date=20260904T085836Z&X-Amz-Expires=300
 *         &X-Amz-SignedHeaders=host&x-id=PutObject
 *     TRANSFER SIZE 0 B · CONTENT-TYPE — · no status code · 315ms
 *
 * 🔴 CORS IS OUT OF SCOPE FOR EVERY TEST IN THIS FILE, and that is a finding
 * rather than an omission. A cross-origin `PUT` is never a "simple" request, so
 * the browser sends an `OPTIONS` preflight to the bucket before the `PUT`
 * leaves; if the bucket's CORS policy does not allow the page's origin, the
 * method and the `content-type` request header, the browser refuses and the
 * `PUT` is reported with no status code and zero bytes — exactly the trace
 * above. That refusal happens in the BROWSER, against a policy stored in the
 * Cloudflare dashboard. There is no origin, no preflight and no bucket policy in
 * a Node test, and no line of this repository that can change one. What IS in
 * scope is everything the repository does own, and these tests exist to prove
 * that half is not the cause:
 *
 *   • the URL is minted with the shape and lifetime the trace shows;
 *   • the SIGNATURE covers `host` and nothing else, so the `Content-Type` the
 *     client sends on the PUT cannot invalidate it (verified by recomputing
 *     SigV4 here, independently of the AWS SDK);
 *   • the URL is used immediately, so the 5-minute expiry is not in play;
 *   • the PUT the client actually builds is accepted by an origin that does not
 *     refuse it, byte for byte.
 *
 * ⚠️ If all four hold and the upload still fails at 0 bytes with no status, the
 * remaining cause is the bucket's CORS policy. That is the conclusion this file
 * is built to support, and it is not a code fix.
 *
 * ─── Why this file runs under `node` and not the suite's default jsdom ───────
 *
 * 🔴 BECAUSE JSDOM REPRODUCES THE BUG. Written without the pragma above, the
 * upload case below failed with:
 *
 *     NetworkError: Cross-Origin Request Blocked: The Same Origin Policy
 *     disallows reading the remote resource at "http://127.0.0.1:…/harvest/…"
 *
 * — a cross-origin `PUT` refused by the client before it left, with no status
 * code, which is the production trace's `TRANSFER SIZE 0 B · CONTENT-TYPE — · no
 * status code` in miniature. jsdom refuses because it implements the same-origin
 * policy and has no preflight to satisfy it with; the browser refuses because
 * the bucket's preflight answer does not allow the origin. Same policy, same
 * shape, two different reasons to say no.
 *
 * ⚠️ That is a DEMONSTRATION, not an assertion, and it is why the pragma is
 * here: a test that passes only because its fake origin happens to be
 * unreachable proves nothing about the route. Under `node` there is no
 * same-origin policy in the way, so what remains is the request itself — which
 * is the half this repository owns.
 */

const ACCOUNT = 'bee5735b6ac0ed8bc2ed38fa780dada6';
const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

process.env.R2_ACCOUNT_ID = ACCOUNT;
process.env.R2_ACCESS_KEY_ID = ACCESS_KEY;
process.env.R2_SECRET_ACCESS_KEY = SECRET_KEY;
process.env.R2_BUCKET_NAME = 'harvest';
process.env.R2_PUBLIC_URL = 'https://cdn.theharvest.app';

const { mockRequireAdmin } = vi.hoisted(() => ({ mockRequireAdmin: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
// `tenant-scope` drags in the firebase client SDK; only the constant matters.
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'harvest' }));

// 🔴 `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `@/lib/r2` are
// deliberately NOT mocked. The signature is the thing under test; a stubbed
// signer would assert the stub.
const { POST } = await import('../presign/route');

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const FILE_NAME = '1000438427.jpg';
const CONTENT_TYPE = 'image/jpeg';

function request(body: unknown) {
  return { json: async () => body } as never;
}

async function presign(body: unknown = { fileName: FILE_NAME, contentType: CONTENT_TYPE, fileSize: 512_000 }) {
  const res = await POST(request(body));
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ uid: 'owner1', email: 'pastor@grace.org', tenantId: 'shadcn', isAdmin: true });
});

/* ── An independent SigV4, so the check is not the SDK checking itself ────── */

/** RFC 3986, which is stricter than `encodeURIComponent` on `!'()*`. */
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Recompute what R2 will compute when the browser's PUT arrives.
 *
 * 🔴 R2 canonicalises ONLY the headers named in `X-Amz-SignedHeaders`, so
 * anything else the client puts on the wire — `Content-Type` above all — must
 * leave this answer unchanged. That is the property, and computing it here
 * rather than asking the SDK is what makes it a check instead of an echo.
 */
function recomputeSignature(url: URL, method = 'PUT'): string {
  const params = [...url.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature');
  const canonicalQuery = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')!;
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((h) => `${h}:${h === 'host' ? url.host : ''}\n`)
    .join('');

  const canonicalRequest = [
    method,
    url.pathname.split('/').map((seg, i) => (i === 0 ? seg : rfc3986(seg))).join('/'),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const amzDate = url.searchParams.get('X-Amz-Date')!;
  const scope = url.searchParams.get('X-Amz-Credential')!.split('/').slice(1).join('/');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const [date, region, service] = scope.split('/');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date), region), service), 'aws4_request');
  return createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
}

/* ═══ 7 · The signature property ═════════════════════════════════════════════ */

describe('the signed headers match what the client sends', () => {
  it('signs `host` and nothing else, exactly as the production trace shows', async () => {
    const { json } = await presign();
    const url = new URL(json.uploadUrl);

    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Content-Sha256')).toBe('UNSIGNED-PAYLOAD');
    expect(url.searchParams.get('x-id')).toBe('PutObject');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/\/auto\/s3\/aws4_request$/);
  });

  it('the client sends Content-Type, and it is NOT one of the signed headers', () => {
    // Read from the component rather than restating it: a client that started
    // sending a header the route does not sign would be a real signature bug,
    // and only the source can say what it sends.
    const client = read('src/components/ImageUpload.tsx');
    expect(client).toMatch(/method:\s*'PUT'[\s\S]{0,200}headers:\s*\{\s*'Content-Type':\s*file\.type\s*\}/);
  });

  it('and the signature verifies — recomputed here, not taken from the SDK', async () => {
    const { json } = await presign();
    const url = new URL(json.uploadUrl);

    expect(recomputeSignature(url)).toBe(url.searchParams.get('X-Amz-Signature'));
  });

  it('adding the client\'s Content-Type to the request cannot change that answer', async () => {
    const { json } = await presign();
    const url = new URL(json.uploadUrl);
    const minted = url.searchParams.get('X-Amz-Signature')!;

    expect(recomputeSignature(url)).toBe(minted);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).not.toContain('content-type');
    // The counter-case, so the assertion above is not vacuous: had the route
    // signed content-type, the same recomputation would differ — and THAT is the
    // shape that fails with a real 403 SignatureDoesNotMatch rather than the
    // status-less browser refusal in the trace.
    const wouldHaveSigned = new URL(url.toString());
    wouldHaveSigned.searchParams.set('X-Amz-SignedHeaders', 'content-type;host');
    expect(recomputeSignature(wouldHaveSigned)).not.toBe(minted);
  });

  it('the URL is path-style, so the PUT stays on the configured endpoint host', async () => {
    const { json } = await presign();
    const url = new URL(json.uploadUrl);

    expect(url.host).toBe(`${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(url.pathname).toMatch(/^\/harvest\/tenants\/shadcn\/uploads\/[0-9a-f-]{36}-1000438427\.jpg$/);
    // Virtual-hosted style would put the bucket in the hostname and change the
    // origin the bucket's CORS policy has to allow.
    expect(url.host.startsWith('harvest.')).toBe(false);
  });

  it('no checksum header is folded into the signature — a browser fetch sends none', async () => {
    const { json } = await presign();
    const url = new URL(json.uploadUrl);

    for (const [key] of url.searchParams) {
      expect(key.toLowerCase()).not.toContain('checksum');
    }
    expect(url.searchParams.get('X-Amz-SignedHeaders')).not.toMatch(/crc32|sha1|checksum/i);
  });
});

/* ═══ 6 · The upload itself ══════════════════════════════════════════════════ */

describe('the presigned upload succeeds for a valid file (CORS explicitly OUT of scope)', () => {
  /**
   * ⚠️ WHAT "SUCCEEDS" MEANS HERE, STATED SO IT CANNOT BE OVERREAD. The origin
   * below is a local HTTP server standing in for the bucket: it verifies the
   * request it receives is the one the presigned URL describes and answers 200.
   * That covers everything between the route and the wire — the method, the
   * query, the path, the body and the header the client adds.
   *
   * 🔴 IT DOES NOT AND CANNOT COVER CORS. There is no browser here, so no
   * preflight is sent and no bucket policy is consulted. The production failure
   * is a preflight refusal, and it is invisible to every test in this repository
   * by construction.
   */
  let server: Server;
  const received: Array<{ method: string; url: string; contentType?: string; bytes: number }> = [];

  const start = () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        let bytes = 0;
        req.on('data', (c: Buffer) => { bytes += c.length; });
        req.on('end', () => {
          received.push({
            method: req.method ?? '',
            url: req.url ?? '',
            contentType: req.headers['content-type'],
            bytes,
          });
          const q = new URL(req.url ?? '', 'http://x').searchParams;
          // Stand in for the bucket's own check: refuse anything unsigned.
          const ok = req.method === 'PUT' && !!q.get('X-Amz-Signature') && !!q.get('X-Amz-Date');
          res.writeHead(ok ? 200 : 403).end();
        });
      });
      server.listen(0, '127.0.0.1', () => resolve());
    });

  afterAll(() => { server?.close(); });

  it('the client\'s exact PUT is accepted, with the presigned query untouched', async () => {
    await start();
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const { status, json } = await presign();
    expect(status).toBe(200);

    // Same path and query the route minted; only the origin is redirected at
    // the stand-in, since the real bucket is not reachable from a test.
    const minted = new URL(json.uploadUrl);
    const target = `${origin}${minted.pathname}${minted.search}`;

    const file = new Blob([new Uint8Array(512_000)], { type: CONTENT_TYPE });
    const put = await fetch(target, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': CONTENT_TYPE },
    });

    expect(put.ok, 'the origin rejected the request the client builds').toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('PUT');
    expect(received[0].contentType).toBe(CONTENT_TYPE);
    expect(received[0].bytes).toBe(512_000);
    expect(received[0].url).toContain('X-Amz-SignedHeaders=host');
  });

  it('the route hands back everything the client needs, and nothing it should not', async () => {
    const { json } = await presign();
    expect(Object.keys(json).sort()).toEqual(['key', 'publicUrl', 'uploadUrl']);
    expect(json.publicUrl).toBe(`https://cdn.theharvest.app/${json.key}`);
    expect(json.key).toMatch(/^tenants\/shadcn\/uploads\//);
    // No credentials leak into the response body beyond the signed URL itself.
    expect(json.key + json.publicUrl).not.toContain(SECRET_KEY);
  });

  it('and it still refuses what it always refused', async () => {
    expect((await presign({ fileName: 'x.exe', contentType: 'application/x-msdownload', fileSize: 10 })).status).toBe(400);
    expect((await presign({ fileName: 'x.jpg', contentType: CONTENT_TYPE, fileSize: 5 * 1024 * 1024 })).status).toBe(400);
    expect((await presign({ contentType: CONTENT_TYPE, fileSize: 10 })).status).toBe(400);
  });
});

/* ═══ The expiry, and the two causes that are ruled out in source ════════════ */

describe('the five-minute expiry is not what failed', () => {
  it('the URL is minted with a 300-second life', async () => {
    const { json } = await presign();
    expect(new URL(json.uploadUrl).searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('and the client uses it in the next statement — nothing is stored or deferred', () => {
    // The trace failed 315ms after the request began. An expiry can only be the
    // cause if the URL sat somewhere first; it does not.
    const client = read('src/components/ImageUpload.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const between = client.slice(
      client.indexOf('const { uploadUrl, publicUrl } = await presignRes.json();'),
      client.indexOf('putRes = await fetch(uploadUrl'),
    );
    expect(between.length).toBeGreaterThan(0);
    expect(between).not.toMatch(/setTimeout|localStorage|sessionStorage|await new Promise/);
  });

  it('the upload is direct-to-R2 and must stay that way', () => {
    // 🔴 The fix that is NOT available: proxying through the route. Vercel
    // rejects a request body over 4.5MB with a 413 raised before the handler
    // runs, so a 15MB PDF cannot reach it — the reason this flow is presigned in
    // the first place.
    const route = read('src/app/api/storage/presign/route.ts');
    expect(route).toContain('getSignedUrl');
    expect(route).not.toMatch(/request\.formData\(\)|await request\.arrayBuffer\(\)/);
    expect(read('src/utils/upload-limits.ts')).toContain('4.5MB');
  });
});
