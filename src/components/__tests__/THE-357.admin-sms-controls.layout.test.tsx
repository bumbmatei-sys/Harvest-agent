// @vitest-environment node
//
// NODE, NOT happy-dom — the reason THE-356, THE-346, THE-331 and THE-320 each
// record: with a DOM environment selected `MeasuringBrowser` never attaches
// (its CDP request is cross-origin under browser fetch semantics) and the suite
// times out. Nothing here needs a DOM — the page is rendered to a string and
// every number is read out of a real Chromium over CDP.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Button } from '../ui/button';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import {
  ACTION_BUTTON,
  CONTROL_DENSITY,
  CONTROL_DENSITY_TOKENS,
  DENSITY_PX,
  DESKTOP_CONTROL_MAX_PX,
} from '../layout/form-layout';

/**
 * THE-357 · part 3 — `AdminSms`'s buttons, measured.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT #500 LEFT ON THE TABLE, AND WHY IT IS NOT A BLIND RESIZE
 *
 * THE-356 (#500) established that `ui/button.tsx`'s four intrinsic sizes are
 * 24 / 28 / 32 / 36px — every one under BOTH floors — so every adopter has to
 * bring its own height and nothing says so until it is measured. It then built
 * the measured guard, and reported `AdminSms`'s call sites at 25–36px above
 * `sm` without sweeping them. This is that sweep.
 *
 * ⚠️ #500 ALSO ESTABLISHED WHAT NOT TO DO, from its own first draft:
 *
 *   · A BLANKET 44px ABOVE `sm` WOULD CONTRADICT RULE 4 and turn the app red.
 *     Rule 4 fixes a desktop control at 38px and `form-layout.ts` asserts
 *     `DENSITY_PX.control < 44` DELIBERATELY — a desktop control is not a touch
 *     target. Section 4 below asserts that assertion is still intact.
 *
 *   · A BLANKET 38px ABOVE `sm` FLAGGED TEN CORRECT CALL SITES, among them
 *     `Profile`'s `variant="link"` partner link at 20.13px. That is inline text
 *     wearing a button's event handling, not a control, and `link` is the
 *     variant that says so. Section 3 measures that exact call site and asserts
 *     it is NOT governed — so a classifier that swept it up fails here.
 *
 *   · THE 40px A `min-h-11` CONTROL COMPUTES TO AT 1024+ IS THE TOKEN WORKING,
 *     not a failure: globals.css trims the rem base to 14.5px there, so 2.75rem
 *     is 40px. THE-354 measured exactly that and it is a pass, which section 4
 *     asserts as arithmetic rather than trusting.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 TRANSITIONS AND ANIMATIONS ARE SUPPRESSED IN THE MEASURED PAGE
 *
 * `buttonVariants`' base string carries `transition-all`, which includes
 * `min-height`, and `MeasuringBrowser.settle()` waits two animation frames
 * (~32ms) — well inside a 150ms transition. THE-346 read 7.7469px and
 * 1.43015px for the same element on consecutive runs, and #490 read a menu row
 * at 41.79998779296875px, which is exactly 44 x 0.95: the first frame of
 * `zoom-in-95`, because `getBoundingClientRect()` reports the SCALED box. The
 * page below kills both. `min-h-11` is NOT inert.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 SMS IS HIDDEN, AND THAT IS RECORDED RATHER THAN GLOSSED
 *
 * `SMS_FEATURE_ENABLED` is `false` (THE-335), and `AdminSms.tsx`'s default
 * export is `() => (SMS_FEATURE_ENABLED ? <AdminSmsScreen /> : null)` — so this
 * screen renders NOTHING today and no church can reach it. Section 5 asserts
 * that, in both directions, so nobody reads this suite as evidence the screen
 * is live. The fix still belongs in the tree: THE-245's contract is that the
 * flip back is ONE line and every surface returns exactly as it was, so a
 * surface left broken while hidden is a surface that ships broken on the flip.
 *
 * ⚠️ NOTHING IS PINNED TO A LINE NUMBER. Every call site is DISCOVERED by
 * parsing the shipped source — THE-331 pinned `AdminCommunity.tsx:491` and a
 * deletion shifted that surface to `:311`, so the suite would have measured
 * whatever landed there. A discovery that finds nothing THROWS here.
 *
 * ⚠️ Every source read goes through the PARSER-BASED stripper (#496), IMPORTED
 * rather than copied: the regex stripper it replaced ate 154 lines of one file,
 * 85 of them code.
 */

/** The founder's phone, and the four widths above it. Width is NOT monotonic. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Tailwind's `sm`. Below it the 44px touch floor; at and above it, Rule 4. */
const SM_PX = 640;

/** 🔴 TWO FLOORS, DIFFERENT NUMBERS ON PURPOSE — see the header. */
const TOUCH_FLOOR_PX = 44;
const DESKTOP_FLOOR_PX = 38;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));

const ADMIN_SMS = 'src/components/AdminSms.tsx';
const PROFILE = 'src/components/Profile.tsx';

// ═════════════════════════════════════════════════════════════════════════════
// Discovery
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every `<Button …>` OPENING TAG in a source string.
 *
 * 🔴 A BRACE-AWARE SCAN, NOT A REGEX, for the reason THE-356 records: these
 * tags carry arrow functions, nested objects and template literals, so
 * `/<Button[^>]*>/` stops at the first `>` inside an arrow body and returns a
 * truncated tag whose `className` is then missed entirely — and the call site
 * is silently measured as though it carried no floor at all.
 */
function buttonTags(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i += 1) {
    if (!src.startsWith('<Button', i)) continue;
    if (/[A-Za-z0-9_]/.test(src[i + 7] ?? '')) continue; // <ButtonGroup, <ButtonX
    let depth = 0;
    let quote: string | null = null;
    let j = i + 7;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (quote) {
        if (c === '\\') { j += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
  }
  return out;
}

/**
 * The layout constants a discovered `className` may interpolate, taken from the
 * MODULE rather than re-parsed out of its text.
 *
 * 🔴 THE VALUE HAS TO BE THE SHIPPED ONE. A resolver that re-parsed
 * `form-layout.ts` would be testing its own parser — the weakness THE-354
 * exposed in the member-screen spelling pins — and a resolver that DROPPED an
 * interpolation it could not read would measure the call site without the very
 * token that gives it its floor, reporting a correct button as broken or hiding
 * a broken one. So this maps the real exports, and anything else THROWS.
 */
const SCOPE: Readonly<Record<string, string>> = {
  ACTION_BUTTON,
  ...Object.fromEntries(
    Object.entries(CONTROL_DENSITY).map(([k, v]) => [`CONTROL_DENSITY.${k}`, v]),
  ),
};

function resolveInterpolation(expr: string): string {
  const key = expr.trim();
  const value = SCOPE[key];
  if (value === undefined) {
    throw new Error(
      `cannot resolve \${${key}} in an AdminSms Button className. This guard must `
      + 'not drop it: measuring the call site without its own token would report a '
      + 'correct button as broken, or hide a broken one. Name the constant in '
      + 'form-layout.ts and add it to SCOPE.',
    );
  }
  return value;
}

/** The `className` a call site ships, with every interpolation resolved. */
function classNameOf(tag: string): string {
  const dq = tag.match(/className="([^"]*)"/);
  if (dq) return dq[1];
  const tpl = tag.match(/className=\{`([^`]*)`\}/);
  if (tpl) return tpl[1].replace(/\$\{([^}]*)\}/g, (_m, e: string) => resolveInterpolation(e));
  if (/className=/.test(tag)) {
    throw new Error(`a Button className this guard cannot read: ${tag.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return '';
}

type CallSite = {
  id: string;
  file: string;
  variant?: string;
  size?: string;
  className: string;
  /** The raw tag, for a failure message that names the thing that is wrong. */
  tag: string;
};

function callSites(file: string, prefix: string): CallSite[] {
  return buttonTags(code(file)).map((tag, i) => {
    const flat = tag.replace(/\s+/g, ' ');
    return {
      id: `${prefix}-${i}`,
      file,
      variant: (flat.match(/variant="([^"]*)"/) ?? [])[1],
      size: (flat.match(/size="([^"]*)"/) ?? [])[1],
      className: classNameOf(tag),
      tag: flat.slice(0, 200),
    };
  });
}

const SMS_SITES = callSites(ADMIN_SMS, 'sms');
/** 🔴 #500's false positives, taken from the file it actually named. */
const PROFILE_LINKS = callSites(PROFILE, 'profile-link').filter((s) => s.variant === 'link');

/**
 * 🔴 WHAT THE DESKTOP FLOOR GOVERNS — the repo's own declaration, not a
 * hand-list. A button is a Rule-4 control when its resolved class string
 * carries a `CONTROL_DENSITY` token, so a call site that adopts one later is
 * governed automatically and one that is inline text never is.
 */
const isRule4Control = (s: CallSite) => CONTROL_DENSITY_TOKENS.some((t) => s.className.includes(t));

/** Inline text wearing a button's event handling. `link` is the variant that says so. */
const isInlineLink = (s: CallSite) => s.variant === 'link';

// ═════════════════════════════════════════════════════════════════════════════
// The measured page
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE PLANTED DEFECT, measured beside the real call sites. `ui/button.tsx`'s
 * own default is `h-8`, one of the four sizes THE-354 found under both floors;
 * #492 shipped the largest of them at 36x36 and it still had to be fixed. If
 * the comparisons below cannot see that this one is short, they are not
 * checking anything.
 */
const BARE_ID = 'the357-bare-default-button';

function page() {
  const render = (s: CallSite) => (
    <div key={s.id} data-site={s.id}>
      <Button
        {...(s.variant ? { variant: s.variant as never } : {})}
        {...(s.size ? { size: s.size as never } : {})}
        className={s.className || undefined}
      >
        Aa
      </Button>
    </div>
  );
  return (
    <div data-buttons className="flex flex-col items-start gap-2">
      {SMS_SITES.map(render)}
      {PROFILE_LINKS.map(render)}
      <div data-site={BARE_ID}><Button>Aa</Button></div>
    </div>
  );
}

type Heights = Record<string, number | null>;

const HEIGHTS_EXPR = `(() => {
  const out = {};
  for (const holder of document.querySelectorAll('[data-site]')) {
    const b = holder.querySelector('button, a');
    out[holder.getAttribute('data-site')] = b ? Math.round(b.getBoundingClientRect().height * 100) / 100 : null;
  }
  return out;
})()`;

let browser: MeasuringBrowser;
const heights: Record<number, Heights> = {};

setUpOrFail(async () => {
  const css = await buildAppCss();
  const html = renderToStaticMarkup(page());
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the357-'));
  const file = path.join(dir, 'the-357.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
      + `<style>${css}</style>`
      // See the header: `transition-all` animates min-height and `zoom-in-95`
      // scales the box, and `getBoundingClientRect()` reports the SCALED box.
      // The resting layout is the one a person sees.
      + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
      + `</head><body>${html}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
  for (const v of VIEWPORTS) heights[v] = await browser.evaluateAt<Heights>(v, HEIGHTS_EXPR);
}, 240_000);

afterAll(async () => { await browser?.close(); });

// ═════════════════════════════════════════════════════════════════════════════
// 1 · the discovery is real
// ═════════════════════════════════════════════════════════════════════════════

describe('1 · every AdminSms Button was discovered, and each is a control', () => {
  it('the discovery found AdminSms’s call sites at all', () => {
    // 🔴 A discovery that silently found nothing would make every measurement
    // below vacuously true — the shape #492 found three of in one PR.
    expect(SMS_SITES.length, 'no <Button> call site was discovered in AdminSms.tsx')
      .toBeGreaterThan(0);
    expect(SMS_SITES.length, 'AdminSms gained or lost a Button — re-read this suite before accepting it')
      .toBe(5);
    // Each discovered class string really is in the shipped file, so the
    // resolver cannot have invented one.
    const shipped = code(ADMIN_SMS);
    for (const s of SMS_SITES) {
      const literal = s.className.split(/\s+/).filter(Boolean);
      expect(literal.length, `${s.id} was discovered with no className at all`).toBeGreaterThan(0);
      expect(shipped, `${s.id}'s first class is not in the shipped file`).toContain(literal[0]);
    }
  });

  it('\u{1F534} none of them is an inline link — every AdminSms Button is a control', () => {
    // ⚠️ THE CLASSIFICATION, ESTABLISHED RATHER THAN ASSUMED. #500's first
    // draft swept ten correct call sites in because it did not make this
    // distinction. AdminSms has no `variant="link"` at all: its five are
    // Upgrade plan, Send now, Save Templates, Save Text-to-Give and Save.
    expect(SMS_SITES.filter(isInlineLink).map((s) => s.tag),
      'an AdminSms Button is inline text and must NOT be held to the control floor').toEqual([]);
  });

  it('\u{1F534} and every one of them declares itself a Rule-4 control', () => {
    // The opt-in the desktop floor is built on. A control that carries no token
    // is not governed above `sm`, which is exactly how these five measured
    // 25-36px there while the suite stayed green.
    const undeclared = SMS_SITES.filter((s) => !isRule4Control(s));
    expect(undeclared.map((s) => `${s.file} :: ${s.tag}`),
      'an AdminSms control carries no CONTROL_DENSITY token, so Rule 4 does not govern it')
      .toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · the floors, measured
// ═════════════════════════════════════════════════════════════════════════════

describe('2 · every AdminSms control clears its floor at every width', () => {
  it.each(VIEWPORTS)('at %ipx', (v) => {
    const floor = v < SM_PX ? TOUCH_FLOOR_PX : DESKTOP_FLOOR_PX;
    const short = SMS_SITES
      .map((s) => ({ s, h: heights[v][s.id] }))
      .filter(({ h }) => typeof h === 'number' && (h as number) < floor);
    expect(
      short.map(({ s, h }) => `${s.file} :: ${h}px < ${floor}px :: ${s.tag}`),
      `an AdminSms control is under the ${floor}px floor at ${v}px`,
    ).toEqual([]);
  });

  it('every control was actually measured — a null would make the floors vacuous', () => {
    for (const v of VIEWPORTS) {
      for (const s of SMS_SITES) {
        expect(typeof heights[v][s.id], `${s.id} was not rendered at ${v}px`).toBe('number');
        expect(heights[v][s.id] as number, `${s.id} measured zero at ${v}px`).toBeGreaterThan(0);
      }
    }
  });

  it('\u{1F534} and the checker FAILS an unsized Button below sm — planted, not inferred', () => {
    const bare = heights[380][BARE_ID];
    expect(typeof bare, 'the unsized control was not rendered').toBe('number');
    expect(bare as number,
      'an unsized Button now clears the touch floor on its own — the trap is gone, and this guard '
      + 'should be re-examined').toBeLessThan(TOUCH_FLOOR_PX);
    // And it is under the desktop floor too, which is what the AdminSms sites
    // measured before this ticket: the primitive's own sizes are 24/28/32/36.
    expect(heights[1440][BARE_ID] as number,
      'an unsized Button now clears the desktop floor on its own').toBeLessThan(DESKTOP_FLOOR_PX);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · an inline link is NOT a control
// ═════════════════════════════════════════════════════════════════════════════

describe('3 · an inline link is not flagged as a control', () => {
  it('\u{1F534} Profile’s variant="link" sites are discovered, and are NOT Rule-4 controls', () => {
    // 🔴 #500's TEN FALSE POSITIVES, and the one it named by number: the
    // partner link measured 20.13px above `sm`. Demanding a 38px box around a
    // text link is the same category error as demanding 44px above `sm`.
    expect(PROFILE_LINKS.length, 'the link call sites #500 named are gone from Profile.tsx')
      .toBeGreaterThan(0);
    expect(PROFILE_LINKS.filter(isRule4Control).map((s) => s.tag),
      'an inline text link was classified as a Rule-4 control').toEqual([]);
  });

  it('\u{1F534} and they really are short above sm — so a classifier that swept them up would fail', () => {
    // ⚠️ THE NON-VACUITY HALF. If these measured 38px anyway, "not governed"
    // would be a claim with nothing behind it. They do not.
    for (const v of VIEWPORTS.filter((w) => w >= SM_PX)) {
      for (const s of PROFILE_LINKS) {
        expect(heights[v][s.id] as number, `${s.id} is no longer inline text at ${v}px`)
          .toBeLessThan(DESKTOP_FLOOR_PX);
      }
    }
  });

  it('but below sm they are still a real touch target, because every button is', () => {
    // The universal claim, and the one a thumb makes: `min-h-[44px]` below `sm`.
    for (const s of PROFILE_LINKS) {
      expect(heights[380][s.id] as number, `${s.id} is under the touch floor at 380px`)
        .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · Rule 4's deliberate 38px is intact
// ═════════════════════════════════════════════════════════════════════════════

describe('4 · Rule 4 is not broken to buy this', () => {
  it('\u{1F534} DENSITY_PX.control is still under 44, and form-layout still asserts it', () => {
    // 🔴 THE ASSERTION THAT IS INTENTIONAL. A desktop control is not a touch
    // target; a guard demanding 44px above `sm` would contradict Rule 4 and
    // turn the app red. This ticket raises neither number.
    expect(DENSITY_PX.control, 'Rule 4’s desktop control height moved').toBe(38);
    expect(DENSITY_PX.control, 'Rule 4’s deliberate sub-44 control was raised to a touch floor')
      .toBeLessThan(TOUCH_FLOOR_PX);
    expect(DENSITY_PX.action, 'Rule 4’s action height moved').toBe(40);
    expect(DESKTOP_CONTROL_MAX_PX, 'the top of the desktop density band moved').toBe(40);
    expect(DESKTOP_FLOOR_PX, 'this suite raised Rule 4’s floor').toBe(38);
  });

  it('the tokens and the numbers still agree', () => {
    expect(CONTROL_DENSITY.control).toContain(`sm:h-[${DENSITY_PX.control}px]`);
    expect(CONTROL_DENSITY.action).toContain(`sm:h-[${DENSITY_PX.action}px]`);
  });

  it('\u{1F534} a 40px control at 1024+ is NOT read as a failure', () => {
    // ⚠️ `min-h-11` is 2.75rem and globals.css trims the rem base to 14.5px
    // above 1024px, so a 44px phone control computes to 40px on a desktop.
    // THE-354 measured exactly that. Rule 4's floor is 38, so it is a pass —
    // asserted as arithmetic rather than trusted.
    expect(40).toBeGreaterThanOrEqual(DESKTOP_FLOOR_PX);
    expect(40).toBeLessThan(TOUCH_FLOOR_PX);
    // And measured: no AdminSms control exceeds the top of the band above `sm`.
    for (const v of VIEWPORTS.filter((w) => w >= SM_PX)) {
      for (const s of SMS_SITES) {
        expect(heights[v][s.id] as number, `${s.id} is over the desktop band at ${v}px`)
          .toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · the screen is hidden, and this suite says so
// ═════════════════════════════════════════════════════════════════════════════

describe('5 · AdminSms does not render today, and that is recorded', () => {
  it('\u{1F534} SMS_FEATURE_ENABLED is false and the default export returns null', async () => {
    const { SMS_FEATURE_ENABLED } = await import('../../lib/sms-feature');
    expect(SMS_FEATURE_ENABLED, 'SMS came back — re-read this suite’s header').toBe(false);
    expect(code(ADMIN_SMS), 'the switch stopped gating the screen')
      .toContain('SMS_FEATURE_ENABLED ? <AdminSmsScreen /> : null');
  });

  it('and the shell still refuses to mount it while the switch is off', () => {
    expect(code('src/components/AdminDashboard.tsx'), 'the dashboard stopped gating the SMS section')
      .toMatch(/SMS_FEATURE_ENABLED/);
  });
});
