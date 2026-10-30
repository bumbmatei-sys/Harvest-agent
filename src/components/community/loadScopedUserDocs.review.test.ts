import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadScopedUserDocs } from './loadScopedUserDocs';
const calls = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: calls.fetch }));
beforeEach(() => vi.resetAllMocks());
describe('scoped community picker', () => {
  it('uses the authenticated server projection and applies its cap after loading', async () => {
    calls.fetch.mockResolvedValue({ ok: true, json: async () => ({ people: ['legacy', 'joined', 'third'].map(id => ({ id, displayName: id, email: '', role: 'user' })) }) });
    const docs = await loadScopedUserDocs('harvest', true, 2);
    expect(calls.fetch).toHaveBeenCalledWith('/api/community/settings?tenantId=harvest&includeNull=true');
    expect(docs.map(doc => doc.id)).toEqual(['legacy', 'joined']);
    expect(docs[1].data()).toEqual({ displayName: 'joined', email: '', role: 'user' });
  });
  it('surfaces server refusal and malformed results instead of showing an empty list', async () => {
    calls.fetch.mockResolvedValueOnce({ ok: false });
    await expect(loadScopedUserDocs('a', false, 200)).rejects.toThrow('Could not load');
    calls.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ people: [{ id: 'u' }] }) });
    await expect(loadScopedUserDocs('a', false, 200)).rejects.toThrow('Invalid');
  });
});
