import { describe, it, expect, vi } from 'vitest';

// The dispatch chain (provisioning, plan-change) reaches the Dodo catalogue,
// which consumes the validated dodoConfig — so the three required variables must
// exist before those modules load. Hoisted above the imports by vitest, exactly
// as `dodo-webhook-dispatch.test.ts` already does it.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import {
  DODO_SUBSCRIPTION_EVENT_TYPES,
  DODO_HANDLED_EVENT_TYPES,
  isHandledDodoEventType,
} from '../events';
import { DODO_EVENT_HANDLERS, DODO_DURABLE_EVENT_TYPES } from '../webhook-dispatch';

/**
 * THE-171 — what Dodo actually emits on cancellation, and what Harvest does.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The card is a QUESTION, not a bug: "nobody knows whether Dodo emits
 * `subscription.cancelled`". It does. This suite records the answer against the
 * code so the question cannot come back unanswered, and so the DRIFT found while
 * answering it is visible rather than remembered.
 *
 * ─── The source, and why it is a literal here ───────────────────────────────
 *
 * `DOCUMENTED_SUBSCRIPTION_EVENTS` is transcribed from Dodo's published webhook
 * documentation (developer-resources/webhooks/intents/subscription, cross-read
 * against features/subscription's transition table), READ ON 2026-09-15. It is a
 * literal rather than a fetch on purpose: a test that reaches the network fails
 * for reasons that are not about this repository, and a vendor doc that changes
 * SHOULD break a build that encodes assumptions about it — loudly, once, with a
 * diff a human reads.
 *
 * 🔴 NOTHING HERE CHANGES WEBHOOK HANDLING. The card forbids it ("a fix is a
 * separate decision once the answer exists"), so section 3 PINS THE DRIFT AS IT
 * STANDS rather than closing it. That is the honest shape: the list says what is
 * unrecognised today, and adding one of those events becomes a deliberate edit
 * to this file instead of a silent widening.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

/** Dodo's published subscription events, transcribed 2026-09-15. */
const DOCUMENTED_SUBSCRIPTION_EVENTS = [
  'subscription.active',
  'subscription.updated',
  'subscription.past_due',
  'subscription.on_hold',
  'subscription.paused',
  'subscription.unpaused',
  'subscription.renewed',
  'subscription.plan_changed',
  'subscription.update_payment_method',
  'subscription.cancelled',
  'subscription.failed',
  'subscription.expired',
] as const;

/**
 * The events Dodo documents for a subscription ENDING.
 *
 * `cancelled` is cancellation proper — by the merchant or the customer, from the
 * API or the hosted customer portal. `expired` is the term running out. Dodo
 * describes them as distinct transitions and Harvest routes both.
 */
const DOCUMENTED_TERMINAL_EVENTS = ['subscription.cancelled', 'subscription.expired'] as const;

/** A handler slot that was never filled — the table builds these as `() => {}`. */
const isEmptySlot = (fn: unknown) => typeof fn === 'function' && (fn as () => void).length === 0
  && /^\(\s*\)\s*=>\s*\{\s*\}$/.test(Function.prototype.toString.call(fn));

/* ═══ 1 · Dodo emits subscription.cancelled, and Harvest listens ═════════════ */

describe('1 · the documented cancellation events are the ones the handler routes', () => {
  it.each([...DOCUMENTED_TERMINAL_EVENTS])('%s is recognised', (type) => {
    expect(isHandledDodoEventType(type), `${type} is documented but unrecognised`).toBe(true);
  });

  it.each([...DOCUMENTED_TERMINAL_EVENTS])('%s routes to a REAL handler, not an empty slot', (type) => {
    // 🔴 The distinction that matters. Every documented type could be in the
    // recognised table and still do nothing, because the table builds every slot
    // as a no-op and only six are assigned over.
    const handler = DODO_EVENT_HANDLERS[type as keyof typeof DODO_EVENT_HANDLERS];
    expect(handler, `${type} has no handler at all`).toBeTypeOf('function');
    expect(isEmptySlot(handler), `${type} is routed to the empty default`).toBe(false);
  });

  it('and the two are DISTINCT handlers — cancellation is not folded into expiry', () => {
    expect(DODO_EVENT_HANDLERS['subscription.cancelled'])
      .not.toBe(DODO_EVENT_HANDLERS['subscription.expired']);
  });
});

/* ═══ 2 · Every recognised event is one Dodo documents ═══════════════════════ */

describe('2 · the recognised list invents nothing', () => {
  it("every subscription event Harvest recognises is in Dodo's published list", () => {
    const invented = DODO_SUBSCRIPTION_EVENT_TYPES.filter(
      (t) => !(DOCUMENTED_SUBSCRIPTION_EVENTS as readonly string[]).includes(t),
    );
    expect(invented, 'these are recognised but are not documented by Dodo').toEqual([]);
  });

  it('and no Stripe-shaped event leaked in', () => {
    // The module header warns that the two processors do not have parallel event
    // sets. This is that warning, enforced.
    const stripeShaped = DODO_HANDLED_EVENT_TYPES.filter((t) =>
      /checkout\.session|customer\.subscription|invoice\./.test(t),
    );
    expect(stripeShaped).toEqual([]);
  });
});

/* ═══ 3 · The drift, recorded rather than closed ═════════════════════════════ */

describe('3 · documented events Harvest does NOT recognise', () => {
  /**
   * 🔴 FOUND WHILE ANSWERING THE CARD, AND DELIBERATELY NOT FIXED HERE.
   *
   * Dodo's documentation has grown since `events.ts` was written. Both of these
   * are published today and are not in the recognised table, so they reach
   * `receiveDodoWebhookEvent`, fall past `isHandledDodoEventType`, and are logged
   * and dropped. That is at least LOUD — the dispatcher console.logs the type —
   * but it is not handled.
   *
   * `subscription.past_due` is the consequential one: it is Dodo's own grace
   * window, opened on a failed renewal and carrying `past_due_ends_at`, and
   * Harvest runs a SEPARATE grace timer off `subscription.on_hold`. Two systems
   * counting down the same debt is the exact bug `webhook-dispatch.ts` warns
   * about for `on_hold`, one state earlier. Reported in the pull request; fixing
   * it is a billing decision, not a bundled item.
   */
  const DOCUMENTED_BUT_UNRECOGNISED = ['subscription.past_due', 'subscription.unpaused'] as const;

  it.each([...DOCUMENTED_BUT_UNRECOGNISED])('%s is still unrecognised — pinned, not fixed', (type) => {
    expect(
      isHandledDodoEventType(type),
      `${type} is now recognised — good, but update this list and give it a handler`,
    ).toBe(false);
  });

  it('the unrecognised set is exactly that list — nothing else drifted', () => {
    const missing = DOCUMENTED_SUBSCRIPTION_EVENTS.filter((t) => !isHandledDodoEventType(t));
    expect([...missing].sort()).toEqual([...DOCUMENTED_BUT_UNRECOGNISED].sort());
  });
});

/* ═══ 4 · What happens TODAY when a church cancels ═══════════════════════════ */

describe('4 · cancellation is terminal and immediate, by construction', () => {
  it('cancelled and expired are both routed, so neither lingers unhandled', () => {
    // The card asks: does the plan downgrade, does it linger, or does nothing
    // happen? Neither event is best-effort-into-a-void: both resolve to the
    // lifecycle archive path, which sets the tenant status in one batch.
    for (const type of DOCUMENTED_TERMINAL_EVENTS) {
      expect(DODO_EVENT_HANDLERS[type as keyof typeof DODO_EVENT_HANDLERS].name)
        .toMatch(/^handleDodoSubscription(Cancelled|Expired)$/);
    }
  });

  it('and neither is DURABLE — a terminal event is not worth holding the connection', () => {
    // Pinned because it is the surprising half: only `subscription.active` is
    // durable. A lost cancellation costs a month of entitlement; a lost
    // activation costs a paying customer their account.
    expect([...DODO_DURABLE_EVENT_TYPES]).toEqual(['subscription.active']);
  });
});
