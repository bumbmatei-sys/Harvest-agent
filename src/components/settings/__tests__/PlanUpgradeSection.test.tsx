import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PlanUpgradeSection from '../PlanUpgradeSection';

/**
 * Pins the "no fake struck-through anchor price" fix on the yearly toggle:
 * the annual card used to show a struck-through $monthly×12 figure that
 * implies a discount off a price that never existed. It's replaced with an
 * honest monthly-equivalent derived from PLAN_PRICING (same math as the
 * marketing site's Pricing.tsx:
 * Math.round(monthlyUsd * ANNUAL_BILLED_MONTHS / 12)).
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

  it('derives the yearly monthly-equivalent copy from PLAN_PRICING for Community (max)', () => {
    mount();
    clickButtonWithText('Yearly');
    // max: monthlyUsd 199 -> Math.round(199 * 9 / 12) = 149, exactly.
    expect(container.textContent).toContain('$149/mo billed annually');
    // The real annual total comes from PLAN_PRICING.max.yearlyUsd.
    expect(container.textContent).toContain('$1,791/yr');
  });

  it('derives the yearly monthly-equivalent copy from PLAN_PRICING for Individual (plus)', () => {
    mount();
    clickButtonWithText('Yearly');
    // plus: monthlyUsd 49 -> Math.round(49 * 9 / 12) = 37
    expect(container.textContent).toContain('$37/mo billed annually');
    expect(container.textContent).toContain('$441/yr');
  });

  it('leaves the monthly view unchanged', () => {
    mount();
    // Monthly is the default tab; assert the monthly prices render and no
    // yearly-only copy (old strikethrough or new annotation) leaks in.
    expect(container.textContent).toContain('$49/mo');
    expect(container.textContent).toContain('$199/mo');
    expect(container.textContent).not.toContain('billed annually');
    expect(container.querySelectorAll('.line-through').length).toBe(0);

    // Round-trip back from yearly confirms the monthly view stays clean too.
    clickButtonWithText('Yearly');
    clickButtonWithText('Monthly');
    expect(container.textContent).not.toContain('billed annually');
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });
});
