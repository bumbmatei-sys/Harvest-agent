import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PlanUpgradeSection from '../PlanUpgradeSection';
import { PLAN_BLURBS, PRICED_PLAN_ORDER } from '../../../utils/plan-features';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../../../contexts/TenantContext', () => ({ useTenantOptional: () => null }));
const { mockAuthFetch } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(async () => ({ json: async () => ({ url: '' }) })),
}));
vi.mock('../../../utils/auth-fetch', () => ({ authFetch: mockAuthFetch }));

let container: HTMLDivElement;
let root: Root;

function mount(props: React.ComponentProps<typeof PlanUpgradeSection>) {
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection tenantId="t1" processor="dodo" {...props} />);
  });
}

beforeEach(() => {
  (window as unknown as { alert: () => void }).alert = () => {};
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

const track = () => container.querySelector<HTMLElement>('[data-testid="plan-card-track"]')!;
const manage = () => container.querySelector<HTMLElement>('[data-testid="billing-manage-action"]')!;

describe('plan card copy says campus, not church', () => {
  it('prints "Unlimited campuses" and never "Unlimited churches"', () => {
    mount({ currentPlan: 'church' });
    expect(container.textContent).toContain('Unlimited campuses');
    expect(container.textContent).not.toMatch(/Unlimited churches/i);
  });

  it('prints the campus blurb on the Ministry card', () => {
    mount({ currentPlan: 'church' });
    const max = container.querySelector('[data-testid="plan-card"][data-plan="ministry"]')!;
    expect(max.querySelector('[data-testid="plan-card-blurb"]')!.textContent!.trim())
      .toBe('For ministries with many communities and campuses.');
    expect(PLAN_BLURBS.ministry).toBe('For ministries with many communities and campuses.');
    expect(container.textContent).not.toMatch(/established churches/i);
  });

  it('prints a campus line on every priced tier that includes one, and no church line', () => {
    mount({ currentPlan: 'church' });
    const floor = container.querySelector(`[data-plan="${PRICED_PLAN_ORDER[0]}"][data-testid="plan-card"]`)!;
    expect(floor.querySelector('[data-feature="maxChurches"]')!.textContent).toMatch(/campuses/);
    expect(container.querySelector('[data-feature="maxChurches"]')!.textContent).not.toMatch(/church/i);
  });
});

describe('the compact prop', () => {
  it('stacks the plan cards one per row', () => {
    mount({ currentPlan: 'church', compact: true });
    expect(track().style.display).toBe('grid');
    expect(track().style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(track().style.overflow).toBe('visible');
  });

  it('leaves the default layout exactly as it was', () => {
    mount({ currentPlan: 'church' });
    expect(track().style.display).toBe('');
    expect(track().style.gridTemplateColumns).toBe('');
    expect(track().className).toContain('snap-x');
    // Two cards now, so the three-column step is gone and two columns remain.
    expect(track().className).toContain('sm:grid-cols-2');
    expect(track().className).not.toContain('lg:grid-cols-3');
  });

  it('draws Manage Subscription as the shadcn Button on theme tokens', () => {
    mount({ currentPlan: 'church', compact: true });
    expect(manage().getAttribute('data-slot')).toBe('button');
    expect(manage().className).not.toMatch(/\bbg-earth\b|\bdark:bg-cream\b|\btext-cream\b|dark:hover:bg-stone-200/);
    expect(manage().textContent).toBe('Manage Subscription');
  });

  it('keeps the original Manage Subscription button outside the popup', () => {
    mount({ currentPlan: 'church' });
    expect(manage().getAttribute('data-slot')).toBeNull();
    expect(manage().className).toContain('bg-earth');
  });

  it.each([true, false])('compact=%s opens the same billing portal route with the same body', async (compact) => {
    mockAuthFetch.mockClear();
    mount({ currentPlan: 'church', compact });
    await act(async () => { manage().click(); });
    await act(async () => { await Promise.resolve(); });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/stripe/portal', {
      method: 'POST',
      body: JSON.stringify({ tenantId: 't1' }),
    });
  });
});
