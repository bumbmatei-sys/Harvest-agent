import { describe, it, expect } from 'vitest';
import { REDACTED, scrub, scrubBreadcrumb, scrubEvent, scrubString } from './sentry-scrub';

describe('sentry-scrub — structured donor PII', () => {
  it('redacts donorEmail from a synthetic event before send', () => {
    const event = {
      event_id: 'abc123',
      message: 'checkout failed',
      extra: { donorEmail: 'jane.donor@example.com', tenantId: 'harvest' },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.extra.donorEmail).toBe(REDACTED);
    expect(JSON.stringify(scrubbed)).not.toContain('jane.donor@example.com');
    // Non-PII context survives, so the event is still diagnosable.
    expect(scrubbed.extra.tenantId).toBe('harvest');
    expect(scrubbed.event_id).toBe('abc123');
  });

  it('redacts every required key, nested at any depth', () => {
    const event = {
      contexts: {
        donation: {
          donorEmail: 'a@b.com',
          donorName: 'Jane Donor',
          donorPhone: '+15551234567',
          recipientEmail: 'c@d.com',
          recipientName: 'John Recipient',
          email: 'e@f.com',
          phone: '5559876543',
          amount: 5000,
          pledgeAmount: 25000,
          donationAmount: 100,
          amount_total: 7500,
        },
      },
    };

    const donation = scrubEvent(event).contexts.donation as Record<string, unknown>;

    for (const key of Object.keys(event.contexts.donation)) {
      expect(donation[key], `${key} should be redacted`).toBe(REDACTED);
    }
  });

  it('redacts inside arrays', () => {
    const donors: Record<string, unknown>[] = [
      { donorEmail: 'a@b.com', tenantId: 'harvest' },
      { donorName: 'Jane' },
    ];

    const scrubbed = scrub({ donors });

    expect(scrubbed.donors[0].donorEmail).toBe(REDACTED);
    expect(scrubbed.donors[0].tenantId).toBe('harvest');
    expect(scrubbed.donors[1].donorName).toBe(REDACTED);
  });

  it('does not mutate the object it was given', () => {
    const event = { extra: { donorEmail: 'a@b.com' } };
    scrubEvent(event);

    expect(event.extra.donorEmail).toBe('a@b.com');
  });
});

describe('sentry-scrub — PII flattened into strings', () => {
  // The webhook logs metadata objects wholesale
  // (src/app/api/stripe/webhook/route.ts). The console integration serializes
  // those arguments into breadcrumb.message, so key-based recursion alone would
  // miss them.
  it('redacts donor fields from a serialized console breadcrumb', () => {
    const breadcrumb = {
      category: 'console',
      level: 'error',
      message:
        "event_registration webhook: missing metadata { donorEmail: 'jane.donor@example.com', " +
        "donorName: 'Jane Donor', tenantId: 'harvest', amount: 5000 }",
    };

    const scrubbed = scrubBreadcrumb(breadcrumb);

    expect(scrubbed.message).not.toContain('jane.donor@example.com');
    expect(scrubbed.message).not.toContain('Jane Donor');
    expect(scrubbed.message).not.toContain('5000');
    // The diagnostic part of the log line is preserved.
    expect(scrubbed.message).toContain('event_registration webhook: missing metadata');
    expect(scrubbed.message).toContain('harvest');
  });

  it('handles JSON, bare, and quoted assignment shapes', () => {
    expect(scrubString('{"donorEmail":"a@b.com"}')).not.toContain('a@b.com');
    expect(scrubString('donorEmail=a@b.com')).not.toContain('a@b.com');
    expect(scrubString("donorPhone: '+15551234567'")).not.toContain('+15551234567');
    expect(scrubString('pledgeAmount: 25000')).not.toContain('25000');
  });

  it('redacts a bare email address with no key attached', () => {
    const scrubbed = scrubEvent({
      exception: {
        values: [{ type: 'Error', value: 'no pledge found for jane.donor@example.com' }],
      },
    });

    expect(scrubbed.exception.values[0].value).not.toContain('jane.donor@example.com');
    expect(scrubbed.exception.values[0].value).toContain('no pledge found for');
  });
});

describe('sentry-scrub — stack traces stay readable', () => {
  it('leaves error types, function names and file paths intact', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'Cannot read properties of undefined',
            stacktrace: {
              frames: [
                {
                  filename: 'app:///src/app/api/stripe/webhook/route.ts',
                  abs_path: '/var/task/src/app/api/stripe/webhook/route.ts',
                  function: 'finalizeEventRegistration',
                  module: '@sentry/nextjs',
                  lineno: 271,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    };

    const frame = scrubEvent(event).exception.values[0].stacktrace.frames[0];

    expect(frame.filename).toBe('app:///src/app/api/stripe/webhook/route.ts');
    expect(frame.abs_path).toBe('/var/task/src/app/api/stripe/webhook/route.ts');
    expect(frame.function).toBe('finalizeEventRegistration');
    expect(frame.module).toBe('@sentry/nextjs');
    expect(frame.lineno).toBe(271);
    expect(frame.in_app).toBe(true);
    expect(scrubEvent(event).exception.values[0].type).toBe('TypeError');
  });

  it('does not redact a bare `name` key, which every Error carries', () => {
    const scrubbed = scrub({ name: 'TypeError', tenantName: 'Harvest Church' });

    expect(scrubbed.name).toBe('TypeError');
    // Organisation names are not donor PII and stay readable.
    expect(scrubbed.tenantName).toBe('Harvest Church');
  });
});

describe('sentry-scrub — robustness', () => {
  it('survives circular references', () => {
    const node: Record<string, unknown> = { donorEmail: 'a@b.com' };
    node.self = node;

    const scrubbed = scrub(node) as Record<string, unknown>;

    expect(scrubbed.donorEmail).toBe(REDACTED);
  });

  it('passes through primitives and null', () => {
    expect(scrub({ a: 1, b: true, c: null, d: undefined })).toEqual({
      a: 1,
      b: true,
      c: null,
      d: undefined,
    });
  });
});
