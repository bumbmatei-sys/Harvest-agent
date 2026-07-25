import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

const { captureMoneyPathError } = await import('../money-path-sentry');

/** The single captureContext the helper passed to Sentry. */
function lastContext(): any {
  return mockCaptureException.mock.calls.at(-1)![1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('captureMoneyPathError — shape', () => {
  it('tags the step and marks the event as money-path, defaulting to level error', () => {
    const err = new Error('transfer boom');
    captureMoneyPathError(err, { step: 'recurring-affiliate-transfer' });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][0]).toBe(err);
    expect(lastContext()).toEqual(
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({ money_path: 'true', step: 'recurring-affiliate-transfer' }),
      }),
    );
  });

  it('honours an explicit warning level', () => {
    captureMoneyPathError(new Error('x'), { step: 'affiliate-commission-sweep', level: 'warning' });
    expect(lastContext().level).toBe('warning');
  });

  it('puts the Stripe event type on a tag as well as in context, for alert filtering', () => {
    captureMoneyPathError(new Error('x'), {
      step: 'dispute-charge-lookup',
      eventId: 'evt_1',
      eventType: 'charge.dispute.created',
    });

    const ctx = lastContext();
    expect(ctx.tags.stripe_event_type).toBe('charge.dispute.created');
    expect(ctx.contexts.money_path).toEqual({
      step: 'dispute-charge-lookup',
      stripeEventId: 'evt_1',
      stripeEventType: 'charge.dispute.created',
    });
  });

  it('carries the identifiers needed to find the record and drops empty ones', () => {
    captureMoneyPathError(new Error('x'), {
      step: 'recurring-affiliate-transfer',
      tenantId: 't1',
      eventId: 'evt_9',
      eventType: 'invoice.payment_succeeded',
      ids: { invoiceId: 'in_1', referrerId: 'ref1', subscriptionId: undefined, transferId: '' },
    });

    expect(lastContext().contexts.money_path).toEqual({
      step: 'recurring-affiliate-transfer',
      tenantId: 't1',
      stripeEventId: 'evt_9',
      stripeEventType: 'invoice.payment_succeeded',
      invoiceId: 'in_1',
      referrerId: 'ref1',
    });
  });
});

describe('captureMoneyPathError — must never disturb the path it observes', () => {
  it('swallows a throwing Sentry SDK rather than propagating', () => {
    mockCaptureException.mockImplementationOnce(() => {
      throw new Error('sentry is down');
    });
    expect(() => captureMoneyPathError(new Error('x'), { step: 'stripe-webhook-handler' })).not.toThrow();
  });

  it('returns undefined so no call site can accidentally branch on it', () => {
    expect(captureMoneyPathError(new Error('x'), { step: 'stripe-donate' })).toBeUndefined();
  });
});

describe('captureMoneyPathError — donor PII', () => {
  it('exposes no field for donor identity or money: only step, level, tags and id context', () => {
    // The helper's whole surface is `step`, `level`, `tenantId`, `eventId`,
    // `eventType` and an `ids` bag. There is no `extra`/`user` passthrough, so a
    // call site cannot attach a donor email, name, phone or amount even by mistake.
    captureMoneyPathError(new Error('x'), {
      step: 'stripe-webhook-handler',
      tenantId: 't1',
      eventId: 'evt_1',
      eventType: 'payment_intent.succeeded',
      ids: { invoiceId: 'in_1' },
    });

    const ctx = lastContext();
    expect(Object.keys(ctx).sort()).toEqual(['contexts', 'level', 'tags']);
    expect(ctx.extra).toBeUndefined();
    expect(ctx.user).toBeUndefined();

    const serialized = JSON.stringify(ctx).toLowerCase();
    for (const banned of ['email', 'donorname', 'phone', 'amount']) {
      expect(serialized).not.toContain(banned);
    }
  });
});
