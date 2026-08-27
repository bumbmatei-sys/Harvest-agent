import React, { act } from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE-183 — admin Settings: the two theme controls, and the layout rules.
 *
 * Two complaints, one screen:
 *
 *  1. The palette family (Harvest / Classic) was reachable only from the member
 *     Profile. PR 342 added it there and PR 347 put it beside the light/dark
 *     control; admin Settings kept rendering a lone `<ThemeToggle />`, so an
 *     admin who never opens the member app could not select Classic at all.
 *  2. The screen had no structure and no width discipline. Measured in
 *     Chromium in the real admin shell at 1440px: a 1164.5px content box
 *     (1440 − a 232px `lg:w-64` sidebar − 21.75px of `lg:p-6` either side)
 *     holding a 609px column — `max-w-2xl` at the 14.5px desktop rem base, not
 *     the 672px the class name suggests — leaving 277.75px of dead space on
 *     each side, with a destructive action (Cancel Subscription) sitting in the
 *     same flat run as a colour preference.
 *
 * 🔴 THE LOAD-BEARING TEST IS THE FIRST ONE. Below 640px nothing may move. It
 * is verified out-of-band by a Chromium screenshot diff at 380/480/639px, which
 * is byte-identical before and after (0123d6ba7c6c7798 / 94b6e4e48f0494fe /
 * a7c1ed16538d3823 on both sides). 768px is NOT identical and is not claimed to
 * be: FORM_MEASURE is `sm:`-gated, so from 640px up the column stops being
 * capped at `max-w-2xl` — see "the settings content is constrained at desktop
 * widths" for the numbers.
 *
 * Geometry is asserted the way Profile.composition.test.tsx does it: by
 * generating the REAL Tailwind CSS from tailwind.config.ts and resolving what
 * each class actually emits at a given viewport, rather than reading class
 * names and believing them. Rem lengths resolve against the ACTUAL root
 * font-size, which globals.css drops to 14.5px at lg.
 *
 * Targets are named by their label — `aria-label`, heading text, section label
 * — and never by a value pattern, so a restyle that keeps the control does not
 * fail and a removal that keeps the styling does.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
/**
 * The Payments row's label. Renamed by THE-246 when Stripe Connect moved out of
 * Settings and this row became a pointer at the Donations section — see the
 * `rowOf('payments')` assertion below. The row keeps its id, its group and its
 * position, so every layout claim in this file still means what it meant.
 */
const GIVING_ROW = 'Donations & payment links';

const SETTINGS_SRC = path.join(SRC, 'components/AdminSettings.tsx');
const ACCORDION_SRC = path.join(SRC, 'components/settings/SettingsAccordion.tsx');
const HEADING_SRC = path.join(SRC, 'components/settings/SectionHeading.tsx');

/** The admin shell's desktop sidebar — `lg:w-64` in AdminDashboard.tsx, which
 *  is 232px at the 14.5px desktop rem base, plus `lg:p-6` (21.75px) either
 *  side of the content area. Settings is laid out in what is left of the
 *  viewport, not the viewport. */
const SIDEBAR = 232;
const SHELL_PAD = 21.75;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org' } },
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  updateDoc: vi.fn(),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({ forEach: () => {} }),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => false,
  isSuperAdmin: () => false,
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('next/image', () => ({ default: () => null }));

// ThemeToggle and PaletteFamilyToggle are deliberately NOT mocked — they are
// the subject of tests 1-3, and the point of this PR is that they are the same
// two components the member Profile renders.
import AdminSettings from '../AdminSettings';
import { FORM_MEASURE, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';

// ── rendering ──────────────────────────────────────────────────────────────

async function mount(props: Partial<React.ComponentProps<typeof AdminSettings>> = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminSettings
        onBack={() => {}}
        currentPlan={'pro' as never}
        onChangePlan={() => {}}
        onCancelPlan={() => {}}
        tenantId="tenant-1"
        email="admin@church.org"
        isPlanOwner
        onCustomizeNav={() => {}}
        onOpenDonations={() => {}}
        {...props}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

/** Open one accordion row by its visible label — the content is only in the DOM
 *  while its section is expanded. */
async function expandSection(host: HTMLElement, label: string): Promise<void> {
  const header = Array.from(host.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().startsWith(label),
  );
  expect(header, `no accordion row labelled "${label}"`).toBeTruthy();
  await act(async () => { header!.click(); });
}

const classesOf = (el: Element): string[] =>
  (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

/** The page root — the element FORM_MEASURE is applied to. Found structurally
 *  (the single child of the mount host), not by the classes under test. */
const pageRoot = (host: HTMLElement): HTMLElement => host.firstElementChild as HTMLElement;

/** Every region on the screen, in document order, with its heading. Regions are
 *  found by the marker attribute, never by class. */
function regions(host: HTMLElement) {
  const headings = Array.from(host.querySelectorAll('[data-settings-heading]')) as HTMLElement[];
  return headings.map((h) => ({
    label: (h.textContent || '').trim(),
    tone: h.getAttribute('data-settings-heading'),
    heading: h,
    // The region is the heading's parent: [heading, content] by construction.
    wrapper: h.parentElement as HTMLElement,
  }));
}

// ── the real Tailwind CSS ──────────────────────────────────────────────────

interface Emitted { cls: string; minWidth: number; decls: Record<string, string>; child: boolean }
let emitted: Emitted[] = [];
let rootPx: Array<{ minWidth: number; size: number }> = [];

beforeAll(async () => {
  const css = readFileSync(GLOBALS, 'utf8');
  rootPx = [{ minWidth: 0, size: 16 }];
  postcss.parse(css).walkAtRules('media', (at) => {
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

  const host = await mount();
  await expandSection(host, 'Appearance');
  // Every class on the screen, so `effective()` can resolve any element the
  // tests reach for — including the ones inside the two theme controls.
  const raw = Array.from(host.querySelectorAll('*'))
    .flatMap((el) => classesOf(el))
    .concat(['max-w-2xl']) // the class this PR removes, for the inertness proof
    .join(' ');
  document.body.innerHTML = '';

  const tailwind = (await import('tailwindcss')).default;
  const base = (await import('../../../tailwind.config')).default;
  const out = await postcss([
    tailwind({ ...base, content: [{ raw, extension: 'html' }] } as never),
  ]).process('@tailwind utilities;', { from: undefined });

  const unescape = (sel: string) =>
    sel
      .replace(/^\./, '')
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\/g, '');
  // `space-y-*` does not style the element it is written on — it emits
  // `.space-y-6 > :not([hidden]) ~ :not([hidden])`, a rule about the gaps
  // BETWEEN that element's children. Those are collected as `child: true` and
  // read back through `childGap()`, because matching them against the parent's
  // own class list would silently find nothing and report "no gap" as a pass.
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
  expect(emitted.length, 'Tailwind produced no rules for the settings classes').toBeGreaterThan(0);
}, 180_000);

beforeEach(() => {
  document.body.innerHTML = '';
  try { localStorage.clear(); } catch { /* happy-dom always has it */ }
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
});

/** Declarations in force for `classes` at `viewport`, later rules winning. */
function effective(classes: string[], viewport: number): Record<string, string> {
  const wanted = new Set(classes);
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (rule.child || !wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}

/** The gap `classes` put BETWEEN their element's children at `viewport` — what
 *  a `space-y-*` utility actually emits. Null when no such rule is in force. */
function childGap(classes: string[], viewport: number): number | null {
  const wanted = new Set(classes);
  let value: string | undefined;
  for (const rule of emitted) {
    if (!rule.child || !wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    value = rule.decls['margin-top'] ?? value;
  }
  // Tailwind emits the gap as `calc(1.5rem * calc(1 - var(--tw-space-y-reverse)))`
  // — the reverse flag is 0 here, so the leading length IS the gap.
  const length = value?.match(/(-?[\d.]+(?:rem|px))/);
  return length ? px(length[1], viewport) : null;
}

const rootSizeAt = (viewport: number): number =>
  rootPx.filter((r) => r.minWidth <= viewport).slice(-1)[0].size;

/** A CSS length in px at a viewport, or null when it is not a fixed length. */
function px(value: string | undefined, viewport: number): number | null {
  if (!value) return null;
  const rem = value.match(/^(-?[\d.]+)rem$/);
  if (rem) return Number(rem[1]) * rootSizeAt(viewport);
  const p = value.match(/^(-?[\d.]+)px$/);
  if (p) return Number(p[1]);
  return null;
}

/** What the admin shell leaves for the settings content at a viewport. */
const contentBoxAt = (viewport: number): number => viewport - SIDEBAR - SHELL_PAD * 2;

// ═══════════════════════════════════════════════════════════════════════════

describe('THE-183 — admin Settings', () => {
  // 0 ── 🔴 the load-bearing one
  it('leaves the sub-640px rendering unchanged', async () => {
    const host = await mount();
    const root = pageRoot(host);

    // (a) Everything this PR adds is gated at `sm:` or above, or is `hidden`
    //     (the region headings, which are desktop-only by construction). The
    //     `hidden` base class is the ONE unprefixed class allowed here, and it
    //     is what makes a heading render no box on a phone.
    for (const el of [root, ...regions(host).map((r) => r.wrapper), ...regions(host).map((r) => r.heading)]) {
      for (const cls of classesOf(el)) {
        if (!cls.includes(':')) {
          expect(
            ['hidden', 'space-y-6', 'space-y-2.5', 'px-4', 'text-[11px]', 'font-semibold',
             'uppercase', 'tracking-[0.16em]', 'text-faint', 'text-danger'],
            `${cls} is a new unprefixed class — that is how a desktop change reaches a phone`,
          ).toContain(cls);
          continue;
        }
        expect(cls, `${cls} is not gated at sm/lg`).toMatch(/^(sm|lg):/);
      }
    }

    // (b) Prove the removed cap could never have bound a phone anyway: it is
    //     `max-w-2xl`, 42rem at the 16px sub-1024 rem base = 672px, wider than
    //     the widest sub-640 viewport. Dropping it therefore changes nothing
    //     below 640px — which is what the byte-identical screenshot diff at
    //     380/480/639px independently confirms.
    const oldCap = px(effective(['max-w-2xl'], 639)['max-width'], 639);
    expect(oldCap, 'max-w-2xl no longer resolves').not.toBeNull();
    expect(oldCap!, 'the removed cap could bind below 640px').toBeGreaterThan(639);

    // (c) And from the generated CSS: at 639px the root carries no width or
    //     centring rule at all, only the gutter and the rhythm it always had.
    const d = effective(classesOf(root), 639);
    for (const prop of ['max-width', 'margin-left', 'margin-right', 'width']) {
      expect(d[prop], `${prop} leaked below 640px`).toBeUndefined();
    }
    expect(d['padding-left']).toBe('1rem');
    expect(d['padding-right']).toBe('1rem');
    // The mobile section rhythm is the 24px `space-y-6` it always was; Rule 4's
    // 28px does not reach a phone.
    expect(childGap(classesOf(root), 639), 'the mobile section gap moved').toBe(24);

    // (d) The region headings paint nothing below 640px.
    for (const { heading, label } of regions(host)) {
      expect(effective(classesOf(heading), 639).display, `the "${label}" heading is visible on a phone`)
        .toBe('none');
      expect(effective(classesOf(heading), 640).display, `the "${label}" heading never appears`)
        .toBe('block');
    }
  });

  // 1
  it('admin Settings renders both the mode control and the family control', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');

    const mode = host.querySelector('[role="radiogroup"][aria-label="Colour theme"]');
    const family = host.querySelector('[role="radiogroup"][aria-label="Palette family"]');
    expect(mode, 'the light/dark/system control is gone from admin Settings').toBeTruthy();
    expect(family, 'the Harvest/Classic family control is missing from admin Settings').toBeTruthy();

    // Both options of the family control are reachable — the founder's actual
    // complaint was that Classic could not be chosen here at all.
    for (const label of ['Harvest', 'Classic']) {
      expect(family!.querySelector(`[aria-label="${label}"]`), `${label} is not offered`).toBeTruthy();
    }
    for (const label of ['Light', 'Dark', 'System']) {
      expect(mode!.querySelector(`[aria-label="${label}"]`), `${label} is not offered`).toBeTruthy();
    }

    // The same two components the member Profile renders, not a second copy:
    // AdminSettings imports them, and defines no radiogroup of its own.
    const src = readFileSync(SETTINGS_SRC, 'utf8');
    expect(src).toMatch(/import\s+PaletteFamilyToggle\s+from\s+'\.\/PaletteFamilyToggle'/);
    expect(src).toMatch(/import\s+ThemeToggle\s+from\s+'\.\/ThemeToggle'/);
    expect(src, 'admin Settings is building its own theme control instead of reusing one')
      .not.toMatch(/role=["']radiogroup["']/);
  });

  // 2
  it('the family control renders to the left of the mode control on one row', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');
    const mode = host.querySelector('[role="radiogroup"][aria-label="Colour theme"]')!;
    const family = host.querySelector('[role="radiogroup"][aria-label="Palette family"]')!;

    // One row: same parent, and that parent is a flex row at every viewport —
    // not a column, and not allowed to wrap into two lines.
    expect(mode.parentElement, 'the two controls are not in the same row').toBe(family.parentElement);
    const row = family.parentElement as HTMLElement;
    for (const viewport of [380, 640, 1024, 1280, 1440]) {
      const d = effective(classesOf(row), viewport);
      expect(d.display, `the theme row is not a flex row at ${viewport}px`).toBe('flex');
      expect(d['flex-direction'], `the theme row stacks at ${viewport}px`).toBeUndefined();
      expect(d['flex-wrap'], `the theme row may wrap at ${viewport}px`).toBeUndefined();
    }

    // Family FIRST in the DOM, so tab order matches the left-to-right reading
    // order rather than being reversed with CSS.
    expect(
      family.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the mode control does not follow the family control in the DOM',
    ).toBeTruthy();
    const kids = Array.from(row.children);
    expect(kids.indexOf(family)).toBeLessThan(kids.indexOf(mode));
    // Nothing reverses them visually either.
    for (const cls of classesOf(row)) {
      expect(cls, `${cls} would reverse the visual order away from the DOM order`)
        .not.toMatch(/flex-row-reverse|flex-col/);
    }

    // Exactly the wrapper the member Profile uses, so "match it exactly" is a
    // fact about the markup and not a claim in a comment.
    const profile = readFileSync(path.join(SRC, 'components/Profile.tsx'), 'utf8');
    const pair = /<PaletteFamilyToggle\s*\/>\s*<ThemeToggle variant="row" \/>/;
    expect(profile, 'the member Profile no longer renders the pair in this order').toMatch(pair);
    expect(readFileSync(SETTINGS_SRC, 'utf8'), 'admin Settings renders a different pairing').toMatch(pair);
  });

  // 3
  it('both write their own preference and stamp html through the existing single path', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');
    const mode = host.querySelector('[role="radiogroup"][aria-label="Colour theme"]')!;
    const family = host.querySelector('[role="radiogroup"][aria-label="Palette family"]')!;

    const pick = (group: Element, label: string) => {
      const btn = group.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      expect(btn, `${label} is missing`).toBeTruthy();
      act(() => { btn!.click(); });
    };

    // Mode: its own key, and <html> stamped.
    pick(mode, 'Dark');
    expect(localStorage.getItem('harvest-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(mode.querySelector('[aria-label="Dark"]')!.getAttribute('aria-checked')).toBe('true');

    // Family: its own, separate key — and it does NOT reset the mode above.
    pick(family, 'Classic');
    expect(localStorage.getItem('harvest-theme-family')).toBe('classic');
    expect(localStorage.getItem('harvest-theme'), 'the family control overwrote the mode preference').toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBe('classic');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(family.querySelector('[aria-label="Classic"]')!.getAttribute('aria-checked')).toBe('true');

    // Both are switches, not one-way doors, and changing the mode leaves the
    // family alone — the two axes stay orthogonal from this screen too.
    pick(mode, 'Light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-palette'), 'picking a mode reset the palette').toBe('classic');
    pick(family, 'Harvest');
    expect(document.documentElement.getAttribute('data-palette')).toBe('harvest');
  });

  // 4 ── 🔴 by enumeration
  it('no second stamping path exists', () => {
    // Not "AdminSettings does not stamp" — that would pass while some other
    // file quietly gained a second path. Walk the whole of src/ and let the
    // allow-list be the entire claim.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(p, out);
        } else if (/\.tsx?$/.test(entry)) out.push(p);
      }
      return out;
    };
    const STAMP =
      /\.setAttribute\(\s*['"]data-theme['"]|\.setAttribute\(\s*['"]data-palette['"]|classList\.(?:toggle|add|remove)\(\s*['"]dark['"]/;
    // theme-runtime.ts is applyTheme, the path THE-85 consolidated to.
    // layout.tsx is the pre-paint script — a raw string that cannot import it.
    const ALLOWED = new Set([
      path.join(SRC, 'lib/theme-runtime.ts'),
      path.join(SRC, 'app/layout.tsx'),
    ]);

    const stampers = walk(SRC).filter((f) => STAMP.test(readFileSync(f, 'utf8')));
    expect(
      stampers.map((f) => path.relative(ROOT, f)).sort(),
      'a second path stamps <html> — adding the family control to a second screen must add UI, not another writer',
    ).toEqual([...ALLOWED].map((f) => path.relative(ROOT, f)).sort());

    // And the two files that ARE allowed to stamp are untouched by this PR.
    // A clean diff against the base is a stronger claim than a content check,
    // because it also catches a change that preserves every string checked for.
    const base = baseRef();
    if (base) {
      for (const rel of ['src/lib/theme-runtime.ts', 'src/app/layout.tsx']) {
        const diff = execSync(`git diff --stat ${base} -- ${rel}`, { cwd: ROOT }).toString().trim();
        expect(diff, `${rel} changed — applyTheme and the pre-paint script are off limits`).toBe('');
      }
    }
  });

  // 5 ── 🔴 no-regression on the screen this PR copies
  it('the member Profile still renders them side by side at a wide viewport', async () => {
    // If this fails, PR 347 regressed and THE-183 is not the bug to fix.
    const profile = readFileSync(path.join(SRC, 'components/Profile.tsx'), 'utf8');

    // The pair, in order, inside a single-line flex row.
    const rowMatch = profile.match(
      /<div className="(flex[^"]*)">\s*<PaletteFamilyToggle \/>\s*<ThemeToggle variant="row" \/>\s*<\/div>/,
    );
    expect(rowMatch, 'the member Profile no longer renders the two controls in one flex row').not.toBeNull();
    const rowClasses = rowMatch![1].split(/\s+/);
    expect(rowClasses, 'the Profile theme row is no longer a flex row').toContain('flex');
    expect(rowClasses, 'the Profile theme row stacks them').not.toContain('flex-col');
    expect(rowClasses, 'the Profile theme row may wrap them onto two lines').not.toContain('flex-wrap');
    expect(rowClasses, 'the Profile theme row reverses the visual order').not.toContain('flex-row-reverse');

    // Side by side at a WIDE viewport specifically: the row carries no rule at
    // any of these widths that would take it out of a single flex line. 1280px
    // is the one that matters most — Profile's settings column SPLITS there, so
    // available width is non-monotonic in viewport (THE-184), which is exactly
    // where a side-by-side row would break first.
    const host = await mount(); // any mount; we only need `emitted` resolved
    void host;
    for (const viewport of [1024, 1280, 1360, 1440, 1920]) {
      const d = effective(rowClasses, viewport);
      expect(d.display, `the Profile theme row is not flex at ${viewport}px`).toBe('flex');
      expect(d['flex-direction'], `the Profile theme row stacks at ${viewport}px`).toBeUndefined();
      expect(d['flex-wrap'], `the Profile theme row may wrap at ${viewport}px`).toBeUndefined();
    }

    // Both controls still hide their labels from `xl` up, which is what keeps
    // the pair inside the narrowed column at 1280px rather than overflowing it.
    for (const rel of ['components/ThemeToggle.tsx', 'components/PaletteFamilyToggle.tsx']) {
      expect(
        readFileSync(path.join(SRC, rel), 'utf8'),
        `${rel} lost the icon-only fallback the 1280px band depends on`,
      ).toMatch(/hidden sm:inline xl:hidden/);
    }
  });

  // 6
  it('the settings content is constrained at desktop widths', async () => {
    const root = pageRoot(await mount());

    // The measure comes from the module, not from a literal in this screen.
    expect(readFileSync(SETTINGS_SRC, 'utf8'), 'the width is hardcoded instead of imported')
      .toMatch(/FORM_MEASURE/);
    for (const cls of FORM_MEASURE.split(/\s+/)) {
      expect(classesOf(root), `${cls} is not on the page root`).toContain(cls);
    }
    // Rule 1b, not Rule 1a: this is a form's measure, not the page measure.
    expect(FORM_MEASURE).not.toBe('sm:max-w-[1120px] sm:mx-auto');

    for (const viewport of [640, 1024, 1280, 1440, 1920]) {
      const d = effective(classesOf(root), viewport);
      const cap = px(d['max-width'], viewport);
      expect(cap, `no max-width in force at ${viewport}px`).not.toBeNull();
      // In px, so the number in the class is the number on screen — the same at
      // the 16px and the 14.5px rem base.
      expect(cap, `the measure moved with the rem base at ${viewport}px`).toBe(940);
      expect(d['margin-left'], `the column is not centred at ${viewport}px`).toBe('auto');
      expect(d['margin-right'], `the column is not centred at ${viewport}px`).toBe('auto');
    }

    // And it actually closes the gap the founder saw. At 1440px the shell
    // leaves a 1164.5px content box; the old cap resolved to 609px there,
    // stranding 277.75px on each side.
    const box1440 = contentBoxAt(1440);
    expect(box1440).toBeCloseTo(1164.5, 2);
    const oldCap = px(effective(['max-w-2xl'], 1440)['max-width'], 1440);
    expect(oldCap, 'max-w-2xl no longer resolves').toBeCloseTo(609, 2);
    const deadBefore = (box1440 - oldCap!) / 2;
    const deadAfter = (box1440 - 940) / 2;
    expect(deadBefore).toBeCloseTo(277.75, 2);
    expect(deadAfter, 'the dead band did not shrink').toBeLessThan(deadBefore / 2);

    // ⚠️ 1280px specifically (THE-184): the measure must still FIT the content
    // box there, so nothing overflows at the width where Profile's column
    // narrows. Admin Settings does not split, but the number is checked, not
    // assumed.
    expect(contentBoxAt(1280), 'the 940px measure overflows the 1280px content box')
      .toBeGreaterThan(940);

    // Rule 4's section gap between regions, and no control over the band cap.
    const accordion = document.querySelector('[data-settings-region]')!.parentElement!;
    expect(childGap(classesOf(accordion), 1440), 'regions do not use the settled section gap')
      .toBe(DENSITY_PX.sectionGap);
    // …and the page root spaces its own regions by the same rule.
    expect(childGap(classesOf(root), 1440), 'the page root does not use the settled section gap')
      .toBe(DENSITY_PX.sectionGap);
    const manage = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Manage',
    )!;
    const mh = px(effective(classesOf(manage), 1440).height, 1440);
    expect(mh, 'the Manage action does not take Rule 4 height').toBe(DENSITY_PX.action);
    expect(mh!, 'an action exceeds the desktop density band').toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
  });

  // 7
  it('Cancel Subscription is visually separated from the other sections', async () => {
    const host = await mount();
    const all = regions(host);
    const danger = all.find((r) => r.label === 'Danger Zone');
    expect(danger, 'there is no danger region').toBeTruthy();
    expect(danger!.tone, 'the danger region is not toned as one').toBe('danger');

    // It holds Cancel Subscription, and nothing else.
    const rows = Array.from(danger!.wrapper.querySelectorAll('button')).map((b) =>
      (b.textContent || '').trim(),
    );
    expect(rows, 'the danger region does not hold Cancel Subscription').toEqual(['Cancel Subscription']);

    // Separated, not merely last: a rule above it plus a full section gap of
    // padding, on top of the section gap between regions. Both `sm:`-gated —
    // the separation is a desktop fix, like the grouping it belongs to.
    const d = effective(classesOf(danger!.wrapper), 1440);
    expect(d['border-top-width'], 'the danger region has no separating rule').toBeTruthy();
    expect(px(d['border-top-width'], 1440)!, 'the separating rule is invisible').toBeGreaterThan(0);
    expect(d['border-top-color'] ?? d['border-color'], 'the rule hardcodes no colour token')
      .toMatch(/var\(--/);
    expect(px(d['padding-top'], 1440), 'the danger separation is not the settled section gap')
      .toBe(DENSITY_PX.sectionGap);

    // No OTHER region carries that separation — if everything is separated,
    // nothing is.
    for (const r of all.filter((x) => x.label !== 'Danger Zone')) {
      expect(
        effective(classesOf(r.wrapper), 1440)['border-top-width'],
        `the "${r.label}" region is separated the same way as the destructive one`,
      ).toBeUndefined();
    }

    // And it did not move to get there — the destructive action sits exactly
    // where it always did, after every non-destructive accordion row.
    const labels = Array.from(host.querySelectorAll('[data-settings-region] button'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => t);
    expect(labels[labels.length - 1]).toBe('Cancel Subscription');
  });

  // 8
  it('every section has a heading', async () => {
    const host = await mount();
    const found = regions(host).map((r) => r.label);

    // The regions, in document order. The order is the order the screen already
    // had — no row moved to make the grouping work.
    expect(found).toEqual([
      'Account',
      'Appearance',
      'Payments',
      'Church Setup',
      'Connected Services',
      'Danger Zone',
      'Navigation',
    ]);

    // Every accordion region really is a region: no row is left outside one.
    const ungrouped = Array.from(host.querySelectorAll('[data-settings-region="ungrouped"]'));
    expect(ungrouped, 'an accordion row sits outside every named region').toEqual([]);

    // Every heading labels something — an empty region is a heading with
    // nothing under it, which is worse than no heading.
    for (const r of regions(host)) {
      expect(
        r.wrapper.querySelectorAll('button').length,
        `the "${r.label}" heading has nothing under it`,
      ).toBeGreaterThan(0);
    }

    // A region whose rows are all plan-gated away leaves no orphan heading:
    // on no plan, Cancel is hidden and the Danger Zone heading goes with it.
    document.body.innerHTML = '';
    const free = await mount({ currentPlan: undefined });
    expect(regions(free).map((r) => r.label), 'an empty region kept its heading')
      .not.toContain('Danger Zone');
  });

  // 9
  it('mobile touch targets are at least 44px', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');

    // Rendered heights measured in Chromium at 380/480/639px against this same
    // markup and the real compiled CSS. Everything this PR lays out clears 44px;
    // the two exceptions are enumerated by LABEL and are both pre-existing, so
    // this fails if a new short target appears AND if either of these is
    // silently changed — which would itself be a mobile change.
    const MIN = 44;
    const KNOWN_SHORT: Record<string, { px: number; why: string }> = {
      Manage: {
        px: 37.5,
        why: 'pre-existing `px-4 py-2` on the plan card. Raising it changes the plan card on a phone, which this PR is not allowed to do. Rule 4 gives it 40px from `sm:` up; the mobile height is untouched.',
      },
      Harvest: { px: 20, why: 'PR 347 pill sizing, reused verbatim' },
      Classic: { px: 20, why: 'PR 347 pill sizing, reused verbatim' },
      Light: { px: 20, why: 'PR 347 pill sizing, reused verbatim' },
      Dark: { px: 20, why: 'PR 347 pill sizing, reused verbatim' },
      System: { px: 20, why: 'PR 347 pill sizing, reused verbatim' },
    };

    /** Height a target paints on a phone: its own vertical padding plus the
     *  taller of its text line box and the icon inside it. */
    const heightAt = (el: Element, viewport: number): number => {
      const d = effective(classesOf(el), viewport);
      const pad = (px(d['padding-top'], viewport) ?? 0) + (px(d['padding-bottom'], viewport) ?? 0);
      const line = px(d['line-height'], viewport) ?? 0;
      const icon = Math.max(
        0,
        ...Array.from(el.querySelectorAll('svg')).map((s) => Number(s.getAttribute('height') || 0)),
      );
      return pad + Math.max(line, icon);
    };

    const targets = Array.from(host.querySelectorAll('button, a[href]')).map((el) => ({
      label: (el.getAttribute('aria-label') || el.textContent || '').trim(),
      el,
    }));
    expect(targets.length, 'no touch targets found').toBeGreaterThan(0);

    const short: string[] = [];
    for (const { label, el } of targets) {
      const h = heightAt(el, 380);
      if (h < MIN) short.push(label);
      if (!(label in KNOWN_SHORT)) {
        expect(h, `"${label}" is a ${h}px touch target on a phone`).toBeGreaterThanOrEqual(MIN);
      }
    }
    // Exact enumeration, so a NEW short target fails here even if it is added
    // to a control this PR does not own.
    expect(short.sort(), 'the set of sub-44px targets changed').toEqual(Object.keys(KNOWN_SHORT).sort());

    // The accordion rows and the navigation row — the targets this PR lays
    // out — clear 44px comfortably at every mobile width.
    for (const viewport of [380, 480, 639]) {
      for (const label of ['Appearance', GIVING_ROW, 'Cancel Subscription']) {
        const row = targets.find((t) => t.label.startsWith(label))!;
        expect(heightAt(row.el, viewport), `"${label}" is short at ${viewport}px`).toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  // 10
  it('no colour is hardcoded, and all four palettes resolve', async () => {
    const host = await mount();

    // (a) Nothing this PR adds carries a literal colour or an inline style.
    for (const { label, wrapper, heading } of regions(host)) {
      for (const el of [wrapper, heading]) {
        expect(el.getAttribute('style'), `the "${label}" region has an inline style`).toBeNull();
        for (const cls of classesOf(el)) {
          expect(cls, `${cls} on the "${label}" region looks like a literal colour`)
            .not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);
        }
      }
    }
    for (const file of [HEADING_SRC, ACCORDION_SRC]) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${path.basename(file)} hardcodes a colour`)
        .not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
    }

    // (b) The tokens this PR's own elements use are defined for every
    //     family × mode. Four blocks, so four renderings.
    const css = readFileSync(GLOBALS, 'utf8');
    const varsIn = (match: (sel: string) => boolean) => {
      const out: Record<string, string> = {};
      postcss.parse(css).walkRules((rule) => {
        if (!match(rule.selector)) return;
        rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
      });
      return out;
    };
    const rootVars = varsIn((s) => s.trim() === ':root');
    const darkVars = varsIn((s) => /\[data-theme="dark"\]/.test(s) && !/data-palette/.test(s));
    const classicLight = varsIn((s) => /\[data-palette="classic"\]\[data-theme="light"\]/.test(s));
    const classicDark = varsIn((s) => /\[data-palette="classic"\](\.dark|\[data-theme="dark"\])/.test(s));
    const palettes: Record<string, Record<string, string>> = {
      'harvest/light': { ...rootVars },
      'harvest/dark': { ...rootVars, ...darkVars },
      'classic/light': { ...rootVars, ...classicLight },
      'classic/dark': { ...rootVars, ...darkVars, ...classicDark },
    };
    const resolve = (vars: Record<string, string>, token: string): string | null => {
      let value: string | undefined = vars[token];
      for (let hops = 0; hops < 8 && value; hops++) {
        const ref: RegExpMatchArray | null = value.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
        if (!ref) return value;
        value = vars[ref[1]];
      }
      return value ?? null;
    };
    expect(Object.keys(palettes)).toHaveLength(4);
    // --text-faint is the heading ink, --border-default the danger separator,
    // --surface-raised/--surface-sunken the cards the regions hold.
    for (const [name, vars] of Object.entries(palettes)) {
      expect(Object.keys(vars).length, `${name} defines no variables`).toBeGreaterThan(0);
      for (const token of ['--text-faint', '--border-default', '--surface-raised', '--surface-sunken']) {
        const resolved = resolve(vars, token);
        expect(resolved, `${token} unset for ${name}`).toBeTruthy();
        expect(resolved, `${token} does not resolve to a colour for ${name}`).toMatch(/^(#|rgb|hsl|color-mix)/);
      }
    }
    // The families must actually differ, or "four palettes" is one palette
    // wearing four names.
    expect(resolve(palettes['harvest/dark'], '--surface-raised'))
      .not.toBe(resolve(palettes['classic/dark'], '--surface-raised'));
    expect(resolve(palettes['harvest/light'], '--text-faint'))
      .not.toBe(resolve(palettes['classic/light'], '--text-faint'));
  });

  // 11
  it('no Stripe, Twilio, onboarding or navigation path changed', async () => {
    // (a) The section components that own those paths are untouched.
    const OWNED = [
      'src/components/settings/PaymentSection.tsx',
      // SmsSection is NOT diffed as a whole any more, for exactly the reason
      // IntegrationsSection stopped being: THE-245 gates it behind the SMS
      // master switch, which is a deliberate edit to this file. What THE-183
      // actually guards — that no Twilio PATH moved — is asserted on the file's
      // contents just below instead, which is the stronger check anyway.
      'src/components/settings/OnboardingSection.tsx',
      // IntegrationsSection is NOT diffed as a whole any more. THE-193 gates its
      // three provider cards individually (Gmail is a CRM provider, not a
      // newsletter one), which is a deliberate edit to this file. What THE-183
      // actually guards — that no integration PATH moved — is asserted on the
      // file's contents just below instead, which is the stronger check anyway.
      'src/components/settings/GivingStatementsSection.tsx',
      'src/components/settings/AiAssistantSection.tsx',
      'src/components/settings/useStripeReturn.ts',
      'src/components/settings/useTenantId.ts',
    ];
    const base = baseRef();
    if (base) {
      const diff = execSync(`git diff --stat ${base} -- ${OWNED.join(' ')}`, { cwd: ROOT }).toString().trim();
      expect(diff, 'a settings section that owns an integration path was modified').toBe('');
    }

    // (a2) Every integration endpoint IntegrationsSection owns is still called
    //      from it, unchanged, for all three providers.
    const integrations = readFileSync(path.join(SRC, 'components/settings/IntegrationsSection.tsx'), 'utf8');
    for (const endpoint of [
      '/api/composio/instagram/status', '/api/composio/instagram/connect', '/api/composio/instagram/disconnect',
      '/api/composio/mailchimp/status', '/api/composio/mailchimp/connect', '/api/composio/mailchimp/disconnect',
      '/api/composio/gmail/status', '/api/composio/gmail/connect', '/api/composio/gmail/disconnect',
      '/api/composio/gmail/address',
    ]) {
      expect(integrations, `${endpoint} is no longer called from IntegrationsSection`).toContain(endpoint);
    }
    // And the two tenant-wide "Primary" writes are still the Mailchimp and
    // Instagram ones only — Gmail has never had a primary.
    expect(integrations).toContain('primaryInstagramAdmin');
    expect(integrations).toContain('primaryMailchimpAdmin');
    expect(integrations, 'Gmail grew a tenant-wide primary').not.toMatch(/primaryGmail/i);

    // (a3) THE-245 — the Twilio path SmsSection owns, asserted on contents for
    //      the same reason as (a2) above. The section is gated, not rewired: it
    //      still reads and writes the one endpoint it always did, and it still
    //      states whose Twilio account is billed.
    const smsSection = readFileSync(path.join(SRC, 'components/settings/SmsSection.tsx'), 'utf8');
    for (const endpoint of ['/api/sms/config', '/api/sms/test']) {
      expect(smsSection, `${endpoint} is no longer called from SmsSection`).toContain(endpoint);
    }
    expect(smsSection, 'the BYO billing note left SmsSection').toContain('BYO_CREDENTIALS_NOTE');
    // The gate itself, so this guard fails if the switch is quietly removed.
    expect(smsSection, 'SmsSection no longer reads the SMS master switch')
      .toContain('SMS_FEATURE_ENABLED');

    // (b) AdminSettings' own wiring is intact, whether or not git is available:
    //     the billing portal call, the Stripe return handling that force-opens
    //     a row, and the navigation customiser callback.
    const src = readFileSync(SETTINGS_SRC, 'utf8');
    expect(src, 'the billing portal endpoint changed').toContain("authFetch('/api/stripe/portal'");
    expect(src, 'the Stripe Connect return no longer opens Payments').toContain("setForceOpen('payments')");
    expect(src, 'the AI Assistant return no longer opens its row').toContain("setForceOpen('ai-assistant')");
    expect(src, 'the navigation customiser is no longer invoked').toMatch(/onClick=\{onCustomizeNav\}/);

    // (c) Every row still renders the component that owns its path, and the row
    //     set and order are unchanged. Grouping is a label on each row, not a
    //     re-parenting of what the row contains.
    const rowOf = (id: string) => {
      const m = src.match(new RegExp(`id: '${id}',[\\s\\S]{0,400}?content: <(\\w+)`));
      return m ? m[1] : null;
    };
    // 🔴 THE-246 — THE ONE ROW WHOSE CONTENT DELIBERATELY CHANGED, and the
    // assertion changes with it rather than being deleted. Stripe Connect moved
    // out of Settings into the Donations section, so this row no longer mounts
    // `PaymentSection`; it renders a pointer that opens that section. What the
    // original assertion was protecting — that a row cannot quietly stop
    // rendering the component owning its path — is restated as the stronger
    // claim the move actually makes: this screen no longer imports
    // `PaymentSection` at all, so there is exactly ONE definition of the Stripe
    // Connect panel and Settings is not a second copy of it.
    expect(rowOf('payments'), 'the Payments row mounts a component again').toBeNull();
    // Asserted as the IMPORT and the MOUNT, not as the word: the comment on the
    // row names `PaymentSection` to say where it went, and a raw-text search
    // would read that explanation as the defect (the precedent AdminDashboard's
    // plan-entitlement suite already sets for comment-bearing claims).
    expect(src, 'AdminSettings still imports the Stripe Connect panel')
      .not.toMatch(/^import PaymentSection/m);
    expect(src, 'AdminSettings kept a second copy of the Stripe Connect panel')
      .not.toMatch(/<PaymentSection\b/);
    expect(src, 'the Payments row no longer opens the Donations section')
      .toMatch(/onClick=\{onOpenDonations\}/);
    expect(rowOf('onboarding')).toBe('OnboardingSection');
    expect(rowOf('sms')).toBe('SmsSection');
    expect(rowOf('integrations')).toBe('IntegrationsSection');
    expect(rowOf('giving-statements')).toBe('GivingStatementsSection');
    expect(rowOf('ai-assistant')).toBe('AiAssistantSection');

    const ids = Array.from(src.matchAll(/^\s+id: '([\w-]+)',$/gm)).map((m) => m[1]);
    expect(ids, 'a row was added, removed or reordered').toEqual([
      'appearance', 'payments', 'onboarding', 'giving-statements',
      'sms', 'ai-assistant', 'integrations', 'cancel-plan',
    ]);

    // (d) One accordion, so one open row at a time and one forceOpen target —
    //     splitting the screen into one accordion per region would have been a
    //     behaviour change.
    expect((src.match(/<SettingsAccordion/g) ?? []).length, 'the screen now has more than one accordion')
      .toBe(1);
    const accordion = readFileSync(ACCORDION_SRC, 'utf8');
    expect((accordion.match(/useState<string \| null>/g) ?? []).length, 'the accordion has more than one open-state')
      .toBe(1);

    // (e) And every row still opens and closes, one at a time.
    const host = await mount();
    await expandSection(host, GIVING_ROW);
    // A row holds its header button, plus a content panel while it is open.
    const open = () =>
      Array.from(host.querySelectorAll('[data-settings-row]'))
        .filter((r) => r.children.length > 1)
        .map((r) => r.getAttribute('data-settings-row'));
    expect(open(), 'opening a row did not expand it').toEqual(['payments']);
    await expandSection(host, 'Onboarding Questions');
    expect(open(), 'two rows are open at once').toEqual(['onboarding']);
    await expandSection(host, 'Onboarding Questions');
    expect(open(), 'a row did not close again').toEqual([]);
  });

  // 12 — the numbers this PR uses are the module's, not its own
  it('the danger separator uses the settled section gap', () => {
    const accordion = readFileSync(ACCORDION_SRC, 'utf8');
    // Both the between-region gap and the danger separator's padding are the
    // sectionGap number. Tailwind needs literal class strings, so they cannot
    // be interpolated from the module — this is what pins them to it.
    expect(accordion).toContain(`sm:pt-[${DENSITY_PX.sectionGap}px]`);
    expect(accordion).toContain(`sm:space-y-[${DENSITY_PX.sectionGap}px]`);
    // No width, height or gap number on this screen that the module does not
    // define. `160/280/440/760` (Rule 2) are absent because admin Settings
    // renders no input of its own — every field lives inside a section
    // component, and those are out of scope.
    const settings = readFileSync(SETTINGS_SRC, 'utf8');
    const invented = (settings + accordion)
      .match(/(?:max-w|w|h|gap|space-y|pt|mt)-\[(\d+(?:\.\d+)?)px\]/g) ?? [];
    const allowed = new Set([`sm:pt-[${DENSITY_PX.sectionGap}px]`]);
    for (const literal of invented) {
      const n = Number(literal.match(/\[(\d+(?:\.\d+)?)px\]/)![1]);
      expect(
        [940, DENSITY_PX.sectionGap, DENSITY_PX.action, DENSITY_PX.control, DENSITY_PX.fieldGap],
        `${literal} is a number this screen invented — every width and density comes from form-layout.ts`,
      ).toContain(n);
    }
    void allowed;
  });
});

/** The commit this branch is measured against, or null when the checkout has no
 *  base to compare to (a shallow CI clone). The content assertions beside every
 *  use of this stand on their own; the diff is the stronger claim when it can
 *  be made. */
function baseRef(): string | null {
  for (const candidate of ['origin/main', 'main']) {
    try {
      const merge = execSync(`git merge-base HEAD ${candidate}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
      if (merge) return merge;
    } catch { /* not present in this checkout */ }
  }
  return null;
}
