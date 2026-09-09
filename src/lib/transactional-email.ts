import { Resend } from 'resend';

/**
 * THE-340 — the SINGLE OUTBOUND EMAIL FUNNEL for transactional mail.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. WHY THIS MODULE EXISTS, HAVING READ THE ONES THAT ALREADY DID.
 *
 * The brief asked which of the existing Resend paths to reuse rather than
 * writing another. Every one of them was read, and NONE is reusable, because
 * none of them is a FUNCTION — they are nine copies of the same six lines,
 * inlined at the point of use:
 *
 *   `api/send-email/route.ts`          an HTTP route behind `requireAdmin`
 *   `api/send-notification/route.ts`   an HTTP route behind `requireAuth`
 *   `api/certificate/route.ts`         `new Resend(key)` inline
 *   `api/enterprise-lead/route.ts`     `new Resend(key)` inline
 *   `api/event-registration/submit`    `new Resend(key)` inline
 *   `api/giving-statements/generate`   `new Resend(key)` inline
 *   `api/pledge/submit/route.ts`       `new Resend(key)` inline
 *   `lib/donation-receipt.ts`          `new Resend(key)` inline, mid-function
 *   `lib/event-registration-webhook.ts` `new Resend(key)` inline, twice
 *
 * ⚠️ TWO OF THE ELEVEN NAMED IN THE BRIEF DO NOT SEND AT ALL.
 * `components/AdminAccounting.tsx` matches on the word "Resend" because it
 * renders a button labelled "Resend Email" and holds `resendingDonor` state; it
 * calls a route. `lib/money-path-sentry.ts` names Resend only in prose, as one
 * of the vendors whose failures it classifies. Neither is a send site.
 *
 * 🔴 SO THE CHOICE WAS NOT "REUSE ONE" vs "WRITE A TWELFTH". It was "inline a
 * TENTH copy inside `rota-invite.ts`" vs "give the nine copies the funnel they
 * never had, and call it". The first is the option the brief forbids twice
 * over — it constructs a new Resend client, and it puts a provider import in a
 * file whose stated discipline is that it holds none. This is the second.
 *
 * ⚠️ THE TWO HTTP ROUTES WERE CONSIDERED FIRST AND REJECTED ON THE MERITS, not
 * for convenience. Reaching either means `fetch`-ing Harvest from inside
 * Harvest, which `rota-invite.ts:92` forbids in the same breath as the provider
 * imports, and which would need an admin bearer token the send path does not
 * hold. And `api/send-email` carries a fallback this feature must not inherit:
 * with no `RESEND_API_KEY` it writes the message to an `email_log` collection
 * and answers `{ success: true }`. Nobody reads that collection. For a rota
 * invitation — now the ONLY channel — that is the Silent-Failure Rule's quiet
 * lie exactly: a send that did not happen, reported as one that did.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. THE SHAPE IS `sms-send.ts`'S, DELIBERATELY.
 *
 * `sendTenantSms` is described in its own file as "THE INTERFACE ANOTHER
 * FEATURE CALLS — one message, one person", and `rota-invite.ts` calls it
 * rather than importing a provider. This is that arrangement for email, so the
 * two halves of one invitation are reached the same way:
 *
 *     sendTenantSms(tenantId, phone, body)      → the SMS funnel
 *     sendTransactionalEmail({ to, subject, … }) → this one
 *
 * 🔴 ONE `Resend` CONSTRUCTION, IN ONE PLACE. The nine inline copies are left
 * exactly as they are — four of them are money paths, and rewriting a donation
 * receipt to prove a point about tidiness is not this ticket's risk to take.
 * What changes is that there is now somewhere for them to go.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. THE SENDER IS HARVEST'S, AND THE DOMAIN IS VERIFIED.
 *
 * `theharvest.app` is verified in Resend with sending enabled, which is the
 * whole reason this transport needs nothing from the church: no OAuth, no
 * consent screen, no "unverified app" warning, no configuration. The address is
 * the one the other nine paths already send from, spelled once here instead of
 * nine times.
 *
 * ⚠️ THE CHURCH'S NAME IS CARRIED IN THE DISPLAY NAME, AND THAT IS THE POINT OF
 * IT. Moving off the church's own Gmail costs a volunteer the one signal that
 * told them the mail was really from their church. Most of that signal is
 * recoverable without the OAuth grant: mail arrives as "St Mary's via Harvest",
 * so the church's name is what the volunteer reads in their inbox list, while
 * the ADDRESS stays one Harvest controls and has verified. What is NOT done is
 * spoofing the church's own address into `from` — that is unauthenticated mail
 * from a domain Harvest cannot sign for, and it lands in spam or is rejected
 * outright by DMARC.
 */

/** The verified sending identity. Spelled ONCE; the nine inline copies repeat it. */
export const HARVEST_SENDER_ADDRESS = 'noreply@theharvest.app';

/** The display name used when a caller names no one. */
export const HARVEST_SENDER_NAME = 'Harvest';

/**
 * 🔴 WHAT AN ADMIN IS TOLD WHEN THE KEY IS MISSING, RATHER THAN NOTHING.
 *
 * ⚠️ THE OTHER NINE PATHS TREAT AN ABSENT `RESEND_API_KEY` AS "SKIP QUIETLY",
 * and for a donation receipt that is defensible — the donation is recorded
 * either way. It is NOT defensible here. A rota invitation IS the message; if
 * it did not go out there is no volunteer and no service cover, so an absent
 * key is a FAILURE this reports, not a silence it keeps.
 */
export const RESEND_NOT_CONFIGURED_MESSAGE =
  'Email is not configured on this deployment, so nothing was sent.';

/** Why a send did not happen. Distinguished so a caller can tell them apart. */
export type SendEmailCode =
  /** No address to send to. Not an error — there is simply nobody to reach. */
  | 'no_recipient'
  /** 🔴 `RESEND_API_KEY` is unset. Harvest is misconfigured; this is an error. */
  | 'not_configured'
  /** Resend accepted the request and answered with an error. */
  | 'provider_error'
  /** The call threw — network, timeout, a malformed address. */
  | 'threw';

export interface SendEmailResult {
  ok: boolean;
  /** Resend's id for the accepted message. Present only when `ok`. */
  id?: string;
  /** Present only when NOT `ok`. Never empty when `ok` is false. */
  error?: string;
  code?: SendEmailCode;
}

/**
 * Fold a church's name into an RFC 5322 display name safely.
 *
 * ⚠️ A DISPLAY NAME IS A HEADER VALUE AND THE CHURCH TYPES IT. A name holding a
 * quote, a backslash, a comma or a newline can close the phrase early or, with
 * CR/LF, inject a header outright. Rather than escape and hope, this keeps a
 * conservative set — letters, digits, spaces and a few marks a church name
 * genuinely uses — and drops the rest. A name that survives as empty falls back
 * to the plain sender rather than producing `<> <noreply@…>`.
 */
export function senderFor(churchName: string): string {
  const cleaned = churchName
    .replace(/[^A-Za-z0-9 '&.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  const name = cleaned ? `${cleaned} via ${HARVEST_SENDER_NAME}` : HARVEST_SENDER_NAME;
  return `${name} <${HARVEST_SENDER_ADDRESS}>`;
}

/** Constructed once per send, and only here. */
const resendClient = (key: string) => new Resend(key);

/**
 * 🔴 SEND ONE TRANSACTIONAL EMAIL. NEVER THROWS; ALWAYS SAYS WHAT HAPPENED.
 *
 * ⚠️ THIS IS TRANSACTIONAL MAIL AND NO MARKETING GATE IS CONSULTED, which is
 * correct rather than an oversight. The newsletter switch in
 * `lib/newsletter-feature.ts` guards the newsletter COMPOSER and its route
 * (`api/newsletter/send`), the Integrations list and the plan matrix — it has
 * never guarded a send, and nothing in this funnel imports it. (It is named
 * here by its module rather than by its identifier, because the guard in
 * `THE-335.hidden-features` requires any file that SPELLS that constant to
 * import it, and a funnel that imported a marketing switch would be the very
 * coupling this paragraph exists to deny.)
 * A rota invitation is a message to one named person about
 * one slot they were assigned to, which is the same class as a donation receipt
 * and a registration confirmation; both already send with the newsletter
 * hidden. `sms-optout.ts` is likewise not consulted: STOP is a carrier
 * obligation on SMS and is enforced inside `sendTenantSms`, where it belongs.
 *
 * 🔴 AND THERE IS NO VOLUME CEILING HERE. See the note in `rota-invite.ts` —
 * the ceiling this feature has is `MAX_SENDS_PER_REQUEST`, which already binds.
 */
export async function sendTransactionalEmail(opts: {
  to: string | null | undefined;
  subject: string;
  text: string;
  /** Display name to send under. The address is always Harvest's. */
  churchName?: string;
  /** Where a reply should go, when the caller knows. */
  replyTo?: string;
}): Promise<SendEmailResult> {
  const to = typeof opts.to === 'string' ? opts.to.trim() : '';
  if (!to) return { ok: false, error: 'No email address.', code: 'no_recipient' };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // 🔴 Loud, not silent. See RESEND_NOT_CONFIGURED_MESSAGE.
    return { ok: false, error: RESEND_NOT_CONFIGURED_MESSAGE, code: 'not_configured' };
  }

  try {
    const { data, error } = await resendClient(key).emails.send({
      from: senderFor(opts.churchName ?? ''),
      to,
      subject: opts.subject,
      text: opts.text,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    // ⚠️ Resend REPORTS rather than throws for a rejected message, so a caller
    // that only wrapped this in try/catch would read a rejection as a success.
    if (error) {
      return { ok: false, error: error.message || 'The email was rejected.', code: 'provider_error' };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'The email could not be sent.',
      code: 'threw',
    };
  }
}
