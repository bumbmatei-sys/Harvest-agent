import * as Sentry from '@sentry/nextjs';

/**
 * Sentry reporting for *caught* failures on the money and provisioning paths.
 *
 * Sentry only sees exceptions that escape. The Stripe webhook and the checkout /
 * connect / donate / finish-setup routes catch a great deal on purpose — a
 * sub-step failing must not turn a successful payment into a 500 — so those
 * failures currently reach a `console.error` in Vercel logs and nowhere else
 * (several reach nothing at all). This helper is how they get reported, and it is
 * deliberately the ONLY thing the instrumentation does: every call site keeps its
 * existing logging, its existing status code, and its existing control flow.
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

export function captureMoneyPathError(error: unknown, capture: MoneyPathCapture): void {
  try {
    const { step, level = 'error', tenantId, eventId, eventType, ids } = capture;

    // Falsy ids are dropped rather than sent as null: an absent tenantId is
    // itself often the reason the step failed, and an empty key is just noise.
    // Values are stringified because several call sites read ids straight off an
    // `any`-typed request body or Stripe object — the context stays flat strings
    // rather than smuggling in a whole nested object.
    const details: Record<string, string> = { step };
    if (tenantId) details.tenantId = String(tenantId);
    if (eventId) details.stripeEventId = String(eventId);
    if (eventType) details.stripeEventType = String(eventType);
    for (const [key, value] of Object.entries(ids || {})) {
      if (value) details[key] = String(value);
    }

    Sentry.captureException(error, {
      level,
      tags: {
        money_path: 'true',
        step,
        ...(eventType ? { stripe_event_type: eventType } : {}),
      },
      contexts: { money_path: details },
    });
  } catch {
    // Observability must never alter the path it observes.
  }
}
