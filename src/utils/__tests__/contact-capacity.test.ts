import { describe, it, expect } from 'vitest';
import {
  resolveContactLimit,
  isBillableContactAccount,
  countExemptAccounts,
  countContactAccounts,
  isAtContactLimit,
  contactLimitMessage,
  UNLIMITED,
  type CapacityCandidate,
} from '../contact-capacity';
import { PLAN_ORDER, getPlanFeatures } from '../plan-features';
import { SUPER_ADMIN_EMAILS } from '../super-admins';

/**
 * REP-6 — `maxContacts` as a SOFT cap.
 *
 * The two rules that decide whether this cap is safe to ship are both here:
 *
 *   1. It counts ACCOUNTS, never donors. The public donate page needs no
 *      account, so the donation webhook writes a `contacts` row for anyone who
 *      gives — and those rows are what giving statements and year-end tax
 *      receipts are built from. A cap that counted them would charge a church
 *      for its own donors and could withhold records a treasurer needs in
 *      January.
 *   2. Super admins are Harvest staff, not purchased capacity, and they appear
 *      inside tenant user lists. Both legs of "is a super admin" are checked,
 *      because tenant-scope only re-exports the POSITIONAL SUPER_ADMIN_EMAILS[0]
 *      — a second platform owner would otherwise silently eat a church's slot.
 *
 * Everything else is the deliberate absence of an exemption: the owner counts,
 * admins count, permissionless accounts count. Every exemption is a way for the
 * cap to loosen silently, which is worse than no cap.
 */

/** A row for someone who holds a `users` doc. */
const account = (over: Partial<{ role: string; email: string }> = {}): CapacityCandidate => ({
  account: { role: 'user', email: 'member@church.org', ...over },
});

/** A donor-only row: gave via the public donate page, never signed up. */
const donorOnly = (): CapacityCandidate => ({});

const donorRows = (n: number) => Array.from({ length: n }, donorOnly);

describe('resolveContactLimit — the number comes from PLAN_FEATURES', () => {
  // ── 8 ──────────────────────────────────────────────────────────────────────
  it('resolves 150 / 500 / 2,000 for Individual / Small Team / Ministry', () => {
    expect(PLAN_ORDER.map(resolveContactLimit)).toEqual([150, 500, 2_000]);
  });

  it('reads the plan matrix rather than carrying its own copy of the numbers', () => {
    // Pinning the literals above alone would let this module and PLAN_FEATURES
    // drift apart — the stale-price-table shape. This asserts they are the SAME
    // cell, so a repricing can only move both.
    PLAN_ORDER.forEach((plan) => {
      expect(resolveContactLimit(plan)).toBe(getPlanFeatures(plan).maxContacts);
    });
  });

  it('fails CLOSED to Individual (150) when the plan is unknown or still loading', () => {
    // Same fallback maxCourses/maxAdmins/maxChurches use. `undefined` is the
    // loading state TenantContext exposes before tenants/{id} resolves.
    expect(resolveContactLimit(undefined)).toBe(150);
    expect(resolveContactLimit(null)).toBe(150);
    expect(resolveContactLimit('')).toBe(150);
    expect(resolveContactLimit('enterprise-that-does-not-exist')).toBe(150);
  });
});

describe('what spends a contact slot', () => {
  // ── 6 ──────────────────────────────────────────────────────────────────────
  describe('super admins are excluded — both legs', () => {
    it('excludes the role leg (`role: "super_admin"`)', () => {
      expect(isBillableContactAccount({ role: 'super_admin', email: 'staff@harvest.app' })).toBe(false);
    });

    it('excludes the email leg for EVERY listed platform owner, not just the first', () => {
      // tenant-scope re-exports SUPER_ADMIN_EMAILS[0] only, so a SECOND platform
      // owner carrying an ordinary role is indistinguishable from a member to
      // anything reading that positional export — and would consume a church's
      // capacity. isSuperAdminEmail covers the whole frozen list.
      SUPER_ADMIN_EMAILS.forEach((email) => {
        expect(isBillableContactAccount({ role: 'user', email })).toBe(false);
        expect(isBillableContactAccount({ role: 'admin', email })).toBe(false);
      });
      expect(SUPER_ADMIN_EMAILS.length).toBeGreaterThan(1);
    });

    it('does not count a super admin present in the tenant', () => {
      const rows = [
        account({ email: SUPER_ADMIN_EMAILS[0] }),
        account({ email: 'a@church.org' }),
        account({ email: 'b@church.org' }),
      ];
      expect(countExemptAccounts(rows)).toBe(1);
      // The aggregate counted all three `users` docs; capacity spent is two.
      expect(countContactAccounts(3, rows)).toBe(2);
    });

    it('does NOT discount a super admin who is only a donor here (no account)', () => {
      // They have no `users` doc in this tenant, so they were never in
      // `memberAccounts`. Subtracting them would quietly raise the cap by one —
      // exactly the fail-open shape the owner exemption was rejected for.
      const rows: CapacityCandidate[] = [donorOnly(), account({ email: 'a@church.org' })];
      expect(countExemptAccounts(rows)).toBe(0);
      expect(countContactAccounts(1, rows)).toBe(1);
    });
  });

  // ── 7 ──────────────────────────────────────────────────────────────────────
  describe('the owner counts', () => {
    it('counts the plan owner — they hold an account', () => {
      // The owner is created with `role: 'admin'` by the Stripe webhook. There is
      // no owner exemption and deliberately no `ownerId` read: that field is
      // loaded best-effort elsewhere and degrades to null on failure, so an
      // exemption would silently raise the cap by one whenever the read broke.
      expect(isBillableContactAccount({ role: 'admin', email: 'pastor@church.org' })).toBe(true);
      expect(countContactAccounts(1, [account({ role: 'admin', email: 'pastor@church.org' })])).toBe(1);
    });

    it('counts admins — admin seats and contact capacity are separate allowances', () => {
      const rows = [
        account({ role: 'admin', email: 'pastor@church.org' }),
        account({ role: 'admin', email: 'volunteer@church.org' }),
        account({ role: 'user', email: 'member@church.org' }),
      ];
      expect(countExemptAccounts(rows)).toBe(0);
      expect(countContactAccounts(3, rows)).toBe(3);
    });

    it('counts an account with no role field at all', () => {
      expect(isBillableContactAccount({ email: 'member@church.org' })).toBe(true);
      expect(isBillableContactAccount({})).toBe(true);
    });
  });
});

describe('countContactAccounts — accounts only', () => {
  // ── 4 ── THE LOAD-BEARING ONE ──────────────────────────────────────────────
  it('does not count donors without an account: 149 accounts + 500 donor-only rows is UNDER 150', () => {
    // A church that ran a fundraiser has hundreds of `contacts` rows written by
    // the donation webhook for people who never signed up. `memberAccounts` is
    // the `users` aggregate and does not include them, and nothing here adds
    // them back in.
    const rows = [...donorRows(500), ...Array.from({ length: 149 }, () => account())];
    const used = countContactAccounts(149, rows);

    expect(used).toBe(149);
    expect(isAtContactLimit(used, resolveContactLimit('plus'))).toBe(false);
  });

  it('a tenant of donors alone is at zero capacity, however many there are', () => {
    expect(countContactAccounts(0, donorRows(2_000))).toBe(0);
    expect(isAtContactLimit(countContactAccounts(0, donorRows(2_000)), 150)).toBe(false);
  });

  it('is the server-side aggregate, not the loaded list — a truncated list does not undercount', () => {
    // The list stops at CRM_FETCH_LIMIT; `memberAccounts` does not. Capacity is
    // reported from the aggregate, so a church past the fetch ceiling is still
    // measured honestly.
    expect(countContactAccounts(1_800, Array.from({ length: 1_000 }, () => account()))).toBe(1_800);
  });

  it('never goes negative', () => {
    expect(countContactAccounts(0, [account({ email: SUPER_ADMIN_EMAILS[0] })])).toBe(0);
  });
});

describe('isAtContactLimit', () => {
  it('is at-limit AT the cap, not one past it', () => {
    expect(isAtContactLimit(149, 150)).toBe(false);
    expect(isAtContactLimit(150, 150)).toBe(true);
  });

  it('treats an over-cap tenant as simply at-limit (nothing is removed)', () => {
    expect(isAtContactLimit(900, 500)).toBe(true);
  });

  it('never limits an unlimited plan', () => {
    expect(isAtContactLimit(10_000, UNLIMITED)).toBe(false);
  });
});

describe('contactLimitMessage', () => {
  // ── 9 ──────────────────────────────────────────────────────────────────────
  it('names NO price and offers NO add-on', () => {
    // +500 contacts at $20/mo and unlimited at $59/mo are DECIDED BUT NOT BUILT.
    // Four features have shipped in this codebase that did not exist (#33, #29,
    // THE-13, #227). This copy must not make it five.
    PLAN_ORDER.forEach((plan) => {
      const msg = contactLimitMessage(resolveContactLimit(plan));
      expect(msg).not.toMatch(/\$/);
      expect(msg).not.toMatch(/\d+\s*\/\s*mo|per month|monthly/i);
      expect(msg).not.toMatch(/add-?on|top-?up|extra contacts|buy|purchase|checkout/i);
      expect(msg).not.toMatch(/\bunlimited\b/i);
      expect(msg).not.toMatch(/\b(20|59)\b/);
    });
  });

  it('points at the thing that does exist — upgrading the plan', () => {
    expect(contactLimitMessage(150)).toMatch(/upgrade your plan/i);
  });

  it('says donors do not count, because a longer list than the cap otherwise reads as a bug', () => {
    expect(contactLimitMessage(500)).toMatch(/don't count/i);
  });

  it('states the tenant’s own cap', () => {
    expect(contactLimitMessage(150)).toContain('150');
    expect(contactLimitMessage(2_000)).toContain('2,000');
  });
});
