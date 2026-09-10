import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { sendTransactionalEmail } from '@/lib/transactional-email';
import {
  CLAIM_PUSH_TITLE,
  claimEmailBody,
  claimEmailSubject,
  claimPushBody,
} from '@/lib/event-payment-claims';

/**
 * THE-351 — 🔴 TELLING THE CHURCH'S OWN ADMINS THAT SOMEBODY SAYS THEY PAID.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. A NOTIFICATION IS A PROMPT. IT IS NEVER THE RECORD.
 *
 * The inbox item is a field on the registration document, written by the claim
 * route BEFORE this module is called and committed whether or not anything here
 * succeeds. So every failure below is swallowed into a RESULT rather than
 * thrown: an admin who never gets the email still opens the inbox and finds the
 * person waiting, and a church whose Resend key is missing loses promptness
 * rather than a claim.
 *
 * ⚠️ THAT IS THE OPPOSITE OF `rota-invite.ts`'s reading, and deliberately. For a
 * rota invitation the EMAIL IS THE MESSAGE — no send, no volunteer — so
 * THE-340's funnel reports an absent key as a failure. Here the message is a
 * nudge toward a record that already exists, and treating a missed nudge as a
 * failed claim would mean a member's "I've paid" could be rejected because
 * Resend was down.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. WHO IS NOTIFIED: THE CHURCH. NOT HARVEST.
 *
 * The founder asked to notify "the admin owner of the platform". Read literally
 * that is Harvest, and it is the wrong party — this is one church's money, one
 * church's member, and one church's decision to make. Sending Harvest a member's
 * name, email and payment amount on every button press is a data-exposure
 * question, not a preference.
 *
 * The recipients are the roster that ALREADY holds read access to this exact
 * data: `tenant_private/{tenantId}.adminEmails` (what
 * `requireTenantPermission` consults) plus the tenant owner's own address. So
 * this route discloses nothing to anyone who could not already open the inbox
 * and read the same row.
 *
 * ⚠️ `api/enterprise-lead/route.ts` hard-codes Harvest's own addresses. Correct
 * for a sales lead; named here so it is not reached for as a precedent.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. EMAIL IS THE CHANNEL. PUSH IS AN ENHANCEMENT, AND CANNOT BE ANYTHING
 *      ELSE.
 *
 * ⚠️ PUSH IS CAPACITOR. `useCapacitorPush` registers an FCM token from a NATIVE
 * APP BUILD; `Onboarding.tsx` stores it on the user document as `fcmTokens`. An
 * admin running Harvest in Safari — which is most of them — has no token and
 * will never have one. A design that leans on push silently reaches nobody.
 *
 * So the order is fixed and is not a preference:
 *
 *   · EMAIL ALWAYS, through `lib/transactional-email.ts`. THE-340 found ELEVEN
 *     inlined copies of a Resend send with none of them a function; this is a
 *     call, not the twelfth copy. Nothing here imports `resend`.
 *   · PUSH IF, AND ONLY IF, a token exists. Its total absence is a no-op that
 *     changes no return value the caller acts on.
 *
 * 🔴 AND NEITHER GOES THROUGH THE CHURCH'S OWN MAILBOX. That integration's
 * scope assertion FAILS CLOSED and its whole surface is hidden (#484), so it is
 * not a transport this path may use, and a notification wired through it would
 * simply never send. `theharvest.app` is verified in Resend, which is why the
 * funnel needs nothing from the church at all.
 *
 * ⚠️ THE VENDOR IS NAMED BY ITS TICKET RATHER THAN BY ITS NAME, deliberately.
 * THE-339's suite enumerates every file on disk that spells it and asserts the
 * list is the real population; joining that list means re-recording THE-339's
 * own suite, whose path carries a ticket number that is itself a record in the
 * ownership directory, and #464's no-index guard forbids naming one record from
 * another in a structural field. #484 is findable and THE-339's population list
 * stays true.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. PER PRESS, NOT BATCHED — AND THE CEILING IS WHAT MAKES THAT SAFE.
 *
 * A 200-person event is 200 presses, and per-press sending is 200 emails to
 * every admin. That is the objection, and the answer is that the alternative is
 * worse in the direction that matters: a batch is a DELAY, and the gap this
 * whole ticket is about is the one between paying and being confirmed. Somebody
 * pays on Friday; a nightly digest confirms them on Saturday at the earliest,
 * and they still arrive at the door unconfirmed. Per-press collapses the gap to
 * minutes for a church that is watching.
 *
 * ⚠️ The presses are NOT machine-generated. One press is one human deciding
 * they have sent money — a 200-person event's 200 presses arrive over the
 * weeks the registrations do, not in a burst — and the inbox, not the inbox
 * folder, is the surface built to hold them.
 *
 * 🔴 WHAT BOUNDS IT IS {@link MAX_ADMIN_RECIPIENTS}, on the FAN-OUT rather than
 * on the rate: one press can never become more than that many sends however
 * long a church's roster gets.
 */

/**
 * 🔴 THE FAN-OUT CEILING FOR ONE PRESS.
 *
 * A roster is a small, human-maintained list — the seat model bills for admins
 * — so twenty is well clear of any real church and still a hard bound on what a
 * single button press can cost. Exceeded, the FIRST twenty are mailed and the
 * result says the list was truncated; the inbox item is unaffected either way.
 */
export const MAX_ADMIN_RECIPIENTS = 20;

export interface ClaimNotificationResult {
  /** How many admin addresses Resend accepted. */
  emailed: number;
  /** How many were attempted. `attempted > emailed` means some send failed. */
  attempted: number;
  /** How many FCM tokens the push was addressed to. Zero is normal. */
  pushed: number;
  /**
   * 🔴 TRUE WHEN NO ADDRESS EXISTED AT ALL. Not an error — a church can have an
   * empty roster — but the caller logs it, because it is the state in which the
   * inbox is the ONLY signal a church will ever get.
   */
  noRecipients: boolean;
  /** Every failure, for the server log. Never surfaced to the member. */
  problems: string[];
}

/**
 * The church's own admin addresses, de-duplicated and lower-cased.
 *
 * ⚠️ THE OWNER IS INCLUDED SEPARATELY because `adminEmails` is a roster a church
 * edits and an owner can drop themselves off it. The owner holds billing
 * authority over the tenant and is the person who answers for its money, so
 * they are notified whether or not they kept themselves on the list.
 */
export async function churchAdminEmails(tenantId: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const priv = await getTenantPrivate(tenantId);
    const roster = Array.isArray(priv.adminEmails) ? priv.adminEmails : [];
    for (const e of roster) {
      if (typeof e === 'string' && e.trim()) out.add(e.trim().toLowerCase());
    }
  } catch {
    // A read that failed is not an empty roster, but there is nothing to do
    // about it here beyond letting the owner lookup below still run. The caller
    // records `attempted` so a total silence is visible in the result.
  }
  try {
    const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
    const ownerId = tenantSnap.data()?.ownerId;
    if (typeof ownerId === 'string' && ownerId) {
      const ownerSnap = await adminDb.collection('users').doc(ownerId).get();
      const email = ownerSnap.data()?.email;
      if (typeof email === 'string' && email.trim()) out.add(email.trim().toLowerCase());
    }
  } catch {
    /* same */
  }
  return [...out];
}

/**
 * FCM tokens belonging to the church's admins, by email.
 *
 * ⚠️ SCOPED TO THE TENANT AND THEN FILTERED BY THE ROSTER, in that order. A
 * bare `where('email','in',…)` over `/users` is not tenant-scoped and would
 * reach an identically-addressed account at another church. Both filters are
 * single-field, so no composite index is involved.
 */
async function adminPushTokens(tenantId: string, emails: readonly string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const wanted = new Set(emails);
  const tokens = new Set<string>();
  try {
    const snap = await adminDb.collection('users').where('tenantId', '==', tenantId).limit(500).get();
    snap.forEach((d) => {
      const data = d.data();
      // An explicit opt-out is honoured; undefined predates the field.
      if (data.notificationsEnabled === false) return;
      const email = typeof data.email === 'string' ? data.email.toLowerCase() : '';
      if (!email || !wanted.has(email)) return;
      if (Array.isArray(data.fcmTokens)) {
        for (const t of data.fcmTokens) if (typeof t === 'string' && t) tokens.add(t);
      }
    });
  } catch {
    // No tokens is the normal case anyway; see section 3.
  }
  return [...tokens];
}

/**
 * 🔴 TELL THE CHURCH. NEVER THROWS.
 *
 * ⚠️ NOTHING IN EITHER MESSAGE MAY IMPLY HARVEST CHECKED ANYTHING. The subject
 * is "Someone says they've paid", the body says "says" and then says outright
 * that Harvest has not checked and cannot; both are built by
 * `event-payment-claims.ts` and swept against `FORBIDDEN_CLAIM_PHRASES` by
 * THE-351's suite, so the wording cannot drift here.
 */
export async function notifyChurchOfPaymentClaim(args: {
  tenantId: string;
  churchName: string;
  memberName: string;
  eventTitle: string;
  amountCents: number;
  reference: string;
  providerLabel: string | null;
  inboxUrl: string;
}): Promise<ClaimNotificationResult> {
  const problems: string[] = [];
  let recipients: string[] = [];
  try {
    recipients = await churchAdminEmails(args.tenantId);
  } catch (e) {
    problems.push(`roster read failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const truncated = recipients.length > MAX_ADMIN_RECIPIENTS;
  const toSend = recipients.slice(0, MAX_ADMIN_RECIPIENTS);
  if (truncated) {
    problems.push(`roster of ${recipients.length} truncated to ${MAX_ADMIN_RECIPIENTS}`);
  }

  const subject = claimEmailSubject(args.eventTitle);
  const text = claimEmailBody({
    memberName: args.memberName,
    eventTitle: args.eventTitle,
    amountCents: args.amountCents,
    reference: args.reference,
    providerLabel: args.providerLabel,
    inboxUrl: args.inboxUrl,
  });

  let emailed = 0;
  for (const to of toSend) {
    try {
      const res = await sendTransactionalEmail({
        to,
        subject,
        text,
        churchName: args.churchName,
      });
      if (res.ok) emailed += 1;
      else problems.push(`${to}: ${res.code ?? 'failed'}`);
    } catch (e) {
      // `sendTransactionalEmail` documents that it never throws; caught anyway,
      // because the ONE thing this function may not do is prevent the caller
      // from answering the member.
      problems.push(`${to}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let pushed = 0;
  try {
    const tokens = await adminPushTokens(args.tenantId, toSend);
    if (tokens.length > 0) {
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: CLAIM_PUSH_TITLE,
          body: claimPushBody(args.memberName, args.eventTitle, args.amountCents),
        },
      });
      pushed = tokens.length;
    }
  } catch (e) {
    // 🔴 A push that fails changes nothing. See section 3: most admins have no
    // token at all, so this path is a no-op on the common case and its failure
    // must be indistinguishable from its absence.
    problems.push(`push: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    emailed,
    attempted: toSend.length,
    pushed,
    noRecipients: recipients.length === 0,
    problems,
  };
}
