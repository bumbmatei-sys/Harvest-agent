import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../../AdminSettings', () => ({ summarizePlanFeatures: () => 'plan summary' }));
vi.mock('../useTenantId', () => ({ getTenantId: async () => 't1' }));
vi.mock('../../../contexts/TenantContext', () => ({ useTenantOptional: () => null }));

import PlanBillingSection from '../PlanBillingSection';

let container: HTMLDivElement;
let root: Root;

function mount(props: React.ComponentProps<typeof PlanBillingSection>) {
  act(() => {
    root = createRoot(container);
    root.render(<PlanBillingSection tenantId="t1" email="a@b.org" {...props} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

const OWNER_ONLY = 'Only the plan owner can change the plan.';

describe('Plan & billing for an admin who is not the plan owner', () => {
  it.each(['free', 'plus', 'pro'] as const)(
    'never tells a non-owner on %s that they are on the highest tier',
    (plan) => {
      mount({ currentPlan: plan, canUpgrade: false });
      expect(container.textContent, 'a non-owner was told the false top-tier line')
        .not.toMatch(/highest tier/i);
      expect(container.textContent).not.toMatch(/You.re on the Ministry plan/);
      expect(container.textContent).toContain(OWNER_ONLY);
    },
  );

  it('renders no plan cards, no checkout and no Manage Subscription for a non-owner', () => {
    mount({ currentPlan: 'plus', canUpgrade: false });
    expect(container.querySelector('[data-testid="plan-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-card-track"]')).toBeNull();
    expect(container.querySelector('[data-testid="billing-manage-action"]')).toBeNull();
    expect(container.textContent).not.toContain('Manage Subscription');
  });

  it('hides the Manage button on the current-plan row from a non-owner', () => {
    mount({ currentPlan: 'pro', canUpgrade: false });
    expect(container.querySelector('[data-testid="settings-manage-action"]')).toBeNull();
    expect(container.textContent).toContain('plan summary');
  });

  it('says the owner-only line in theme tokens', () => {
    mount({ currentPlan: 'plus', canUpgrade: false });
    const note = container.querySelector('[data-testid="settings-owner-only-plan"]')!;
    expect(note.className).toMatch(/\btext-muted\b/);
    expect(note.className).not.toMatch(/\b(?:text|bg)-(?:red|gray|slate|zinc|stone)-\d/);
  });
});

describe('Plan & billing for the plan owner', () => {
  it('keeps the plan cards and both Manage buttons', () => {
    mount({ currentPlan: 'plus', canUpgrade: true });
    expect(container.querySelectorAll('[data-testid="plan-card"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="settings-manage-action"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="billing-manage-action"]')).not.toBeNull();
    expect(container.textContent).not.toContain(OWNER_ONLY);
    expect(container.textContent).not.toMatch(/highest tier/i);
  });

  it('still says "highest tier" to an owner who really is on Ministry', () => {
    mount({ currentPlan: 'max', canUpgrade: true });
    expect(container.textContent).toMatch(/highest tier/i);
    expect(container.querySelector('[data-testid="plan-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="billing-manage-action"]')).not.toBeNull();
  });

  it('mounts the plan cards in the compact popup layout', () => {
    mount({ currentPlan: 'plus', canUpgrade: true });
    const track = container.querySelector<HTMLElement>('[data-testid="plan-card-track"]')!;
    expect(track.style.display).toBe('grid');
    expect(track.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});
