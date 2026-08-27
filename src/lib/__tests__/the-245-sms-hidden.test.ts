import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * THE-245 — SMS is hidden, and nothing was deleted to hide it.
 *
 * ─── What this file is for ───────────────────────────────────────────────────
 *
 * The SMS feature is UNTESTED and the app is about to be marketed. It is not a
 * cosmetic surface: every send spends real money on a Twilio account and lands
 * on a real phone, and `/api/sms/incoming` is PUBLIC AND UNAUTHENTICATED, so a
 * Twilio number pointed at it drives Text-to-Give with no session at all. A
 * hidden nav item would not have been a gate.
 *
 * So this file asserts three things, and the third is the one that makes the
 * other two safe to ship:
 *
 *   1. OFF — every surface is gone and every route refuses.
 *   2. INTACT — no route file, component, plan value or collection was removed.
 *   3. ON — flipping the one switch brings all of it back.
 *
 * ⚠️ The ON direction is mostly asserted ELSEWHERE, and deliberately: the real
 * SMS suites (lib/__tests__/twilio.test.ts, the four route suites, the tier
 * entitlement and desktop-layout suites) all run with the switch mocked true,
 * so the behaviour that returns is pinned by the tests that always pinned it
 * rather than by a weaker restatement here. What this file adds is that the
 * switch is the ONLY thing standing between the two states.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel: string) => { try { read(rel); return true; } catch { return false; } };

/* ── 1 ─────────────────────────────────────────────────────────────────────
   The switch itself.                                                         */
describe('1 — the switch is one value, in one place', () => {
  it('is a single exported boolean, currently false', async () => {
    const mod = await import('../sms-feature');
    expect(mod.SMS_FEATURE_ENABLED).toBe(false);
    expect(read('lib/sms-feature.ts'))
      .toMatch(/export const SMS_FEATURE_ENABLED = false;/);
  });

  it('imports nothing, so the public webhook stays cheap to gate', () => {
    // The same purity rule `lib/admin-sections.ts` keeps, for a related reason:
    // this module is read by a route handler AND by the client bundle, and the
    // three older master switches live in plan-features.ts, which drags the
    // whole pricing matrix in behind it.
    const src = read('lib/sms-feature.ts');
    expect(src, 'sms-feature.ts grew an import').not.toMatch(/^\s*import\s/m);
  });

  it('every gated surface reads THAT constant, not a copy of it', () => {
    // A second boolean spelled the same way is how "one switch" quietly becomes
    // two. Every file below must IMPORT it.
    const READERS = [
      'lib/twilio.ts',
      'app/api/sms/broadcast/route.ts',
      'app/api/sms/config/route.ts',
      'app/api/sms/incoming/route.ts',
      'app/api/sms/test/route.ts',
      'app/api/sms-usage/route.ts',
      'app/api/plans/route.ts',
      'components/AdminDashboard.tsx',
      'components/AdminSms.tsx',
      'components/AdminFundraising.tsx',
      'components/AnalyticsAndRoles.tsx',
      'components/ContactModal.tsx',
      'components/admin/TenantUsagePanel.tsx',
      'components/settings/SmsSection.tsx',
      'components/settings/PlanUpgradeSection.tsx',
    ];
    for (const rel of READERS) {
      const src = read(rel);
      expect(src, `${rel} does not read the SMS master switch`)
        .toMatch(/import \{[^}]*SMS_FEATURE_ENABLED[^}]*\} from ['"][^'"]*sms-feature['"]/);
      expect(src, `${rel} declares its own SMS_FEATURE_ENABLED`)
        .not.toMatch(/(const|let|var)\s+SMS_FEATURE_ENABLED\s*=/);
    }
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 The API routes refuse — including the public, unauthenticated webhook.   */
describe('2 — the SMS API routes refuse while the switch is off', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  /** Every route below must refuse BEFORE it authenticates or touches
   *  Firestore, so these throw if anything downstream is reached at all. */
  const explode = (what: string) => () => { throw new Error(`${what} was reached`); };

  const armMocks = () => {
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: { collection: explode('Firestore') },
    }));
    vi.doMock('@/lib/api-auth', () => ({
      requireAdmin: explode('requireAdmin'),
      requireAuth: explode('requireAuth'),
      verifyAuth: explode('verifyAuth'),
    }));
  };

  const post = (body = '{}') =>
    new Request('https://x/api', { method: 'POST', body }) as never;

  it('POST /api/sms/broadcast → 503, without authenticating', async () => {
    armMocks();
    const { POST } = await import('@/app/api/sms/broadcast/route');
    const res = await POST(post());
    expect(res.status).toBe(503);
  });

  it('GET and POST /api/sms/config → 503 — the credential and Text-to-Give path', async () => {
    armMocks();
    const { GET, POST } = await import('@/app/api/sms/config/route');
    expect((await GET(post() as never)).status).toBe(503);
    expect((await POST(post())).status).toBe(503);
  });

  it('POST /api/sms/test → 503 — a test send is a real billed send', async () => {
    armMocks();
    const { POST } = await import('@/app/api/sms/test/route');
    expect((await POST(post())).status).toBe(503);
  });

  it('GET /api/sms-usage → 503', async () => {
    armMocks();
    const { GET } = await import('@/app/api/sms-usage/route');
    expect((await GET(post() as never)).status).toBe(503);
  });

  it('🔴 POST /api/sms/incoming → 503 — the PUBLIC, UNAUTHENTICATED webhook', async () => {
    // The one that would otherwise keep the feature fully live: Twilio POSTs
    // here with no session, so no nav entry, permission or plan gate stands in
    // front of it. A real Text-to-Give payload must get nothing back.
    armMocks();
    const { POST } = await import('@/app/api/sms/incoming/route');
    const twilio = new Request('https://x/api/sms/incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'Body=GIVE&From=%2B15551234567&To=%2B15559876543',
    });
    const res = await POST(twilio as never);
    expect(res.status).toBe(503);
    // 🔴 And no TwiML — a <Message> body IS the reply, and it bills a segment.
    const text = await res.text();
    expect(text).not.toMatch(/<Response>/);
    expect(text).not.toMatch(/<Message>/);
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   The send funnel, and the three non-SMS features that call it.              */
describe('3 — nothing reaches Twilio, and nothing else breaks', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it('sendSms refuses before the destination gate, the cap and Twilio', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reserve = vi.fn();
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: reserve,
      settleSmsSegments: vi.fn(),
      refundSmsSegment: vi.fn(),
      recordByoSegments: vi.fn(),
    }));
    const { sendSms } = await import('../twilio');
    const result = await sendSms(
      { accountSid: 'AC1', authToken: 't', fromNumber: '+15550000000' },
      '+15551234567',
      'hello',
      { tenantId: 'church', source: 'byo' },
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('feature_hidden');
    expect(fetchSpy, 'a request went to Twilio').not.toHaveBeenCalled();
    // 🔴 AHEAD OF THE RESERVE. Gating after it would consume a church's monthly
    // allotment for a message that was never sent.
    expect(reserve, 'a segment was reserved for a send that never happened')
      .not.toHaveBeenCalled();
  });

  it('sendAutomatedSms returns before it sends AND before it logs', async () => {
    const add = vi.fn();
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: { collection: () => ({ doc: () => ({ collection: () => ({ add, doc: () => ({ get: vi.fn() }) }) }) }) },
    }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: vi.fn(), settleSmsSegments: vi.fn(),
      refundSmsSegment: vi.fn(), recordByoSegments: vi.fn(),
    }));
    const { sendAutomatedSms } = await import('../twilio');
    await expect(
      sendAutomatedSms('church', 'checkin_thankyou', '+15551234567', { name: 'Ada' }),
    ).resolves.toBeUndefined();
    // A suppressed send is not history: no 'blocked' rows for messages nobody
    // asked for. Existing smsLogs rows are untouched either way.
    expect(add, 'a suppressed send wrote an smsLogs row').not.toHaveBeenCalled();
  });

  it('🔴 check-in, event registration and pledge still call it, and still work', () => {
    // The dependency STOP condition, pinned. All three are best-effort callers
    // of sendAutomatedSms, none of them blocks on it, and every one already
    // no-ops for a tenant with no Twilio credentials — which is most of them.
    // Hiding SMS removes the text and nothing else: the check-in is still
    // recorded, the registration still confirms, the pledge is still written,
    // and all three email confirmations still send.
    const CALLERS = [
      'app/api/checkin/submit/route.ts',
      'app/api/event-registration/submit/route.ts',
      'app/api/pledge/submit/route.ts',
    ];
    for (const rel of CALLERS) {
      const src = read(rel);
      expect(src, `${rel} stopped calling sendAutomatedSms`).toContain('sendAutomatedSms');
      // Not gated at the CALL SITE — the funnel owns the decision, so there is
      // one place to flip and no call site can drift out of step with it.
      expect(src, `${rel} grew its own SMS gate instead of using the funnel`)
        .not.toContain('SMS_FEATURE_ENABLED');
    }
    // Each one's non-SMS work is still there.
    expect(read('app/api/checkin/submit/route.ts')).toContain("collection('attendees')");
    expect(read('app/api/pledge/submit/route.ts')).toContain('resend.emails.send');
    expect(read('app/api/event-registration/submit/route.ts')).toContain('resend.emails.send');
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   🔴 Nothing was deleted.                                                     */
describe('4 — hide, not delete', () => {
  it('every route file, component and lib is still on disk', () => {
    for (const rel of [
      'app/api/sms/broadcast/route.ts',
      'app/api/sms/config/route.ts',
      'app/api/sms/incoming/route.ts',
      'app/api/sms/test/route.ts',
      'app/api/sms-usage/route.ts',
      'components/AdminSms.tsx',
      'components/settings/SmsSection.tsx',
      'lib/twilio.ts',
      'lib/twilio-platform.ts',
      'lib/sms-usage.ts',
      'lib/sms-destination.ts',
    ]) {
      expect(exists(rel), `${rel} was deleted`).toBe(true);
    }
  });

  it('🔴 no smsLogs or smsBroadcasts read, write or migration was removed', () => {
    // A church that gets SMS back must find its history where it left it. The
    // collections are still named by the code that owns them, and NOTHING in
    // this change deletes, migrates or rewrites a document.
    expect(read('lib/twilio.ts'), 'the smsLogs write is gone').toContain("collection('smsLogs')");
    expect(read('app/api/sms/incoming/route.ts')).toContain("collection('smsLogs')");
    expect(read('app/api/sms/broadcast/route.ts')).toContain('smsBroadcasts');
    expect(read('components/AdminSms.tsx'), 'the history reader is gone').toContain('smsBroadcasts');

    // And no delete/migration appeared anywhere alongside the gate.
    for (const rel of ['lib/sms-feature.ts', 'lib/twilio.ts', 'app/api/sms/incoming/route.ts']) {
      expect(read(rel), `${rel} deletes SMS data`)
        .not.toMatch(/\.delete\(\)|deleteDoc|bulkWriter|recursiveDelete/);
    }
  });

  it('🔴 smsAutomation and textToGive keep their matrix values', async () => {
    // The gate goes IN FRONT of the matrix; it never edits it. The tiers that
    // own SMS still own it, so flipping the switch restores the exact same
    // entitlement rather than a re-derived guess at it.
    const { getPlanFeatures } = await import('../../utils/plan-features');
    expect(getPlanFeatures('free').smsAutomation).toBe(false);
    expect(getPlanFeatures('plus').smsAutomation).toBe(true);
    expect(getPlanFeatures('pro').smsAutomation).toBe(true);
    expect(getPlanFeatures('max').smsAutomation).toBe(true);

    expect(getPlanFeatures('free').textToGive).toBe(false);
    expect(getPlanFeatures('plus').textToGive).toBe(true);
    expect(getPlanFeatures('pro').textToGive).toBe(true);
    expect(getPlanFeatures('max').textToGive).toBe(true);

    // Asserted on the source too, so a value edited to match a changed
    // expectation still fails.
    const matrix = readFileSync(path.join(SRC, 'utils/plan-features.ts'), 'utf8');
    expect((matrix.match(/^\s*smsAutomation: (true|false),$/gm) ?? []).length).toBe(4);
    expect((matrix.match(/^\s*textToGive: (true|false),$/gm) ?? []).length).toBe(4);
  });

  it('the sms section keeps its row in the admin URL vocabulary', () => {
    // `admin-sections.ts` is a CLOSED table asserted against the nav in both
    // directions. Hiding the tab must not remove the row — the section is
    // coming back, and a removed row would take the URL with it.
    expect(read('lib/admin-sections.ts')).toContain("['sms', 'sms']");
    expect(read('components/AdminDashboard.tsx')).toContain("{ id: 'sms', label: 'SMS', icon: MessageSquare }");
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   🔴 Text-to-Give goes with it — a giving capability, stated explicitly.      */
describe('5 — Text-to-Give is unreachable while the switch is off', () => {
  it('has no path in that does not cross the switch', () => {
    // Three doors, all of them gated:
    //   · the setup card lives inside AdminSms, which does not mount;
    //   · its config is read and written through /api/sms/config, which 503s;
    //   · the keyword arrives on /api/sms/incoming, which 503s.
    expect(read('components/AdminSms.tsx')).toContain('Text-to-Give');
    expect(read('components/AdminSms.tsx'))
      .toMatch(/SMS_FEATURE_ENABLED \? <AdminSmsScreen \/> : null/);
    expect(read('app/api/sms/config/route.ts')).toContain('text2give');
    for (const rel of ['app/api/sms/config/route.ts', 'app/api/sms/incoming/route.ts']) {
      expect(read(rel)).toMatch(/if \(!SMS_FEATURE_ENABLED\)/);
    }
  });

  it('is gated per tenant by BYO Twilio credentials, not by plan — so this is the only lever', () => {
    // Worth stating because it is the surprising half: `textToGive` is a plan
    // cell, but what actually decides whether a church's keyword works is
    // whether they saved Twilio credentials. There is no per-tenant switch to
    // reach for and no plan tier that keeps it alive, so hiding SMS hides
    // Text-to-Give for everyone at once.
    const incoming = read('app/api/sms/incoming/route.ts');
    expect(incoming).toContain('resolveTwilioConfig');
    expect(incoming, 'the webhook consults a plan tier').not.toContain('textToGive');
    expect(incoming, 'the webhook consults a plan tier').not.toContain('getPlanFeatures');
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────
   The marketing claim the app publishes to the site.                          */
describe('6 — /api/plans stops publishing an SMS claim', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('omits smsAutomation from every tier rather than setting it false', async () => {
    // Absent says "this catalogue makes no claim about SMS". `false` would say
    // "this tier does not include SMS", which is a different and untrue claim.
    const { GET } = await import('@/app/api/plans/route');
    const body = await (await GET()).json();
    expect(body.plans.length).toBeGreaterThan(0);
    for (const plan of body.plans) {
      expect(Object.keys(plan.features), `${plan.id} still publishes smsAutomation`)
        .not.toContain('smsAutomation');
    }
    // The rest of the catalogue is untouched — this is a withdrawal of one key.
    for (const plan of body.plans) {
      expect(plan.features).toHaveProperty('newsletterAutomation');
      expect(plan).toHaveProperty('pricing');
    }
  });

  it('🔴 no price changed', async () => {
    const { GET } = await import('@/app/api/plans/route');
    const body = await (await GET()).json();
    const priceOf = (id: string) => body.plans.find((p: { id: string }) => p.id === id)?.pricing;
    expect(priceOf('plus')).toMatchObject({ monthlyUsd: 20, quarterlyUsd: 54, yearlyUsd: 190 });
    expect(priceOf('pro')).toMatchObject({ monthlyUsd: 40, quarterlyUsd: 108, yearlyUsd: 380 });
    expect(priceOf('max')).toMatchObject({ monthlyUsd: 80, quarterlyUsd: 216, yearlyUsd: 760 });
  });
});
