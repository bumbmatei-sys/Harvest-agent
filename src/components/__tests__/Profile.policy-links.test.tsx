import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * ONE CANONICAL SOURCE FOR THE POLICIES.
 *
 * The app used to ship its own Privacy Policy and Terms of Use, a year out of
 * date, contradicting the documents published on theharvest.site on three
 * points: what happens to AI conversations; a named third-party ministry the
 * policy claimed member data was shared with, which the founder has confirmed
 * does not exist as a relationship; and a refund policy that was absent
 * entirely. Two policy documents that disagree is worse than one that is out
 * of date: whichever a customer relies on, the other contradicts it.
 *
 * 🔴 THE LOAD-BEARING TEST IS THE FIRST ONE. Privacy and Terms must remain
 * visible to ordinary members. Members are the data subjects — Harvest holds
 * their name, email, attendance, giving history, AI conversations and in some
 * cases their children's check-in details. Hiding how that data is processed
 * from the person it belongs to is the wrong side of GDPR. Refunds is gated
 * only because a member never pays Harvest anything, so it is meaningless to
 * them; it reuses the Admin Dashboard condition rather than inventing a second.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, userDoc } = vi.hoisted(() => ({
  authMock: {
    currentUser: { uid: 'u1', email: 'member@church.org', photoURL: null, displayName: 'Member' },
  },
  // Mutated per test to switch the viewer between member and admin. Profile
  // derives `isAdmin` from exactly these fields.
  userDoc: { current: {} as Record<string, unknown> },
}));

vi.mock('../../firebase', () => ({
  auth: authMock,
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
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
  getDocs: vi.fn(async () => ({ forEach: () => {} })),
  arrayUnion: (v: unknown) => v,
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => null) }));
vi.mock('../../utils/tenant-scope', () => ({
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  isSuperAdmin: () => false,
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'plus' }) }));
vi.mock('next/image', () => ({ default: () => null }));

// Sibling screens are irrelevant here and drag in their own Firebase surface.
// PrivacyTermsModal is deliberately NOT mocked — it is the screen under test.
vi.mock('../PersonalInformationModal', () => ({ default: () => null }));
vi.mock('../ContactModal', () => ({ default: () => null }));
vi.mock('../FAQModal', () => ({ default: () => null }));
vi.mock('../ChurchDetailsModal', () => ({ default: () => null }));
vi.mock('../UserEvents', () => ({ default: () => null }));
vi.mock('../SavedItems', () => ({ default: () => null }));
vi.mock('../DonationHistory', () => ({ default: () => null }));
vi.mock('../ThemeToggle', () => ({ default: () => null }));

import Profile from '../Profile';
import { LEGAL_LINKS } from '../../lib/legal-links';

const ROOT = path.resolve(__dirname, '../../..');

/** Mount Profile as the given viewer and open the Privacy & Terms screen. */
async function openPolicyScreen(role: 'user' | 'admin') {
  userDoc.current = { displayName: 'Member', email: 'member@church.org', role };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />,
    );
  });

  const entry = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Privacy & Terms'),
  );
  expect(entry, 'the Profile screen no longer has a Privacy & Terms entry').toBeTruthy();
  await act(async () => {
    entry!.click();
  });

  return {
    container,
    links: () => Array.from(container.querySelectorAll('a')),
    labels: () => Array.from(container.querySelectorAll('a')).map((a) => a.textContent ?? ''),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * TEST 1 — the regression test for the whole compliance point.
 *
 * ⚠️ If this test fails, someone has gated a policy that must never be gated.
 * Do not "fix" it by relaxing the assertion.
 */
describe('a non-admin member sees the Privacy and Terms links', () => {
  it('renders both policy links for an ordinary member', async () => {
    const screen = await openPolicyScreen('user');
    const hrefs = screen.links().map((a) => a.getAttribute('href'));

    expect(hrefs, 'a member cannot reach the Privacy Policy').toContain(
      'https://theharvest.site/privacy',
    );
    expect(hrefs, 'a member cannot reach the Terms of Service').toContain(
      'https://theharvest.site/terms',
    );
    screen.unmount();
  });
});

/** TEST 2 — refunds is meaningless to someone who never pays. */
describe('a non-admin member does not see the Refunds link', () => {
  it('omits the refund policy for an ordinary member', async () => {
    const screen = await openPolicyScreen('user');
    expect(screen.links().map((a) => a.getAttribute('href'))).not.toContain(
      'https://theharvest.site/refunds',
    );
    screen.unmount();
  });
});

/** TEST 3 — the admin sees the full set. */
describe('an admin sees all three links', () => {
  it('renders privacy, terms and refunds for an admin', async () => {
    const screen = await openPolicyScreen('admin');
    const hrefs = screen.links().map((a) => a.getAttribute('href'));
    for (const link of LEGAL_LINKS) {
      expect(hrefs, `${link.label} is missing for an admin`).toContain(link.href);
    }
    expect(hrefs).toHaveLength(3);
    screen.unmount();
  });

  it('gates refunds on the SAME condition as the Admin Dashboard entry', () => {
    // Structural, not behavioural: the point is that there is ONE admin
    // condition on this screen. Profile computes `isAdmin` once and both the
    // Admin Dashboard entry and the policy screen read that same value. A
    // second, independently-derived check is the thing that drifts.
    const src = readFileSync(path.join(ROOT, 'src/components/Profile.tsx'), 'utf8');
    expect(src).toContain('isAdmin={isAdmin}');
    expect(
      (src.match(/const \[isAdmin, setIsAdmin\]/g) ?? []).length,
      'Profile should derive isAdmin exactly once',
    ).toBe(1);

    // PrivacyTermsModal must not re-derive admin-ness for itself.
    const modal = readFileSync(path.join(ROOT, 'src/components/PrivacyTermsModal.tsx'), 'utf8');
    expect(modal, 'the policy screen re-derives admin status instead of reusing the prop')
      .not.toMatch(/role\s*===|isSuperAdmin|custom[Cc]laims/);
  });
});

/**
 * TEST 5 — the links are canonical and leave the app.
 */
describe('all three links point at theharvest.site and open externally', () => {
  it('every rendered policy link is external and safely targeted', async () => {
    const screen = await openPolicyScreen('admin');
    const anchors = screen.links();
    expect(anchors).toHaveLength(3);
    for (const a of anchors) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\/theharvest\.site\//);
      expect(a.getAttribute('target'), 'policy links must leave the app').toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    screen.unmount();
  });

  it('the signup consent copy points at the same canonical URLs', () => {
    // The consent point matters more than the settings screen: a user
    // accepting text that is not the text in force has not usefully consented.
    const auth = readFileSync(path.join(ROOT, 'src/components/AuthPage.tsx'), 'utf8');
    expect(auth).toContain('PRIVACY_URL');
    expect(auth).toContain('TERMS_URL');
    expect(auth, 'the signup screen still holds its own copy of the policies')
      .not.toMatch(/Acceptance of Terms|Information We Collect/);
  });
});

/**
 * TEST 4 — no policy prose remains anywhere in the app.
 *
 * Repo-wide, because the failure this guards against is a SECOND copy
 * reappearing somewhere else — which is exactly how the app ended up with
 * three divergent versions of the same two documents.
 */
describe('no policy prose remains in the app', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
      } else if (/\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  }
  const FILES = walk(path.join(ROOT, 'src'));

  // Phrases that only ever appear inside a policy document. Each is a literal
  // string from the deleted copy, so restoring any paragraph re-introduces one.
  const PROSE = [
    'Last Updated: December 2025',
    "improve the AI's accuracy",
    'improve the AI&apos;s accuracy',
    'CfaN',
    'local partner ministries',
    'Acceptance of Terms',
    'Our Commitment to Your Journey',
    'Information We Collect',
    'Data Sharing and Disclosure',
    'The Harvest AI Disclaimer',
  ];

  it.each(PROSE)('no source file contains %j', (phrase) => {
    const offenders = FILES.filter((f) => readFileSync(f, 'utf8').includes(phrase)).map((f) =>
      path.relative(ROOT, f),
    );
    expect(offenders, 'policy prose belongs on theharvest.site, not in the app').toEqual([]);
  });

  it('CfaN appears nowhere in src at all', () => {
    // The founder has confirmed Harvest has no relationship with CfaN and
    // shares data with no partner ministry, so the deleted line was a FALSE
    // disclosure to data subjects. It must not come back in copy or in code.
    const offenders = FILES.filter((f) => /cfan/i.test(readFileSync(f, 'utf8'))).map((f) =>
      path.relative(ROOT, f),
    );
    expect(offenders).toEqual([]);
  });
});
