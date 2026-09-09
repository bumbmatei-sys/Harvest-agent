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
 * 🔴 THAT SENTENCE WAS RIGHT, AND THIS SUITE USED TO SAY IT WAS WRONG.
 *
 * ⚠️ WHAT THIS FILE ASSERTED BEFORE THE-340, VERBATIM: "Rota mail does NOT go
 * through Resend. It goes through the CHURCH'S OWN GMAIL." It recorded that as
 * a correction to the founder — he was "describing the outcome, not the path" —
 * and then PINNED it, with a test named "rota mail goes through the CHURCH'S
 * Gmail, not through Resend" that asserted `GMAIL_SEND_EMAIL` was present and
 * `/resend/i` was absent.
 *
 * 🔴 IT WAS NOT A CORRECTION. IT WAS THE DEFECT, WRITTEN DOWN AND GUARDED.
 * THE-335 hid SMS in the same breath, which left the church's Gmail as the ONLY
 * channel a volunteer could be reached on — and connecting it means clicking
 * past Google's "this app isn't verified" interstitial, because the OAuth app
 * is unverified and capped at 100 users. So a church that had connected nothing
 * could not notify one volunteer, and the remedy Harvest offered was a security
 * warning. The guard's own words — "a Resend send would not depend on the
 * church at all" — are the argument FOR the change it was preventing.
 *
 * 🔴 THE-340 MOVES ROTA MAIL ONTO RESEND, from a Harvest-controlled sender on a
 * verified domain, and this suite now asserts that. Section 4 is inverted
 * accordingly; the Gmail SCOPE guard it also held was rewritten rather than
 * deleted, because it was measuring a comment (see the note there).
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
    // ⚠️ THE-340: the stub is the `resend` PACKAGE, not Harvest's own funnel, so
    // `transactional-email.ts` is REAL in every case below. `mock.calls[0][0]`
    // is therefore the send PAYLOAD — from, to, subject, text.
    const resendSend = vi.fn(async (..._args: unknown[]) => ({ data: { id: 're_1' }, error: null }));
    const zernioSendSms = vi.fn(async () => ({ ok: true, id: 'sm_1', segments: 1 }));
    const reserveSmsSegment = vi.fn(async () => ({ allowed: true, used: 1, cap: 2000 }));
    const settleSmsSegments = vi.fn(async () => {});
    return { resendSend, zernioSendSms, reserveSmsSegment, settleSmsSegments };
  };

  /**
   * One tenant, one person with BOTH an email and a phone.
   *
   * 🔴 NO GMAIL CONNECTION IS MOUNTED, and that is THE-340's whole point: the
   * send below has nothing from the church to depend on.
   */
  const mount = async (plan: TenantPlan) => {
    vi.resetModules();
    process.env.RESEND_API_KEY = 're-test-key';
    const spies = armed();
    vi.doMock('resend', () => ({ Resend: class { emails = { send: spies.resendSend }; } }));
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: spies.zernioSendSms }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: spies.reserveSmsSegment,
      settleSmsSegments: spies.settleSmsSegments,
      refundSmsSegment: vi.fn(async () => {}),
    }));
    vi.doMock('@/lib/sms-optout', () => ({ isOptedOut: vi.fn(async () => false), recordOptOut: vi.fn() }));

    const written: Record<string, unknown>[] = [];
    /* A Firestore stand-in that answers every read this path makes: the tenant
       (for its plan) and the invitation doc.
       🔴 THE GMAIL BRANCH IS GONE, not stubbed to absent — nothing reads it. */
    const docNode = (id: string): Record<string, unknown> => ({
      id,
      get: async () => ({
        exists: true,
        data: () => ({ plan, name: 'Grace' }),
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
    const { zernioSendSms, reserveSmsSegment, settleSmsSegments, resendSend, mod } =
      await mount(plan);

    const report = await mod.sendInvitation(
      'grace',
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

    // 🔴 THE EMAIL WENT, THROUGH RESEND, WITH NOTHING CONNECTED (THE-340).
    expect(resendSend, `${plan}: the invitation did not send by email`).toHaveBeenCalled();
    expect(report.channels.email).toBe('sent');

    // 🔴 FROM A HARVEST-CONTROLLED SENDER on the verified domain — the property
    // that makes this independent of the church. The church's NAME rides in the
    // display name, so the volunteer still reads who it is from; the ADDRESS is
    // one Harvest can sign for.
    const sent = resendSend.mock.calls[0][0] as { from: string; to: string; text: string };
    expect(sent.from, `${plan}: the sender left the verified Harvest domain`)
      .toMatch(/<noreply@theharvest\.app>$/);
    expect(sent.from, `${plan}: the church's name is not in the sender`).toContain('Grace Church');
    expect(sent.to).toBe('ada@example.org');
    expect(sent.text, `${plan}: the email carries no accept link`).toContain(report.url as string);

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
       THE-331 pinned a component at a numbered offset, a deletion elsewhere
       shifted the thing it named further up the file, and the suite would have
       measured whatever landed at that offset. Both offsets here are taken
       inside the one function, so a guard added somewhere else in the file
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
   🔴 Resend carries the mail; Gmail's scope guard is untouched.               */
describe('4 — Resend carries rota mail, and the Gmail scope guard is untouched', () => {
  it('🔴 assertSendOnlyGmailScopes still fails closed', async () => {
    /* ═══════════════════════════════════════════════════════════════════════
       🔴 THIS GUARD WAS NOT GUARDING, AND THE-340 IS WHY THAT SURFACED.

       ⚠️ WHAT IT USED TO BE, IN FULL:

           const src = read('lib/rota-invite.ts');
           expect(src).toContain('assertSendOnlyGmailScopes');

       `rota-invite.ts` NEVER CALLED `assertSendOnlyGmailScopes`. It never
       imported it. The only occurrence of that string in the file was inside a
       PROSE COMMENT — "`assertSendOnlyGmailScopes` fails closed on the CONNECT
       route and is not touched, called or weakened by this file" — so the guard
       was satisfied by a sentence SAYING the check existed, and would have gone
       on passing with the real function deleted from the repo entirely. It is
       the failure mode the series has hit repeatedly: a grep answered by the
       word rather than by the behaviour.

       🔴 SO IT IS REPLACED BY THE BEHAVIOUR. The function is CALLED, with the
       scope sets that must be refused, and it must throw on each. That is what
       "fails closed" means, and none of it can be satisfied by prose.
       ═══════════════════════════════════════════════════════════════════════ */
    const { assertSendOnlyGmailScopes, GmailScopeError, GMAIL_SEND_SCOPE } =
      await import('@/lib/gmail-scopes');

    const base = { toolkitSlug: 'gmail', isComposioManaged: true };

    // 🔴 NO DECLARED SCOPES → Composio would request its defaults, which READ
    // MAIL. Refusing the empty set is the fail-closed property itself.
    expect(() => assertSendOnlyGmailScopes({ ...base, scopes: null }),
      'an auth config with no scopes was allowed').toThrow(GmailScopeError);
    expect(() => assertSendOnlyGmailScopes({ ...base, scopes: [] }),
      'an auth config with an empty scope list was allowed').toThrow(GmailScopeError);

    // 🔴 ANY READ SCOPE → refused. These are the ones that would let Harvest
    // read a church's inbox.
    for (const scope of [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://mail.google.com/',
    ]) {
      expect(
        () => assertSendOnlyGmailScopes({ ...base, scopes: [GMAIL_SEND_SCOPE, scope] }),
        `Harvest may hold ${scope}, which can read a church mailbox`,
      ).toThrow(GmailScopeError);
    }

    // And the send scope alone is still ACCEPTED — a guard that refused
    // everything would pass the tests above while breaking the CRM.
    expect(assertSendOnlyGmailScopes({ ...base, scopes: [GMAIL_SEND_SCOPE] }))
      .toContain(GMAIL_SEND_SCOPE);
  });

  it('🔴 the connect route is still the caller, and rota is still not', () => {
    /* The guard binds where a connection is MADE, which is the only place it
       can bind. THE-340 removed a CONSUMER of Gmail connections; that must not
       change what may be asked for when one is created. */
    const connect = read('app/api/composio/gmail/connect/route.ts');
    expect(connect, 'the connect route stopped asserting its scopes')
      .toContain('assertSendOnlyGmailScopes(');
  });

  it('🔴 rota mail goes through RESEND, not through the church\'s Gmail', () => {
    /* ⚠️ THIS TEST IS THE PREVIOUS ONE'S EXACT INVERSE, and the inversion is the
       ticket. It used to read:

           expect(src).toContain('GMAIL_SEND_EMAIL');
           expect(src, 'rota mail quietly moved onto Resend').not.toMatch(/resend/i);

       The founder asked for Resend; the suite pinned Gmail and called the
       founder imprecise. With SMS hidden that pin was the difference between a
       church being able to notify its volunteers and not. */
    const src = read('lib/rota-invite.ts');
    expect(src, 'rota mail is back on the church\'s own Gmail')
      .not.toContain('GMAIL_SEND_EMAIL');
    expect(src, 'the rota email half no longer goes through the Resend funnel')
      .toContain('sendTransactionalEmail');

    // 🔴 AND IT SENDS FROM A DOMAIN HARVEST HAS VERIFIED. `theharvest.app` is
    // verified in Resend with sending enabled, which is what makes this need
    // nothing from the church — no OAuth, no consent screen, no warning.
    const funnel = read('lib/transactional-email.ts');
    expect(funnel, 'the sender left the verified domain')
      .toContain("'noreply@theharvest.app'");
  });

  it('🔴 a FAILED send is reported as a failure, not as "no invitation"', () => {
    /* ⚠️ THE SILENT-FAILURE RULE, read off the two places it is decided. An
       absent ADDRESS is `unavailable` — a fact about the church's records that
       no admin can fix by pressing send again. Everything else is `failed`. */
    const src = read('lib/rota-invite.ts');
    const fn = /async function sendOneEmail\(([\s\S]*?)\n\}/.exec(src);
    expect(fn, 'sendOneEmail could not be read back').not.toBeNull();
    // The ONLY `unavailable` in the email half is the missing-address branch.
    expect((fn![1].match(/'unavailable'/g) ?? []).length,
      'the email half has grown a second way to report a send as unavailable').toBe(1);
    expect(fn![1], 'a missing address is no longer reported as unavailable')
      .toMatch(/if \(!to \|\| !to\.trim\(\)\) return 'unavailable';/);
    expect(fn![1], 'a failed Resend send no longer reports as failed')
      .toContain("return 'failed';");

    // 🔴 AND AN UNSET API KEY IS A FAILURE, NOT A SILENT SKIP. The other nine
    // Resend call sites in this repo treat a missing key as "do nothing"; for
    // the only channel a volunteer has, that is the quiet lie exactly.
    const funnel = read('lib/transactional-email.ts');
    expect(funnel, 'a missing RESEND_API_KEY is no longer reported')
      .toContain("code: 'not_configured'");
  });

  it('🔴 with NO email address for the person, the invitation and the link still exist', () => {
    /* THE-324 reported this and it still holds: the record is written BEFORE
       either channel is attempted, so a person with no address on file still
       has an invitation the admin can share by hand. Read off the source,
       since that ORDER is the property. */
    const src = read('lib/rota-invite.ts');
    const recordAt = src.indexOf('// 🔴 The record first.');
    const emailAt = src.indexOf('const email = await sendOneEmail(');
    const smsAt = src.indexOf('const sms = await sendOneSms(');
    expect(recordAt, 'the invitation record is no longer written first').toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(emailAt);
    expect(recordAt).toBeLessThan(smsAt);
  });
});
