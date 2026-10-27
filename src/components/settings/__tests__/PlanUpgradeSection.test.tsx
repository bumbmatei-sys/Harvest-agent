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

  it('derives the yearly copy from PLAN_PRICING for Ministry', () => {
    mount();
    clickButtonWithText('Yearly');
    // 🔴 THE-196 flipped the hierarchy. The PER-MONTH figure headlines the
    // card and the charged total sits beneath it. $900/12 divides cleanly to
    // $75, so "2 months free" carries no ceiling artefact on this tier.
    expect(container.textContent).toContain('$75');
    expect(container.textContent).toContain('billed as $900 every 12 months');
  });

  it('derives the yearly copy from PLAN_PRICING for Church', () => {
    mount();
    clickButtonWithText('Yearly');
    // $300/12 is a clean $25.
    expect(container.textContent).toContain('$25');
    expect(container.textContent).toContain('billed as $300 every 12 months');
  });

  it('offers no quarterly term — it was withdrawn on 2026-10-23', () => {
    mount();
    // The term picker is Monthly and Yearly. A quarterly button, or any copy
    // that bills "every 3 months", would be selling a product that no longer
    // exists in Dodo.
    expect(container.textContent).not.toContain('Quarterly');
    expect(container.textContent).not.toContain('every 3 months');
    for (const label of ['Monthly', 'Yearly']) {
      clickButtonWithText(label);
      expect(container.textContent).not.toContain('every 3 months');
    }
  });

  it('leaves the monthly view unchanged', () => {
    mount();
    // Monthly is the default tab; assert the monthly prices render and no
    // longer-term copy (old strikethrough or the equivalent line) leaks in.
    expect(container.textContent).toContain('$30/mo');
    expect(container.textContent).toContain('$90/mo');
    expect(container.textContent).not.toContain('equivalent');
    // 🔴 MONTHLY RENDERS AS DECIDED: headline alone, no note beneath. On
    // monthly the headline already IS the charged amount on the charged cycle,
    // so "billed as $30 every 1 month" would be the same sentence twice.
    expect(container.textContent).not.toContain('billed as');
    expect(container.querySelectorAll('.line-through').length).toBe(0);

    // Round-trip back through the longer term confirms the monthly view
    // stays clean too.
    clickButtonWithText('Yearly');
    clickButtonWithText('Monthly');
    expect(container.textContent).not.toContain('equivalent');
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });
});
