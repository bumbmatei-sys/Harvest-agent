import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlanUpgradeSection from '../PlanUpgradeSection';
import {
  getPlanFeatures,
  formatPlanPrice,
  PLAN_ORDER,
  PLAN_PRICING,
  PLAN_DISPLAY_NAMES,
  ANNUAL_BILLED_MONTHS,
} from '../../../utils/plan-features';
import type { TenantPlan } from '../../../types/tenant.types';

/**
 * THE-161 — the billing page's plan cards.
 *
 * The "Full Feature Comparison" table is deleted; the cards are the comparison
 * now. What these pin is not the layout but the SOURCING: every line a card
 * prints has to come from `getPlanFeatures`, because the alternative — a
 * hand-written list of what each tier includes — is how this product once
 * advertised "keeps 100%" against a real 2.5% fee, and how a `$59/mo` figure
 * outlived a reprice.
 *
 * Rendered with react-dom directly, matching PlanUpgradeSection.test.tsx.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));

const COMPONENT = path.resolve(__dirname, '../PlanUpgradeSection.tsx');

let container: HTMLDivElement;
let root: Root;

function mount(props: { currentPlan?: TenantPlan } = {}) {
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection {...props} />);
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

/** The card for one tier, found by its plan label rather than by position. */
function card(plan: TenantPlan): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="plan-card"][data-plan="${plan}"]`);
  if (!el) throw new Error(`No plan card for ${PLAN_DISPLAY_NAMES[plan]}`);
  return el;
}

/** The feature lines a tier's card prints, as the matrix cells they name. */
function shownCells(plan: TenantPlan): string[] {
  return Array.from(
    container.querySelectorAll(`[data-testid="plan-card-features"][data-plan="${plan}"] > *`)
  ).map((li) => li.getAttribute('data-feature') ?? '');
}

function priceOf(plan: TenantPlan): string {
  return card(plan).querySelector('[data-testid="plan-card-price"]')!.textContent!.trim();
}

/** `hasFeature`'s definition of "unlocked", not a second one. */
function unlocked(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

describe('PlanUpgradeSection plan cards', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  it('renders no Full Feature Comparison table', () => {
    mount();
    expect(container.textContent).not.toContain('Full Feature Comparison');
    expect(container.querySelector('table')).toBeNull();
    // The cards survived the deletion — this must not pass by rendering nothing.
    expect(container.querySelectorAll('[data-testid="plan-card"]')).toHaveLength(PLAN_ORDER.length);
  });

  it('derives every card feature list from getPlanFeatures', () => {
    mount();

    // The cells the cards are willing to name, taken from the DOM itself so this
    // test never restates the component's own list.
    const nameable = new Set<string>();
    for (const plan of PLAN_ORDER) shownCells(plan).forEach((cell) => nameable.add(cell));
    expect(nameable.size).toBeGreaterThan(0);

    // Each card must then print exactly the nameable cells ITS tier unlocks —
    // no more (an unearned claim) and no fewer (a silently dropped one).
    for (const plan of PLAN_ORDER) {
      const features = getPlanFeatures(plan) as unknown as Record<string, unknown>;
      const expected = [...nameable].filter((cell) => unlocked(features[cell])).sort();
      expect(shownCells(plan).slice().sort(), PLAN_DISPLAY_NAMES[plan]).toEqual(expected);
    }
  });

  it('hardcodes no feature copy in the card list', () => {
    mount();
    const cells = new Set(Object.keys(getPlanFeatures('max')));

    for (const plan of PLAN_ORDER) {
      const list = container.querySelector(
        `[data-testid="plan-card-features"][data-plan="${plan}"]`
      );
      expect(list, `no feature list on the ${PLAN_DISPLAY_NAMES[plan]} card`).toBeTruthy();
      const lines = Array.from(list!.children);
      expect(lines.length, `the ${PLAN_DISPLAY_NAMES[plan]} card lists nothing`).toBeGreaterThan(0);

      for (const line of lines) {
        const cell = line.getAttribute('data-feature');
        // Every line must name the matrix cell it came from. A line typed
        // straight into the JSX names none, and fails here.
        expect(
          cell,
          `a line on the ${PLAN_DISPLAY_NAMES[plan]} card names no matrix cell: "${line.textContent?.trim()}"`
        ).toBeTruthy();
        // And the cell must be real, and unlocked on this tier — so a line
        // cannot be smuggled in under a borrowed or invented key either.
        expect(cells.has(cell!), `${cell} is not a PlanFeatures cell`).toBe(true);
        expect(
          unlocked((getPlanFeatures(plan) as unknown as Record<string, unknown>)[cell!]),
          `the ${PLAN_DISPLAY_NAMES[plan]} card claims ${cell}, which its tier does not include`
        ).toBe(true);
      }
    }
  });

  it('shows CRM on every tier, Individual included', () => {
    // The change, seen from the surface a church actually reads.
    mount();
    for (const plan of PLAN_ORDER) {
      expect(shownCells(plan), PLAN_DISPLAY_NAMES[plan]).toContain('crm');
    }
    // …and Notes still only above Individual, on the same surface.
    expect(shownCells('plus')).not.toContain('docs');
    expect(shownCells('pro')).toContain('docs');
  });

  it('keeps the monthly/annual toggle working and the current plan marked', () => {
    mount({ currentPlan: 'pro' });

    const marked = () =>
      Array.from(container.querySelectorAll('[data-testid="plan-card"]'))
        .filter((el) => el.querySelector('[data-testid="plan-card-current"]'))
        .map((el) => el.getAttribute('data-plan'));

    expect(marked()).toEqual(['pro']);
    const currentButton = card('pro').querySelector('button')!;
    expect(currentButton.textContent).toContain('Current Plan');
    expect((currentButton as HTMLButtonElement).disabled).toBe(true);

    // Monthly is the default.
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'monthly'));
    }
    expect(container.textContent).not.toContain('billed annually');

    clickButtonWithText('Yearly');
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'yearly'));
    }
    expect(container.textContent).toContain('billed annually');
    // The marker survives the toggle — the two are independent state.
    expect(marked()).toEqual(['pro']);

    clickButtonWithText('Monthly');
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'monthly'));
    }
    expect(marked()).toEqual(['pro']);
  });

  it('leaves every tier price unchanged', () => {
    // The published numbers, and the annual identity that derives from them.
    expect(PLAN_PRICING.plus.monthlyUsd).toBe(49);
    expect(PLAN_PRICING.pro.monthlyUsd).toBe(99);
    expect(PLAN_PRICING.max.monthlyUsd).toBe(199);
    for (const plan of PLAN_ORDER) {
      expect(PLAN_PRICING[plan].yearlyUsd, PLAN_DISPLAY_NAMES[plan]).toBe(
        PLAN_PRICING[plan].monthlyUsd * ANNUAL_BILLED_MONTHS
      );
    }

    // And the cards render those, rather than a literal of their own.
    mount();
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'monthly'));
    }
    clickButtonWithText('Yearly');
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'yearly'));
    }
  });

  it('hardcodes no colour', () => {
    const src = readFileSync(COMPONENT, 'utf8');

    // The only colour literals in the file are the per-plan swatches on the
    // PLANS table, which the cards read through `meta.color`. A hex anywhere
    // else — in the card markup, in a style prop — fails here.
    const hexLines = src
      .split('\n')
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line));
    expect(hexLines.length).toBeGreaterThan(0);
    for (const line of hexLines) {
      expect(line, `colour literal outside the PLANS table: ${line.trim()}`).toMatch(
        /\bid: '(plus|pro|max)'/
      );
    }

    // No raw rgb()/hsl() either — those theme no better than a hex does.
    expect(src).not.toMatch(/\b(rgb|hsl)a?\(/);
  });

  it('paints the cards from themed tokens, so both themes hold', () => {
    // Scoped to the cards, on the rendered DOM rather than the source, because
    // the file's other surfaces are not this change's.
    //
    // The neutral families below are FIXED literals in tailwind.config.ts
    // (stone: { 100: '#F3EEE7', … }) — unlike the surface/line/text tokens and
    // the green/amber scales, which resolve to CSS variables that swap under
    // `.dark`. A card reaching for one of these would look right in light and
    // wrong in dark, which is the defect this guards.
    mount();
    const classNames = Array.from(
      container.querySelectorAll('[data-testid="plan-card"]')
    ).flatMap((el) => [el, ...Array.from(el.querySelectorAll('*'))].map((n) => n.getAttribute('class') ?? ''));

    expect(classNames.length).toBeGreaterThan(0);
    for (const cls of classNames) {
      expect(cls, `fixed-palette class in a plan card: "${cls}"`).not.toMatch(
        /\b(bg|text|border)-(stone|slate|gray|zinc|neutral)-\d{2,3}\b/
      );
    }
  });
});
