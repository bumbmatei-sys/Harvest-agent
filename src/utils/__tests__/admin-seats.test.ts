import { describe, it, expect } from 'vitest';
import {
  UNLIMITED,
  resolveAdminLimit,
  isBillableAdminSeat,
  countAdminSeats,
  isAtAdminLimit,
  adminLimitMessage,
  wouldSpendNewSeat,
} from '../admin-seats';
import { PLAN_ORDER, getPlanFeatures, PLAN_PRICING } from '../plan-features';
import { SUPER_ADMIN_EMAILS } from '../super-admins';

/**
 * Pins the maxAdmins seat rule. The counting decisions here are load-bearing:
 * get them wrong and the cap either bills a church for Harvest's own platform
 * access, or is trivially sidestepped by creating permissionless admins.
 */

const admin = (id: string, email = `${id}@church.org`) => ({ id, role: 'admin', email });

describe('resolveAdminLimit — caps come from PLAN_FEATURES, never a literal', () => {
  it('resolves 2 / 5 / 15 across PLAN_ORDER from the matrix itself', () => {
    // Compared against getPlanFeatures rather than hardcoded, so a matrix change
    // moves this test with it instead of leaving a stale literal behind.
    expect(PLAN_ORDER.map((p) => resolveAdminLimit(p))).toEqual(
      PLAN_ORDER.map((p) => getPlanFeatures(p).maxAdmins)
    );
    // And the published numbers really are 2 / 5 / 15 today.
    expect(PLAN_ORDER.map((p) => resolveAdminLimit(p))).toEqual([2, 5, 15]);
  });

  it('fails closed to Individual (2) on an unknown, null or still-loading plan', () => {
    expect(resolveAdminLimit(undefined)).toBe(getPlanFeatures('plus').maxAdmins);
    expect(resolveAdminLimit(null)).toBe(getPlanFeatures('plus').maxAdmins);
    expect(resolveAdminLimit('ultra')).toBe(getPlanFeatures('plus').maxAdmins);
    expect(resolveAdminLimit('')).toBe(getPlanFeatures('plus').maxAdmins);
  });
});

describe('isBillableAdminSeat — what counts as a purchased seat', () => {
  it('super admins never count, by role', () => {
    expect(isBillableAdminSeat({ role: 'super_admin', email: 'staff@harvest.dev' })).toBe(false);
  });

  it('super admins never count, by email — EVERY address on the frozen list', () => {
    // The Roles list only upgrades a row's displayed role from SUPER_ADMIN_EMAILS[0],
    // so a second platform owner can appear carrying role 'admin'. Counting that
    // row would charge a church for Harvest's own access to their instance.
    for (const email of SUPER_ADMIN_EMAILS) {
      expect(isBillableAdminSeat({ role: 'admin', email })).toBe(false);
    }
    expect(SUPER_ADMIN_EMAILS.length).toBeGreaterThan(1);
  });

  it('matches the super-admin email case-insensitively', () => {
    expect(isBillableAdminSeat({ role: 'admin', email: SUPER_ADMIN_EMAILS[0].toUpperCase() })).toBe(false);
  });

  it('an admin with no permissions assigned DOES count', () => {
    // role: 'admin' is what mints the admin custom claim and what
    // firestore.rules keys off; permissions only narrow what they may do.
    expect(isBillableAdminSeat({ role: 'admin', email: 'volunteer@church.org' })).toBe(true);
  });

  it('the plan owner DOES count — they are an ordinary role:admin row', () => {
    expect(isBillableAdminSeat({ role: 'admin', email: 'pastor@church.org' })).toBe(true);
  });

  it('plain members do not count', () => {
    expect(isBillableAdminSeat({ role: 'user', email: 'member@church.org' })).toBe(false);
  });
});

describe('countAdminSeats', () => {
  it('excludes a super admin present in the tenant', () => {
    const rows = [
      admin('owner'),
      admin('volunteer'),
      { id: 'staff', role: 'super_admin', email: SUPER_ADMIN_EMAILS[0] },
    ];
    expect(countAdminSeats(rows)).toBe(2);
  });

  it('counts the owner and a permissionless admin, and ignores members', () => {
    const rows = [
      admin('owner'),
      admin('no-perms'),
      { id: 'member', role: 'user', email: 'm@church.org' },
    ];
    expect(countAdminSeats(rows)).toBe(2);
  });

  it('is 0 for an empty roster', () => {
    expect(countAdminSeats([])).toBe(0);
  });
});

describe('isAtAdminLimit', () => {
  it('is false below the cap and true at it', () => {
    expect(isAtAdminLimit(1, 2)).toBe(false);
    expect(isAtAdminLimit(2, 2)).toBe(true);
  });

  it('is true when already OVER the cap — which blocks the next promotion only', () => {
    // Nothing anywhere in this module removes or demotes an existing admin.
    expect(isAtAdminLimit(6, 2)).toBe(true);
  });

  it('treats -1 as unlimited', () => {
    expect(isAtAdminLimit(9_999, UNLIMITED)).toBe(false);
  });
});

describe('adminLimitMessage — copy contract', () => {
  const every = PLAN_ORDER.map((p) => adminLimitMessage(getPlanFeatures(p).maxAdmins));

  it('names no price and offers no seat add-on', () => {
    // Extra seats are decided but UNBUILT. Advertising a purchase that does not
    // exist is the failure this repo has already shipped four times.
    for (const msg of every) {
      expect(msg).not.toMatch(/\$|\bUSD\b|\/mo\b|per month|price|pricing/i);
      expect(msg).not.toMatch(/add[- ]?on|extra seat|buy|purchase|checkout|seat pack/i);
      // No plan price may appear as a bare number either.
      for (const { monthlyUsd, yearlyUsd } of Object.values(PLAN_PRICING)) {
        expect(msg).not.toContain(String(monthlyUsd));
        expect(msg).not.toContain(String(yearlyUsd));
      }
    }
  });

  it('points at upgrading the plan, which is a thing that exists', () => {
    for (const msg of every) expect(msg).toMatch(/upgrade your plan/i);
  });

  it('states the cap and that the owner consumes a seat', () => {
    expect(adminLimitMessage(2)).toContain('up to 2 admins');
    expect(adminLimitMessage(2)).toMatch(/owner counts as one/i);
    expect(adminLimitMessage(1)).toContain('up to 1 admin');
  });
});

describe('wouldSpendNewSeat', () => {
  const roster = [admin('owner'), admin('volunteer'), { id: 'staff', role: 'super_admin', email: SUPER_ADMIN_EMAILS[0] }];

  it('is false for someone already counted — editing is not a promotion', () => {
    expect(wouldSpendNewSeat(roster, 'volunteer')).toBe(false);
  });

  it('is true for a member being promoted', () => {
    expect(wouldSpendNewSeat(roster, 'member-1')).toBe(true);
  });

  it('is true for a super admin, who occupies no seat to reuse', () => {
    expect(wouldSpendNewSeat(roster, 'staff')).toBe(true);
  });
});
