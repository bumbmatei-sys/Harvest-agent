import { describe, it, expect, vi } from 'vitest';

/**
 * The automated-SMS trigger list is a promise to the tenant: flipping a toggle
 * here must actually send something. Three triggers were removed because
 * nothing could ever call them — see the comment above TRIGGERS in AdminSms.tsx
 * for why each one needs a feature built before it comes back.
 *
 * Firebase is mocked out only so the component module can be imported for its
 * exported constant; nothing is rendered.
 */
vi.mock('@/firebase', () => ({ db: {}, auth: {}, app: {}, messaging: Promise.resolve(null) }));

const { TRIGGERS } = await import('../AdminSms');

const REMOVED = ['donation_thankyou', 'new_prayer', 'campaign_goal'];

describe('AdminSms automated-SMS trigger list', () => {
  it('offers exactly the three triggers that are wired server-side', () => {
    expect(TRIGGERS.map((t) => t.key)).toEqual([
      'event_registration',  // api/event-registration/submit
      'checkin_thankyou',    // api/checkin/submit
      'pledge_confirmation', // api/pledge/submit
    ]);
  });

  it.each(REMOVED)('no longer offers the unwirable %s trigger', (key) => {
    expect(TRIGGERS.some((t) => t.key === key)).toBe(false);
  });

  it('every listed trigger has a label and a placeholder', () => {
    TRIGGERS.forEach((t) => {
      expect(t.label).toBeTruthy();
      expect(t.placeholder).toBeTruthy();
    });
  });
});
