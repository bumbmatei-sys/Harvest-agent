import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createPlunkProvider } = await import('@/lib/email/plunk');
const { getEmailProvider, EmailNotConfiguredError, isEmailNotConfigured } = await import('@/lib/email/provider');
const { createSesProvider } = await import('@/lib/email/ses');

const message = {
  to: 'a@x.org', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', fromName: 'Grace', fromAddress: 'hello@mail.grace.org',
  replyTo: 'office@grace.org', headers: { 'List-Unsubscribe': '<https://u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
};

function fetchOnce(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

/** The success body of POST /v1/send, as Plunk's Actions controller writes it. */
const SENT = { success: true, data: { emails: [{ contact: { id: 'ct_1', email: 'a@x.org' }, email: 'em_123' }], timestamp: '2031-03-10T12:00:00.000Z' } };

/** A fake Plunk: routes by method and path, the way apps/api/src/controllers/Domains.ts does. */
function fakePlunk(rows: Record<string, unknown>[] = []) {
  const calls: { method: string; path: string; body: unknown; signal: AbortSignal | null | undefined }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://next-api.useplunk.com', '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : null, signal: init.signal });
    if (method === 'GET' && path === '/domains/project/current') return new Response(JSON.stringify(rows), { status: 200 });
    if (method === 'POST' && path === '/domains') {
      const { domain } = JSON.parse(String(init.body)) as { domain: string };
      if (rows.some((r) => r.domain === domain)) return new Response(JSON.stringify({ error: 'This domain is already linked to this project.' }), { status: 400 });
      const row = { id: 'dom_1', projectId: 'p', domain, verified: false, dkimTokens: ['t1', 't2', 't3'] };
      rows.push(row);
      return new Response(JSON.stringify(row), { status: 201 });
    }
    const verify = /^\/domains\/([^/]+)\/verify$/.exec(path);
    if (method === 'GET' && verify) {
      const row = rows.find((r) => r.id === verify[1]);
      return row
        ? new Response(JSON.stringify({ domain: row.domain, tokens: row.dkimTokens, status: row.verified ? 'Success' : 'Pending', verified: row.verified }), { status: 200 })
        : new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  });
  return { impl: impl as unknown as typeof fetch, calls, rows };
}

describe('plunk adapter (network mocked, shapes from Plunk\'s API source)', () => {
  it('sends to the next-api host with a bearer key, the object form of from, and the unsubscribe headers', async () => {
    const fetchImpl = fetchOnce(200, SENT);
    const r = await createPlunkProvider({ apiKey: 'sk_k', fetchImpl: fetchImpl as unknown as typeof fetch }).send(message);
    expect(r).toEqual({ ok: true, id: 'em_123' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://next-api.useplunk.com/v1/send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_k');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: 'a@x.org', subject: 'Hi', body: '<p>Hi</p>', from: { name: 'Grace', email: 'hello@mail.grace.org' }, reply: 'office@grace.org' });
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('does not set subscribed, so Plunk keeps its own bounce and unsubscribe state for the address', async () => {
    const fetchImpl = fetchOnce(200, SENT);
    await createPlunkProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).send(message);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty('subscribed');
  });

  it('strips line breaks from the subject and sender name, which Plunk rejects', async () => {
    const fetchImpl = fetchOnce(200, SENT);
    await createPlunkProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).send({ ...message, subject: 'Hi\r\nBcc: x@y.z', fromName: 'Grace\nChurch' });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.subject).toBe('Hi Bcc: x@y.z');
    expect(body.from.name).toBe('Grace Church');
  });

  it('marks 429 and 5xx retryable and 4xx not, and names Plunk\'s error code', async () => {
    const mk = (s: number, body: unknown = {}) => createPlunkProvider({ apiKey: 'k', fetchImpl: fetchOnce(s, body) as unknown as typeof fetch }).send(message);
    expect(await mk(429)).toMatchObject({ ok: false, retryable: true });
    expect(await mk(503)).not.toHaveProperty('maybeDelivered');
    expect(await mk(503)).toMatchObject({ ok: false, retryable: true });
    expect(await mk(403, { success: false, error: { code: 'DOMAIN_NOT_VERIFIED', message: 'x', statusCode: 403 } })).toEqual({ ok: false, error: 'Plunk answered 403 (DOMAIN_NOT_VERIFIED).', retryable: false });
  });

  it('a network error is a failed, retryable send, not a throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    expect(await createPlunkProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).send(message)).toMatchObject({ ok: false, retryable: true });
  });

  describe('timeouts', () => {
    /** A server that never answers; it only gives up when the request is aborted. */
    const hang = () => vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));

    it('every request carries an abort signal', async () => {
      const f = fakePlunk([{ id: 'dom_1', domain: 'mail.grace.org', verified: true, dkimTokens: [] }]);
      const p = createPlunkProvider({ apiKey: 'k', fetchImpl: f.impl });
      await p.send(message).catch(() => undefined);
      await p.findDomain('mail.grace.org');
      await p.registerDomain('mail.grace.org');
      await p.getDomainStatus('mail.grace.org');
      expect(f.calls.length).toBeGreaterThanOrEqual(4);
      for (const c of f.calls) expect(c.signal, `${c.method} ${c.path} has no timeout`).toBeInstanceOf(AbortSignal);
    });

    it('a send that never answers fails as a retryable, timed-out send', async () => {
      const r = await createPlunkProvider({ apiKey: 'k', fetchImpl: hang() as unknown as typeof fetch, timeoutMs: 20 }).send(message);
      expect(r).toMatchObject({ ok: false, retryable: true, maybeDelivered: true, error: expect.stringMatching(/did not answer/) });
    });

    it('a domain call that never answers throws a typed timeout, which the route answers as 502', async () => {
      const p = createPlunkProvider({ apiKey: 'k', fetchImpl: hang() as unknown as typeof fetch, timeoutMs: 20 });
      for (const run of [() => p.findDomain('mail.grace.org'), () => p.registerDomain('mail.grace.org'), () => p.getDomainStatus('mail.grace.org')]) {
        await expect(run()).rejects.toMatchObject({ name: 'EmailProviderError', kind: 'timeout' });
      }
    });

    it('a body that stalls after the headers is cut off too', async () => {
      const stall = vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason)); } });
        return new Response(body, { status: 200 });
      });
      await expect(createPlunkProvider({ apiKey: 'k', fetchImpl: stall as unknown as typeof fetch, timeoutMs: 20 }).findDomain('mail.grace.org'))
        .rejects.toMatchObject({ kind: 'timeout' });
    });
  });

  describe('domains', () => {
    it('findDomain reads the project list and registers nothing', async () => {
      const f = fakePlunk([{ id: 'd1', domain: 'mail.grace.org', verified: true, dkimTokens: ['a'] }]);
      const p = createPlunkProvider({ apiKey: 'k', fetchImpl: f.impl });
      expect(await p.findDomain('mail.grace.org')).toMatchObject({ domain: 'mail.grace.org', state: 'verified' });
      expect(await p.findDomain('mail.other.org')).toBeNull();
      expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
    });

    it('registers a new domain and turns the DKIM tokens into CNAME records', async () => {
      const f = fakePlunk();
      const s = await createPlunkProvider({ apiKey: 'k', fetchImpl: f.impl }).registerDomain('mail.grace.org');
      expect(s).toEqual({
        domain: 'mail.grace.org',
        state: 'pending',
        records: [
          { type: 'CNAME', name: 't1._domainkey.mail.grace.org', value: 't1.dkim.amazonses.com' },
          { type: 'CNAME', name: 't2._domainkey.mail.grace.org', value: 't2.dkim.amazonses.com' },
          { type: 'CNAME', name: 't3._domainkey.mail.grace.org', value: 't3.dkim.amazonses.com' },
        ],
      });
      expect(f.calls.find((c) => c.method === 'POST')?.body).toEqual({ domain: 'mail.grace.org' });
    });

    it('registering twice does not trip over Plunk\'s "already linked" refusal', async () => {
      const f = fakePlunk();
      const p = createPlunkProvider({ apiKey: 'k', fetchImpl: f.impl });
      await p.registerDomain('mail.grace.org');
      expect(await p.registerDomain('mail.grace.org')).toMatchObject({ state: 'pending' });
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });

    it('checks an existing domain through GET /domains/:id/verify and reports verified', async () => {
      const f = fakePlunk([{ id: 'd1', domain: 'mail.grace.org', verified: true, dkimTokens: ['a'] }]);
      const s = await createPlunkProvider({ apiKey: 'k', fetchImpl: f.impl }).getDomainStatus('mail.grace.org');
      expect(s).toMatchObject({ state: 'verified' });
      expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /domains/project/current', 'GET /domains/d1/verify']);
    });

    it('maps Plunk\'s Failed status to failed', async () => {
      const impl = vi.fn(async (url: string) => (url.endsWith('/domains/project/current')
        ? new Response(JSON.stringify([{ id: 'd1', domain: 'mail.grace.org', verified: false, dkimTokens: [] }]))
        : new Response(JSON.stringify({ domain: 'mail.grace.org', tokens: [], status: 'Failed', verified: false }))));
      expect(await createPlunkProvider({ apiKey: 'k', fetchImpl: impl as unknown as typeof fetch }).getDomainStatus('mail.grace.org')).toMatchObject({ state: 'failed' });
    });

    it('an unexpected response is a typed error, not a silent "pending"', async () => {
      await expect(createPlunkProvider({ apiKey: 'k', fetchImpl: fetchOnce(200, { nope: 1 }) as unknown as typeof fetch }).findDomain('mail.grace.org')).rejects.toMatchObject({ name: 'EmailProviderError' });
      await expect(createPlunkProvider({ apiKey: 'k', fetchImpl: fetchOnce(500) as unknown as typeof fetch }).findDomain('mail.grace.org')).rejects.toMatchObject({ name: 'EmailProviderError', status: 500 });
    });
  });
});

describe('provider selection', () => {
  it('a missing key is EmailNotConfiguredError, which routes answer as 503', async () => {
    await expect(getEmailProvider({})).rejects.toBeInstanceOf(EmailNotConfiguredError);
    await expect(getEmailProvider({ PLUNK_API_KEY: '  ' })).rejects.toSatisfy(isEmailNotConfigured);
  });

  it('the SES stub refuses rather than pretending to send', async () => {
    await expect(createSesProvider().send(message)).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});
