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
    expect(container.textContent).not.toContain('/mo equivalent');
  });

  it('shows no struck-through price on the yearly view, for any plan', () => {
    mount();
    clickButtonWithText('Yearly');
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });

  it('derives the yearly copy from PLAN_PRICING for Ministry (max)', () => {
    mount();
    clickButtonWithText('Yearly');
    // 🔴 The CHARGED figure headlines the card: $1,329 a year, on the yearly
    // cycle. $1329/12 is $110.75, so the equivalent rounds to $111 — and it
    // never appears without the total and the cadence that produce it.
    expect(container.textContent).toContain('$1,329/yr');
    expect(container.textContent).toContain('$111/mo equivalent — billed as $1,329 every 12 months');
  });

  it('derives the yearly copy from PLAN_PRICING for Individual (plus)', () => {
    mount();
    clickButtonWithText('Yearly');
    expect(container.textContent).toContain('$329/yr');
    // $329/12 is $27.42 — the figure that must never stand on its own.
    expect(container.textContent).toContain('$27/mo equivalent — billed as $329 every 12 months');
  });

  it('derives the quarterly copy, the term this change added', () => {
    mount();
    clickButtonWithText('Quarterly');
    expect(container.textContent).toContain('$99/qtr');
    expect(container.textContent).toContain('$33/mo equivalent — billed as $99 every 3 months');
    expect(container.textContent).toContain('$399/qtr');
  });

  it('leaves the monthly view unchanged', () => {
    mount();
    // Monthly is the default tab; assert the monthly prices render and no
    // longer-term copy (old strikethrough or the equivalent line) leaks in.
    expect(container.textContent).toContain('$39/mo');
    expect(container.textContent).toContain('$159/mo');
    expect(container.textContent).not.toContain('equivalent');
    expect(container.querySelectorAll('.line-through').length).toBe(0);

    // Round-trip back through both longer terms confirms the monthly view
    // stays clean too.
    clickButtonWithText('Yearly');
    clickButtonWithText('Quarterly');
    clickButtonWithText('Monthly');
    expect(container.textContent).not.toContain('equivalent');
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });
});
