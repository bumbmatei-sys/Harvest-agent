import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-314 — SMS on, on a new provider, sold to Ministry only, with the number
 * bought inside Harvest.
 *
 * 🔴 THE ONE FACT EVERY ASSERTION BELOW FOLLOWS FROM: HARVEST RESELLS. One
 * vendor account, Harvest's; Harvest pays for the number and for every segment
 * and then bills the church. Three things follow, and they are what this file
 * guards:
 *
 *   · AN UNMETERED SEND IS MONEY LEAKING. Not a church's money any more —
 *     Harvest's, off Harvest's card, before any invoice goes out.
 *   · A CARRIER COMPLAINT LANDS ON HARVEST. STOP is not a courtesy to the
 *     member, it is the control that keeps Harvest's number and brand
 *     registration alive, and every church on the platform shares them.
 *   · BUYING A NUMBER IS NOT GRANTING A CAPABILITY. The capability is the
 *     Ministry plan, and the Dodo webhook is still its only writer.
 *
 * The webhook signature and the STOP keyword set live with the route they
 * protect, in `app/api/sms/__tests__/incoming-route.test.ts`. The master switch
 * and the surfaces it restores live in `the-245-sms-hidden.test.ts`.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

/**
 * The file with its comments removed.
 *
 * ⚠️ NEEDED, NOT FASTIDIOUS. Several assertions below forbid a PATTERN, and the
 * docblocks in these files name the very pattern they forbid so a reader
 * understands what not to write — `plan === 'max'` is spelled out in the funnel
 * precisely to say "not this". A raw source match would read that warning as
 * the offence it warns against. PR references like `#434` trip a hex-colour
 * sweep the same way.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 1 ─────────────────────────────────────────────────────────────────────
   🔴 Every send is metered. There is no unmetered path.                      */
describe('1 — every send is metered into tenants/{id}/usage/{YYYY-MM}', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  /** A tenant on Ministry, with no opt-out, and a provider that accepts. */
  const armSend = (over: { plan?: string; optedOut?: boolean } = {}) => {
    const reserve = vi.fn(async () => ({ allowed: true, used: 1, cap: 2_000 }));
    const settle = vi.fn(async () => {});
    const refund = vi.fn(async () => {});
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: reserve, settleSmsSegments: settle, refundSmsSegment: refund,
    }));
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ plan: over.plan ?? 'max' }) }),
            collection: () => ({
              add: vi.fn(async () => {}),
              doc: () => ({ get: async () => ({ exists: !!over.optedOut, data: () => ({}) }) }),
            }),
          }),
        }),
      },
    }));
    return { reserve, settle, refund };
  };

  it('🔴 reserves BEFORE the provider and settles the real segment count after', async () => {
    const { reserve, settle, refund } = armSend();
    const send = vi.fn(async () => ({ ok: true, id: 'msg_1', segments: 3 }));
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: send }));

    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'hello',
      { tenantId: 'church', source: 'platform' },
    );

    expect(result.ok).toBe(true);
    expect(reserve, 'the send did not reserve').toHaveBeenCalledWith('church');
    // 🔴 Settled with the PROVIDER'S count, not an estimate from body length.
    // An estimate that disagreed with the invoice would drift the meter
    // permanently in whichever direction it was wrong.
    expect(settle).toHaveBeenCalledWith('church', 3);
    expect(refund).not.toHaveBeenCalled();
  });

  it('🔴 a message the provider never accepted is REFUNDED, not billed', async () => {
    const { reserve, settle, refund } = armSend();
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: vi.fn(async () => ({ ok: false, error: 'boom' })) }));

    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'hello',
      { tenantId: 'church', source: 'platform' },
    );

    expect(result.ok).toBe(false);
    expect(reserve).toHaveBeenCalled();
    expect(refund, 'a failed send permanently ate a segment').toHaveBeenCalledWith('church');
    expect(settle).not.toHaveBeenCalled();
  });

  it('🔴 a delivered message is never metered as ZERO', async () => {
    // Under the reseller model a 0 here is Harvest paying for a segment it did
    // not record. A provider response with no count settles as 1.
    const { settle } = armSend();
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: vi.fn(async () => ({ ok: true, id: 'm' })) }));

    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'hi',
      { tenantId: 'church', source: 'platform' },
    );
    expect(result.segments).toBeGreaterThanOrEqual(1);
    expect(settle).toHaveBeenCalledWith('church', 1);
  });

  it('🔴 there is exactly ONE module that talks to the provider', async () => {
    // The property the meter rests on. A second caller reaching the vendor
    // directly would escape the reserve, the cap and the STOP check at once.
    const { execSync } = await import('node:child_process');
    const importers = execSync(`grep -rl "from '@/lib/zernio'\\|from './zernio'" ${SRC} || true`, { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((f) => path.relative(SRC, f))
      .filter((f) => !f.includes('__tests__'))
      .sort();
    // The funnel, the two routes that manage NUMBERS (not messages), and the
    // super-admin panel's "is a vendor account configured at all" read.
    expect(importers).toEqual([
      'app/api/admin/tenant-usage/route.ts',
      'app/api/sms/incoming/route.ts',
      'app/api/sms/numbers/route.ts',
      'app/api/sms/test/route.ts',
      'lib/sms-send.ts',
    ]);
    // 🔴 And of those, only the funnel may SEND.
    const senders = execSync(`grep -rl "zernioSendSms" ${SRC} || true`, { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((f) => path.relative(SRC, f))
      .filter((f) => !f.includes('__tests__'))
      // The transport module DECLARES it; the question is who CALLS it.
      .filter((f) => f !== 'lib/zernio.ts');
    expect(senders, 'something other than the send funnel reaches the provider to SEND')
      .toEqual(['lib/sms-send.ts']);
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 Ministry only, enforced in the funnel and not merely in the matrix.      */
describe('2 — the plan gate is server-side, inside the one funnel', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  const armPlan = (plan: string) => {
    const reserve = vi.fn(async () => ({ allowed: true, used: 1, cap: 2_000 }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: reserve, settleSmsSegments: vi.fn(), refundSmsSegment: vi.fn(),
    }));
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ plan }) }),
            collection: () => ({ add: vi.fn(), doc: () => ({ get: async () => ({ exists: false }) }) }),
          }),
        }),
      },
    }));
    const send = vi.fn(async () => ({ ok: true, id: 'm', segments: 1 }));
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: send }));
    return { reserve, send };
  };

  it.each(['free', 'plus', 'pro'])('refuses a %s tenant BEFORE reserving anything', async (plan) => {
    const { reserve, send } = armPlan(plan);
    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'hello',
      { tenantId: 'church', source: 'platform' },
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('plan_not_entitled');
    expect(send, `${plan} reached the provider`).not.toHaveBeenCalled();
    // A refusal that consumed allotment would charge a church for a message it
    // was never allowed to send.
    expect(reserve, `${plan} consumed a segment on a refused send`).not.toHaveBeenCalled();
  });

  it('allows a max (Ministry) tenant', async () => {
    const { send } = armPlan('max');
    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'hello',
      { tenantId: 'church', source: 'platform' },
    );
    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it('🔴 FAILS CLOSED when the tenant cannot be read', async () => {
    // A tenant whose plan is unknown is a tenant whose entitlement is unknown,
    // and a send spends Harvest's money.
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: vi.fn(), settleSmsSegments: vi.fn(), refundSmsSegment: vi.fn(),
    }));
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) },
    }));
    const send = vi.fn();
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: send }));

    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'hello',
      { tenantId: 'church', source: 'platform' },
    );
    expect(result.code).toBe('plan_not_entitled');
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 reads the EFFECTIVE features, so an add-on could still lift it later', async () => {
    // THE-253's rule: add-on capabilities are lifted with `||`, never assigned.
    // Gating on `plan === "max"` here would close that door — this is the line
    // that keeps it open, and it is asserted rather than left to a comment.
    const funnel = codeOf(read('lib/sms-send.ts'));
    expect(funnel, 'the funnel gates on the raw plan instead of the effective features')
      .toContain('getEffectiveFeatures');
    expect(funnel, 'the funnel hardcodes the tier').not.toMatch(/plan\s*===\s*['"]max['"]/);
    expect(codeOf(read('app/api/sms/numbers/route.ts'))).toContain('getEffectiveFeatures');
    expect(codeOf(read('app/api/sms/numbers/route.ts')), 'the purchase route hardcodes the tier')
      .not.toMatch(/plan\s*===\s*['"]max['"]/);
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   🔴 A member who texted STOP receives no further broadcast.                  */
describe('3 — a member who texts STOP receives no further broadcast', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  it('🔴 the funnel refuses a suppressed recipient before the provider is called', async () => {
    // ⚠️ ASSERTED WHETHER OR NOT THE VENDOR ALSO ENFORCES IT. The vendor does —
    // it opts the recipient out at the carrier and refuses later sends with a
    // 409, never silently — and Harvest still refuses first. This is the
    // guarantee that survives a provider swap, which is precisely the event
    // this ticket is.
    const send = vi.fn();
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: send }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: vi.fn(async () => ({ allowed: true })), settleSmsSegments: vi.fn(), refundSmsSegment: vi.fn(),
    }));
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ plan: 'max' }) }),
            // The opt-out document EXISTS for this number.
            collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }) }),
          }),
        }),
      },
    }));

    const { sendSms } = await import('../sms-send');
    const result = await sendSms(
      { phoneNumber: '+15550000000' }, '+12125551234', 'Sunday service is at 10',
      { tenantId: 'church', source: 'platform' },
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('recipient_opted_out');
    expect(send, '🔴 a message went to a member who replied STOP').not.toHaveBeenCalled();
  });

  it('🔴 FAILS CLOSED — an unreadable opt-out list refuses the send', async () => {
    // Sending to someone who may have said STOP is what gets a number blocked.
    // Not sending is a message that arrives late. Those are not comparable.
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) }) }) },
    }));
    const { isOptedOut } = await import('../sms-optout');
    expect(await isOptedOut('church', '+12125551234')).toBe(true);
  });

  it('the five carrier-mandated keywords are the ones honoured', async () => {
    const { STOP_KEYWORDS, isStopKeyword } = await import('../sms-optout');
    expect([...STOP_KEYWORDS]).toEqual(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
    for (const k of STOP_KEYWORDS) expect(isStopKeyword(k.toLowerCase()), k).toBe(true);
    // Whole-body, not substring: "please don't stop these" is the opposite ask.
    expect(isStopKeyword("please don't stop these")).toBe(false);
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   🔴 The purchase flow: searched, bought, shown, released — and no
   entitlement written anywhere in it.                                        */
describe('4 — a number can be searched, bought, shown and released', () => {
  it('every one of the four verbs has a route method behind it', () => {
    const src = read('app/api/sms/numbers/route.ts');
    expect(src, 'no search').toContain('zernioSearchNumbers');
    expect(src, 'no purchase').toContain('zernioPurchaseNumber');
    expect(src, 'no read-back').toContain('zernioGetNumber');
    expect(src, 'no release').toContain('zernioReleaseNumber');
    expect(src).toMatch(/export async function GET\(/);
    expect(src).toMatch(/export async function POST\(/);
    expect(src).toMatch(/export async function DELETE\(/);
  });

  it('the panel offers all four, and warns before the irreversible one', () => {
    const src = read('components/settings/SmsSection.tsx');
    expect(src).toContain('Check availability');
    expect(src).toContain('Buy a number');
    expect(src).toContain('Release this number');
    // Status and monthly cost are SHOWN, and an unknown cost renders as a dash
    // rather than an invented figure — a wrong price on a billing screen is a
    // false claim.
    expect(src).toContain('statusLabel');
    expect(src).toContain('monthlyCostUsd');
    expect(src).toContain("'—'");
    // 🔴 Two taps to release, with the warning between them.
    expect(src).toContain('confirmRelease');
    expect(src).toContain('RELEASE_WARNING');
  });

  it('🔴 the purchase never applies entitlement optimistically — the UI re-reads', () => {
    const src = codeOf(read('components/settings/SmsSection.tsx'));
    // No client-side entitlement write of any shape (#434 / THE-259).
    expect(src, 'the panel writes a plan').not.toMatch(/\bplan\s*:/);
    expect(src, 'the panel writes an add-on count').not.toMatch(/addons\s*:/);
    expect(src, 'the panel writes to Firestore directly').not.toMatch(/setDoc|updateDoc|writeBatch/);
    // Both mutations end by re-reading the server's record rather than setting
    // state from their own response.
    expect(src).toMatch(/setBusy\(''\);[\s\S]{0,200}?await reload\(\);/);
    // Both mutations — buy and release — end in one.
    expect(src.match(/await reload\(\);/g)?.length, 'a mutation skipped the re-read')
      .toBeGreaterThanOrEqual(2);
    expect(src, 'the panel set the number from its own purchase response')
      .not.toMatch(/setNumber\((?!null)(?!r\.ok)/);
  });

  it('🔴 the number and the inbound index are written SERVER-SIDE only', () => {
    // A client that could name its own from-number could point another
    // ministry's inbound traffic — and its Text-to-Give replies — at itself.
    const route = read('app/api/sms/numbers/route.ts');
    expect(route).toContain("adminDb.collection('smsNumbers')");
    expect(read('app/api/sms/config/route.ts'), 'the config route can still write a number')
      .not.toContain('smsNumbers');
    expect(read('app/api/sms/config/route.ts'), 'the config route can still write a from-number')
      .not.toMatch(/fromNumber\s*=/);
  });

  it('🔴 the purchase is idempotent on a key the SERVER derives', () => {
    // A client-chosen key could be varied on every retry, and each variation
    // buys another number and starts another monthly charge on Harvest's card.
    const route = read('app/api/sms/numbers/route.ts');
    expect(route).toMatch(/purchaseIntentId = `harvest-\$\{tenantId\}`/);
    expect(route, 'the idempotency key came from the request body')
      .not.toMatch(/body\.purchaseIntentId/);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   Touch targets. ≥44px below sm; Rule 4 holds above.                          */
describe('5 — every control is ≥44px below sm, and Rule 4 holds above', () => {
  it('the number panel floors its controls and then hands over to Rule 4', async () => {
    const src = codeOf(read('components/settings/SmsSection.tsx'));
    // Below `sm`, the floor. These buttons place and cancel a recurring charge.
    expect(src, 'a control lost its 44px floor').toContain('min-h-[44px]');
    const controls = src.match(/min-h-\[44px\]/g) ?? [];
    expect(controls.length, 'not every control carries the floor').toBeGreaterThanOrEqual(2);
    // From `sm:` up, the module's own tokens rather than a re-spelled size.
    expect(src).toContain('CONTROL_DENSITY.control');
    expect(src).toContain('CONTROL_DENSITY.action');
    expect(src, 'the panel invented a width').toMatch(/FIELD_WIDTH\./);
    // 🔴 No invented size of its own.
    const arbitrary = (src.match(/sm:(?:h|max-w|py|px)-\[[^\]]+\]/g) ?? []);
    expect(arbitrary, `the panel spells its own sm: size: ${arbitrary.join(', ')}`).toEqual([]);
  });

  it('Rule 4 still deliberately sits BELOW the touch floor above sm', async () => {
    // Not a contradiction: the floor is a TOUCH target rule and applies to the
    // phone; 38px is the settled desktop density and a mouse does not need 44.
    const { DENSITY_PX } = await import('@/components/layout/form-layout');
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(DENSITY_PX.action).toBeLessThan(44);
  });

  it('no colour is hardcoded, and no emoji was added', () => {
    const src = codeOf(read('components/settings/SmsSection.tsx'));
    expect(src, 'a hex colour was hardcoded').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src, 'an rgb() colour was hardcoded').not.toMatch(/rgba?\(/);
    expect(src, 'an emoji was added').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────
   🔴 Nothing else moved.                                                      */
describe('6 — no price, no other switch and no pinned file changed', () => {
  it('🔴 STRIPE_CONNECT_ENABLED and CUSTOM_DOMAIN_ENABLED are still false', () => {
    expect(read('lib/stripe-connect-feature.ts')).toMatch(/STRIPE_CONNECT_ENABLED\s*=\s*false/);
    expect(read('lib/custom-domain-feature.ts')).toMatch(/CUSTOM_DOMAIN_ENABLED\s*=\s*false/);
  });

  it('🔴 no price changed — all nine, transcribed independently', async () => {
    // Written out here rather than read off PLAN_PRICING: a test that reads its
    // own subject asserts only that the subject equals itself. These are the
    // same nine the marketing site transcribes, and the cross-repo contract
    // throws at module scope during its prerender if the two ever disagree.
    const { PLAN_PRICING } = await import('@/utils/plan-features');
    expect(PLAN_PRICING).toMatchObject({
      plus: { monthly: 20, quarterly: 54, yearly: 190 },
      pro: { monthly: 40, quarterly: 108, yearly: 380 },
      max: { monthly: 80, quarterly: 216, yearly: 760 },
    });
  });

  it('🔴 firestore.rules is byte-identical', () => {
    // ⚠️ IT AUTO-DEPLOYS TO PRODUCTION AND CI RUNS NO EMULATOR TESTS, so a
    // change here ships unverified. THE-314 needs none: every collection it
    // adds — `tenants/{t}/integrations/sms`, `tenants/{t}/smsOptOuts` and the
    // top-level `smsNumbers` index — is written only by the Admin SDK, which
    // bypasses rules, and read by no client. Each therefore inherits the
    // default DENY, which is the posture `integrations/*` already has and the
    // reason the SMS config has always gone through an API route.
    //
    // Pinned as a LITERAL rather than shelled out to git at assertion time: a
    // baseline the guard fetches for itself describes whatever it was handed.
    expect(sha(readFileSync(path.join(ROOT, 'firestore.rules'))))
      // ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
      // inside `match /tenants/{tenantId}` beside `events`: `allow read: if
      // belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
      // tenantId)`. Purely additive — no existing rule's text moved and it names no new
      // helper, so every other claim this pin carries is unchanged.
      // Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
      .toBe('4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075');
  });

  it('🔴 functions/ is byte-identical, every file of it', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry === '.git') continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(path.join(ROOT, 'functions'));
    expect(files.length, 'a file was added to or removed from functions/').toBe(5);
    const combined = createHash('sha256');
    for (const f of files) {
      combined.update(path.relative(ROOT, f));
      combined.update(createHash('sha256').update(readFileSync(f)).digest());
    }
    expect(combined.digest('hex'))
      .toBe('3f5f5cf97fb48e0eaef69b9b604161441b51bcc4b0ca85f493ee671284450833');
  });

  it('🔴 the send funnel meters into the ESTABLISHED usage document', () => {
    // `tenants/{tenantId}/usage/{YYYY-MM}` is the pattern the RAG counter
    // already uses — one usage subcollection, one rules block, one TTL policy,
    // no reset job. THE-314 must not weaken it or start a second mechanism.
    const usage = read('lib/sms-usage.ts');
    expect(usage).toContain(".collection('usage').doc(month)");
    expect(usage).toContain('smsSegments');
    expect(read('lib/sms-send.ts'), 'the funnel stopped using the shared meter')
      .toMatch(/from '\.\/sms-usage'/);
  });
});
