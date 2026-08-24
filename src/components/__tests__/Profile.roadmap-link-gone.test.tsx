import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-225 — the Roadmap link is gone from the app.
 *
 * It lived in ONE place here: the member Profile's "Support & Info" group,
 * behind `isAdmin`, opening a public Trello board in a new tab. The same link
 * was in the marketing site's top nav (desktop and hamburger) and is removed
 * there in the same change; the site has its own test for that.
 *
 * The group SURVIVES the removal — Support & Info still holds Contact Us, FAQ
 * and Privacy & Terms for every member on every tier — so nothing here orphans
 * a heading. That mattered enough to sequence the two halves together: the
 * empty-group defect this ticket also fixes is on the member SIDEBAR, a
 * different surface with a different group of the same name, and the removal
 * had to be checked against the group it actually touches.
 *
 * Asserted from RENDERED OUTPUT (an admin's Profile — the only viewer who ever
 * saw the row) and then swept across `src/` so a second link cannot be hiding
 * on a screen this file does not mount.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, userDoc } = vi.hoisted(() => ({
  authMock: {
    currentUser: { uid: 'u1', email: 'admin@church.org', photoURL: null, displayName: 'Admin' },
  },
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
  getDocs: vi.fn(async () => ({
    forEach: (f: (d: unknown) => void) => f({ data: () => ({ tenantId: 'tenant-1' }) }),
  })),
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
vi.mock('../PersonalInformationModal', () => ({ default: () => null }));
vi.mock('../ContactModal', () => ({ default: () => null }));
vi.mock('../FAQModal', () => ({ default: () => null }));
vi.mock('../PrivacyTermsModal', () => ({ default: () => null }));
vi.mock('../ChurchDetailsModal', () => ({ default: () => null }));
vi.mock('../UserEvents', () => ({ default: () => null }));
vi.mock('../SavedItems', () => ({ default: () => null }));
vi.mock('../DonationHistory', () => ({ default: () => null }));

import Profile from '../Profile';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');

async function mount(data: Record<string, unknown>): Promise<HTMLElement> {
  userDoc.current = data;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return host;
}

const ADMIN = { displayName: 'Sarah Whitfield', role: 'admin', totalDonated: 480 };

/** Every settings row label on the Profile page, in document order. */
function rowLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('button'))
    .map((b) => (b.textContent || '').trim())
    .filter(Boolean);
}

/** Every .ts/.tsx file under src/, so nothing can hide on an unmounted screen. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe('no Roadmap link renders in the app', () => {
  it('🔴 an admin\'s Profile no longer offers a Roadmap row', async () => {
    const host = await mount(ADMIN);

    // The viewer who used to see it — `isAdmin` gated the row.
    expect(rowLabels(host), 'the Admin Dashboard entry is missing, so this is not an admin view')
      .toContain('Admin Dashboard');
    expect(rowLabels(host), 'the Roadmap row survived').not.toContain('Roadmap');
    expect(host.textContent, 'the word Roadmap is still on the Profile screen').not.toContain('Roadmap');
  });

  it('the Support & Info group still renders, with its other three rows', async () => {
    // Removing a row from a group is only safe while the group has others. It
    // does — so this is not the empty-heading case the sidebar had.
    const host = await mount(ADMIN);
    const labels = rowLabels(host);

    expect(host.textContent).toContain('Support & Info');
    expect(labels).toContain('Contact Us');
    expect(labels).toContain('FAQ');
    expect(labels).toContain('Privacy & Terms');
  });

  it('🔴 no file under src/ links to the Trello board any more', () => {
    // This file is excluded from both sweeps: it has to name the string it
    // forbids in order to look for it, and cannot be its own offender.
    const offenders = sourceFiles(SRC)
      .filter((f) => f !== __filename)
      .filter((file) => readFileSync(file, 'utf8').includes('trello.com'));
    expect(offenders.map((f) => path.relative(ROOT, f)), 'a Trello link survived somewhere in src/')
      .toEqual([]);
  });

  it('no file under src/ still renders a control labelled Roadmap', () => {
    // The label, not just the URL — a row repointed at some other roadmap page
    // is the same link the founder asked to remove.
    const offenders = sourceFiles(SRC)
      .filter((f) => f !== __filename)
      .filter((file) => /label="Roadmap"|>Roadmap</.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
