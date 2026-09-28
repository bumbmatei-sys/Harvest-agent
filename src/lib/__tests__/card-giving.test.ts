import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCardGivingOn } from '../card-giving';

/**
 * The card-form gate. Same expression as `hasStripeGiving` in MainApp.tsx:255.
 */
const flag = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/lib/stripe-connect-feature', () => ({
  get STRIPE_CONNECT_ENABLED() { return flag.enabled; },
}));

describe('isCardGivingOn', () => {
  beforeEach(() => { flag.enabled = false; });

  it('is false for every tenant while the switch is off', () => {
    expect(isCardGivingOn({ isMainSite: true, stripeConnectStatus: 'active' })).toBe(false);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: 'active' })).toBe(false);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: undefined })).toBe(false);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: null })).toBe(false);
  });

  it('matches MainApp.tsx:255 once the switch is on', () => {
    flag.enabled = true;
    expect(isCardGivingOn({ isMainSite: true, stripeConnectStatus: 'pending' })).toBe(true);
    expect(isCardGivingOn({ isMainSite: true, stripeConnectStatus: undefined })).toBe(true);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: 'active' })).toBe(true);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: 'pending' })).toBe(false);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: 'restricted' })).toBe(false);
    expect(isCardGivingOn({ isMainSite: false, stripeConnectStatus: null })).toBe(false);
  });
});
