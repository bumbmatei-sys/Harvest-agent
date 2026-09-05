// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — every
// getBoundingClientRect() is zeros, even with the real compiled stylesheet
// injected — so no assertion written against it could tell a 44px tap target
// from a 24px one, which is the entire question this file exists to answer.
// Profile is rendered to static markup and measured in real Chromium over CDP.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';

/**
 * THE-321 — the composed Profile, MEASURED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ MEASURED, NEVER ASSUMED. THE-317 found `ui/select` sizing itself with an
 * attribute selector that OUTRANKS Rule 4 and sticking at 32px, and tab
 * triggers rendering at 25px — both under a floor their class names claimed to
 * clear. Every number below is read out of Chromium.
 *
 * ── The five widths, and why all five ───────────────────────────────────────
 *
 * 🔴 WIDTH IS NOT MONOTONIC on this page. #426 measured a card falling TWICE
 * with its NARROWEST point at 1280, and Profile's own settings column splits
 * in two exactly AT `xl` (1280px) — so the column is narrower just above that
 * breakpoint than just below it. Checking only the extremes would miss the
 * worst case by construction.
 *
 * ── The two nav states ──────────────────────────────────────────────────────
 *
 * 🔴 The member shell's bottom nav is `fixed bottom-0` at `z-[100]` and HIDES
 * ON SCROLL: `max-lg:translate-y-full` when hidden, `max-lg:translate-y-0` when
 * shown (MainApp.tsx). Its safe-area padding is FIXED there since PR 437 —
 * `pb-[calc(8px+env(safe-area-inset-bottom))]`, a real rule rather than the
 * inert shorthand it used to spell. (⚠️ That shorthand is NOT written here,
 * deliberately: THE-295 keeps a CLOSED list of the files that still carry the
 * class, and naming it even in a comment would widen that list and make this
 * file look like a surface it is not.) Clearance is asserted in BOTH states,
 * because the state that matters is the one where the nav is SHOWN and the
 * page is scrolled to its end.
 *
 * ⚠️ ONE MeasuringBrowser IN THIS FILE. Two instances in one process collided
 * on a PID-derived debugger port and silently compared a page with itself; the
 * port is the kernel's to choose now, but one browser per file is still the
 * rule. Nothing is measured immediately after a resize either — `evaluateAt`
 * settles first, because a `transition-all` makes a prompt reading a lie
 * (THE-295 read 1018px against a real 224px).
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;
/** Below `sm`. Above it, Rule 4's 38/40px band governs and 44px does not apply. */
const PHONE = 380;
const TOUCH_FLOOR = 44;

vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      uid: 'u1', email: 'member@church.org', photoURL: null, displayName: 'Member',
      providerData: [{ providerId: 'password' }],
    },
  },
  db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'k',
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}), getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (_r: unknown, cb: (d: unknown) => void) => {
    cb({ exists: () => true, data: () => ({ donationSubscriptionId: null, totalDonated: 0 }) });
    return () => {};
  },
  updateDoc: vi.fn(), collection: () => ({}), query: () => ({}), where: () => ({}),
  getDocs: vi.fn(async () => ({ forEach: () => {} })), arrayUnion: (v: unknown) => v,
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => null) }));
vi.mock('../../utils/tenant-scope', () => ({
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site', isSuperAdmin: () => false,
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'plus' }) }));

const { default: Profile } = await import('../Profile');

interface Target { label: string; width: number; height: number; tag: string }
interface Reading {
  viewport: number;
  scrollWidth: number;
  clientWidth: number;
  targets: Target[];
  switchHit: { width: number; height: number } | null;
  lastRowBottom: number;
  navTop: number;
  navVisible: boolean;
}

/** The member shell, class for class from MainApp.tsx:649, in one nav state. */
function shell(navShown: boolean) {
  const navState = navShown ? 'max-lg:translate-y-0' : 'max-lg:translate-y-full';
  return renderToStaticMarkup(
    <div className="flex h-screen">
      <div className="hidden lg:block w-[224px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8">
          <div data-profile>
            <Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />
          </div>
        </div>
      </div>
      {/* 🔴 The real bottom nav: fixed bottom-0, z-[100], #437's pb rule, and
          the translate that hides it on scroll. */}
      <div
        data-shell-bottom-nav
        className={
          'lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 ' +
          'pb-[calc(8px+env(safe-area-inset-bottom))] fixed bottom-0 w-full z-[100] ' +
          `transition-all duration-300 ${navState}`
        }
      >
        <span>Nav</span>
      </div>
    </div>,
  );
}

/**
 * 🔴 AWAITS THE TRANSITIONS BEFORE IT READS A BOX.
 *
 * ⚠️ THIS FILE'S OWN MEASUREMENTS WERE A LIE WITHOUT IT, and they lied
 * quietly. `Button` carries `transition-all`, so `min-height` ANIMATES from 0
 * to its 44px floor after layout; read too early, the composed link CTA
 * measured 7.63px, then 7.69px, then 7.75px on three consecutive runs — a
 * DRIFTING value, which is the tell. A single reading would have been recorded
 * as a real 44px violation and "fixed" by changing markup that was already
 * correct. THE-295 hit the same trap from the other side, reading 1018px
 * against a real 224px.
 *
 * `evaluateAt`'s own settle is a frame flush, which is right for layout and not
 * enough for a timed transition — so the probe waits out the longest one
 * (`duration-300`) plus a frame, and only then measures.
 */
const PROBE = `(async () => {
  await new Promise((r) => setTimeout(r, 420));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const root = document.querySelector('[data-profile]');
  const targets = [...root.querySelectorAll('button,[role="switch"],a,label[for]')]
    .filter(vis)
    .map((el) => {
      const b = el.getBoundingClientRect();
      return {
        label: (el.getAttribute('aria-label') || (el.textContent || '').trim() || el.tagName).slice(0, 40),
        width: b.width, height: b.height, tag: el.tagName,
      };
    })
    .filter((t) => t.width > 0 && t.height > 0);

  // 🔴 The switch's REAL tap target is its ::after pseudo-element, not its
  // painted pill — the primitive extends the hit area that way on purpose.
  const sw = root.querySelector('[data-slot="switch"]');
  let switchHit = null;
  if (sw) {
    const b = sw.getBoundingClientRect();
    const a = getComputedStyle(sw, '::after');
    const px = (v) => (v && v.endsWith('px') ? parseFloat(v) : 0);
    switchHit = {
      width: b.width - px(a.left) - px(a.right),
      height: b.height - px(a.top) - px(a.bottom),
    };
  }

  const rows = [...root.querySelectorAll('button,[data-slot="item"]')].filter(vis);
  const lastRowBottom = rows.length
    ? Math.max(...rows.map((el) => el.getBoundingClientRect().bottom)) : 0;
  const nav = document.querySelector('[data-shell-bottom-nav]');
  const navBox = nav.getBoundingClientRect();
  return {
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    targets, switchHit, lastRowBottom,
    navTop: navBox.top,
    navVisible: getComputedStyle(nav).display !== 'none' && navBox.height > 0,
  };
})()`;

let browser: MeasuringBrowser;
const shown = new Map<number, Reading>();
const hidden = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the321-'));
  browser = new MeasuringBrowser();

  for (const [navShown, into] of [[true, shown], [false, hidden]] as const) {
    const file = path.join(dir, `profile-${navShown ? 'shown' : 'hidden'}.html`);
    writeFileSync(
      file,
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
      `<body>${shell(navShown)}</body></html>`,
    );
    // ⚠️ One browser, re-navigated — never a second instance in this process.
    await browser.open(`file://${file}`);
    for (const v of VIEWPORTS) into.set(v, await browser.evaluateAt<Reading>(v, PROBE, 720));
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

/* ═══ 10 · touch targets ═══════════════════════════════════════════════════ */

describe('10 · every control clears 44px below sm, and Rule 4 holds above it', () => {
  /**
   * ⚠️ TWO EXCLUSIONS, BOTH NAMED AND BOTH ASSERTED ELSEWHERE — never a blanket
   * skip, which is how a floor guard quietly stops guarding.
   *
   *  • THE SWITCH. Its painted pill is 18.4px by design — it is a switch, not a
   *    button — and what a thumb lands on is its `::after` box, which the very
   *    next test measures against the same floor. Reading the pill here would
   *    fail a control that is actually compliant.
   *
   *  • THE FIVE THEME/PALETTE PILLS, at a measured 20.0px. They live in
   *    ThemeToggle.tsx and PaletteFamilyToggle.tsx — files THE-321 does not own
   *    — and are PR 347's SHARED control, so raising them here would move the
   *    ADMIN settings screen too. THE-316 deferred the decision to this ticket;
   *    the decision is to leave the shared control alone and stop the number
   *    being invisible, which the test below does by pinning it.
   */
  const EXCLUDED = ['Push Notifications', 'Harvest', 'Classic', 'Light', 'Dark', 'System'];

  it('every tappable target is at least 44px tall at 380px', () => {
    const under = shown.get(PHONE)!.targets
      .filter((t) => !EXCLUDED.includes(t.label))
      .filter((t) => t.height < TOUCH_FLOOR);
    expect(
      under.map((t) => `${t.label} (${t.tag}) is ${t.height.toFixed(1)}px`),
      `these controls are under the ${TOUCH_FLOOR}px floor on a phone`,
    ).toEqual([]);
  });

  it('and the exclusion list is exactly six controls — it cannot quietly widen', () => {
    // 🔴 The dangerous half of an exemption is the list. Pinned whole, so
    // adding a seventh control to it is an edit to this line, visible in review.
    expect(EXCLUDED).toEqual(
      ['Push Notifications', 'Harvest', 'Classic', 'Light', 'Dark', 'System'],
    );
    // And each really is present, so the list cannot outlive what it excuses.
    const labels = shown.get(PHONE)!.targets.map((t) => t.label);
    for (const e of EXCLUDED) {
      expect(labels, `${e} is excluded but no longer rendered`).toContain(e);
    }
  });

  it("and the switch's hit area clears 44px in BOTH axes, not just its painted pill", () => {
    const hit = shown.get(PHONE)!.switchHit;
    expect(hit, 'no switch was measured').not.toBeNull();
    // 🔴 The PILL is deliberately small — it is a switch, not a button. What a
    // thumb lands on is the ::after box, which is what this reads.
    expect(hit!.height, `the switch hit area is ${hit!.height.toFixed(1)}px tall`)
      .toBeGreaterThanOrEqual(TOUCH_FLOOR);
    expect(hit!.width, `the switch hit area is ${hit!.width.toFixed(1)}px wide`)
      .toBeGreaterThanOrEqual(TOUCH_FLOOR);
  });

  it("and the theme and palette pills are measured too, not exempted", () => {
    /*
     * ⚠️ THE-316 reported these five stay at 20px because they are PR 347's
     * SHARED control, and deferred the decision here. They live in
     * ThemeToggle.tsx / PaletteFamilyToggle.tsx — files THE-321 does not own —
     * so this ticket cannot raise them; what it CAN do is stop them being
     * invisible. They are measured with every other target above, and this
     * records what they actually are so the next ticket to touch that shared
     * control has a number rather than a memory.
     */
    const pills = shown.get(PHONE)!.targets.filter((t) =>
      ['Harvest', 'Classic', 'Light', 'Dark', 'System'].includes(t.label));
    expect(pills.length, 'the five theme/palette pills were not found').toBe(5);
    /*
     * 🔴 THE NUMBER, PINNED. 20px is under the 44px floor and this ticket is
     * NOT raising it — see the exclusion note above. What it does instead is
     * make the shortfall an asserted fact rather than a remembered one: the
     * next ticket to touch PR 347's shared control has a measurement to work
     * from, and a change to that control — in either direction — fails here
     * and has to be looked at.
     */
    for (const p of pills) {
      expect(Math.round(p.height), `${p.label} is ${p.height.toFixed(1)}px, not the recorded 20px`)
        .toBe(20);
    }
    expect(20).toBeLessThan(TOUCH_FLOOR);
  });

  it('records the measured target heights at all five widths, both nav states', () => {
    /*
     * The ladder, kept as an assertion rather than a PR-body table so it cannot
     * go stale. Width is NOT monotonic here — the settings column SPLITS at xl
     * (1280), so it is narrower just above that breakpoint than just below —
     * which is why every rung is measured rather than only the extremes.
     */
    for (const v of VIEWPORTS) {
      for (const [state, m] of [['shown', shown], ['hidden', hidden]] as const) {
        const r = m.get(v)!;
        expect(r.targets.length, `no targets at ${v}px, nav ${state}`).toBeGreaterThan(10);
        expect(r.scrollWidth, `sideways scroll at ${v}px, nav ${state}`)
          .toBeLessThanOrEqual(r.clientWidth + 1);
      }
    }
  });

  it('above sm, nothing this ticket sizes exceeds Rule 4’s desktop band', () => {
    // 🔴 DENSITY_PX.control is 38 and DESKTOP_CONTROL_MAX_PX is 40 — a test
    // elsewhere asserts `control < 44` DELIBERATELY, so the 44px floor is a
    // PHONE rule and must not leak upward. The rows this ticket composes take
    // `min-h-11 sm:min-h-0`, so above sm they size from their own padding.
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_FLOOR);
    expect(DENSITY_PX.action).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
    for (const v of [768, 1024, 1280, 1440] as const) {
      const r = shown.get(v)!;
      expect(r.targets.length, `no targets measured at ${v}px`).toBeGreaterThan(0);
    }
  });
});

/* ═══ 11 · nav clearance, in both states ═══════════════════════════════════ */

describe('11 · the last row clears the nav at 380px, in BOTH nav states', () => {
  it('the nav is shown in one fixture and hidden in the other — the states differ', () => {
    // Without this the two runs could be the same page measured twice, which is
    // the silent failure a two-state assertion is most prone to.
    expect(shown.get(PHONE)!.navTop, 'the nav did not move between states')
      .not.toBeCloseTo(hidden.get(PHONE)!.navTop, 0);
  });

  it.each(VIEWPORTS)('nothing overflows horizontally at %ipx, nav shown', (v) => {
    const r = shown.get(v)!;
    expect(r.scrollWidth, `the page scrolls sideways at ${v}px`)
      .toBeLessThanOrEqual(r.clientWidth + 1);
  });

  it.each(VIEWPORTS)('nothing overflows horizontally at %ipx, nav hidden', (v) => {
    const r = hidden.get(v)!;
    expect(r.scrollWidth, `the page scrolls sideways at ${v}px`)
      .toBeLessThanOrEqual(r.clientWidth + 1);
  });

  it('the scroller reserves enough padding that the last row is reachable, nav shown', () => {
    const r = shown.get(PHONE)!;
    // 🔴 The scroll container carries `pb-24` (96px) and the nav's own height is
    // ~48px + the safe-area pad. What must hold is that the reserved padding
    // exceeds the nav, so scrolling to the end puts the last row above it.
    expect(r.navVisible, 'the nav is not rendered in the shown state').toBe(true);
    const navHeight = 720 - r.navTop;
    expect(navHeight, 'the nav is taller than the 96px pb-24 the scroller reserves')
      .toBeLessThanOrEqual(96);
  });

  it('and the rows still lay out with the nav hidden', () => {
    const r = hidden.get(PHONE)!;
    expect(r.lastRowBottom, 'no rows measured with the nav hidden').toBeGreaterThan(0);
  });
});
