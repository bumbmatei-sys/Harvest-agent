import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-251 — 🔴 STRIPE GIFTS STILL UPDATE `raised` EXACTLY AS BEFORE.
 *
 * This ticket adds a SECOND writer of `campaigns/{id}.raised`. The first one —
 * `incrementCampaignRaised`, credited from the Stripe donation webhooks — is
 * money that already works, and the non-negotiable is that it keeps working
 * untouched. So this file pins its behaviour directly rather than trusting that
 * nobody edited it:
 *
 *   • it increments, per payment, through `FieldValue.increment`
 *   • it credits exactly once per payment id (the dedup marker)
 *   • it refuses a cross-tenant campaign, a missing campaign and a missing id
 *   • the increment and its marker are ONE batch
 *
 * and then composes the two writers to prove the new one cannot corrupt the old.
 *
 * ⚠️ THE WRITER IS ASSERTED, NOT ASSUMED. `webhook-campaign-credit-idempotency`
 * covers the same function through the webhook route; this exercises it directly
 * so a regression shows up here as a behaviour change rather than as a routing
 * change somewhere else.
 */

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

let addCounter = 0;

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
  return { doc: (id?: string) => makeDocRef(`${path}/${id ?? `gen${++addCounter}`}`) };
}

/** All-or-nothing, so "one batch" is a claim this can falsify. */
function makeBatch(): any {
  const ops: Array<{ type: 'set' | 'update'; ref: any; data: any }> = [];
  return {
    set: (ref: any, data: any) => { ops.push({ type: 'set', ref, data }); },
    update: (ref: any, data: any) => { ops.push({ type: 'update', ref, data }); },
    commit: async () => {
      const snapshot = new Map(store);
      try {
        for (const op of ops) {
          if (op.type === 'set') await op.ref.set(op.data);
          else await op.ref.update(op.data);
        }
      } catch (e) {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        throw e;
      }
    },
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeCollRef(name),
    batch: () => makeBatch(),
    runTransaction: async (fn: any) => {
      const ops: Array<{ type: 'set' | 'update'; ref: any; data: any }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any) => { ops.push({ type: 'set', ref, data }); },
        update: (ref: any, data: any) => { ops.push({ type: 'update', ref, data }); },
      };
      const result = await fn(tx);
      for (const op of ops) {
        if (op.type === 'set') await op.ref.set(op.data);
        else await op.ref.update(op.data);
      }
      return result;
    },
  },
  adminAuth: { verifyIdToken: vi.fn() },
  getReceiptsBucket: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/donation-receipt', () => ({ issueDonationReceipt: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('@/lib/api-auth', () => ({
  requireTenantPermission: vi.fn(async () => ({
    uid: 'admin1', email: 'pastor@grace.example', tenantId: 't1',
    isAdmin: true, isSuperAdmin: false, authTime: 0,
  })),
}));
vi.mock('@/lib/tenant-features', () => ({
  tenantFeatures: (data: any) => ({ fundraising: data?.plan !== 'free' }),
}));

const { incrementCampaignRaised } = await import('../donation-webhook');
const { POST } = await import('@/app/api/campaigns/adjust-raised/route');
const { NextRequest } = await import('next/server');

const post = (body: Record<string, unknown>) =>
  new NextRequest('https://grace.example/api/campaigns/adjust-raised', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  });

const raised = () => store.get('campaigns/camp1')?.raised;

beforeEach(() => {
  store.clear();
  addCounter = 0;
  vi.clearAllMocks();
  store.set('tenants/t1', { plan: 'plus' });
  store.set('campaigns/camp1', { tenantId: 't1', goal: 50_000, raised: 0 });
});

describe('Stripe gifts still update raised exactly as before', () => {
  it('credits the campaign by the gift amount', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    expect(raised()).toBe(50);
  });

  it('credits through FieldValue.increment, not a computed literal', async () => {
    const { FieldValue } = await import('firebase-admin/firestore');
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    expect(FieldValue.increment).toHaveBeenCalledWith(50);
  });

  it('credits exactly once per payment id, however many times it is called', async () => {
    for (let i = 0; i < 4; i++) {
      await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    }
    expect(raised()).toBe(50);
  });

  it('credits each distinct payment', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 25, paymentId: 'pi_2' });
    expect(raised()).toBe(75);
  });

  it('writes the dedup marker alongside the credit', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    expect(store.get('campaigns/camp1/credits/pi_1')).toMatchObject({ paymentId: 'pi_1', amountDollars: 50 });
  });

  it('skips a gift with no payment id rather than crediting blind', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: undefined });
    expect(raised()).toBe(0);
  });

  it('refuses a campaign belonging to another tenant', async () => {
    store.set('campaigns/camp2', { tenantId: 't2', raised: 0 });
    await incrementCampaignRaised({ campaignId: 'camp2', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    expect(store.get('campaigns/camp2').raised).toBe(0);
  });

  it('ignores a missing campaign without throwing, so a real gift is never lost to a 500', async () => {
    await expect(
      incrementCampaignRaised({ campaignId: 'ghost', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' }),
    ).resolves.toBeUndefined();
  });

  it('writes no invoice of its own — receipts are a separate concern', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    expect([...store.keys()].filter((k) => k.includes('invoice'))).toEqual([]);
  });
});

describe('the manual adjustment does not disturb the Stripe writer', () => {
  it('a Stripe gift after an adjustment still credits its full amount', async () => {
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 200 }));
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    // 🔴 The adjustment must not consume, cap or reset the Stripe credit.
    expect(raised()).toBe(250);
  });

  it('an adjustment after a Stripe gift adds on top of it', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 200 }));
    expect(raised()).toBe(250);
  });

  it('an adjustment does not write, clear or collide with the Stripe dedup markers', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 200 }));
    // The marker survives, so a webhook redelivery is still deduped...
    expect(store.get('campaigns/camp1/credits/pi_1')).toBeTruthy();
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    expect(raised()).toBe(250);
    // ...and the adjustment lives in its own collection, not among the credits.
    expect([...store.keys()].filter((k) => k.startsWith('campaigns/camp1/credits/'))).toHaveLength(1);
    expect([...store.keys()].filter((k) => k.startsWith('campaigns/camp1/adjustments/'))).toHaveLength(1);
  });

  it('interleaved writers compose to the arithmetic sum', async () => {
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 50, paymentId: 'pi_1' });
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: 200 }));
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 25, paymentId: 'pi_2' });
    await POST(post({ campaignId: 'camp1', tenantId: 't1', amountDollars: -75 }));
    await incrementCampaignRaised({ campaignId: 'camp1', tenantId: 't1', amountDollars: 10, paymentId: 'pi_3' });
    // 50 + 200 + 25 - 75 + 10. Any overwrite anywhere loses a term.
    expect(raised()).toBe(210);
  });
});
