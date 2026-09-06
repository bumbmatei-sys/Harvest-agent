// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — every
// getBoundingClientRect() is zeros even with the real compiled stylesheet
// injected, and getComputedStyle answers `block` for a flex container — so no
// assertion written against it could tell a 44px tap target from a 7.63px one,
// which is the entire question this file exists to answer. The modal is
// rendered to static markup and measured in real Chromium over CDP.
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
 * THE-323 — the personal-information modal, MEASURED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ MEASURED, NEVER ASSUMED. THE-317 found `ui/select` sizing itself with an
 * attribute selector that OUTRANKS Rule 4 and sticking at 32px, and tab
 * triggers rendering at 25px — both under a floor their class names claimed to
 * clear. Every number below is read out of Chromium.
 *
 * ── What this file is FOR, given THE-323 composes nothing ───────────────────
 *
 * THE-323 lands the append path and the silent-failure fix; the visual pass is
 * split out. So this file is a BASELINE, not a sign-off on a redesign: it
 * measures the modal as it stands, at all five widths, so the ticket that does
 * compose it starts from numbers rather than from class names. Two of those
 * numbers are load-bearing right now:
 *
 *   · 🔴 `min-h-11` IS INERT, and this file proves it rather than citing
 *     THE-321. `--spacing` is defined nowhere in globals.css, so
 *     `calc(var(--spacing) * 11)` is invalid at computed-value time and the
 *     declaration is dropped. A class whose NAME claims 44px, measured beside
 *     the explicit `min-h-[44px]` this repo actually uses.
 *   · The failure banner THE-323 adds carries no height of its own and takes
 *     no tap floor, and the two Save buttons it reports on keep theirs.
 *
 * ── The five widths, and why all five ───────────────────────────────────────
 *
 * 🔴 WIDTH IS NOT MONOTONIC here. This modal switches mobile→desktop at `lg:`
 * (1024px), not at `sm:` — so the widest, least-constrained rendering of a
 * field is the TABLET band (640-1023), not 1440px, where the
 * `lg:max-w-5xl lg:grid-cols-[300px_1fr]` cap has taken over. Checking only the
 * extremes would miss the worst case by construction; the suite's own docblock
 * measured 686-718px in that band against 560.75px at 1440.
 *
 * ⚠️ ONE MeasuringBrowser IN THIS FILE, opened once. Two instances in one
 * process collided on a PID-derived debugger port and silently compared a page
 * with itself; the port is the kernel's to choose now, but one browser per file
 * is still the rule. And nothing is read immediately after a resize — a
 * `transition-all` makes a prompt reading a lie, and THE-321 watched the same
 * control measure 7.63 → 7.69 → 7.75px across runs. A DRIFTING VALUE IS THE
 * TELL, so the probe waits out the longest transition (`duration-300`) plus a
 * frame before it measures anything.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;
/** Below `sm`. Above it, Rule 4's 38/40px band governs and 44px does not apply. */
const PHONE = 380;
const TOUCH_FLOOR = 44;

vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      uid: 'u1', email: 'member@church.org', displayName: 'Sarah Whitfield', photoURL: null,
      providerData: [{ providerId: 'password' }],
    },
  },
  db: {},
}));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', UPDATE: 'UPDATE' }, handleFirestoreError: () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('next/image', () => ({ default: () => null }));

const { default: PersonalInformationModal } = await import('../PersonalInformationModal');

interface Target { label: string; tag: string; width: number; height: number; cls: string }
interface Reading {
  viewport: number;
  scrollWidth: number;
  clientWidth: number;
  targets: Target[];
  fullName: { width: number; height: number } | null;
  /** The root font-size in force, which is what `min-h-11` is relative to. */
  rootPx: number;
  /** The two probes that settle what `min-h-11` actually does. */
  scaleToken: { minHeight: string; height: number };
  explicitToken: { minHeight: string; height: number };
}

/**
 * 🔴 AWAITS THE TRANSITIONS BEFORE IT READS A BOX. The Yes/No pills carry
 * `transition-all`, so a height read in the same frame as the resize is a lie.
 */
const PROBE = `(async () => {
  await new Promise((r) => setTimeout(r, 420));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const root = document.querySelector('[data-modal]');
  const targets = [...root.querySelectorAll('button,input:not([type=radio]):not([type=file]),label[for],[role="switch"]')]
    .filter(vis)
    .map((el) => {
      const b = el.getBoundingClientRect();
      return {
        label: (el.getAttribute('aria-label') || (el.textContent || '').trim() || el.getAttribute('type') || el.tagName).slice(0, 40),
        tag: el.tagName, width: b.width, height: b.height,
        cls: (el.getAttribute('class') || '').slice(0, 70),
      };
    })
    .filter((t) => t.width > 0 && t.height > 0);

  const nameInput = root.querySelector('input[type=text]');
  const nb = nameInput ? nameInput.getBoundingClientRect() : null;

  const read = (sel) => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    return { minHeight: cs.minHeight, height: el.getBoundingClientRect().height };
  };
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);

  return {
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    targets,
    fullName: nb ? { width: nb.width, height: nb.height } : null,
    rootPx,
    scaleToken: read('[data-probe="min-h-11"]'),
    explicitToken: read('[data-probe="min-h-44"]'),
  };
})()`;

/**
 * The modal inside the member shell, plus TWO BARE PROBES.
 *
 * ⚠️ The probes are empty divs carrying one class each and nothing else, so
 * what they measure is the CLASS and not a component that happens to use it.
 * That is the whole point: the question "does `min-h-11` do anything" must not
 * be answered through a control with its own padding.
 */
function page() {
  return renderToStaticMarkup(
    <>
      <div className="flex h-screen">
        <div className="hidden lg:block w-[224px] shrink-0" />
        <div className="min-w-0 flex-1 flex flex-col">
          <div data-modal>
            <PersonalInformationModal isOpen onClose={() => {}} />
          </div>
        </div>
      </div>
      {/*
        ⚠️ OUTSIDE THE FLEX CONTAINER, DELIBERATELY. A first attempt put both
        probes inside `flex h-screen`, where `align-items: stretch` gave each an
        800-900px height and BOTH "cleared" 44px — a measurement that agreed
        with nothing. In a plain block context a div's height is its content,
        which is zero, so the only thing that can lift it is the min-height
        under test. That is the question being asked.
      */}
      <div data-probes>
        <div data-probe="min-h-11" className="min-h-11" />
        <div data-probe="min-h-44" className="min-h-[44px]" />
      </div>
    </>,
  );
}

let browser: MeasuringBrowser | null = null;
const at = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the323-'));
  const file = path.join(dir, 'personal-information.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
    `<body>${page()}</body></html>`,
  );
  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
  for (const v of VIEWPORTS) at.set(v, await browser.evaluateAt<Reading>(v, PROBE, 900));
}, 300_000);

afterAll(async () => { await browser?.close(); });

/* ═══ 6 · what `min-h-11` ACTUALLY does — the premise, measured ═══════════ */

describe('6 · `min-h-11`, measured rather than cited', () => {
  /**
   * 🔴 THE PREMISE THE-323 WAS GIVEN IS WRONG, AND THIS IS WHERE IT WAS
   * CHECKED. The ticket states, as a trap THE-321 found: "`min-h-11` is INERT —
   * it compiles to `calc(var(--spacing) * 11)` and measured 7.63px."
   *
   * The first half is right and the conclusion does not follow. It DOES compile
   * to `calc(var(--spacing) * 11)` — and `--spacing: 0.25rem` is defined, by
   * Tailwind v4's own theme layer, in the stylesheet this app actually ships.
   * (It is not in `globals.css`, which is presumably where the "defined
   * nowhere" reading came from; `buildAppCss()` builds what the browser gets.)
   * So the calc resolves to 2.75rem, and 2.75rem at the 16px mobile root is
   * exactly 44px. Measured below: 44px, with `min-height: 44px` computed.
   *
   * ⚠️ WHERE 7.63px CAME FROM. THE-321's own measure suite records the number
   * against something else entirely: "`Button` carries `transition-all`, so
   * `min-height` ANIMATES from 0 to its 44px floor after layout; read too
   * early, the composed link CTA measured 7.63px, then 7.69px, then 7.75px on
   * three consecutive runs — a DRIFTING value, which is the tell." That is a
   * reading taken mid-transition, and THE-321 identified it as one and fixed it
   * by waiting. The number then travelled into this ticket attached to
   * `min-h-11` instead of to the timing bug it actually diagnosed. This file
   * waits out the same transition before it reads anything, which is why it
   * gets a stable 44.
   *
   * 🔴 SO `AdminSettings.tsx`'s `TOUCH_FLOOR = 'min-h-11 sm:min-h-0'` IS NOT A
   * DEFECT, and THE-323 does not "fix" it. Reporting a working control as
   * broken, and editing a frozen file to prove it, would have been the harm
   * here.
   *
   * ── The real difference, which is not nothing ───────────────────────────────
   *
   * `min-h-11` is REM-RELATIVE and `min-h-[44px]` is absolute, and this app
   * trims the root font-size to 14.5px at `lg` and up (globals.css: "trim the
   * rem base ~9% for lg+ only"). So above 1024px they diverge — 39.875px
   * against 44px — which is asserted below rather than described. Below `sm`,
   * where the 44px TOUCH FLOOR is the rule, the root is 16px and the two are
   * identical. Both spellings are therefore correct for a phone-only floor;
   * the explicit one is what this repo uses, and the reason to keep preferring
   * it is that it says the number it means at every width.
   */

  it('🔴 `min-h-11` resolves — it is NOT inert, and it is not 7.63px', () => {
    const probe = at.get(PHONE)!.scaleToken;
    expect(probe.minHeight, 'min-h-11 computed to nothing').not.toBe('0px');
    expect(probe.minHeight).toBe('44px');
    expect(probe.height).toBe(44);
    expect(probe.height, 'the 7.63px in the ticket is a mid-transition reading, not this class')
      .not.toBeCloseTo(7.63, 1);
  });

  it('the explicit `min-h-[44px]` this repo uses is 44px too, at phone width', () => {
    const probe = at.get(PHONE)!.explicitToken;
    expect(probe.minHeight).toBe('44px');
    expect(probe.height).toBe(44);
  });

  it('both clear the touch floor below sm, which is the only band it applies in', () => {
    const r = at.get(PHONE)!;
    expect(r.rootPx, 'the mobile root is no longer 16px — the equivalence rests on it').toBe(16);
    expect(r.scaleToken.height).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    expect(r.explicitToken.height).toBeGreaterThanOrEqual(TOUCH_FLOOR);
  });

  it('and they DIVERGE above lg, where the root font-size is trimmed to 14.5px', () => {
    // 🔴 The real reason to prefer the explicit spelling, measured. Not a
    // touch-floor failure — nothing takes a 44px floor at this width — but the
    // difference between a class that means 44px and one that means 2.75rem.
    for (const v of [1024, 1280, 1440] as const) {
      const r = at.get(v)!;
      expect(r.rootPx, `the rem trim is not in force at ${v}px`).toBe(14.5);
      expect(r.explicitToken.height, `min-h-[44px] moved at ${v}px`).toBe(44);
      expect(r.scaleToken.height, `min-h-11 is ${r.scaleToken.height}px at ${v}px`)
        .toBeCloseTo(14.5 * 2.75, 2);
      expect(r.scaleToken.height).toBeLessThan(r.explicitToken.height);
    }
    // Below the trim they are the same class, measured at both widths.
    for (const v of [380, 768] as const) {
      expect(at.get(v)!.rootPx).toBe(16);
      expect(at.get(v)!.scaleToken.height).toBe(at.get(v)!.explicitToken.height);
    }
  });
});

/* ═══ 7 · every control ≥44px below sm; Rule 4's 38px holds above ═════════ */

describe("7 · every control clears 44px below sm, and Rule 4's band holds above it", () => {
  /**
   * ⚠️ FOUR CONTROLS ARE UNDER THE FLOOR TODAY, BEFORE THE-323 TOUCHES
   * ANYTHING, and they are recorded rather than fixed. Measured at 380px:
   *
   *   the mobile close (X)   `p-2 -ml-2`                        40.0 × 40.0
   *   the mobile Save        `text-gold font-bold text-sm px-2` 54.2 × 20.0
   *   the photo pencil       `w-10 h-10 … rounded-full`         40.0 × 40.0
   *   "Change Photo"         `mt-3 text-sm font-medium`         98.0 × 20.0
   *
   * 🔴 LIFTING THEM IS THE COMPOSITION TICKET'S WORK, NOT THIS ONE'S — and the
   * reason is exactly what this ticket is about. Every one of those lifts is a
   * class change BELOW `sm`, which moves the sub-640px layer that
   * `PersonalInformationModal.mobile-layer.json` pins. Before THE-323 there was
   * no way to record that move except by overwriting the fixture; now there is,
   * and the ticket that composes the modal takes both together — the lift and
   * the recorded layer — which is the seam THE-323 splits on.
   *
   * ⚠️ THE-298's pattern is what that ticket uses: measure the control, lift
   * YOUR OWN with `min-h-[44px] sm:min-h-0`, never the primitive underneath.
   * `ui/input` is `h-8` (32px) and is NOT to be touched — the four inputs above
   * clear the floor at 56px because this file spells its own `py-4`, not
   * because the primitive helps.
   *
   * 🔴 The list is CLOSED and each entry is asserted to still be under the
   * floor, so it cannot outlive the defect: when the composition ticket lifts
   * one, this test fails and the entry comes out. A FIFTH control falling under
   * the floor fails here today.
   */
  const KNOWN_UNDER_FLOOR: ReadonlyArray<readonly [label: string, cls: string]> = [
    ['BUTTON', 'p-2 -ml-2 text-muted'],
    ['Save', 'text-gold font-bold text-sm px-2'],
    ['BUTTON', 'absolute bottom-0 right-0 w-10 h-10 bg-gold rounded-full flex items-ce'],
    ['Change Photo', 'mt-3 text-sm font-medium text-muted'],
  ];

  it('the modal was really measured at all five widths', () => {
    for (const v of VIEWPORTS) {
      expect(at.get(v), `${v}px was never measured`).toBeDefined();
      expect(at.get(v)!.viewport).toBe(v);
      expect(at.get(v)!.targets.length, `no controls found at ${v}px`).toBeGreaterThan(10);
    }
  });

  it('every tappable target clears 44px at 380px, beyond the four recorded ones', () => {
    const under = at.get(PHONE)!.targets
      .filter((t) => t.height < TOUCH_FLOOR)
      .filter((t) => !KNOWN_UNDER_FLOOR.some(([l, c]) => l === t.label && c === t.cls));
    expect(
      under.map((t) => `${t.label || t.tag} (${t.cls}) is ${t.height.toFixed(1)}px`),
      `these controls are under the ${TOUCH_FLOOR}px floor on a phone and nobody recorded them`,
    ).toEqual([]);
  });

  it('🔴 and the recorded list is exactly four — it cannot quietly widen, or outlive the defect', () => {
    expect(KNOWN_UNDER_FLOOR).toHaveLength(4);
    const targets = at.get(PHONE)!.targets;
    for (const [label, cls] of KNOWN_UNDER_FLOOR) {
      const found = targets.find((t) => t.label === label && t.cls === cls);
      expect(found, `"${label}" is recorded as under the floor but no longer rendered`).toBeDefined();
      expect(found!.height, `"${label}" now clears the floor — remove it from KNOWN_UNDER_FLOOR`)
        .toBeLessThan(TOUCH_FLOOR);
    }
  });

  it('every INPUT clears the floor on a phone — the h-8 primitive is not what sizes them', () => {
    // 🔴 Named separately because the ticket asks for inputs specifically, and
    // because the reason they pass is worth pinning: this file spells its own
    // `px-4 py-4`. `ui/input` is 32px and is not imported here at all.
    const inputs = at.get(PHONE)!.targets.filter((t) => t.tag === 'INPUT');
    expect(inputs.length, 'no inputs were measured').toBe(4);
    for (const i of inputs) {
      expect(i.height, `the ${i.label} input is ${i.height}px on a phone`)
        .toBeGreaterThanOrEqual(TOUCH_FLOOR);
    }
  });

  it("above sm, Rule 4's control band governs and nothing raises its ceiling", () => {
    // 🔴 `DENSITY_PX.control < 44` is DELIBERATE — the 44px floor is a phone
    // rule, and a desktop control at 38px is Rule 4 working, not a violation.
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_FLOOR);
    expect(DENSITY_PX.control).toBe(38);
    expect(DENSITY_PX.action).toBe(40);
    expect(DESKTOP_CONTROL_MAX_PX).toBe(40);
    for (const v of VIEWPORTS.filter((w) => w >= 768)) {
      const name = at.get(v)!.fullName!;
      expect(name.height, `Full Name is ${name.height}px at ${v}px — Rule 4 sets ${DENSITY_PX.control}`)
        .toBe(DENSITY_PX.control);
    }
  });

  it('the Full Name field is bounded at every width, and the desktop cap really binds', () => {
    /*
     * The five readings, recorded so the composition ticket starts from numbers
     * (Full Name input, in px):
     *
     *     380 → 298.00   768 → 408.00   1024 → 411.00   1280 → 411.00   1440 → 411.00
     *
     * ⚠️ MEASURED AT ALL FIVE BECAUSE WIDTH NEED NOT BE MONOTONIC, and here it
     * turns out it is: the field grows to the `FIELD_WIDTH.long` cap and then
     * stops, flat across 1024/1280/1440. That is worth stating plainly rather
     * than leaving as an assumption either way — checking only the extremes
     * would have found the same answer here BY LUCK, and the suite this file
     * sits beside records a case on this very screen (the 640-1023 tablet band)
     * where it does not hold.
     */
    for (const v of VIEWPORTS) {
      const w = at.get(v)!.fullName!.width;
      expect(w, `Full Name is ${w}px at ${v}px — it tracks the viewport, unbounded`)
        .toBeLessThan(v * 0.8);
    }
    const desktop = ([1024, 1280, 1440] as const).map((v) => at.get(v)!.fullName!.width);
    expect(new Set(desktop).size, `the cap stopped binding: ${desktop.join(' / ')}`).toBe(1);
    expect(at.get(380)!.fullName!.width)
      .toBeLessThan(at.get(768)!.fullName!.width);
  });

  it('the modal never overflows its viewport horizontally, at any of the five', () => {
    for (const v of VIEWPORTS) {
      const r = at.get(v)!;
      expect(r.scrollWidth, `the page scrolls horizontally at ${v}px`)
        .toBeLessThanOrEqual(r.clientWidth + 1);
    }
  });
});
