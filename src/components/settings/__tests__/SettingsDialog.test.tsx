import React, { act } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org', displayName: 'Ada', photoURL: null, providerData: [{ providerId: 'password' }], getIdToken: async () => 't' } },
  db: {},
}));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ displayName: 'Ada', tenantId: 't1' }) }),
  updateDoc: vi.fn(),
}));
vi.mock('../../../utils/auth-fetch', () => ({ authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) }));
vi.mock('../../../contexts/TenantContext', () => ({
  useTenant: () => ({ refreshBranding: vi.fn() }),
  useTenantOptional: () => null,
}));
vi.mock('../BrandingSection', () => ({ default: () => <div data-stub="branding">Campus name</div> }));
vi.mock('../PlanUpgradeSection', () => ({ default: () => <div data-stub="plans">Plan cards</div> }));
vi.mock('../OnboardingSection', () => ({ default: () => <div data-stub="onboarding">Onboarding Questions</div> }));
vi.mock('../GivingStatementsSection', () => ({ default: () => <div data-stub="giving">Giving Statements</div> }));
vi.mock('../../ThemeToggle', () => ({ default: () => <div role="radiogroup" aria-label="Colour theme" /> }));

import { SettingsDialog } from '../SettingsDialog';
import { SETTINGS_LEGACY_SECTIONS_ENABLED } from '../../../lib/settings-legacy-sections';

async function mount(props: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SettingsDialog
        open
        onOpenChange={() => {}}
        currentPlan={'pro' as never}
        tenantId="t1"
        email="admin@church.org"
        {...props}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

function navLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-settings-nav]'))
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('desktop Settings popup (sidebar-13)', () => {
  it('is a Dialog with a left Sidebar nav and a breadcrumb header', async () => {
    const host = await mount();
    const popup = document.querySelector('[data-settings-popup]') || host.querySelector('[data-settings-popup]');
    expect(popup, 'the sidebar-13 dialog did not render').toBeTruthy();
    expect(popup!.closest('[data-slot="dialog-content"]') || popup!.getAttribute('data-slot'))
      .toBeTruthy();
    expect(navLabels(document.body)).toEqual([
      'Profile',
      'Campus & branding',
      'Plan & billing',
      'Campus setup',
      'Danger zone',
    ]);
    expect(document.body.textContent).toMatch(/Settings/);
    expect(navLabels(document.body).join(' ')).not.toMatch(/church/i);
  });

  it('switches the right-hand pane when a nav row is clicked', async () => {
    await mount();
    expect(document.querySelector('[data-settings-section="profile"]')).toBeTruthy();
    const campus = document.querySelector<HTMLElement>('[data-settings-nav="campus"]');
    expect(campus).toBeTruthy();
    await act(async () => { campus!.click(); });
    expect(document.querySelector('[data-settings-section="campus"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Campus name/);
    const billing = document.querySelector<HTMLElement>('[data-settings-nav="billing"]');
    await act(async () => { billing!.click(); });
    expect(document.querySelector('[data-settings-section="billing"]')).toBeTruthy();
  });

  it('opens the deep-linked section', async () => {
    await mount({ initialSection: 'billing' });
    expect(document.querySelector('[data-settings-section="billing"]')).toBeTruthy();
    expect(document.querySelector('[data-settings-nav="billing"]')?.getAttribute('data-active')
      || document.querySelector('[data-settings-nav="billing"]')?.getAttribute('data-slot')).toBeTruthy();
  });

  it('does not render SMS, Integrations, or Donations & payment links', async () => {
    expect(SETTINGS_LEGACY_SECTIONS_ENABLED).toBe(false);
    await mount();
    const text = document.body.textContent || '';
    expect(text).not.toContain('Donations & payment links');
    expect(navLabels(document.body)).not.toContain('SMS');
    expect(navLabels(document.body)).not.toContain('Integrations');
    expect(text).not.toMatch(/Mailchimp|Instagram|Gmail/);
  });

  it('does not offer Customize Navigation', async () => {
    await mount();
    expect(document.body.textContent).not.toContain('Customize Navigation');
  });
});
