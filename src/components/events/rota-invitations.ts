/**
 * THE-324 — invite, accept, remind. Part 3 of 3.
 *
 * Parts 1 (#449) and 2 (#458) put a person on an item and showed that
 * assignment across weeks. Neither told the person. This is the part that does:
 * an invitation per assignment, an accept or a decline, a reminder before the
 * date, and the admin's warning about the slots that are still empty or still
 * unanswered.
 *
 * This module is the whole of that feature that is NOT React, NOT Firestore and
 * NOT a send — for the reason part 1 gave for `service-plan.ts` and part 2
 * repeated for `volunteer-rota.ts`: a rule that lives inside a component can
 * only be re-implemented by whoever comes next, and every question below is one
 * the server route, the admin panel and the public accept page all have to ask.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 PARTS 1 AND 2 ARE NOT TOUCHED, AND THE SHAPE HERE IS WHAT MAKES THAT TRUE.
 *
 * `ServicePlanItem` has seven fields and gains none. An invitation is a SEPARATE
 * record in a SEPARATE collection keyed on `(planId, itemId)` — part 1's own
 * stable pair, which it wrote down as the contract precisely so a later ticket
 * could key on it without changing the item. So:
 *
 *   · no field is added to a persisted plan, so no migration is needed and
 *     stop condition 7 is not reached;
 *   · `findDoubleBookings()` is not called, not wrapped and not edited;
 *   · deleting every invitation in the database leaves parts 1 and 2 working
 *     exactly as they ship today.
 *
 * ⚠️ AN INVITATION IS A RECORD OF WHAT WAS SAID, NOT A VIEW OF THE PLAN. That
 * is why it carries `eventTitle`, `itemTitle`, `personName` and `startsAt` as
 * values rather than resolving them through the plan at read time, and it is
 * the same decision — with the same reason — that part 1 recorded for
 * `personName`: the surface that reads it has no plan to join to. A volunteer
 * opening an accept link is signed out, on a phone, from a text message.
 *
 * 🔴 AND IT IS THE HONEST SHAPE BESIDES. If the service moves an hour later,
 * the volunteer accepted the 10:00 they were told about. Silently rewriting the
 * invitation to say 11:00 would make the record claim they agreed to something
 * nobody ever put to them. The admin re-invites; {@link isStale} is how the
 * panel knows to.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 ONE TIMESTAMP REPRESENTATION, AND IT IS `Timestamp`.
 *
 * `invoices.issuedAt` and `contactActivities.createdAt` each hold BOTH ISO
 * strings and `Timestamp`s, and Firestore sorts across types by TYPE FIRST, so
 * a collection carrying both is unsortable rather than merely untidy. Every
 * date this feature writes goes through `FieldValue.serverTimestamp()` or a
 * `Timestamp`, and nothing in it ever writes `toISOString()`, `Date.now()` or a
 * stringified date into a document. `the-324-guards.test.ts` asserts it by
 * reading the source of every file the ticket adds.
 *
 * ⚠️ This module works in `Date` because it is pure and renders; the boundary
 * that turns a `Timestamp` into one is `readInvitation` in the server module,
 * and it is the only place either type meets the other.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NO `orderBy`, NO COMPOSITE INDEX, AND NO UNORDERED `limit(N)` PASSED OFF
 *    AS "THE RECENT ONES".
 *
 * `firestore.indexes.json` does NOT deploy on merge — `deploy-rules.yml` runs
 * `firestore:rules,storage` only — so an index added there is inert and the
 * query that needed it throws `failed-precondition` in production. The one read
 * this feature makes is an unfiltered list of one small collection with a
 * `limit(N + 1)`, which needs no index at all; the ordering is done in memory
 * here. #405 found 41 files treating an unordered `limit(N)` as the recent
 * rows — this one keeps ALL the rows it reads and uses the extra document only
 * to PROVE whether there were more. See {@link slotVerdict}.
 */
import { itemClockTimes } from './service-plan';
import type { RotaService } from './volunteer-rota';
import { HARVEST_APEX } from '../donations/giving-share';

/**
 * Where an invitation is in its life. Three states, and no fourth.
 *
 * ⚠️ There is deliberately no `expired`. A service that has passed is a fact
 * about the CLOCK, not about the document, and a status that had to be swept
 * would be a second writer of the same truth — and a cron job this ticket has
 * no business adding. {@link isPast} answers it from `startsAt` instead.
 */
export type InvitationStatus = 'invited' | 'accepted' | 'declined';

export const INVITATION_STATUSES: readonly InvitationStatus[] = [
  'invited',
  'accepted',
  'declined',
] as const;

/** How a message reached (or did not reach) somebody. Recorded per channel. */
export type ChannelOutcome =
  /** Delivered. */
  | 'sent'
  /** The tenant's plan has no SMS, or the person has no number/address. */
  | 'unavailable'
  /** 🔴 The person replied STOP. Never retried, on any channel that honours it. */
  | 'opted_out'
  /** The transport refused or failed. */
  | 'failed';

/** What was attempted, and what happened, the last time this person was messaged. */
export interface InvitationChannels {
  email: ChannelOutcome;
  sms: ChannelOutcome;
}

/**
 * One invitation. The persisted shape, with every date already a `Date`.
 *
 * 🔴 EVERY OPTIONAL FIELD IS `| null`, NEVER `undefined` — Firestore rejects an
 * `undefined` value outright, and part 1 carries the same note for the same
 * reason.
 */
export interface RotaInvitation {
  /** `${planId}__${itemId}`. Deterministic — see {@link invitationId}. */
  id: string;
  tenantId: string;
  planId: string;
  itemId: string;
  eventId: string;
  /** A `users/{uid}` — part 1's identity, unchanged. */
  personId: string;
  /** The label AT THE TIME OF INVITING. See the header. */
  personName: string;
  eventTitle: string;
  itemTitle: string;
  /** 🔴 The ITEM's derived clock start, as it was when the invitation was sent. */
  startsAt: Date;
  status: InvitationStatus;
  invitedAt: Date | null;
  remindedAt: Date | null;
  respondedAt: Date | null;
  reminderCount: number;
  channels: InvitationChannels;
}

/**
 * 🔴 THE ID IS DERIVED, NOT GENERATED — ONE INVITATION PER ASSIGNMENT.
 *
 * `addDoc` would mint a fresh id every time an admin pressed Send, so pressing
 * it twice would produce two invitations for one slot, two accept links, and a
 * second charge on Harvest's account for a message the volunteer already had.
 * A deterministic id makes the write a `set(..., { merge: true })` on a
 * document that either exists or does not, which is what makes re-inviting
 * IDEMPOTENT and what lets the accept page find the row without a query.
 *
 * ⚠️ A DOUBLE UNDERSCORE, because part 1's `genItemId()` produces `[a-z0-9]`
 * and a Firestore document id may not contain `/`. A single separator that
 * could occur inside either half would make two different pairs collide.
 */
export const invitationId = (planId: string, itemId: string): string =>
  `${planId}__${itemId}`;

/**
 * A response token: 43 characters of base64url, i.e. 256 bits.
 *
 * 🔴 STORED, NOT SIGNED, AND THAT IS THE DECISION. An HMAC-signed token would
 * need a new secret in the environment — a new deployment dependency this
 * ticket is not allowed to add — and, worse, it would be UNREVOCABLE: a signed
 * token is valid as long as the key is, so a link pasted into a church WhatsApp
 * group could not be withdrawn. A random token that lives ON the invitation is
 * revoked by rewriting one field, and it is checked by finding the document
 * that carries it rather than by trusting arithmetic.
 */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const isRotaToken = (v: unknown): v is string =>
  typeof v === 'string' && TOKEN_RE.test(v);

/**
 * 🔴 THE PATH THE ACCEPT LINK LANDS ON — AND IT LANDS POST-HOP.
 *
 * ⚠️ THE-138: `theharvest.app` → `<tenant>.theharvest.app` ENDS THE FIREBASE
 * SESSION, because a session is per-origin. THE-289 established that anything
 * before that hop is a step the member never finishes. So this path is spelled
 * ONLY under a tenant subdomain — never under the apex — and the URL builder
 * below cannot produce an apex link, because it refuses any host that is not a
 * single label in front of `theharvest.app`.
 *
 * ⚠️ AND IT CARRIES ITS OWN TOKEN BESIDES, so the hop costs the volunteer
 * nothing even in the case the session would have mattered: there is no session
 * to lose. Both halves of stop condition 3 are answered, not one.
 *
 * A REAL ROUTE, resolved server-side from the Host header exactly as `/giving`,
 * `/checkin/[sessionId]`, `/form/[formId]` and `/event/[eventId]` already are.
 * NOT a query parameter on the SPA root: THE-303 paid for that mistake once
 * ("I shared the giving page but its not public. It's bringing me to the auth
 * page"), and an accept link is the same kind of surface.
 */
export const ROTA_RESPOND_PATH = '/rota';

/** A DNS label — what a tenant id has to be to sit in front of the apex. */
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * 🔴 THE ACCEPT LINK, OR NULL. THE-303'S SIX RULES, RE-ASKED OF THE PARSED URL.
 *
 * ⚠️ `giving-share.ts`'s `buildGivingPageUrl` IS NOT REUSED, AND THIS SAYS SO
 * RATHER THAN QUIETLY NOT USING IT. That function builds `GIVING_PATH`; it
 * takes no path and has none to give. Calling it here would mean either adding
 * a parameter to a validator whose entire value is that it has no seam — the
 * property its own header spells out — or emitting a giving URL from a rota,
 * which is worse. So the rules are re-asked here, unchanged and not loosened,
 * and only the APEX is imported, so there is still exactly one spelling of the
 * host in the repo that is checked rather than templated.
 *
 * The rules, all six, on the PARSED url and never on the template that was
 * typed — because a `tenantId` read off a document is untrusted input, and
 * `evil.example/x` concatenated into `https://${id}.theharvest.app` produces a
 * host of `evil.example`:
 *
 *   1. https, and only https
 *   2. no username and no password
 *   3. no port
 *   4. the host ends in `.theharvest.app`
 *   5. exactly ONE label in front of it
 *   6. and the token is a token
 *
 * ⚠️ Rule 6 is this feature's own and is not a loosening of anything: a token
 * that failed `TOKEN_RE` could otherwise carry `../` or a query string into the
 * path. It is checked BEFORE the URL is built, and the built URL is returned as
 * `URL` parsed it.
 */
export function buildRotaAcceptUrl(tenantId: unknown, token: unknown): string | null {
  if (typeof tenantId !== 'string') return null;
  if (!isRotaToken(token)) return null;
  const label = tenantId.trim().toLowerCase();
  if (!label || !DNS_LABEL.test(label)) return null;

  let parsed: URL;
  try {
    parsed = new URL(`https://${label}.${HARVEST_APEX}${ROTA_RESPOND_PATH}/${token}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host.endsWith(`.${HARVEST_APEX}`)) return null;
  if (host.split('.').length !== HARVEST_APEX.split('.').length + 1) return null;
  if (parsed.search || parsed.hash) return null;

  return parsed.toString();
}

/* ═════════════════════════════════════════════════════════════════════════════
   Labels. Locale-independent, for the reason part 1 gave `fmtClock`: two admins
   on two locales must read the same string, and a volunteer comparing a text
   message against a printed sheet must too.
   ═══════════════════════════════════════════════════════════════════════════ */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "Sunday 14 September". The form the ticket's own example uses. */
export const fmtLongDay = (d: Date): string =>
  `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** "10:00". 24-hour and zero-padded, exactly as part 1's `fmtClock`. */
export const fmtTime = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Whether the service this invitation names has already happened. */
export const isPast = (invitation: Pick<RotaInvitation, 'startsAt'>, now: Date): boolean =>
  invitation.startsAt.getTime() <= now.getTime();

/**
 * Whether the plan has moved under an invitation that was already sent.
 *
 * ⚠️ The invitation is NOT rewritten when this is true — see the header. The
 * admin is told, and re-inviting is a deliberate act that costs a message.
 */
export const isStale = (
  invitation: Pick<RotaInvitation, 'startsAt' | 'itemTitle' | 'personId'>,
  current: { startsAt: Date | null; itemTitle: string; personId: string | null },
): boolean =>
  current.personId !== invitation.personId
  || current.itemTitle.trim() !== invitation.itemTitle.trim()
  || current.startsAt === null
  || current.startsAt.getTime() !== invitation.startsAt.getTime();

/* ═════════════════════════════════════════════════════════════════════════════
   🔴 THE MESSAGE. ONE COMPOSER, TWO CHANNELS.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ SMS IS BILLED BY THE SEGMENT — 160 GSM-7 characters, or 153 in a
 * concatenated message — and Harvest RESELLS, so every segment past the first is
 * another charge on Harvest's account for the same message. THE-318 established
 * the numbers: outbound from $0.008/msg, inbound $0.010 on US numbers, plus a
 * $20/mo carrier campaign fee. A reminder to twenty volunteers is twenty
 * charges; a reminder that ran to two segments is forty.
 *
 * So the SMS body is composed to fit ONE segment wherever the church's own
 * names allow it, and {@link smsSegmentsFor} lets the panel SHOW the admin what
 * pressing Send will cost before they press it. It is not a cap — a church with
 * a long name must still be able to send — it is a number on the screen.
 */
export const SMS_SEGMENT_CHARS = 160;
export const SMS_CONCAT_SEGMENT_CHARS = 153;

/** How many segments a body of this length bills as. Never fewer than one. */
export const smsSegmentsFor = (body: string): number => {
  const n = body.length;
  if (n <= SMS_SEGMENT_CHARS) return 1;
  return Math.ceil(n / SMS_CONCAT_SEGMENT_CHARS);
};

/** What a composed message is, before any transport has seen it. */
export interface InvitationMessage {
  /** The SMS body. One segment where the names allow it. */
  smsText: string;
  emailSubject: string;
  /** Plain text — the CRM send path sends `is_html: false`. */
  emailBody: string;
}

/**
 * 🔴 THE MESSAGE, COMPOSED ONCE FOR BOTH CHANNELS.
 *
 * ⚠️ IT NAMES A PERSON, A TIME AND A THING TO DO — AND NEVER A PLACE. THE-283
 * made "never a member alongside a location" a property of the types in this
 * feature's neighbourhood, and part 2 kept it by giving `RotaEvent` no place
 * field at all. This composer takes an invitation, which has no place field
 * either, so there is nothing for it to render even carelessly. A rota names
 * people by necessity; it must not become a directory, and the place is the
 * line between the two.
 *
 * `url` may be null — a tenant id that fails the host rules produces no link
 * rather than a wrong one — and the message then says what to do instead. A
 * message with a broken link is worse than a message with none.
 */
export function invitationMessage(
  invitation: Pick<RotaInvitation, 'personName' | 'eventTitle' | 'itemTitle' | 'startsAt'>,
  url: string | null,
  churchName: string,
  kind: 'invite' | 'reminder' = 'invite',
): InvitationMessage {
  const church = churchName.trim() || 'your church';
  const when = `${fmtLongDay(invitation.startsAt)}, ${fmtTime(invitation.startsAt)}`;
  const what = invitation.itemTitle.trim() || 'a slot';
  const lead = kind === 'reminder' ? 'Reminder: you are on for' : 'You are on for';

  // 🔴 PLAIN ASCII IN THE SMS BODY, AND THAT IS A COST DECISION RATHER THAN A
  // STYLE ONE. A single character outside GSM-7 — an em dash, a curly quote, an
  // accented letter — forces the whole message to UCS-2, where a segment is 70
  // characters instead of 160. Harvest RESELLS, so that is roughly a DOUBLING of
  // the bill for one punctuation mark. The em dash this repo's prose uses
  // everywhere else is spelled `-` here, and only here.
  //
  // ⚠️ THE ITEM TITLE IS NOT TRUNCATED TO FORCE ONE SEGMENT. A church's own
  // words for its own run sheet are the content, and "Welcome and call to wo…"
  // is a worse message than a second segment is a cost. What happens instead is
  // that {@link smsSegmentsFor} prices the real body and the admin sees the
  // number BEFORE pressing send — which is the honest version of the same
  // control.
  const smsText = url
    ? `${lead} ${when} - ${what}. Accept or decline: ${url}`
    : `${lead} ${when} - ${what}. Please reply to ${church} to confirm.`;

  const first = invitation.personName.trim().split(/\s+/)[0] || 'there';
  const emailBody = [
    `Hi ${first},`,
    '',
    `${lead} ${when}.`,
    '',
    `  Service: ${invitation.eventTitle.trim() || 'Service'}`,
    `  You are on: ${what}`,
    `  Starts: ${fmtTime(invitation.startsAt)}`,
    '',
    url
      ? 'Please let us know whether you can make it:'
      : `Please reply to this email to let ${church} know whether you can make it.`,
    ...(url ? [url] : []),
    '',
    `Thank you,`,
    church,
  ].join('\n');

  return {
    smsText,
    emailSubject:
      kind === 'reminder'
        ? `Reminder: you are on ${fmtLongDay(invitation.startsAt)}`
        : `You are on for ${fmtLongDay(invitation.startsAt)}`,
    emailBody,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
   🔴 THE REMINDER, AND WHO DECIDES TO SEND IT.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How close a service has to be before a reminder is due, in days.
 *
 * ⚠️ A NUMBER WITH A REASON. A reminder further out than a week is not a
 * reminder, it is a second invitation; closer than a couple of days and a
 * volunteer who cannot make it has no time to say so and the admin has no time
 * to find somebody else. Five days puts it on the Tuesday for a Sunday, which is
 * when a church's own week planning happens.
 */
export const REMINDER_WINDOW_DAYS = 5;

/** How many reminders one invitation may ever produce. 🔴 ONE. */
export const MAX_REMINDERS = 1;

/**
 * 🔴 WHETHER THIS INVITATION IS DUE A REMINDER. EVERY CLAUSE COSTS MONEY IF IT
 *    IS WRONG IN THE PERMISSIVE DIRECTION.
 *
 * Five conditions, and all five must hold:
 *
 *   1. the service has NOT already happened — reminding somebody about last
 *      Sunday is a charge for nothing;
 *   2. it is inside the window — see above;
 *   3. nobody has answered. 🔴 An ACCEPTED invitation is NOT reminded. That is
 *      the single largest saving here and the most obvious mistake to make: a
 *      church of twenty volunteers who have all said yes would otherwise pay
 *      twenty charges to be told what they already told Harvest;
 *   4. a reminder has not already gone. `MAX_REMINDERS` is 1, and the count is
 *      persisted, so a second press of the button sends nothing;
 *   5. the invitation was actually sent. An invitation whose every channel came
 *      back `unavailable` has nothing to remind ABOUT.
 *
 * ⚠️ AND STOP IS NOT CHECKED HERE, DELIBERATELY. It is checked inside the send
 * funnel, per channel, where it cannot be forgotten — `sendSms` refuses an
 * opted-out number before it reserves a segment, and it is THE-314's funnel
 * that owns that, not this predicate. A STOP test that passed because a pure
 * function happened to filter first would be testing the wrong layer.
 */
export function reminderDue(
  invitation: Pick<
    RotaInvitation,
    'status' | 'startsAt' | 'reminderCount' | 'channels'
  >,
  now: Date,
  windowDays: number = REMINDER_WINDOW_DAYS,
): boolean {
  if (invitation.status !== 'invited') return false;
  if (invitation.reminderCount >= MAX_REMINDERS) return false;
  const ms = invitation.startsAt.getTime() - now.getTime();
  if (ms <= 0) return false;
  if (ms > windowDays * 86_400_000) return false;
  const reached = invitation.channels.email === 'sent' || invitation.channels.sms === 'sent';
  return reached;
}

/* ═════════════════════════════════════════════════════════════════════════════
   🔴 THE UNFILLED-SLOT WARNING — EXACT, PROVABLY COMPLETE, OR NOTHING.
   ═══════════════════════════════════════════════════════════════════════════ */

/** What the reads behind the warning actually returned, as facts. */
export interface SlotReadState {
  /** Either read rejected. */
  failed: boolean;
  /**
   * 🔴 PART 2'S OWN VERDICT ON THE PLAN AND EVENT READS, PASSED THROUGH.
   *
   * ⚠️ The warning is a fold over the SAME services `notServedRecently` folds
   * over, so it inherits the same completeness question and must not answer it
   * a second time — two judgements of one read is how they come to disagree.
   * The panel hands part 2's `recencyVerdict(...).complete` straight in.
   */
  servicesComplete: boolean;
  /** The invitation read came back at its ceiling, so there may be more. */
  invitationsTruncated: boolean;
}

/**
 * 🔴 WHETHER PART 2'S TWO READS PROVE THE **FUTURE** IS FULLY IN HAND.
 *
 * ⚠️ THIS IS NOT `recencyVerdict`, AND THE DIFFERENCE IS THE DIRECTION OF TIME.
 * Part 2 looks BACKWARD over an eight-week window; this looks FORWARD over the
 * planning horizon. `useEvents` orders `startDate` **DESC** and takes
 * `limit(100)`, so a truncated read returns the hundred events FURTHEST in the
 * future and drops the SOONEST ones — the exact opposite of what a backward
 * window loses. A church with 150 future services would get next April and not
 * next Sunday, and a warning list built on that would report every near-term
 * slot as filled because it never saw them.
 *
 * 🔴 SO THE PROOF IS: THE EVENT READ MUST HAVE REACHED BACK PAST **NOW**. If the
 * oldest event returned already starts at or before this moment, then every
 * event from now forward was returned and nothing near-term is missing, however
 * many older ones were dropped. That is a PROOF of completeness over a truncated
 * read, and it is the only shape that makes a forward figure safe.
 *
 * ⚠️ Re-using `recencyVerdict` here would have been the tempting mistake and
 * would be WRONG IN THE PERMISSIVE DIRECTION: its own third clause compares
 * against the window START, which is eight weeks in the past, so a read that
 * only reached back a fortnight would satisfy it while still having dropped
 * this Sunday.
 */
export function servicesCompleteForHorizon(
  read: {
    failed: boolean;
    plansTruncated: boolean;
    eventsTruncated: boolean;
    oldestEventStart: Date | null;
  },
  now: Date,
): boolean {
  if (read.failed) return false;
  if (read.plansTruncated) return false;
  if (!read.eventsTruncated) return true;
  return read.oldestEventStart !== null && read.oldestEventStart.getTime() <= now.getTime();
}

/** Whether a slot figure may be shown at all, and in whose words if not. */
export interface SlotVerdict {
  /** 🔴 A figure ships only when this is true. */
  complete: boolean;
  reason: string | null;
}

/**
 * 🔴 THE JUDGEMENT. "NO UNFILLED SLOTS" WHEN THE READ FAILED IS THE
 *    `Form submissions 0` BUG AGAIN, AND IT IS WORSE THAN SHOWING NOTHING
 *    BECAUSE IT IS INDISTINGUISHABLE FROM AN ANSWER.
 *
 * A church looking at "every slot is filled" would close the screen. So there
 * are three ways this refuses, each returning the sentence the `empty` prints
 * verbatim rather than a bare `false`:
 *
 *   1. a read rejected;
 *   2. the services behind it were not provably complete — a plan not returned
 *      is a service whose empty slots are invisible, which is exactly the
 *      direction that produces a false "none";
 *   3. the invitation read hit its ceiling — an invitation not returned would
 *      make an answered slot read as unanswered, and an admin would send a
 *      charged reminder to somebody who had already replied.
 *
 * ⚠️ Failure 3 is the one that is only pessimistic rather than dangerous, and it
 * still refuses. A warning surface that is right most of the time is a warning
 * surface that gets ignored.
 */
export function slotVerdict(read: SlotReadState): SlotVerdict {
  if (read.failed) {
    return {
      complete: false,
      reason: 'The rota could not be read, so which slots are unfilled cannot be worked out.',
    };
  }
  if (!read.servicesComplete) {
    return {
      complete: false,
      reason: 'The service plans did not all come back, so this would be a guess.',
    };
  }
  if (read.invitationsTruncated) {
    return {
      complete: false,
      reason: 'There are more invitations than one read returns, so who has replied is unknown.',
    };
  }
  return { complete: true, reason: null };
}

/** Why one slot is on the warning list. Three distinct admin actions. */
export type SlotProblem =
  /** Nobody is assigned at all. */
  | 'unfilled'
  /** Somebody is assigned and has never been told. */
  | 'uninvited'
  /** Somebody was told and has not answered. */
  | 'unanswered'
  /** Somebody was told and said no — the slot is open again. */
  | 'declined';

/** One row of the warning. */
export interface SlotWarning {
  key: string;
  problem: SlotProblem;
  /** THE-329: null for a standalone service, which has no event. */
  eventId: string | null;
  eventTitle: string;
  planId: string;
  itemId: string;
  itemTitle: string;
  /** The item's derived clock start. Null only for an undated service. */
  startsAt: Date | null;
  /** Who holds it, for every problem but `unfilled`. */
  personId: string | null;
  personName: string | null;
}

/** 🔴 EMPTY unless `verdict.complete`. Never a partial answer. */
export interface UnfilledReport {
  verdict: SlotVerdict;
  /** How far ahead this looked — shown, so the figure is legible. */
  horizonDays: number;
  warnings: SlotWarning[];
  /** 🔴 The source, named in the type so no surface can describe it wrongly. */
  source: 'servicePlans+rotaInvitations';
}

/** How far ahead the warning looks. Six weeks — part 2's own `ROTA_WEEKS`. */
export const SLOT_HORIZON_DAYS = 42;

/**
 * 🔴 EVERY SLOT THAT NEEDS AN ADMIN — OR NOTHING AT ALL.
 *
 * ⚠️ ONLY FUTURE SERVICES. An empty slot last Sunday is not an action; it is
 * history, and putting it on a warning list is how a warning list stops being
 * read. The horizon's far end is bounded for the mirror-image reason: a church
 * that has planned a year ahead has not FAILED to fill next April.
 *
 * ⚠️ AN UNDATED SERVICE IS SKIPPED, not guessed at. Part 2's `rotaServices`
 * already drops events with no `startDate`, so this is belt and braces on a
 * caller that hands services in by another route.
 *
 * The rows are ordered SOONEST FIRST, in memory, and then by the item's own
 * position within a service — which is the order an admin reads a run sheet in.
 * There is no Firestore ordering anywhere near this.
 */
export function unfilledSlots(
  services: readonly RotaService[],
  invitations: readonly RotaInvitation[],
  read: SlotReadState,
  now: Date,
  horizonDays: number = SLOT_HORIZON_DAYS,
): UnfilledReport {
  const verdict = slotVerdict(read);
  const base = { verdict, horizonDays, source: 'servicePlans+rotaInvitations' as const };
  if (!verdict.complete) return { ...base, warnings: [] };

  const byId = new Map<string, RotaInvitation>();
  for (const invitation of invitations) byId.set(invitation.id, invitation);

  const until = now.getTime() + horizonDays * 86_400_000;
  const warnings: SlotWarning[] = [];

  for (const service of services) {
    if (service.startsAt === null) continue;
    if (service.planId === null) continue;
    const planId = service.planId;

    for (const clock of itemClockTimes(service.items, service.startsAt)) {
      const at = clock.startsAt;
      if (at === null) continue;
      // Only what is still ahead, and only inside the horizon.
      if (at.getTime() <= now.getTime() || at.getTime() > until) continue;

      const item = clock.item;
      const invitation = byId.get(invitationId(planId, item.id)) ?? null;

      let problem: SlotProblem | null = null;
      if (!item.personId) problem = 'unfilled';
      else if (!invitation || invitation.personId !== item.personId) problem = 'uninvited';
      else if (invitation.status === 'declined') problem = 'declined';
      else if (invitation.status === 'invited') problem = 'unanswered';

      if (problem === null) continue;
      warnings.push({
        key: `${planId}:${item.id}`,
        problem,
        eventId: service.eventId,
        eventTitle: service.eventTitle,
        planId,
        itemId: item.id,
        itemTitle: item.title,
        startsAt: at,
        personId: item.personId,
        personName: item.personName,
      });
    }
  }

  warnings.sort(
    (a, b) =>
      ((a.startsAt as Date).getTime() - (b.startsAt as Date).getTime())
      || a.key.localeCompare(b.key),
  );
  return { ...base, warnings };
}

/** The count per problem, for the summary line. Every key always present. */
export const countByProblem = (
  warnings: readonly SlotWarning[],
): Record<SlotProblem, number> => {
  const out: Record<SlotProblem, number> = {
    unfilled: 0, uninvited: 0, unanswered: 0, declined: 0,
  };
  for (const w of warnings) out[w.problem] += 1;
  return out;
};

/* ═════════════════════════════════════════════════════════════════════════════
   🔵 THE VOLUNTEER-FACING VIEW. PART 2 DEFERRED THE DECISION HERE.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔵 IT BELONGS, AND IT IS THE ACCEPT PAGE ITSELF — NOT A TAB IN THE MEMBER APP.
 *
 * Part 2 left this to part 3 by name. The answer, and the reasoning:
 *
 *   · IT DOES NOT BELONG ON "MY EVENTS". Part 2 already said why: My Events
 *     reads `registrations`, and a rota assignment is not a registration — a
 *     volunteer did not sign up for a thing, a rota admin put them on it. Two
 *     different records with two different meanings under one heading is how a
 *     member comes to think declining a slot cancels their ticket.
 *
 *   · AND A NEW SIGNED-IN TAB WOULD NOT BE REACHED. THE-289 established that
 *     anything before the `theharvest.app` → `<tenant>.theharvest.app` hop is a
 *     step the member never finishes, and THE-138 is why: the hop ends the
 *     Firebase session. A volunteer arrives here from a TEXT MESSAGE. Putting
 *     what they have accepted behind a sign-in they would have to do twice
 *     means most of them never see it.
 *
 * 🔴 SO THE VIEW IS THE PAGE THE LINK ALREADY LANDS ON. `/rota/{token}` shows
 * the invitation being answered AND this same person's other upcoming
 * assignments, so "what am I on for" is answered by the link they already have,
 * post-hop, with no account. One surface, no new tab, no new sign-in.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT SHOW, because a bearer token must reveal no
 * more than the person holding it already knows: only THIS person's own rows.
 * No other member is named, no roster is listed, and no place appears anywhere —
 * so the page cannot become the directory THE-283 forbids.
 */
export interface MyAssignments {
  /** The one being answered. */
  current: RotaInvitation;
  /** This person's OTHER upcoming assignments, soonest first. Never anyone else's. */
  upcoming: RotaInvitation[];
}

export function myAssignments(
  current: RotaInvitation,
  all: readonly RotaInvitation[],
  now: Date,
): MyAssignments {
  return {
    current,
    upcoming: all
      .filter(
        (i) =>
          i.personId === current.personId
          && i.id !== current.id
          && i.status !== 'declined'
          && !isPast(i, now),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
  };
}

/** How a status reads to the person it belongs to. */
export const statusLabel = (status: InvitationStatus): string =>
  status === 'accepted' ? 'Accepted' : status === 'declined' ? 'Declined' : 'Awaiting your reply';

/** How a slot problem reads to an admin. */
export const problemLabel = (problem: SlotProblem): string =>
  problem === 'unfilled'
    ? 'Nobody assigned'
    : problem === 'uninvited'
      ? 'Not invited yet'
      : problem === 'declined'
        ? 'Declined — needs somebody else'
        : 'No reply yet';
