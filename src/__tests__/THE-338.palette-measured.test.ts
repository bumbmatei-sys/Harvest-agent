// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has no layout engine and does not resolve
// custom properties through the real cascade, so nothing asserted against it
// could tell the promoted palette from the one it replaced. Everything here is
// measured inside a real Chromium over CDP.
//
// ⚠️ THE PRAGMA ABOVE IS LOAD-BEARING, and this was found the hard way: without
// it the suite HANGS in `MeasuringBrowser.open()` until the hook times out.
// `browser-measure.ts` says why in its own header — a DOM-emulating environment
// enforces browser semantics on the request to the browser's own debugger port
// and refuses it as cross-origin, so the browser can never be attached to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MeasuringBrowser } from '../test/support/browser-measure';
import { buildAppCss } from '../test/support/tailwind-build';
import { contrastRatio, AA_CONTRAST } from '../lib/theme';

/**
 * THE-338 — the promoted palette, MEASURED.
 *
 * `theming-neutral-palette.test.ts` resolves every value through postcss and
 * computes every ratio. That is fast, total, and it answers "what does the
 * stylesheet say". It cannot answer "what does a browser actually paint",
 * because it re-implements the cascade rather than running it.
 *
 * This file runs it. The real compiled stylesheet — the one `next build`
 * produces from globals.css and tailwind.config.ts — is injected into a real
 * page, the mode is stamped the way the pre-paint script stamps it, and every
 * value is read back off `getComputedStyle`. If the two files ever disagree,
 * one of them is wrong about the app, and that is worth knowing.
 */

const RAMP = [
  '--surface', '--surface-raised', '--surface-sunken', '--surface-chip', '--surface-tint',
  '--border-hairline', '--border-subtle', '--border-default', '--border-strong',
  '--text-strong', '--text-heading', '--text-body', '--text-muted', '--text-faint',
  '--input', '--card', '--muted', '--accent', '--popover', '--sidebar', '--sidebar-border',
  '--primary', '--primary-foreground',
] as const;

/** Every text/ground pair the app actually puts together on a surface. */
const PAIRS: ReadonlyArray<readonly [fg: string, bg: string]> = [
  ['--text-strong', '--surface'], ['--text-strong', '--surface-raised'], ['--text-strong', '--surface-sunken'],
  ['--text-heading', '--surface'], ['--text-heading', '--surface-raised'],
  ['--text-body', '--surface'], ['--text-body', '--surface-raised'], ['--text-body', '--surface-sunken'],
  ['--text-muted', '--surface'], ['--text-muted', '--surface-raised'], ['--text-muted', '--surface-sunken'],
  ['--text-faint', '--surface'], ['--text-faint', '--surface-raised'], ['--text-faint', '--surface-sunken'],
  ['--card-foreground', '--card'], ['--popover-foreground', '--popover'],
  ['--sidebar-foreground', '--sidebar'], ['--accent-foreground', '--accent'],
  ['--primary-foreground', '--primary'],
];

const TOKENS = [...new Set([...RAMP, ...PAIRS.flat()])];

let browser: MeasuringBrowser;
/** token -> hex, per mode, as Chromium resolves it. */
const measured: Record<'light' | 'dark', Record<string, string>> = { light: {}, dark: {} };

beforeAll(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the338-measured-'));
  const file = path.join(dir, 'palette.html');
  writeFileSync(file, `<!doctype html><html><head><style>${css}</style></head><body></body></html>`);

  browser = new MeasuringBrowser();
  await browser.open('file://' + file);

  for (const mode of ['light', 'dark'] as const) {
    measured[mode] = await browser.evaluateAt<Record<string, string>>(1280, `(() => {
      // Stamped exactly as the pre-paint script stamps it: the attribute AND
      // the class, and nothing else — there is no family attribute any more.
      const h = document.documentElement;
      h.setAttribute('data-theme', ${JSON.stringify(mode)});
      h.classList.toggle('dark', ${JSON.stringify(mode)} === 'dark');
      const cs = getComputedStyle(h);
      const out = {};
      for (const t of ${JSON.stringify(TOKENS)}) out[t] = cs.getPropertyValue(t).trim();
      return out;
    })()`);
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const hex = (mode: 'light' | 'dark', token: string): string => {
  const v = measured[mode][token];
  expect(v, `${token} did not resolve in ${mode} — the browser painted nothing`).toBeTruthy();
  expect(v, `${token} is not a plain hex in ${mode} (got ${v})`).toMatch(/^#[0-9a-fA-F]{6}$/i);
  return v.toUpperCase();
};
const ratio = (mode: 'light' | 'dark', fg: string, bg: string) =>
  Math.round(contrastRatio(hex(mode, fg), hex(mode, bg)) * 100) / 100;

describe('the promoted palette, measured in Chromium', () => {
  it('the harness measured something — otherwise every assertion below is vacuous', () => {
    expect(Object.keys(measured.light).length).toBe(TOKENS.length);
    expect(Object.keys(measured.dark).length).toBe(TOKENS.length);
  });

  it('🔴 every token resolves to a real colour in BOTH modes', () => {
    // The promotion trap, measured rather than reasoned: a token the removed
    // family left undeclared would resolve to nothing here, and `var()` on an
    // undeclared property drops the declaration silently.
    const dead: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      for (const t of TOKENS) if (!/^#[0-9a-fA-F]{6}$/i.test(measured[mode][t] ?? '')) dead.push(`${mode} ${t}`);
    }
    expect(dead, 'a token painted nothing in the browser').toEqual([]);
  });

  it('🔴 the browser agrees with the stylesheet — the ramp is what globals.css says', () => {
    // If postcss and Chromium ever disagree, theming-neutral-palette.test.ts
    // is asserting a cascade the app does not have.
    expect({
      light: {
        surface: hex('light', '--surface'),
        raised: hex('light', '--surface-raised'),
        sunken: hex('light', '--surface-sunken'),
      },
      dark: {
        surface: hex('dark', '--surface'),
        raised: hex('dark', '--surface-raised'),
        sunken: hex('dark', '--surface-sunken'),
      },
    }).toEqual({
      light: { surface: '#F7F7F7', raised: '#FFFFFF', sunken: '#EFEFEF' },
      dark: { surface: '#141414', raised: '#1F1F1F', sunken: '#0C0C0C' },
    });
  });

  it.each(PAIRS)('%s on %s clears AA in both modes', (fg, bg) => {
    for (const mode of ['light', 'dark'] as const) {
      expect(ratio(mode, fg, bg), `${fg} on ${bg} in ${mode}`).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('🔴 the 5.66 / 5.69 floor is the GOLD pair, and the ramp cannot move it', () => {
    /**
     * ⚠️ 5.66 AND 5.69 ARE THE SAME PAIR, ROUNDED, AND IT IS NOT A FLOOR OVER
     * EVERY TEXT PAIR — getting this wrong is easy and this test exists partly
     * to record it.
     *
     * Both figures are --primary-foreground (--earth #2D2519) on --primary
     * (the gold #C9963A), which measures 5.6876:1. Neither token is part of
     * the surface ramp and neither is overridden in either mode, so darkening
     * the grey cannot move that pair — asserted here, since "the accent is
     * unchanged" is one of this ticket's claims.
     *
     * 🔴 THE WORST TEXT PAIR IN THE APP IS LOWER THAN THAT, and always was:
     * --text-faint on --surface-sunken measures 4.77:1 in light. It clears AA
     * (4.5), it is UNCHANGED by this ticket — the promoted light ramp is the
     * one that already shipped, since THE-265 made that family the default —
     * and it is better than the removed Harvest family's 4.57:1 for the same
     * pair. So the honest claim is "every pair clears AA, and the recorded
     * 5.66/5.69 figures are the gold pair", not "every pair clears 5.66".
     */
    expect(ratio('light', '--primary-foreground', '--primary')).toBe(5.69);
    expect(ratio('dark', '--primary-foreground', '--primary')).toBe(5.69);

    const worst = Math.min(
      ...PAIRS.map(([fg, bg]) => Math.min(ratio('light', fg, bg), ratio('dark', fg, bg))),
    );
    expect(worst, 'a text pair dropped below AA').toBeGreaterThanOrEqual(AA_CONTRAST);
    // Pinned, so the worst pair moving in EITHER direction has to be looked at.
    expect(worst).toBe(4.77);
    expect(ratio('light', '--text-faint', '--surface-sunken'), 'the worst pair is not the one recorded')
      .toBe(worst);
    // …and it is better than the removed family's 4.57:1 for the same pair.
    expect(worst).toBeGreaterThan(4.57);
  });

  it('🔴 no dark text pair regressed against the grey that shipped before', () => {
    // The ratios the previous neutral grey (#1C1C1C / #242424 / #131313)
    // produced. Darkening a ground can only improve text contrast, so this is
    // the direction check that would catch a mistake in the ramp.
    const BEFORE: Record<string, number> = {
      '--text-strong/--surface': 15.22, '--text-strong/--surface-raised': 13.87,
      '--text-body/--surface': 10.61, '--text-body/--surface-raised': 9.67,
      '--text-muted/--surface': 7.42, '--text-muted/--surface-raised': 6.76,
      '--text-faint/--surface': 5.76, '--text-faint/--surface-raised': 5.25,
    };
    const regressions: string[] = [];
    for (const [key, before] of Object.entries(BEFORE)) {
      const [fg, bg] = key.split('/');
      const now = ratio('dark', fg, bg);
      if (now < before) regressions.push(`${key}: ${now} < ${before}`);
    }
    expect(regressions).toEqual([]);
  });

  it('🔴 the card still lifts off the page, and the sidebar still reads as a panel', () => {
    // Both are the risk in darkening two surfaces at once: flatten them
    // together and the card and the rail disappear into the page.
    expect(ratio('dark', '--surface-raised', '--surface'), 'the card flattened into the page')
      .toBeGreaterThanOrEqual(1.1);
    expect(ratio('dark', '--sidebar', '--surface'), 'the sidebar flattened into the page')
      .toBeGreaterThanOrEqual(1.1);
    expect(ratio('light', '--sidebar', '--surface')).toBeGreaterThan(1.0);
  });

  it('🔴 a form field edge stays visible, and clearly brighter than a row divider', () => {
    // --input aliases --border-strong; the drawer's dividers resolve to
    // --border-default. Darkening the decorative one must not take the
    // control's boundary with it.
    for (const mode of ['light', 'dark'] as const) {
      const edge = ratio(mode, '--input', '--surface-raised');
      const divider = ratio(mode, '--border-default', '--surface-raised');
      expect(edge, `the field edge vanished in ${mode}`).toBeGreaterThan(1.0);
      expect(edge / divider, `the field edge collapsed into the divider in ${mode}`)
        .toBeGreaterThanOrEqual(1.2);
    }
  });

  it('🔴 the accent is byte-identical in both modes — this ticket did not touch the brand', () => {
    expect(hex('light', '--primary')).toBe('#C9963A');
    expect(hex('dark', '--primary')).toBe('#C9963A');
    expect(hex('light', '--primary-foreground')).toBe('#2D2519');
    expect(hex('dark', '--primary-foreground')).toBe('#2D2519');
  });
});
