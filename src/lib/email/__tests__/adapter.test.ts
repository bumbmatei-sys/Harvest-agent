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

describe('plunk adapter (network mocked)', () => {
  it('sends with a bearer key and forwards the unsubscribe headers', async () => {
    const fetchImpl = fetchOnce(200, { id: 'p1' });
    const r = await createPlunkProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).send(message);
    expect(r).toEqual({ ok: true, id: 'p1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/send$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(String(init.body)).headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('marks 429 and 5xx retryable and 4xx not', async () => {
    const mk = (s: number) => createPlunkProvider({ apiKey: 'k', fetchImpl: fetchOnce(s) as unknown as typeof fetch }).send(message);
    expect(await mk(429)).toMatchObject({ ok: false, retryable: true });
    expect(await mk(503)).toMatchObject({ ok: false, retryable: true });
    expect(await mk(400)).toMatchObject({ ok: false, retryable: false });
  });

  it('a network error is a failed, retryable send, not a throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    expect(await createPlunkProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).send(message)).toMatchObject({ ok: false, retryable: true });
  });

  it('reads domain status and DNS records defensively', async () => {
    const fetchImpl = fetchOnce(200, { data: { verified: false, dnsRecords: [{ type: 'TXT', name: '_dk', value: 'v=1' }, { nope: 1 }] } });
    const s = await createPlunkProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).getDomainStatus('mail.grace.org');
    expect(s).toEqual({ domain: 'mail.grace.org', state: 'pending', records: [{ type: 'TXT', name: '_dk', value: 'v=1' }] });
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
