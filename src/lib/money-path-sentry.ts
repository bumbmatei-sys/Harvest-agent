import * as Sentry from '@sentry/nextjs';

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
}

export function captureHandledError(error: unknown, capture: HandledCapture): void {
  try {
    const { step, level = 'error' } = capture;

    Sentry.captureException(error, {
      level,
      tags: { handled_path: 'true', step },
      contexts: { handled_path: buildDetails(capture) },
    });
  } catch {
    // Observability must never alter the path it observes.
  }
}
