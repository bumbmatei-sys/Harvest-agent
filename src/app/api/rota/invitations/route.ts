import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';

import { requireAdmin, requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { SMS_FEATURE_ENABLED } from '@/lib/sms-feature';
import {
  MAX_SENDS_PER_REQUEST,
  listInvitations,
  sendInvitation,
  type AssignmentToInvite,
  type PersonContact,
} from '@/lib/rota-invite';
import {
  invitationId,
  reminderDue,
  type RotaInvitation,
} from '@/components/events/rota-invitations';
import { clampMinutes, orderedItems } from '@/components/events/service-plan';
import { getEffectiveFeatures, readTenantAddons, toTenantPlan } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';

/**
 * THE-324 — the admin's half. LIST what has been said, and SAY it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS IS A ROUTE AND NOT A CLIENT FIRESTORE CALL.
 *
 * `tenants/{t}/rotaInvitations` has NO rule in `firestore.rules`, deliberately —
 * see `src/lib/rota-invite.ts` for the whole argument and for the rule that
 * would be needed if this ever became a browser read. `firestore.rules`
 * auto-deploys to production on merge, CI runs no emulator tests, and THE-313's
 * one-line addition turned 49 test files red. So the collection is server-only
 * and this route is how the admin screen reaches it. 🔴 `firestore.rules` is
 * byte-identical after this ticket.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY MESSAGE COSTS HARVEST MONEY, SO EVERY GATE IS HERE, SERVER-SIDE.
 *
 *   · `tenantId` COMES FROM THE VERIFIED TOKEN, NEVER THE BODY. A
 *     request-supplied tenant would spend another church's allotment.
 *   · THE PERMISSION IS `manageEvents` — the same one `servicePlans` requires to
 *     write. Planning a service and telling people they are on it is one
 *     authority; inventing a second permission would add a claim to a roles
 *     screen this ticket does not own.
 *   · 🔴 THE RECIPIENT IS READ FROM `users/{personId}`, WHERE `personId` CAME
 *     FROM THE PLAN DOCUMENT — never from the request. Accepting a phone number
 *     or an address in the body would turn this into an open relay that bills
 *     Harvest per message, which is strictly worse than the open relay
 *     `/api/crm/send-email` refuses to be for the same reason.
 *   · 🔴 AND THE BATCH IS BOUNDED. `MAX_SENDS_PER_REQUEST` caps one press at 40
 *     messages. A church with a 60-row run sheet cannot turn one click into 60
 *     charges by accident, and a compromised admin session cannot turn it into
 *     thousands.
 *
 * ⚠️ THE SEND ITSELF IS NOT HERE. `sendInvitation` owns it, and its SMS half is
 * THE-314's `sendTenantSms` — the funnel that holds the master switch, the
 * Ministry entitlement, STOP, the destination gate and the segment meter. This
 * route does not import `sms-send`, `zernio`, `twilio` or `sms-usage`, and it
 * makes no `fetch` of its own. 🔴 There is exactly one send path and it is not
 * in this file.
 */

/** Which people a batch may name — one read of `users` per distinct person. */
async function contactFor(tenantId: string, personId: string): Promise<PersonContact | null> {
  const snap = await adminDb.collection('users').doc(personId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  // 🔴 A person in ANOTHER church is not a recipient, whatever the plan says.
  if (data.tenantId !== tenantId) return null;
  return {
    email: typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null,
    phone: typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : null,
  };
}

/**
 * Whether this church's plan includes SMS at all. Ministry-only (THE-314).
 *
 * 🔴 THROUGH `getEffectiveFeatures`, NEVER `getPlanFeatures` AND NEVER A BARE
 * `plan === 'max'`. THE-253 established that add-on capabilities are LIFTED with
 * `||` and never assigned, so the day SMS is sold as an add-on to a lower tier
 * this call site already honours it and only `getEffectiveFeatures` changes.
 * FAILS CLOSED, like the funnel's own copy: an unreadable tenant reports no SMS,
 * so the panel says "invitations go out by email" rather than promising texts a
 * church may not get.
 */
async function smsAvailableFor(tenantId: string): Promise<boolean> {
  // 🔴 THE-335 — THE MASTER SWITCH FIRST, BEFORE THE PLAN CELL.
  //
  // ⚠️ THIS IS THE ONE SURFACE THE-335 FOUND THE SWITCH NOT REACHING. THE-324
  // wrote this function after THE-314 flipped SMS on, so it only ever asked the
  // plan: `smsAutomation` is true on Ministry whatever `SMS_FEATURE_ENABLED`
  // says, and this route answered `smsAvailable: true` to the panel while the
  // funnel was refusing every send with `feature_hidden`. Nothing was ever sent
  // and nothing was ever metered — `sendOneSms` maps that code to
  // `'unavailable'` — but the panel PROMISED a Ministry admin a text it then
  // did not deliver, which is the false claim this switch exists to prevent.
  //
  // 🔴 FAILS CLOSED IN THE SAME DIRECTION AS THE CATCH BELOW: the answer this
  // route may safely get wrong is "no SMS", because the email carries the
  // invitation on its own.
  if (!SMS_FEATURE_ENABLED) return false;
  try {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return false;
    const data = snap.data() as { plan?: unknown; addons?: unknown } | undefined;
    const plan = toTenantPlan(typeof data?.plan === 'string' ? data.plan : null);
    return getEffectiveFeatures(plan, readTenantAddons(data?.addons)).smsAutomation === true;
  } catch {
    return false;
  }
}

async function churchNameFor(tenantId: string): Promise<string> {
  const snap = await adminDb.collection('tenants').doc(tenantId).get();
  const name = snap.exists ? (snap.data() as Record<string, unknown>).name : null;
  return typeof name === 'string' ? name : '';
}

/**
 * One plan's assignable rows, with each item's CLOCK TIME derived exactly as
 * part 1 derives it.
 *
 * ⚠️ THE CLOCK IS `itemClockTimes`' ARITHMETIC, NOT A SECOND COPY OF IT. An
 * invitation that said 10:00 where the run sheet said 10:04 would be a second
 * answer to a question part 1 already answered, and the two would drift the
 * first time somebody changed a duration. The loop below lays the items end to
 * end the way `itemClockTimes` does — over the RAW document rather than a parsed
 * `ServicePlan`, because this is the Admin SDK and there is no client `readPlan`
 * here — and `the-324-guards.test.ts` pins the two against each other.
 */
function assignmentsOf(
  planId: string,
  planData: Record<string, unknown>,
  event: { id: string; title: string; startsAt: Date },
): AssignmentToInvite[] {
  const raw = Array.isArray(planData.items) ? (planData.items as Record<string, unknown>[]) : [];
  const items = orderedItems(
    raw
      .filter((r) => !!r && typeof r === 'object')
      .map((r, i) => ({
        id: typeof r.id === 'string' && r.id ? r.id : `row-${i}`,
        title: typeof r.title === 'string' ? r.title : '',
        minutes: clampMinutes(r.minutes),
        order: typeof r.order === 'number' ? r.order : i,
        personId: typeof r.personId === 'string' && r.personId ? r.personId : null,
        personName: typeof r.personName === 'string' && r.personName ? r.personName : null,
        note: null,
      })),
  );

  const out: AssignmentToInvite[] = [];
  let offset = 0;
  for (const item of items) {
    const startsAt = new Date(event.startsAt.getTime() + offset * 60_000);
    offset += clampMinutes(item.minutes);
    if (!item.personId) continue;
    out.push({
      planId,
      itemId: item.id,
      eventId: event.id,
      eventTitle: event.title,
      itemTitle: item.title,
      personId: item.personId,
      personName: item.personName || 'Unnamed member',
      startsAt,
    });
  }
  return out;
}

/**
 * THE-329's standalone service, narrowed to the SAME three fields `eventFor`
 * returns — the id, the title and the start, and nothing else.
 *
 * ⚠️ SYNCHRONOUS AND READ-FREE. A standalone service IS the plan document, so
 * every field is already in hand; there is no second read, and this route's
 * cost per invite is unchanged for an event-anchored service and one read
 * cheaper for a standalone one.
 *
 * The id is `''` because there is no event. A `Timestamp` is REQUIRED — an ISO
 * string or an epoch number in `startAt` yields null and the caller answers
 * "that service has no date yet" rather than parsing a second representation of
 * a date this feature keeps in exactly one.
 */
function standaloneServiceFor(
  planData: Record<string, unknown>,
): { id: string; title: string; startsAt: Date } | null {
  const start = planData.startAt;
  if (!(start instanceof Timestamp)) return null;
  return {
    id: '',
    title: typeof planData.name === 'string' && planData.name ? planData.name : 'Service',
    startsAt: start.toDate(),
  };
}

async function eventFor(
  tenantId: string,
  eventId: string,
): Promise<{ id: string; title: string; startsAt: Date } | null> {
  const snap = await adminDb
    .collection('tenants').doc(tenantId).collection('events').doc(eventId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const start = data.startDate;
  if (!(start instanceof Timestamp)) return null;
  // ⚠️ THE TITLE AND THE DATE, AND NOTHING ELSE. THE-283: never a member
  // alongside a location. `location`, `isOnline` and `onlineLink` exist on this
  // document and are not read here, exactly as part 2's `rotaEvent` drops them —
  // a field that is never read cannot be rendered by anybody.
  return {
    id: eventId,
    title: typeof data.title === 'string' ? data.title : 'Service',
    startsAt: start.toDate(),
  };
}

/**
 * GET — every invitation this church has, and whether the read was complete.
 *
 * 🔴 `truncated` IS RETURNED RATHER THAN HIDDEN. It is what `slotVerdict`
 * refuses on: an unfilled-slot figure computed over a truncated read could
 * report a slot as unanswered that has in fact been accepted, and an admin would
 * pay for a reminder nobody needed. A read that cannot be proved complete ships
 * no figure at all.
 */
export async function GET(request: NextRequest) {
  const userOrErr = await requireAdmin(request);
  if (userOrErr instanceof NextResponse) return userOrErr;
  const tenantId = userOrErr.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }
  const permOrErr = await requireTenantPermission(request, tenantId, 'manageEvents');
  if (permOrErr instanceof NextResponse) return permOrErr;

  try {
    const read = await listInvitations(tenantId);
    return NextResponse.json({
      truncated: read.truncated,
      // 🔴 THE ENTITLEMENT IS RESOLVED SERVER-SIDE AND RETURNED AS A FACT.
      //
      // ⚠️ It is a READ, never a write — #434 removed a client-side entitlement
      // write and THE-259's sweep catches another. The panel needs it only to
      // SAY "invitations go out by email" to a church on Individual or Small
      // Team, and a client that computed it from a plan string it had read
      // itself would be a second opinion about entitlement in a repo that has
      // exactly one (`getEffectiveFeatures`, never a bare `plan === 'max'`).
      //
      // ⚠️ AND IT GATES NOTHING HERE. The real gate is inside THE-314's funnel,
      // which refuses an unentitled send before spending anything. This value
      // only decides what the panel says.
      smsAvailable: await smsAvailableFor(tenantId),
      invitations: read.invitations.map(wire),
    });
  } catch (e) {
    console.error('rota invitations GET failed:', e);
    captureHandledError(e, { step: 'rota-invitations-list', tenantId });
    // 🔴 A NON-2xx, NOT AN EMPTY LIST. An error swallowed into `[]` renders "no
    // unfilled slots", which is indistinguishable from an answer.
    return NextResponse.json({ error: 'The invitations could not be read.' }, { status: 502 });
  }
}

/** The wire shape: epoch MILLISECONDS, so no second date FORMAT crosses the wire. */
function wire(i: RotaInvitation) {
  return {
    id: i.id,
    planId: i.planId,
    itemId: i.itemId,
    eventId: i.eventId,
    personId: i.personId,
    personName: i.personName,
    eventTitle: i.eventTitle,
    itemTitle: i.itemTitle,
    startsAtMs: i.startsAt.getTime(),
    status: i.status,
    invitedAtMs: i.invitedAt ? i.invitedAt.getTime() : null,
    remindedAtMs: i.remindedAt ? i.remindedAt.getTime() : null,
    respondedAtMs: i.respondedAt ? i.respondedAt.getTime() : null,
    reminderCount: i.reminderCount,
    channels: i.channels,
  };
}

/**
 * POST — invite everybody assigned on one plan, or remind everybody who is due.
 *
 * Body: `{ action: 'invite', planId }` or `{ action: 'remind' }`. 🔴 Nothing
 * else is read from it, and neither form carries a recipient.
 */
export async function POST(request: NextRequest) {
  const userOrErr = await requireAdmin(request);
  if (userOrErr instanceof NextResponse) return userOrErr;
  const user = userOrErr;
  const tenantId = user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }
  const permOrErr = await requireTenantPermission(request, tenantId, 'manageEvents');
  if (permOrErr instanceof NextResponse) return permOrErr;

  let payload: { action?: unknown; planId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const action = payload.action === 'remind' ? 'remind' : payload.action === 'invite' ? 'invite' : null;
  if (!action) {
    return NextResponse.json({ error: "action must be 'invite' or 'remind'" }, { status: 400 });
  }

  const now = new Date();
  try {
    const churchName = await churchNameFor(tenantId);
    const targets: AssignmentToInvite[] = [];

    if (action === 'invite') {
      const planId = typeof payload.planId === 'string' ? payload.planId.trim() : '';
      if (!planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
      const planSnap = await adminDb
        .collection('tenants').doc(tenantId).collection('servicePlans').doc(planId).get();
      if (!planSnap.exists) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
      const planData = planSnap.data() as Record<string, unknown>;
      /**
       * 🔴 THE-329 — THE SERVICE IS THE EVENT, OR THE PLAN'S OWN DATE.
       *
       * A plan now carries two possible anchors (see `service-plan.ts`), and
       * this is the server's half of reading them. The ORDER matches
       * `planKind`'s: an event wins when there is one, so every invitation a
       * church has ever sent is derived from exactly the document it was
       * derived from before. A standalone service falls through to its own
       * `startAt`, and a plan with NEITHER is a template — nobody can be on for
       * it, which is the message that was already here.
       *
       * ⚠️ NOTHING ABOUT AN INVITATION'S PERSISTED SHAPE CHANGED. Both branches
       * produce the same `{ id, title, startsAt }` descriptor `assignmentsOf`
       * has always taken, so every field written to `rotaInvitations` keeps its
       * name and its type. A standalone service's `eventId` is the empty string
       * because there is no event — it is a label this feature echoes back and
       * never resolves.
       */
      const eventId = typeof planData.eventId === 'string' ? planData.eventId : '';
      const service = eventId
        ? await eventFor(tenantId, eventId)
        : standaloneServiceFor(planData);
      if (!service) {
        return NextResponse.json({ error: 'That service has no date yet.' }, { status: 400 });
      }
      for (const a of assignmentsOf(planId, planData, service)) {
        // 🔴 Never invite somebody to something that has already happened.
        if (a.startsAt.getTime() <= now.getTime()) continue;
        targets.push(a);
      }
    } else {
      const read = await listInvitations(tenantId);
      for (const invitation of read.invitations) {
        if (!reminderDue(invitation, now)) continue;
        targets.push({
          planId: invitation.planId,
          itemId: invitation.itemId,
          eventId: invitation.eventId,
          eventTitle: invitation.eventTitle,
          itemTitle: invitation.itemTitle,
          personId: invitation.personId,
          personName: invitation.personName,
          // 🔴 The date the volunteer was TOLD, not a fresh one. A reminder
          // repeats the invitation; it does not silently amend it.
          startsAt: invitation.startsAt,
        });
      }
    }

    if (targets.length > MAX_SENDS_PER_REQUEST) {
      return NextResponse.json(
        {
          error:
            `That would send ${targets.length} messages at once. `
            + `Send at most ${MAX_SENDS_PER_REQUEST} in one go.`,
          code: 'batch_too_large',
        },
        { status: 400 },
      );
    }

    const results = [];
    for (const assignment of targets) {
      const contact = await contactFor(tenantId, assignment.personId);
      if (!contact) {
        // A `personId` that is not a member of this church any more. The
        // invitation is not created and nothing is sent.
        results.push({
          invitationId: invitationId(assignment.planId, assignment.itemId),
          personName: assignment.personName,
          delivered: false,
          channels: { email: 'unavailable' as const, sms: 'unavailable' as const },
          url: null,
          smsSegments: 0,
        });
        continue;
      }
      const report = await sendInvitation(
        tenantId, user.uid, assignment, contact, churchName,
        action === 'remind' ? 'reminder' : 'invite',
      );
      results.push({
        invitationId: report.invitationId,
        personName: assignment.personName,
        delivered: report.delivered,
        channels: report.channels,
        url: report.url,
        smsSegments: report.smsSegments,
      });
    }

    return NextResponse.json({
      action,
      attempted: results.length,
      delivered: results.filter((r) => r.delivered).length,
      // 🔴 What this press cost Harvest, reported back so the panel can say it.
      smsSegments: results.reduce((n, r) => n + r.smsSegments, 0),
      results,
    });
  } catch (e) {
    console.error('rota invitations POST failed:', e);
    captureHandledError(e, { step: 'rota-invitations-send', tenantId });
    return NextResponse.json({ error: 'The invitations could not be sent.' }, { status: 502 });
  }
}
