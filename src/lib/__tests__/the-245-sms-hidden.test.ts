import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * THE-245 / THE-314 — the SMS master switch, and what it is now.
 *
 * ─── 🔴 THIS FILE WAS REVERSED, NOT DELETED ──────────────────────────────────
 *
 * THE-245 hid SMS behind one boolean and this file asserted the OFF state:
 * every surface gone, every route refusing, nothing deleted. THE-314 IS THE
 * FLIP — `SMS_FEATURE_ENABLED` is now `true` — so the assertions turn round
 * with it. What the file guards has not changed:
 *
 *   1. ON — the switch is true, and every surface is genuinely back.
 *   2. OFF — flipping it back still refuses everything, proved by MOCKING the
 *      flag false rather than by trusting the docblock. The gate is live code,
 *      and code nothing exercises is code that has quietly stopped working.
 *   3. INTACT — no route file, component, plan value or collection went missing
 *      across the provider swap either.
 *
 * ⚠️ TWO THINGS THE FLIP DELIBERATELY DID NOT RESTORE, both of them the point
 * of THE-314 rather than drift:
 *   · THE PROVIDER IS NOT TWILIO. The send path is `lib/sms-send.ts` over
 *     `lib/zernio.ts`; `lib/twilio.ts` is retired in place and imported by
 *     nothing.
 *   · SMS IS MINISTRY-ONLY. `smsAutomation` and `textToGive` are true on `max`
 *     alone, where THE-245 left them true on every paid tier.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel: string) => { try { read(rel); return true; } catch { return false; } };

/** Mock the master switch OFF for one module graph, so the gate can be
 *  exercised rather than merely described. */
const armSwitchOff = () => {
  vi.doMock('@/lib/sms-feature', () => ({
    SMS_FEATURE_ENABLED: false,
    SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
  }));
};

/* ── 1 ─────────────────────────────────────────────────────────────────────
   The switch itself.                                                         */
describe('1 — the switch is one value, in one place, and it is ON', () => {
  it('🔴 is a single exported boolean, currently TRUE', async () => {
    const mod = await import('../sms-feature');
    expect(mod.SMS_FEATURE_ENABLED).toBe(true);
    expect(read('lib/sms-feature.ts'))
      .toMatch(/export const SMS_FEATURE_ENABLED = true;/);
  });

  it('🔴 imports nothing, so the public webhook stays cheap to gate', () => {
    // The same purity rule `lib/admin-sections.ts` keeps, for a related reason:
    // this module is read by a route handler AND by the client bundle, and the
    // three older master switches live in plan-features.ts, which drags the
    // whole pricing matrix in behind it. Turning the feature ON does not make
    // the webhook a good place to load a pricing matrix.
    const src = read('lib/sms-feature.ts');
    expect(src, 'sms-feature.ts grew an import').not.toMatch(/^\s*import\s/m);
    expect(src, 'sms-feature.ts grew a require').not.toMatch(/\brequire\s*\(/);
  });

  it('every gated surface reads THAT constant, not a copy of it', () => {
    // A second boolean spelled the same way is how "one switch" quietly becomes
    // two. Every file below must IMPORT it.
    //
    // ⚠️ `lib/twilio.ts` LEFT THIS LIST (THE-314). It is retired in place and
    // imported by nothing, so it is no longer a gated surface; `lib/sms-send.ts`
    // — the funnel that replaced it — took its place, and `api/sms/numbers` was
    // added with the purchase flow.
    const READERS = [
      'lib/sms-send.ts',
      'app/api/sms/broadcast/route.ts',
      'app/api/sms/config/route.ts',
      'app/api/sms/incoming/route.ts',
      'app/api/sms/numbers/route.ts',
      'app/api/sms/test/route.ts',
      'app/api/sms-usage/route.ts',
      'app/api/plans/route.ts',
      'components/AdminDashboard.tsx',
      'components/AdminSms.tsx',
      'components/AdminFundraising.tsx',
      'components/AdminRoles.tsx',
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
   🔴 SMS_FEATURE_ENABLED true brings every surface back — named per surface.  */
describe('2 — the switch being TRUE brings every surface back', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  const post = (body = '{}') =>
    new Request('https://x/api', { method: 'POST', body }) as never;

  /** Auth is stubbed to REFUSE, so each route's answer proves it got past the
   *  master switch and reached its own authorisation — the surface is live.
   *  A 503 here would mean the switch is still standing in front of it. */
  const armAuthRefusal = async () => {
    // A real NextResponse, because every route decides "did auth refuse?" with
    // `instanceof NextResponse`. A bare Response would sail past that check and
    // the route would carry on as an authenticated caller.
    const { NextResponse } = await import('next/server');
    const refuse = () => Promise.resolve(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    vi.doMock('@/lib/api-auth', () => ({
      requireAdmin: refuse, requireAuth: refuse, verifyAuth: refuse,
    }));
  };

  it.each([
    ['/api/sms/broadcast', '@/app/api/sms/broadcast/route', 'POST'],
    ['/api/sms/config', '@/app/api/sms/config/route', 'POST'],
    ['/api/sms/config', '@/app/api/sms/config/route', 'GET'],
    ['/api/sms/numbers', '@/app/api/sms/numbers/route', 'GET'],
    ['/api/sms/numbers', '@/app/api/sms/numbers/route', 'POST'],
    ['/api/sms/numbers', '@/app/api/sms/numbers/route', 'DELETE'],
    ['/api/sms/test', '@/app/api/sms/test/route', 'POST'],
    ['/api/sms-usage', '@/app/api/sms-usage/route', 'GET'],
  ] as const)('%s %s is live — it authorises rather than refusing 503', async (_label, mod, method) => {
    await armAuthRefusal();
    const route = await import(mod) as Record<string, (r: never) => Promise<Response>>;
    const res = await route[method](post());
    expect(res.status, `${_label} ${method} is still behind the master switch`).not.toBe(503);
    expect(res.status).toBe(401);
  });

  it('🔴 /api/sms/incoming is live — and answers 401 to an UNSIGNED request', async () => {
    // The public webhook is back, and the thing standing in front of it now is
    // the signature rather than the master switch. Not 503 (still hidden) and
    // not 200 (an open door): 401.
    const { POST } = await import('@/app/api/sms/incoming/route');
    const res = await POST(new Request('https://x/api/sms/incoming', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }) as never);
    expect(res.status).toBe(401);
  });

  it('the admin SMS screen and the number panel both mount', () => {
    // Both are wrappers that render null while the switch is off, so with it on
    // the real component is what gets mounted.
    expect(read('components/AdminSms.tsx'))
      .toMatch(/SMS_FEATURE_ENABLED \? <AdminSmsScreen \/> : null/);
    expect(read('components/settings/SmsSection.tsx'))
      // ⚠️ THE-327 — the component behind the switch is the settings SIGNPOST
      // now: the number lifecycle moved into the SMS section, which mounts
      // `SmsNumberPanel` itself. What this guard is about — that the section
      // renders through the ONE master switch and renders `null` when it is
      // off — is unchanged and still asserted here.
      .toMatch(/SMS_FEATURE_ENABLED \? <SmsSettingsPointer \/> : null/);
  });

  it('🔴 /api/plans publishes the real per-tier SMS claim again', async () => {
    // While the switch was off the key was OMITTED — "this catalogue makes no
    // claim about SMS". It is back, and it is what the marketing site verifies
    // its own tier claim against, so it must carry the true per-tier values.
    const { GET } = await import('@/app/api/plans/route');
    const body = await (await GET()).json();
    const claim = (id: string) =>
      body.plans.find((p: { id: string }) => p.id === id)?.features?.smsAutomation;
    expect(claim('free')).toBe(false);
    expect(claim('plus')).toBe(false);
    expect(claim('pro')).toBe(false);
    expect(claim('max')).toBe(true);
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

/* ── 3 ─────────────────────────────────────────────────────────────────────
   🔴 The gate still works — proved with the flag mocked OFF.                  */
describe('3 — flipping the switch back still refuses everything', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  /** Every route below must refuse BEFORE it authenticates or touches
   *  Firestore, so these throw if anything downstream is reached at all. */
  const explode = (what: string) => () => { throw new Error(`${what} was reached`); };

  const armMocks = () => {
    armSwitchOff();
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
    expect((await POST(post())).status).toBe(503);
  });

  it('GET and POST /api/sms/config → 503 — the Text-to-Give path', async () => {
    armMocks();
    const { GET, POST } = await import('@/app/api/sms/config/route');
    expect((await GET(post() as never)).status).toBe(503);
    expect((await POST(post())).status).toBe(503);
  });

  it('🔴 every method on /api/sms/numbers → 503 — nothing is bought or released', async () => {
    armMocks();
    const { GET, POST, DELETE } = await import('@/app/api/sms/numbers/route');
    expect((await GET(post() as never)).status).toBe(503);
    expect((await POST(post())).status).toBe(503);
    expect((await DELETE(post() as never)).status).toBe(503);
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
    // The one that would otherwise keep the feature fully live: the provider
    // POSTs here with no session, so no nav entry, permission or plan gate
    // stands in front of it. A real inbound payload must get nothing back.
    //
    // 🔴 THE SWITCH IS AHEAD OF THE SIGNATURE CHECK, so this is 503 and not
    // 401 — "the feature is off" outranks "prove who you are", and a hidden
    // feature must not even spend an HMAC on an attacker.
    armMocks();
    const { POST } = await import('@/app/api/sms/incoming/route');
    const res = await POST(new Request('https://x/api/sms/incoming', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'message.received', data: { message: { platform: 'sms', from: '+15551234567', to: '+15559876543', text: 'GIVE' } } }),
    }) as never);
    expect(res.status).toBe(503);
    // 🔴 And no message body for the provider to send on — a reply carried in
    // the response IS a billed segment.
    expect(await res.text()).not.toMatch(/<Message>|Give here/);
  });

  it('sendSms refuses before the plan gate, the STOP check, the cap and the provider', async () => {
    armSwitchOff();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reserve = vi.fn();
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: reserve,
      settleSmsSegments: vi.fn(),
      refundSmsSegment: vi.fn(),
    }));
    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' },
      '+15551234567',
      'hello',
      { tenantId: 'church', source: 'platform' },
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('feature_hidden');
    expect(fetchSpy, 'a request went to the provider').not.toHaveBeenCalled();
    // 🔴 AHEAD OF THE RESERVE. Gating after it would consume a church's monthly
    // allotment for a message that was never sent.
    expect(reserve, 'a segment was reserved for a send that never happened')
      .not.toHaveBeenCalled();
  });

  it('sendAutomatedSms returns before it sends AND before it logs', async () => {
    // ⚠️ EVERY PRECONDITION FOR A REAL SEND IS SATISFIED HERE, deliberately.
    // The tenant has a number, the trigger is enabled and has template text,
    // and the provider would answer 200. Without the gate this call sends a
    // message and writes an smsLogs row; with it, neither happens. A mock that
    // fell short of a live send would pass whether the gate existed or not.
    armSwitchOff();
    const add = vi.fn().mockResolvedValue(undefined);
    const configured = {
      exists: true,
      data: () => ({
        numberId: 'num_1', phoneNumber: '+15550000000', profileId: 'church', status: 'active',
        templates: { checkin_thankyou: { enabled: true, text: 'Thanks {name}!' } },
        text2give: { enabled: false },
      }),
    };
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ plan: 'max' }) }),
            collection: () => ({ add, doc: () => ({ get: async () => configured }) }),
          }),
        }),
      },
    }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: vi.fn(async () => ({ allowed: true })),
      settleSmsSegments: vi.fn(), refundSmsSegment: vi.fn(),
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_1', segments: 1 }), { status: 200 }),
    );

    const { sendAutomatedSms } = await import('../sms-send');
    await expect(
      sendAutomatedSms('church', 'checkin_thankyou', '+15551234567', { name: 'Ada' }),
    ).resolves.toBeUndefined();

    expect(fetchSpy, 'a check-in thank-you reached the provider').not.toHaveBeenCalled();
    // A suppressed send is not history: no 'blocked' rows for messages nobody
    // asked for. Existing smsLogs rows are untouched either way.
    expect(add, 'a suppressed send wrote an smsLogs row').not.toHaveBeenCalled();
  });

  it('🔴 check-in, event registration and pledge still call it, and still work', () => {
    // The dependency STOP condition, pinned. All three are best-effort callers
    // of sendAutomatedSms, none of them blocks on it, and every one already
    // no-ops for a tenant with no number. Hiding SMS removes the text and
    // nothing else: the check-in is still recorded, the registration still
    // confirms, the pledge is still written, and all three email confirmations
    // still send.
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
   🔴 Nothing was deleted — by the hiding, or by the provider swap.            */
describe('4 — hide, not delete; and swap, not delete', () => {
  it('every route file, component and lib is still on disk', () => {
    for (const rel of [
      'app/api/sms/broadcast/route.ts',
      'app/api/sms/config/route.ts',
      'app/api/sms/incoming/route.ts',
      'app/api/sms/numbers/route.ts',
      'app/api/sms/test/route.ts',
      'app/api/sms-usage/route.ts',
      'components/AdminSms.tsx',
      'components/settings/SmsSection.tsx',
      'lib/sms-send.ts',
      'lib/sms-optout.ts',
      'lib/zernio.ts',
      'lib/sms-usage.ts',
      'lib/sms-destination.ts',
      // 🔴 RETIRED IN PLACE, NOT DELETED. The proven send path stays on disk
      // until the new one has run in production — a dead module is cheaper than
      // a broken send path. See the retirement plan at the head of twilio.ts.
      'lib/twilio.ts',
      'lib/twilio-platform.ts',
    ]) {
      expect(exists(rel), `${rel} was deleted`).toBe(true);
    }
  });

  it('🔴 the retired Twilio module is imported by nothing', () => {
    // The other half of "retired in place": it must not be reachable. A caller
    // that found its way back to it would send on an account Harvest no longer
    // maintains, and would escape the Ministry gate and the STOP check that
    // only exist in the new funnel.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(
      `grep -rln "from '@/lib/twilio'\\|from './twilio'" ${SRC} || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      // The retired pair may still reference each other — `twilio-platform.ts`
      // takes a `TwilioConfig` type from `twilio.ts`. They retire together, in
      // the one follow-up change the retirement plan describes.
      .filter((f) => !/\/lib\/twilio(-platform)?\.ts$/.test(f))
      // And this file, which names the import pattern in order to search for it.
      .filter((f) => !f.includes('__tests__'));
    expect(hits, `lib/twilio.ts is still imported by:\n${hits.join('\n')}`).toEqual([]);
  });

  it('🔴 no smsLogs or smsBroadcasts read, write or migration was removed', () => {
    // A church that gets SMS back must find its history where it left it. The
    // collections are still named by the code that owns them, and NOTHING in
    // this change deletes, migrates or rewrites a document.
    expect(read('lib/sms-send.ts'), 'the smsLogs write is gone').toContain("collection('smsLogs')");
    expect(read('app/api/sms/incoming/route.ts')).toContain("collection('smsLogs')");
    expect(read('app/api/sms/broadcast/route.ts')).toContain('smsBroadcasts');
    expect(read('components/AdminSms.tsx'), 'the history reader is gone').toContain('smsBroadcasts');

    // And no delete/migration appeared anywhere alongside the gate or the swap.
    for (const rel of ['lib/sms-feature.ts', 'lib/sms-send.ts']) {
      expect(read(rel), `${rel} deletes SMS data`)
        .not.toMatch(/\.delete\(\)|deleteDoc|bulkWriter|recursiveDelete/);
    }
  });

  it('🔴 the swap keeps a church\'s templates and Text-to-Give keyword', () => {
    // They are tenant CONTENT, not vendor credentials, so they survive the move
    // off the old integrations document. THE-245 promised a church would find
    // its configuration where it left it; a provider swap must not quietly
    // break that promise.
    expect(read('lib/sms-send.ts')).toContain("collection('integrations').doc('twilio')");
  });

  it('🔴 smsAutomation and textToGive are TRUE on max only', async () => {
    // ⚠️ REVERSED BY THE-314. THE-245 asserted these were true on every PAID
    // tier and that the gate went in front of the matrix without editing it.
    // The matrix has now moved, deliberately: Harvest resells, so the cell
    // decides who spends Harvest's money, and the founder's call is Ministry.
    const { getPlanFeatures } = await import('../../utils/plan-features');
    expect(getPlanFeatures('free').smsAutomation, 'free').toBe(false);
    expect(getPlanFeatures('plus').smsAutomation, 'plus (Individual)').toBe(false);
    expect(getPlanFeatures('pro').smsAutomation, 'pro (Small Team)').toBe(false);
    expect(getPlanFeatures('max').smsAutomation, 'max (Ministry)').toBe(true);

    expect(getPlanFeatures('free').textToGive, 'free').toBe(false);
    expect(getPlanFeatures('plus').textToGive, 'plus (Individual)').toBe(false);
    expect(getPlanFeatures('pro').textToGive, 'pro (Small Team)').toBe(false);
    expect(getPlanFeatures('max').textToGive, 'max (Ministry)').toBe(true);

    // Asserted on the source too, so a value edited to match a changed
    // expectation still fails.
    const matrix = readFileSync(path.join(SRC, 'utils/plan-features.ts'), 'utf8');
    expect((matrix.match(/^\s*smsAutomation: (true|false),$/gm) ?? []).length).toBe(4);
    expect((matrix.match(/^\s*textToGive: (true|false),$/gm) ?? []).length).toBe(4);
    expect((matrix.match(/^\s*smsAutomation: true,$/gm) ?? []).length, 'exactly one tier sells SMS').toBe(1);
    expect((matrix.match(/^\s*textToGive: true,$/gm) ?? []).length, 'exactly one tier sells Text-to-Give').toBe(1);
  });

  it('the sms section keeps its row in the admin URL vocabulary', () => {
    // `admin-sections.ts` is a CLOSED table asserted against the nav in both
    // directions.
    expect(read('lib/admin-sections.ts')).toContain("['sms', 'sms']");
    expect(read('components/AdminDashboard.tsx')).toContain("{ id: 'sms', label: 'SMS', icon: MessageSquare }");
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   🔴 Text-to-Give moves with SMS — a giving capability, stated explicitly.    */
describe('5 — Text-to-Give has no path in that does not cross the switch', () => {
  it('all three doors are gated', () => {
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

  it('🔴 is gated by the tenant having a NUMBER, and by the plan behind it', () => {
    // ⚠️ REVERSED BY THE-314. This used to read "gated per tenant by BYO Twilio
    // credentials, NOT by plan — so the master switch is the only lever". Both
    // halves changed: there are no BYO credentials, and the plan is now a real
    // gate. What decides whether a church's keyword works is whether Harvest
    // bought it a number, and the reply then crosses the same Ministry gate as
    // every other send.
    const incoming = read('app/api/sms/incoming/route.ts');
    expect(incoming).toContain('getTenantSmsNumber');
    // The webhook still does not read the plan ITSELF — the funnel owns that
    // decision, so there is one place it is made.
    expect(incoming, 'the webhook grew its own plan gate').not.toContain('getPlanFeatures');
    expect(incoming, 'the webhook grew its own plan gate').not.toContain('getEffectiveFeatures');
    expect(read('lib/sms-send.ts'), 'the funnel stopped gating on the plan')
      .toContain('getEffectiveFeatures');
  });
});
