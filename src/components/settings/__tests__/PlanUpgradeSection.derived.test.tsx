import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TenantPlan } from '../../../types/tenant.types';

/**
 * THE-192 — 🔴 PR 333's GUARANTEE, MADE LOAD-BEARING.
 *
 * The claim the cards have carried since THE-161 is that every line comes out
 * of `getPlanFeatures` — "flipping `crm` on `plus` moved the card with no
 * edit". The tests that guarded it checked the SOURCING: each line names a
 * matrix cell, and that cell is unlocked on the tier. They did not check the
 * TEXT, so a line reading "Unlimited everything" against a `data-feature="blog"`
 * passed the whole suite. That is not a hypothetical — it is a mutation that
 * survived every assertion in this repo before this file existed.
 *
 * Two things are checked here that cannot be checked from the rendered tree
 * alone:
 *
 *  1. A NUMERIC line carries the tier's own number. The card may word the noun
 *     however it likes; it may not print a number the matrix did not give it.
 *  2. MOVING A CELL MOVES THE CARD. The matrix is replaced at import time and
 *     the cards are re-read, so this exercises the derivation itself rather
 *     than the copy that happens to be in the matrix today.
 *
 * The matrix is stubbed through the module boundary, so nothing here depends on
 * which cells are true on which tier this week.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { override } = vi.hoisted(() => ({
  override: { rows: null as Record<string, Record<string, unknown>> | null },
}));

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../../../utils/plan-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/plan-features')>();
  return {
    ...actual,
    getPlanFeatures: (plan: TenantPlan) => {
      const real = actual.getPlanFeatures(plan);
      const patch = override.rows?.[plan];
      return patch ? { ...real, ...patch } : real;
    },
  };
});

import PlanUpgradeSection from '../PlanUpgradeSection';
import {
  getPlanFeatures,
  PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
  UNLIMITED_CAP,
} from '../../../utils/plan-features';

let container: HTMLDivElement;
let root: Root | null = null;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection />);
  });
}

function unmount() {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
}

/** The lines a tier's card prints, as [cell, text] pairs. */
function linesOf(plan: TenantPlan): Array<[string, string]> {
  return Array.from(
    container.querySelectorAll(`[data-testid="plan-card-features"][data-plan="${plan}"] > li`),
  ).map((li) => [li.getAttribute('data-feature') ?? '', (li.textContent || '').trim()]);
}

/** Which cells are numbers, read off the matrix rather than named here. */
const numericCells = (): string[] =>
  Object.entries(getPlanFeatures('max') as unknown as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number')
    .map(([k]) => k);

beforeEach(() => { override.rows = null; });
afterEach(() => { unmount(); });

describe('the feature list is derived from getPlanFeatures, not hardcoded strings', () => {
  it('prints the tier\'s own number on every numeric line', () => {
    mount();
    let checked = 0;
    for (const plan of PLAN_ORDER) {
      const features = getPlanFeatures(plan) as unknown as Record<string, unknown>;
      for (const [cell, text] of linesOf(plan)) {
        if (!numericCells().includes(cell)) continue;
        const value = features[cell] as number;
        const expected = value === UNLIMITED_CAP ? 'Unlimited' : value.toLocaleString();
        expect(
          text,
          `${PLAN_DISPLAY_NAMES[plan]} prints "${text}" for ${cell}, which the matrix has at ${value}`,
        ).toContain(expected);
        checked += 1;
      }
    }
    // The loop must have had something to check, or it proves nothing.
    expect(checked, 'no numeric line was rendered at all').toBeGreaterThan(0);
  });

  it('moves the card when a cell moves, with no edit to the component', () => {
    // A capability the bottom tier does not have today, taken from what the
    // top tier prints rather than named here — so this does not go stale when
    // the matrix is repriced.
    mount();
    const topOnly = linesOf('max').find(([cell]) => cell !== '' && typeof (getPlanFeatures('plus') as unknown as Record<string, unknown>)[cell] === 'boolean');
    expect(topOnly, 'the top tier adds no boolean line to move').toBeTruthy();
    const [cell, text] = topOnly!;
    expect(linesOf('plus').map(([c]) => c)).not.toContain(cell);
    unmount();

    // Grant it to the bottom tier. Nothing in the component changes.
    override.rows = { plus: { [cell]: true } };
    mount();
    expect(linesOf('plus').map(([c]) => c), `${cell} did not reach the Individual card`).toContain(cell);
    // …with the same wording it had on the tier that already had it.
    expect(linesOf('plus').find(([c]) => c === cell)![1]).toBe(text);
    // …and it drops off the tier above, because that tier no longer ADDS it.
    expect(linesOf('pro').map(([c]) => c)).not.toContain(cell);
    unmount();

    // Take it away from everyone: it leaves every card.
    override.rows = Object.fromEntries(PLAN_ORDER.map((p) => [p, { [cell]: false }]));
    mount();
    for (const plan of PLAN_ORDER) {
      expect(linesOf(plan).map(([c]) => c), PLAN_DISPLAY_NAMES[plan]).not.toContain(cell);
    }
  });

  it('follows a cap that moves, on the card that names it', () => {
    mount();
    const capCell = linesOf('plus').find(([cell]) => numericCells().includes(cell))![0];
    unmount();

    override.rows = { plus: { [capCell]: 4242 } };
    mount();
    const line = linesOf('plus').find(([c]) => c === capCell);
    expect(line, `${capCell} left the Individual card`).toBeTruthy();
    expect(line![1]).toContain('4,242');
  });

  it('prints an unlimited cap as unlimited, not as its sentinel', () => {
    mount();
    const capCell = linesOf('plus').find(([cell]) => numericCells().includes(cell))![0];
    unmount();

    override.rows = { plus: { [capCell]: UNLIMITED_CAP } };
    mount();
    const line = linesOf('plus').find(([c]) => c === capCell)!;
    expect(line[1]).toContain('Unlimited');
    expect(line[1], 'the sentinel leaked to the card').not.toContain(String(UNLIMITED_CAP));
  });
});
