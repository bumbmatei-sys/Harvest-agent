import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-201 — the gate's arithmetic and its reads.
 *
 * Covers AC-3 (the off-by-one on `pro`), AC-4 (a Contacts +500 pack lifts the
 * cap), AC-5 (both unlimited forms short-circuit BEFORE the count runs), AC-6
 * (a tier change alone moves the gate), AC-7 (the count query always carries a
 * concrete, non-empty tenant id), AC-8 (a super admin is skipped) and AC-13
 * (a failed check is `unavailable` — neither an allow nor a refusal).
 *
 * The Admin SDK is doubled with `vi.hoisted` + `vi.mock('@/lib/firebase-admin')`
 * in the style of `src/app/api/courses/__tests__/adopt-route.test.ts`.
 */

const h = vi.hoisted(() => {
  const countGet = vi.fn();
  const count = vi.fn(() => ({ get: countGet }));
  const usersWhere = vi.fn(() => ({ count }));
  const tenantGet = vi.fn();
  const userDocSet = vi.fn(async () => {});
  const capture = vi.fn();
  const collection = vi.fn((name: string) => {
    if (name === 'tenants') return { doc: () => ({ get: tenantGet }) };
    if (name === 'users') {
      return { where: usersWhere, doc: () => ({ set: userDocSet }) };
    }
    throw new Error(`unexpected collection ${name}`);
  });
  return { countGet, count, usersWhere, tenantGet, userDocSet, capture, collection };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: h.collection },
  adminAuth: { getUser: vi.fn() },
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: h.capture }));

const {
  canTenantAcceptNewMember,
  countOtherMembers,
  decideMemberCapacity,
  isOverMemberCap,
  readTenantMemberAllowance,
  stampRefusal,
} = await import('@/lib/member-capacity');

/** A `tenants/{id}` snapshot that exists, with the given plan/addons/name. */
const tenantDoc = (data: Record<string, unknown>) => ({
  exists: true,
  data: () => data,
});

/** The count aggregation's shape: `.data().count`. */
const countsTo = (n: unknown) => ({ data: () => ({ count: n }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'pro', name: 'Grace Church' }));
  h.countGet.mockResolvedValue(countsTo(0));
});

// ── AC-7 ── the scope guard ─────────────────────────────────────────────────
describe('countOtherMembers refuses an unscoped count', () => {
  it('issues exactly one single-field where() with the concrete tenant id', async () => {
    h.countGet.mockResolvedValue(countsTo(7));

    await countOtherMembers('gracechurch', false);

    expect(h.usersWhere).toHaveBeenCalledTimes(1);
    expect(h.usersWhere).toHaveBeenCalledWith('tenantId', '==', 'gracechurch');
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('throws and issues NO query for %s', async (_label, bad) => {
    // A count with a null tenant would count the entire platform against one
    // church. It must never silently become an unscoped read.
    await expect(countOtherMembers(bad as unknown as string, false)).rejects.toThrow(
      /concrete non-empty string/,
    );
    expect(h.usersWhere).not.toHaveBeenCalled();
  });

  it('subtracts the applicant only when excludeSelf is true, and never goes negative', async () => {
    h.countGet.mockResolvedValue(countsTo(10));
    expect(await countOtherMembers('t', true)).toBe(9);
    expect(await countOtherMembers('t', false)).toBe(10);

    h.countGet.mockResolvedValue(countsTo(0));
    expect(await countOtherMembers('t', true)).toBe(0);
  });

  it('throws rather than defaulting when the aggregate returns a non-number', async () => {
    // Not a `?? 0`: a broken read must not render as "this tenant has no members".
    h.countGet.mockResolvedValue(countsTo(undefined));
    await expect(countOtherMembers('t', false)).rejects.toThrow(/non-numeric count/);
  });
});

// ── the pure comparison ─────────────────────────────────────────────────────
describe('isOverMemberCap', () => {
  it('is >=, not >: at exactly the cap there is no slot left', () => {
    expect(isOverMemberCap(149, 150)).toBe(false);
    expect(isOverMemberCap(150, 150)).toBe(true);
    expect(isOverMemberCap(151, 150)).toBe(true);
  });

  it('treats the UNLIMITED_CAP sentinel (-1) as no cap, not as "always over"', () => {
    // `othersCount >= -1` would otherwise be true forever.
    expect(isOverMemberCap(10_000, -1)).toBe(false);
  });
});

// ── AC-4 / AC-6 / C4 ── the allowance read ──────────────────────────────────
describe('readTenantMemberAllowance', () => {
  it('reads through getEffectiveFeatures, so the cap is the TIER\u2019s own (AC-4)', async () => {
    /* 🔴 WAS "so a Contacts +500 pack raises the cap", with `addons:
       { contactPacks: 1 }` lifting plus from 150 to 650. THE-370 retired that
       add-on and raised the tier caps instead, so nothing an add-on carries
       moves this number any more.

       ⚠️ THE RETIRED KEY IS LEFT IN THE FIXTURE ON PURPOSE. This is exactly the
       stale document the ticket declined to migrate, and the allowance read is
       where it would do damage if `readTenantAddons` still honoured it. It must
       resolve to plus's own 500. */
    h.tenantGet.mockResolvedValue(
      tenantDoc({ plan: 'plus', addons: { contactPacks: 1 }, name: 'Grace Church' }),
    );
    const allowance = await readTenantMemberAllowance('gracechurch');
    expect(allowance.maxContacts).toBe(500);
    expect(allowance.plan).toBe('plus');
    expect(allowance.ministryName).toBe('Grace Church');
  });

  it('THROWS when the tenant doc is missing — it never defaults to a cap (C4)', async () => {
    h.tenantGet.mockResolvedValue({ exists: false, data: () => undefined });
    await expect(readTenantMemberAllowance('ghost')).rejects.toThrow(/does not exist/);
  });

  it('a doc that EXISTS with a garbage plan still coerces to plus, intentionally', async () => {
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'not-a-real-tier' }));
    const allowance = await readTenantMemberAllowance('t');
    expect(allowance.plan).toBe('plus');
    // 🔴 THE FALL-BACK IS UNCHANGED — still 'plus', the cheapest PAID tier.
    // Only the number behind it moved, 150 → 500 (THE-370).
    expect(allowance.maxContacts).toBe(500);
  });

  it('returns null for a missing/blank ministry name rather than the tenant id', async () => {
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'pro', name: '   ' }));
    expect((await readTenantMemberAllowance('gracechurch')).ministryName).toBeNull();
  });
});

// ── AC-3 ── the off-by-one, both directions in one test ─────────────────────
describe('the 500th is allowed and the 501st is refused on a pro tenant (AC-3)', () => {
  const applicant = {
    uid: 'applicant-uid',
    applicantTenantId: 'gracechurch',
    existingClaimTenantId: null,
  };

  it('total 500 → othersCount 499 → allowed; total 501 → othersCount 500 → refused', async () => {
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'pro', name: 'Grace Church' }));

    // 🔴 pro's cap is 2,000 since THE-370 (was 500), so the boundary moved with
    // it. The property under test is the OFF-BY-ONE — the cap-th is allowed and
    // the cap-plus-first is refused — which is asserted at the real boundary.
    h.countGet.mockResolvedValue(countsTo(2_000));
    const atCap = await decideMemberCapacity(applicant);
    expect(atCap).toEqual({ status: 'allowed', cap: 2_000, othersCount: 1_999 });

    h.countGet.mockResolvedValue(countsTo(2_001));
    const overCap = await decideMemberCapacity(applicant);
    expect(overCap).toMatchObject({
      status: 'refused',
      cap: 2_000,
      othersCount: 2_000,
      ministryName: 'Grace Church',
    });
  });
});

// ── AC-6 ── a tier upgrade alone lifts the gate ─────────────────────────────
describe('a tier upgrade lifts the gate with no migration and no cached value (AC-6)', () => {
  it('same tenant, same 500 members: plus refuses, pro allows', async () => {
    const applicant = {
      uid: 'u',
      applicantTenantId: 'gracechurch',
      existingClaimTenantId: null,
    };
    // 🔴 THE NUMBERS MOVED WITH THE CAPS (THE-370): plus is 500 and pro is
    // 2,000. 1,000 members on the tenant, the applicant's own doc among them
    // (D4), so othersCount = 999: over `plus`'s 500, under `pro`'s 2,000.
    h.countGet.mockResolvedValue(countsTo(1_000)); // othersCount 999

    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'plus' }));
    expect((await decideMemberCapacity(applicant)).status).toBe('refused');

    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'pro' }));
    expect((await decideMemberCapacity(applicant)).status).toBe('allowed');
  });
});

// ── AC-4 ── the add-on, end to end through the decision ─────────────────────
describe('THE-370 — a retired add-on key does NOT lift the gate (AC-4)', () => {
  const applicant = { uid: 'u', applicantTenantId: 'gracechurch', existingClaimTenantId: null };

  it('🔴 a stale contactPacks value grants no room at all', async () => {
    /* WAS 'the Contacts +500 add-on lifts the gate', asserting that one pack
       took plus from 150 to 650. The add-on is retired, so the inverse is what
       must hold — and this is the highest-stakes place for it, because the gate
       decides whether a real person can join a church.

       A doc claiming TEN packs would have been +5,000 under the old model. It
       is worth nothing now: the cap is plus's own 500. */
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'plus', addons: { contactPacks: 10 } }));

    h.countGet.mockResolvedValue(countsTo(500)); // othersCount 499, cap 500
    expect((await decideMemberCapacity(applicant)).status).toBe('allowed');

    h.countGet.mockResolvedValue(countsTo(501)); // othersCount 500, cap 500
    const refused = await decideMemberCapacity(applicant);
    expect(refused.status).toBe('refused');
    expect(refused).toMatchObject({ cap: 500 });
  });

  it('🔴 a stale campuses value does not reach this decision either', async () => {
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'plus', addons: { campuses: 9 } }));
    h.countGet.mockResolvedValue(countsTo(501));
    expect((await decideMemberCapacity(applicant)).status).toBe('refused');
  });
});

// ── AC-5 ── unlimited short-circuits BEFORE any count ───────────────────────
describe('Unlimited Contacts lifts the gate entirely, without counting (AC-5)', () => {
  const applicant = { uid: 'u', applicantTenantId: 'gracechurch', existingClaimTenantId: null };

  it('the unlimitedContacts add-on skips, and NO count query is issued', async () => {
    h.tenantGet.mockResolvedValue(
      tenantDoc({ plan: 'plus', addons: { unlimitedContacts: true } }),
    );
    h.countGet.mockResolvedValue(countsTo(10_000));

    expect(await decideMemberCapacity(applicant)).toEqual({
      status: 'skipped',
      reason: 'unlimited-addon',
    });
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.countGet).not.toHaveBeenCalled();
  });
});

// ── AC-8 / D3 ── who the gate does not apply to ─────────────────────────────
describe('who is not gated at all', () => {
  it.each([
    ['null (super admin)', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
  ])('an applicant whose users doc tenantId is %s skips with no-tenant (AC-8)', async (_l, t) => {
    expect(
      await decideMemberCapacity({
        uid: 'super-admin',
        applicantTenantId: t as string | null | undefined,
        existingClaimTenantId: null,
      }),
    ).toEqual({ status: 'skipped', reason: 'no-tenant' });
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.tenantGet).not.toHaveBeenCalled();
  });

  it('an existing member already holding THIS tenant claim skips, with no count (D3)', async () => {
    expect(
      await decideMemberCapacity({
        uid: 'member',
        applicantTenantId: 'gracechurch',
        existingClaimTenantId: 'gracechurch',
      }),
    ).toEqual({ status: 'skipped', reason: 'existing-member' });
    expect(h.usersWhere).not.toHaveBeenCalled();
  });

  it('a uid holding ANOTHER tenant claim IS gated — they are new to this ministry', async () => {
    h.countGet.mockResolvedValue(countsTo(501));
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'plus' }));

    expect(
      (
        await decideMemberCapacity({
          uid: 'joiner',
          applicantTenantId: 'gracechurch',
          existingClaimTenantId: 'other-church',
        })
      ).status,
    ).toBe('refused');
    expect(h.usersWhere).toHaveBeenCalledWith('tenantId', '==', 'gracechurch');
  });
});

// ── AC-13 ── C3: a failed check is loud, and is neither an allow nor a refusal
describe('a failed capacity check is a third outcome, never a guess (AC-13/C3)', () => {
  const applicant = { uid: 'u', applicantTenantId: 'gracechurch', existingClaimTenantId: null };

  it('a rejecting count → unavailable, and captureHandledError fires', async () => {
    h.countGet.mockRejectedValue(new Error('firestore quota exceeded'));

    expect(await decideMemberCapacity(applicant)).toEqual({
      status: 'unavailable',
      reason: 'count-failed',
    });
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.capture.mock.calls[0][1]).toEqual({ step: 'member-cap-count' });
  });

  it('a MISSING tenant doc → unavailable, NOT a silent plus/150 cap (C4)', async () => {
    h.tenantGet.mockResolvedValue({ exists: false, data: () => undefined });

    const outcome = await decideMemberCapacity(applicant);
    expect(outcome).toEqual({ status: 'unavailable', reason: 'tenant-read-failed' });
    // The tell: had it fallen back to 'plus', a 0-member tenant would read
    // `allowed` with cap 150. It must not reach the count at all.
    expect(h.usersWhere).not.toHaveBeenCalled();
    expect(h.capture).toHaveBeenCalledTimes(1);
  });

  it('a rejecting tenant read → unavailable', async () => {
    h.tenantGet.mockRejectedValue(new Error('missing ADC'));
    expect((await decideMemberCapacity(applicant)).status).toBe('unavailable');
  });
});

// ── the pre-flight shares the decision ──────────────────────────────────────
describe('canTenantAcceptNewMember', () => {
  it('does NOT subtract a self — no account exists yet', async () => {
    h.tenantGet.mockResolvedValue(tenantDoc({ plan: 'plus' }));
    h.countGet.mockResolvedValue(countsTo(500));

    // 500 others against plus's cap of 500 (THE-370; was 150) → refused. Had it
    // subtracted one, this would wrongly read 499 and allow.
    expect((await canTenantAcceptNewMember('gracechurch')).status).toBe('refused');
  });

  it('returns unavailable rather than throwing for a blank tenant id', async () => {
    for (const bad of ['', '   ', null, undefined]) {
      const outcome = await canTenantAcceptNewMember(bad as unknown as string);
      expect(outcome).toEqual({ status: 'unavailable', reason: 'invalid-tenant-id' });
    }
    expect(h.usersWhere).not.toHaveBeenCalled();
  });

  it('reports the pre-flight step to Sentry, distinctly from the enforcement path', async () => {
    h.countGet.mockRejectedValue(new Error('boom'));
    await canTenantAcceptNewMember('gracechurch');
    expect(h.capture.mock.calls[0][1]).toEqual({ step: 'member-cap-preflight' });
  });
});

// ── D8 ── the stamp writes, and only writes ─────────────────────────────────
describe('stampRefusal', () => {
  it('merges capRefusedAt and capRefusedTenantId onto the applicant own doc', async () => {
    await stampRefusal('refused-uid', 'gracechurch');

    expect(h.userDocSet).toHaveBeenCalledTimes(1);
    const [data, opts] = h.userDocSet.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(opts).toEqual({ merge: true });
    expect(data.capRefusedTenantId).toBe('gracechurch');
    expect(typeof data.capRefusedAt).toBe('string');
    expect(new Date(data.capRefusedAt as string).toISOString()).toBe(data.capRefusedAt);
    // D8 — a stamp, not a removal. No other field is touched.
    expect(Object.keys(data).sort()).toEqual(['capRefusedAt', 'capRefusedTenantId']);
  });

  it('swallows its own failure — a diagnostics write must never turn a 403 into a 500', async () => {
    h.userDocSet.mockRejectedValueOnce(new Error('permission denied'));
    await expect(stampRefusal('u', 't')).resolves.toBeUndefined();
    expect(h.capture).toHaveBeenCalledWith(expect.any(Error), {
      step: 'member-cap-stamp-refusal',
    });
  });
});
