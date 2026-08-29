import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-147 — the SECOND code path that creates a church's donations account.
 *
 * 🔴 The defect this closes. THE-145 PR 2 (#317) switched `/api/stripe/connect`
 * to `type: 'standard'`, because #316 had made donations DIRECT charges: Stripe
 * debits a disputed gift from the CHURCH's balance, and an Express holder has no
 * Stripe credentials to answer that dispute with. But `/api/affiliate/onboard`
 * creates the SAME account — it writes `tenant_private.stripeConnectAccountId`,
 * the id `/api/stripe/donate` charges — and was left on `type: 'express'`.
 *
 * So a church owner who clicked "become an affiliate" BEFORE "connect Stripe"
 * got an EXPRESS donations account and then took direct charges on it: exactly
 * the pairing #317 exists to eliminate, reached by the new-customer path.
 *
 * ⚠️ THE TWO CALL SITES IN THAT ROUTE ARE NOT THE SAME THING, and this suite's
 * whole job is to hold them apart:
 *
 *   • the TENANT branch  → writes `tenant_private.stripeConnectAccountId`,
 *     takes direct charges, must be Standard  (tests 1, 5, 8)
 *   • the TENANT-LESS branch → writes only `users/{uid}.affiliateStripeAccountId`,
 *     receives transfers, takes no charges, must stay Express  (test 2)
 *
 * ⚠️ ONLY Stripe and Firebase are mocked. The real `requireAuth` runs, so the
 * gates are exercised rather than assumed, and the real route decides which
 * branch a caller lands in — a mocked branch selector would make every
 * assertion below circular.
 */

// ── Stripe ──────────────────────────────────────────────────────────────────
const { mockAccountsCreate, mockAccountLinksCreate } = vi.hoisted(() => ({
  mockAccountsCreate: vi.fn(),
  mockAccountLinksCreate: vi.fn(),
}));

// ── THE-256 ────────────────────────────────────────────────────────────────
// This suite pins what Stripe Connect DOES, so it runs with the master switch
// ON. That is the hide-not-delete guarantee expressed as a test: every rule
// below — the affiliate payout account and the donations account resolving to one
// account id — still holds, unchanged, the moment
// STRIPE_CONNECT_ENABLED goes back to true. That the same route answers 503
// while the switch is OFF is asserted in the-256-stripe-connect-hidden.test.ts.
vi.mock('@/lib/stripe-connect-feature', () => ({
  STRIPE_CONNECT_ENABLED: true,
  STRIPE_CONNECT_HIDDEN_MESSAGE: 'Temporarily unavailable',
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = { create: mockAccountsCreate };
    accountLinks = { create: mockAccountLinksCreate };
  },
}));

// ── Firebase, beneath the real auth helpers ─────────────────────────────────
const { mockVerifyIdToken, firestore, firestoreWrites } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  firestore: new Map<string, any>(),
  firestoreWrites: [] as Array<{ op: string; path: string; data?: any }>,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        __coll: name,
        id,
        get: async () => {
          const data = firestore.get(`${name}/${id}`);
          return { exists: data !== undefined, id, data: () => data };
        },
        set: async (data: unknown) => { firestoreWrites.push({ op: 'set', path: `${name}/${id}`, data }); },
        update: async (data: unknown) => { firestoreWrites.push({ op: 'update', path: `${name}/${id}`, data }); },
      }),
      // Only the affiliate-code uniqueness probe queries; nothing collides.
      where() { return this; },
      limit() { return this; },
      get: async () => ({ size: 0, empty: true, docs: [] }),
    }),
    batch: () => ({
      set: (ref: any, data: unknown) => {
        firestoreWrites.push({ op: 'batch.set', path: `${ref?.__coll}/${ref?.id}`, data });
      },
      update: (ref: any, data: unknown) => {
        firestoreWrites.push({ op: 'batch.update', path: `${ref?.__coll}/${ref?.id}`, data });
      },
      commit: async () => { firestoreWrites.push({ op: 'batch.commit', path: '' }); },
    }),
  },
}));

const { tenantPrivate, tenantPrivateWrites } = vi.hoisted(() => ({
  tenantPrivate: new Map<string, any>(),
  tenantPrivateWrites: [] as Array<{ id: string; data: any }>,
}));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (id: string) => tenantPrivate.get(id) ?? {},
  tenantPrivateRef: (id: string) => ({
    __coll: 'tenant_private',
    id,
    set: async (data: unknown) => { tenantPrivateWrites.push({ id, data }); },
  }),
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
  DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
}));

const { POST: affiliateOnboard } = await import('@/app/api/affiliate/onboard/route');
// Imported ONLY so test 8 can compare the two creation paths against each other.
// This suite never asserts on the connect route's own behaviour — #317 owns that.
const { POST: connect } = await import('@/app/api/stripe/connect/route');
// 🔴 The REAL flag, not a copy. Test 7 is only worth something because of this.
const { AFFILIATE_PROGRAM_ENABLED } = await import('@/utils/plan-features');

// ── Named fixtures ──────────────────────────────────────────────────────────
//
// Every assertion below names its target by LABEL. Nothing matches on an
// `acct_`-shaped pattern: the defect was two accounts of different TYPES under
// the same field, and both spell their id identically.

/** What Stripe returns when the church's DONATIONS account is created. */
const TENANT_DONATIONS_ACCOUNT_ID = 'acct_grace_donations';
/** The church's already-connected account, for the reuse branch. */
const EXISTING_DONATIONS_ACCOUNT_ID = 'acct_grace_already_connected';
/** What Stripe returns for a payout-only, tenant-less affiliate. */
const PAYOUT_ONLY_ACCOUNT_ID = 'acct_affiliate_payouts';
/** A legacy affiliate's own, already-ACTIVE payout account. */
const LEGACY_ACTIVE_PAYOUT_ACCOUNT_ID = 'acct_legacy_active_payouts';
/** The onboarding URL Stripe mints. Carries no account id by design. */
const ONBOARDING_URL = 'https://connect.stripe.com/setup/s/onboarding_session';

// ── Personas ────────────────────────────────────────────────────────────────

interface Persona {
  /** Bearer token value; also the uid. */
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  userDoc: Record<string, unknown> | null;
}

/**
 * 🔴 THE CHURCH OWNER THIS TICKET IS ABOUT. Belongs to a tenant that has NEVER
 * connected Stripe, and reaches the money path through the affiliate route.
 */
const CHURCH_OWNER: Persona = {
  uid: 'owner1',
  email: 'owner@grace.org',
  decoded: { uid: 'owner1', email: 'owner@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin', affiliateCode: 'gracecode' },
};

/**
 * 🔴 THE PAYOUT-ONLY AFFILIATE. No tenant at all. They refer churches and
 * receive transfers; they never take a charge, so none of the direct-charge
 * reasoning applies to them. Test 2 — the regression test — is theirs.
 */
const TENANTLESS_AFFILIATE: Persona = {
  uid: 'affiliate1',
  email: 'affiliate@example.com',
  decoded: { uid: 'affiliate1', email: 'affiliate@example.com', auth_time: 1700000000 },
  userDoc: { role: 'user', affiliateCode: 'affcode' }, // no tenantId
};

/**
 * A tenant member who ALREADY receives payouts on their own, separate, ACTIVE
 * affiliate account. The mirror must not repoint them (test 6b).
 */
const LEGACY_AFFILIATE_IN_TENANT: Persona = {
  uid: 'legacy1',
  email: 'legacy@grace.org',
  decoded: { uid: 'legacy1', email: 'legacy@grace.org', auth_time: 1700000000 },
  userDoc: {
    tenantId: 'grace',
    role: 'user',
    affiliateCode: 'legacycode',
    affiliateStripeAccountId: LEGACY_ACTIVE_PAYOUT_ACCOUNT_ID,
    affiliateConnectStatus: 'active',
  },
};

const ALL_PERSONAS = [CHURCH_OWNER, TENANTLESS_AFFILIATE, LEGACY_AFFILIATE_IN_TENANT];

function affiliateRequest(as: Persona | null): NextRequest {
  return new NextRequest('https://theharvest.app/api/affiliate/onboard', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://theharvest.app',
      ...(as ? { authorization: `Bearer ${as.uid}` } : {}),
    },
    body: JSON.stringify({}),
  });
}

function connectRequest(body: object, as: Persona): NextRequest {
  return new NextRequest('https://theharvest.app/api/stripe/connect', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://theharvest.app',
      authorization: `Bearer ${as.uid}`,
    },
    body: JSON.stringify(body),
  });
}

/** The `accounts.create` params from the Nth call, so assertions read by name. */
const accountCreateParams = (n = 0) => mockAccountsCreate.mock.calls[n]?.[0] ?? {};

/**
 * Every write that reached `tenant_private/{tenantId}` — through the batch
 * (which is how the route persists the Connect account id) or through the ref
 * directly. Asserting on one alone would miss the real write.
 */
const privateWritesFor = (tenantId: string): any[] => [
  ...firestoreWrites.filter((w) => w.path === `tenant_private/${tenantId}`).map((w) => w.data),
  ...tenantPrivateWrites.filter((w) => w.id === tenantId).map((w) => w.data),
];

/** Every write that reached `users/{uid}`, in order. */
const userWritesFor = (uid: string): any[] =>
  firestoreWrites.filter((w) => w.path === `users/${uid}`).map((w) => w.data);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_platform_secret_value';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';

  firestore.clear();
  tenantPrivate.clear();
  firestoreWrites.length = 0;
  tenantPrivateWrites.length = 0;

  for (const p of ALL_PERSONAS) {
    if (p.userDoc) firestore.set(`users/${p.uid}`, p.userDoc);
  }

  firestore.set('tenants/grace', {
    name: 'Grace Chapel', plan: 'pro', status: 'active', ownerId: CHURCH_OWNER.uid,
  });

  // Grace has NOT connected — the branch that CREATES the donations account.
  tenantPrivate.set('grace', { adminEmails: [] });

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });

  mockAccountsCreate.mockResolvedValue({ id: TENANT_DONATIONS_ACCOUNT_ID });
  mockAccountLinksCreate.mockResolvedValue({ url: ONBOARDING_URL });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — the ticket.
// ═══════════════════════════════════════════════════════════════════════════

describe('the tenant donations account created by affiliate onboarding is Standard', () => {
  it('🔴 creates it with type standard, not the Express shell it used to', async () => {
    const res = await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    // Named by parameter. This one word is the ticket.
    expect(accountCreateParams().type).toBe('standard');
    // Stated separately so a revert fails HERE by name, rather than on a vague
    // object mismatch somewhere downstream.
    expect(accountCreateParams().type).not.toBe('express');
  });

  it('🔴 it really is the donations account — the id donate charges', async () => {
    // What makes the type matter: this same id is what `/api/stripe/donate`
    // reads off `tenant_private` and charges DIRECTLY, putting disputes on the
    // church's balance. If this assertion ever fails, test 1 is guarding a
    // field nobody spends money through and the ticket has moved.
    await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(privateWritesFor('grace')).toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: TENANT_DONATIONS_ACCOUNT_ID }),
    );
  });

  it('still stamps the tenant metadata and the pending status', async () => {
    // The account type changed. Nothing about WHICH tenant owns it did.
    const res = await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(res.status).toBe(200);
    expect(accountCreateParams().metadata).toMatchObject({ tenantId: 'grace', app: 'harvest' });
    expect(firestoreWrites).toContainEqual(
      expect.objectContaining({
        op: 'batch.update',
        path: 'tenants/grace',
        data: expect.objectContaining({ stripeConnectStatus: 'pending' }),
      }),
    );
  });

  it('🔴 onboards it with an account link — Standard needs no OAuth here either', async () => {
    // STOP condition 3 from the ticket, checked rather than assumed. Stripe
    // documents account links as "the recommended method for creating standard
    // accounts": create with type standard, then send the holder through
    // Connect Onboarding. This route already used that mechanism for Express,
    // and it is unchanged — so the type switch needs no new onboarding flow.
    const res = await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: ONBOARDING_URL });
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: TENANT_DONATIONS_ACCOUNT_ID,
        type: 'account_onboarding',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — 🔴 THE REGRESSION TEST. Worth more than test 1.
// ═══════════════════════════════════════════════════════════════════════════

describe('the tenant-less affiliate payout account is still Express', () => {
  it('🔴 a payout-only affiliate with no tenant still gets type express', async () => {
    mockAccountsCreate.mockResolvedValue({ id: PAYOUT_ONLY_ACCOUNT_ID });

    const res = await affiliateOnboard(affiliateRequest(TENANTLESS_AFFILIATE));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    // 🔴 Express, and it must STAY Express. This recipient receives transfers
    // and takes no charges, so it needs the `transfers` capability rather than
    // `card_payments`. None of the direct-charge, dispute-liability reasoning
    // behind test 1 applies to it, and Standard is a different authorization
    // model — not a one-word change.
    expect(accountCreateParams().type).toBe('express');
    expect(accountCreateParams().type).not.toBe('standard');
    // Identified by the role label the route stamps, never by an id pattern.
    expect(accountCreateParams().metadata).toMatchObject({ role: 'affiliate', app: 'harvest' });
  });

  it('🔴 it is persisted to the user and touches NO tenant', async () => {
    // The structural reason it is allowed to stay Express: nothing about it can
    // become a church's donations account, because no tenant doc points at it.
    mockAccountsCreate.mockResolvedValue({ id: PAYOUT_ONLY_ACCOUNT_ID });

    await affiliateOnboard(affiliateRequest(TENANTLESS_AFFILIATE));

    expect(userWritesFor(TENANTLESS_AFFILIATE.uid)).toContainEqual(
      expect.objectContaining({ affiliateStripeAccountId: PAYOUT_ONLY_ACCOUNT_ID }),
    );
    expect(tenantPrivateWrites).toEqual([]);
    expect(privateWritesFor('grace')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — the reuse guard that limits the blast radius.
// ═══════════════════════════════════════════════════════════════════════════

describe('an existing account id is reused, not replaced', () => {
  it('🔴 a connected church gets NO new account, and keeps the id it had', async () => {
    // This is why the defect only ever bit churches that had never connected:
    // the route reads the existing id first and only creates when it is absent.
    // It is also what makes the fix safe — Stripe cannot change an account's
    // type after creation, so a church already on Express must be left alone
    // rather than silently handed a second account.
    tenantPrivate.set('grace', {
      adminEmails: [], stripeConnectAccountId: EXISTING_DONATIONS_ACCOUNT_ID,
    });

    const res = await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    // Nothing overwrote the stored id…
    expect(privateWritesFor('grace')).not.toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: TENANT_DONATIONS_ACCOUNT_ID }),
    );
    // …and onboarding resumes against the account they already have.
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: EXISTING_DONATIONS_ACCOUNT_ID,
        type: 'account_onboarding',
      }),
    );
  });

  it('a tenant-less affiliate who already has an account just gets a fresh link', async () => {
    firestore.set(`users/${TENANTLESS_AFFILIATE.uid}`, {
      ...TENANTLESS_AFFILIATE.userDoc,
      affiliateStripeAccountId: PAYOUT_ONLY_ACCOUNT_ID,
    });

    const res = await affiliateOnboard(affiliateRequest(TENANTLESS_AFFILIATE));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: PAYOUT_ONLY_ACCOUNT_ID }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — the two branches are mutually exclusive, and stay that way.
// ═══════════════════════════════════════════════════════════════════════════

describe('only one account is created when both paths could fire', () => {
  it('🔴 a tenant member with no affiliate account gets ONE account, the tenant one', async () => {
    // Both branches are live for this caller: they belong to a tenant with no
    // connected account AND hold no affiliate account of their own. If the
    // tenant branch ever stopped returning early, this caller would mint a
    // Standard donations account AND an Express payout account in one request —
    // the double-account the unified-account backstop exists to prevent.
    const res = await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(1);
    // The one account created is the tenant's, and it is the Standard one.
    expect(accountCreateParams().type).toBe('standard');
    expect(accountCreateParams().metadata).toMatchObject({ tenantId: 'grace' });
    // No second, user-scoped account was minted alongside it.
    expect(accountCreateParams().metadata).not.toMatchObject({ role: 'affiliate' });
  });

  it('the payout path is not reached at all when a tenant resolves', async () => {
    await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    // The tenant-less branch stamps `role: 'affiliate'` and a userId. No call
    // carrying that metadata should exist for a caller who has a tenant.
    const affiliateScopedCalls = mockAccountsCreate.mock.calls
      .map((c) => c[0])
      .filter((params) => params?.metadata?.role === 'affiliate');
    expect(affiliateScopedCalls).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 — the id stays off the world-readable document.
// ═══════════════════════════════════════════════════════════════════════════

describe('the account is still written to tenant_private, not the world-readable tenant doc', () => {
  it('🔴 the id lands on tenant_private and never on tenants/{id}', async () => {
    // `tenants/{id}` is `allow read: if true` — pre-auth subdomain resolution
    // needs it. The Connect account id lives on `tenant_private`, which is
    // `allow read, write: if false`. Changing the account TYPE must not have
    // moved WHERE the id is stored.
    await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(privateWritesFor('grace')).toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: TENANT_DONATIONS_ACCOUNT_ID }),
    );

    const publicWrites = firestoreWrites.filter((w) => w.path === 'tenants/grace');
    expect(publicWrites.length).toBeGreaterThan(0); // the status write really happened
    for (const w of publicWrites) {
      expect(w.data).not.toHaveProperty('stripeConnectAccountId');
    }
  });

  it('the id never reaches the client either', async () => {
    const raw = await (await affiliateOnboard(affiliateRequest(CHURCH_OWNER))).text();

    expect(Object.keys(JSON.parse(raw))).toEqual(['url']);
    expect(raw).not.toContain(TENANT_DONATIONS_ACCOUNT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — the mirror, unchanged by the type switch.
// ═══════════════════════════════════════════════════════════════════════════

describe('the affiliate mirror still points at the same account it did before', () => {
  it('🔴 mirrors the tenant account id onto the caller — same target as before', async () => {
    // The mirror exists so the payout path (`users/{uid}.affiliateStripeAccountId`)
    // and the donations path (`tenant_private.stripeConnectAccountId`) resolve
    // ONE account. THE-147 changed the account's TYPE, not the mirror's target:
    // the same id is written to the same field under the same condition.
    await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(userWritesFor(CHURCH_OWNER.uid)).toContainEqual(
      expect.objectContaining({
        affiliateStripeAccountId: TENANT_DONATIONS_ACCOUNT_ID,
        affiliateConnectStatus: 'pending',
      }),
    );
    // Same id on both sides — that is what "unified account" means.
    expect(privateWritesFor('grace')).toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: TENANT_DONATIONS_ACCOUNT_ID }),
    );
  });

  it('🔴 still refuses to repoint a DIFFERENT, already-active payout account', async () => {
    // The `mirrorSafe` guard. A legacy affiliate receiving payouts on their own
    // account must not have it clobbered by a not-yet-ready tenant account just
    // because they clicked "become an affiliate". Unchanged by the type switch —
    // and load-bearing for it, since their account is Express and the tenant's
    // is now Standard, so a wrong repoint would also change account type.
    const res = await affiliateOnboard(affiliateRequest(LEGACY_AFFILIATE_IN_TENANT));

    expect(res.status).toBe(200);
    const writes = userWritesFor(LEGACY_AFFILIATE_IN_TENANT.uid);
    for (const w of writes) {
      expect(w).not.toHaveProperty('affiliateStripeAccountId');
    }
    // The tenant account was still created and stored — only the mirror was held.
    expect(privateWritesFor('grace')).toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: TENANT_DONATIONS_ACCOUNT_ID }),
    );
  });

  it('mirrors an ALREADY-connected tenant account without creating anything', async () => {
    tenantPrivate.set('grace', {
      adminEmails: [], stripeConnectAccountId: EXISTING_DONATIONS_ACCOUNT_ID,
    });
    firestore.set('tenants/grace', {
      name: 'Grace Chapel', plan: 'pro', status: 'active',
      ownerId: CHURCH_OWNER.uid, stripeConnectStatus: 'active',
    });

    await affiliateOnboard(affiliateRequest(CHURCH_OWNER));

    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(userWritesFor(CHURCH_OWNER.uid)).toContainEqual(
      expect.objectContaining({
        affiliateStripeAccountId: EXISTING_DONATIONS_ACCOUNT_ID,
        affiliateConnectStatus: 'active',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 7 — the programme stays hidden.
// ═══════════════════════════════════════════════════════════════════════════

describe('AFFILIATE_PROGRAM_ENABLED is still false', () => {
  it('🔴 the flag is false — this fix unhides nothing', async () => {
    // The route is reachable, which is exactly why the defect was live. Fixing
    // the account type must not have been paired with switching the programme
    // on. Read from the real module, not a copy.
    expect(AFFILIATE_PROGRAM_ENABLED).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 8 — 🔴 the two creation sites, pinned against each other.
// ═══════════════════════════════════════════════════════════════════════════

describe('both creation paths agree on the tenant donations account type', () => {
  it('🔴 /api/stripe/connect and /api/affiliate/onboard create the SAME type', async () => {
    // ⚠️ THIS TEST IS THE POINT OF THE TICKET, not test 1.
    //
    // Two routes create the tenant's donations account and each holds its own
    // copy of the account type. #317 changed one and left the other — and
    // nothing failed, because no test compared them. This one does: it drives
    // both routes for the same unconnected church and asserts the types match.
    // A future change to either side alone fails HERE, naming both files.
    //
    // Extracting a shared creator would be the structural fix; it requires
    // editing `/api/stripe/connect`, which THE-147 is scoped out of. This is the
    // test-level equivalent, and it is what stops the divergence recurring.
    const viaAffiliate = await affiliateOnboard(affiliateRequest(CHURCH_OWNER));
    expect(viaAffiliate.status).toBe(200);
    const affiliateRouteType = accountCreateParams().type;

    // Reset to the same starting state: an unconnected church.
    vi.clearAllMocks();
    mockAccountsCreate.mockResolvedValue({ id: TENANT_DONATIONS_ACCOUNT_ID });
    mockAccountLinksCreate.mockResolvedValue({ url: ONBOARDING_URL });
    tenantPrivate.set('grace', { adminEmails: [] });
    firestoreWrites.length = 0;
    tenantPrivateWrites.length = 0;

    const viaConnect = await connect(connectRequest({ tenantId: 'grace' }, CHURCH_OWNER));
    expect(viaConnect.status).toBe(200);
    const connectRouteType = accountCreateParams().type;

    expect(affiliateRouteType).toBe(connectRouteType);
    // And both are the type direct charges require, so "they agree" can never be
    // satisfied by both drifting back to Express together.
    expect(affiliateRouteType).toBe('standard');
    expect(connectRouteType).toBe('standard');
  });
});
