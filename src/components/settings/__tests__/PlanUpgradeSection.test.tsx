import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PlanUpgradeSection from '../PlanUpgradeSection';

/**
 * Pins the "no fake struck-through anchor price" fix on the yearly toggle:
 * the annual card used to show a struck-through $monthly×12 figure that
 * implies a discount off a price that never existed. It's replaced with an
 * honest monthly-equivalent derived from PLAN_PRICING (same math as the
 * marketing site's Pricing.tsx: Math.round(monthlyUsd * 10 / 12)).
 *
 * Rendered with react-dom directly (not @testing-library/react), matching
 * ReferralTracker.test.tsx's approach — no @testing-library/dom dependency.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));

let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection />);
  });
}

function clickButtonWithText(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').trim().startsWith(text)
  );
  if (!button) throw new Error(`No button found starting with "${text}"`);
  act(() => {
    button.click();
  });
}

describe('PlanUpgradeSection yearly pricing copy', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  it('shows no struck-through price anywhere on the monthly view', () => {
    mount();
    expect(container.querySelectorAll('.line-through').length).toBe(0);
    expect(container.textContent).not.toContain('billed annually');
  });

  it('shows no struck-through price on the yearly view, for any plan', () => {
    mount();
    clickButtonWithText('Yearly');
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });

  it('derives the yearly monthly-equivalent copy from PLAN_PRICING for Grove (max)', () => {
    mount();
    clickButtonWithText('Yearly');
    // max: monthlyUsd 179 -> Math.round(179 * 10 / 12) = 149
    expect(container.textContent).toContain('$149/mo billed annually');
    // The real annual total comes from PLAN_PRICING.max.yearlyUsd.
    expect(container.textContent).toContain('$1,790/yr');
  });

  it('shows no annual copy at all on Seed (plus) — $0 has no billing period', () => {
    mount();
    clickButtonWithText('Yearly');
    // The free tier has no annual price, so "$0/mo billed annually" and
    // "Save 2 months" would both be meaningless. Neither renders; the other
    // three tiers still carry their annual copy (asserted above).
    expect(container.textContent).not.toContain('$0/mo billed annually');
  });

  it('leaves the monthly view unchanged', () => {
    mount();
    // Monthly is the default tab; assert the monthly prices render and no
    // yearly-only copy (old strikethrough or new annotation) leaks in.
    expect(container.textContent).toContain('$0/mo');
    expect(container.textContent).toContain('$179/mo');
    expect(container.textContent).not.toContain('billed annually');
    expect(container.querySelectorAll('.line-through').length).toBe(0);

    // Round-trip back from yearly confirms the monthly view stays clean too.
    clickButtonWithText('Yearly');
    clickButtonWithText('Monthly');
    expect(container.textContent).not.toContain('billed annually');
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });
});
