import * as Sentry from '@sentry/nextjs';
import { redactFreeText } from './sentry-scrub';

/**
 * Sentry reporting for *caught* failures.
 *
 * Sentry only sees exceptions that escape. Route handlers across this app catch a
 * great deal on purpose — a sub-step failing must not turn a successful payment
 * into a 500, a Resend outage must not fail a registration — so those failures
 * reach a `console.error` in Vercel logs and nowhere else (several reach nothing
 * at all). This module is how they get reported, and it is deliberately the ONLY
 * thing the instrumentation does: every call site keeps its existing logging, its
 * existing status code, and its existing control flow.
 *
 * TWO ENTRY POINTS, ONE SHAPE:
 *
 *  • `captureMoneyPathError` — money and provisioning. Stripe, Connect, payouts,
 *    subscription/billing mutations. Tagged `money_path: 'true'`.
 *  • `captureHandledError` — everything else. Resend/Twilio/R2/Composio/Gemini
 *    integrations, cron jobs, public submissions. Tagged `handled_path: 'true'`.
 *
 * They are deliberately NOT two abstractions. Both build the SAME flat context
 * (`step`, `tenantId`, then arbitrary identifier keys) through the same private
 * builder, and both put `step` on a tag — so `step:newsletter-send` is the one
 * thing to search on regardless of which surface raised it. The split exists only
 * so `money_path:true` keeps meaning "a payment went wrong", which is what makes
 * it worth alerting on; folding a hundred newsletter failures into that tag would
 * destroy the signal #221 created.
 *
 * The module keeps its original filename because renaming it would mean editing
 * the eight money-path files #221 already instrumented, which are out of scope.
 *
 * Two rules, both load-bearing:
 *
 *  1. **Identifiers only.** Nothing donor-shaped is ever attached — no email,
 *     name, phone, or amount. `src/lib/sentry-scrub.ts` would redact those on
 *     `beforeSend`, but the point is not to hand it anything to redact: a
 *     `tenantId` + Stripe `event.id` + `invoice.id` is enough to find the record
 *     in Stripe or Firestore, and the record is where the donor's details belong.
 *
 *  2. **Never throws.** A reporting fault must not become the failure it was
 *     reporting, so the whole call is wrapped. `captureException` is already
 *     non-throwing when the SDK is uninitialized, but this path runs while a
 *     payment is half-processed and is not the place to rely on that.
 *
 * Grouping is left to Sentry's default (per call site / stack trace), which is
 * what you want here: a Stripe event redelivered five times adds five events to
 * ONE issue rather than opening five. See the PR description for why no explicit
 * fingerprint is set.
 */

/**
 * `error` — money did not move, or moved without a matching record, and nothing
 * will retry it on its own. Needs a human.
 *
 * `warning` — degraded but recoverable: the obligation is durably recorded and an
 * automatic, idempotency-keyed retry exists (the affiliate sweep / hourly cron),
 * or Stripe will redeliver the event.
 */
export type MoneyPathLevel = 'error' | 'warning';

export interface MoneyPathCapture {
  /** Short slug naming the operation that failed, e.g. 'recurring-affiliate-transfer'. */
  step: string;
  /** Defaults to 'error'. See MoneyPathLevel. */
  level?: MoneyPathLevel;
  tenantId?: string | null;
  /** Stripe event envelope — webhook call sites only. */
  eventId?: string | null;
  eventType?: string | null;
  /**
   * Any further identifiers: subscription / invoice / transfer / charge /
   * commission / registration / user ids. IDENTIFIERS ONLY — never a donor
   * email, name, phone, or amount.
   */
  ids?: Record<string, string | null | undefined>;
}

/**
 * Flatten a capture into the context block both entry points share.
 *
 * Falsy ids are dropped rather than sent as null: an absent tenantId is itself
 * often the reason the step failed, and an empty key is just noise. Values are
 * stringified because several call sites read ids straight off an `any`-typed
 * request body or Stripe object — the context stays flat strings rather than
 * smuggling in a whole nested object.
 */
function buildDetails(capture: MoneyPathCapture): Record<string, string> {
  const { step, tenantId, eventId, eventType, ids } = capture;
  const details: Record<string, string> = { step };
  if (tenantId) details.tenantId = String(tenantId);
  if (eventId) details.stripeEventId = String(eventId);
  if (eventType) details.stripeEventType = String(eventType);
  for (const [key, value] of Object.entries(ids || {})) {
    if (value) details[key] = String(value);
  }
  return details;
}

export function captureMoneyPathError(error: unknown, capture: MoneyPathCapture): void {
  try {
    const { step, level = 'error', eventType } = capture;

    Sentry.captureException(error, {
      level,
      tags: {
        money_path: 'true',
        step,
        ...(eventType ? { stripe_event_type: eventType } : {}),
      },
      contexts: { money_path: buildDetails(capture) },
    });
  } catch {
    // Observability must never alter the path it observes.
  }
}

/**
 * A caught failure OUTSIDE the money paths — the Resend/Twilio/R2/Composio/Gemini
 * integrations, the cron jobs, and the public submission endpoints.
 *
 * Same contract as `captureMoneyPathError` in every way that matters: identifiers
 * only (no `extra`, no `user`, so a call site cannot attach a donor email, name or
 * amount even by mistake), never throws, and `step` lands on a tag. The Stripe
 * envelope fields (`eventId` / `eventType`) are not part of this surface — nothing
 * off the money paths has one.
 *
 * Level, same rule as the money helper: `error` when content or a record is lost
 * or two systems now disagree and nothing will reconcile them; `warning` when the
 * outcome is degraded but the thing itself is durably recorded, or a poll/cron
 * will come back around.
 */
export interface HandledCapture {
  /** Short slug naming the operation that failed, e.g. 'newsletter-send'. */
  step: string;
  /** Defaults to 'error'. See MoneyPathLevel. */
  level?: MoneyPathLevel;
  tenantId?: string | null;
  /**
   * Any further identifiers: newsletter / registration / campaign / session /
   * connection ids. IDENTIFIERS ONLY — never an email, name, phone or amount.
   */
  ids?: Record<string, string | null | undefined>;
  /**
   * Bounded free-text diagnostics — the narrow exception to the identifiers-only
   * rule above, and deliberately a separate field so it stays that way.
   *
   * `ids` is for values you can look a record up by. Some failures have no such
   * value: when a model returns a response we cannot parse, the ONLY thing that
   * identifies the fault is the response itself, and a `console.error` of it is
   * unreadable on Vercel. Sending nothing means the next occurrence is as
   * undiagnosable as the last, which is how one bug stayed open for 305 events.
   *
   * Every value is redacted and hard-truncated by `redactFreeText` (see
   * `MAX_DIAGNOSTIC_CHARS`) on the way through, so a call site cannot leak a
   * member's details or blow up the event payload even by passing raw model
   * output straight in. Keep it to diagnostics — never route an identifier here
   * to dodge the `ids` contract.
   */
  diagnostics?: Record<string, string | number | null | undefined>;
}

/**
 * Per-value cap for `diagnostics`. Enough to see the shape of a malformed
 * response — fence, prose preamble, truncation mid-token — without shipping a
 * whole article to a third party.
 */
export const MAX_DIAGNOSTIC_CHARS = 500;

export function captureHandledError(error: unknown, capture: HandledCapture): void {
  try {
    const { step, level = 'error', diagnostics } = capture;

    const details = buildDetails(capture);
    for (const [key, value] of Object.entries(diagnostics || {})) {
      // `0` and `''` are meaningful diagnostics (an empty model response is the
      // whole finding), so only null/undefined are dropped here — unlike `ids`,
      // where a falsy identifier is just noise.
      if (value === null || value === undefined) continue;
      details[key] = redactFreeText(String(value), MAX_DIAGNOSTIC_CHARS);
    }

    Sentry.captureException(error, {
      level,
      tags: { handled_path: 'true', step },
      contexts: { handled_path: details },
    });
  } catch {
    // Observability must never alter the path it observes.
  }
}
