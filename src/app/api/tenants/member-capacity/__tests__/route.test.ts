import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-201 / AC-15 — POST /api/tenants/member-capacity, the signup pre-flight.
 *
 * 🔴 This route is a UX AFFORDANCE, not the enforcement. It exists so a real
 * person never ends up with a half-created account. The gate is
 * `POST /api/auth/set-claims`.
 *
 * What these tests pin:
 *  • it answers a QUESTION, so a refusal is 200 with `canAccept: false` — a 403
 *    would be indistinguishable from an auth failure and would tempt a
 *    catch-to-default in the client;
 *  • a bad body is 400 and issues NO query;
 *  • a failed check is 503, never a silent yes;
 *  • the body leaks NO count, cap, plan, add-on set or tenant name field.
 */

const h = vi.hoisted(() => ({
  canTenantAcceptNewMember: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('@/lib/member-capacity', () => ({
  canTenantAcceptNewMember: h.canTenantAcceptNewMember,
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: h.capture }));

const { POST } = await import('../route');

const post = (body: unknown, raw?: string) =>
  new NextRequest('https://gracechurch.theharvest.app/api/tenants/member-capacity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.canTenantAcceptNewMember.mockResolvedValue({ status: 'allowed', cap: 500, othersCount: 3 });
});

// ── AC-15 ── validation, and no query on a bad body ─────────────────────────
describe('validation', () => {
  it.each([
    ['an empty object', {}],
    ['a blank tenantId', { tenantId: '' }],
    ['a whitespace tenantId', { tenantId: '   ' }],
    ['a numeric tenantId', { tenantId: 123 }],
    ['a null tenantId', { tenantId: null }],
    ['an array body', []],
  ])('returns 400 for %s and asks the decision nothing', async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'tenantId required' });
    expect(h.canTenantAcceptNewMember).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-JSON body rather than falling through to a yes', async () => {
    const res = await POST(post(undefined, 'not json at all'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'tenantId required' });
    expect(h.canTenantAcceptNewMember).not.toHaveBeenCalled();
  });

  it('passes a valid tenantId straight through, unmodified', async () => {
    await POST(post({ tenantId: 'gracechurch' }));
    expect(h.canTenantAcceptNewMember).toHaveBeenCalledTimes(1);
    expect(h.canTenantAcceptNewMember).toHaveBeenCalledWith('gracechurch');
  });
});

// ── the three answers ───────────────────────────────────────────────────────
describe('the answer', () => {
  it('200 { canAccept: true } when the tenant has room', async () => {
    const res = await POST(post({ tenantId: 'gracechurch' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ canAccept: true });
  });

  it.each([
    ['no-tenant'],
    ['existing-member'],
    ['unlimited-addon'],
    ['unlimited-sentinel'],
  ])('200 { canAccept: true } for every skipped reason (%s)', async (reason) => {
    h.canTenantAcceptNewMember.mockResolvedValue({ status: 'skipped', reason });
    const res = await POST(post({ tenantId: 'gracechurch' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ canAccept: true });
  });

  it('200 — NOT 403 — with canAccept:false when the tenant is at its cap', async () => {
    h.canTenantAcceptNewMember.mockResolvedValue({
      status: 'refused',
      cap: 150,
      othersCount: 150,
      ministryName: 'Grace Church',
    });

    const res = await POST(post({ tenantId: 'gracechurch' }));
    // This route refuses nothing; it answers a question. The answer is in the
    // body and the client must read it.
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.canAccept).toBe(false);
    expect(body.code).toBe('member_cap_reached');
    expect(body.message).toContain('Grace Church');
  });

  it('503 with the unavailable copy when the check could not run (C3/C4)', async () => {
    h.canTenantAcceptNewMember.mockResolvedValue({
      status: 'unavailable',
      reason: 'count-failed',
    });

    const res = await POST(post({ tenantId: 'gracechurch' }));
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.canAccept).toBe(false);
    expect(body.code).toBe('capacity_check_unavailable');
    // It does NOT say the ministry is full — we do not know that.
    expect(body.message).not.toMatch(/full|capacity|limit|invited/i);
  });

  it('503, never a silent yes, when the decision itself throws', async () => {
    h.canTenantAcceptNewMember.mockRejectedValue(new Error('unexpected'));

    const res = await POST(post({ tenantId: 'gracechurch' }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      canAccept: false,
      code: 'capacity_check_unavailable',
    });
    expect(h.capture).toHaveBeenCalledTimes(1);
  });
});

// ── information disclosure ──────────────────────────────────────────────────
describe('the response leaks nothing about the tenant', () => {
  it('carries no count, cap, plan, addon set or tenant name field', async () => {
    h.canTenantAcceptNewMember.mockResolvedValue({
      status: 'refused',
      cap: 150,
      othersCount: 150,
      ministryName: 'Grace Church',
    });

    const body = await (await POST(post({ tenantId: 'gracechurch' }))).json();

    // The message already carries the ministry name where one exists; nothing
    // else may. An anonymous prober learns only what they would learn by
    // trying to sign up.
    expect(Object.keys(body).sort()).toEqual(['canAccept', 'code', 'message']);
    expect(body).not.toHaveProperty('cap');
    expect(body).not.toHaveProperty('othersCount');
    expect(body).not.toHaveProperty('plan');
    expect(body).not.toHaveProperty('addons');
    expect(body.message).not.toMatch(/\b150\b/);
  });
});
