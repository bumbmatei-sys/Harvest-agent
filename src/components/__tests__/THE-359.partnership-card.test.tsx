import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getPlanFeatures } from '../../utils/plan-features';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-359 · 🔴 THE PARTNERSHIP CARD STOPPED CLAIMING SOMETHING HARVEST CANNOT
 * KNOW.
 *
 * THE FOUNDER: "'You don't have an active partnership' section should be
 * transformed into a button that says Partner with Us and thats it, above
 * donation history in the same partnership section. there is no way to create
 * as of right now any recuring payments tracked by harvest so that copy is not
 * good."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THE SENTENCE WAS FALSE, WHICH IS WHY IT IS DELETED RATHER THAN REWORDED
 *
 * Recurring giving to a TENANT runs through that tenant's own payment links —
 * PayPal, Revolut, Wise. `STRIPE_CONNECT_ENABLED` is false and the platform
 * account is closed as `rejected.fraud`, so Harvest never sees a penny of it. A
 * member who set up a monthly standing order to their church opened this screen
 * and was told, flatly, that they had no partnership.
 *
 * ⚠️ NOTHING REPLACES IT. No "we cannot see recurring gifts", no explanatory
 * note, no softened status line — each of those is the same unknowable subject
 * with a hedge on it. A button that claims nothing cannot be wrong.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔵 WHAT THIS TICKET DELIBERATELY DID NOT TOUCH, AND WHY — REPORTED, NOT SWEPT
 *
 * The card has three states, and only the third made an unknowable claim:
 *
 *   1. `donationSubscriptionId` — a REAL platform Stripe subscription that
 *      Harvest itself created through `/api/stripe/donate` and stamped onto the
 *      user document from its own webhook. Harvest does know about that one.
 *      Its branch also carries the only Cancel Partnership control on this
 *      screen; deleting it would strand a live recurring charge with no way to
 *      stop it, which is strictly worse than the copy this ticket fixes.
 *   2. `totalDonated > 0` — "Donor · $N given", read off the tenant's own
 *      ledger. A fact, not a claim about a partnership.
 *   3. everything else — the deleted empty state.
 *
 * Both survivors are asserted below to still work, because "the founder asked
 * for a button" is not a reason to delete a working cancel control.
 */

const { authMock, userDoc, ctx, saved } = vi.hoisted(() => ({
  authMock: { currentUser: { uid: 'u1', email: 'member@church.org', photoURL: null, displayName: 'Member' } },
  userDoc: { current: {} as Record<string, unknown> },
  ctx: { current: undefined as unknown },
  saved: { current: {} as Record<string, unknown> },
}));

vi.mock('../../firebase', () => ({
  auth: authMock, db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'k',
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  onSnapshot: (_ref: unknown, cb: (d: unknown) => void) => {
    cb({ exists: () => true, data: () => userDoc.current });
    return () => {};
  },
  updateDoc: vi.fn(async () => {}),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: vi.fn(async () => ({ forEach: (f: (d: unknown) => void) => f({ data: () => ({ tenantId: 'tenant-1' }) }) })),
  arrayUnion: (v: unknown) => v,
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => null) }));
vi.mock('../../utils/tenant-scope', () => ({
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  isSuperAdmin: () => false,
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('../../utils/super-admins', () => ({ isSuperAdminEmail: () => false }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: null }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../../contexts/TenantContext', () => ({ useTenantOptional: () => ctx.current }));
vi.mock('../../contexts/SavedItemsContext', () => ({
  useSavedItems: () => ({ savedItems: saved.current, ready: true, removeSave: () => {} }),
}));
vi.mock('../PersonalInformationModal', () => ({ default: () => null }));
vi.mock('../ContactModal', () => ({ default: () => null }));
vi.mock('../FAQModal', () => ({ default: () => null }));
vi.mock('../PrivacyTermsModal', () => ({ default: () => null }));
vi.mock('../ChurchDetailsModal', () => ({ default: () => null }));
vi.mock('../UserEvents', () => ({ default: () => null }));
vi.mock('../DonationHistory', () => ({ default: () => <div data-testid="donation-history" /> }));

import Profile from '../Profile';

const ROOT = process.cwd();
const PROFILE = 'src/components/Profile.tsx';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

let host: HTMLDivElement;
let root: Root;

/** A priced tier — every one of them publishes `fundraising`. */
const PLAN = 'plus';
const contextFor = (plan: string) =>
  ({ tenantPlan: plan, planFeatures: { ...getPlanFeatures(plan as never), unlimitedContacts: false } });

const goToPartner = vi.fn();

/** A member with no platform subscription and nothing recorded — the third state. */
const NEVER_GAVE = { displayName: 'Sarah Whitfield' };
const PAST_DONOR = { displayName: 'Sarah Whitfield', totalDonated: 480 };
const PARTNER = {
  displayName: 'Sarah Whitfield',
  donationSubscriptionId: 'sub_123',
  donationAmount: 40,
  donationChurchName: 'Grace Chapel',
  totalDonated: 480,
};

async function mountProfile(
  data: Record<string, unknown>,
  opts: { withPartnerRoute?: boolean } = {},
) {
  const withRoute = opts.withPartnerRoute !== false;
  ctx.current = contextFor(PLAN);
  userDoc.current = data;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <Profile
        onNavigate={() => {}}
        {...(withRoute ? { onGoToPartner: goToPartner } : {})}
        onGoToMap={() => {}}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const buttons = () => [...host.querySelectorAll('button')];
const labels = () => buttons().map((b) => b.textContent?.trim() || '');
const headings = () => [...host.querySelectorAll('h4')].map((h) => h.textContent?.trim() || '');
const allText = () => host.textContent || '';

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  goToPartner.mockClear();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host.remove();
});

/* ═══ 16b · the card is a single "Partner with Us" button ═════════════════ */

describe('16b · the partnership card is one button and nothing else', () => {
  it('🔴 the button is there, labelled exactly "Partner with Us"', async () => {
    await mountProfile(NEVER_GAVE);
    const cta = buttons().find((b) => b.textContent?.trim() === 'Partner with Us');
    expect(cta, '🔴 the "Partner with Us" button is missing').toBeTruthy();
    // ⚠️ THE ARROW WENT WITH THE LINK. The founder asked for "a button that
    // says Partner with Us"; "Partner with Us →" was the link-variant label.
    expect(labels(), 'the old link label survived beside the button')
      .not.toContain('Partner with Us →');
  });

  it('🔴 NO status line and NO empty-state sentence', async () => {
    await mountProfile(NEVER_GAVE);
    /**
     * ⚠️ THE NEEDLE IS BUILT AT RUN TIME. #496 found two of its own guards
     * self-matching. This one reads RENDERED TEXT rather than source, so it
     * cannot match this file — but the source sweep below can, and both are
     * spelled the same way so the discipline does not depend on remembering
     * which is which.
     */
    const claim = new RegExp(['active', 'partnership'].join('\\s+'), 'i');
    expect(allText(), '🔴 the unknowable claim came back').not.toMatch(claim);
    expect(allText(), "a “you have not” empty state came back")
      .not.toMatch(/you (?:don’t|don't|do not) have/i);
    // And no substitute explanation was invented in its place.
    for (const invented of [/cannot see/i, /we don’t know/i, /recurring gift/i, /not tracked/i]) {
      expect(allText(), `an explanatory note was invented: ${invented}`).not.toMatch(invented);
    }
    // The Empty primitive that carried the sentence is gone from this state.
    expect(host.querySelectorAll('[data-slot="empty"]').length,
      'an Empty block still announces something about partnership').toBe(0);
  });

  it('🔴 the source carries no such claim either — over PARSER-STRIPPED code', async () => {
    /**
     * ⚠️ THE RENDERED SWEEP ABOVE ONLY SEES THE STATE IT MOUNTED. This one sees
     * every branch, including ones no fixture here reaches. It runs over
     * comment-stripped source because this suite's own docblock quotes the
     * deleted sentence in order to explain it — the exact self-match #496
     * found twice — and the needle is assembled from fragments so it cannot
     * appear as a literal anywhere in this file.
     */
    const src = stripComments(read(PROFILE));
    const claim = new RegExp(['active', 'partnership'].join('\\s+'), 'i');
    expect(src, '🔴 the "no active partnership" claim is back in Profile.tsx')
      .not.toMatch(claim);
    // The stripper really did leave code behind, and the needle really matches.
    expect(src.length, 'the stripper ate the file').toBeGreaterThan(5000);
    expect(src).toContain('Partner with Us');
    expect("You don't have an " + ['active', 'partnership'].join(' ')).toMatch(claim);
  });
});

/* ═══ 16c · nothing else claims to know a partnership status ══════════════ */

describe('16c · nothing claims to know whether a member has an active partnership', () => {
  it('🔴 no member-facing file asserts the NEGATIVE, anywhere', async () => {
    /**
     * 🔴 THE UNKNOWABLE CLAIM IS THE NEGATIVE ONE, and the distinction is the
     * whole finding. "You have no partnership" is unknowable: Harvest cannot
     * see a standing order at the tenant's own PayPal. "You have THIS
     * partnership" is knowable when it names a platform subscription Harvest
     * itself created and stamped onto the user document from its own webhook.
     *
     * So this sweeps every member-facing source for the negative form and
     * finds none, rather than banning the word "partnership", which would
     * condemn the Cancel control a real subscriber needs.
     */
    const MEMBER_FACING = [
      'src/components/Profile.tsx',
      'src/components/PersonalInformationModal.tsx',
      'src/components/PartnerWithUsTab.tsx',
      'src/components/NewsTab.tsx',
      'src/components/MainApp.tsx',
    ];
    const claim = new RegExp(['active', 'partnership'].join('\\s+'), 'i');
    const negative = /(?:no|not|don’t|don't|without)[^.]{0,40}partnership/i;
    for (const rel of MEMBER_FACING) {
      let src: string;
      try { src = stripComments(read(rel)); } catch { continue; }
      expect(src, `${rel} claims to know a member's partnership status`).not.toMatch(claim);
      expect(src, `${rel} asserts a member has no partnership`).not.toMatch(negative);
    }
  });

  it('🔵 and the one thing that DOES read a status reads a real Stripe record', async () => {
    // `hasActivePartnership` in PersonalInformationModal is set from
    // `donationSubscriptionId` — the platform subscription — and is not used to
    // render any claim: the Cancel row is unconditional. Recorded here so a
    // future reader does not go looking for a second offender that is not one.
    const src = stripComments(read('src/components/PersonalInformationModal.tsx'));
    expect(src).toContain('donationSubscriptionId');
    expect(src, 'a partnership status became a rendered claim')
      .not.toMatch(/\{hasActivePartnership\s*&&/);
  });
});

/* ═══ 16d · it sits in PARTNERSHIP, above Donation History ════════════════ */

describe('16d · the order is Partnership, then the button, then Donation History', () => {
  it('🔴 the heading stays and the button precedes Donation History in the DOM', async () => {
    await mountProfile(NEVER_GAVE);
    /**
     * 🔵 THE HEADING STAYS — reported as this ticket's view. The founder asked
     * for the button "above donation history in the same partnership section",
     * and the heading is what makes that a SECTION rather than two loose cards:
     * it groups the way to give with the record of what was given.
     */
    expect(headings(), 'the PARTNERSHIP heading was dropped with the card').toContain('Partnership');

    const cta = buttons().find((b) => b.textContent?.trim() === 'Partner with Us')!;
    const history = [...host.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && e.textContent?.trim() === 'Donation History')[0];
    expect(history, 'Donation History is gone').toBeTruthy();

    // Document order, read off the DOM rather than off the source.
    const order = cta.compareDocumentPosition(history!);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING,
      '🔴 the button is BELOW Donation History').toBeTruthy();

    // And the heading precedes both.
    const heading = [...host.querySelectorAll('h4')].find((h) => h.textContent?.trim() === 'Partnership')!;
    expect(heading.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Donation History still opens, and is never gated on the card above it', async () => {
    await mountProfile(NEVER_GAVE, { withPartnerRoute: false });
    // No destination, so no button — and the section is still a section.
    expect(labels()).not.toContain('Partner with Us');
    expect(headings()).toContain('Partnership');
    const history = [...host.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && e.textContent?.trim() === 'Donation History')[0];
    expect(history, 'Donation History went with the button').toBeTruthy();
    /**
     * ⚠️ AND NO BLANK PADDED BOX WHERE THE CARD WAS. With the empty-state
     * sentence deleted there is nothing left to draw in this state, so the Card
     * is skipped rather than rendered with 16px of padding around nothing.
     * Counted structurally: the section holds the heading and the Donation
     * History card, and no third child.
     */
    const section = [...host.querySelectorAll('div')]
      .find((d) => d.firstElementChild?.tagName === 'H4'
        && d.firstElementChild.textContent?.trim() === 'Partnership')!;
    expect(section, 'the Partnership section could not be found').toBeTruthy();
    expect([...section.children].length,
      'an empty partnership card is still rendering between the heading and the history')
      .toBe(2);
    expect(section.children[1].textContent?.trim()).toBe('Donation History');
  });
});

/* ═══ 16e · the button leads where the old link led ═══════════════════════ */

describe('16e · the destination is unchanged', () => {
  it('🔴 pressing it calls onGoToPartner, exactly as the link did', async () => {
    await mountProfile(NEVER_GAVE);
    const cta = buttons().find((b) => b.textContent?.trim() === 'Partner with Us')!;
    await act(async () => { cta.click(); });
    expect(goToPartner, '🔴 the button leads nowhere').toHaveBeenCalledTimes(1);
  });

  it('🔴 and with no Give page there is no button at all, rather than a dead one', async () => {
    // THE-246's gate, unchanged: `onGoToPartner` is omitted by the caller when
    // the tenant publishes nothing to give through.
    await mountProfile(NEVER_GAVE, { withPartnerRoute: false });
    expect(labels(), 'a dead button renders with nowhere to go').not.toContain('Partner with Us');
  });
});

/* ═══ the two states this ticket deliberately left alone ══════════════════ */

describe('the knowable states are untouched — no-regression', () => {
  it('🔴 an active platform partnership keeps its figure AND its Cancel control', async () => {
    await mountProfile(PARTNER);
    expect(allText(), 'the monthly figure went').toContain('$40 / month');
    expect(labels(), '🔴 CANCEL PARTNERSHIP IS GONE — a live recurring charge cannot be stopped')
      .toContain('Cancel Partnership');
  });

  it('a past donor keeps "Donor", the given figure and "Give again →"', async () => {
    await mountProfile(PAST_DONOR);
    expect(allText()).toContain('Donor');
    expect(allText()).toContain('$480 given');
    expect(labels()).toContain('Give again →');
  });
});
