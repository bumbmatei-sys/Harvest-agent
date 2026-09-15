import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-169 — a cancelling church keeps the period it has already paid for.
 *
 * ─── 🔴 THE BRIEF'S PREMISE WAS WRONG, AND THIS PINS WHY ─────────────────────
 *
 * The ticket was raised as "the plan drops the MOMENT a church cancels in Dodo's
 * portal — not at the end of the period they have already paid for", costing a
 * church that cancels on the 3rd the 27 days it owns. Neither half is what the
 * code does, and both halves are asserted here rather than argued:
 *
 *  1. 🔴 `plan` IS NEVER DROPPED AT ALL. The terminal handler writes ONE public
 *     field, `status`. `leaves \`plan\` alone` in
 *     `dodo-subscription-lifecycle.test.ts` pins the write; `the archive path
 *     writes no plan` below pins that no second writer has appeared since, which
 *     is the no-regression half (#434, swept by THE-259).
 *  2. 🔴 THE DEFERRAL HAPPENS AT THE PROCESSOR, NOT IN A HARVEST TIMER. Asking
 *     to cancel at period end sends `cancel_at_next_billing_date`, and Dodo
 *     emits `subscription.cancelled` when the subscription ACTUALLY reaches
 *     cancelled. So the event arriving IS period end, and archiving on arrival
 *     is what honours the paid period.
 *
 * ⚠️ The one case that DOES end access the same day is Dodo's other portal
 * option, "Cancel now" — a choice the church makes for itself, next to "Cancel
 * at next billing date", with Harvest not in the loop. That is a processor-side
 * decision, not a Harvest defect, and nothing here can or should override it.
 *
 * ─── Why the seam test and not a mock of the whole flow ──────────────────────
 *
 * The mechanism that preserves paid time is ONE request field. A test that
 * mocked Dodo's response would assert Harvest's own fiction; this asserts the
 * request that actually leaves the process.
 */

const SRC = resolve(__dirname, '../../..');

// Hoisted above the static imports: `config.ts` validates at import time.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'k';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('x').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** The subscription a stubbed read returns, so `cancelSubscription` can finish. */
const SUB_READ = {
  subscription_id: 'sub_1',
  status: 'active',
  next_billing_date: '2026-09-30T00:00:00.000Z',
  cancel_at_next_billing_date: true,
};

async function cancelWith(options: { atPeriodEnd: boolean }) {
  const update = vi.fn(async () => SUB_READ);
  const retrieve = vi.fn(async () => SUB_READ);
  const providerMod = await import('@/lib/dodo/dodo-provider');
  providerMod.__setDodoClientForTests({ subscriptions: { update, retrieve } } as never);
  await providerMod.dodoBillingProvider.cancelSubscription('sub_1', options as never);
  providerMod.__setDodoClientForTests(null);
  return update;
}

describe('THE-169 · a cancelled church keeps access until the period it paid for ends', () => {
  it('cancelling at period end DEFERS at the processor instead of ending access', async () => {
    const update = await cancelWith({ atPeriodEnd: true });

    expect(update).toHaveBeenCalledTimes(1);
    const [subscriptionId, body] = update.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(subscriptionId).toBe('sub_1');
    // 🔴 THE WHOLE MECHANISM. Dodo keeps serving the paid period and cancels at
    // the next billing date on its own.
    expect(body).toEqual({ cancel_at_next_billing_date: true });
    // 🔴 And it must NOT end the subscription outright — that is the mutation
    // that takes the 27 days, and it is a different request body entirely.
    expect(body).not.toHaveProperty('status');
  });

  it('cancelling immediately is a DIFFERENT request, so the two can never be confused', async () => {
    const update = await cancelWith({ atPeriodEnd: false });

    const [, body] = update.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body).toEqual({ status: 'cancelled' });
    expect(body).not.toHaveProperty('cancel_at_next_billing_date');
  });

  it('the archive path writes no `plan` — the webhook is still its single writer', () => {
    // No-regression on #434 (swept by THE-259). Read off the real module rather
    // than re-run the handler: a SECOND writer appearing anywhere in this file is
    // the regression, and a behavioural test of one path would not see it.
    const src = stripComments(readFileSync(resolve(SRC, 'lib/dodo/lifecycle.ts'), 'utf8'));

    // The archive batch's public write, and everything it may contain.
    expect(src).toMatch(/status:\s*TENANT_STATUS_ARCHIVED/);
    // 🔴 Nothing in the lifecycle module may assign `plan` on a tenant doc.
    expect(src, 'the terminal handler has grown a `plan` write').not.toMatch(/\bplan:\s*['"`]/);
  });
});

describe('THE-169 · the church is TOLD when access ends', () => {
  const billing = () =>
    stripComments(readFileSync(resolve(SRC, 'components/BillingAndPayments.tsx'), 'utf8'));

  it('names the end of access instead of a renewal that is not coming', () => {
    const src = billing();
    // 🔴 THE NAMED WORDING. A scheduled cancellation relabels the date card, so
    // the church reads "Access Until 30 September", not "Next Billing".
    expect(src).toContain("'Access Until'");
    expect(src).toContain("'Next Billing'");
    // And the two are selected BY the scheduled-cancellation flag, not by a plan
    // or a status — so the honest label cannot drift onto the wrong subscription.
    expect(src).toMatch(/cancelAtPeriodEnd\s*\?\s*'Access Until'\s*:\s*'Next Billing'/);
  });

  it('says plainly that it cancels, rather than leaving the date to speak for itself', () => {
    expect(billing()).toContain('Cancels at period end');
  });

  it('does NOT quote a next charge for a subscription that is ending', () => {
    // A church that has cancelled must not be shown an amount it will never be
    // charged; the amount is gated on the same flag.
    expect(billing()).toMatch(/!subscription\.cancelAtPeriodEnd\s*&&\s*subscription\.nextAmount\s*!=\s*null/);
  });
});
