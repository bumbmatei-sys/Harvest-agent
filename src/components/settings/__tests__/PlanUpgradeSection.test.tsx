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
    // 🔴 THE-196 flipped the hierarchy. The PER-MONTH figure headlines the
    // card and the charged total sits beneath it.
    //
    // ⚠️ MINISTRY CARRIES CENTS AGAIN SINCE THE-372. $752/12 is $62.6667,
    // ceiled to $62.67 — THE-343's $564 had divided to a clean $47. The
    // ceiling keeps $62.67 x 12 = $752.04 at or above the charged total.
    expect(container.textContent).toContain('$62.67');
    expect(container.textContent).toContain('billed as $752 every 12 months');
  });

  it('derives the yearly copy from PLAN_PRICING for Individual (plus)', () => {
    mount();
    clickButtonWithText('Yearly');
    // $190/12 is $15.8333, ceiled to $15.84. THE-222 left Individual as the one
    // yearly cell that divided cleanly ($13.75); THE-248 removes that — all
    // three years now carry a ceiling artefact, and all three quarters lost
    // theirs instead.
    expect(container.textContent).toContain('$15.84');
    expect(container.textContent).toContain('billed as $190 every 12 months');
  });

  it('derives the quarterly copy, the term this change added', () => {
    mount();
    clickButtonWithText('Quarterly');
    // 🔴 ALL THREE QUARTERS STILL DIVIDE EXACTLY — $54/3, $108/3 and $216/3
    // are $18, $36 and $72 — so none of them shows cents. Each headline
    // is asserted beside the charged line that names its cycle rather than on
    // its own, because a bare "$36" says nothing about which tier drew it.
    expect(container.textContent).toContain('$18');
    expect(container.textContent).toContain('billed as $54 every 3 months');
    expect(container.textContent).toContain('$36');
    expect(container.textContent).toContain('billed as $108 every 3 months');
    expect(container.textContent).toContain('$72');
    expect(container.textContent).toContain('billed as $216 every 3 months');
  });

  it('leaves the monthly view unchanged', () => {
    mount();
    // Monthly is the default tab; assert the monthly prices render and no
    // longer-term copy (old strikethrough or the equivalent line) leaks in.
    expect(container.textContent).toContain('$20/mo');
    expect(container.textContent).toContain('$80/mo');
    expect(container.textContent).not.toContain('equivalent');
    // 🔴 MONTHLY RENDERS AS DECIDED: headline alone, no note beneath. On
    // monthly the headline already IS the charged amount on the charged cycle,
    // so "billed as $20 every 1 month" would be the same sentence twice.
    expect(container.textContent).not.toContain('billed as');
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
