import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-201 — POST /api/auth/set-claims IS THE ENFORCEMENT POINT.
 *
 * Covers AC-1 (the 151st is refused), AC-2 (an existing member on an over-cap
 * tenant still signs in, with NO count query), AC-3 (the 500th/501st off-by-one
 * through the route), AC-8 (a super admin is unaffected), AC-10 (nothing is
 * removed, disabled or demoted on the refusal path) and AC-13 (a failed check
 * is a 503, not an allow and not a refusal).
 *
 * 🔴 `src/lib/member-capacity` is NOT mocked here. The whole point of these
 * tests is that the real decision runs against doubled Admin SDK primitives, so
 * "the count double was never invoked" is a meaningful assertion rather than a
 * statement about a stub.
 */

const h = vi.hoisted(() => {
  const countGet = vi.fn();
  const count = vi.fn(() => ({ get: countGet }));
  const usersWhere = vi.fn(() => ({ count }));
  const tenantGet = vi.fn();
  const userDocGet = vi.fn();
  const userDocSet = vi.fn(async () => {});
  const userDocDelete = vi.fn(async () => {});

  const setCustomClaims = vi.fn(async () => {});
  const capture = vi.fn();

  const verifyIdToken = vi.fn();
  const getUser = vi.fn();
  const deleteUser = vi.fn(async () => {});
  const updateUser = vi.fn(async () => {});
  const setCustomUserClaims = vi.fn(async () => {});

  const collection = vi.fn((name: string) => {
    if (name === 'tenants') return { doc: () => ({ get: tenantGet }) };
    if (name === 'users') {
      return {
        where: usersWhere,
        doc: () => ({ get: userDocGet, set: userDocSet, delete: userDocDelete }),
      };
    }
    throw new Error(`unexpected collection ${name}`);
  });

  return {
    countGet, count, usersWhere, tenantGet, userDocGet, userDocSet, userDocDelete,
    setCustomClaims, capture,
    verifyIdToken, getUser, deleteUser, updateUser, setCustomUserClaims,
    collection,
  };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: h.collection },
  adminAuth: {
    verifyIdToken: h.verifyIdToken,
    getUser: h.getUser,
    deleteUser: h.deleteUser,
    updateUser: h.updateUser,
    setCustomUserClaims: h.setCustomUserClaims,
  },
}));
vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: h.setCustomClaims }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: h.capture }));

const { POST } = await import('../route');

const APPLICANT = 'applicant-uid';

const post = (uid: string = APPLICANT) =>
  new NextRequest('https://gracechurch.theharvest.app/api/auth/set-claims', {
    method: 'POST',
    headers: { authorization: 'Bearer id-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid }),
  });

const countsTo = (n: number) => ({ data: () => ({ count: n }) });

/** No claims yet, and a `users` doc scoped to the tenant: a NEW member. */
const asNewApplicantOf = (tenantId: string) => {
  h.userDocGet.mockResolvedValue({ exists: true, data: () => ({ tenantId }) });
  h.getUser.mockResolvedValue({ uid: APPLICANT, customClaims: undefined });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyIdToken.mockResolvedValue({ uid: APPLICANT, superAdmin: false });
  h.tenantGet.mockResolvedValue({
    exists: true,
    data: () => ({ plan: 'plus', name: 'Grace Church' }),
  });
  h.countGet.mockResolvedValue(countsTo(0));
  asNewApplicantOf('gracechurch');
});

// ── AC-1 ── the refusal ─────────────────────────────────────────────────────
describe('a new member at the cap (AC-1)', () => {
  it('gets 403 member_cap_reached, and setCustomClaims is NEVER called', async () => {
    // plus caps at 150. total 151 → othersCount 150 → refused.
    h.countGet.mockResolvedValue(countsTo(151));

    const res = await POST(post());
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.code).toBe('member_cap_reached');
    expect(body.error).toContain('Grace Church');
    // Withholding the call withholds the claim. That is the whole gate.
    expect(h.setCustomClaims).not.toHaveBeenCalled();
  });

  it('the refusal body carries no count and no cap number', async () => {
    h.countGet.mockResolvedValue(countsTo(151));
    const body = await (await POST(post())).json();

    expect(Object.keys(body).sort()).toEqual(['code', 'error']);
    expect(body.error).not.toMatch(/\b150\b|\b151\b/);
  });
});

// ── AC-10 ── nothing is ever removed ────────────────────────────────────────
describe('the refusal path removes, disables and demotes nobody (AC-10)', () => {
  it('makes zero destructive Admin SDK calls, and stamps only the applicant own doc', async () => {
    h.countGet.mockResolvedValue(countsTo(151));

    expect((await POST(post())).status).toBe(403);

    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled(); // i.e. no `disabled: true`
    expect(h.setCustomUserClaims).not.toHaveBeenCalled();
    expect(h.setCustomClaims).not.toHaveBeenCalled();
    expect(h.userDocDelete).not.toHaveBeenCalled();

    // The ONLY write is the C2 ghost stamp, on the refused applicant's own doc.
    expect(h.userDocSet).toHaveBeenCalledTimes(1);
    const [data, opts] = h.userDocSet.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(opts).toEqual({ merge: true });
    expect(Object.keys(data).sort()).toEqual(['capRefusedAt', 'capRefusedTenantId']);
    expect(data.capRefusedTenantId).toBe('gracechurch');
  });
});

// ── AC-2 ── an existing member on an over-cap tenant ────────────────────────
describe('an existing member of an over-cap tenant still signs in (AC-2)', () => {
  it('gets 200, claims are minted, and NO count query runs at all', async () => {
    // Moved down to plus (cap 150) carrying 500 members.
    h.userDocGet.mockResolvedValue({ exists: true, data: () => ({ tenantId: 'gracechurch' }) });
    h.getUser.mockResolvedValue({
      uid: APPLICANT,
      customClaims: { tenantId: 'gracechurch', role: 'user' },
    });
    h.countGet.mockResolvedValue(countsTo(500));

    const res = await POST(post());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, forceRefresh: true });

    expect(h.setCustomClaims).toHaveBeenCalledWith(APPLICANT);
    // The read-cost claim in §7 depends on this: an over-cap tenant's daily
    // sign-in traffic costs nothing new.
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.countGet).not.toHaveBeenCalled();
  });

  it('the claim is read from Auth, not from the client-writable users doc', async () => {
    // The `users` doc says the tenant; the CLAIM says nothing. Per D3 that is a
    // NEW member and IS gated — a client cannot talk its way past the gate by
    // writing its own doc.
    h.getUser.mockResolvedValue({ uid: APPLICANT, customClaims: {} });
    h.countGet.mockResolvedValue(countsTo(151));

    expect((await POST(post())).status).toBe(403);
    expect(h.setCustomClaims).not.toHaveBeenCalled();
  });
});

// ── AC-3 ── the off-by-one, through the route ───────────────────────────────
describe('the 500th is allowed and the 501st is refused on a pro tenant (AC-3)', () => {
  beforeEach(() => {
    h.tenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'pro' }) });
  });

  it('total 500 → 200 and claims minted', async () => {
    h.countGet.mockResolvedValue(countsTo(500));
    expect((await POST(post())).status).toBe(200);
    expect(h.setCustomClaims).toHaveBeenCalledTimes(1);
  });

  it('total 501 → 403 and claims withheld', async () => {
    h.countGet.mockResolvedValue(countsTo(501));
    expect((await POST(post())).status).toBe(403);
    expect(h.setCustomClaims).not.toHaveBeenCalled();
  });
});

// ── AC-8 ── a super admin is unaffected ─────────────────────────────────────
describe('a super admin / main-site account is unaffected (AC-8)', () => {
  it('a null tenantId on the applicant doc → 200, claims minted, no count', async () => {
    h.userDocGet.mockResolvedValue({ exists: true, data: () => ({ tenantId: null }) });

    expect((await POST(post())).status).toBe(200);
    expect(h.setCustomClaims).toHaveBeenCalledWith(APPLICANT);
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.tenantGet).not.toHaveBeenCalled();
  });

  it('a super admin calling for ANOTHER uid gates on the TARGET, not the caller', async () => {
    h.verifyIdToken.mockResolvedValue({ uid: 'super-admin-uid', superAdmin: true });
    h.userDocGet.mockResolvedValue({ exists: true, data: () => ({ tenantId: 'gracechurch' }) });
    h.getUser.mockResolvedValue({ uid: 'target-uid', customClaims: undefined });
    h.countGet.mockResolvedValue(countsTo(151));

    expect((await POST(post('target-uid'))).status).toBe(403);
    // The target's own users doc supplied the tenant — not the caller's.
    expect(h.usersWhere).toHaveBeenCalledWith('tenantId', '==', 'gracechurch');
  });
});

// ── AC-4 / AC-5 / AC-6 ── what LIFTS the gate, through the route ────────────
describe('paying for room lifts the gate at the enforcement point itself', () => {
  // Same tenant, same 651 members throughout: only the allowance moves. Proves
  // the route reads `getEffectiveFeatures` and not `getPlanFeatures`, and that
  // nothing is cached between requests.
  beforeEach(() => {
    h.countGet.mockResolvedValue(countsTo(651)); // othersCount 650
  });

  it('plus alone refuses at 650 others (AC-4 control)', async () => {
    h.tenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'plus' }) });
    expect((await POST(post())).status).toBe(403);
    expect(h.setCustomClaims).not.toHaveBeenCalled();
  });

  it('the Contacts +500 add-on lifts it — 200 and claims minted (AC-4)', async () => {
    // plus 150 + one 500-pack = 650. othersCount 650 >= 650 would refuse, so
    // take one off the count: 649 others under a 650 cap.
    h.countGet.mockResolvedValue(countsTo(650));
    h.tenantGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: 'plus', addons: { contactPacks: 1 } }),
    });

    expect((await POST(post())).status).toBe(200);
    expect(h.setCustomClaims).toHaveBeenCalledWith(APPLICANT);
  });

  it('unlimitedContacts: true lifts it, and NO count query is issued (AC-5)', async () => {
    h.tenantGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: 'plus', addons: { unlimitedContacts: true } }),
    });

    expect((await POST(post())).status).toBe(200);
    expect(h.setCustomClaims).toHaveBeenCalledWith(APPLICANT);
    // The boolean is checked BEFORE any numeric comparison, so an unlimited
    // tenant costs zero reads no matter how many members it has.
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.countGet).not.toHaveBeenCalled();
  });

  it('a tier upgrade alone lifts it — plus refuses, enterprise allows (AC-6)', async () => {
    h.tenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'plus' }) });
    expect((await POST(post())).status).toBe(403);

    vi.clearAllMocks();
    h.verifyIdToken.mockResolvedValue({ uid: APPLICANT, superAdmin: false });
    asNewApplicantOf('gracechurch');
    h.countGet.mockResolvedValue(countsTo(651));
    // enterprise caps at 2,000 (plan-features.ts:366). No migration, no
    // backfill, no cached value between the two requests.
    h.tenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'enterprise' }) });

    expect((await POST(post())).status).toBe(200);
    expect(h.setCustomClaims).toHaveBeenCalledWith(APPLICANT);
  });
});

// ── AC-7 ── the count is always scoped to a concrete tenant ─────────────────
describe('the count query never runs unscoped (AC-7)', () => {
  it('issues exactly one single-field where() carrying a concrete non-empty id', async () => {
    h.countGet.mockResolvedValue(countsTo(3));

    expect((await POST(post())).status).toBe(200);

    expect(h.usersWhere).toHaveBeenCalledTimes(1);
    const args = h.usersWhere.mock.calls[0] as unknown as [string, string, unknown];
    expect(args).toEqual(['tenantId', '==', 'gracechurch']);
    // The assertion that matters: a scope silently dropped from the builder
    // would match EVERY user on the platform against this one church.
    expect(typeof args[2]).toBe('string');
    expect((args[2] as string).length).toBeGreaterThan(0);
  });

  it('an empty-string tenantId on the applicant doc skips — it never counts', async () => {
    h.userDocGet.mockResolvedValue({ exists: true, data: () => ({ tenantId: '   ' }) });

    expect((await POST(post())).status).toBe(200);
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.tenantGet).not.toHaveBeenCalled();
  });
});

// ── AC-13 ── C3/C4: the third outcome ───────────────────────────────────────
describe('a failed capacity check is 503, never an allow and never a refusal (AC-13)', () => {
  it('a rejecting count → 503 capacity_check_unavailable, claims withheld', async () => {
    h.countGet.mockRejectedValue(new Error('firestore quota exceeded'));

    const res = await POST(post());
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.code).toBe('capacity_check_unavailable');
    // It must not tell a real new believer the ministry is full.
    expect(body.error).not.toMatch(/full|capacity|limit|invited/i);

    expect(h.setCustomClaims).not.toHaveBeenCalled();
    expect(h.capture).toHaveBeenCalled();
  });

  it('a MISSING tenant doc → 503, and NOT a silent plus/150 cap (C4)', async () => {
    h.tenantGet.mockResolvedValue({ exists: false, data: () => undefined });
    h.countGet.mockResolvedValue(countsTo(1));

    const res = await POST(post());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'capacity_check_unavailable' });

    // The tell: a 'plus' fallback with 0 others would have ALLOWED and minted.
    expect(h.setCustomClaims).not.toHaveBeenCalled();
    expect(h.usersWhere).not.toHaveBeenCalled();
  });

  it('nothing is stamped, deleted or disabled on the unavailable path either', async () => {
    h.countGet.mockRejectedValue(new Error('boom'));
    await POST(post());

    expect(h.userDocSet).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
  });
});

// ── the pre-existing behaviour, unchanged ───────────────────────────────────
describe('the existing auth checks still answer first', () => {
  it('401 with no Bearer header, and no capacity work is done', async () => {
    const res = await POST(
      new NextRequest('https://gracechurch.theharvest.app/api/auth/set-claims', {
        method: 'POST',
        body: JSON.stringify({ uid: APPLICANT }),
      }),
    );
    expect(res.status).toBe(401);
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.setCustomClaims).not.toHaveBeenCalled();
  });

  it('403 Forbidden — WITHOUT a member_cap code — for a uid mismatch', async () => {
    h.verifyIdToken.mockResolvedValue({ uid: 'someone-else', superAdmin: false });

    const res = await POST(post());
    expect(res.status).toBe(403);

    const body = await res.json();
    // The two 403s are distinguished by `code`, which is why `code` is
    // mandatory on the new one and absent on this one.
    expect(body).toEqual({ error: 'Forbidden' });
    expect(body.code).toBeUndefined();
    expect(h.usersWhere).not.toHaveBeenCalled();
  });

  it('an allowed signup mints claims exactly once and stamps nothing', async () => {
    h.countGet.mockResolvedValue(countsTo(3));

    expect((await POST(post())).status).toBe(200);
    expect(h.setCustomClaims).toHaveBeenCalledTimes(1);
    expect(h.userDocSet).not.toHaveBeenCalled();
  });
});
