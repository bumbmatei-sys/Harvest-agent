import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-251 — an admin can record a gift Harvest never processed, and doing so
 * can never double-count, never overwrite, and never reach a giving statement.
 *
 * Run against a STATEFUL Firestore double, the same shape
 * `webhook-campaign-credit-idempotency.test.ts` uses: `store` really holds
 * documents, `runTransaction` really reads and writes them, and
 * `FieldValue.increment` is really applied — so `campaigns/camp1.raised` is an
 * actual running total rather than a count of update() calls. An adjustment
 * that overwrote instead of incrementing shows up as 250 where 1250 is correct.
 */

const { store, authResult, tenantFeaturesFn } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  authResult: {
    current: { uid: 'admin1', email: 'pastor@grace.example', tenantId: 't1', isAdmin: true, isSuperAdmin: false, authTime: 0 } as any,
  },
  tenantFeaturesFn: vi.fn((data: any) => ({ fundraising: data?.plan !== 'free' })),
}));

let addCounter = 0;

/** Apply a write payload to a stored doc, honouring the FieldValue sentinels. */
function applyData(existing: any, data: any): any {
  const next = { ...(existing || {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && '__increment' in (v as any)) {
      next[k] = (typeof next[k] === 'number' ? next[k] : 0) + (v as any).__increment;
    } else {
      next[k] = v;
    }
  }
  return next;
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split('/').pop() }),
    set: async (data: any) => { store.set(path, applyData(undefined, data)); },
    update: async (data: any) => { store.set(path, applyData(store.get(path), data)); },
    collection: (sub: string) => makeCollRef(`${path}/${sub}`),
  };
}

function makeCollRef(path: string): any {
  return {
    doc: (id?: string) => makeDocRef(`${path}/${id ?? `gen${++addCounter}`}`),
  };
}

/**
 * A transaction that is all-or-nothing, so "the audit row and the increment land
 * together or not at all" is a claim these tests can actually falsify: the
 * staged ops are applied on success and discarded on a throw.
 */
async function runTransaction(fn: (tx: any) => Promise<any>): Promise<any> {
  const ops: Array<{ type: 'set' | 'update'; ref: any; data: any }> = [];
  const tx = {
    get: async (ref: any) => ref.get(),
    set: (ref: any, data: any) => { ops.push({ type: 'set', ref, data }); },
    update: (ref: any, data: any) => { ops.push({ type: 'update', ref, data }); },
  };
  const snapshot = new Map(store);
  try {
    const result = await fn(tx);
    for (const op of ops) {
      if (op.type === 'set') await op.ref.set(op.data);
      else await op.ref.update(op.data);
    }
    return result;
  } catch (e) {
    store.clear();
    for (const [k, v] of snapshot) store.set(k, v);
    throw e;
  }
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeCollRef(name),
    runTransaction: (fn: any) => runTransaction(fn),
  },
  adminAuth: { verifyIdToken: vi.fn() },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

vi.mock('@/lib/api-auth', () => ({
  requireTenantPermission: vi.fn(async () => authResult.current),
}));

vi.mock('@/lib/tenant-features', () => ({
  tenantFeatures: (data: any) => tenantFeaturesFn(data),
}));

const { POST } = await import('../adjust-raised/route');

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://grace.example/api/campaigns/adjust-raised', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  });
}

const raised = () => store.get('campaigns/camp1')?.raised;

/** Every adjustment row written under the campaign, oldest id first. */
const adjustments = () =>
  [...store.entries()]
    .filter(([k]) => k.startsWith('campaigns/camp1/adjustments/'))
    .map(([, v]) => v);

/** Anything written anywhere that looks like an invoice. */
const invoicePaths = () => [...store.keys()].filter((k) => k.includes('invoice'));

beforeEach(() => {
  store.clear();
  addCounter = 0;
  vi.clearAllMocks();
  tenantFeaturesFn.mockImplementation((data: any) => ({ fundraising: data?.plan !== 'free' }));
  authResult.current = {
    uid: 'admin1', email: 'pastor@grace.example', tenantId: 't1',
    isAdmin: true, isSuperAdmin: false, authTime: 0,
  };
  store.set('tenants/t1', { plan: 'plus', name: 'Grace Chapel' });
  store.set('campaigns/camp1', { tenantId: 't1', title: 'Roof Fund', goal: 50_000, raised: 1000 });
});

describe('an admin can add an offline gift to a campaign’s raised amount', () => {
  it('records the gift and returns the new total', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, raised: 1250 });
    expect(raised()).toBe(1250);
  });

  it('accepts the amount as a string, the way an input hands it over', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: '250.50' }));
    expect(res.status).toBe(200);
    expect(raised()).toBe(1250.5);
  });

  it('refuses an amount that is not a number, rather than recording NaN', async () => {
    // "1,200" is the realistic typo; `parseFloat` would have recorded $1.
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: '1,200' }));
    expect(res.status).toBe(400);
    expect(raised()).toBe(1000);
  });

  it('refuses zero, so no audit row is written for money that never moved', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 0 }));
    expect(res.status).toBe(400);
    expect(adjustments()).toHaveLength(0);
  });

  it('refuses a campaign belonging to another tenant', async () => {
    store.set('campaigns/camp2', { tenantId: 't2', goal: 1000, raised: 500 });
    const res = await POST(post({ campaignId: 'camp2', tenantId: 't1', amountDollars: 100 }));
    expect(res.status).toBe(404);
    expect(store.get('campaigns/camp2').raised).toBe(500);
  });
});

describe('the adjustment increments and never overwrites', () => {
  it('adds to the existing total instead of replacing it', async () => {
    // 🔴 The double-count guard. A route that SET the total would leave 250
    // here; the whole design rests on this being 1250.
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    expect(raised()).toBe(1250);
  });

  it('accumulates across repeated adjustments', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 100 }));
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 25 }));
    expect(raised()).toBe(1375);
    expect(adjustments()).toHaveLength(3);
  });

  it('writes the increment through FieldValue.increment, not a computed literal', async () => {
    const { FieldValue } = await import('firebase-admin/firestore');
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    // The sentinel is what makes the write additive at the DATABASE, so a Stripe
    // gift landing between this route's read and its commit is not lost.
    expect(FieldValue.increment).toHaveBeenCalledWith(250);
  });

  it('a Stripe gift landing between adjustments is not clobbered', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    // A webhook credit lands the way `incrementCampaignRaised` writes it.
    store.set('campaigns/camp1', applyData(store.get('campaigns/camp1'), { raised: { __increment: 500 } }));
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 100 }));
    // 1000 + 250 + 500 + 100. An overwrite anywhere in this chain loses the 500.
    expect(raised()).toBe(1850);
  });

  it('a correction is a negative amount, and both entries survive in the trail', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 500 }));
    expect(raised()).toBe(1500);
    // The admin meant $50.
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: -450 }));
    expect(res.status).toBe(200);
    expect(raised()).toBe(1050);
    expect(adjustments().map((a) => a.amountDollars)).toEqual([500, -450]);
  });

  it('refuses a negative that would take the total below zero', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: -1500 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('below $0') });
    expect(raised()).toBe(1000);
    expect(adjustments()).toHaveLength(0);
  });

  it('allows a negative that lands exactly on zero', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: -1000 }));
    expect(res.status).toBe(200);
    expect(raised()).toBe(0);
  });
});

describe('a manual adjustment creates no invoice', () => {
  it('writes the campaign and its adjustment row, and nothing else', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    // 🔴 Giving statements are built from `tenants/{id}/invoices` where
    // type === 'donation_receipt'. A manual entry must never reach a tax
    // document, so the assertion is on the WHOLE write set, not on one path.
    expect(invoicePaths()).toEqual([]);
    const written = [...store.keys()].filter((k) => k !== 'tenants/t1');
    expect(written.sort()).toEqual([
      'campaigns/camp1',
      'campaigns/camp1/adjustments/gen1',
    ]);
  });

  it('the adjustment row carries no receipt or statement shape', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    const row = adjustments()[0];
    expect(row).not.toHaveProperty('type');
    expect(row).not.toHaveProperty('receiptUrl');
    expect(row.amountDollars).toBe(250);
  });
});

describe('each manual adjustment is recorded', () => {
  it('names who made it, when, how much and through which provider', async () => {
    await POST(post({
      campaignId: 'camp1', tenantId: 't1', amountDollars: 250,
      provider: 'cashapp', note: 'Sunday envelope',
    }));
    expect(adjustments()[0]).toMatchObject({
      amountDollars: 250,
      provider: 'cashapp',
      providerLabel: 'Cash App',
      note: 'Sunday envelope',
      tenantId: 't1',
      campaignId: 'camp1',
      adjustedByUid: 'admin1',
      adjustedByEmail: 'pastor@grace.example',
      createdAt: 'SERVER_TS',
    });
  });

  it('accepts an unspecified provider', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 40 }));
    expect(adjustments()[0]).toMatchObject({ provider: null, providerLabel: null, note: null });
  });

  it('refuses a provider this build does not define', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 40, provider: 'wire-transfer' }));
    expect(res.status).toBe(400);
    expect(raised()).toBe(1000);
  });

  it('refuses a prototype key masquerading as a provider', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 40, provider: 'constructor' }));
    expect(res.status).toBe(400);
  });

  it('collapses a pasted multi-line note to one line', async () => {
    await POST(post({
      campaignId: 'camp1', tenantId: 't1', amountDollars: 40,
      note: '  Cash App\n\nfrom the   Bakers\t ',
    }));
    expect(adjustments()[0].note).toBe('Cash App from the Bakers');
  });
});

describe('a free tenant reaches none of this', () => {
  it('refuses the adjustment with 403 and writes nothing', async () => {
    store.set('tenants/t1', { plan: 'free', name: 'Grace Chapel' });
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    expect(res.status).toBe(403);
    // 🔴 `free.fundraising` is false: no donate page, no /campaign/[id], no
    // /api/stripe/donate. A tier with no giving surface must not acquire a
    // giving figure it could publish.
    expect(raised()).toBe(1000);
    expect(adjustments()).toHaveLength(0);
  });

  it('refuses before the amount is even considered', async () => {
    store.set('tenants/t1', { plan: 'free' });
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 'nonsense' }));
    // The plan refusal, not the amount refusal — the gate is upstream of parsing.
    expect(res.status).toBe(403);
  });

  it('refuses an unknown tenant rather than defaulting it open', async () => {
    const res = await POST(post({ campaignId: 'camp1', tenantId: 'ghost', amountDollars: 250 }));
    expect(res.status).toBe(404);
  });
});

describe('the route refuses a caller without the fundraising permission', () => {
  it('passes the permission refusal straight through', async () => {
    const { requireTenantPermission } = await import('@/lib/api-auth');
    const { NextResponse } = await import('next/server');
    vi.mocked(requireTenantPermission).mockResolvedValueOnce(
      NextResponse.json({ error: "Missing 'manageFundraising' permission" }, { status: 403 }) as never,
    );
    const res = await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    expect(res.status).toBe(403);
    expect(raised()).toBe(1000);
  });

  it('asks for exactly the permission firestore.rules asks for on /campaigns', async () => {
    const { requireTenantPermission } = await import('@/lib/api-auth');
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 250 }));
    expect(requireTenantPermission).toHaveBeenCalledWith(expect.anything(), 't1', 'manageFundraising');
  });
});
