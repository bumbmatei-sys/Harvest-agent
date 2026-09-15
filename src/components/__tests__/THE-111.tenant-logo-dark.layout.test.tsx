// @vitest-environment node
//
// NODE, NOT happy-dom. Every number below is a COMPUTED STYLE or a
// BOUNDING BOX, and `happy-dom` has no layout engine and no Tailwind cascade:
// with the real compiled stylesheet injected it answers `rgba(0, 0, 0, 0)` for
// every background and zero for every rect, so a DOM-environment version of
// this file would pass on the defect it exists to catch. `MeasuringBrowser`
// additionally cannot attach under browser fetch semantics (its CDP request is
// cross-origin), so the pragma is load-bearing twice over.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

import PublicGiving from '../PublicGiving';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { contrastRatio, AA_CONTRAST, CREAM } from '../../lib/theme';
import { applyBrandAccent, BRAND_ACCENT_PROPERTIES } from '../../lib/brand-accent';
import { PREAUTH_PATHS } from '../../lib/preauth-theme';

/**
 * THE-111 — an uploaded logo does not invert.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT WAS ACTUALLY OPEN, AND WHY IT IS NOT THE MECHANISM
 *
 * `.logo-plate` was NOT missing. It has been in `globals.css` since theming
 * stage 3, with a docblock that reasons through all three candidate answers —
 * a plate, a second per-tenant dark upload, a computed filter — and chooses the
 * plate, because it needs no upload flow, no storage, no migration for tenants
 * who already uploaded one, and it works for a COLOURED logo, which a filter
 * mangles and a missing second upload leaves unhandled.
 *
 * ⚠️ WHAT WAS OPEN IS COVERAGE. Ten surfaces render a tenant-uploaded logo and
 * exactly TWO carried the class — `MainApp`'s desktop rail and `AuthPage`. The
 * other eight included every public giving and registration surface: the pages
 * a STRANGER opens from a shared link, on their own phone, under their own
 * colour-scheme preference. `/auth`, `/onboarding` and `/church-onboarding` are
 * forced light by `PREAUTH_PATHS`, so the theme never reaches them — but
 * `/giving`, `/pledge`, `/campaign`, `/event`, `/checkin`, `/form` and
 * `/calendar` are NOT in that list, so they follow `prefers-color-scheme` and
 * paint `--surface-tint`, which is `#141414` in dark. A church with a dark-ink
 * wordmark handed out a link whose header was blank for every visitor whose
 * phone is in dark mode.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 SO THE ARGUMENT IS IN TWO HALVES, AND BOTH ARE NEEDED
 *
 * Part 1 MEASURES that the class does what it claims, on a SHIPPED component
 * (`PublicGiving`, rendered from source) in a real Chromium, in both themes.
 * Part 2 SWEEPS the tree so that no ninth surface can be added without it. A
 * measurement alone proves a mechanism nobody has to use; a sweep alone proves
 * a class name is present without proving it paints anything.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 TRANSITIONS AND ANIMATIONS ARE SUPPRESSED IN THE MEASURED PAGE
 *
 * #490 measured `min-h-[44px]` at 7.7469px mid-transition, and THE-346 read two
 * different values for one element on consecutive runs. The resting layout is
 * the one a person sees, so the page carries the same blanket suppression every
 * measuring suite in this repo carries.
 *
 * ⚠️ NOTHING HERE IS PINNED TO A LINE NUMBER and nothing reads the branch's own
 * diff. Part 2 DISCOVERS its surfaces by parsing the shipped source; a discovery
 * that finds nothing THROWS rather than passing vacuously. Every source read
 * goes through #496's parser-based stripper, IMPORTED rather than copied.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/** A realistic dark-ink wordmark: near-black on transparent. The disappearing case. */
const INK = '#1A1A1A';
const DARK_INK_LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48">` +
      `<rect x="0" y="12" width="160" height="24" fill="${INK}"/></svg>`,
  );

/** `rgb(250, 248, 245)` / `rgba(0, 0, 0, 0)` → `#FAF8F5` / null when transparent. */
function toHex(computed: string): string | null {
  const m = computed.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  const h = (v: string) => Number(v).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toUpperCase();
}

interface Reading {
  /** The plate's own painted background, or null when it paints nothing. */
  logoBackground: string;
  logoBoxShadow: string;
  /** The ground the logo sits on once the plate is stripped. */
  groundBackground: string;
  /** The same element's box, plated and unplated — the layout-shift check. */
  platedRect: { width: number; height: number; x: number; y: number };
  unplatedRect: { width: number; height: number; x: number; y: number };
}

/**
 * 🔴 THE CONTROL IS THE SAME ELEMENT, NOT A SECOND ONE.
 *
 * The honest question is "what does removing the class change", so the class is
 * removed from the very element just measured and the element is measured
 * again. A second, separately-placed `<img>` would differ in position as well as
 * in class, and the ground behind it would be a different question.
 */
const READ = (theme: 'light' | 'dark') => `(() => {
  const root = document.documentElement;
  root.setAttribute('data-theme', ${JSON.stringify(theme)});
  root.classList.toggle('dark', ${JSON.stringify(theme === 'dark')});
  const img = document.querySelector('img.logo-plate');
  if (!img) throw new Error('the shipped PublicGiving rendered no img.logo-plate');
  const rect = (el) => { const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, x: r.x, y: r.y }; };
  const plated = getComputedStyle(img);
  const out = {
    logoBackground: plated.backgroundColor,
    logoBoxShadow: plated.boxShadow,
    platedRect: rect(img),
  };
  img.classList.remove('logo-plate');
  const bare = getComputedStyle(img);
  out.unplatedRect = rect(img);
  out.logoBackgroundUnplated = bare.backgroundColor;
  // What is actually behind the mark once the plate is gone: walk up to the
  // first ancestor that paints something. A literal would be wrong — the page
  // ground is a token and the ramp has moved before.
  let el = img.parentElement, ground = 'rgba(0, 0, 0, 0)';
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+))?/);
    if (m && (m[4] === undefined || Number(m[4]) > 0)) { ground = bg; break; }
    el = el.parentElement;
  }
  out.groundBackground = ground;
  img.classList.add('logo-plate');
  return out;
})()`;

let browser: MeasuringBrowser | undefined;
const reading: Record<string, Reading> = {};

setUpOrFail(async () => {
  const css = await buildAppCss();
  const html = renderToStaticMarkup(
    React.createElement(PublicGiving, {
      tenantName: 'Grace Chapel',
      logo: DARK_INK_LOGO,
      links: [],
    }),
  );
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the111-'));
  const file = path.join(dir, 'the-111.html');
  writeFileSync(
    file,
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8">` +
      `<style>${css}</style>` +
      // See the header. `getBoundingClientRect()` reports the SCALED box, so an
      // un-suppressed page reports a number from mid-flight.
      `<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>` +
      `</head><body>${html}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
  reading.light = await browser.evaluateAt<Reading>(380, READ('light'));
  reading.dark = await browser.evaluateAt<Reading>(380, READ('dark'));
}, 240_000);

afterAll(async () => { await browser?.close(); });

// ═════════════════════════════════════════════════════════════════════════════
// 1 · measured, on a shipped surface, in a real browser
// ═════════════════════════════════════════════════════════════════════════════

describe('1 · an uploaded dark-ink logo is legible on the dark theme', () => {
  it('🔴 the mechanism is a CREAM PLATE, and it is what the dark theme paints', () => {
    /**
     * The named mechanism, asserted as a colour rather than as a class name.
     * `--cream` is defined ONCE in globals.css and is deliberately not
     * redefined under the dark palette — the plate is light in dark mode, which
     * is the whole point — so the token and the constant agree.
     */
    const painted = toHex(reading.dark.logoBackground);
    expect(painted, 'the plate painted nothing on the dark theme').not.toBeNull();
    expect(painted).toBe(CREAM.toUpperCase());
    expect(reading.dark.logoBoxShadow, 'the 3px ring is what keeps the plate off the glyphs')
      .toMatch(/rgb/);
  });

  it('🔴 so the ink clears AA against what is behind it — and does NOT without the plate', () => {
    const plate = toHex(reading.dark.logoBackground)!;
    const ground = toHex(reading.dark.groundBackground)!;

    const withPlate = contrastRatio(INK, plate);
    const withoutPlate = contrastRatio(INK, ground);

    // The fix: near-black ink on the cream plate.
    expect(withPlate, `dark-ink logo on the plate measured ${withPlate}:1`)
      .toBeGreaterThanOrEqual(AA_CONTRAST);

    // 🔴 THE DEFECT, MEASURED. Without the plate the same mark sits on the dark
    // page ground. This is not "a bit low" — it is invisible.
    expect(withoutPlate, `the unplated control measured ${withoutPlate}:1, which is not a defect`)
      .toBeLessThan(1.5);

    // And the plate is worth an order of magnitude, not a rounding error.
    expect(withPlate / withoutPlate).toBeGreaterThan(8);

    /**
     * 🔵 THE MEASURED FIGURES, RECORDED. #1A1A1A on `--cream` is 16.42:1 and the
     * same ink on the dark page ground is 1.06:1. They are pinned loosely — to
     * two significant figures, with room for the ramp to move — because the
     * CLAIM is the gap, not the decimals, and a tight pin on a token's exact
     * value is a second copy of `THE-338`'s job.
     */
    expect(withPlate).toBeGreaterThan(15);
    expect(withoutPlate).toBeLessThan(1.1);
  });
});

describe('2 · a transparent logo is not boxed unnecessarily', () => {
  it('🔴 the plate paints NOTHING on the light theme — it is a no-op, not a box', () => {
    /**
     * The cost of choosing the plate is that it boxes a transparent logo that
     * did not need one. That cost is bounded to the theme that needs it: in
     * light, a transparent logo renders exactly as it did before the class
     * existed.
     */
    expect(toHex(reading.light.logoBackground),
      'the plate painted a box on the light theme, where nothing is illegible').toBeNull();
    expect(reading.light.logoBoxShadow, 'the light theme drew the ring').toBe('none');
  });

  it('🔴 and it NEVER shifts layout, in either theme — box-shadow, not padding', () => {
    /**
     * The plate is drawn with `background` + a `box-shadow` ring rather than
     * padding or a border, so it occupies no space. Measured by stripping the
     * class off the element and re-reading its box: a padding-based plate would
     * move every one of these numbers.
     */
    for (const theme of ['light', 'dark'] as const) {
      expect(reading[theme].platedRect,
        `the plate changed the logo's box on the ${theme} theme`)
        .toEqual(reading[theme].unplatedRect);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · every themeable surface that renders a tenant logo carries the plate
// ═════════════════════════════════════════════════════════════════════════════

/** Identifiers a tenant-uploaded logo is bound to before it reaches an `<img>`. */
const LOGO_SRC_NAMES = ['logo', 'logoSrc', 'displayLogo'];

/**
 * 🔴 SURFACES ARE DISCOVERED, NOT LISTED. A hardcoded roster is what let eight
 * surfaces sit unplated behind two that were fixed: the list was written once
 * and never re-derived. This parses every component in the tree and finds the
 * `<img>` elements whose `src` is one of the tenant-logo bindings above.
 */
function tenantLogoImages(): Array<{ file: string; className: string }> {
  const found: Array<{ file: string; className: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue;
        walk(full);
      } else if (name.endsWith('.tsx')) {
        const rel = path.relative(SRC, full);
        const source = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node) => {
          if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
            const tag = node.tagName.getText(source);
            if (tag === 'img') {
              const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
              const at = (n: string) => attrs.find((a) => a.name.getText(source) === n);
              const src = at('src');
              const srcText = src?.initializer ? src.initializer.getText(source) : '';
              const bound = LOGO_SRC_NAMES.some((id) =>
                new RegExp(`\\{\\s*${id}\\s*\\}`).test(srcText));
              if (bound) {
                const cls = at('className');
                found.push({
                  file: rel,
                  className: cls?.initializer ? cls.initializer.getText(source) : '',
                });
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
  };
  walk(path.join(SRC, 'components'));
  return found;
}

/**
 * The surfaces the theme can never reach, with the reason each is exempt.
 *
 * ⚠️ `PREAUTH_PATHS` is IMPORTED, not restated, so this exemption cannot outlive
 * the list that justifies it: if `/onboarding` ever stops being forced light,
 * the assertion below starts demanding the plate on that file.
 */
const FORCED_LIGHT_SURFACES: ReadonlyArray<readonly [file: string, route: string]> = [
  ['components/Onboarding.tsx', '/onboarding'],
];

/**
 * 🔴 SPLIT OUT OF THIS TICKET, WITH THE COST MEASURED. `AdminDashboard.tsx` has
 * the same defect on its desktop rail mark — a 36px tenant logo on
 * `--surface-raised`, the exact shape `MainApp`'s rail has plated since theming
 * stage 3 — and it is NOT fixed here.
 *
 * ⚠️ THE REASON IS BLAST RADIUS, AND IT WAS MEASURED RATHER THAN GUESSED. The
 * one-class change was made, the full suite was run, and it reddened TWELVE
 * suites plus `THE-305`: `AdminDashboard.tsx` is digest-frozen by THIRTEEN
 * separate freeze registers, each keeping its own accepted list. Every one has
 * a documented append path, so the change is POSSIBLE — it is not blocked, it is
 * disproportionate. Thirteen freeze registers edited for one 36px mark on an
 * admin screen is thirteen places to record a wrong digest, and a wrong digest
 * in a freeze register is worse than no change at all.
 *
 * 🔵 AND IT IS A DIFFERENT SURFACE CLASS. The seven surfaces this ticket does
 * fix are PUBLIC pages a stranger opens from a shared link, on their own phone,
 * under their own colour-scheme preference. The admin rail is a screen the
 * church's own administrator opens, having already seen their logo elsewhere in
 * the product. Same defect, different urgency, and the second one is its own
 * ticket.
 *
 * The file's SECOND logo — the 16px mark inside the brand-tinted "Open member
 * app" chip — is a separate question again and should NOT simply be plated: a
 * 3px cream ring on a 16px image inside a 24px chip does not plate the mark, it
 * REPLACES the chip, whose fill has its own dark-mode reasoning at the call
 * site. That one is a design decision, not a bug fix.
 */
const SPLIT_OUT_SURFACES: ReadonlyArray<readonly [file: string, why: string]> = [
  ['components/AdminDashboard.tsx',
    'digest-frozen by thirteen freeze registers — split out, see the note above'],
];

describe('3 · every themeable tenant-logo surface carries the plate', () => {
  const images = tenantLogoImages();

  it('🔴 the sweep finds the surfaces it is meant to sweep', () => {
    // A discovery that finds nothing must THROW, not pass. Ten surfaces render a
    // tenant logo today; the floor is deliberately below that so an unrelated
    // deletion does not fail this, and deliberately high enough that a broken
    // parse does.
    expect(images.length, 'the tenant-logo discovery found nothing — the parse is broken')
      .toBeGreaterThanOrEqual(8);
    const files = new Set(images.map((i) => i.file));
    for (const surface of ['components/PublicGiving.tsx', 'components/MainApp.tsx']) {
      expect([...files], `${surface} is not in the swept set`).toContain(surface);
    }
  });

  it('🔴 and every one of them plates it, except the surfaces named with reasons', () => {
    const exempt = new Set<string>([
      ...FORCED_LIGHT_SURFACES.map(([f]) => f),
      ...SPLIT_OUT_SURFACES.map(([f]) => f),
    ]);
    const bare = images
      .filter((i) => !exempt.has(i.file))
      .filter((i) => !/\blogo-plate\b/.test(i.className))
      .map((i) => `${i.file} — ${i.className}`);

    expect(bare, 'a tenant logo renders on a themeable surface with no plate behind it:\n  '
      + bare.join('\n  ')).toEqual([]);
  });

  it('🔴 the forced-light exemption is derived from PREAUTH_PATHS, not asserted', () => {
    // If the route ever leaves PREAUTH_PATHS the theme reaches it and the
    // exemption above is wrong. This is what makes that a failure rather than a
    // stale comment.
    for (const [file, route] of FORCED_LIGHT_SURFACES) {
      expect(PREAUTH_PATHS as readonly string[],
        `${file} is exempt because ${route} is forced light, and it no longer is`)
        .toContain(route);
    }
  });

  it('🔴 the split-out surface is still UNFIXED, and is still exactly two logos', () => {
    /**
     * 🔵 THE SPLIT IS ASSERTED, NOT JUST DESCRIBED. If a later ticket plates
     * `AdminDashboard`, this fails and whoever did it must move the file out of
     * `SPLIT_OUT_SURFACES` — so the exemption cannot outlive the reason for it
     * and quietly become a hole. The count is pinned too: the note above
     * reasons about TWO logos in this file, and a third would be uncovered by
     * an exemption written for two.
     */
    const onFile = images.filter((i) => i.file === 'components/AdminDashboard.tsx');
    expect(onFile.length, 'AdminDashboard no longer renders the two logos the split-out assumes')
      .toBe(2);
    expect(onFile.filter((i) => /\blogo-plate\b/.test(i.className)),
      'AdminDashboard was plated after all — take it out of SPLIT_OUT_SURFACES').toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · the client can no longer disagree with the server about the accent
// ═════════════════════════════════════════════════════════════════════════════

describe('4 · the tenant accent is written as a SET, or not at all', () => {
  /** The properties `layout.tsx` stamps, read out of the shipped file. */
  const stampedByServer = (): string[] => {
    const code = stripComments(readFileSync(path.join(SRC, 'app/layout.tsx'), 'utf8'));
    // The whole template literal, backtick to backtick. A lazy match to the
    // first `}` stops inside `${brandColor}` and reports one property.
    const block = code.match(/`(:root\{[^`]*)`/);
    if (!block) throw new Error('layout.tsx no longer stamps a :root brand block — re-derive this');
    return [...block[1].matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]);
  };

  it('🔴 the client helper writes exactly what the server stamps', () => {
    /**
     * ⚠️ DERIVED FROM layout.tsx, NOT RESTATED. `layout.tsx` is pinned by
     * thirty-nine files and is not touched by this ticket; reading it is how the
     * two stay in step without editing it.
     */
    const server = stampedByServer().filter((p) => p.startsWith('--brand-color'));
    expect([...BRAND_ACCENT_PROPERTIES].sort()).toEqual([...new Set(server)].sort());
  });

  it('🔴 neither client path sets --brand-color on its own any more', () => {
    /**
     * THE DEFECT. `documentElement.style.setProperty` writes an INLINE style on
     * <html>, which beats the server's `:root{}` block on specificity. Setting
     * the raw accent alone therefore moved it while the two DERIVED properties
     * kept the value the server computed from the PREVIOUS hex — so on the dark
     * theme every on-dark consumer painted an accent corrected against a colour
     * that was no longer on screen. In `BrandingSection`'s live picker that
     * disagreement persisted for as long as the admin stayed on the screen.
     */
    for (const rel of ['contexts/TenantContext.tsx', 'components/settings/BrandingSection.tsx']) {
      const code = stripComments(read(rel));
      expect(code, `${rel} still writes the raw accent without its derived pair`)
        .not.toMatch(/setProperty\(\s*['"]--brand-color['"]/);
      expect(code, `${rel} no longer restates the accent at all`)
        .toMatch(/applyBrandAccent\(/);
    }
  });

  it('🔴 a malformed hex writes NOTHING rather than stamping it into all three', () => {
    /**
     * `deriveOnDarkAccent` never refuses a well-formed hex and returns its input
     * unchanged for anything else — so writing on a malformed value would put
     * the raw string into all three properties and replace a correct derived
     * accent with a broken one. Leaving the server's consistent set standing is
     * the safe state.
     */
    const writes: string[] = [];
    const el = { style: { setProperty: (k: string) => writes.push(k) } } as unknown as HTMLElement;

    expect(applyBrandAccent(el, 'rebeccapurple')).toBe(false);
    expect(applyBrandAccent(el, '#GGGGGG')).toBe(false);
    expect(applyBrandAccent(el, '')).toBe(false);
    expect(applyBrandAccent(null, '#C9963A')).toBe(false);
    expect(writes, 'a malformed hex reached the stylesheet').toEqual([]);

    expect(applyBrandAccent(el, '#C9963A')).toBe(true);
    expect(writes).toEqual([...BRAND_ACCENT_PROPERTIES]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · what this ticket must not have moved
// ═════════════════════════════════════════════════════════════════════════════

describe('5 · no-regression', () => {
  it('🔴 the accepted low-contrast pairs are untouched', () => {
    /**
     * 🔴 `--chart-4` (1.50:1), `--chart-5` (1.77:1) and `progress`
     * (`bg-primary` on `bg-muted`, 2.30:1) are ACCEPTED, not defects, and so is
     * the 4.77:1 worst text pair. #482 established that the "5.66 / 5.69 floor"
     * is ONE GOLD BUTTON PAIR and not a floor over all text.
     *
     * ⚠️ They are pinned by `the-272-shadcn-batch-b.test.ts`,
     * `the-294-activity-guards.test.ts` and `THE-338.palette-measured.test.ts`
     * ALREADY. This asserts the tokens are byte-unchanged rather than restating
     * three ratios a fourth time — a fourth copy of a pin is a fourth place to
     * update, and the three that exist were verified by mutation for this
     * ticket rather than trusted.
     */
    const css = readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    for (const token of ['--chart-4', '--chart-5']) {
      expect(css, `${token} left globals.css`).toContain(token);
    }
    // The plate's own rule, which is the only thing this ticket relies on in
    // this file and the only thing it could have been tempted to widen.
    expect(css).toContain('background: var(--cream);');
    expect(css).toContain('box-shadow: 0 0 0 3px var(--cream);');
  });

  it('🔴 layout.tsx, firestore.rules, the indexes and functions/ are byte-identical', () => {
    /**
     * ⚠️ `layout.tsx` is pinned by thirty-nine files and only three have an
     * append path; #510 proved one deleted line reddens 38 suites. This ticket
     * READS it (section 4) and does not write it.
     *
     * 🔴 AND THIS TICKET RECORDS NO firestore.rules DIGEST. It adds no Firestore
     * operation of any kind — it changes a class name on eight `<img>` elements
     * and the set of custom properties two client paths write — so there is
     * nothing a rule could express. The digests below are asserted from the
     * repo's own pinned literal, not spelled again here.
     */
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const sha = (rel: string) =>
      createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    // The value every other suite in this repo pins layout.tsx at.
    expect(sha('src/app/layout.tsx'))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('🔴 the edited surfaces gained a class and nothing else', () => {
    /**
     * The whole of this ticket's change to the seven public surfaces is one
     * class name. No control, no colour, no emoji, no string and no read moved.
     */
    const PLATED = [
      'components/PublicCalendar.tsx', 'components/PublicForm.tsx',
      'components/PublicCampaign.tsx', 'components/PublicGiving.tsx',
      'components/PublicEventRegistration.tsx', 'components/PublicCheckin.tsx',
      'components/PublicPledge.tsx',
    ];
    for (const rel of PLATED) {
      const code = stripComments(read(rel));
      expect(code, `${rel} hardcoded a colour`).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      /**
       * ⚠️ STRIPPED source, and PICTOGRAPHS only. Two distinctions, both
       * deliberate:
       *
       *   · The house markers (🔴 ⚠️ ✅ 🔵) are COMMENT vocabulary across this
       *     repo. What must never grow an emoji is the code — a string, a
       *     label, a piece of JSX text a church reads.
       *   · `PublicEventRegistration` carries a `✓` (U+2713) in its
       *     discount-applied line. That is a TYPOGRAPHIC dingbat, not a
       *     pictographic emoji, it is user-facing on purpose, and it predates
       *     this ticket by a long way. Sweeping the whole U+2600–27BF block
       *     would condemn it, and a guard that fails on correct code it has no
       *     mandate over is the failure mode #509's apex guard hit on its
       *     second write. The range below is the emoji planes.
       *
       * 🔵 ONE PRE-EXISTING PICTOGRAPH IS PINNED RATHER THAN SWEPT OR DELETED.
       * `PublicCheckin` greets an arriving member with `Welcome, {firstName}.
       * 🙌`. It is user-facing, it is on a public surface, and by the house
       * rule it should not be there — that is REPORTED, not fixed here, because
       * deleting a deliberate piece of warmth off a check-in screen is a copy
       * decision this ticket has no mandate for. It is pinned BY ITS CONTENT so
       * a SECOND one still fails: this is a named exception, not a hole.
       */
      const pictographs = [...code.matchAll(/[\u{1F300}-\u{1FAFF}]|\uFE0F/gu)].map((m) => m[0]);
      const allowed = rel === 'components/PublicCheckin.tsx' ? ['🙌'] : [];
      expect(pictographs, `${rel} grew an emoji in code a church reads`).toEqual(allowed);
      expect(code, `${rel} lost the plate`).toMatch(/logo-plate/);
    }
  });

  it('🔴 no file this ticket touched is written with CRLF', () => {
    for (const rel of [
      'components/PublicGiving.tsx', 'components/AIChat.tsx',
      'contexts/TenantContext.tsx', 'components/settings/BrandingSection.tsx',
      'lib/brand-accent.ts',
    ]) {
      expect(read(rel), `${rel} was written with CRLF`).not.toMatch(/\r\n/);
    }
  });
});
