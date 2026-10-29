import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
const h = vi.hoisted(() => ({ auth: vi.fn(), send: vi.fn(), add: vi.fn(), fail: false, suppressed: false, contacts: [] as Record<string, unknown>[] }));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: h.auth }));
vi.mock('resend', () => ({ Resend: class { emails = { send: h.send }; } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => {
  const collection = (path: string): any => ({
    doc: (id: string) => ({ collection: (key: string) => collection(`${path}/${id}/${key}`), get: async () => {
      if (h.fail) throw new Error('offline');
      expect(id).toBe(createHash('sha256').update('member@example.org').digest('hex'));
      return { exists: h.suppressed, data: () => ({ emailHash: id, status: 'unsubscribed' }) };
    } }),
    where: (_field: string, _op: string, tenantId: string) => ({ get: async () => ({ docs: h.contacts.filter(data => data.tenantId === tenantId).map(data => ({ data: () => data })) }) }),
    add: h.add,
  });
  return { adminDb: { collection } };
});
import { POST } from './route';
const request = (to: unknown = ' MEMBER@example.org ') => new NextRequest('https://example.org/api/send-email', { method: 'POST', body: JSON.stringify({ to, subject: 'Hello', text: 'Hello' }) });
beforeEach(() => {
  vi.clearAllMocks(); h.fail = false; h.suppressed = false; h.contacts = [];
  h.auth.mockResolvedValue({ uid: 'owner', tenantId: 'target', isAdmin: true });
  h.send.mockResolvedValue({ data: { id: 'sent' } });
  vi.stubEnv('RESEND_API_KEY', 'test-key');
});
describe('individual and bulk-loop admin email privacy', () => {
  it('sends to an allowed address', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(h.send).toHaveBeenCalledOnce();
  });
  it.each(['suppression', 'left-contact'])('blocks a %s before provider or fallback writes', async kind => {
    if (kind === 'suppression') h.suppressed = true;
    else h.contacts = [{ tenantId: 'target', communityStatus: 'left', email: 'member@example.org' }];
    expect((await POST(request())).status).toBe(409);
    expect(h.send).not.toHaveBeenCalled(); expect(h.add).not.toHaveBeenCalled();
  });
  it('fails closed when the suppression read fails', async () => {
    h.fail = true;
    expect((await POST(request())).status).toBe(500);
    expect(h.send).not.toHaveBeenCalled(); expect(h.add).not.toHaveBeenCalled();
  });
  it('does not apply another ministry’s contact block', async () => {
    h.contacts = [{ tenantId: 'foreign', communityStatus: 'left', email: 'member@example.org' }];
    expect((await POST(request())).status).toBe(200);
  });
  it.each([['member@example.org', 'other@example.org'], 'member@example.org,other@example.org', 'Name <member@example.org>'])('rejects multi-recipient bypass %j', async to => {
    expect((await POST(request(to))).status).toBe(400);
    expect(h.send).not.toHaveBeenCalled();
  });
});
