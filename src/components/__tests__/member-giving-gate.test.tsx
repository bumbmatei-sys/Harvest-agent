import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PLAN_ORDER, PLAN_DISPLAY_NAMES, getPlanFeatures } from '../../utils/plan-features';

/**
 * THE-213 · defects 2 and 4 — NO MEMBER-APP SURFACE OFFERS GIVING, AND THE LAST
 * NEWS-FEED ENTRY POINT.
 *
 * 🔴 THE PROFILE'S PARTNERSHIP SECTION. `fundraising: false` means the tenant
 * has no donate page at all, and the Profile still carried "Donor", a lifetime
 * given figure, "Give again →", "Partner with Us →" and a Donation History row.
 * The dead giveaway that a gate was intended and never wired: Profile.tsx
 * imported `getPlanFeatures` and read `tenantPlan` off the store, and used
 * NEITHER.
 *
 * 🔴 AND THE GIVE ROUTE, NOT ONLY THE GIVE TAB. THE-202 gated the tab entry in
 * MainApp's `topTabs`, and that entry was the only thing reading the cell —
 * but THREE paths set `activeTopTab` to 'partner' without going near the tab
 * strip: this Profile's two buttons, NewsTab's giving CTA, and the `?giving=1`
 * deep link a printed QR or a Text-to-Give reply carries. A hidden tab is not
 * a gate (THE-193).
 *
 * 🔴 SAVED POSTS. THE-205 gated NewsTab, AllNews and the public permalink, and
 * pointed a saved post's tap at Home. What it did not do is stop the Saved list
 * RENDERING the post: the Posts group prints "{author}'s post" and the body
 * snippet stored on the save, so feed content was still on screen on a tier
 * with no feed anywhere.
 *
 * ⚠️ HIDES SURFACES, NEVER RECORDS. `donationSubscriptionId`, `donationAmount`,
 * `totalDonated` and every saved item are still read and are never written,
 * cleared or cancelled — a member whose church upgrades gets the card and the
 * group back with their whole history intact.
 *
 * Targets are named by LABEL (the section heading, the button text, the group
 * caption), never by matching a value.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
import SavedItems from '../SavedItems';

let host: HTMLDivElement;
let root: Root;

/** The context value TenantProvider actually publishes: effective features. */
const contextFor = (plan: string | null) =>
  plan === null
    ? undefined
    : { tenantPlan: plan, planFeatures: { ...getPlanFeatures(plan as never), unlimitedContacts: false } };

const goToPartner = vi.fn();

async function mountProfile(plan: string | null, data: Record<string, unknown> = {}) {
  ctx.current = contextFor(plan);
  userDoc.current = data;
  await act(async () => {
    root = createRoot(host);
    root.render(<Profile onNavigate={() => {}} onGoToPartner={goToPartner} onGoToMap={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
}

async function mountSaved(plan: string | null, items: Record<string, unknown>) {
  ctx.current = contextFor(plan);
  saved.current = items;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <SavedItems onBack={() => {}} onOpenBlog={() => {}} onOpenLesson={() => {}} onOpenPost={() => {}} />,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

/** Every uppercase section caption on the Profile / Saved page, by its role. */
const headings = () => [...host.querySelectorAll('h4')].map((h) => h.textContent?.trim() || '');
const buttonLabels = () => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim() || '');
const rowLabels = () => [...host.querySelectorAll('span, p, div')]
  .filter((e) => e.children.length === 0)
  .map((e) => e.textContent?.trim() || '');

/** A member who partners monthly AND has a lifetime total — the fixture that
 *  makes "the section is hidden" a real claim rather than an empty-state one. */
const PARTNER = {
  displayName: 'Sarah Whitfield',
  donationSubscriptionId: 'sub_123',
  donationAmount: 40,
  donationChurchName: 'Grace Chapel',
  totalDonated: 480,
};
const PAST_DONOR = { displayName: 'Sarah Whitfield', totalDonated: 480 };
const NEVER_GAVE = { displayName: 'Sarah Whitfield' };

const A_SAVED_POST = {
  'post:p1': { type: 'post', id: 'p1', authorName: 'Pastor Adams', snippet: 'Sunday gathering moved to 10am', savedAt: '2026-01-02T00:00:00.000Z' },
  'blog:b1': { type: 'blog', id: 'b1', title: 'On patience', savedAt: '2026-01-01T00:00:00.000Z' },
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  goToPartner.mockClear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host.remove();
});

// ─── 1. the Partnership section ──────────────────────────────────────────────
describe('the member Profile has no Partnership section for a free tenant', () => {
  it('drops the Partnership heading entirely', async () => {
    await mountProfile('free', PARTNER);
    expect(headings()).not.toContain('Partnership');
  });

  it('drops the Donor status and the lifetime given figure', async () => {
    await mountProfile('free', PAST_DONOR);
    expect(rowLabels()).not.toContain('Donor');
    expect(buttonLabels()).not.toContain('Give again →');
  });

  it('drops "Partner with Us →" for a member who has never given', async () => {
    await mountProfile('free', NEVER_GAVE);
    expect(buttonLabels()).not.toContain('Partner with Us →');
    expect(rowLabels()).not.toContain("You don't have an active partnership");
  });

  it('drops Donation History, and it can never be opened', async () => {
    await mountProfile('free', PARTNER);
    expect(rowLabels()).not.toContain('Donation History');
    expect(host.querySelector('[data-testid="donation-history"]')).toBeNull();
  });

  it('drops "Cancel Partnership" — a free tenant cannot hold a subscription to cancel', async () => {
    await mountProfile('free', PARTNER);
    expect(buttonLabels()).not.toContain('Cancel Partnership');
  });

  it('🔴 leaves the rest of the page whole — no gap where the section was', async () => {
    // STOP condition 3. The group is a `space-y-6` stack of self-contained
    // cards, so its two survivors keep their own rhythm; what must be proved is
    // that they SURVIVE and that the grid still has both of its columns.
    await mountProfile('free', PARTNER);
    expect(headings()).toEqual(['Account Settings', 'Support & Info']);
    expect(buttonLabels()).toContain('Log Out');
    const settings = [...host.querySelectorAll('div')].find((d) =>
      (d.getAttribute('class') || '').includes('xl:grid-cols-2'));
    expect(settings, 'the two-column settings split was lost').toBeTruthy();
    expect(settings!.children).toHaveLength(2);
  });

  it('🔴 reads the record and never writes it — the partnership is not cancelled', async () => {
    const { updateDoc } = await import('firebase/firestore');
    await mountProfile('free', PARTNER);
    expect(updateDoc, 'the gate wrote to the user document').not.toHaveBeenCalled();
  });
});

// ─── 2. the three priced tiers ───────────────────────────────────────────────
describe('the three priced tiers keep their Partnership section', () => {
  for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising)) {
    const name = PLAN_DISPLAY_NAMES[plan];

    it(`${name} keeps the section, the donor status and Donation History`, async () => {
      await mountProfile(plan, PAST_DONOR);
      expect(headings(), `${name} lost the Partnership heading`).toContain('Partnership');
      expect(rowLabels(), `${name} lost the Donor status`).toContain('Donor');
      expect(buttonLabels(), `${name} lost "Give again"`).toContain('Give again →');
      expect(rowLabels(), `${name} lost Donation History`).toContain('Donation History');
    });

    it(`${name} keeps Cancel Partnership for an active partner`, async () => {
      await mountProfile(plan, PARTNER);
      expect(buttonLabels(), `${name} lost the cancel control`).toContain('Cancel Partnership');
    });
  }

  it('an unresolved plan keeps the section — it must not blink off mid-load', async () => {
    await mountProfile(null, PAST_DONOR);
    expect(headings()).toContain('Partnership');
  });
});

// ─── 3. the Saved list's Posts group ─────────────────────────────────────────
describe('a free tenant sees no news-feed content in the Saved list', () => {
  it('drops the Posts group, snippet and all', async () => {
    await mountSaved('free', A_SAVED_POST);
    expect(headings()).not.toContain('Posts');
    expect(rowLabels().some((t) => t.endsWith("'s post"))).toBe(false);
    expect(rowLabels()).not.toContain('Sunday gathering moved to 10am');
  });

  it('keeps every group that is not the feed', async () => {
    await mountSaved('free', A_SAVED_POST);
    expect(headings()).toEqual(['Articles', 'Lessons', 'Verses']);
  });

  it('🔴 deletes nothing — the same saves come back on a tier with the feed', async () => {
    await mountSaved('free', A_SAVED_POST);
    await act(async () => { root.unmount(); });
    await mountSaved('pro', A_SAVED_POST);
    expect(headings()).toContain('Posts');
    expect(rowLabels().some((t) => t.endsWith("'s post"))).toBe(true);
  });

  it('shows the empty state when a free member’s only saves are posts', async () => {
    await mountSaved('free', { 'post:p1': A_SAVED_POST['post:p1'] });
    expect(rowLabels()).toContain('Nothing saved yet');
    expect(rowLabels()).toContain('Bookmark articles, lessons and verses to find them here.');
  });

  it('the three priced tiers keep the Posts group', async () => {
    for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).newsFeed)) {
      await act(async () => { root?.unmount(); });
      await mountSaved(plan, A_SAVED_POST);
      expect(headings(), `${PLAN_DISPLAY_NAMES[plan]} lost the Posts group`).toContain('Posts');
    }
  });
});
