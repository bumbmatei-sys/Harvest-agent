import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import RotaInviteView from '../RotaInviteView';
import RotaRespondView, { type RespondRow } from '../RotaRespondView';
import { HARVEST_APEX } from '../../donations/giving-share';
import type { ServicePlanItem } from '../service-plan';
import type { RotaService } from '../volunteer-rota';
import {
  MAX_REMINDERS,
  REMINDER_WINDOW_DAYS,
  ROTA_RESPOND_PATH,
  SLOT_HORIZON_DAYS,
  TOKEN_RE,
  buildRotaAcceptUrl,
  countByProblem,
  invitationId,
  invitationMessage,
  isRotaToken,
  myAssignments,
  reminderDue,
  servicesCompleteForHorizon,
  slotVerdict,
  smsSegmentsFor,
  unfilledSlots,
  type RotaInvitation,
  type SlotReadState,
} from '../rota-invitations';

/**
 * THE-324 — invite, accept, remind. What it actually does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 THE SECTIONS THAT ARE THE TICKET, AND WHERE A PLAUSIBLE WRONG ANSWER IS
 *    WORSE THAN NO ANSWER:
 *
 *   7  THE ACCEPT LINK'S HOST — THE-303's six rules, re-asked. "A wrong host is
 *      a member's money" there; here it is a member's slot and their name.
 *   8  IT LANDS POST-HOP, OR CARRIES ITS OWN TOKEN — it does BOTH, and both are
 *      asserted, because either alone would let the other rot.
 *   9  UNFILLED SLOTS ARE EXACT OR PROVABLY COMPLETE, ELSE `empty` — never a
 *      false "none". A church looking at "every slot is filled" when in fact the
 *      read failed closes the screen; that is the `Form submissions 0` bug and
 *      it is worse than showing nothing because it is indistinguishable from an
 *      answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ MUTATION-VERIFIED WHILE THIS FILE WAS WRITTEN. Each defect was planted, the
 * suite run, then reverted:
 *
 *   · `unfilledSlots` returning its warnings regardless of the verdict
 *     → section 9 fails ("a failed read must not read as none").
 *   · `buildRotaAcceptUrl` dropping the single-label check
 *     → section 7 fails on the two-label and the credentialled hosts.
 *   · `buildRotaAcceptUrl` accepting `http`
 *     → section 7 fails.
 *   · `reminderDue` losing its `status !== 'invited'` clause
 *     → the reminder section fails on an ACCEPTED invitation, which is the
 *       clause that stops a church paying to be told what it already knows.
 *   · the views rendering a hand-written `<div className="rounded-lg border">`
 *     instead of `Card` → the primitive sections fail.
 *
 * The send path — STOP, metering, the Ministry gate and the SMS-less fallback —
 * is in `src/lib/__tests__/THE-324.rota-send.test.ts`, against the REAL funnel.
 */

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const NOW = new Date(2026, 8, 9, 9, 0, 0); // Wednesday 9 September 2026, 09:00
const SUNDAY = new Date(2026, 8, 13, 10, 0, 0);
/** 43 characters of base64url — exactly what `TOKEN_RE` accepts. */
const TOKEN = 'Zk3Nq7Xb2Wd9Rt5Yu8Ip4Ol1Mc6Hv0Ge3Ja7Sf2Qxyz';

const item = (
  id: string, title: string, minutes: number, order: number, person: [string, string] | null,
): ServicePlanItem => ({
  id, title, minutes, order,
  personId: person ? person[0] : null,
  personName: person ? person[1] : null,
  note: null,
});

const service = (items: ServicePlanItem[], startsAt: Date | null = SUNDAY): RotaService => ({
  eventId: 'e1',
  eventTitle: 'Sunday Morning Gathering',
  startsAt,
  planId: 'p1',
  planName: 'Order of service',
  items,
});

const invitation = (over: Partial<RotaInvitation> = {}): RotaInvitation => ({
  id: invitationId('p1', 'i1'),
  tenantId: 'grace',
  planId: 'p1',
  itemId: 'i1',
  eventId: 'e1',
  personId: 'u-ben',
  personName: 'Benjamin Achterberg',
  eventTitle: 'Sunday Morning Gathering',
  itemTitle: 'Welcome and call to worship',
  startsAt: SUNDAY,
  status: 'invited',
  invitedAt: NOW,
  remindedAt: null,
  respondedAt: null,
  reminderCount: 0,
  channels: { email: 'sent', sms: 'sent' },
  ...over,
});

const GOOD_READ: SlotReadState = {
  failed: false, servicesComplete: true, invitationsTruncated: false,
};

/* ═══ 1 · An assignment produces an invitation, named per channel ══════════ */

describe('1 — an assignment produces an invitation', () => {
  it('the invitation keys on part 1\'s own (planId, itemId), which survives a reorder', () => {
    // 🔴 Part 1 wrote `id` down as stable and independent of position precisely
    // so a later ticket could key on it. This is that ticket doing so.
    expect(invitationId('p1', 'i1')).toBe('p1__i1');
    // 🔴 THE SEPARATOR CANNOT OCCUR INSIDE EITHER HALF, WHICH IS WHAT MAKES THE
    // PAIR UNAMBIGUOUS. Part 1's `genItemId()` is two base-36 slices, so an item
    // id is `[a-z0-9]` only; a Firestore auto-id is `[A-Za-z0-9]`. Neither
    // alphabet contains `_`, so no real pair can produce a colliding string —
    // whereas a SINGLE separator drawn from either alphabet could.
    for (let i = 0; i < 200; i++) {
      const generated =
        Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      expect(generated, `part 1 generated an id containing the separator: ${generated}`)
        .not.toContain('_');
    }
    expect(invitationId('plan1', 'itemA')).toBe('plan1__itemA');
  });

  it('the message names the day, the slot and the time — the ticket\'s own sentence', () => {
    const message = invitationMessage(
      { personName: 'Benjamin Achterberg', eventTitle: 'Sunday Morning', itemTitle: 'Welcome', startsAt: new Date(2026, 8, 13, 10, 0) },
      `https://grace.${HARVEST_APEX}${ROTA_RESPOND_PATH}/${TOKEN}`,
      'Grace Chapel',
    );
    // The ticket's own sentence: "You are on for Sunday 14 September, Welcome,
    // 10:00." ⚠️ PREMISE DRIFT, RECORDED: 14 September 2026 is a MONDAY, so the
    // fixture uses the 13th — the SHAPE is the claim, not the calendar.
    expect(message.smsText).toContain('Sunday 13 September');
    expect(message.smsText).toContain('10:00');
    expect(message.smsText).toContain('Welcome');
    expect(message.emailSubject).toBe('You are on for Sunday 13 September');
    expect(message.emailBody).toContain('Benjamin');
  });

  it('a reminder reads as a reminder, on both channels', () => {
    const message = invitationMessage(
      { personName: 'Ada', eventTitle: 'Sunday', itemTitle: 'Sound desk', startsAt: SUNDAY },
      null, 'Grace Chapel', 'reminder',
    );
    expect(message.smsText.startsWith('Reminder:')).toBe(true);
    expect(message.emailSubject.startsWith('Reminder:')).toBe(true);
  });

  it('🔴 with no valid link, the message says what to do INSTEAD rather than carrying a broken one', () => {
    const message = invitationMessage(
      { personName: 'Ada', eventTitle: 'Sunday', itemTitle: 'Sound desk', startsAt: SUNDAY },
      null, 'Grace Chapel',
    );
    expect(message.smsText).not.toContain('http');
    expect(message.smsText).toContain('Grace Chapel');
    expect(message.emailBody).toContain('reply to this email');
  });

  it('and the SMS body is priced exactly, because a second segment is a second charge', () => {
    expect(smsSegmentsFor('a'.repeat(160))).toBe(1);
    expect(smsSegmentsFor('a'.repeat(161))).toBe(2);
    expect(smsSegmentsFor('a'.repeat(306))).toBe(2);
    expect(smsSegmentsFor('a'.repeat(307))).toBe(3);
    expect(smsSegmentsFor('')).toBe(1);
  });
});

/* ═══ 7 · 🔴 THE ACCEPT LINK'S HOST — THE-303'S SIX RULES, RE-ASKED ════════ */

describe('7 — the accept link is https, a single-label subdomain of theharvest.app, no credentials, no port', () => {
  /**
   * 🔴 A NO-REGRESSION ON THE-303's RULES, NOT A RESTATEMENT OF THEM. THE-281
   * and THE-303 wrote them because "a wrong host is a member's money"; here a
   * wrong host is a member's NAME and their church's service times, handed to
   * whoever owns it. `buildGivingPageUrl` is deliberately NOT reused — it builds
   * `GIVING_PATH` and has no path parameter, and adding one would put a seam
   * into a validator whose whole value is that it has none.
   */
  const token = TOKEN;

  it('the good case is exactly the shape the giving page already emits', () => {
    const url = buildRotaAcceptUrl('grace', token);
    expect(url).toBe(`https://grace.${HARVEST_APEX}${ROTA_RESPOND_PATH}/${token}`);
    const parsed = new URL(url as string);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
    expect(parsed.port).toBe('');
    expect(parsed.hostname.split('.')).toHaveLength(3);
    expect(parsed.hostname.endsWith(`.${HARVEST_APEX}`)).toBe(true);
  });

  it.each([
    ['a foreign host smuggled through the label', 'evil.example/x'],
    ['a second label', 'a.b'],
    ['credentials', 'user:pass@evil.example'],
    ['a port', 'grace:8080'],
    ['a scheme', 'https://evil.example'],
    ['an empty label', ''],
    ['whitespace only', '   '],
    ['a leading dot', '.grace'],
    ['a trailing dot', 'grace.'],
    ['an underscore', 'gra_ce'],
    ['a path traversal', '../../evil'],
    ['a query', 'grace?x=1'],
    ['a fragment', 'grace#x'],
  ])('🔴 %s produces NO url at all, not a wrong one', (_why, tenantId) => {
    expect(buildRotaAcceptUrl(tenantId, token)).toBeNull();
  });

  it('🔴 and a token that is not a token produces no url either', () => {
    for (const bad of [
      '', 'short', 'A'.repeat(42), 'A'.repeat(44), '../../etc/passwd',
      `${token.slice(0, 39)}?x=`, `${token.slice(0, 39)}/..`, null, undefined, 42, {},
    ]) {
      expect(buildRotaAcceptUrl('grace', bad), `${String(bad)} was accepted`).toBeNull();
    }
    expect(isRotaToken(token)).toBe(true);
    expect(TOKEN_RE.source).toContain('43');
  });

  it('a non-string tenant id is refused rather than coerced', () => {
    for (const bad of [null, undefined, 42, {}, ['grace']]) {
      expect(buildRotaAcceptUrl(bad, token)).toBeNull();
    }
  });
});

/* ═══ 8 · 🔴 THE LINK LANDS POST-HOP, AND CARRIES ITS OWN TOKEN ════════════ */

describe('8 — the accept link lands post-hop, and carries its own token', () => {
  /**
   * 🔴 BOTH, NOT EITHER. THE-138: the apex → subdomain hop ENDS the Firebase
   * session, and THE-289 established that anything before it is a step the
   * member never finishes. So the link must land AFTER the hop — which it does,
   * because the builder can only produce `<tenant>.theharvest.app` — AND carry
   * its own token, so there is no session for the hop to have cost.
   *
   * ⚠️ ASSERTING ONLY ONE WOULD LET THE OTHER ROT: a token-bearing link at the
   * apex would still bounce a member to a sign-in on the wrong origin, and a
   * post-hop link with no token would demand a second sign-in from somebody who
   * arrived from a text message.
   */
  const token = TOKEN;

  it('🔴 POST-HOP: the host is the TENANT\'s subdomain, and the apex cannot be produced', () => {
    const url = new URL(buildRotaAcceptUrl('grace', token) as string);
    expect(url.hostname).toBe(`grace.${HARVEST_APEX}`);
    expect(url.hostname).not.toBe(HARVEST_APEX);
    // There is no argument that yields the bare apex: a label is required, and
    // an empty one is refused.
    expect(buildRotaAcceptUrl('', token)).toBeNull();
  });

  it('🔴 AND IT CARRIES ITS OWN TOKEN: the last path segment IS the capability', () => {
    const url = new URL(buildRotaAcceptUrl('grace', token) as string);
    const segments = url.pathname.split('/').filter(Boolean);
    expect(segments[0]).toBe(ROTA_RESPOND_PATH.replace('/', ''));
    expect(segments[1]).toBe(token);
    expect(isRotaToken(segments[1])).toBe(true);
    // 🔴 In the PATH, never a query string — a query is stripped by more link
    // handlers than a path segment is, and the whole capability would be lost.
    expect(url.search).toBe('');
  });

  it('and two invitations never share a link', () => {
    const a = buildRotaAcceptUrl('grace', 'A'.repeat(43));
    const b = buildRotaAcceptUrl('grace', 'B'.repeat(43));
    expect(a).not.toBe(b);
  });
});

/* ═══ 9 · 🔴 UNFILLED SLOTS ARE EXACT OR PROVABLY COMPLETE, ELSE `empty` ═══ */

describe('9 — unfilled slots are read exactly or completely, else empty', () => {
  const items = [
    item('i1', 'Welcome', 5, 0, ['u-ben', 'Benjamin Achterberg']),
    item('i2', 'Sound desk', 60, 1, null),
    item('i3', 'Sermon', 30, 2, ['u-ada', 'Adaeze Okonkwo']),
  ];

  it('🔴 A FAILED READ SHIPS NO FIGURE — and says why, in words the UI prints', () => {
    const report = unfilledSlots(
      [service(items)], [], { ...GOOD_READ, failed: true }, NOW,
    );
    expect(report.verdict.complete).toBe(false);
    expect(report.verdict.reason).toContain('could not be read');
    // 🔴 THE WHOLE POINT: not a zero, not a partial list. NOTHING.
    expect(report.warnings).toEqual([]);
  });

  it('🔴 INCOMPLETE SERVICES SHIP NO FIGURE — a plan not returned hides its empty slots', () => {
    const report = unfilledSlots(
      [service(items)], [], { ...GOOD_READ, servicesComplete: false }, NOW,
    );
    expect(report.verdict.complete).toBe(false);
    expect(report.warnings).toEqual([]);
  });

  it('🔴 A TRUNCATED INVITATION READ SHIPS NO FIGURE — an answered slot would read as unanswered', () => {
    const report = unfilledSlots(
      [service(items)], [], { ...GOOD_READ, invitationsTruncated: true }, NOW,
    );
    expect(report.verdict.complete).toBe(false);
    expect(report.verdict.reason).toContain('who has replied is unknown');
    expect(report.warnings).toEqual([]);
  });

  it('🔴 AND THE THREE FAILURES ARE DISTINGUISHABLE FROM A GENUINE "NONE"', () => {
    // A complete read of a fully-answered rota: verdict complete, list empty.
    const answered = unfilledSlots(
      [service([item('i1', 'Welcome', 5, 0, ['u-ben', 'Ben'])])],
      [invitation({ status: 'accepted', personId: 'u-ben' })],
      GOOD_READ, NOW,
    );
    expect(answered.verdict.complete).toBe(true);
    expect(answered.warnings).toEqual([]);
    // 🔴 The two states have the SAME empty list and DIFFERENT verdicts, which
    // is exactly why the caller must read the verdict and not the length.
    const failed = unfilledSlots([service(items)], [], { ...GOOD_READ, failed: true }, NOW);
    expect(failed.warnings.length).toBe(answered.warnings.length);
    expect(failed.verdict.complete).not.toBe(answered.verdict.complete);
  });

  it('every problem is classified, and each is a different admin action', () => {
    const report = unfilledSlots(
      [service(items)],
      [invitation({ id: 'p1__i3', itemId: 'i3', personId: 'u-ada', status: 'declined' })],
      GOOD_READ, NOW,
    );
    expect(report.verdict.complete).toBe(true);
    const byItem = Object.fromEntries(report.warnings.map((w) => [w.itemId, w.problem]));
    expect(byItem).toEqual({
      i1: 'uninvited',   // assigned, never told
      i2: 'unfilled',    // nobody at all
      i3: 'declined',    // said no — the slot is open again
    });
    expect(countByProblem(report.warnings)).toEqual({
      unfilled: 1, uninvited: 1, unanswered: 0, declined: 1,
    });
  });

  it('an invited-but-unanswered slot is `unanswered`, and an accepted one is not listed', () => {
    const one = [item('i1', 'Welcome', 5, 0, ['u-ben', 'Ben'])];
    const pending = unfilledSlots([service(one)], [invitation()], GOOD_READ, NOW);
    expect(pending.warnings.map((w) => w.problem)).toEqual(['unanswered']);
    const accepted = unfilledSlots(
      [service(one)], [invitation({ status: 'accepted' })], GOOD_READ, NOW,
    );
    expect(accepted.warnings).toEqual([]);
  });

  it('🔴 an invitation for a DIFFERENT person than the plan now holds reads as `uninvited`', () => {
    // The slot was reassigned after the invitation went out. The new person has
    // been told nothing, and a stale invitation must not make them look invited.
    const report = unfilledSlots(
      [service([item('i1', 'Welcome', 5, 0, ['u-ada', 'Ada'])])],
      [invitation({ status: 'accepted', personId: 'u-ben' })],
      GOOD_READ, NOW,
    );
    expect(report.warnings.map((w) => w.problem)).toEqual(['uninvited']);
  });

  it('only the FUTURE, and only inside the horizon', () => {
    const past = service([item('i1', 'Welcome', 5, 0, null)], new Date(2026, 8, 6, 10, 0));
    const far = service(
      [item('i2', 'Welcome', 5, 0, null)],
      new Date(NOW.getTime() + (SLOT_HORIZON_DAYS + 1) * 86_400_000),
    );
    const soon = service([item('i3', 'Welcome', 5, 0, null)]);
    const report = unfilledSlots([past, far, soon], [], GOOD_READ, NOW);
    expect(report.warnings.map((w) => w.itemId)).toEqual(['i3']);
    expect(report.horizonDays).toBe(SLOT_HORIZON_DAYS);
  });

  it('an undated service, and a service with no plan, are SKIPPED rather than guessed at', () => {
    const undated = service([item('i1', 'Welcome', 5, 0, null)], null);
    const planless: RotaService = { ...service([item('i2', 'Welcome', 5, 0, null)]), planId: null };
    expect(unfilledSlots([undated, planless], [], GOOD_READ, NOW).warnings).toEqual([]);
  });

  it('the rows are ordered soonest first, in memory — there is no Firestore ordering here', () => {
    const later = { ...service([item('i9', 'Late', 5, 0, null)], new Date(2026, 8, 20, 10, 0)), eventId: 'e2', planId: 'p2' };
    const report = unfilledSlots([later, service([item('i1', 'Early', 5, 0, null)])], [], GOOD_READ, NOW);
    expect(report.warnings.map((w) => w.itemId)).toEqual(['i1', 'i9']);
  });

  it('the source is named IN THE TYPE, so no surface can describe it wrongly', () => {
    expect(unfilledSlots([], [], GOOD_READ, NOW).source).toBe('servicePlans+rotaInvitations');
  });

  it('and the clock time on a warning is part 1\'s arithmetic, not a second copy', () => {
    // The third item starts 5 + 60 minutes after the service, derived — never stored.
    const report = unfilledSlots([service(items)], [], GOOD_READ, NOW);
    const sermon = report.warnings.find((w) => w.itemId === 'i3');
    expect(sermon?.startsAt?.getTime()).toBe(SUNDAY.getTime() + 65 * 60_000);
  });
});

/* ═══ 🔴 THE FORWARD COMPLETENESS PROOF IS NOT PART 2'S BACKWARD ONE ═══════ */

describe('the completeness proof looks FORWARD, which is not what recencyVerdict asks', () => {
  const read = (over: Partial<Parameters<typeof servicesCompleteForHorizon>[0]> = {}) => ({
    failed: false, plansTruncated: false, eventsTruncated: false, oldestEventStart: null, ...over,
  });

  it('an untruncated read is complete', () => {
    expect(servicesCompleteForHorizon(read(), NOW)).toBe(true);
  });

  it('🔴 a truncated EVENT read that did NOT reach back past now is INCOMPLETE', () => {
    // `useEvents` orders startDate DESC, so truncation drops the SOONEST events.
    // A church with more than a hundred future services gets next April and not
    // next Sunday — and a warning list built on that reports every near-term
    // slot as filled because it never saw them.
    expect(servicesCompleteForHorizon(
      read({ eventsTruncated: true, oldestEventStart: new Date(NOW.getTime() + 86_400_000) }),
      NOW,
    )).toBe(false);
  });

  it('🔴 but a truncated read that DID reach back past now is PROVABLY complete', () => {
    expect(servicesCompleteForHorizon(
      read({ eventsTruncated: true, oldestEventStart: new Date(2024, 0, 1) }),
      NOW,
    )).toBe(true);
  });

  it('a truncated read with no dated event at all is incomplete', () => {
    expect(servicesCompleteForHorizon(read({ eventsTruncated: true }), NOW)).toBe(false);
  });

  it('a failed or plan-truncated read is incomplete however far back the events reached', () => {
    const far = { oldestEventStart: new Date(2020, 0, 1) };
    expect(servicesCompleteForHorizon(read({ ...far, failed: true }), NOW)).toBe(false);
    expect(servicesCompleteForHorizon(read({ ...far, plansTruncated: true }), NOW)).toBe(false);
  });

  it('and slotVerdict names each refusal separately, so the UI can print which', () => {
    expect(slotVerdict({ ...GOOD_READ, failed: true }).reason)
      .not.toBe(slotVerdict({ ...GOOD_READ, servicesComplete: false }).reason);
    expect(slotVerdict({ ...GOOD_READ, servicesComplete: false }).reason)
      .not.toBe(slotVerdict({ ...GOOD_READ, invitationsTruncated: true }).reason);
    expect(slotVerdict(GOOD_READ)).toEqual({ complete: true, reason: null });
  });
});

/* ═══ The reminder — every clause costs money if it is wrong ═══════════════ */

describe('a reminder is due only when all five clauses hold', () => {
  const due = (over: Partial<RotaInvitation> = {}) => reminderDue(invitation(over), NOW);

  it('the base case is due: unanswered, inside the window, reached, never reminded', () => {
    expect(due()).toBe(true);
  });

  it('🔴 an ACCEPTED invitation is NEVER reminded — the largest saving here', () => {
    // Twenty volunteers who have all said yes would otherwise cost twenty
    // charges to be told what they already told Harvest.
    expect(due({ status: 'accepted' })).toBe(false);
    expect(due({ status: 'declined' })).toBe(false);
  });

  it('a service that has already started is never reminded', () => {
    expect(due({ startsAt: new Date(2026, 8, 6, 10, 0) })).toBe(false);
  });

  it('a service beyond the window is not yet due', () => {
    expect(due({
      startsAt: new Date(NOW.getTime() + (REMINDER_WINDOW_DAYS + 1) * 86_400_000),
    })).toBe(false);
  });

  it('🔴 a second press sends nothing — the count is persisted and capped at one', () => {
    expect(MAX_REMINDERS).toBe(1);
    expect(due({ reminderCount: 1 })).toBe(false);
  });

  it('🔴 and an invitation nothing ever reached has nothing to remind about', () => {
    expect(due({ channels: { email: 'unavailable', sms: 'unavailable' } })).toBe(false);
    expect(due({ channels: { email: 'failed', sms: 'opted_out' } })).toBe(false);
    expect(due({ channels: { email: 'unavailable', sms: 'sent' } })).toBe(true);
  });
});

/* ═══ 🔵 The volunteer-facing view shows ONLY that person's own rows ═══════ */

describe('the volunteer-facing view shows only the holder\'s own assignments', () => {
  const mine = invitation({ id: 'p1__i1', personId: 'u-ben' });
  const alsoMine = invitation({
    id: 'p2__i1', personId: 'u-ben', startsAt: new Date(2026, 8, 20, 10, 0),
  });
  const theirs = invitation({ id: 'p3__i1', personId: 'u-ada', personName: 'Adaeze Okonkwo' });

  it('🔴 another member\'s row is NEVER returned — a bearer token reveals no more than its holder knows', () => {
    const result = myAssignments(mine, [mine, alsoMine, theirs], NOW);
    expect(result.upcoming.map((i) => i.id)).toEqual(['p2__i1']);
    expect(result.upcoming.some((i) => i.personId !== 'u-ben')).toBe(false);
  });

  it('the one being answered is not repeated in the list beside itself', () => {
    expect(myAssignments(mine, [mine], NOW).upcoming).toEqual([]);
  });

  it('past and declined rows drop out; the rest are soonest first', () => {
    const past = invitation({ id: 'p4__i1', personId: 'u-ben', startsAt: new Date(2026, 8, 1, 10, 0) });
    const declined = invitation({ id: 'p5__i1', personId: 'u-ben', status: 'declined', startsAt: new Date(2026, 8, 16, 10, 0) });
    const result = myAssignments(mine, [mine, alsoMine, past, declined], NOW);
    expect(result.upcoming.map((i) => i.id)).toEqual(['p2__i1']);
  });
});

/* ═══ 15 · 🔴 EVERY ELEMENT THAT HAS A PRIMITIVE USES IT ═══════════════════ */

let container: HTMLDivElement;
let root: Root | null = null;

const mount = (element: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

const slots = (over: Partial<Parameters<typeof unfilledSlots>[2]> = {}) =>
  unfilledSlots(
    [service([
      item('i1', 'Welcome and call to worship', 5, 0, ['u-ben', 'Benjamin Achterberg']),
      item('i2', 'Sound desk', 60, 1, null),
    ])],
    [],
    { ...GOOD_READ, ...over },
    NOW,
  );

describe('15 — every element that has a primitive uses it', () => {
  /**
   * 🔴 ASSERTED ON THE RENDERED DOM VIA `data-slot`, NOT ON THE IMPORT LIST.
   * An import proves a module was loaded; `data-slot="card"` in the output
   * proves the primitive is what actually drew the box. A hand-written
   * substitute passes the first and fails this.
   */
  it('the admin panel draws its card, alert, item rows, badges and button-group from primitives', () => {
    mount(
      <RotaInviteView
        report={slots()}
        loading={false}
        pending={{ messages: 1, smsSegments: 1 }}
        remindersDue={0}
        smsUnavailable={false}
        busy={false}
        outcome={null}
        onInvite={() => {}}
        onRemind={() => {}}
      />,
    );
    for (const slot of ['card', 'alert', 'item-group', 'item', 'badge', 'button-group', 'button', 'separator']) {
      expect(container.querySelector(`[data-slot="${slot}"]`), `no ${slot} primitive`).not.toBeNull();
    }
    // 🔴 AND NO HAND-WRITTEN SUBSTITUTE FOR ONE.
    expect(container.querySelector('[role="table"], table'), 'a hand-written table').toBeNull();
    for (const el of Array.from(container.querySelectorAll('div'))) {
      const cls = el.getAttribute('class') ?? '';
      const handRolledCard = /\brounded-\S+/.test(cls) && /\bborder\b/.test(cls) && /\bp-\d/.test(cls);
      expect(handRolledCard && !el.hasAttribute('data-slot'),
        `a hand-written card: ${cls}`).toBe(false);
    }
  });

  it('🔴 loading is `skeleton`, and it is not an empty list', () => {
    mount(
      <RotaInviteView
        report={slots()} loading pending={null} remindersDue={0}
        smsUnavailable={false} busy={false} outcome={null}
        onInvite={() => {}} onRemind={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(container.querySelector('[data-rota-invite-unknown]')).toBeNull();
  });

  it('🔴 a read that could not be proved complete renders `empty` WITH THE REASON — never "none"', () => {
    const report = slots({ failed: true });
    mount(
      <RotaInviteView
        report={report} loading={false} pending={null} remindersDue={0}
        smsUnavailable={false} busy={false} outcome={null}
        onInvite={() => {}} onRemind={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(container.querySelector('[data-rota-invite-unknown]')).not.toBeNull();
    // 🔴 THE WORDS MATTER: the verdict's own sentence, and NOT a claim that
    // everything is filled.
    expect(container.textContent).toContain(report.verdict.reason as string);
    expect(container.textContent).not.toContain('Every slot is filled');
    expect(container.querySelector('[data-rota-slot-warning]'), 'a figure shipped anyway').toBeNull();
  });

  it('a complete read of a filled rota says so in DIFFERENT words and a different element', () => {
    mount(
      <RotaInviteView
        report={unfilledSlots([], [], GOOD_READ, NOW)} loading={false} pending={null}
        remindersDue={0} smsUnavailable={false} busy={false} outcome={null}
        onInvite={() => {}} onRemind={() => {}}
      />,
    );
    expect(container.querySelector('[data-rota-invite-all-filled]')).not.toBeNull();
    expect(container.querySelector('[data-rota-invite-unknown]')).toBeNull();
    expect(container.textContent).toContain('Every slot is filled');
  });

  it('🔴 the SMS-less fallback is SAID, not left to be discovered', () => {
    mount(
      <RotaInviteView
        report={slots()} loading={false} pending={{ messages: 2, smsSegments: 0 }}
        remindersDue={0} smsUnavailable busy={false} outcome={null}
        onInvite={() => {}} onRemind={() => {}}
      />,
    );
    const note = container.querySelector('[data-rota-no-sms]');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('data-slot')).toBe('alert');
    expect(container.textContent).toContain('Everything here works without');
    // ⚠️ And the button quotes NO SMS cost, because there is none to quote.
    expect(container.textContent).toContain('Invite 2');
    expect(container.textContent).not.toContain('· 0 SMS');
  });

  it('🔴 the button says what the press costs BEFORE it is pressed', () => {
    mount(
      <RotaInviteView
        report={slots()} loading={false} pending={{ messages: 20, smsSegments: 23 }}
        remindersDue={4} smsUnavailable={false} busy={false} outcome={null}
        onInvite={() => {}} onRemind={() => {}}
      />,
    );
    // Harvest resells: twenty volunteers is twenty charges on Harvest's account.
    expect(container.textContent).toContain('Invite 20');
    expect(container.textContent).toContain('23 SMS');
    expect(container.textContent).toContain('Remind 4');
  });

  it('a failed send is an `alert` that stays on screen, never a toast', () => {
    mount(
      <RotaInviteView
        report={slots()} loading={false} pending={null} remindersDue={0}
        smsUnavailable={false} busy={false}
        outcome={{ kind: 'failed', message: 'The invitations could not be sent.' }}
        onInvite={() => {}} onRemind={() => {}}
      />,
    );
    const el = container.querySelector('[data-rota-send-outcome]');
    expect(el?.getAttribute('data-slot')).toBe('alert');
    expect(container.textContent).toContain('Nothing was sent');
  });
});

describe('15 — the volunteer page draws every element from a primitive too', () => {
  const row = (over: Partial<RespondRow> = {}): RespondRow => ({
    id: 'p1__i1',
    eventTitle: 'Sunday Morning Gathering',
    itemTitle: 'Welcome and call to worship',
    startsAtMs: SUNDAY.getTime(),
    status: 'invited',
    ...over,
  });

  it('card, button-group, badge, item and separator are all the primitives', () => {
    mount(
      <RotaRespondView
        churchName="Grace Chapel"
        personName="Benjamin Achterberg"
        current={row()}
        upcoming={[row({ id: 'p2__i1', status: 'accepted' })]}
        onAnswer={async () => 'accepted'}
      />,
    );
    for (const slot of ['card', 'button-group', 'button', 'badge', 'item-group', 'item', 'separator']) {
      expect(container.querySelector(`[data-slot="${slot}"]`), `no ${slot} primitive`).not.toBeNull();
    }
    for (const el of Array.from(container.querySelectorAll('div'))) {
      const cls = el.getAttribute('class') ?? '';
      const handRolledCard = /\brounded-\S+/.test(cls) && /\bborder\b/.test(cls) && /\bp-\d/.test(cls);
      expect(handRolledCard && !el.hasAttribute('data-slot'), `a hand-written card: ${cls}`).toBe(false);
    }
  });

  it('🔴 accept and decline are TWO buttons in ONE button-group — the ticket\'s own mapping', () => {
    mount(
      <RotaRespondView
        churchName="Grace Chapel" personName="Ben" current={row()} upcoming={[]}
        onAnswer={async () => 'accepted'}
      />,
    );
    const group = container.querySelector('[data-slot="button-group"]');
    expect(group).not.toBeNull();
    const buttons = Array.from(group?.querySelectorAll('[data-slot="button"]') ?? []);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute('aria-label')))
      .toEqual(['Accept this slot', 'Decline this slot']);
  });

  it('answering records, and the badge changes to say so', async () => {
    let asked: string | null = null;
    mount(
      <RotaRespondView
        churchName="Grace Chapel" personName="Ben" current={row()} upcoming={[]}
        onAnswer={async (a) => { asked = a; return a; }}
      />,
    );
    expect(container.textContent).toContain('Awaiting your reply');
    const decline = container.querySelector('[aria-label="Decline this slot"]') as HTMLElement;
    await act(async () => { decline.click(); });
    expect(asked).toBe('declined');
    expect(container.textContent).toContain('Declined');
  });

  it('🔴 a failed answer is an `alert` that STAYS — a missed toast means they believe they replied', async () => {
    mount(
      <RotaRespondView
        churchName="Grace Chapel" personName="Ben" current={row()} upcoming={[]}
        onAnswer={async () => { throw new Error('That link is no longer active.'); }}
      />,
    );
    const accept = container.querySelector('[aria-label="Accept this slot"]') as HTMLElement;
    await act(async () => { accept.click(); });
    const alert = container.querySelector('[data-rota-error]');
    expect(alert?.getAttribute('data-slot')).toBe('alert');
    expect(container.textContent).toContain('That link is no longer active.');
    // The status did NOT move to accepted on a failure.
    expect(container.textContent).toContain('Awaiting your reply');
  });

  it('with nothing else booked it renders `empty`, not a bare zero', () => {
    mount(
      <RotaRespondView
        churchName="Grace Chapel" personName="Ben" current={row()} upcoming={[]}
        onAnswer={async () => 'accepted'}
      />,
    );
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(container.textContent).toContain('Nothing else booked');
  });

  it('🔴 and no place appears anywhere — a rota must not become a directory', () => {
    mount(
      <RotaRespondView
        churchName="Grace Chapel" personName="Benjamin Achterberg" current={row()}
        upcoming={[row({ id: 'p2__i1' })]}
        onAnswer={async () => 'accepted'}
      />,
    );
    expect(container.textContent).toContain('Benjamin Achterberg');
    for (const word of ['Road', 'Street', 'Avenue', 'Postcode', 'Address']) {
      expect(container.textContent).not.toContain(word);
    }
  });
});
