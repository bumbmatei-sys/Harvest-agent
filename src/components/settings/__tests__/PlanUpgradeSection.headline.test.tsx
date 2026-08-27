// 🔴 PRICED tiers only. This suite is about prices and rendered plan CARDS,
// and the Forever Free tier has neither a price nor a card (it has no Dodo
// product to check out with). PLAN_ORDER now includes it; PRICED_PLAN_ORDER is
// the list this file has always meant. See plan-features.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlanUpgradeSection from '../PlanUpgradeSection';
import {
  formatPlanPrice,
  formatPlanMonthlyHeadline,
  planTermMonthlyDisplayed,
  PRICED_PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
  BILLING_TERMS,
  TERM_MONTHS,
  planPriceUsd,
} from '../../../utils/plan-features';
import type { PricedPlan } from '../../../types/tenant.types';

/**
 * THE-196 — the in-app plan card leads with the per-month figure.
 *
 * The marketing site makes the same change in the same shape, and the two must
 * not disagree: a church can see the pricing page and this card in one session.
 * harvest-presentation-site/src/components/PriceHeadline.test.ts is the other
 * half, and carries this repo's headlines transcribed.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));

const COMPONENT = path.resolve(__dirname, '../PlanUpgradeSection.tsx');

let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection />);
  });
}

function clickTerm(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').trim().startsWith(text)
  );
  if (!button) throw new Error(`No button found starting with "${text}"`);
  act(() => { button.click(); });
}

const card = (plan: PricedPlan) =>
  container.querySelector<HTMLElement>(`[data-testid="plan-card"][data-plan="${plan}"]`)!;
const headlineOf = (plan: PricedPlan) =>
  card(plan).querySelector('[data-testid="plan-card-price"]')!.textContent!.trim();
const noteOf = (plan: PricedPlan) =>
  card(plan).querySelector('[data-testid="plan-card-term-note"]');

const TERM_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' } as const;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe('THE-196 — the per-month headline on the in-app card', () => {
  it('the headline is the per-month figure on every term and tier', () => {
    mount();
    for (const term of BILLING_TERMS) {
      clickTerm(TERM_LABEL[term]);
      for (const plan of PRICED_PLAN_ORDER) {
        expect(headlineOf(plan), `${PLAN_DISPLAY_NAMES[plan]} ${term}`)
          .toBe(`${formatPlanMonthlyHeadline(plan, term)}/mo`);
      }
    }
  });

  it('the term total is rendered beneath it on quarterly and yearly', () => {
    mount();
    for (const term of ['quarterly', 'yearly'] as const) {
      clickTerm(TERM_LABEL[term]);
      for (const plan of PRICED_PLAN_ORDER) {
        const note = noteOf(plan);
        expect(note, `${PLAN_DISPLAY_NAMES[plan]} ${term}`).not.toBeNull();
        expect(note!.textContent).toBe(
          `billed as ${formatPlanPrice(plan, term).split('/')[0]} every ${TERM_MONTHS[term]} months`,
        );
      }
    }
  });

  it('monthly renders as decided: headline alone, no line beneath', () => {
    // 🔴 The decided behaviour, named. On monthly the headline already IS the
    // charged amount on the charged cycle. No spacer either: the toggle is
    // global, so all three cards lose the row together and cannot misalign.
    mount();
    clickTerm('Monthly');
    for (const plan of PRICED_PLAN_ORDER) {
      expect(noteOf(plan)).toBeNull();
      expect(headlineOf(plan)).toBe(formatPlanPrice(plan, 'monthly'));
    }
    expect(container.textContent).not.toContain('billed as');
  });

  it('the per-month headline never states a figure that implies less than the charged total', () => {
    // 🔴 THE HONESTY GUARD on rendered output — one assertion per tier per
    // term, nine in all. Under the old Math.round, Individual yearly headlined
    // $27, which implies $324 against a charged $329.
    mount();
    for (const term of BILLING_TERMS) {
      clickTerm(TERM_LABEL[term]);
      for (const plan of PRICED_PLAN_ORDER) {
        const headline = Number(headlineOf(plan).replace(/[^0-9.]/g, ''));
        const implied = headline * TERM_MONTHS[term];
        const charged = planPriceUsd(plan, term);
        expect(
          implied,
          `${PLAN_DISPLAY_NAMES[plan]} ${term}: $${headline}/mo implies $${implied.toFixed(2)}, charged $${charged}`,
        ).toBeGreaterThanOrEqual(charged);
        // Derived bound: ceiling at the cent adds at most one cent per month,
        // so `months × $0.01`. It was a flat 0.05 — the worst gap THE-222's
        // prices happened to give — and THE-248's $760 year overshoots by
        // $0.08 without breaking the rule at all.
        expect(implied - charged, `${plan} ${term}`)
          .toBeLessThan(TERM_MONTHS[term] * 0.01 + 1e-9);
      }
    }
  });

  it('the term total line is at least 11px as rendered and meets AA contrast', () => {
    /* ⚠️ The card styles with utilities, so the size is asserted as the class
       that produces it and the token is resolved against globals.css.

       `text-[12.5px]` rather than `text-xs`: the desktop rem base is 14.5px
       from 1024px up, where text-xs computes to 10.875px — under the floor. An
       explicit px size cannot drift with the base, which is the whole reason
       it is written this way.

       Contrast, measured from the tokens in globals.css:
         --text-muted #68563F on --surface-raised #FFFFFF   7.02:1
         --cream #FAF8F5 at 80% on --surface-night #0C1526  11.23:1
       Both clear AA (4.5:1) for normal text. The previous `text-faint`
       (#766A5A, 5.28:1) and `cream/70` also cleared it — the change is that
       the figure a church is billed should not be the quietest ink on a card
       whose loudest figure is one nobody is billed. */
    mount();
    clickTerm('Yearly');
    for (const plan of PRICED_PLAN_ORDER) {
      const cls = noteOf(plan)!.className;
      expect(cls, PLAN_DISPLAY_NAMES[plan]).toContain('text-[12.5px]');
      expect(cls).not.toMatch(/\btext-xs\b/);
      expect(cls).toMatch(/text-cream\/80|text-muted/);
      expect(cls).not.toMatch(/text-faint|text-cream\/70/);
    }

    // The tokens really are what the comment says they are.
    const globals = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');
    expect(globals).toContain('--text-muted:   #68563F;');
    expect(globals).toContain('--surface-raised:  #FFFFFF;');
  });

  it('no font size below 11px is written into the price block', () => {
    // Scoped to this component's price block: an arbitrary `text-[10px]` on the
    // headline or the line beneath is the regression worth catching.
    const src = readFileSync(COMPONENT, 'utf8');
    const block = src.slice(src.indexOf('data-testid="plan-card-price"'), src.indexOf('plan-card-blurb'));
    for (const m of block.matchAll(/text-\[([0-9.]+)px\]/g)) {
      expect(Number(m[1]), `price block has ${m[1]}px text`).toBeGreaterThanOrEqual(11);
    }
  });

  it('the in-app card and the site card present a price the same way', () => {
    /* 🔴 THE CROSS-SURFACE CONTRACT, this repo's half. The site cannot import
       this module, so both repos carry the same nine strings and the same
       wording, and a one-sided change fails one of them.

       harvest-presentation-site renders, in src/components/Pricing.tsx:
         headline   formatMonthlyHeadline(price, term) + "/mo"
         beneath    `billed as $${price} every ${TERM_MONTHS[term]} months`
         monthly    headline alone, no line beneath                            */
    const SITE_HEADLINES: Record<PricedPlan, Record<string, string>> = {
      plus: { monthly: '$20', quarterly: '$18', yearly: '$15.84' },
      pro:  { monthly: '$40', quarterly: '$36', yearly: '$31.67' },
      max:  { monthly: '$80', quarterly: '$72', yearly: '$63.34' },
    };
    mount();
    for (const term of BILLING_TERMS) {
      clickTerm(TERM_LABEL[term]);
      for (const plan of PRICED_PLAN_ORDER) {
        expect(formatPlanMonthlyHeadline(plan, term), `${plan} ${term}`)
          .toBe(SITE_HEADLINES[plan][term]);
        expect(headlineOf(plan)).toBe(`${SITE_HEADLINES[plan][term]}/mo`);
      }
    }
  });

  it('the nine prices are unchanged and still match the Dodo catalogue', () => {
    // Presentation only. Nothing in THE-196 may move a price.
    expect(PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, 'monthly'))).toEqual([20, 40, 80]);
    expect(PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, 'quarterly'))).toEqual([54, 108, 216]);
    expect(PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, 'yearly'))).toEqual([190, 380, 760]);
    // …and the displayed figure is derived from them, never stored beside them.
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(planTermMonthlyDisplayed(plan, term) * TERM_MONTHS[term])
          .toBeGreaterThanOrEqual(planPriceUsd(plan, term));
      }
    }
  });
});
