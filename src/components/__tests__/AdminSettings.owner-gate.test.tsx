import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

/**
 * PR #540 follow-up: the phone Settings page offered Manage and Cancel
 * Subscription to every admin who reached it. Both open the billing portal,
 * whose route is owner-only, so a non-owner got a button that can only fail.
 * The desktop popup already hides them (SettingsDialog.test.tsx); this holds
 * the phone page to the same rule. Read from rendered output.
 */

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org' } },
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  updateDoc: vi.fn(),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({ forEach: () => {} }),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => false,
  isSuperAdmin: () => false,
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('next/image', () => ({ default: () => null }));

import AdminSettings from '../AdminSettings';
import type { TenantPlan } from '../../types/tenant.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(plan: string, canManageBilling: boolean): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminSettings
        onBack={() => {}}
        currentPlan={plan as TenantPlan}
        tenantId="tenant-1"
        email="admin@church.org"
        isPlanOwner={canManageBilling}
        canManageBilling={canManageBilling}
        onCustomizeNav={() => {}}
        onOpenDonations={() => {}}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe.each(['plus', 'pro', 'max'])('phone Settings on %s', (plan) => {
  it('shows Manage and the Cancel Subscription row to the owner', async () => {
    const host = await mount(plan, true);
    expect(host.querySelector('[data-testid="settings-manage-action"]'), 'the owner lost Manage').toBeTruthy();
    expect(host.querySelector('[data-settings-row="cancel-plan"]'), 'the owner lost Cancel Subscription').toBeTruthy();
  });

  it('shows neither to a non-owner admin', async () => {
    const host = await mount(plan, false);
    expect(host.querySelector('[data-testid="settings-manage-action"]'), 'a non-owner was shown Manage').toBeNull();
    expect(host.querySelector('[data-settings-row="cancel-plan"]'), 'a non-owner was shown the Cancel row').toBeNull();
    expect(host.textContent).not.toContain('Cancel Subscription');
    // The plan card itself is information, not an owner action.
    expect(host.textContent).toMatch(/plan/i);
  });
});
