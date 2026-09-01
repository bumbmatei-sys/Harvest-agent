import React, { act } from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE — the member Profile page's desktop composition.
 *
 * The page had a two-column grid already, but it never took effect the way it
 * reads. The grid container is a flex item of Profile's `flex flex-col` root,
 * and `lg:mx-auto` sets auto margins on the flex CROSS axis — which suppresses
 * a flex item's default `stretch`. With no definite width the item sized to
 * max-content instead: 643px measured in Chromium at a 1440px viewport, inside
 * a 1216px content area. `lg:max-w-[1280px]` therefore never bound anything,
 * the settings column collapsed to 236px, and the widest empty rectangle on
 * the page was 664px — wider than the content itself.
 *
 * The fix is `lg:w-full` (a definite cross size, so max-w caps and mx-auto
 * centres), a 260px identity rail, and — from `xl` up — a settings column that
 * splits in two, which is what keeps the rows at a list measure and the page
 * short enough that the rail is not sitting above several hundred pixels of
 * nothing.
 *
 * 🔴 THE LOAD-BEARING TEST IS THE FIRST ONE. The founder's position is that the
 * app is fine on mobile, so every class this page gained is `lg:`/`xl:`-
 * prefixed and the sub-640px rendering must be exactly what it was. The first
 * test is what enforces that; it is also verified out-of-band by a Chromium
 * screenshot diff at 380/480/639/768px, which is pixel-identical before and
 * after.
 *
 * Geometry is asserted the way THE-142 did it: by generating the REAL Tailwind
 * CSS from tailwind.config.ts and resolving what each class actually emits at
 * a given viewport, rather than reading class names and believing them. Rem
 * lengths are resolved against the ACTUAL root font-size, which globals.css
 * drops to 14.5px at lg — miss that and every desktop number is 10% wrong.
 */

const ROOT = path.resolve(__dirname, '../../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const PROFILE_SRC = path.join(ROOT, 'src/components/Profile.tsx');

/** The member shell's desktop sidebar — `lg:w-[224px]` in MainApp.tsx. The
 *  Profile page is laid out in what is left of the viewport, not the viewport. */
const SIDEBAR = 224;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, userDoc, updateDocCalls } = vi.hoisted(() => ({
  authMock: {
    currentUser: { uid: 'u1', email: 'member@church.org', photoURL: null, displayName: 'Member' },
  },
  userDoc: { current: {} as Record<string, unknown> },
  updateDocCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../firebase', () => ({
  auth: authMock,
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  onSnapshot: (_ref: unknown, cb: (d: unknown) => void) => {
    cb({ exists: () => true, data: () => userDoc.current });
    return () => {};
  },
  updateDoc: vi.fn(async (_ref: unknown, patch: Record<string, unknown>) => {
    updateDocCalls.push(patch);
  }),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: vi.fn(async () => ({
    forEach: (f: (d: unknown) => void) => f({ data: () => ({ tenantId: 'tenant-1' }) }),
  })),
  arrayUnion: (v: unknown) => v,
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => null) }));
vi.mock('../../utils/tenant-scope', () => ({
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  isSuperAdmin: () => false,
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'plus' }) }));
vi.mock('next/image', () => ({ default: () => null }));

// Sibling screens drag in their own Firebase surface and none of them is under
// test here. ThemeToggle and PaletteFamilyToggle are deliberately NOT mocked —
// they are what test 5 exercises.
vi.mock('../PersonalInformationModal', () => ({ default: () => null }));
vi.mock('../ContactModal', () => ({ default: () => null }));
vi.mock('../FAQModal', () => ({ default: () => null }));
vi.mock('../PrivacyTermsModal', () => ({ default: () => null }));
vi.mock('../ChurchDetailsModal', () => ({ default: () => null }));
vi.mock('../UserEvents', () => ({ default: () => null }));
vi.mock('../SavedItems', () => ({ default: () => null }));
vi.mock('../DonationHistory', () => ({ default: () => null }));

import Profile from '../Profile';
import { buildUtilityCss } from '../../test/support/tailwind-build';

// ── rendering ──────────────────────────────────────────────────────────────

async function mount(data: Record<string, unknown>): Promise<HTMLElement> {
  userDoc.current = data;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />,
    );
  });
  // The church-count effect is async (getDocs), and "My Home Church" only
  // renders once it resolves. Flush it before anything reads the row list.
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

const MEMBER = { displayName: 'Sarah Whitfield', totalDonated: 480 };
const ADMIN = { displayName: 'Sarah Whitfield', role: 'admin', totalDonated: 480 };

const classesOf = (el: Element): string[] =>
  (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

/** The four elements this PR composes with. Found by the structural classes
 *  they carry, not by position, so a reshuffle upstream fails loudly. */
function composition(host: HTMLElement) {
  const all = Array.from(host.querySelectorAll('div'));
  const container = all.find((d) => classesOf(d).some((c) => c.startsWith('lg:grid-cols-')));
  if (!container) throw new Error('no lg: grid container found on Profile');
  const settings = all.find((d) => classesOf(d).includes('xl:grid-cols-2'));
  if (!settings) throw new Error('no xl: settings split found on Profile');
  const kids = Array.from(container.children) as HTMLElement[];
  return {
    container: container as HTMLElement,
    rail: kids[0],
    settings: settings as HTMLElement,
    groupA: settings.children[0] as HTMLElement,
    groupB: settings.children[1] as HTMLElement,
    containerKids: kids,
  };
}

// ── the real Tailwind CSS ──────────────────────────────────────────────────

interface Emitted {
  cls: string;
  minWidth: number;
  decls: Record<string, string>;
}
let emitted: Emitted[] = [];
/** Root font-size per breakpoint, read out of globals.css rather than assumed. */
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

  const host = await mount(ADMIN);
  const c = composition(host);
  const raw = [c.container, c.rail, c.settings, c.groupA, c.groupB]
    .flatMap((el) => classesOf(el))
    .join(' ');
  document.body.innerHTML = '';

  // v4 emits the same utilities wrapped in `@layer utilities` and with theme
  // values referenced rather than inlined; buildUtilityCss undoes exactly
  // those two representational changes, so the walker below is unchanged.
  const out = { css: await buildUtilityCss(raw) };

  // Tailwind escapes arbitrary values as CSS identifiers, so a comma arrives
  // as `\\2c ` rather than `\\,`. Decoding hex escapes first is what makes
  // `lg:grid-cols-[260px_minmax(0,1fr)]` match the class actually on the node.
  const unescape = (sel: string) =>
    sel
      .replace(/^\./, '')
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\/g, '');
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => {
      decls[d.prop] = d.value.trim();
    });
    emitted.push({ cls: unescape(node.selector), minWidth, decls });
  };
  postcss.parse(out.css).each((node) => {
    if (node.type === 'rule') collect(node, 0);
    if (node.type === 'atrule' && node.name === 'media') {
      const m = node.params.match(/min-width:\s*([\d.]+)px/);
      if (!m) return;
      node.walkRules((r) => collect(r, Number(m[1])));
    }
  });
  // A class that emits nothing is the silent failure this guards against.
  expect(emitted.length, 'Tailwind produced no rules for the composition classes')
    .toBeGreaterThan(0);
}, 180_000);

beforeEach(() => {
  document.body.innerHTML = '';
  updateDocCalls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* happy-dom always has it; ignore if a future env does not */
  }
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
});

/** Declarations in force for `classes` at `viewport`, later rules winning. */
function effective(classes: string[], viewport: number): Record<string, string> {
  const wanted = new Set(classes);
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
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

// ═══════════════════════════════════════════════════════════════════════════

describe('Profile — the desktop composition', () => {
  // 1 ── 🔴 the load-bearing one
  it('leaves the sub-640px rendering unchanged', async () => {
    const c = composition(await mount(ADMIN));

    // (a) The unprefixed classes are exactly what they were at 752ff16. A new
    //     unprefixed class is precisely how a "desktop" change reaches mobile.
    const base = (el: HTMLElement) => classesOf(el).filter((x) => !x.includes(':'));
    expect(base(c.container)).toEqual(['px-4', 'mt-6', 'relative', 'z-10', 'space-y-6']);
    expect(base(c.settings)).toEqual(['space-y-6']);
    // The two groups this PR introduces carry only the rhythm the flat list
    // already had, so below xl they are inert wrappers.
    expect(base(c.groupA)).toEqual(['space-y-6']);
    expect(base(c.groupB)).toEqual(['space-y-6']);
    // `hidden lg:block`: the desktop card is absent below lg, as it always was.
    expect(base(c.rail)).toEqual(['hidden']);

    // (b) Everything else on those elements is gated at lg or above, so no
    //     rule can fire below 1024px, let alone below 640px.
    for (const el of [c.container, c.rail, c.settings, c.groupA, c.groupB]) {
      for (const cls of classesOf(el)) {
        if (!cls.includes(':')) continue;
        expect(cls, `${cls} is not gated at lg/xl`).toMatch(/^(lg|xl):/);
      }
    }

    // (c) And prove it from the generated CSS, not from the prefix spelling:
    //     at 639px none of the composition properties is in force anywhere.
    for (const el of [c.container, c.settings, c.groupA, c.groupB]) {
      const d = effective(classesOf(el), 639);
      for (const prop of [
        'display',
        'width',
        'max-width',
        'margin-left',
        'margin-right',
        'grid-template-columns',
        'column-gap',
        'gap',
        'align-items',
      ]) {
        expect(d[prop], `${prop} leaked below 640px`).toBeUndefined();
      }
    }
    // The one box property that IS in force below 640px is the page's original
    // `px-4` gutter, and it must still be exactly that.
    const cont639 = effective(classesOf(c.container), 639);
    expect(cont639['padding-left']).toBe('1rem');
    expect(cont639['padding-right']).toBe('1rem');
  });

  // 2
  it('starts the profile card and the settings column at the same top edge', async () => {
    const c = composition(await mount(MEMBER));

    for (const viewport of [1024, 1440]) {
      const d = effective(classesOf(c.container), viewport);
      expect(d.display, `not a grid at ${viewport}`).toBe('grid');
      // `start`, not `stretch`/`center`: both children begin at the row's top.
      expect(d['align-items'], `columns not top-aligned at ${viewport}`).toBe('flex-start');
      const tracks = d['grid-template-columns'];
      expect(tracks, `no tracks at ${viewport}`).toBeTruthy();
      expect(tracks.split(/\s+(?![^(]*\))/)).toHaveLength(2);
    }

    // Both columns are direct children of that grid, so they occupy row 1
    // together — which is what makes align-items decide their top edge. A
    // wrapper slipped around either one is what would break the alignment.
    expect(c.containerKids).toHaveLength(2);
    expect(c.containerKids[0]).toBe(c.rail);
    expect(c.containerKids[1]).toBe(c.settings);
    expect(classesOf(c.rail)).toContain('lg:block');
  });

  // 3
  it('leaves no empty region wider than 340px at 1440px', async () => {
    // Threshold: 340px. The only band that can be blank across the page's
    // height is the identity rail and its gutters — the rail's content (a
    // 234px card) is shorter than the settings beside it. 340px is that band
    // plus slack; anything wider means content stopped filling the width,
    // which is what 752ff16 did at 664px.
    const THRESHOLD = 340;
    const VIEWPORT = 1440;

    for (const data of [MEMBER, ADMIN]) {
      const c = composition(await mount(data));
      const d = effective(classesOf(c.container), VIEWPORT);

      const region = VIEWPORT - SIDEBAR; // 1216 — what the shell gives the page
      const declaredMax = px(d['max-width'], VIEWPORT);
      expect(d.width, 'the grid must take a definite cross size').toBe('100%');
      const outer = declaredMax === null ? region : Math.min(region, declaredMax);
      const gutter = px(d['padding-left'], VIEWPORT) ?? 0;
      const gap = px(d['column-gap'] ?? d.gap, VIEWPORT) ?? 0;
      const rail = px(d['grid-template-columns'].split(/\s+/)[0], VIEWPORT);
      expect(rail, 'the rail track must be a fixed width').not.toBeNull();

      // The page fills the area it is given: no floating island.
      expect(outer, 'the layout no longer fills the content area').toBe(region);
      // Widest blank band = left gutter + rail + the gap beside it.
      const deadBand = gutter + (rail as number) + gap;
      expect(deadBand, `dead band ${deadBand}px at 1440`).toBeLessThanOrEqual(THRESHOLD);

      // And the settings side is split in two at this width, which is what
      // keeps the page short enough that the band is not full-height.
      const s = effective(classesOf(c.settings), VIEWPORT);
      expect(s.display).toBe('grid');
      expect(s['grid-template-columns'].split(/\s+(?![^(]*\))/)).toHaveLength(2);
    }
  });

  // 4
  it('keeps every row that was there before, in the same order', async () => {
    const rows = (host: HTMLElement) =>
      Array.from(host.querySelectorAll('button,[role="switch"]'))
        .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
        .filter((t) => t && t !== 'Change photo');

    // Captured from 752ff16 before the composition changed, with one
    // deliberate reorder on top: Harvest/Classic now precedes Light/Dark/
    // System, matching the Appearance row's new left-to-right visual order
    // (family, then mode) — DOM order follows visual order so tab order
    // stays in sync, rather than reversing one control with CSS alone.
    expect(rows(await mount(MEMBER))).toEqual([
      'Personal Information',
      'My Home Church',
      'Push Notifications',
      'My Events',
      'Saved',
      // THE-255 — the Install app row. It opens the same screen the onboarding
      // install step shows, so a member who skipped it during signup can still
      // reach it. Placed with Saved and Appearance because it is a device/app
      // setting, not an account one. It is HIDDEN inside the Capacitor shell
      // (nothing to install there), which is why it appears here: happy-dom is
      // an ordinary browser origin, with no `window.Capacitor`.
      'Install app',
      'Harvest',
      'Classic',
      'Light',
      'Dark',
      'System',
      'Give again →',
      'Donation History',
      'Contact Us',
      'FAQ',
      'Privacy & Terms',
      'Log Out',
    ]);

    document.body.innerHTML = '';
    expect(rows(await mount(ADMIN))).toEqual([
      'Admin Dashboard',
      'Personal Information',
      'My Home Church',
      'Push Notifications',
      'My Events',
      'Saved',
      // THE-255 — the Install app row. It opens the same screen the onboarding
      // install step shows, so a member who skipped it during signup can still
      // reach it. Placed with Saved and Appearance because it is a device/app
      // setting, not an account one. It is HIDDEN inside the Capacitor shell
      // (nothing to install there), which is why it appears here: happy-dom is
      // an ordinary browser origin, with no `window.Capacitor`.
      'Install app',
      'Harvest',
      'Classic',
      'Light',
      'Dark',
      'System',
      'Give again →',
      'Donation History',
      'Contact Us',
      'FAQ',
      'Privacy & Terms',
      // THE-225 — the Roadmap row (admin-only, opened a public Trello board in a
      // new tab) is gone from both this app and the marketing site's top nav.
      // Support & Info keeps its other three rows, so the group still renders.
      'Log Out',
    ]);
  });

  // 5
  it('keeps the light/dark/system control and the Harvest/Classic control, both working', async () => {
    const host = await mount(MEMBER);

    const mode = host.querySelector('[role="radiogroup"][aria-label="Colour theme"]');
    const family = host.querySelector('[role="radiogroup"][aria-label="Palette family"]');
    expect(mode, 'the light/dark/system control is gone').toBeTruthy();
    expect(family, 'the Harvest/Classic family switch is gone').toBeTruthy();

    // Together, in one block — the family switch must not be pushed somewhere
    // else or hidden behind the mode control.
    expect(mode!.parentElement).toBe(family!.parentElement);

    const pick = (group: Element, label: string) => {
      const btn = group.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      expect(btn, `${label} is missing`).toBeTruthy();
      act(() => {
        btn!.click();
      });
      return btn!;
    };

    // Mode actually applies.
    pick(mode!, 'Dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(mode!.querySelector('[aria-label="Dark"]')!.getAttribute('aria-checked')).toBe('true');

    // Family actually applies — and does not reset the mode chosen above.
    pick(family!, 'Classic');
    expect(document.documentElement.getAttribute('data-palette')).toBe('classic');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(family!.querySelector('[aria-label="Classic"]')!.getAttribute('aria-checked')).toBe('true');

    // And back, so the control is a switch and not a one-way door.
    pick(family!, 'Harvest');
    expect(document.documentElement.getAttribute('data-palette')).toBe('harvest');
    pick(mode!, 'Light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  // 6
  it('still toggles push notifications', async () => {
    const host = await mount(MEMBER);
    const sw = host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Push Notifications"]');
    expect(sw, 'the Push Notifications switch is gone').toBeTruthy();
    expect(sw!.getAttribute('aria-checked')).toBe('true');

    act(() => {
      sw!.click();
    });

    expect(sw!.getAttribute('aria-checked')).toBe('false');
    expect(updateDocCalls).toContainEqual({ notificationsEnabled: false });
  });

  // 7
  it('hardcodes no colour in the composition, and all four palettes resolve', async () => {
    const c = composition(await mount(ADMIN));

    // (a) Nothing this PR put on the composition elements carries a literal
    //     colour, and none of them has an inline style at all.
    for (const el of [c.container, c.rail, c.settings, c.groupA, c.groupB]) {
      expect(el.getAttribute('style')).toBeNull();
      for (const cls of classesOf(el)) {
        expect(cls, `${cls} looks like a literal colour`).not.toMatch(
          /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/,
        );
      }
    }

    // (b) The surface tokens the page's cards actually use are defined for
    //     every family × mode. Four blocks, so four renderings.
    const css = readFileSync(GLOBALS, 'utf8');
    const varsIn = (match: (sel: string) => boolean) => {
      const out: Record<string, string> = {};
      postcss.parse(css).walkRules((rule) => {
        if (!match(rule.selector)) return;
        rule.walkDecls((d) => {
          if (d.prop.startsWith('--')) out[d.prop] = d.value.trim();
        });
      });
      return out;
    };
    const rootVars = varsIn((s) => s.trim() === ':root');
    const darkVars = varsIn((s) => /\[data-theme="dark"\]/.test(s) && !/data-palette/.test(s));
    const classicLight = varsIn((s) => /\[data-palette="classic"\]\[data-theme="light"\]/.test(s));
    const classicDark = varsIn((s) => /\[data-palette="classic"\](\.dark|\[data-theme="dark"\])/.test(s));
    // Each rendering is the cascade that actually applies on <html>, not the
    // block in isolation — a classic/dark page still inherits :root.
    const palettes: Record<string, Record<string, string>> = {
      'harvest/light': { ...rootVars },
      'harvest/dark': { ...rootVars, ...darkVars },
      'classic/light': { ...rootVars, ...classicLight },
      'classic/dark': { ...rootVars, ...darkVars, ...classicDark },
    };
    // A token may point at another token; "resolves" has to mean it lands on a
    // real colour, not that it is spelled like a variable.
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
    for (const [name, vars] of Object.entries(palettes)) {
      expect(Object.keys(vars).length, `${name} defines no variables`).toBeGreaterThan(0);
      for (const token of ['--surface-raised', '--surface-sunken']) {
        const resolved = resolve(vars, token);
        expect(resolved, `${token} unset for ${name}`).toBeTruthy();
        expect(resolved, `${token} does not resolve to a colour for ${name}`)
          .toMatch(/^(#|rgb|hsl|color-mix)/);
      }
    }
    // The two families must actually differ, or "four palettes" is one palette
    // wearing four names.
    expect(resolve(palettes['harvest/dark'], '--surface-raised'))
      .not.toBe(resolve(palettes['classic/dark'], '--surface-raised'));
  });

  // 8
  it('changes no font size', () => {
    const src = readFileSync(PROFILE_SRC, 'utf8');
    const sizes = src.match(/\btext-\[[\d.]+px\]|\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)\b/g) ?? [];
    const tally: Record<string, number> = {};
    for (const s of sizes) tally[s] = (tally[s] ?? 0) + 1;

    // The exact inventory at 752ff16. The type scale is a separate step; this
    // PR is composition only, so the multiset must not move in either
    // direction — no additions, no "while I'm here" tidy-ups.
    expect(tally).toEqual({
      'text-sm': 10,
      'text-[10px]': 4,
      'text-xs': 3,
      'text-xl': 2,
      'text-[13px]': 2,
      'text-[11px]': 2,
      'text-3xl': 2,
      'text-[22px]': 1,
      'text-[12px]': 1,
      'text-[10.5px]': 1,
    });
    expect(src).not.toMatch(/fontSize/);
    // 10px/10.5px are pre-existing and deliberately untouched here; what this
    // PR must not do is introduce a NEW size under 11px.
    const introduced = Object.keys(tally).filter((k) => !['text-[10px]', 'text-[10.5px]'].includes(k));
    for (const k of introduced) {
      const m = k.match(/\[([\d.]+)px\]/);
      if (m) expect(Number(m[1]), `${k} is below the 11px floor`).toBeGreaterThanOrEqual(11);
    }
  });

  // 9 ── 🔴 the collision guard
  it('creates no shared container primitive', async () => {
    const src = readFileSync(PROFILE_SRC, 'utf8');

    // A shared page container is being built in parallel by someone else. This
    // PR composes Profile with classes on Profile's own elements and adds no
    // primitive of its own, so the two cannot land as rival containers.
    expect(src).not.toMatch(/\bexport\s+(const|function|default function)\s+\w*(Container|Layout|Shell|Wrapper|Grid)\b/);
    expect(src, 'Profile must not start importing a container primitive')
      .not.toMatch(/import\s+[^;]*\b(DesktopContainer|PageContainer|AppContainer|ModalContentContainer)\b/);
    // Profile exports exactly what it always did: the page component.
    const exports = src.match(/^export\s+(?:default\s+)?(?:const|function|class)?\s*(\w+)/gm) ?? [];
    expect(exports.join('|')).toBe('export default Profile');

    // And the composition really is local to this file.
    const c = composition(await mount(MEMBER));
    expect(classesOf(c.container).some((x) => x.startsWith('lg:grid-cols-'))).toBe(true);
    expect(src).toMatch(/lg:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  });
});
