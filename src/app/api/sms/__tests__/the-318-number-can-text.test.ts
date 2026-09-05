import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-318 — a number bought through Harvest could not send a text.
 *
 * ─── 🔴 THE DEFECT THIS FILE EXISTS FOR ──────────────────────────────────────
 *
 * SMS capability at this vendor is PER NUMBER, not per country, and the flag
 * that asks for it — `wantsSms` — DEFAULTS TO FALSE. THE-314 built the whole
 * purchase path and never sent it. So every number Harvest bought was filled
 * from the wider voice-only pool and could not text, while the availability
 * preview (which already asked `sms=true`), the admin screen and the invoice
 * all said it could. A church was charged, monthly, for a number that did not
 * do the one thing it was bought for.
 *
 * ⚠️ IT FAILED SILENTLY IN THE WORST DIRECTION. Not an error, not an empty
 * result — a real number, delivered, billed, and mute. Nothing in the product
 * could tell it apart from a working one until a member never got the text.
 *
 * ─── Four more things the vendor's contract says, each its own section ───────
 *
 * The remaining assertions are not "while we are here". Each is a way the same
 * purchase can take real money and produce something other than what was
 * bought: the wrong pool (§1), a WhatsApp bill nobody agreed to (§2), a profile
 * binding that does not exist at the vendor (§4), and two ordinary failures
 * reported as though the platform were broken (§5, §6).
 *
 * ⚠️ WHAT IS DELIBERATELY NOT HERE. Nothing below asserts anything about THIS
 * BRANCH'S DIFF. Three guards written that way have blocked every unrelated PR
 * in this repo, and a guard that reads `git` at assertion time is a guard that
 * expires the moment its own ticket merges. Every claim here is a property of
 * the SOURCE as it stands, true on this branch, on `main` after it lands, and
 * on every branch cut from it afterwards.
 */

const { mockRequireAdmin, mockGetNumber, mockZernio } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetNumber: vi.fn(),
  mockZernio: {
    zernioSearchNumbers: vi.fn(),
    zernioPurchaseNumber: vi.fn(),
    zernioGetNumber: vi.fn(),
    zernioReleaseNumber: vi.fn(),
    zernioEnableSms: vi.fn(),
    zernioReuseRegistration: vi.fn(),
    zernioSmsNumberType: vi.fn(),
  },
}));

// This suite pins what the purchase DOES, so it runs with the master switch on.
vi.mock('@/lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/zernio', () => mockZernio);

/** Every write the route makes, in order, so a test can ask what was RECORDED
 * rather than only what was returned. The profile binding is stored and never
 * echoed, so it is only observable here. */
const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
const smsDocSet = vi.fn(async (data: Record<string, unknown>) => {
  writes.push({ path: 'integrations/sms', data });
});
vi.mock('@/lib/sms-send', () => ({
  getTenantSmsNumber: mockGetNumber,
  SMS_DOC: () => ({ set: smsDocSet }),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (d: string) => ({
        get: async () => ({ exists: true, data: () => ({ plan: 'max' }) }),
        set: async (data: Record<string, unknown>) => { writes.push({ path: `${c}/${d}`, data }); },
        delete: async () => {},
      }),
    }),
  },
}));
vi.mock('@/utils/plan-features', async (orig) => await orig<Record<string, unknown>>());

const { POST } = await import('../numbers/route');

const SRC = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
/** The file with comments stripped. Needed, not fastidious: the docblocks below
 * NAME the pattern they forbid — `wantsSms` false, the WhatsApp default — so a
 * raw source match would read a warning as the offence it warns against. */
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function buy(body: object = {}): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/sms/numbers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A vendor that sells a number and reports the profile it actually used. */
const soldAs = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  data: {
    numberId: 'num_1',
    phoneNumber: '+16155550123',
    status: 'active',
    profileId: 'prof_assigned_9',
    monthlyCostUsd: 3,
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  mockRequireAdmin.mockResolvedValue({ uid: 'admin1', tenantId: 'church-a', isSuperAdmin: false });
  mockGetNumber.mockResolvedValue(null);
  mockZernio.zernioSmsNumberType.mockResolvedValue({ numberType: 'local', available: true });
  mockZernio.zernioPurchaseNumber.mockResolvedValue(soldAs());
  mockZernio.zernioEnableSms.mockResolvedValue({ ok: true, status: 200, data: {} });
  mockZernio.zernioReuseRegistration.mockResolvedValue({ ok: true, status: 200, data: {} });
});

/* ── 1 ─────────────────────────────────────────────────────────────────────
   🔴 THE WHOLE TICKET. The purchase asks for a number that can text.        */
describe('1 — the purchase asks for SMS capability', () => {
  /**
   * 🔴 ASSERTED ON THE WIRE, NOT ON THE ARGUMENT. `wantsSms` is deliberately
   * NOT a parameter of `zernioPurchaseNumber` — there is no caller for whom
   * false is right, and an argument would be a way to reintroduce the bug — so
   * a test of the route's call could never see it. What is billed is the BODY
   * the vendor receives, so that is what is read here: `fetch` is intercepted
   * and the JSON is inspected.
   */
  const purchaseBody = async (fn: (b: Record<string, unknown>) => void, respond?: unknown) => {
    vi.resetModules();
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      seen.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      return {
        ok: true,
        status: 200,
        json: async () => respond ?? { numberId: 'num_1', phoneNumber: '+16155550123', profileId: 'p1' },
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ZERNIO_API_KEY', 'test-key');
    const real = await vi.importActual<typeof import('@/lib/zernio')>('@/lib/zernio');
    await real.zernioPurchaseNumber({ profileId: 'church-a', purchaseIntentId: 'k1', numberType: 'local' });
    const post = seen.find((s) => s.url.includes('/phone-numbers/purchase'));
    expect(post, 'no purchase request was made at all').toBeTruthy();
    fn(post!.body);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  };

  it('🔴 sends wantsSms: true — without it the number comes from the voice-only pool and cannot text', async () => {
    await purchaseBody((body) => {
      expect(
        body.wantsSms,
        'the purchase does not ask for SMS — the vendor defaults it to FALSE, so this number is bought ' +
          'from the voice-only pool and cannot send a message. A church is billed monthly for it anyway.',
      ).toBe(true);
    });
  });

  it('🔴 sends connectWhatsapp: false EXPLICITLY — the vendor defaults it to TRUE', async () => {
    await purchaseBody((body) => {
      // 🔴 Presence is the assertion, not truthiness. `connectWhatsapp` omitted
      // means the WhatsApp provisioning path: a Meta pre-verify and OTP the
      // number waits on, and per-template billing through Meta that could cost
      // a church more than the whole feature. `false` must be on the wire.
      expect(
        Object.prototype.hasOwnProperty.call(body, 'connectWhatsapp'),
        'connectWhatsapp is omitted, so it DEFAULTS TO TRUE and the number goes down the WhatsApp path',
      ).toBe(true);
      expect(body.connectWhatsapp).toBe(false);
    });
  });

  it('does not declare WhatsApp intent either — wantsWhatsapp narrows the pool for a feature that is not sold', async () => {
    await purchaseBody((body) => {
      expect(body.wantsWhatsapp ?? false).toBe(false);
    });
  });

  it('passes the SMS-capable number type through to the vendor', async () => {
    await purchaseBody((body) => {
      // `wantsSms: true` requires an SMS-capable type. Omitting the type gets
      // the country's default, documented as "the WhatsApp-safe choice" — a
      // property about WhatsApp, not about SMS.
      expect(body.numberType).toBe('local');
    });
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   The type is CHOSEN from the vendor's SMS pool, not assumed.               */
describe('2 — the number type is resolved from the SMS-capable pool', () => {
  it('asks the vendor which type can text, for the country being bought in', async () => {
    await POST(buy({ country: 'US' }));
    expect(mockZernio.zernioSmsNumberType).toHaveBeenCalledWith('US');
    expect(mockZernio.zernioPurchaseNumber).toHaveBeenCalledWith(
      expect.objectContaining({ numberType: 'local' }),
    );
  });

  it('🔴 does not spend when the vendor says it has no SMS-capable stock', async () => {
    mockZernio.zernioSmsNumberType.mockResolvedValue({ numberType: null, available: false });
    const res = await POST(buy({ country: 'GB' }));
    expect(res.status).toBe(409);
    expect(
      mockZernio.zernioPurchaseNumber,
      'bought a number the vendor had already said could not text',
    ).not.toHaveBeenCalled();
  });

  it('still buys when the type lookup itself fails — wantsSms is on the wire either way', async () => {
    // ⚠️ A lookup that only REFINES the request must not become a new way for
    // the purchase to fail. The vendor either fills from the SMS pool or
    // refuses loudly; it can never quietly hand back a voice-only number.
    mockZernio.zernioSmsNumberType.mockResolvedValue({ numberType: null, available: null });
    const res = await POST(buy({}));
    expect(res.status).toBe(200);
    expect(mockZernio.zernioPurchaseNumber).toHaveBeenCalled();
    expect(mockZernio.zernioPurchaseNumber.mock.calls[0][0]).not.toHaveProperty('numberType');
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   🔴 The profile the VENDOR assigned is what gets stored.                    */
describe('3 — one number = one profile, and the vendor says which', () => {
  it('🔴 stores the profileId the vendor RETURNED, not the one Harvest asked for', async () => {
    await POST(buy({}));
    const rec = writes.find((w) => w.path === 'integrations/sms');
    expect(rec, 'the purchase recorded nothing').toBeTruthy();
    expect(
      rec!.data.profileId,
      'the REQUESTED profile was stored. The vendor assigns the next free profile (or creates one) when the ' +
        'requested one already holds a number, so this records a binding that does not exist at the vendor — ' +
        'and the profile is how the vendor scopes every number and message.',
    ).toBe('prof_assigned_9');
    expect(rec!.data.profileId).not.toBe('church-a');
  });

  it('the church is what is REQUESTED — a profile is asked for per tenant, not one shared profile', async () => {
    await POST(buy({}));
    expect(mockZernio.zernioPurchaseNumber).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'church-a' }),
    );
    mockZernio.zernioPurchaseNumber.mockResolvedValue(soldAs({ profileId: 'prof_assigned_10' }));
    mockRequireAdmin.mockResolvedValue({ uid: 'a2', tenantId: 'church-b', isSuperAdmin: false });
    writes.length = 0;
    await POST(buy({}));
    expect(mockZernio.zernioPurchaseNumber).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: 'church-b' }),
    );
    // 🔴 And two churches end up on two DIFFERENT recorded profiles, because
    // each records the vendor's own answer rather than its own tenant id.
    expect(writes.find((w) => w.path === 'integrations/sms')!.data.profileId).toBe('prof_assigned_10');
  });

  it('never invents a binding the vendor did not report', async () => {
    mockZernio.zernioPurchaseNumber.mockResolvedValue(soldAs({ profileId: undefined }));
    await POST(buy({}));
    const rec = writes.find((w) => w.path === 'integrations/sms')!;
    expect(rec.data.profileId, 'Harvest asserted a profile it was never told').toBeNull();
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   The two 409s mean opposite things and are answered separately.            */
describe('4 — the vendor 409s are handled, not surfaced as a generic failure', () => {
  it('🔴 PURCHASE_VELOCITY is confirmed up front — Harvest resells, so every church shares the window', async () => {
    await POST(buy({}));
    expect(
      mockZernio.zernioPurchaseNumber,
      'without allowMultiple the SECOND church to buy inside ten minutes is refused, and under the ' +
        'reseller model that is two ordinary customers, not one duplicate.',
    ).toHaveBeenCalledWith(expect.objectContaining({ allowMultiple: true }));
  });

  it('and if the vendor still refuses on velocity, the admin is told to retry rather than that it broke', async () => {
    mockZernio.zernioPurchaseNumber.mockResolvedValue({
      ok: false, status: 409, data: null, error: 'Provider error 409', code: 'PURCHASE_VELOCITY',
    });
    const res = await POST(buy({}));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe('PURCHASE_VELOCITY');
    expect(body.error).toMatch(/nothing was charged/i);
    expect(body.error).not.toMatch(/Provider error/);
    expect(writes, 'a refused purchase recorded a number anyway').toHaveLength(0);
  });

  it('🔴 AREA_CODE_UNAVAILABLE names the empty area — the vendor FAILS rather than assigning elsewhere', async () => {
    mockZernio.zernioPurchaseNumber.mockResolvedValue({
      ok: false, status: 409, data: null, error: 'Provider error 409', code: 'AREA_CODE_UNAVAILABLE',
    });
    const res = await POST(buy({ areaCode: '615' }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe('AREA_CODE_UNAVAILABLE');
    expect(body.error).toContain('615');
    expect(body.error).toMatch(/nothing was charged/i);
    expect(writes).toHaveLength(0);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   A 202 is an ACTION, not a failure and not a purchase.                     */
describe('5 — a KYC-required country is surfaced with its kycUrl', () => {
  const KYC = 'https://vendor.example/kyc/abc123';

  it('🔴 answers 202 with the address, and records NOTHING — nothing was ordered', async () => {
    mockZernio.zernioPurchaseNumber.mockResolvedValue({
      ok: true, status: 202,
      data: { numberId: '', phoneNumber: '', status: 'kyc_required', profileId: null, monthlyCostUsd: null, kycRequired: true, kycUrl: KYC },
    });
    const res = await POST(buy({ country: 'BR' }));
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.kycUrl, 'the identity-check address was dropped, so the church cannot finish').toBe(KYC);
    expect(body.number).toBeNull();
    expect(writes, 'a number record was written for a purchase that never happened').toHaveLength(0);
  });

  it('the transport reads the 202 shape at all — it carries no number, which is what used to discard it', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 202, json: async () => ({ status: 'kyc_required', kycUrl: KYC }),
    } as unknown as Response)));
    vi.stubEnv('ZERNIO_API_KEY', 'k');
    const real = await vi.importActual<typeof import('@/lib/zernio')>('@/lib/zernio');
    const r = await real.zernioPurchaseNumber({ profileId: 'church-a', purchaseIntentId: 'k1' });
    expect(r.data, 'the 202 was read as "no number" and thrown away').not.toBeNull();
    expect(r.data!.kycRequired).toBe(true);
    expect(r.data!.kycUrl).toBe(KYC);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────
   The retry key, and what it protects.                                      */
describe('6 — purchaseIntentId makes a retry idempotent', () => {
  it('is derived from the tenant, so a retry cannot vary it and buy a second number', async () => {
    await POST(buy({}));
    await POST(buy({}));
    const keys = mockZernio.zernioPurchaseNumber.mock.calls.map((c) => c[0].purchaseIntentId);
    expect(new Set(keys).size, 'a retry sent a different key, which buys another number').toBe(1);
    expect(keys[0]).toContain('church-a');
  });

  it('an already_purchased replay is a SUCCESS, not a second number', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ status: 'already_purchased', numberId: 'num_1', phoneNumber: '+16155550123', profileId: 'prof_assigned_9' }),
    } as unknown as Response)));
    vi.stubEnv('ZERNIO_API_KEY', 'k');
    const real = await vi.importActual<typeof import('@/lib/zernio')>('@/lib/zernio');
    const r = await real.zernioPurchaseNumber({ profileId: 'church-a', purchaseIntentId: 'k1' });
    expect(r.ok).toBe(true);
    expect(r.data!.alreadyPurchased).toBe(true);
    expect(r.data!.numberId).toBe('num_1');
    expect(r.data!.profileId).toBe('prof_assigned_9');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────
   No-regression. The controls THE-314 put in are still standing.           */
describe('7 — the reseller controls THE-318 must not have loosened', () => {
  it('🔴 the purchase still records what the number COSTS — Harvest carries it and bills the church', async () => {
    await POST(buy({}));
    const rec = writes.find((w) => w.path === 'integrations/sms')!;
    expect(rec.data.monthlyCostUsd, 'an unmetered number is money leaking off Harvest’s card').toBe(3);
    expect(rec.data.numberId).toBe('num_1');
    expect(rec.data.phoneNumber).toBe('+16155550123');
  });

  it('🔴 the route still writes no entitlement — buying a number does not grant a capability', async () => {
    await POST(buy({}));
    for (const w of writes) {
      expect(Object.keys(w.data), `${w.path} wrote entitlement`).not.toContain('plan');
      expect(Object.keys(w.data)).not.toContain('addons');
      expect(Object.keys(w.data)).not.toContain('smsAutomation');
    }
    expect(codeOf(read('app/api/sms/numbers/route.ts'))).not.toMatch(/\bplan:\s/);
  });

  it('🔴 SMS is still Ministry-only — the gate is the smsAutomation feature, not a widened tier', async () => {
    const { getEffectiveFeatures, readTenantAddons } = await import('@/utils/plan-features');
    // No add-ons: the tier alone must decide. THE-253 left `||` room for an
    // add-on to lift the gate later, so the tier is asked with none present.
    const none = readTenantAddons(undefined);
    for (const plan of ['free', 'starter', 'growth', 'pro'] as const) {
      const f = getEffectiveFeatures(plan as never, none);
      expect(f.smsAutomation, `smsAutomation is on for ${plan} — SMS was widened below Ministry`).toBe(false);
      expect(f.textToGive, `textToGive is on for ${plan} — SMS was widened below Ministry`).toBe(false);
    }
    const max = getEffectiveFeatures('max' as never, none);
    expect(max.smsAutomation, 'SMS is no longer on Ministry at all').toBe(true);
    expect(max.textToGive).toBe(true);
  });

  it('🔴 STOP still stops — every carrier-mandated keyword, asserted by BEHAVIOUR', async () => {
    /**
     * ⚠️ ASSERTED THROUGH `isStopKeyword`, NOT BY READING THE SOURCE. Written
     * as a source match it did not guard: `toContain('UNSUBSCRIBE')` is
     * satisfied by `'UNSUBSCRIBEX'`, so renaming a keyword out of the list
     * passed. Only the matcher can say whether the word still stops a send.
     *
     * 🔴 A number that keeps sending after STOP gets flagged and then blocked —
     * and it is HARVEST'S account and HARVEST'S brand registration, shared by
     * every church on the platform, because Harvest resells.
     */
    const { isStopKeyword, isStartKeyword } = await import('@/lib/sms-optout');
    for (const kw of ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      expect(isStopKeyword(kw), `${kw} no longer stops`).toBe(true);
      // Carriers send these in whatever case and spacing the member typed.
      expect(isStopKeyword(` ${kw.toLowerCase()} `), `${kw} only stops when shouted`).toBe(true);
    }
    expect(isStopKeyword('hello'), 'an ordinary reply is being read as a STOP').toBe(false);
    expect(isStartKeyword('START'), 'opting back in no longer works').toBe(true);
  });

  it('the webhook signature check was not weakened', () => {
    const z = codeOf(read('lib/zernio.ts'));
    expect(z).toContain('timingSafeEqual');
    expect(z).toContain('ZERNIO_WEBHOOK_SECRET');
    // Fails closed on every ambiguity — no secret, no header.
    expect(z).toMatch(/if \(!secret \|\| !header\) return false;/);
  });

  it('sms-feature.ts still imports nothing, so the switch reads from both bundles', () => {
    const f = read('lib/sms-feature.ts');
    expect(f, 'sms-feature.ts gained an import and is no longer readable from both sides').not.toMatch(
      /^\s*import\s/m,
    );
    expect(codeOf(f)).not.toMatch(/\brequire\(/);
  });

  it('lib/twilio.ts is still here — THE-314 kept it until the new path is proven', () => {
    expect(() => read('lib/twilio.ts')).not.toThrow();
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────
   The UI composes from the installed primitives.                           */
describe('8 — the identity-check action uses an installed primitive', () => {
  it('the KYC link is the ui/button primitive, not a hand-written anchor', () => {
    const src = read('components/settings/SmsSection.tsx');
    expect(src, 'no primitive is imported, so the action was hand-rolled').toContain(
      "from '@/components/ui/button'",
    );
    // 🔴 IMPORTED IS NOT ENOUGH — it must be what renders the link. An import
    // that nothing uses is a check counting imports rather than requiring them.
    expect(src).toMatch(/<Button[\s\S]{0,400}?render=\{<a[\s\S]{0,200}?href=\{kycUrl\}/);
    expect(src).toMatch(/rel="noopener noreferrer"/);
  });

  it('the panel adds no inline styles beyond the one THE-314 justified', () => {
    const src = read('components/settings/SmsSection.tsx');
    const inline = src.match(/style=\{\{/g) ?? [];
    // The single pre-existing one is THE-314's explicit bottom clearance, and
    // it is justified in the comment directly above it: the admin shell's
    // safe-area class is inert (#437 fixed only the member shell), so the panel
    // would otherwise sit under the fixed bottom nav on a phone.
    //
    // ⚠️ That justification is asserted by its REASON, not by the class name —
    // naming the class here would enrol this suite in THE-295's closed
    // safe-area register, which is that ticket's to append to, not this one's.
    expect(inline.length, 'a new inline style appeared without a justification').toBe(1);
    expect(src).toMatch(/bottom nav[\s\S]{0,200}?style=\{\{ paddingBottom: 120 \}\}/);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
