import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlanUpgradeSection from '../PlanUpgradeSection';
import {
  getPlanFeatures,
  formatPlanPrice,
  formatPlanMonthlyHeadline,
  PLAN_ORDER,
  PLAN_PRICING,
  PLAN_DISPLAY_NAMES,
  BILLING_TERMS,
  planPriceUsd,
  PLAN_BLURBS,
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

    // Each card must then print exactly the nameable cells ITS tier unlocks AND
    // the tier below it does not — no more (an unearned claim, or a line the
    // rollup already covers) and no fewer (a silently dropped one). The bottom
    // tier has nothing below it and prints its list whole.
    //
    // 🔴 The delta is recomputed here from `getPlanFeatures` alone. Nothing in
    // this test knows which lines Small Team or Ministry are supposed to show;
    // flip a cell in the matrix and both sides of the comparison move together,
    // which is the guarantee — a hand-written list would fail the moment the
    // matrix and the JSX disagreed.
    for (const [index, plan] of PLAN_ORDER.entries()) {
      const features = getPlanFeatures(plan) as unknown as Record<string, unknown>;
      const below = index > 0
        ? (getPlanFeatures(PLAN_ORDER[index - 1]) as unknown as Record<string, unknown>)
        : null;
      const expected = [...nameable]
        .filter((cell) => unlocked(features[cell]))
        // A cell is inherited when the tier below already has it AT THE SAME
        // VALUE. A cap that grew (150 → 500 contacts) is a new line; a cap that
        // did not (1 church on every tier) is not.
        .filter((cell) => below === null || below[cell] !== features[cell])
        .sort();
      expect(shownCells(plan).slice().sort(), PLAN_DISPLAY_NAMES[plan]).toEqual(expected);
    }
  });

  it('opens Small Team and Ministry with a rollup line instead of repeating the tier below', () => {
    mount();

    const rollupOf = (plan: TenantPlan): string | null =>
      card(plan).querySelector('[data-testid="plan-card-rollup"]')?.textContent?.trim() ?? null;

    // Individual is the floor: nothing to roll up, so no line.
    expect(rollupOf('plus')).toBeNull();
    expect(rollupOf('pro')).toBe(`Everything in ${PLAN_DISPLAY_NAMES.plus}`);
    expect(rollupOf('max')).toBe(`Everything in ${PLAN_DISPLAY_NAMES.pro}`);

    // And the rollup is load-bearing, not decoration: each upper card is
    // strictly shorter than the full list its tier unlocks, because the shared
    // lines are the ones the rollup stands in for.
    const nameable = new Set<string>();
    for (const plan of PLAN_ORDER) shownCells(plan).forEach((cell) => nameable.add(cell));
    for (const plan of ['pro', 'max'] as const) {
      const features = getPlanFeatures(plan) as unknown as Record<string, unknown>;
      const whole = [...nameable].filter((cell) => unlocked(features[cell]));
      expect(shownCells(plan).length, PLAN_DISPLAY_NAMES[plan]).toBeLessThan(whole.length);
      expect(shownCells(plan).length, PLAN_DISPLAY_NAMES[plan]).toBeGreaterThan(0);
    }
  });

  it('renders the blurb for each tier from plan-features, not from the component', () => {
    mount();
    for (const plan of PLAN_ORDER) {
      const blurb = card(plan).querySelector('[data-testid="plan-card-blurb"]');
      expect(blurb, `no blurb on the ${PLAN_DISPLAY_NAMES[plan]} card`).toBeTruthy();
      expect(blurb!.textContent!.trim(), PLAN_DISPLAY_NAMES[plan]).toBe(PLAN_BLURBS[plan]);
    }
    // Three distinct sentences — a card printing the same one three times would
    // otherwise satisfy the loop above.
    expect(new Set(PLAN_ORDER.map((p) => PLAN_BLURBS[p])).size).toBe(PLAN_ORDER.length);
    // And the component does not carry its own copy of any of them.
    const src = readFileSync(COMPONENT, 'utf8');
    for (const plan of PLAN_ORDER) expect(src).not.toContain(PLAN_BLURBS[plan]);
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
    // The change, seen from the surface a church actually reads. CRM is on the
    // BOTTOM tier's card, which under the rollup is what puts it on all three:
    // Small Team opens "Everything in Individual" and Ministry opens
    // "Everything in Small Team", so a line on Individual is carried up rather
    // than repeated. Asserting it three times would be asserting that the
    // rollup does NOT work.
    mount();
    expect(shownCells('plus')).toContain('crm');
    for (const plan of PLAN_ORDER) {
      expect(getPlanFeatures(plan).crm, PLAN_DISPLAY_NAMES[plan]).toBe(true);
      expect(shownCells(plan), PLAN_DISPLAY_NAMES[plan]).not.toHaveLength(0);
    }
    // …and Notes still only above Individual, on the same surface.
    expect(shownCells('plus')).not.toContain('docs');
    expect(shownCells('pro')).toContain('docs');
  });

  it('keeps the three-term toggle working and the current plan marked', () => {
    mount({ currentPlan: 'pro' });

    const marked = () =>
      Array.from(container.querySelectorAll('[data-testid="plan-card"]'))
        .filter((el) => el.querySelector('[data-testid="plan-card-current"]'))
        .map((el) => el.getAttribute('data-plan'));

    expect(marked()).toEqual(['pro']);
    const currentButton = card('pro').querySelector('button')!;
    expect(currentButton.textContent).toContain('Current Plan');
    expect((currentButton as HTMLButtonElement).disabled).toBe(true);

    // Monthly is the default. On monthly the headline and the charged price
    // coincide, so it still reads exactly what formatPlanPrice returns.
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'monthly'));
    }
    expect(container.textContent).not.toContain('equivalent');
    expect(container.textContent).not.toContain('billed as');

    // 🔴 THE-196: every term, including the new middle one. The headline is now
    // the PER-MONTH figure — "$33/mo" — and the charged total sits beneath it.
    clickButtonWithText('Quarterly');
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan])
        .toBe(`${formatPlanMonthlyHeadline(plan, 'quarterly')}/mo`);
    }
    // …and the per-month headline never appears without the charged total.
    expect(container.textContent).toContain('billed as');
    expect(container.textContent).toContain('every 3 months');

    clickButtonWithText('Yearly');
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan])
        .toBe(`${formatPlanMonthlyHeadline(plan, 'yearly')}/mo`);
    }
    expect(container.textContent).toContain('every 12 months');
    // The marker survives the toggle — the two are independent state.
    expect(marked()).toEqual(['pro']);

    clickButtonWithText('Monthly');
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'monthly'));
    }
    expect(marked()).toEqual(['pro']);
  });

  it('renders the repriced tiers on every term', () => {
    // The nine published numbers. There is no annual identity to derive any
    // more — the prices ARE the source, so each is asserted outright.
    expect(PLAN_PRICING.plus.monthly).toBe(39);
    expect(PLAN_PRICING.pro.monthly).toBe(79);
    expect(PLAN_PRICING.max.monthly).toBe(159);
    for (const plan of PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(planPriceUsd(plan, term), `${PLAN_DISPLAY_NAMES[plan]} ${term}`)
          .toBe(PLAN_PRICING[plan][term]);
      }
    }

    // And the cards render those, rather than a literal of their own.
    mount();
    for (const plan of PLAN_ORDER) {
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan]).toBe(formatPlanPrice(plan, 'monthly'));
    }
    clickButtonWithText('Yearly');
    for (const plan of PLAN_ORDER) {
      // The headline is the per-month figure; the charged yearly total is on
      // the line beneath, asserted just below.
      expect(priceOf(plan), PLAN_DISPLAY_NAMES[plan])
        .toBe(`${formatPlanMonthlyHeadline(plan, 'yearly')}/mo`);
      expect(
        card(plan).querySelector('[data-testid="plan-card-term-note"]')!.textContent,
        PLAN_DISPLAY_NAMES[plan],
      ).toBe(`billed as ${formatPlanPrice(plan, 'yearly').split('/')[0]} every 12 months`);
    }
  });

  it('hardcodes no colour', () => {
    const src = readFileSync(COMPONENT, 'utf8');

    // There used to be exactly three: the per-plan swatches on the PLANS table,
    // which painted a tinted icon disc at the top of each card. They belonged
    // to no palette in this app and themed in none of the four, and the icon
    // they coloured is not on the marketing card — so they are gone, and this
    // assertion is now the flat one rather than one with an exemption carved
    // into it. A hex anywhere in this file fails here.
    const hexLines = src
      .split('\n')
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line));
    expect(hexLines, `colour literal in the plan cards: ${hexLines.join(' | ')}`).toEqual([]);

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
