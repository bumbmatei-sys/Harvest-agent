import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/* ─── THE-253 — the metered endpoint refuses a tenant without the add-on ──────
 *
 * 🔴 WHY THIS HAS TO BE A SERVER TEST. The AI chat spends real money per
 * question: every answer is a MiMo call billed to Harvest. `MainApp` hides the
 * Chat tab from a tenant that does not hold the capability, and a hidden tab is
 * not a gate — precedent THE-193, and THE-213 found four surfaces that had
 * exactly this shape. `/api/gemini` is a plain authenticated POST; any member
 * of any tenant can call it directly with `purpose: 'chat'`. So the refusal has
 * to live where the spend is.
 *
 * ⚠️ THE REAL COMPOSITION, NOT A STUB. `@/lib/tenant-features` is deliberately
 * NOT mocked here: the route's gate runs through the actual
 * `getEffectiveFeatures` over a tenant document this file writes into the
 * Firestore mock. A stubbed `tenantFeaturesById` would assert that the route
 * calls a function, which is not the thing worth being sure of — what matters
 * is that a `plus` tenant holding `addons.aiAssistant` gets through and the
 * same tenant holding nothing does not.
 *
 * ─── Which usage limit still applies ─────────────────────────────────────────
 *
 * BOTH, and neither moved. The entitlement is a THIRD check that runs first:
 *
 *   1. 🔴 entitlement — per TENANT, `getEffectiveFeatures(...).aiChat`. New.
 *   2. `PLAN_LIMITS.queryTokensPerMonth` — per TENANT, per month. Unchanged,
 *      and still read from the TIER: no add-on raises the token ceiling, so a
 *      church on Individual that buys the chat is metered at Individual's
 *      2,000,000 tokens. That is deliberate — the add-on sells the capability,
 *      not an allowance.
 *   3. `enforceChatLimit` — per UID, ten answers then a cooldown. Unchanged,
 *      and still the only per-PERSON limit. It is a module constant, identical
 *      for every user of every tenant, and no add-on raises it either.
 *
 * The order matters and is asserted: refusing before (2) means an unentitled
 * tenant never touches the budget ledger, and refusing before the MiMo call
 * means it never costs anything.
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRequireAuth, tenantDoc, mockChatUsageSet } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  // The `tenants/{id}` document this test is driving. `null` = does not exist.
  tenantDoc: { value: null as Record<string, unknown> | null, throws: false },
  mockChatUsageSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  verifyAuth: vi.fn(),
}));

/**
 * One Firestore mock serving two collections, because the route reads both:
 * `tenants/{id}` for the entitlement and `chat_usage/{uid}` for the throttle.
 * Keyed on the collection name so a lookup cannot silently answer with the
 * other collection's document.
 */
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn((name: string) => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => {
          if (name === 'tenants') {
            if (tenantDoc.throws) throw new Error('firestore unavailable');
            return { exists: tenantDoc.value !== null, data: () => tenantDoc.value };
          }
          return { exists: false, data: () => null };
        }),
        set: mockChatUsageSet,
        update: vi.fn(),
      })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
    })),
    recursiveDelete: vi.fn(),
  },
  adminAuth: { verifyIdToken: vi.fn() },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      embedContent: vi.fn().mockResolvedValue({ embeddings: [{ values: [0.1] }] }),
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 42 }),
    };
  },
}));

const { mockCheckQueryBudget, mockIncrementQueryTokens } = vi.hoisted(() => ({
  mockCheckQueryBudget: vi.fn(),
  mockIncrementQueryTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rag-usage', () => ({
  approxTokens: (t: string) => Math.ceil((t?.length ?? 0) / 4),
  checkAndReserveIngest: vi.fn(),
  refundIngest: vi.fn().mockResolvedValue(undefined),
  checkQueryBudget: mockCheckQueryBudget,
  incrementQueryTokens: mockIncrementQueryTokens,
}));

vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: vi.fn(),
  captureMoneyPathError: vi.fn(),
}));

const { POST } = await import('../gemini/route');

// ── Helpers ────────────────────────────────────────────────────────────────

const chatRequest = () =>
  new NextRequest('https://example.com/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify({ action: 'generate', prompt: 'who is Jesus?', purpose: 'chat' }),
  });

const user = (over: object = {}) => ({
  uid: 'u1', email: 'member@church.test', tenantId: 'tenant1',
  isAdmin: false, isSuperAdmin: false, ...over,
});

/** The add-on set as the Dodo webhook writes it onto the tenant document. */
const OWNS_ADDON = { aiAssistant: 1, adminSeats: 0, contactPacks: 0, unlimitedContacts: false, campuses: 0 };
const OWNS_NOTHING = { ...OWNS_ADDON, aiAssistant: 0 };

let mimo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.MIMO_API_KEY = 'tp-test-key';
  mockCheckQueryBudget.mockResolvedValue({ allowed: true, used: 0, cap: 2_000_000 });
  tenantDoc.throws = false;
  tenantDoc.value = { plan: 'plus', addons: OWNS_NOTHING };
  mimo = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'An answer that cost money.' } }],
      usage: { total_tokens: 120 },
    }),
  });
  vi.stubGlobal('fetch', mimo);
});

// ─── test 4 ──────────────────────────────────────────────────────────────────
describe('the Gemini endpoint refuses a tenant without the add-on', () => {
  it('answers 403 for a tenant whose plan and add-ons both lack the chat', async () => {
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'plus', addons: OWNS_NOTHING };

    const res = await POST(chatRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ai_chat_not_entitled');
  });

  it('🔴 and refuses BEFORE spending anything — no MiMo call, no budget read', async () => {
    /* The whole point of a server gate on a metered endpoint. A refusal that
       still called the provider would cost money on every unentitled request,
       which is the abuse a client-only gate invites. */
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'plus', addons: OWNS_NOTHING };

    await POST(chatRequest());

    expect(mimo, 'the provider was called for a refused request').not.toHaveBeenCalled();
    expect(mockCheckQueryBudget, 'the budget ledger was read for a refused request').not.toHaveBeenCalled();
    expect(mockIncrementQueryTokens).not.toHaveBeenCalled();
    expect(mockChatUsageSet, 'the per-uid throttle was written for a refused request').not.toHaveBeenCalled();
  });

  it('refuses a tenant whose document does not exist rather than inventing a tier', async () => {
    // `toTenantPlan` fails closed to 'plus' for an unknown plan, so an absent
    // document must not resolve to "some tier, therefore allowed".
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = null;

    expect((await POST(chatRequest())).status).toBe(403);
    expect(mimo).not.toHaveBeenCalled();
  });

  it('refuses a tenant whose add-on field is junk', async () => {
    mockRequireAuth.mockResolvedValue(user());
    for (const junk of [undefined, null, 'aiAssistant: 1', 42, { aiAssistant: 'yes' }, { aiAssistant: -1 }]) {
      tenantDoc.value = { plan: 'plus', addons: junk };
      expect((await POST(chatRequest())).status, String(junk)).toBe(403);
    }
  });

  it('🔴 a Firestore failure refuses too — it never fails OPEN onto a paid call', async () => {
    /* `tenantFeaturesById` documents that a read failure propagates rather than
       resolving to "unknown plan → allowed". A transient blip that opened the
       endpoint would be a metered capability handed out for free. */
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.throws = true;

    expect((await POST(chatRequest())).status).toBe(500);
    expect(mimo).not.toHaveBeenCalled();
  });
});

// ─── test 2, on the server ───────────────────────────────────────────────────
describe('the Gemini endpoint serves a tenant that owns the add-on', () => {
  it('🔴 lets an Individual tenant through on the strength of the add-on alone', async () => {
    /* THE DELIVERABLE. `plus` carries `aiChat: false`; the ONLY thing that
       differs from the 403 case above is `addons.aiAssistant`. */
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'plus', addons: OWNS_ADDON };

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('An answer that cost money.');
    expect(mimo).toHaveBeenCalled();
  });

  it('still serves a tenant whose PLAN includes the chat and owns no add-on', async () => {
    // The lift never lowers: Small Team keeps what its tier grants.
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'pro', addons: OWNS_NOTHING };

    expect((await POST(chatRequest())).status).toBe(200);
  });

  it('meters the entitled tenant exactly as before — both limits still run', async () => {
    /* ⚠️ THE ADD-ON BUYS THE CAPABILITY, NOT AN ALLOWANCE. An entitled tenant
       is still subject to the tier's monthly token cap and the per-uid throttle,
       and the add-on raises neither. */
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'plus', addons: OWNS_ADDON };

    await POST(chatRequest());

    expect(mockCheckQueryBudget).toHaveBeenCalledWith('tenant1');
    expect(mockIncrementQueryTokens).toHaveBeenCalledWith('tenant1', 120);
    expect(mockChatUsageSet).toHaveBeenCalled();
  });

  it('the monthly token cap still refuses an entitled tenant that is over it', async () => {
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'plus', addons: OWNS_ADDON };
    mockCheckQueryBudget.mockResolvedValue({ allowed: false, used: 2_000_000, cap: 2_000_000 });

    const body = await (await POST(chatRequest())).json();

    expect(body.capReached).toBe('query');
    expect(mimo).not.toHaveBeenCalled();
  });
});

// ─── who the gate does not apply to ──────────────────────────────────────────
describe('the gate applies to tenants, and only to the chat', () => {
  it('a super admin is exempt, as they are from every other limit here', async () => {
    mockRequireAuth.mockResolvedValue(user({ isSuperAdmin: true }));
    tenantDoc.value = { plan: 'plus', addons: OWNS_NOTHING };

    expect((await POST(chatRequest())).status).toBe(200);
  });

  it('⚠️ a null-tenant main-site user is not refused — they have no tenant to own one', async () => {
    /* `tenantId` comes off the verified token or the user document, never the
       request body, so a tenant member cannot present themselves as tenantless.
       Null is the apex/demo user, whom `MainApp` shows the chat unconditionally
       via `isMainSite`. They remain metered by the per-uid allowance, which is
       the only limit that was ever keyed on them. */
    mockRequireAuth.mockResolvedValue(user({ tenantId: null }));

    expect((await POST(chatRequest())).status).toBe(200);
    expect(mockCheckQueryBudget, 'a null tenant was metered').not.toHaveBeenCalled();
  });

  it('a non-chat generate is untouched by the gate', async () => {
    // The automated blog and other `generate` callers send no `purpose`, so
    // they must not start needing an add-on the tenant was never sold.
    mockRequireAuth.mockResolvedValue(user());
    tenantDoc.value = { plan: 'plus', addons: OWNS_NOTHING };

    const res = await POST(new NextRequest('https://example.com/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify({ action: 'generate', prompt: 'write a blog post' }),
    }));

    expect(res.status).toBe(200);
  });

  it('an unauthenticated request is still refused before any of this', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await POST(chatRequest())).status).toBe(401);
  });
});
