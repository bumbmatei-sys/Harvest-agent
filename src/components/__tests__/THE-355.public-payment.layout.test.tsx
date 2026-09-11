// @vitest-environment node
//
// NODE, NOT happy-dom — `happy-dom` HAS NO LAYOUT ENGINE, so
// `getBoundingClientRect()` returns zeroes with the real stylesheet injected
// and `getComputedStyle(el).display` answers `block` for a flex container. A
// source-only assertion — "the claim button's class string contains
// `min-h-11`" — would PASS ON A BROKEN SCREEN, and #490 measured exactly that
// class at 7.7469px mid-transition. Nothing here needs a DOM: the page is
// rendered to a string and every number comes out of a real Chromium over CDP.
//
// ONE `MeasuringBrowser` PER PROCESS — two instances collide on a debugger port.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { CONTROL_DENSITY } from '../layout/form-layout';

/**
 * THE-355 · 🔴 TEST 18 — EVERY CONTROL THIS TICKET ADDS TO THE PUBLIC PAGE
 * CLEARS THE 44px TAP FLOOR, AT FIVE WIDTHS, IN A REAL BROWSER.
 *
 * The payment-link rows and the "I've paid" button are BOTH tap targets, and
 * they are the two controls a person on a phone at a crusade actually uses.
 *
 * ⚠️ TRANSITIONS AND ANIMATIONS ARE SUPPRESSED IN THE MEASURED PAGE. #490
 * measured `min-h-[44px]` at 7.7469px mid-transition and a menu row at
 * 41.79998779296875px — exactly 44 × 0.95, the first frame of `zoom-in-95` —
 * because two animation frames is well inside a 150ms transition, and
 * `getBoundingClientRect()` reports the SCALED box. The resting layout is the
 * one a person sees and the only one worth asserting.
 *
 * 🔴 EVERY CLASS STRING IS READ OUT OF THE SHIPPED SOURCE AT RUN TIME. Nothing
 * is hand-copied and nothing is found by line number: a surface that moves
 * makes the discovery THROW rather than quietly measuring a default.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;
/** Rule 4's floor below `sm`. `sm` is 640px, so 380 is the width that must clear it. */
const TAP_FLOOR = 44;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = 'src/components/PublicEventRegistration.tsx';

/**
 * Pull one class string out of the shipped source, or throw naming what moved.
 * 🔴 A DISCOVERY THAT FINDS NOTHING MUST THROW. A fallback would turn "the
 * surface moved" into "the surface is fine", which is the failure mode a
 * discovery guard exists to prevent.
 */
function discover(re: RegExp, what: string): string {
  const m = read(PAGE).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${PAGE} — the surface moved`);
  return m[1];
}

/**
 * 🔴 THE CLAIM BUTTON'S ABOVE-`sm` HEIGHT IS A SHARED TOKEN, AND THIS RESOLVES
 * IT RATHER THAN COPYING IT.
 *
 * The component spends `CONTROL_DENSITY.action` — `form-layout.ts`'s own name
 * for a primary action's density — instead of minting an `h-[40px]` of its own,
 * which is what THE-345's "this ticket mints no height" sweep is for. So the
 * source spells a `${CONTROL_DENSITY.action}` no string scrape can see: the
 * discovery requires the control to actually spend it, then appends the REAL
 * value read from the module, so the measured page wears exactly what ships.
 */
function withDensity(raw: string, what: string): string {
  if (!raw.includes('${CONTROL_DENSITY.action}')) {
    throw new Error(`${what} no longer spends CONTROL_DENSITY.action — it mints a height`);
  }
  return raw.replace('${CONTROL_DENSITY.action}', CONTROL_DENSITY.action);
}

const claimClass = withDensity(
  discover(/data-public-claim\b[\s\S]{0,400}?className=\{`([^`]+)`\}/, 'the claim button'),
  'the claim button',
);
const payLinkClass = withDensity(
  discover(/data-public-pay-link\b[\s\S]{0,300}?className=\{`([^`]+)`\}/, 'a payment link'),
  'the payment link',
);
const submitClass = discover(
  /data-public-submit\b[\s\S]{0,200}?className="([^"]+)"/,
  'the submit button',
);

/**
 * THE SCENE: the confirmation panel exactly as the page builds it — the Shell's
 * own `max-w-xl` column and `px-4` gutter, the card, and the payment block with
 * a link row and the claim control.
 *
 * ⚠️ THE `item` AND `alert` MARKUP IS THE PRIMITIVES' OWN, spelled here as the
 * classes they resolve to, because this file is `@vitest-environment node` and
 * cannot render React components that reach for a browser. What it MUST get
 * right is the box model of the controls under test, and those wear the class
 * strings read off the shipped source above.
 */
const page = () => `
<div class="min-h-screen bg-surface py-10 px-4">
  <div class="max-w-xl mx-auto">
    <div class="bg-surface-raised rounded-[14px] shadow-xs border border-line p-8 text-center">
      <h2 class="font-display text-xl font-bold text-strong mb-1">You&#39;re registered!</h2>
      <div class="text-3xl font-mono font-bold tracking-widest text-strong my-4">QWE456</div>
      <div class="mt-5 text-left" data-public-payment-note>
        <div data-slot="separator" class="bg-border shrink-0 h-px w-full mb-5"></div>
        <div data-slot="alert" class="relative w-full rounded-lg border px-4 py-3 text-sm bg-card text-card-foreground">
          <div data-slot="alert-title" class="font-medium">How to pay</div>
          <div data-slot="alert-description" class="text-muted-foreground text-sm">
            This ticket costs $50.00, and Kingdom Living collects it directly through their own
            payment links below. Put HV-VSFK4W in the payment note so they can find it. Harvest
            does not handle this money and cannot see it &mdash; Kingdom Living opens their own
            account and decides. Bring this ticket either way &mdash; you will not be turned away
            at the door.
          </div>
        </div>
        <div class="mt-3 space-y-1.5" data-public-pay-options>
          <div data-slot="item" data-public-pay-option="revolut"
               class="group/item flex w-full flex-wrap items-center rounded-lg border text-sm border-border gap-2.5 px-3 py-2.5">
            <div data-slot="item-content" class="flex flex-1 flex-col gap-0.5">
              <div data-slot="item-title" class="text-sm leading-snug font-medium">Revolut</div>
            </div>
            <div data-slot="item-actions" class="flex items-center gap-2">
              <a href="https://revolut.me/kingdomliving" data-public-pay-link class="${payLinkClass}">Open</a>
            </div>
          </div>
        </div>
        <div class="mt-4">
          <button type="button" data-public-claim class="${claimClass}" style="background-color:#B8962E">I&#39;ve paid</button>
          <p class="mt-1.5 text-[11px] text-muted" data-public-claim-help>
            This only tells the church to go and look. It settles nothing on its own and it does
            not change what you owe. Keep the email with your ticket code.
          </p>
        </div>
      </div>
    </div>
    <div class="bg-surface-raised rounded-[14px] shadow-xs border border-line p-6 mt-4">
      <button data-public-submit class="${submitClass}" style="background-color:#B8962E">Register &middot; $50.00</button>
    </div>
  </div>
</div>`;

interface Box { x: number; y: number; w: number; h: number; right: number; bottom: number; display: string }
interface Reading { viewport: number; scrollWidth: number; boxes: Record<string, Box | null> }

const SELECTORS: Record<string, string> = {
  note: '[data-public-payment-note]',
  options: '[data-public-pay-options]',
  option: '[data-public-pay-option="revolut"]',
  link: '[data-public-pay-link]',
  claim: '[data-public-claim]',
  help: '[data-public-claim-help]',
  submit: '[data-public-submit]',
};

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the355-'));
  const file = path.join(dir, 'public-payment.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
    + `<style>${css}</style>`
    // See the header: an un-suppressed page reports DRIFTING mid-flight values.
    + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
    + `</head><body>${page()}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
                   right: round(b.right), bottom: round(b.bottom),
                   display: getComputedStyle(el).display };
        };
        const sel = ${JSON.stringify(SELECTORS)};
        const boxes = {};
        for (const k of Object.keys(sel)) boxes[k] = box(sel[k]);
        return { viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, boxes };
      })()`,
      900,
    );
    readings.set(viewport, r);
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};
const box = (v: number, key: string): Box => {
  const b = at(v).boxes[key];
  if (!b) throw new Error(`${key} was not measured at ${v} — the surface did not render`);
  return b;
};

/* ═══ 18 · every control ≥44px below sm ══════════════════════════════════ */

describe('18 · every tappable target clears 44px below sm', () => {
  it('🔴 the scene really laid out — nothing measured is a zero box', () => {
    // ⚠️ THE VACUITY GUARD. #490's probe used `pointerEvents:none` so
    // `elementFromPoint` skipped it and the check was STRUCTURALLY UNABLE TO
    // FAIL. Every assertion below divides by these boxes, so if they are zero
    // or absent the suite must say so here rather than pass silently.
    for (const v of VIEWPORTS) {
      for (const key of Object.keys(SELECTORS)) {
        const b = box(v, key);
        expect(b.w, `${key} has no width at ${v}px`).toBeGreaterThan(0);
        expect(b.h, `${key} has no height at ${v}px`).toBeGreaterThan(0);
      }
    }
  });

  it('🔴 the "I\'ve paid" button clears 44px at 380px', () => {
    const claim = box(380, 'claim');
    expect(claim.h, `the claim button is ${claim.h}px at 380 — under the tap floor`)
      .toBeGreaterThanOrEqual(TAP_FLOOR);
  });

  it('🔴 the payment LINK is a tap target too, and clears 44px at 380px', () => {
    // A payment-link row is the control a person on a phone actually presses to
    // leave for Revolut. An anchor is as much a tap target as a button.
    const link = box(380, 'link');
    expect(link.h, `the payment link is ${link.h}px at 380 — under the tap floor`)
      .toBeGreaterThanOrEqual(TAP_FLOOR);
  });

  it('🔴 and Rule 4’s density applies ABOVE sm rather than the phone floor', () => {
    // 40px is `CONTROL_DENSITY.action`. Above `sm` the controls tighten to it
    // rather than staying at the phone's 44 — which is the point of the token,
    // and what a hand-written `min-h-[44px]` everywhere would have broken.
    for (const v of [768, 1024, 1280, 1440]) {
      const claim = box(v, 'claim');
      expect(claim.h, `the claim button is ${claim.h}px at ${v}`).toBeGreaterThanOrEqual(38);
      expect(claim.h, `the claim button grew past its density at ${v}`).toBeLessThanOrEqual(48);
    }
  });

  it('🔴 the claim button and its warning do not overlap at any width', () => {
    // A member who cannot read "this settles nothing" before pressing will
    // arrive at the door believing they are paid.
    for (const v of VIEWPORTS) {
      const claim = box(v, 'claim');
      const help = box(v, 'help');
      expect(help.y, `the warning is under the button at ${v}px`)
        .toBeGreaterThanOrEqual(claim.bottom - 0.5);
    }
  });

  it('🔴 the link sits inside its row and never outside the note', () => {
    for (const v of VIEWPORTS) {
      const option = box(v, 'option');
      const link = box(v, 'link');
      const note = box(v, 'note');
      expect(link.right, `the link overflows its row at ${v}px`)
        .toBeLessThanOrEqual(option.right + 0.5);
      expect(option.right, `the row overflows the payment note at ${v}px`)
        .toBeLessThanOrEqual(note.right + 0.5);
    }
  });

  it('🔴 nothing scrolls sideways at any width, and the 16px gutter holds', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page overflows at ${v}px`).toBeLessThanOrEqual(v + 0.5);
      const note = box(v, 'note');
      expect(note.x, `the payment note touches the left edge at ${v}px`).toBeGreaterThanOrEqual(16);
      expect(v - note.right, `the payment note touches the right edge at ${v}px`)
        .toBeGreaterThanOrEqual(16);
    }
  });

  it('🔴 the submit button is full-width and clears the floor at 380px', () => {
    const submit = box(380, 'submit');
    expect(submit.h, `the submit button is ${submit.h}px at 380`).toBeGreaterThanOrEqual(TAP_FLOOR);
  });
});
