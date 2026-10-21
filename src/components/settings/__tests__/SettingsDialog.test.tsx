import React, { act } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authFetchMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn(async () => {}));
const platform = vi.hoisted(() => ({ override: false }));

vi.mock('../../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => platform.override,
}));
vi.mock('../../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org', displayName: 'Ada', photoURL: null, providerData: [{ providerId: 'password' }], getIdToken: async () => 't' } },
  db: {},
}));
vi.mock('firebase/auth', () => ({
  signOut: signOutMock,
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
vi.mock('../../../utils/auth-fetch', () => ({ authFetch: authFetchMock }));
vi.mock('../../../contexts/TenantContext', () => ({
  useTenant: () => ({ refreshBranding: vi.fn() }),
  useTenantOptional: () => null,
}));
vi.mock('../BrandingSection', () => ({ default: () => <div data-stub="branding">Campus name</div> }));
vi.mock('../PlanUpgradeSection', () => ({
  default: ({ hideUpgrade }: { hideUpgrade?: boolean }) => (hideUpgrade ? null : <div data-stub="plans">Plan cards</div>),
}));
vi.mock('../OnboardingSection', () => ({ default: () => <div data-stub="onboarding">Onboarding Questions</div> }));
vi.mock('../GivingStatementsSection', () => ({ default: () => <div data-stub="giving">Giving Statements</div> }));
vi.mock('../../ThemeToggle', () => ({ default: () => <div role="radiogroup" aria-label="Colour theme" /> }));

import { SettingsDialog } from '../SettingsDialog';
import { getPlanFeatures, PLAN_ORDER } from '../../../utils/plan-features';
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
        canUpgrade
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
  platform.override = false;
  signOutMock.mockClear();
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
});

async function openSection(id: string) {
  const nav = document.querySelector<HTMLElement>(`[data-settings-nav="${id}"]`);
  expect(nav, `no ${id} nav row`).toBeTruthy();
  await act(async () => { nav!.click(); });
  await act(async () => { await Promise.resolve(); });
}

const buttonByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);

async function startDelete() {
  await act(async () => { buttonByText(document.body, 'Delete account')!.click(); });
  const confirm = buttonByText(document.body, 'Delete account');
  expect(confirm, 'the delete confirmation did not open').toBeTruthy();
  await act(async () => { confirm!.click(); });
  await act(async () => { await Promise.resolve(); });
}

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
    expect(document.querySelector('[data-settings-nav="billing"]')?.hasAttribute('data-active')).toBe(true);
    expect(document.querySelector('[data-settings-nav="profile"]')?.hasAttribute('data-active')).toBe(false);
  });

  it('stays on the deep-linked section when the URL params are stripped after it opens', async () => {
    // The billing pane strips ?stripe= on mount, so the dashboard's next render
    // computes a different initialSection. The open pane must not follow it.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = (initialSection: 'billing' | 'profile') => act(async () => {
      root.render(
        <SettingsDialog open onOpenChange={() => {}} currentPlan={'pro' as never} tenantId="t1"
          email="admin@church.org" initialSection={initialSection} />,
      );
    });
    await render('billing');
    expect(document.querySelector('[data-settings-section="billing"]')).toBeTruthy();
    await render('profile');
    expect(document.querySelector('[data-settings-section="billing"]'),
      'the pane snapped back to Profile after the return params were stripped').toBeTruthy();
    expect(document.querySelector('[data-settings-section="profile"]')).toBeFalsy();
  });

  it('puts Danger zone last, in the separated footer of the nav', async () => {
    await mount();
    const labels = navLabels(document.body);
    expect(labels[labels.length - 1]).toBe('Danger zone');
    const danger = document.querySelector('[data-settings-nav="danger"]')!;
    expect(danger.closest('[data-slot="sidebar-footer"]'), 'Danger zone is not in the footer group').toBeTruthy();
    expect(document.querySelector('[data-settings-nav="profile"]')!.closest('[data-slot="sidebar-footer"]')).toBeNull();
    expect(document.querySelector('[data-slot="sidebar-separator"]'), 'no rule above Danger zone').toBeTruthy();
  });

  it('falls back to Profile, not a blank pane, for ?section=danger with no subscription', async () => {
    await mount({ initialSection: 'danger', currentPlan: 'free' as never });
    expect(navLabels(document.body)).not.toContain('Danger zone');
    expect(document.querySelector('[data-settings-section="profile"]')).toBeTruthy();
    expect(document.querySelector('[data-settings-section="danger"]')).toBeFalsy();
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

  describe('Delete account', () => {
    it('asks for the password when the server answers auth/requires-recent-login', async () => {
      authFetchMock.mockImplementation(async () => ({
        ok: false,
        json: async () => ({ code: 'auth/requires-recent-login', error: 'recent sign-in needed' }),
      }));
      await mount();
      await startDelete();
      expect(document.querySelector('input[aria-label="Password"]'),
        'the re-auth prompt never appeared for the code the delete route actually returns').toBeTruthy();
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it('does not mistake the unprefixed code for a re-auth request', async () => {
      authFetchMock.mockImplementation(async () => ({
        ok: false,
        json: async () => ({ code: 'requires-recent-login', error: 'Delete failed.' }),
      }));
      await mount();
      await startDelete();
      expect(document.querySelector('input[aria-label="Password"]')).toBeNull();
    });

    it('signs the user out after the account is deleted', async () => {
      await mount();
      await startDelete();
      expect(authFetchMock).toHaveBeenCalledWith('/api/account/delete', expect.objectContaining({ method: 'POST' }));
      expect(signOutMock, 'a deleted account stayed signed in').toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toMatch(/Signing you out/);
    });

    it('does not sign out when the delete fails', async () => {
      authFetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'nope' }) }));
      await mount();
      await startDelete();
      expect(signOutMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toMatch(/nope/);
    });
  });

  describe('Campus setup', () => {
    const entitled = PLAN_ORDER.find((p) => getPlanFeatures(p).givingStatements);
    const unentitled = PLAN_ORDER.find((p) => !getPlanFeatures(p).givingStatements);

    it('has both an entitled and an unentitled plan to test against', () => {
      expect(entitled).toBeTruthy();
      expect(unentitled).toBeTruthy();
    });

    it('hides Giving statements on a plan without them, as the mobile page does', async () => {
      await mount({ currentPlan: unentitled as never, initialSection: 'setup' });
      expect(document.querySelector('[data-settings-section="setup"]')).toBeTruthy();
      expect(document.querySelector('[data-stub="giving"]'), 'an unentitled plan sees Giving statements').toBeNull();
      expect(document.body.textContent).not.toMatch(/Giving statements/);
    });

    it('shows Giving statements on a plan that includes them', async () => {
      await mount({ currentPlan: entitled as never, initialSection: 'setup' });
      expect(document.querySelector('[data-stub="giving"]')).toBeTruthy();
    });

    it('shows Giving statements to a platform override on any plan', async () => {
      platform.override = true;
      await mount({ currentPlan: unentitled as never, initialSection: 'setup' });
      expect(document.querySelector('[data-stub="giving"]')).toBeTruthy();
    });

    it('gives the section real headings', async () => {
      await mount({ currentPlan: entitled as never, initialSection: 'setup' });
      const headings = Array.from(document.querySelectorAll('[data-settings-section="setup"] h3'))
        .map((h) => h.textContent);
      expect(headings).toEqual(['Onboarding questions', 'Giving statements', 'Data export']);
    });

    it('offers the whole-campus data export on desktop, labelled for a campus', async () => {
      await mount({ initialSection: 'setup' });
      const exportRow = document.querySelector('[data-church-export]');
      expect(exportRow, 'the whole-campus export did not come to the popup').toBeTruthy();
      expect(exportRow!.querySelector('[aria-label="Export campus data"]')).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/Export church data/);
    });
  });

  describe('plan upgrade block', () => {
    it('is withheld from a non-owner and kept for the owner', async () => {
      await mount({ initialSection: 'billing', canUpgrade: false });
      expect(document.querySelector('[data-stub="plans"]'), 'a non-owner was shown the plan cards').toBeNull();
      document.body.innerHTML = '';
      await mount({ initialSection: 'billing', canUpgrade: true });
      expect(document.querySelector('[data-stub="plans"]')).toBeTruthy();
    });
  });

  describe('Danger zone is an owner action', () => {
    it('is not offered to an admin who is not the plan owner', async () => {
      await mount({ canUpgrade: false });
      expect(navLabels(document.body)).not.toContain('Danger zone');
      expect(document.querySelector('[data-settings-nav="danger"]')).toBeNull();
    });

    it('sends a non-owner deep link to ?section=danger to Profile, with no Cancel Subscription', async () => {
      await mount({ canUpgrade: false, initialSection: 'danger' });
      expect(document.querySelector('[data-settings-section="profile"]')).toBeTruthy();
      expect(document.querySelector('[data-settings-section="danger"]')).toBeNull();
      expect(buttonByText(document.body, 'Cancel Subscription')).toBeUndefined();
    });

    it('is kept, with Cancel Subscription, for the owner', async () => {
      await mount({ canUpgrade: true, initialSection: 'danger' });
      expect(navLabels(document.body)).toContain('Danger zone');
      expect(buttonByText(document.body, 'Cancel Subscription')).toBeTruthy();
    });
  });

  describe('popup frame', () => {
    it('is a fixed-height frame with a bounded sidebar, so Danger zone cannot sit below the edge', async () => {
      await mount();
      const popup = document.querySelector<HTMLElement>('[data-settings-popup]')!;
      expect(popup.className).toMatch(/\bh-\[500px\]/);
      const wrapper = popup.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!;
      expect(wrapper.className).toMatch(/\bh-full\b/);
      expect(wrapper.className).toMatch(/\bmin-h-0\b/);
      expect(wrapper.className, 'the sidebar wrapper is still viewport-tall').not.toMatch(/min-h-svh/);
    });

    it('moves initial focus into the pane, not onto the Profile nav row', async () => {
      await mount({ initialSection: 'billing' });
      expect(document.activeElement?.getAttribute('data-settings-nav')).toBeNull();
      expect(document.activeElement?.tagName).toBe('MAIN');
    });

    it('keeps the destructive tone on Danger zone when it is the selected row', async () => {
      await mount({ initialSection: 'danger' });
      const danger = document.querySelector<HTMLElement>('[data-settings-nav="danger"]')!;
      expect(danger.hasAttribute('data-active')).toBe(true);
      expect(danger.className).toMatch(/data-active:text-destructive/);
      expect(document.querySelector('[data-settings-section="danger"], [data-settings-popup] main')!.textContent)
        .toMatch(/Cancel your subscription/i);
    });
  });
});
