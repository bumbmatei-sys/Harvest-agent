// 🔴 PRICED tiers only. This suite is about prices and rendered plan CARDS,
// and the Forever Free tier has neither a price nor a card (it has no Dodo
// product to check out with). PLAN_ORDER now includes it; PRICED_PLAN_ORDER is
// the list this file has always meant. See plan-features.ts.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE-192 — the in-app plan cards, made to match the marketing site.
 *
 * 🔴 THE LOAD-BEARING TEST IS THE FIRST ONE: three cards, no clip. Everything
 * else here is the marketing structure and the four palettes.
 *
 * ── WHAT WAS ACTUALLY BROKEN ────────────────────────────────────────────────
 * The plan row is `overflow-x-auto` with the scrollbar hidden
 * (`scrollbar-width: none` + a `::-webkit-scrollbar { display: none }` rule), so
 * on a desktop it did not scroll — it simply ended. Three `min-w-[280px]` cards
 * and two `gap-4`s need 869px at the 14.5px desktop rem base. The screen capped
 * itself at `max-w-3xl`, which is 696px at that base (NOT the 768px the class
 * name reads as), and the card panel's `p-5` took 36.25px more, leaving a
 * 659.75px track. 209.25px over, and 70.75px of the third card visible — a
 * column of checkmarks against truncated labels, which is exactly the founder's
 * screenshot.
 *
 * That measurement is re-derived below rather than asserted from memory: the
 * OLD class chain is carried in the fixture and resolved through the same CSS
 * engine as the new one, so section 1 proves the bug reproduces AND that it is
 * fixed, in the same units, from one model.
 *
 * ── HOW GEOMETRY IS MEASURED ────────────────────────────────────────────────
 * happy-dom has no layout engine, so nothing here reads `getBoundingClientRect`.
 * Instead the REAL Tailwind CSS is generated from tailwind.config.ts and each
 * class is resolved to the declarations it actually emits at a given viewport,
 * with rem lengths resolved against the ACTUAL root font-size — which
 * globals.css drops to 14.5px at `lg`. This is the idiom
 * AdminSettings.regroup.test.tsx established; a test that read class names and
 * believed them would have believed `max-w-3xl` was 768px, which is the whole
 * defect.
 *
 * ── HERMETIC BY CONSTRUCTION ────────────────────────────────────────────────
 * `actions/checkout` uses fetch-depth 1, so the runner holds one commit and any
 * older ref is unresolvable. There is exactly one `git` call in this file, it
 * lives in the recorder, and the recorder runs only under
 * UPDATE_LAYOUT_BASELINE. Every assertion reads the committed fixture. Section
 * 6 pins that.
 *
 * Targets are named by their label — heading text, button text, test id — never
 * by a value pattern, so a restyle that keeps the control does not fail and a
 * removal that keeps the styling does.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { runDodoPlanChangeMock, fetchBillingProcessorMock, authFetchMock } = vi.hoisted(() => ({
  runDodoPlanChangeMock: vi.fn(async () => ({ ok: true, message: 'Plan changed' })),
  fetchBillingProcessorMock: vi.fn(async () => 'stripe' as const),
  authFetchMock: vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ url: 'https://example.test/x' }) })),
}));

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../../../utils/auth-fetch', () => ({ authFetch: authFetchMock }));
vi.mock('../../../utils/plan-change', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/plan-change')>();
  return {
    ...actual,
    runDodoPlanChange: runDodoPlanChangeMock,
    fetchBillingProcessor: fetchBillingProcessorMock,
  };
});
vi.mock('../useTenantId', () => ({ getTenantId: async () => 'grace' }));

import PlanUpgradeSection from '../PlanUpgradeSection';
import {
  PRICED_PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
  PLAN_BLURBS,
  PLAN_PRICING,
  formatPlanPrice,
  formatPlanMonthlyHeadline,
} from '../../../utils/plan-features';
import { PLATFORM_FEE_MAP } from '../../../lib/stripe-connect';
import { FORM_CONTAINER } from '../../layout/form-layout';
import type { TenantPlan, PricedPlan } from '../../../types/tenant.types';
import {
  mobileLayer, classInventory, allTokens, isFontSizeToken, fontSizePx, isResponsive, breakpointOf,
  REM_PX_DESKTOP, BREAKPOINT_MIN_PX,
} from '../../../test/support/class-inventory';

const ROOT = path.resolve(__dirname, '../../../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const COMPONENT = path.join(ROOT, 'src/components/settings/PlanUpgradeSection.tsx');
const BILLING = path.join(ROOT, 'src/components/BillingAndPayments.tsx');
const SHELL = path.join(ROOT, 'src/components/AdminDashboard.tsx');
const FIXTURE = path.join(__dirname, 'plan-cards.baseline.json');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

/** 380/480/639 are phone widths; 768/1024/1280/1440 are the desktop ladder. */
const VIEWPORTS = [380, 480, 639, 768, 1024, 1280, 1440] as const;
const DESKTOP_VIEWPORTS = VIEWPORTS.filter((w) => w >= 640);
const MOBILE_VIEWPORTS = VIEWPORTS.filter((w) => w < 640);
/** The widths the phone rendering is hashed at — the three phones plus the
 *  first width where the `sm:` grid engages, so the boundary is in the record. */
const HASH_VIEWPORTS = [380, 480, 639, 768] as const;

/** The four palettes: two families × two modes. */
const PALETTES = [
  { family: 'harvest', mode: 'light' },
  { family: 'harvest', mode: 'dark' },
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
] as const;

/**
 * The floor a card may not go under. Not a design choice — 280px is the width
 * the cards already render at on a 380px phone, so a desktop column narrower
 * than this would be narrower than a width the markup demonstrably survives.
 */
const CARD_MIN_READABLE_PX = 280;

/** THE-190: the type floor. `text-xs` is 10.875px at the desktop base. */
const MIN_FONT_PX = 11;

interface Baseline {
  /** The class chain as it stood on `main`, for re-measuring the clip. */
  before: { overlay: string; container: string; panel: string; track: string; card: string };
  /** The same chain today, recorded so a silent rewrite of it is visible. */
  after: { overlay: string; container: string; panel: string; track: string; card: string };
  /** The sub-640px class layer of the whole section, per current plan. */
  mobileLayer: Record<string, string[]>;
  /** Element counts before/after, per current plan — the enumeration's arithmetic. */
  mobileElements: Record<string, { before: number; after: number }>;
}

let container: HTMLDivElement;
let root: Root | null = null;

function mount(props: { currentPlan?: TenantPlan; processor?: 'stripe' | 'dodo' | null } = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection tenantId="grace" {...props} />);
  });
  return container;
}

const classesOf = (el: Element): string[] => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

const card = (plan: PricedPlan): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[data-testid="plan-card"][data-plan="${plan}"]`);
  if (!el) throw new Error(`No plan card for ${PLAN_DISPLAY_NAMES[plan]}`);
  return el;
};
const track = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="plan-card-track"]')!;

/* ── the real Tailwind CSS ──────────────────────────────────────────────── */

interface Emitted { cls: string; minWidth: number; decls: Record<string, string>; child: boolean }
let emitted: Emitted[] = [];
let rootPx: Array<{ minWidth: number; size: number }> = [];
let baseline: Baseline;
/**
 * The chain AS THE SOURCE SPELLS IT TODAY. Every "after" measurement is made
 * against this, never against the fixture — a fixture measures the intent, and
 * the intent is not what clipped. `baseline.after` is a pin ON this, asserted
 * once below, so a deliberate change to the chain is visible in the diff and an
 * accidental one is a failure.
 */
let live: Baseline['after'];

beforeAll(async () => {
  rootPx = [{ minWidth: 0, size: 16 }];
  postcss.parse(readFileSync(GLOBALS, 'utf8')).walkAtRules('media', (at) => {
    const mq = at.params.match(/min-width:\s*([\d.]+)px/);
    if (!mq) return;
    at.walkRules((r) => {
      if (r.selector.trim() !== ':root') return;
      r.walkDecls('font-size', (d) => {
        const v = d.value.trim().match(/^([\d.]+)px$/);
        if (v) rootPx.push({ minWidth: Number(mq[1]), size: Number(v[1]) });
      });
    });
  });
  rootPx.sort((a, b) => a.minWidth - b.minWidth);

  baseline = recordOrRead();
  live = currentChain();

  // Every class the chain uses, on both sides of the change, so `effective()`
  // can resolve any of them.
  const raw = [
    ...Object.values(baseline.before),
    ...Object.values(baseline.after),
    ...Object.values(live),
  ].join(' ');

  const tailwind = (await import('tailwindcss')).default;
  const base = (await import('../../../../tailwind.config')).default;
  const out = await postcss([
    tailwind({ ...base, content: [{ raw, extension: 'html' }] } as never),
  ]).process('@tailwind utilities;', { from: undefined });

  const unescape = (sel: string) =>
    sel
      .replace(/^\./, '')
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\/g, '');
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
    const sel = unescape(node.selector);
    const combinator = sel.indexOf('>');
    emitted.push({
      cls: combinator === -1 ? sel : sel.slice(0, combinator).trim(),
      minWidth,
      decls,
      child: combinator !== -1,
    });
  };
  postcss.parse(out.css).each((node) => {
    if (node.type === 'rule') collect(node, 0);
    if (node.type === 'atrule' && node.name === 'media') {
      const m = node.params.match(/min-width:\s*([\d.]+)px/);
      if (!m) return;
      node.walkRules((r) => collect(r, Number(m[1])));
    }
  });
  expect(emitted.length, 'Tailwind produced no rules for the plan-card classes').toBeGreaterThan(0);
}, 180_000);

/**
 * THE ONE `git` CALL, AND IT IS NOT REACHED AT ASSERTION TIME.
 *
 * `before` is the class chain as it stood on the base branch. Re-reading it
 * from git on every run would fail on a `--depth 1` runner, which is what
 * failed CI twice this week, so it is recorded into a fixture and the recorder
 * is gated. Regenerate with:
 *
 *     UPDATE_LAYOUT_BASELINE=1 BASELINE_REF=origin/main npx vitest run \
 *       src/components/settings/__tests__/PlanUpgradeSection.marketing-card.test.tsx
 */
function recordOrRead(): Baseline {
  if (!RECORDING) {
    expect(
      existsSync(FIXTURE),
      `missing fixture ${path.basename(FIXTURE)} — regenerate with UPDATE_LAYOUT_BASELINE=1`,
    ).toBe(true);
    return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;
  }
  const previous: Partial<Baseline> = existsSync(FIXTURE)
    ? JSON.parse(readFileSync(FIXTURE, 'utf8'))
    : {};
  const ref = process.env.BASELINE_REF || 'origin/main';
  const at = (file: string) => execSync(`git show ${ref}:${file}`, { cwd: ROOT, encoding: 'utf8' });
  const pick = (src: string, re: RegExp, label: string): string => {
    const m = src.match(re);
    if (!m) throw new Error(`recorder: could not find ${label} at ${ref}`);
    return m[1].replace(/\s+/g, ' ').trim();
  };
  const oldBilling = at('src/components/BillingAndPayments.tsx');
  const oldSection = at('src/components/settings/PlanUpgradeSection.tsx');
  const oldShell = at('src/components/AdminDashboard.tsx');

  // The sub-640px layer and the element counts are read off the CURRENT tree;
  // the `before` counts are carried forward from the fixture, because the
  // component they describe no longer exists in the working tree and
  // re-rendering a revision of it is not something a recorder should do.
  const mobileLayerNow: Record<string, string[]> = {};
  const elements: Record<string, { before: number; after: number }> = {};
  for (const plan of PRICED_PLAN_ORDER) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let r: Root;
    act(() => { r = createRoot(host); r.render(<PlanUpgradeSection tenantId="grace" currentPlan={plan} />); });
    mobileLayerNow[plan] = mobileLayer(host);
    elements[plan] = {
      before: previous.mobileElements?.[plan]?.before ?? 0,
      after: mobileLayerNow[plan].length,
    };
    act(() => { r!.unmount(); });
    host.remove();
  }

  const recorded: Baseline = {
    before: {
      overlay: pick(oldShell, /className="(flex-1 overflow-y-auto p-4[^"]*)">\s*<BillingAndPayments/, 'the billing overlay'),
      container: pick(oldBilling, /<div className="(max-w-[^"]*space-y-6)">/, 'the billing container'),
      panel: pick(oldBilling, /\{\/\* 3: Upgrade[\s\S]{0,200}?<div className="([^"]*)">\s*<PlanUpgradeSection/, 'the card panel'),
      track: pick(oldSection, /className="(flex overflow-x-auto[^"]*)"/, 'the plan track'),
      card: pick(oldSection, /className=\{`(relative bg-surface-raised[^`]*)`\}/, 'the plan card')
        .replace(/\$\{[^}]*\}/g, ' '),
    },
    after: currentChain(),
    mobileLayer: mobileLayerNow,
    mobileElements: elements,
  };
  writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + '\n');
  return recorded;
}

/** The chain as it stands today, read out of the three source files. */
function currentChain(): Baseline['after'] {
  const grab = (file: string, re: RegExp, label: string): string => {
    const m = readFileSync(file, 'utf8').match(re);
    if (!m) throw new Error(`could not find ${label}`);
    return m[1].replace(/\s+/g, ' ').trim();
  };
  // 🔴 The container is read out of BillingAndPayments.tsx, NOT taken from the
  // imported constant. Reading the constant would measure what form-layout.ts
  // says while the screen quietly went back to a width of its own — which is
  // the exact defect being fixed, so it is the one thing this must not do. The
  // interpolation is expanded from the real export afterwards.
  const billing = readFileSync(BILLING, 'utf8');
  const rootClass = billing.match(
    /<div className=(?:"([^"]*space-y-6[^"]*)"|\{`([^`]*space-y-6[^`]*)`\})>/,
  );
  if (!rootClass) throw new Error('could not find the billing container');
  const container = (rootClass[1] ?? rootClass[2])
    .replace(/\$\{FORM_CONTAINER\}/g, FORM_CONTAINER)
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    overlay: grab(SHELL, /className="(flex-1 overflow-y-auto p-4[^"]*)">\s*<BillingAndPayments/, 'the billing overlay'),
    container,
    panel: grab(BILLING, /\{\/\* 3: Upgrade[\s\S]{0,200}?<div className="([^"]*)">\s*<PlanUpgradeSection/, 'the card panel'),
    track: grab(COMPONENT, /className="(flex overflow-x-auto[^"]*)"/, 'the plan track'),
    card: grab(COMPONENT, /className=\{`(relative rounded-brand-xl[^`]*)`\}/, 'the plan card').replace(/\$\{[^}]*\}/g, ' '),
  };
}

/* ── resolving a class string at a viewport ─────────────────────────────── */

const rootSizeAt = (viewport: number): number =>
  rootPx.filter((r) => r.minWidth <= viewport).slice(-1)[0].size;

/** A CSS length in px at a viewport, or null when it is not a fixed length. */
function lengthPx(value: string | undefined, viewport: number): number | null {
  if (!value) return null;
  const rem = value.match(/^(-?[\d.]+)rem$/);
  if (rem) return parseFloat(rem[1]) * rootSizeAt(viewport);
  const px = value.match(/^(-?[\d.]+)px$/);
  return px ? parseFloat(px[1]) : null;
}

/** Declarations in force for a class string at a viewport, later rules winning. */
function effective(classes: string, viewport: number): Record<string, string> {
  const wanted = new Set(classes.split(/\s+/).filter(Boolean));
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (rule.child || !wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}

/** Horizontal padding a class string applies, per side, at a viewport. */
function padX(classes: string, viewport: number): number {
  const d = effective(classes, viewport);
  const left = lengthPx(d['padding-left'] ?? d['padding'], viewport) ?? 0;
  const right = lengthPx(d['padding-right'] ?? d['padding'], viewport) ?? 0;
  return (left + right) / 2;
}

interface Measured {
  viewport: number;
  /** Width available to the row of cards, inside every wrapper. */
  trackPx: number;
  /** How the row lays out: 'flex' (the carousel) or 'grid'. */
  display: string;
  /** Columns the grid offers; 1 for the flex carousel's single track. */
  columns: number;
  /** Width one card occupies, including nothing else. */
  cardPx: number;
  /** Width the row of cards demands, in the widest single line it forms. */
  rowPx: number;
  /** rowPx − trackPx, floored at zero. THE NUMBER. */
  overflowPx: number;
}

/**
 * The whole chain, resolved. This is the model the assertions are made in, and
 * it is the same model on both sides of the change — the only thing that
 * differs is which class strings go in.
 */
function measure(chain: Baseline['after'], viewport: number): Measured {
  const overlayPad = padX(chain.overlay, viewport);
  const maxW = lengthPx(effective(chain.container, viewport)['max-width'], viewport);
  const outer = Math.min(viewport - 2 * overlayPad, maxW ?? Infinity);
  const trackPx = outer - 2 * padX(chain.panel, viewport);

  const trackDecls = effective(chain.track, viewport);
  const display = trackDecls['display'] ?? 'block';
  const gap = lengthPx(trackDecls['column-gap'] ?? trackDecls['gap'], viewport) ?? 0;

  const cardDecls = effective(chain.card, viewport);
  const cardMin = lengthPx(cardDecls['min-width'], viewport) ?? 0;
  const cardMax = lengthPx(cardDecls['max-width'], viewport) ?? Infinity;

  if (display === 'grid') {
    // `grid-cols-N` emits `repeat(N, minmax(0, 1fr))`. The columns share the
    // track, so the row can never be wider than the track — what has to be
    // checked instead is that a card's own min-width does not push its column
    // wider than the share it was given.
    const columns = Number(trackDecls['grid-template-columns']?.match(/repeat\((\d+)/)?.[1] ?? 1);
    const share = (trackPx - (columns - 1) * gap) / columns;
    const cardPx = Math.min(Math.max(share, cardMin), cardMax);
    const perRow = Math.min(columns, PRICED_PLAN_ORDER.length);
    const rowPx = perRow * cardPx + (perRow - 1) * gap;
    return { viewport, trackPx, display, columns, cardPx, rowPx, overflowPx: Math.max(0, rowPx - trackPx) };
  }

  // The carousel: every card on one line, each at its own intrinsic width,
  // clamped between min and max. The minimum is the charitable reading — the
  // real cards sit nearer their max — so an overflow computed here is a floor
  // on the real one, never an exaggeration of it.
  const cardPx = cardMin;
  const rowPx = PRICED_PLAN_ORDER.length * cardPx + (PRICED_PLAN_ORDER.length - 1) * gap;
  return { viewport, trackPx, display, columns: 1, cardPx, rowPx, overflowPx: Math.max(0, rowPx - trackPx) };
}

const round = (n: number) => Math.round(n * 100) / 100;

beforeEach(() => {
  // happy-dom has no `alert`, and the Dodo success path calls it. Stubbed
  // rather than mocked away, so the component keeps the code path it ships.
  (globalThis as unknown as { alert: (m?: string) => void }).alert = () => {};
  runDodoPlanChangeMock.mockClear();
  fetchBillingProcessorMock.mockClear();
  authFetchMock.mockClear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
});

/* ═══ 1. THE BUG ═════════════════════════════════════════════════════════ */

describe('1 — three plan cards fit without horizontal clipping at desktop widths', () => {
  it('reproduces the clip on the chain this change replaces', () => {
    // If this ever stops overflowing, the fixture no longer describes the
    // screen the founder photographed and the rest of this file is measuring
    // something else. STOP condition 2, as an assertion.
    const before = DESKTOP_VIEWPORTS.map((w) => measure(baseline.before, w));
    for (const m of before) {
      expect(m.display, `${m.viewport}px: the old row was a flex carousel`).toBe('flex');
      expect(
        m.overflowPx,
        `${m.viewport}px: expected the old chain to clip, but ${round(m.rowPx)}px of cards fit a ${round(m.trackPx)}px track`,
      ).toBeGreaterThan(0);
    }
    // And the number, at the width the complaint was made at.
    const at1440 = before.find((m) => m.viewport === 1440)!;
    expect(round(at1440.trackPx)).toBe(659.75);
    expect(round(at1440.rowPx)).toBe(869);
    expect(round(at1440.overflowPx)).toBe(209.25);
    // 70.75px of the third card survived — the checkmarks and truncated labels.
    expect(round(at1440.trackPx - 2 * at1440.cardPx - 2 * 14.5)).toBe(70.75);
  });

  it('is still the chain the fixture was recorded against', () => {
    // The pin. Every measurement above and below is made against `live`, so a
    // rewrite of any link in the chain changes what is being measured; this
    // makes that visible as a diff to the fixture rather than as a silently
    // different screen that still happens to fit.
    expect(live).toEqual(baseline.after);
  });

  it('fits three cards at every desktop width now', () => {
    for (const viewport of DESKTOP_VIEWPORTS) {
      const m = measure(live, viewport);
      expect(
        round(m.overflowPx),
        `${viewport}px: ${round(m.rowPx)}px of cards in a ${round(m.trackPx)}px track`,
      ).toBe(0);
      // Fit is not enough on its own — a zero overflow is also what three
      // 40px slivers would report. The cards must still be cards.
      expect(round(m.cardPx), `${viewport}px card width`).toBeGreaterThanOrEqual(CARD_MIN_READABLE_PX);
      // Three across, or wrapped — never a fourth column, never one long line.
      expect(m.display, `${viewport}px`).toBe('grid');
      expect(m.columns, `${viewport}px`).toBeGreaterThanOrEqual(2);
      expect(m.columns, `${viewport}px`).toBeLessThanOrEqual(PRICED_PLAN_ORDER.length);
    }
  });

  it('leaves the phone carousel exactly as it was', () => {
    for (const viewport of MOBILE_VIEWPORTS) {
      const before = measure(baseline.before, viewport);
      const after = measure(live, viewport);
      expect(after.display, `${viewport}px`).toBe('flex');
      expect(after.cardPx, `${viewport}px card width`).toBe(before.cardPx);
      expect(after.rowPx, `${viewport}px row width`).toBe(before.rowPx);
      // The track is the one thing that CAN differ, because the container
      // classes changed — and below `sm:` it must not, because both the old
      // `max-w-3xl` (768px at the 16px base) and the new `sm:`-gated rule are
      // wider than any phone.
      expect(round(after.trackPx), `${viewport}px track`).toBe(round(before.trackPx));
    }
  });

  it('records the measurement it was fixed against', () => {
    // Not an assertion so much as the report, in the file: printed on failure
    // of any of the above, and readable in the fixture regardless.
    const table = VIEWPORTS.map((w) => {
      const b = measure(baseline.before, w);
      const a = measure(live, w);
      return { w, trackBefore: round(b.trackPx), cardBefore: round(b.cardPx), overflowBefore: round(b.overflowPx),
               trackAfter: round(a.trackPx), cardAfter: round(a.cardPx), overflowAfter: round(a.overflowPx) };
    });
    if (process.env.PRINT_MEASUREMENT) console.log(JSON.stringify(table, null, 1));
    // Nothing clips now, at any width the grid governs.
    expect(table.filter((r) => r.w >= 640).every((r) => r.overflowAfter === 0)).toBe(true);
    // Everything did before, at every width the grid now governs.
    expect(table.filter((r) => r.overflowBefore > 0).map((r) => r.w))
      .toEqual([...VIEWPORTS]);
    // Below 640px the row still overruns its track on BOTH sides — that is the
    // carousel doing its job, and it is unchanged.
    for (const r of table.filter((x) => x.w < 640)) {
      expect(r.overflowAfter, `${r.w}px: the phone carousel stopped scrolling`).toBe(r.overflowBefore);
    }
  });
});

/* ═══ 2. THE RECOMMENDED CARD, IN FOUR PALETTES ══════════════════════════ */

describe('2 — the recommended plan renders a distinct card treatment in all four palettes', () => {
  it('marks exactly one tier recommended, and it is the dark one', () => {
    mount();
    const flagged = PRICED_PLAN_ORDER.filter((p) => card(p).getAttribute('data-recommended') === 'true');
    expect(flagged).toHaveLength(1);
    const [recommended] = flagged;
    // Named by the badge it renders, not by which tier it happens to be.
    expect(card(recommended).querySelector('[data-testid="plan-card-recommended"]')?.textContent?.trim())
      .toBe('RECOMMENDED');
    for (const plan of PRICED_PLAN_ORDER) {
      if (plan === recommended) continue;
      expect(card(plan).querySelector('[data-testid="plan-card-recommended"]'), PLAN_DISPLAY_NAMES[plan]).toBeNull();
    }
  });

  it('paints it from tokens that resolve in every palette, and never from a literal', () => {
    mount();
    const recommended = PRICED_PLAN_ORDER.find((p) => card(p).getAttribute('data-recommended') === 'true')!;
    const el = card(recommended);
    const style = el.getAttribute('style') ?? '';

    // The three tokens the treatment is built from. Named, so a swap to a
    // hardcoded navy fails here rather than at a customer.
    expect(style).toContain('var(--surface-night)');
    expect(style).toContain('var(--border-gold)');
    expect(style).toContain('var(--ds-sh-lg)');
    expect(style, 'a colour literal on the recommended card').not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);

    // Every token it reads must be DECLARED in every palette — that is what
    // "works in all four" means when the CSS cannot be laid out here. A token
    // absent from a family falls through, which for --surface-night is
    // deliberate (it is fixed brand structure, not part of the neutral ramp)
    // and is verified as a fall-through rather than as a hole.
    const css = readFileSync(GLOBALS, 'utf8');
    const declared = (token: string, selector: RegExp): boolean => {
      const block = css.split(/\n/);
      let inside = false;
      for (const line of block) {
        if (selector.test(line)) inside = true;
        else if (inside && /^\s*\}/.test(line)) inside = false;
        else if (inside && new RegExp(`${token}\\s*:`).test(line)) return true;
      }
      return false;
    };
    for (const token of ['--surface-night', '--border-gold', '--ds-sh-lg']) {
      expect(declared(token, /^\s*:root\s*\{/), `${token} is not declared in the light root`).toBe(true);
      expect(declared(token, /\[data-theme="dark"\]\s*\{/), `${token} has no dark value`).toBe(true);
    }
    // --brand-color-on-dark is the exception, and deliberately so: globals.css
    // declares the light identity in :root and layout.tsx injects the
    // tenant-corrected value per request, unlayered, so it always resolves.
    expect(declared('--brand-color-on-dark', /^\s*:root\s*\{/)).toBe(true);
    expect(readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8')).toContain('--brand-color-on-dark');
    // Classic overrides only the neutral ramp, so these four fall through to
    // the Harvest declarations above in BOTH Classic modes. Asserted as an
    // absence, because a Classic override of any of them would grey out the
    // accent — the one thing globals.css says must not happen.
    const classicBlocks = css.slice(css.indexOf('[data-palette="classic"]'));
    for (const token of ['--surface-night', '--border-gold', '--ds-sh-lg', '--brand-color-on-dark']) {
      expect(classicBlocks, `Classic overrides ${token}`).not.toMatch(new RegExp(`^\\s*${token}\\s*:`, 'm'));
    }
  });

  it('renders the same treatment however the palette is stamped', () => {
    // The DOM is palette-independent by construction — the card carries tokens,
    // not values — so the proof is that stamping each of the four produces a
    // byte-identical card. A `dark:`-prefixed literal, or a value read at
    // render time, would break this.
    const seen = new Set<string>();
    for (const { family, mode } of PALETTES) {
      document.documentElement.setAttribute('data-palette', family);
      document.documentElement.setAttribute('data-theme', mode);
      if (mode === 'dark') document.documentElement.classList.add('dark');
      mount();
      const recommended = PRICED_PLAN_ORDER.find((p) => card(p).getAttribute('data-recommended') === 'true')!;
      seen.add(card(recommended).outerHTML);
      act(() => { root?.unmount(); });
      root = null;
      container.remove();
      document.documentElement.classList.remove('dark');
    }
    expect(seen.size, 'the recommended card differs between palettes').toBe(1);
  });

  it('gives the plain cards a different treatment, so "distinct" means something', () => {
    mount();
    const recommended = PRICED_PLAN_ORDER.find((p) => card(p).getAttribute('data-recommended') === 'true')!;
    const plain = PRICED_PLAN_ORDER.filter((p) => p !== recommended);
    expect(plain.length).toBeGreaterThan(0);
    for (const plan of plain) {
      expect(card(plan).getAttribute('style') ?? '', PLAN_DISPLAY_NAMES[plan]).not.toContain('var(--surface-night)');
      expect(classesOf(card(plan)), PLAN_DISPLAY_NAMES[plan]).toContain('bg-surface-raised');
    }
    expect(classesOf(card(recommended))).not.toContain('bg-surface-raised');
  });
});

/* ═══ 3. THE FEE CALLOUT ═════════════════════════════════════════════════ */

describe('3 — the donation fee reaches the card without a second copy of the number', () => {
  it('prints the fee PLATFORM_FEE_MAP holds, whatever it holds', () => {
    mount();
    for (const plan of PRICED_PLAN_ORDER) {
      const callout = card(plan).querySelector('[data-testid="plan-card-fee"]');
      expect(callout, `no fee callout on the ${PLAN_DISPLAY_NAMES[plan]} card`).toBeTruthy();
      const expected = `${Number(((PLATFORM_FEE_MAP[plan] ?? 0) * 100).toFixed(2))}%`;
      expect(callout!.textContent, PLAN_DISPLAY_NAMES[plan]).toContain(expected);
    }
  });

  it('types no percentage into the component', () => {
    // The specific failure this guards: `0%` in the JSX, which reads correctly
    // today and becomes a false claim the moment the map changes. Named by the
    // map, not by the digit — a `2.5%` typed in later fails here too.
    const src = readFileSync(COMPONENT, 'utf8');
    const jsx = src.slice(src.indexOf('const PlanUpgradeSection'));
    expect(jsx, 'a literal percentage in the card markup').not.toMatch(/>\s*\d+(\.\d+)?%/);
    expect(src).toContain('PLATFORM_FEE_MAP');
  });
});

/* ═══ 4. THE FLOWS THIS CHANGE MAY NOT TOUCH ═════════════════════════════ */

describe('4 — the plan-change call, the trial refusal and the processor gate are untouched', () => {
  it('routes a Dodo tenant through runDodoPlanChange, in place', async () => {
    mount({ currentPlan: 'plus', processor: 'dodo' });
    const upgrade = Array.from(card('pro').querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().startsWith('Upgrade to'))!;
    await act(async () => { upgrade.click(); });
    expect(runDodoPlanChangeMock).toHaveBeenCalledWith({ tenantId: 'grace', plan: 'pro', billing: 'monthly' });
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('routes a Stripe upgrade to checkout and a Stripe downgrade to the portal', async () => {
    mount({ currentPlan: 'pro', processor: 'stripe' });
    const upgrade = Array.from(card('max').querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().startsWith('Upgrade to'))!;
    await act(async () => { upgrade.click(); });
    expect(authFetchMock.mock.calls[0][0]).toBe('/api/stripe/checkout');
    expect(runDodoPlanChangeMock).not.toHaveBeenCalled();

    authFetchMock.mockClear();
    const downgrade = Array.from(card('plus').querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().startsWith('Downgrade to'))!;
    await act(async () => { downgrade.click(); });
    expect(authFetchMock.mock.calls[0][0]).toBe('/api/stripe/portal');
  });

  it('keeps the processor gate: a known processor is not re-fetched, an unknown one is', async () => {
    mount({ currentPlan: 'plus', processor: 'stripe' });
    const upgrade = Array.from(card('pro').querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().startsWith('Upgrade to'))!;
    await act(async () => { upgrade.click(); });
    expect(fetchBillingProcessorMock).not.toHaveBeenCalled();

    act(() => { root?.unmount(); }); root = null; container.remove();
    mount({ currentPlan: 'plus' });
    const upgrade2 = Array.from(card('pro').querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().startsWith('Upgrade to'))!;
    await act(async () => { upgrade2.click(); });
    expect(fetchBillingProcessorMock).toHaveBeenCalled();
  });

  it('never fires for the tenant\'s own plan', async () => {
    mount({ currentPlan: 'pro', processor: 'dodo' });
    const current = card('pro').querySelector('button')!;
    expect((current as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { current.click(); });
    expect(runDodoPlanChangeMock).not.toHaveBeenCalled();
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('leaves the trial refusal on the server, where it lives', () => {
    // The 14-day-trial refusal is /api/dodo/change-plan's, reached through
    // runDodoPlanChange. A card that decided it client-side would be a second
    // copy of the rule and a bypassable one, so the component must contain no
    // trial logic at all — and must not reach the route by any other path.
    const src = readFileSync(COMPONENT, 'utf8');
    const jsx = src
      .slice(src.indexOf('const PlanUpgradeSection'))
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')  // JSX comments
      .replace(/^\s*\/\/.*$/gm, '');          // line comments
    expect(jsx, 'trial logic in the card').not.toMatch(/\btrial\b/i);
    expect(jsx, 'the component calls the change-plan route directly').not.toContain('/api/dodo/change-plan');
    expect(src).toContain('runDodoPlanChange');
  });

  it('is not "Start free trial" — these are existing customers', () => {
    mount({ currentPlan: 'pro' });
    expect(container.textContent).not.toContain('Start free trial');
    expect(card('pro').querySelector('button')!.textContent).toContain('Current Plan');
    expect(card('max').querySelector('button')!.textContent).toContain('Upgrade to Ministry');
    expect(card('plus').querySelector('button')!.textContent).toContain('Downgrade to Individual');
  });
});

/* ═══ 5. THE BADGE COLLISION, AND THE TYPE FLOOR ═════════════════════════ */

describe('5 — the current-plan marker wins the badge slot on the recommended card', () => {
  it('shows the marker and suppresses RECOMMENDED when they collide', () => {
    mount();
    const recommended = PRICED_PLAN_ORDER.find((p) => card(p).getAttribute('data-recommended') === 'true')!;
    // Nobody on it: the badge shows.
    expect(card(recommended).querySelector('[data-testid="plan-card-recommended"]')).toBeTruthy();
    expect(card(recommended).querySelector('[data-testid="plan-card-current"]')).toBeNull();

    act(() => { root?.unmount(); }); root = null; container.remove();
    mount({ currentPlan: recommended });
    // On it: the marker replaces the badge, and the card keeps its treatment.
    expect(card(recommended).querySelector('[data-testid="plan-card-current"]')).toBeTruthy();
    expect(card(recommended).querySelector('[data-testid="plan-card-recommended"]')).toBeNull();
    expect(card(recommended).getAttribute('style')).toContain('var(--surface-night)');
  });

  it('marks the current plan on every tier, recommended or not', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      mount({ currentPlan: plan });
      const marked = PRICED_PLAN_ORDER.filter((p) => card(p).querySelector('[data-testid="plan-card-current"]'));
      expect(marked, `currentPlan=${plan}`).toEqual([plan]);
      act(() => { root?.unmount(); }); root = null; container.remove();
    }
  });
});

describe('5b — no font size below 11px as rendered at desktop density', () => {
  it('holds for every size the cards render', () => {
    mount({ currentPlan: 'pro' });
    const offenders: string[] = [];
    for (const plan of PRICED_PLAN_ORDER) {
      for (const token of allTokens(card(plan))) {
        if (!isFontSizeToken(token)) continue;
        const px = fontSizePx(token, REM_PX_DESKTOP);
        if (px !== null && px < MIN_FONT_PX) offenders.push(`${PLAN_DISPLAY_NAMES[plan]}: ${token} = ${px}px`);
      }
    }
    expect(offenders, `under the ${MIN_FONT_PX}px floor at the ${REM_PX_DESKTOP}px desktop base`).toEqual([]);
  });

  it('is a real check — the scale token it rules out is spellable', () => {
    // `text-xs` is 10.875px at this base, which is what the floor exists to
    // exclude. If this ever stops being true the assertion above is vacuous.
    expect(fontSizePx('text-xs', REM_PX_DESKTOP)!).toBeLessThan(MIN_FONT_PX);
    expect(fontSizePx('text-sm', REM_PX_DESKTOP)!).toBeGreaterThanOrEqual(MIN_FONT_PX);
  });

  it('shrinks no touch target', () => {
    // The plan button is the only control on a card. THE-190 forbids a 44px
    // floor assertion, so this pins what it actually is instead: unchanged
    // padding and unchanged type, i.e. the same box it has always drawn.
    mount({ currentPlan: 'pro' });
    for (const plan of PRICED_PLAN_ORDER) {
      const button = card(plan).querySelector('button')!;
      const tokens = classesOf(button);
      expect(tokens, PLAN_DISPLAY_NAMES[plan]).toContain('py-2.5');
      expect(tokens, PLAN_DISPLAY_NAMES[plan]).toContain('w-full');
      expect(tokens, PLAN_DISPLAY_NAMES[plan]).toContain('text-sm');
      // And no breakpoint-gated height anywhere on it, which is the only other
      // way its box could have moved.
      expect(tokens.filter((t) => /(?:^|:)h-/.test(t)), PLAN_DISPLAY_NAMES[plan]).toEqual([]);
    }
  });
});

/* ═══ 6. MOBILE, AND THE HERMETIC PIN ════════════════════════════════════ */

describe('6 — the sub-640px rendering changes only where the marketing match requires', () => {
  /**
   * THE ENUMERATION. Every one of these is a CONTENT change from matching the
   * marketing card, and none of them is the clip fix — the clip fix is proved
   * mobile-inert by the next test, which is the claim the brief actually
   * constrains. Element counts per card, at `currentPlan='pro'`:
   *
   *   removed  the icon disc and its lucide glyph      −2 elements per card
   *   removed  the second yearly sub-line (merged)      0 on monthly
   *   added    the blurb                                +1 per card
   *   added    the fee callout                          +3 per card
   *   added    the rollup line on Small Team/Ministry   +1 on two cards
   *   removed  the feature lines the rollup replaces   −12 on pro, −28 on max
   *   moved    the badge: centred above the card  ->  inside it, top right
   *   moved    RECOMMENDED: Small Team -> Ministry, and it is now the dark card
   *   restyled the card box: rounded-2xl/p-5/border-2 -> rounded-brand-xl,
   *            24px padding, a 1px border and a token shadow
   *   restyled the name and price: centred -> left, with the period split small
   *
   * ⚠️ THE SECTION-LEVEL CHROME IS NO LONGER UNTOUCHED. THE-195 replaced the
   * two-segment Monthly / Yearly toggle with a three-segment Monthly /
   * Quarterly / Yearly one, so the layer above the track legitimately grew.
   * That is a change to the CHROME, not to the cards, and this section is about
   * the cards — so the comparison below is anchored at the card track and the
   * chrome gets its own assertion rather than being folded in or re-recorded
   * away. The dots row is still untouched below `sm:`.
   */

  /** The recorded and current layers from the card track onward, indices
   *  stripped so a change in the chrome above cannot shift the comparison. */
  const fromTrack = (layer: readonly string[]): string[] => {
    const at = layer.findIndex((row) => /\boverflow-x-auto\b/.test(row));
    expect(at, 'no card track in the layer — is this measuring anything?').toBeGreaterThan(-1);
    return layer.slice(at).map((row) => row.split('\t').slice(1).join('\t'));
  };
  /**
   * The two-segment toggle was: a flex container, two buttons, and an absolutely
   * positioned badge inside the second — plus a conditional 🎉 line below it.
   * The three-segment one is: a wrapper, a grid track, three buttons each with a
   * label span, two of them carrying a badge span, and a claim line.
   *
   * Pinned as a number so the growth is a stated quantity rather than whatever
   * the tree happens to produce. If the toggle changes again this fails and the
   * new figure has to be justified in the enumeration above.
   */
  const TOGGLE_ROWS_ADDED = 6;

  it('changes the phone rendering by exactly the enumerated amount', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      mount({ currentPlan: plan });
      const layer = mobileLayer(container);
      const recorded = baseline.mobileLayer[plan];
      expect(recorded, `no recorded mobile layer for currentPlan=${plan}`).toBeTruthy();
      // 🔴 The cards themselves: byte-for-byte identical in class terms.
      expect(fromTrack(layer), `the sub-640px card layer moved for currentPlan=${plan}`)
        .toEqual(fromTrack(recorded));
      const counts = baseline.mobileElements[plan];
      // The card subtree's element count is unchanged; the whole-tree count
      // grew by exactly the toggle's extra rows.
      expect(fromTrack(layer).length, `card element count for currentPlan=${plan}`)
        .toBe(fromTrack(recorded).length);
      expect(layer.length - recorded.length, `currentPlan=${plan}: only the toggle should have grown`)
        .toBe(TOGGLE_ROWS_ADDED);
      expect(counts.after, `currentPlan=${plan}: the rollup should have shortened the tree`)
        .toBeLessThan(counts.before);
      act(() => { root?.unmount(); }); root = null; container.remove();
    }
  });

  it('grew the chrome by a THIRD TOGGLE SEGMENT and nothing else', () => {
    // The other half of the split above: the card layer is pinned identical, so
    // this is what has to account for the whole delta. Three segments, each a
    // real button, and the badge INSIDE the segment rather than hung off it —
    // an absolutely positioned badge is what clipped before PR 361.
    mount({ currentPlan: 'pro' });
    const segments = Array.from(container.querySelectorAll('[data-testid="billing-term-segment"]'));
    expect(segments).toHaveLength(3);
    expect(segments.map((b) => b.getAttribute('data-term'))).toEqual(['monthly', 'quarterly', 'yearly']);
    expect(container.querySelectorAll('[data-testid="billing-term-badge"]')).toHaveLength(2);
    for (const seg of segments) {
      expect(classesOf(seg), 'a segment hangs its badge outside the track').not.toContain('absolute');
      expect(classesOf(seg), 'a segment cannot shrink, so three of them will overflow').toContain('min-w-0');
    }
    // The track divides its container rather than sizing to content.
    const toggle = container.querySelector('[data-testid="billing-term-toggle"]')!;
    expect(classesOf(toggle)).toContain('grid');
    expect(classesOf(toggle)).toContain('grid-cols-3');
    expect(classesOf(toggle)).toContain('w-full');
  });

  it('makes the clip fix itself mobile-inert', () => {
    // 🔴 THE CLAIM. Every token this change added to the TRACK, the CARD and
    // the dots for the sake of the clip is breakpoint-gated, so below 640px it
    // applies nothing at all. A stray unprefixed `grid` here would silently
    // restyle the phone carousel.
    mount();
    const before = new Set(baseline.before.track.split(/\s+/));
    const addedToTrack = classesOf(track()).filter((t) => !before.has(t) && t !== 'flex');
    expect(addedToTrack.length, 'the track gained no tokens — is this measuring anything?').toBeGreaterThan(0);
    for (const token of addedToTrack) {
      expect(breakpointOf(token), `${token} applies on a phone`).not.toBeNull();
    }
    // The layout tokens on the card that were added for the fix, likewise.
    for (const token of ['sm:min-w-0', 'sm:max-w-none']) {
      expect(classesOf(card('plus')), `the card lost ${token}`).toContain(token);
      expect(isResponsive(token)).toBe(true);
    }
    // And the fixed carousel widths survive on the phone, untouched.
    expect(classesOf(card('plus'))).toContain('min-w-[280px]');
    expect(classesOf(card('plus'))).toContain('max-w-[320px]');
    // The dots keep every unprefixed token they had; only `sm:hidden` is new.
    const dots = container.querySelector('[aria-label="Go to plan 1"]')!.parentElement!;
    expect(classesOf(dots).filter((t) => !isResponsive(t)).sort())
      .toEqual(['flex', 'gap-2', 'justify-center', 'py-2']);
    expect(classesOf(dots)).toContain('sm:hidden');
  });

  it('reaches for no git at assertion time', () => {
    // `actions/checkout` uses fetch-depth 1. The single `git show` in this file
    // is inside the recorder and the recorder is gated, so a run without
    // UPDATE_LAYOUT_BASELINE never shells out — which is what makes this file
    // survive a `git clone --depth 1`.
    const self = readFileSync(__filename, 'utf8');
    const lines = self.split('\n');
    const calls = lines.filter(
      (l) => /execSync\(/.test(l) && !l.trim().startsWith('*') && !/^import|expect\(|indexOf\(/.test(l.trim()),
    );
    expect(calls.length, `more than one git call:\n${calls.join('\n')}`).toBe(1);
    // …and it is inside recordOrRead, after the un-gated early return.
    const body = self.slice(self.indexOf('function recordOrRead'), self.indexOf('function currentChain'));
    expect(body).toContain('if (!RECORDING)');
    expect(body.indexOf('execSync(')).toBeGreaterThan(body.indexOf('return JSON.parse'));
    expect(RECORDING, 'the recorder ran during a normal test run').toBe(false);
    expect(existsSync(FIXTURE)).toBe(true);
  });

  it('reports a render hash per width', () => {
    // Not a Chromium pixel diff — nothing in this repo compiles and screenshots
    // the app, and a hash that claimed to be one would be a false claim. This
    // is the class layer IN FORCE at each width (every token whose breakpoint
    // minimum the width meets) plus the rendered text: the two inputs a
    // screenshot is a pure function of, given the same compiled CSS.
    mount({ currentPlan: 'pro' });
    const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
    const layerAt = (width: number): string =>
      classInventory(container)
        .map(({ index, tag, tokens }) => {
          const live = tokens.filter((t) => {
            const bp = breakpointOf(t);
            return bp === null || BREAKPOINT_MIN_PX[bp] <= width;
          });
          return `${index}\t${tag}\t${live.join(' ')}`;
        })
        .join('\n');
    const hashes = HASH_VIEWPORTS.map((w) =>
      createHash('sha256').update(`${w}\n${layerAt(w)}\n${text}`).digest('hex').slice(0, 16),
    );
    if (process.env.PRINT_MEASUREMENT) {
      console.log('MOBILE_HASHES ' + JSON.stringify(Object.fromEntries(HASH_VIEWPORTS.map((w, i) => [w, hashes[i]]))));
    }
    // 380/480/639 are all below every breakpoint this component spells, so
    // their layers are identical and only the width in the digest separates
    // them — that identity IS the "mobile did not move between phone widths"
    // claim. 768 crosses `sm:`, so it must differ from the phone layer.
    expect(layerAt(380)).toBe(layerAt(480));
    expect(layerAt(480)).toBe(layerAt(639));
    expect(layerAt(768), 'the sm: grid did not engage by 768px').not.toBe(layerAt(639));
    expect(new Set(hashes).size).toBe(HASH_VIEWPORTS.length);
    expect(hashes.every((h) => /^[0-9a-f]{16}$/.test(h))).toBe(true);
  });
});

/* ═══ 7. THE THINGS THAT MUST NOT HAVE MOVED ═════════════════════════════ */

describe('7 — prices, the toggle and the blurbs', () => {
  it('leaves every price alone', () => {
    expect(PLAN_PRICING.plus.monthly).toBe(39);
    expect(PLAN_PRICING.pro.monthly).toBe(79);
    expect(PLAN_PRICING.max.monthly).toBe(159);
    mount();
    for (const plan of PRICED_PLAN_ORDER) {
      // Monthly: the per-month headline and the charged price are the same
      // figure on the same cycle, so this still matches formatPlanPrice.
      expect(card(plan).querySelector('[data-testid="plan-card-price"]')!.textContent!.trim(), PLAN_DISPLAY_NAMES[plan])
        .toBe(formatPlanPrice(plan, 'monthly'));
    }
  });

  it('keeps a three-segment term toggle and its discount pills', () => {
    mount();
    const toggle = (label: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').trim().startsWith(label))!;

    // Three segments, and the pill is a PERCENTAGE now, not a months-free
    // count: 30% of a year is 3.6 months, so "-3mo" stopped being true.
    expect(toggle('Monthly')).toBeTruthy();
    expect(toggle('Quarterly').textContent).toMatch(/−?-?15%/);
    expect(toggle('Yearly').textContent).toMatch(/−?-?30%/);
    expect(container.querySelectorAll('[data-testid="billing-term-segment"]')).toHaveLength(3);

    for (const term of ['yearly', 'quarterly', 'monthly'] as const) {
      const label = term === 'yearly' ? 'Yearly' : term === 'quarterly' ? 'Quarterly' : 'Monthly';
      act(() => { toggle(label).click(); });
      for (const plan of PRICED_PLAN_ORDER) {
        // THE-196: the headline is the per-month figure on every term.
        expect(
          card(plan).querySelector('[data-testid="plan-card-price"]')!.textContent!.trim(),
          `${PLAN_DISPLAY_NAMES[plan]} on ${term}`,
        ).toBe(`${formatPlanMonthlyHeadline(plan, term)}/mo`);
      }
    }
  });

  it('gives every card its blurb, from the one source in this repo', () => {
    mount();
    for (const plan of PRICED_PLAN_ORDER) {
      expect(card(plan).querySelector('[data-testid="plan-card-blurb"]')!.textContent!.trim(), PLAN_DISPLAY_NAMES[plan])
        .toBe(PLAN_BLURBS[plan]);
    }
  });
});
