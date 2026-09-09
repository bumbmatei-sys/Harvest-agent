import { randomBytes } from 'node:crypto';

import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sendTenantSms } from '@/lib/sms-send';
import { sendTransactionalEmail } from '@/lib/transactional-email';
import {
  INVITATION_STATUSES,
  MAX_REMINDERS,
  invitationId,
  invitationMessage,
  isRotaToken,
  buildRotaAcceptUrl,
  type ChannelOutcome,
  type InvitationChannels,
  type InvitationStatus,
  type RotaInvitation,
} from '@/components/events/rota-invitations';

/**
 * THE-324 — where an invitation lives, and how ONE message reaches ONE person.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. NO `firestore.rules` CHANGE IS NEEDED, AND NONE IS MADE. STOP
 *       CONDITION 2, ANSWERED BY THE SHAPE RATHER THAN BY A RULE.
 *
 * `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE, CI runs no emulator
 * tests, and THE-313's ONE-LINE addition turned 49 test files red. So the
 * question is not "what rule do we write" but "how does this feature avoid
 * needing one", and the answer is the posture `tenants/{t}/smsOptOuts` and
 * `tenants/{t}/integrations/*` already have:
 *
 *   🔴 `tenants/{tenantId}/rotaInvitations/{planId}__{itemId}` HAS NO RULE, AND
 *      THEREFORE NO CLIENT READ AND NO CLIENT WRITE. Every access — the admin's
 *      list, the invite, the reminder, the volunteer's accept — goes through the
 *      Admin SDK inside a route in `src/app/api/rota/`. The Admin SDK bypasses
 *      rules entirely, so no rule is consulted, none is added, and
 *      `firestore.rules` is byte-identical after this ticket.
 *
 * ⚠️ THE UNAUTHENTICATED WRITE IS THE WHOLE REASON THIS MATTERS. An accept from
 * a signed-out volunteer is a write nobody is authenticated for, and there is no
 * `firestore.rules` expression that can safely authorise it: a rule can see the
 * request, not a secret, so `allow write: if true` on a collection keyed by a
 * guessable path is the only shape rules could offer, and it would let anybody
 * rewrite anybody's answer. Moving the write server-side is not a workaround —
 * it is the only place the token CAN be checked.
 *
 * 🔴 THE RULE THAT WOULD BE NEEDED, IF A LATER TICKET EVER READS THIS
 *    COLLECTION FROM A BROWSER — REPORTED, DELIBERATELY UNWRITTEN, and it sits
 *    inside `match /tenants/{tenantId}` beside the `servicePlans` block #462
 *    added:
 *
 *        match /rotaInvitations/{inviteId} {
 *          allow read:  if hasPermission('manageEvents', tenantId);
 *          allow write: if false;
 *        }
 *
 *    ⚠️ READ IS `manageEvents`, NOT `belongsToTenant`. An invitation names a
 *    person and says whether they said no, which is narrower material than the
 *    run sheet `servicePlans` exposes to the whole tenant. WRITE IS `false`
 *    UNCONDITIONALLY — the only writer is this module, and a client write would
 *    let a member accept on somebody else's behalf from the console.
 *    🔴 IT IS NOT WRITTEN HERE. Nothing in this ticket needs it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. NO COMPOSITE INDEX. TWO QUERIES, EACH ONE FIELD, NEITHER ORDERED.
 *
 * `firestore.indexes.json` does NOT deploy on merge — `deploy-rules.yml` runs
 * `firestore:rules,storage` only — so an index added there is inert and the
 * query that needed it throws `failed-precondition` in production. So:
 *
 *   the admin's list   the whole collection + `limit(N + 1)`   no where, no order
 *   the accept page    `where('token','==',t)` + `limit(2)`    one field, no order
 *
 * Both are served by the automatic single-field index Firestore maintains for
 * free. Ordering is done in memory by `unfilledSlots` and `myAssignments`, which
 * is the pattern `query-helpers.ts` exists to make normal.
 *
 * ⚠️ AND THE `limit(N + 1)` IS NOT AN ORDERING DRESSED UP AS ONE. #405 found 41
 * files taking an unordered `limit(N)` and calling the arbitrary rows it
 * returned "the recent ones". This read KEEPS every row it gets and uses the
 * extra document for one purpose only: proving whether there were more. When
 * there were, `slotVerdict` refuses to show a figure at all.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. THE SEND PATH IS THE-314'S, AND THERE IS NO SECOND ONE.
 *
 * ⚠️ `sms-send.ts` says, in its own words, that `sendTenantSms` is "THE
 * INTERFACE ANOTHER FEATURE CALLS — one message, one person", and names THIS
 * ticket as the caller it exists for. So it is called, and nothing else is:
 * this module does not import `zernio.ts`, does not import `twilio.ts`, does
 * not import `sms-usage.ts` and does not `fetch` a provider. Everything a
 * caller would otherwise have to remember is already inside that funnel —
 *
 *   0. THE-245 master switch
 *   1. 🔴 PLAN ENTITLEMENT — SMS is Ministry-only
 *   2. 🔴 STOP suppression — carrier-mandated, fails closed
 *   3. US-only destination
 *   4. 🔴 THE MONTHLY SEGMENT METER — `tenants/{t}/usage/{YYYY-MM}`
 *
 * — and every one of them binds on this feature's sends because they bind
 * inside the funnel rather than at its call sites. 🔴 There is therefore NO
 * unmetered path here by construction: this module cannot send without
 * `sendTenantSms`, and `sendTenantSms` cannot send without reserving and
 * settling a segment.
 *
 * 🔴 AND STOP IS NOT RE-IMPLEMENTED HERE EITHER. A second opt-out check in this
 * file would be a second place for it to be wrong, and the funnel's own check
 * happens BEFORE the segment is reserved. What this module does is RECORD the
 * refusal as `opted_out` so an admin can see why a volunteer stopped getting
 * texts — and so a reminder never retries that channel.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. EMAIL WORKS ON ITS OWN, AND THE FEATURE IS USEFUL WITHOUT SMS.
 *
 * SMS is Ministry-only. A church on Individual ($49) or Small Team ($99) has no
 * SMS at all, and `sendTenantSms` refuses their sends with `plan_not_entitled`
 * before spending anything. That must not make this feature useless to them, so:
 *
 *   · THE INVITATION IS CREATED FIRST AND UNCONDITIONALLY. It exists, it carries
 *     a token, and its accept link works, whether or not anything was sent.
 *   · EMAIL IS THE PRIMARY CHANNEL AND SMS IS THE ADDITION, not the reverse.
 *     `sendInvitation` reports success when EITHER channel delivered.
 *   · A refused SMS is recorded as `unavailable` and is never an error the admin
 *     has to clear. The rota does not tell a $49 church that its rota is broken
 *     because it declined to buy a $199 plan.
 *
 * 🔴 EMAIL GOES THROUGH RESEND, FROM A HARVEST-CONTROLLED SENDER (THE-340), AND
 * NEEDS NOTHING FROM THE CHURCH. No OAuth, no consent screen, no configuration:
 * `theharvest.app` is verified in Resend with sending enabled, so a church that
 * has connected NOTHING AT ALL still reaches its volunteers. That is the whole
 * of this ticket, and it is why the sentence that used to sit here — "a church
 * whose admin has not connected Gmail gets `unavailable` on that channel too" —
 * no longer describes anything. With SMS hidden by THE-335 that sentence had
 * become the description of a broken feature rather than a degraded one.
 *
 * ⚠️ HARVEST STILL MUST NEVER HOLD A SCOPE THAT CAN READ A CHURCH'S INBOX.
 * `assertSendOnlyGmailScopes` fails closed on the CONNECT route and is not
 * touched, called or weakened by this file — removing a caller of a Gmail
 * connection does not relax what may be asked for when one is made.
 *
 * ⚠️ THE ACCEPT LINK IS STILL RENDERED IN THE ADMIN PANEL to be copied by hand.
 * It was there because a transport could be missing; it stays because a person
 * can be missing — a volunteer with no email address on file is `unavailable`
 * on both channels, and the link is how the admin reaches them anyway.
 * 🔴 The invitation is never lost because a transport was.
 */

/** The collection. Spelled once; every access below goes through it. */
export const rotaInvitationsRef = (tenantId: string) =>
  adminDb.collection('tenants').doc(tenantId).collection('rotaInvitations');

/**
 * The ceiling on the admin's list read, and the honest thing to say about it.
 *
 * 🔴 THE READ ASKS FOR ONE MORE THAN IT KEEPS, exactly as part 2's
 * `ROTA_PLAN_LIMIT` does. `limit(501)` returning 501 rows PROVES there are more
 * than 500; returning 500 or fewer proves there are not. That is the difference
 * between knowing a read was complete and assuming it, and `slotVerdict`
 * refuses to show a warning figure when it was not.
 */
export const INVITATION_READ_LIMIT = 500;

/** 43 characters of base64url — 256 bits. See `TOKEN_RE`. */
export const newRotaToken = (): string => randomBytes(32).toString('base64url');

const outcome = (v: unknown): ChannelOutcome =>
  v === 'sent' || v === 'opted_out' || v === 'failed' ? v : 'unavailable';

const asDate = (v: unknown): Date | null =>
  v instanceof Timestamp ? v.toDate() : null;

/**
 * 🔴 THE ONE BOUNDARY WHERE A `Timestamp` BECOMES A `Date`.
 *
 * ⚠️ `asDate` accepts a `Timestamp` AND NOTHING ELSE — not an ISO string, not a
 * number. That is not defensiveness, it is the invariant: this collection has
 * exactly one writer, it writes `serverTimestamp()` and `Timestamp`, and a row
 * carrying a string would mean a second writer had appeared. Coercing one
 * silently is how `contactActivities.createdAt` came to hold both types and
 * became unsortable; refusing it is how this one stays sortable.
 *
 * A document with no `startsAt` is not an invitation — there is nothing to be
 * on for — so it returns null and the caller drops it rather than inventing a
 * date.
 */
export function readInvitation(id: string, data: Record<string, unknown>): RotaInvitation | null {
  const startsAt = asDate(data.startsAt);
  if (!startsAt) return null;
  const personId = typeof data.personId === 'string' ? data.personId : '';
  if (!personId) return null;
  const rawStatus = data.status;
  const status: InvitationStatus =
    typeof rawStatus === 'string' && (INVITATION_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as InvitationStatus)
      : 'invited';
  const rawChannels = (data.channels ?? {}) as Record<string, unknown>;
  const channels: InvitationChannels = {
    email: outcome(rawChannels.email),
    sms: outcome(rawChannels.sms),
  };
  return {
    id,
    tenantId: typeof data.tenantId === 'string' ? data.tenantId : '',
    planId: typeof data.planId === 'string' ? data.planId : '',
    itemId: typeof data.itemId === 'string' ? data.itemId : '',
    eventId: typeof data.eventId === 'string' ? data.eventId : '',
    personId,
    personName: typeof data.personName === 'string' ? data.personName : '',
    eventTitle: typeof data.eventTitle === 'string' ? data.eventTitle : '',
    itemTitle: typeof data.itemTitle === 'string' ? data.itemTitle : '',
    startsAt,
    status,
    invitedAt: asDate(data.invitedAt),
    remindedAt: asDate(data.remindedAt),
    respondedAt: asDate(data.respondedAt),
    reminderCount: typeof data.reminderCount === 'number' ? data.reminderCount : 0,
    channels,
  };
}

/** What one list read came back as, INCLUDING whether it was complete. */
export interface InvitationsRead {
  invitations: RotaInvitation[];
  /** 🔴 True when the collection holds more than the read returned. */
  truncated: boolean;
}

/**
 * Every invitation this church has, in one read.
 *
 * 🔴 NOT SWALLOWED ON FAILURE. This function throws; the route turns that into a
 * non-2xx, and the panel renders `slotVerdict`'s reason. A rejected read caught
 * into `[]` would render "no unfilled slots", which is indistinguishable from an
 * answer and is the `Form submissions 0` bug exactly.
 */
export async function listInvitations(tenantId: string): Promise<InvitationsRead> {
  const snap = await rotaInvitationsRef(tenantId).limit(INVITATION_READ_LIMIT + 1).get();
  const docs = snap.docs;
  return {
    truncated: docs.length > INVITATION_READ_LIMIT,
    invitations: docs
      .slice(0, INVITATION_READ_LIMIT)
      .map((d) => readInvitation(d.id, d.data() as Record<string, unknown>))
      .filter((i): i is RotaInvitation => i !== null),
  };
}

/**
 * The invitation a token addresses, or null.
 *
 * ⚠️ THE SHAPE IS CHECKED BEFORE FIRESTORE IS. A public endpoint must not spend
 * a read on `?token=<a megabyte of junk>`, and `TOKEN_RE` costs nothing.
 *
 * ⚠️ `limit(2)`, NOT `limit(1)`: two documents sharing a token would mean the
 * generator had collided (at 256 bits it has not) or that somebody had written
 * one by hand. Answering with an arbitrary one of them would let a token address
 * a row it was not minted for, so the ambiguous case returns null.
 */
export async function findByToken(tenantId: string, token: unknown): Promise<RotaInvitation | null> {
  if (!isRotaToken(token)) return null;
  const snap = await rotaInvitationsRef(tenantId).where('token', '==', token).limit(2).get();
  if (snap.docs.length !== 1) return null;
  const doc = snap.docs[0];
  return readInvitation(doc.id, doc.data() as Record<string, unknown>);
}

/** What an invitation is created from — the assignment, as the plan holds it. */
export interface AssignmentToInvite {
  planId: string;
  itemId: string;
  eventId: string;
  eventTitle: string;
  itemTitle: string;
  personId: string;
  personName: string;
  /** The ITEM's derived clock start — part 1's `itemClockTimes`, computed by the route. */
  startsAt: Date;
}

/** Where a message can go. Both may be absent; the invitation is made anyway. */
export interface PersonContact {
  email: string | null;
  phone: string | null;
}

/** What one invite or reminder actually did. */
export interface SendReport {
  invitationId: string;
  token: string;
  url: string | null;
  channels: InvitationChannels;
  /** True when at least one channel delivered. */
  delivered: boolean;
  /** SMS segments Harvest was billed for — 0 when nothing was sent. */
  smsSegments: number;
}

/**
 * 🔴 THE SMS HALF. THE-314'S FUNNEL, CALLED, AND NOTHING ELSE.
 *
 * Every gate — the master switch, the Ministry entitlement, STOP, the US-only
 * destination and the monthly segment meter — is inside `sendTenantSms`. This
 * function adds no gate of its own and skips none: it decides only whether
 * there is a number to send TO, and then records what came back.
 *
 * ⚠️ `recipient_opted_out` IS RECORDED AS `opted_out` RATHER THAN AS A FAILURE,
 * and that distinction is load-bearing. `reminderDue` will not retry a channel
 * that never delivered, and an admin reading the panel must be able to tell "we
 * chose not to send, because they asked us to stop" from "it broke" — the same
 * distinction `statusForCode` draws for `smsLogs`.
 */
async function sendOneSms(
  tenantId: string,
  phone: string | null,
  body: string,
): Promise<{ outcome: ChannelOutcome; segments: number }> {
  if (!phone || !phone.trim()) return { outcome: 'unavailable', segments: 0 };
  const result = await sendTenantSms(tenantId, phone.trim(), body);
  if (result.ok) return { outcome: 'sent', segments: result.segments ?? 1 };
  if (result.code === 'recipient_opted_out') return { outcome: 'opted_out', segments: 0 };
  // 🔴 A tenant without the Ministry plan, a tenant with no number, and the
  // master switch are all `unavailable` rather than `failed`: nothing is wrong,
  // this church simply does not have SMS, and the email carries the invitation.
  if (
    result.code === 'plan_not_entitled'
    || result.code === 'no_number'
    || result.code === 'feature_hidden'
    || result.code === 'non_us_destination'
    || result.code === 'invalid_destination'
  ) {
    return { outcome: 'unavailable', segments: 0 };
  }
  return { outcome: 'failed', segments: 0 };
}

/**
 * 🔴 THE EMAIL HALF — RESEND, THROUGH THE ONE TRANSACTIONAL FUNNEL (THE-340).
 *
 * ⚠️ THIS REPLACED THE CHURCH'S OWN GMAIL, AND THE REPLACEMENT IS THE TICKET.
 * The note at the head of this file used to end "a church whose admin has not
 * connected Gmail gets `unavailable` on that channel too". With SMS hidden by
 * THE-335 that sentence had stopped describing a degraded feature and started
 * describing a BROKEN one: email was the only channel left, so a church that
 * had not completed an OAuth grant could not tell a single volunteer they were
 * on. And the grant Harvest was asking them to complete goes through Google's
 * "this app isn't verified" interstitial, because the OAuth app is unverified
 * and capped at 100 users. The fix on offer was a security warning.
 *
 * 🔴 SO THE DEPENDENCY IS GONE RATHER THAN DEMOTED. Resend does not REPLACE
 * Gmail as the default with Gmail kept behind a check — it is the only email
 * path this feature has. Keeping the Composio branch as an option when
 * connected would have preserved one real benefit (mail from the church's own
 * address reads as more trustworthy to a volunteer deciding whether to click)
 * at the price of keeping the unverified OAuth app on the critical path, and
 * of two send paths where every failure has to be understood twice. Most of
 * that benefit is recovered without the grant: `senderFor` puts the church's
 * name in the display name, so the volunteer still reads their church's name
 * in the inbox, over an address Harvest has verified and can sign for.
 *
 * ⚠️ `from_email` AND ITS REASON ARE GONE WITH THE BRANCH, NOT WORKED AROUND.
 * That parameter existed because Composio resolves a sender by READING the
 * Gmail profile, and Google gates a profile read behind a mailbox scope Harvest
 * deliberately does not hold — so a connection with no recorded address 403'd.
 * Resend sends from a domain Harvest owns, so there is no profile to read, no
 * scope to want, and no `unavailable` for a missing sender address.
 *
 * 🔴 `assertSendOnlyGmailScopes` IS UNTOUCHED AND STILL FAILS CLOSED. It never
 * lived here — it guards the CONNECT route in `api/composio/gmail/connect`,
 * over `lib/gmail-scopes.ts` — and removing a CALLER of a connection does not
 * relax what may be asked for when one is made. Gmail remains connectable for
 * the CRM, under exactly the send-only scopes it was always held to.
 *
 * ⚠️ AN ABSENT ADDRESS IS `unavailable`; EVERYTHING ELSE IS `failed`. That split
 * is the Silent-Failure Rule applied to a transport that is now load-bearing.
 * "This person has no email address on file" is a fact about the church's
 * records, is not an error, and is not something an admin can fix by pressing
 * send again. A rejected send, a network failure, and an unset `RESEND_API_KEY`
 * are all Harvest failing to deliver a message it accepted — and the last of
 * those is exactly the case the other nine Resend call sites treat as a silent
 * skip. An invitation that could not be delivered must not read as an
 * invitation that was never made.
 */
async function sendOneEmail(
  to: string | null,
  subject: string,
  body: string,
  churchName: string,
): Promise<ChannelOutcome> {
  if (!to || !to.trim()) return 'unavailable';
  const result = await sendTransactionalEmail({ to, subject, text: body, churchName });
  if (result.ok) return 'sent';
  console.error('rota invite: Resend send failed:', result.code, result.error);
  return 'failed';
}

/**
 * 🔴 CREATE (OR REFRESH) ONE INVITATION AND SEND IT. THE WHOLE OF "AN
 *    ASSIGNMENT PRODUCES AN INVITATION".
 *
 * ⚠️ THE DOCUMENT IS WRITTEN BEFORE ANYTHING IS SENT, AND THAT ORDER IS
 * DELIBERATE. A message carries a link; a link that resolves to no document is
 * a dead end the volunteer cannot report. Writing first means the worst case is
 * an invitation nobody was told about — which the admin SEES, as `uninvited` on
 * the warning list — rather than a message nobody can answer.
 *
 * ⚠️ IDEMPOTENT ON THE ASSIGNMENT, NOT ON THE PRESS. The id is
 * `${planId}__${itemId}`, so re-inviting the same slot rewrites one document
 * rather than minting a second. 🔴 THE TOKEN IS PRESERVED when the person has
 * not changed, so a link already in somebody's messages keeps working; it is
 * REGENERATED when the person has, so the previous holder's link stops
 * answering for the new one.
 */
export async function sendInvitation(
  tenantId: string,
  assignment: AssignmentToInvite,
  contact: PersonContact,
  churchName: string,
  kind: 'invite' | 'reminder',
): Promise<SendReport> {
  const id = invitationId(assignment.planId, assignment.itemId);
  const ref = rotaInvitationsRef(tenantId).doc(id);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists
    ? readInvitation(id, existingSnap.data() as Record<string, unknown>)
    : null;
  const keepToken =
    existing !== null
    && existing.personId === assignment.personId
    && typeof (existingSnap.data() as Record<string, unknown>).token === 'string'
    && isRotaToken((existingSnap.data() as Record<string, unknown>).token);
  const token = keepToken
    ? ((existingSnap.data() as Record<string, unknown>).token as string)
    : newRotaToken();

  const url = buildRotaAcceptUrl(tenantId, token);
  const message = invitationMessage(
    {
      personName: assignment.personName,
      eventTitle: assignment.eventTitle,
      itemTitle: assignment.itemTitle,
      startsAt: assignment.startsAt,
    },
    url,
    churchName,
    kind,
  );

  // 🔴 The record first. See the note above.
  const isReminder = kind === 'reminder' && existing !== null;
  await ref.set(
    {
      tenantId,
      planId: assignment.planId,
      itemId: assignment.itemId,
      eventId: assignment.eventId,
      personId: assignment.personId,
      personName: assignment.personName,
      eventTitle: assignment.eventTitle,
      itemTitle: assignment.itemTitle,
      // 🔴 A `Timestamp`, never an ISO string. One representation, for ever.
      startsAt: Timestamp.fromDate(assignment.startsAt),
      token,
      // Re-inviting a slot whose person changed starts the answer over; a
      // reminder never resets an answer that has already been given.
      ...(isReminder
        ? {}
        : { status: 'invited', respondedAt: null, reminderCount: 0, invitedAt: FieldValue.serverTimestamp() }),
      ...(isReminder
        ? { remindedAt: FieldValue.serverTimestamp(), reminderCount: FieldValue.increment(1) }
        : { remindedAt: null }),
    },
    { merge: true },
  );

  const email = await sendOneEmail(
    contact.email,
    message.emailSubject,
    message.emailBody,
    churchName,
  );
  const sms = await sendOneSms(tenantId, contact.phone, message.smsText);
  const channels: InvitationChannels = { email, sms: sms.outcome };

  await ref.set({ channels }, { merge: true });

  return {
    invitationId: id,
    token,
    url,
    channels,
    delivered: email === 'sent' || sms.outcome === 'sent',
    smsSegments: sms.segments,
  };
}

/**
 * 🔴 RECORD AN ANSWER. THE ONE WRITE AN UNAUTHENTICATED CALLER CAN CAUSE.
 *
 * ⚠️ EVERYTHING IT MAY TOUCH IS NAMED, AND IT IS THREE FIELDS. A holder of the
 * token can set `status` to one of two values and stamp `respondedAt`. It
 * cannot move the date, rename the item, reassign the person, mint a token, or
 * reach any other document — because those fields are not in this write and
 * there is no other write on the public path. That is what bounds the risk the
 * bearer token carries: the worst an unauthorised holder can do is answer one
 * slot wrongly, which the admin sees on the rota and corrects by re-inviting.
 *
 * ⚠️ A PAST SERVICE IS NOT ANSWERABLE. Accepting last Sunday changes nothing
 * real and would quietly clear a slot off the warning list after the fact.
 *
 * 🔴 AND `reminderCount` IS NOT RESET. A volunteer who declines and is re-asked
 * must not become eligible for another charged reminder by answering.
 */
export async function recordResponse(
  tenantId: string,
  token: unknown,
  status: 'accepted' | 'declined',
  now: Date,
): Promise<RotaInvitation | null> {
  const invitation = await findByToken(tenantId, token);
  if (!invitation) return null;
  if (invitation.startsAt.getTime() <= now.getTime()) return null;
  await rotaInvitationsRef(tenantId).doc(invitation.id).set(
    { status, respondedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ...invitation, status, respondedAt: now };
}

/** The cap a caller may not exceed in one press. Named so the route and the panel agree. */
export const MAX_SENDS_PER_REQUEST = 40;

export { MAX_REMINDERS };
