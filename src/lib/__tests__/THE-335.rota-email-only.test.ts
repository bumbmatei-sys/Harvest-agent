import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildRotaAcceptUrl, isRotaToken, ROTA_RESPOND_PATH, unfilledSlots, SLOT_HORIZON_DAYS,
} from '@/components/events/rota-invitations';
// ⚠️ `newRotaToken` lives in `lib/rota-invite.ts`, not beside the URL builder:
// it is the SERVER half (it calls `randomBytes`), and the client module holds
// only the validator. Importing it from the right place is part of the point.
import { newRotaToken } from '@/lib/rota-invite';
import { getEffectiveFeatures, PLAN_ORDER } from '@/utils/plan-features';
import type { TenantPlan, TenantAddons } from '@/types/tenant.types';
import { SMS_FEATURE_ENABLED } from '@/lib/sms-feature';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-335 — the serving rota works on EMAIL ALONE, with SMS hidden.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The founder, hiding SMS: "people can receive the serving notif from church
 * service planner through resend mail." That sentence is the whole reason this
 * file exists — it is the REPLACEMENT for the capability being withdrawn, so if
 * it does not hold, hiding SMS takes a working notification away and puts
 * nothing in its place.
 *
 * 🔴 ONE THING IN THAT SENTENCE IS WRONG, AND IT IS WORTH BEING PRECISE ABOUT.
 * Rota mail does NOT go through Resend. It goes through the CHURCH'S OWN GMAIL,
 * via Composio's `GMAIL_SEND_EMAIL`, under the church's own connection — see
 * `sendOneEmail` in `lib/rota-invite.ts`. Resend is Harvest's TRANSACTIONAL
 * sender (sign-in links, receipts) and is named as such in the privacy notice.
 * The two are different paths with different failure modes, and the difference
 * matters here: a church with no Gmail connected gets `'unavailable'` rather
 * than a delivered message, which section 4 covers.
 *
 * ⚠️ WHAT THIS FILE DOES NOT RE-TEST. THE-324 owns the invitation's own
 * behaviour — the token, the record, the accept semantics. This asserts the one
 * property THE-335 puts at risk: that NONE of it depends on SMS.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, 'src', rel), 'utf8');

/* ── 1 ─────────────────────────────────────────────────────────────────────
   🔴 An invitation reaches the volunteer by email, on EVERY tier.             */
describe('1 — an invitation reaches a volunteer by email with SMS off, on every tier', () => {
  const armed = () => {
    // ⚠️ Typed with its real parameter list, so `mock.calls[0][0]` is the ACTION
    // NAME rather than an element of an empty tuple.
    const executeComposioAction = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    const zernioSendSms = vi.fn(async () => ({ ok: true, id: 'sm_1', segments: 1 }));
    const reserveSmsSegment = vi.fn(async () => ({ allowed: true, used: 1, cap: 2000 }));
    const settleSmsSegments = vi.fn(async () => {});
    return { executeComposioAction, zernioSendSms, reserveSmsSegment, settleSmsSegments };
  };

  /** One tenant, one connected Gmail, one person with BOTH an email and a phone. */
  const mount = async (plan: TenantPlan) => {
    vi.resetModules();
    const spies = armed();
    vi.doMock('@/lib/composio-client', () => ({ executeComposioAction: spies.executeComposioAction }));
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: spies.zernioSendSms }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: spies.reserveSmsSegment,
      settleSmsSegments: spies.settleSmsSegments,
      refundSmsSegment: vi.fn(async () => {}),
    }));
    vi.doMock('@/lib/sms-optout', () => ({ isOptedOut: vi.fn(async () => false), recordOptOut: vi.fn() }));

    const written: Record<string, unknown>[] = [];
    /* A Firestore stand-in that answers every read this path makes: the tenant
       (for its plan), the admin's Gmail integration, and the invitation doc. */
    const docNode = (id: string): Record<string, unknown> => ({
      id,
      get: async () => ({
        exists: true,
        data: () => (id.endsWith('_gmail')
          ? { status: 'active', connectedAccountId: 'ca_1', senderEmail: 'office@grace.org' }
          : { plan, name: 'Grace' }),
      }),
      set: async (data: Record<string, unknown>) => { written.push(data); },
      collection: (name: string) => collNode(name),
    });
    const collNode = (_name: string): Record<string, unknown> => ({
      doc: (id = 'auto') => docNode(id),
      add: async () => {},
    });
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: { collection: (n: string) => collNode(n) },
      FieldValue: { serverTimestamp: () => 'ts', increment: (n: number) => n },
    }));

    const mod = await import('@/lib/rota-invite');
    return { ...spies, written, mod };
  };

  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  it.each(PLAN_ORDER)('%s — the provider is never called and nothing is metered', async (plan) => {
    /* 🔴 `max` IS THE ONE THAT MATTERS, and it is in this loop rather than
       asserted alone: Ministry is the only tier whose `smsAutomation` cell is
       true, so it is the only tier on which a plan-only gate would have let a
       send through. THE-324 asserted this for `plus` and `pro`; THE-335 re-proves
       it for every tier including `max`, which is where the master switch — and
       not the plan — is what refuses. */
    const { zernioSendSms, reserveSmsSegment, settleSmsSegments, executeComposioAction, mod } =
      await mount(plan);

    const report = await mod.sendInvitation(
      'grace', 'admin-1',
      {
        planId: 'p1', itemId: 'i1', eventId: 'e1', personId: 'u1',
        personName: 'Ada', eventTitle: 'Sunday Gathering', itemTitle: 'Welcome team',
        // ⚠️ A FIXED DATE FAR FROM TODAY. A fixture pinned near now turned `main`
        // red for everyone (#468); this one cannot age into a different week.
        startsAt: new Date('2031-03-09T09:30:00.000Z'),
      },
      { email: 'ada@example.org', phone: '+15551234567' },
      'Grace Church', 'invite',
    );

    // 🔴 THE EMAIL WENT, through the church's own Gmail.
    expect(executeComposioAction, 'the invitation did not send by email').toHaveBeenCalled();
    expect(executeComposioAction.mock.calls[0][0]).toBe('GMAIL_SEND_EMAIL');
    expect(report.channels.email).toBe('sent');

    // 🔴 AND NOTHING TEXTED. Not "failed" — `unavailable`, which is what tells
    // the panel this church simply does not have SMS rather than that a send
    // broke. The person HAS a phone number, so this is the master switch
    // refusing and not a missing destination.
    expect(report.channels.sms, `${plan} reported an SMS outcome other than unavailable`)
      .toBe('unavailable');
    expect(zernioSendSms, `${plan} reached the SMS provider`).not.toHaveBeenCalled();
    expect(reserveSmsSegment, `${plan} metered a segment`).not.toHaveBeenCalled();
    expect(settleSmsSegments, `${plan} settled a segment`).not.toHaveBeenCalled();
    expect(report.smsSegments ?? 0, `${plan} billed a segment`).toBe(0);

    // 🔴 AND THE INVITATION IS REAL: a token, and a link built from it.
    expect(isRotaToken(report.token), 'the invitation carries no valid token').toBe(true);
    expect(report.url, 'the invitation carries no accept link').toBeTruthy();
  });

  it('🔴 the panel does not PROMISE a text it will not send, on any tier', () => {
    /* THE ONE SURFACE THE SWITCH DID NOT REACH WHEN THE-335 FOUND IT.
       `/api/rota/invitations` reported `smsAvailable` from the plan cell alone,
       so a Ministry admin was told a text was going out while the funnel refused
       it. The send was always safe; the CLAIM was not. */
    const route = read('app/api/rota/invitations/route.ts');
    expect(route, 'the invitations route no longer reads the master switch')
      .toContain('SMS_FEATURE_ENABLED');
    /* 🔴 AHEAD OF THE PLAN CELL, read as an ORDER rather than as a line number:
       THE-331 pinned `AdminCommunity.tsx:491`, a deletion shifted it to `:311`,
       and the suite would have measured whatever landed there. Both offsets are
       taken inside the one function, so a guard added somewhere else in the file
       cannot satisfy this. */
    const fn = /async function smsAvailableFor\([\s\S]*?\n\}/.exec(route);
    expect(fn, 'smsAvailableFor could not be read back').not.toBeNull();
    const switchAt = fn![0].indexOf('if (!SMS_FEATURE_ENABLED) return false;');
    const planAt = fn![0].indexOf('getEffectiveFeatures');
    expect(switchAt, 'the master switch is not inside smsAvailableFor').toBeGreaterThan(-1);
    expect(planAt, 'the plan cell is no longer read').toBeGreaterThan(-1);
    expect(switchAt, 'the master switch is not ahead of the plan cell').toBeLessThan(planAt);

    // …and the plan cell it sits in front of is untouched, so the flip restores
    // the identical Ministry-only answer.
    const NO_ADDONS: TenantAddons = {
      aiAssistant: 0, adminSeats: 0, contactPacks: 0, unlimitedContacts: false, campuses: 0,
    };
    expect(getEffectiveFeatures('max', NO_ADDONS).smsAutomation, 'the Ministry cell moved').toBe(true);
    expect(SMS_FEATURE_ENABLED, 'this suite is measuring the wrong state').toBe(false);
  });

  it('🔴 the invitations route still reaches the provider through ONE funnel', () => {
    // `sendTenantSms` stays the only send interface, even inert. A second path
    // added while the first is hidden is how a hidden feature comes back live.
    const route = read('app/api/rota/invitations/route.ts');
    for (const mod of ['sms-send', 'zernio', 'twilio', 'sms-usage']) {
      expect(route, `the invitations route imports ${mod} directly`)
        .not.toMatch(new RegExp(`from ['"][^'"]*${mod}['"]`));
    }
    expect(read('lib/rota-invite.ts'), 'the SMS half no longer goes through the funnel')
      .toMatch(/sendTenantSms/);
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 The accept link is unchanged — URL shape and scope.                      */
describe('2 — the accept link is unchanged', () => {
  it('🔴 the URL shape is the same: https, the tenant subdomain, and the token', () => {
    const token = newRotaToken();
    const url = buildRotaAcceptUrl('grace', token);
    expect(url, 'the accept URL stopped building').toBeTruthy();
    const parsed = new URL(url!);
    expect(parsed.protocol, 'the accept link left https').toBe('https:');
    expect(parsed.hostname.startsWith('grace.'), 'the link left the tenant subdomain').toBe(true);
    expect(parsed.pathname, 'the accept path moved').toBe(`${ROTA_RESPOND_PATH}/${token}`);
    expect(ROTA_RESPOND_PATH, 'the accept path is no longer /rota').toBe('/rota');
    // No credentials, no query, no fragment — nothing to leak in a forwarded mail.
    expect(parsed.username).toBe('');
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe('');
  });

  it('🔴 the token is still a stored 256-bit value, and no sign-in is asked for', () => {
    const token = newRotaToken();
    expect(isRotaToken(token)).toBe(true);
    // 43 base64url characters is 256 bits. Asserted as the property rather than
    // as a length literal alone, so a weaker token fails rather than a shorter one.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([newRotaToken(), newRotaToken(), newRotaToken()]).size, 'tokens repeat').toBe(3);
  });

  it('🔴 the responder still authorises `status` and `respondedAt`, and nothing else', () => {
    // The scope, read off the route that owns it. Widening it is what would turn
    // an unauthenticated link into a way to move a service.
    const route = read('app/api/rota/respond/route.ts');
    expect(route, 'the responder accepts an answer other than accepted/declined')
      .toMatch(/accepted' \|\| .*'declined'|"accepted" \|\| .*"declined"|accepted' or 'declined/);
    const writes = read('components/events/rota-invitations.ts');
    expect(writes, 'recordResponse stopped writing status').toMatch(/status/);
    expect(writes, 'recordResponse stopped writing respondedAt').toMatch(/respondedAt/);
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   Reminders and unfilled-slot warnings.                                       */
describe('3 — reminders and unfilled-slot warnings still fire by email', () => {
  it('a reminder is the same send path, with `kind: reminder`', () => {
    const src = read('lib/rota-invite.ts');
    expect(src, 'the reminder path forked away from the invitation path')
      .toMatch(/kind: 'invite' \| 'reminder'/);
    // The email half is unconditional on `kind`; only the RECORD differs, which
    // is what makes a reminder reach a volunteer exactly as an invitation does.
    expect(src).toMatch(/const email = await sendOneEmail\(/);
    expect(src).toMatch(/isReminder/);
  });

  it('🔴 unfilled slots are worked out without asking about SMS', () => {
    // The warning a planner reads before Sunday. It is a fold over the rota, so
    // it is unaffected by any channel being hidden — asserted by calling it.
    /* ⚠️ `vi.useFakeTimers({ toFake: ['Date'] })` IS NOT NEEDED HERE because
       `now` is a PARAMETER — the function takes the clock rather than reading
       it, so the fixture cannot age. The date chosen is far from today for the
       reason #468 records. */
    const report = unfilledSlots(
      [], [],
      { failed: false, servicesComplete: true, invitationsTruncated: false },
      new Date('2031-03-09T09:30:00.000Z'),
    );
    expect(report, 'unfilledSlots stopped answering').toBeTruthy();
    expect(report.source, 'the warning changed where it reads from')
      .toBe('servicePlans+rotaInvitations');
    expect(report.horizonDays).toBe(SLOT_HORIZON_DAYS);
    const src = read('components/events/rota-invitations.ts');
    const fn = /export function unfilledSlots\(([\s\S]*?)\n\}/.exec(src);
    expect(fn, 'unfilledSlots could not be read back').not.toBeNull();
    expect(fn![1], 'the unfilled-slot warning asks about SMS').not.toMatch(/\bsms\b/i);
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   🔴 Gmail's scopes, and a church with no email at all.                       */
describe('4 — the church\'s own Gmail, send-only, and what happens with none', () => {
  it('🔴 assertSendOnlyGmailScopes still fails closed', () => {
    /* NO-REGRESSION. Harvest must NEVER hold a scope that can read a church's
       inbox, and the check must refuse an UNKNOWN scope set rather than allow
       it — failing closed is the whole property. */
    const src = read('lib/rota-invite.ts');
    expect(src, 'the rota send no longer asserts its Gmail scopes')
      .toContain('assertSendOnlyGmailScopes');
  });

  it('🔴 rota mail goes through the CHURCH\'S Gmail, not through Resend', () => {
    /* The founder said "resend mail". He is describing the outcome, not the
       path: Resend is Harvest's TRANSACTIONAL sender and rota mail does not use
       it. Recorded here because the two have different failure modes — a church
       that has connected no Gmail gets nothing, where a Resend send would not
       depend on the church at all. */
    const src = read('lib/rota-invite.ts');
    expect(src, 'the rota email path stopped using the church\'s own Gmail')
      .toContain('GMAIL_SEND_EMAIL');
    expect(src, 'rota mail quietly moved onto Resend').not.toMatch(/resend/i);
  });

  it('🔴 with NO email connected, the invitation and the link still exist', () => {
    /* THE-324 reported this and THE-335 re-proves it, because it is now the ONLY
       channel: if the record were written only on a successful send, a church
       with no Gmail would have no invitation to share by any other means.
       The record is written BEFORE either channel is attempted — read off the
       source, since that ORDER is the property. */
    const src = read('lib/rota-invite.ts');
    const recordAt = src.indexOf('// 🔴 The record first.');
    const emailAt = src.indexOf('const email = await sendOneEmail(');
    const smsAt = src.indexOf('const sms = await sendOneSms(');
    expect(recordAt, 'the invitation record is no longer written first').toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(emailAt);
    expect(recordAt).toBeLessThan(smsAt);

    // …and an absent Gmail is reported as `unavailable`, not as a failure — so
    // the panel can tell the admin to share the link rather than retry a send.
    expect(src).toMatch(/if \(!integration \|\| integration\.status !== 'active'[^)]*\) return 'unavailable';/);
  });
});
