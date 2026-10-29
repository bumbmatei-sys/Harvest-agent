import { beforeEach, describe, expect, it, vi } from 'vitest';
import { communitySuppressionId } from '@/lib/email/suppression-key';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({ auth: vi.fn(), listBlocks: vi.fn(), lastCheck: vi.fn(), send: vi.fn(), push: vi.fn(), people: [] as Record<string, unknown>[] }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: h.auth }));
vi.mock('@/lib/community-privacy', async () => ({ tenantBlockedEmailHashes: h.listBlocks, tenantAddressSuppressed: h.lastCheck, ...(await import('@/lib/email/suppression-key')) }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({ where: () => ({ get: async () => ({ forEach: (fn: (doc: unknown) => void) => h.people.forEach((data, i) => fn({ id: String(i), data: () => data })) }) }) }) } }));
vi.mock('firebase-admin', () => ({ messaging: () => ({ sendEachForMulticast: h.push }) }));
vi.mock('resend', () => ({ Resend: class { emails = { send: h.send }; } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
import { POST } from './route';
const request = () => new NextRequest('https://example.org/api/send-notification', { method: 'POST', body: JSON.stringify({ title: 'News', body: 'Hello' }) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('RESEND_API_KEY', 'test-key');
  h.auth.mockResolvedValue({ uid: 'owner', tenantId: 'target', isAdmin: true });
  h.listBlocks.mockResolvedValue(new Set([communitySuppressionId('left@example.org')]));
  h.lastCheck.mockResolvedValue(false);
  h.send.mockResolvedValue({ data: { id: 'sent' } });
  h.people = [{ email: ' LEFT@EXAMPLE.ORG ' }, { email: 'allowed@example.org' }];
});
describe('announcement email departure block', () => {
  it('skips the former member in a bulk announcement and delivers to allowed members', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ emailed: 1 });
    expect(h.listBlocks).toHaveBeenCalledExactlyOnceWith('target');
    expect(h.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: 'allowed@example.org' }));
  });
  it('rechecks before transport so a leave after audience resolution is respected', async () => {
    h.lastCheck.mockResolvedValue(true);
    expect((await POST(request())).status).toBe(200);
    expect(h.lastCheck).toHaveBeenCalledExactlyOnceWith('target', 'allowed@example.org');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('withholds delivery if the initial block-list read fails', async () => {
    h.listBlocks.mockRejectedValue(new Error('offline'));
    expect((await POST(request())).status).toBe(500);
    expect(h.send).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled();
  });
});
