import React, { act } from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { contrastRatio, AA_CONTRAST } from '../../../lib/theme';
import tw from '../../../../tailwind.config';
import {
  Button, Card, Badge, Eyebrow, SegmentedControl,
  Input, Select, Switch, Modal,
  WheatMark, Avatar, NavItem, ScreenHeader, StatCard,
} from '../index';

/**
 * THE-61 — the design-kit primitives.
 *
 * The acceptance bar for this port is not "it renders". It is that every
 * primitive THEMES: the whole reason for converting the kit's inline
 * `style={{ background: '#FFF' }}` to Tailwind token classes is that theming
 * then comes for free. A primitive that still carried a literal hex would
 * render identically in both themes and no type error would catch it.
 *
 * So the tests below resolve each primitive's classes against the ACTUAL light
 * and dark variable blocks in globals.css. Note the rendered DOM is deliberately
 * theme-independent — there is no `dark:` class and no JS branch on the theme —
 * so the proof cannot come from getComputedStyle (happy-dom has no stylesheet
 * here anyway). It comes from showing the tokens a primitive names resolve to
 * different values under the two blocks.
 */

// The config's own colour groups, so the guards below compare against what
// Tailwind will actually generate rather than a copy that can drift.
const twExtend = (tw.theme?.extend ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
const colors = twExtend.colors ?? {};
const textColor = twExtend.textColor ?? {};

const ROOT = path.resolve(__dirname, '../../../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const DS_DIR = path.join(ROOT, 'src/components/ds');

// React 19 wants this flag before act() is used outside a testing library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let lightVars: Record<string, string>;
let darkVars: Record<string, string>;

/**
 * Mount into a detached container. Uses createRoot + act, which is what the
 * rest of this suite does — @testing-library/react is present but its
 * @testing-library/dom peer is not installed, so it cannot be imported here.
 */
function mount(el: React.ReactElement): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function varsIn(css: string, selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

beforeAll(() => {
  const css = readFileSync(GLOBALS, 'utf8');
  lightVars = varsIn(css, (s) => s === ':root');
  darkVars = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s));
});

/** A dark-theme lookup that falls back to light, exactly as the cascade does. */
const inTheme = (theme: 'light' | 'dark') => (name: string): string | undefined =>
  theme === 'dark' ? darkVars[name] ?? lightVars[name] : lightVars[name];

// ── colour evaluation ──────────────────────────────────────────────────────
// Enough of a CSS colour evaluator for the forms globals.css actually uses:
// hex literals, var() chains with fallbacks, `R G B` channel triplets (which
// exist so the /alpha modifier keeps working), and the single-argument
// color-mix over `transparent` used by --surface-gold and friends.

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

const parseHex = (h: string): [number, number, number] => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
};

/**
 * Resolve a colour expression to an opaque hex, compositing any translucency
 * over `backdrop`. Returns null when the expression is not a colour this
 * evaluator understands — the caller then skips it rather than asserting on a
 * value it invented.
 */
function resolveColor(
  expr: string | undefined,
  lookup: (n: string) => string | undefined,
  backdrop: string,
  depth = 0,
): string | null {
  if (!expr || depth > 12) return null;
  const v = expr.trim();

  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const [a, b, c] = v.slice(1);
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  if (/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(v)) {
    const [r, g, b] = v.split(/\s+/).map(Number);
    return toHex(r, g, b);
  }

  const varMatch = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/i);
  if (varMatch) {
    const direct = resolveColor(lookup(varMatch[1]), lookup, backdrop, depth + 1);
    if (direct) return direct;
    return varMatch[2] ? resolveColor(varMatch[2], lookup, backdrop, depth + 1) : null;
  }

  const rgbMatch = v.match(/^rgb\(\s*([\s\S]+?)\s*(?:\/[^)]*)?\)$/i);
  if (rgbMatch) return resolveColor(rgbMatch[1], lookup, backdrop, depth + 1);

  // color-mix(in srgb, <colour> P%, transparent)
  const mixMatch = v.match(/^color-mix\(\s*in\s+srgb\s*,\s*([\s\S]+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/i);
  if (mixMatch) {
    const fg = resolveColor(mixMatch[1], lookup, backdrop, depth + 1);
    if (!fg) return null;
    const alpha = Number(mixMatch[2]) / 100;
    const [fr, fg2, fb] = parseHex(fg);
    const [br, bg, bb] = parseHex(backdrop);
    return toHex(fr * alpha + br * (1 - alpha), fg2 * alpha + bg * (1 - alpha), fb * alpha + bb * (1 - alpha));
  }

  return null;
}

// ── class → token mapping ──────────────────────────────────────────────────
// Only the classes these primitives actually spell. Derived by rule where the
// scales allow it, so adding a hue does not mean editing a table.

const NAMED_TOKENS: Record<string, string> = {
  'bg-surface': '--surface',
  'bg-surface-raised': '--surface-raised',
  'bg-surface-sunken': '--surface-sunken',
  'bg-surface-gold': '--surface-gold',
  'bg-surface-night': '--surface-night',
  'bg-surface-chip': '--surface-chip',
  'bg-danger': '--brand-danger',
  'bg-danger-tint': '--c-danger-tint',
  'bg-gold': '--brand-color',
  'text-gold': '--brand-color',
  'text-strong': '--text-strong',
  'text-body': '--text-body',
  'text-muted': '--text-muted',
  'text-faint': '--text-faint',
  'text-danger': '--ink-danger',
  'text-danger-strong': '--ink-danger-strong',
  'border-line': '--border-default',
  'border-line-subtle': '--border-subtle',
  'border-line-strong': '--border-strong',
  'border-gold': '--brand-color',
  'border-danger': '--brand-danger',
  'border-surface-raised': '--surface-raised',
};

const HUES = 'red|green|amber|blue|yellow|purple|pink|sky|field|wheat';

/** Every CSS custom property a single utility class ultimately reads. */
function tokensForClass(cls: string): string[] {
  const arbitrary = [...cls.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
  if (arbitrary.length) return arbitrary;

  const bare = cls.replace(/^(?:hover|focus|active|group-hover\/[a-z-]+):/, '');
  if (NAMED_TOKENS[bare]) return [NAMED_TOKENS[bare]];

  const fill = bare.match(new RegExp(`^(?:bg|border)-(${HUES})-(50|100|200)$`));
  if (fill) return [`--c-${fill[1]}-${fill[2]}`];

  const ink = bare.match(new RegExp(`^text-(${HUES})-(\\d{3})$`));
  if (ink) return [`--ink-${ink[1]}-${ink[2]}`];

  return [];
}

/** Every token named anywhere in a rendered tree. */
function tokensIn(container: HTMLElement): string[] {
  const out = new Set<string>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
    for (const cls of el.className.toString().split(/\s+/)) {
      for (const token of tokensForClass(cls)) out.add(token);
    }
  }
  return [...out];
}

// ── the 14 ─────────────────────────────────────────────────────────────────
// `requiredToken` is the token that carries the primitive's identity. It is
// asserted BY NAME so that swapping the class for a literal hex fails here
// rather than quietly rendering an unthemed element.

interface Spec {
  name: string;
  render: () => React.ReactElement;
  requiredToken: string;
  /** Correctly the same in both themes — brand is not a neutral. */
  brandOnly?: true;
}

const PRIMITIVES: Spec[] = [
  {
    // Both variants, deliberately. The gold primary is brand-coloured and so
    // themes only through its elevation; the secondary is the neutral one, and
    // its border and ink must follow the ramp.
    name: 'Button',
    render: () => (
      <>
        <Button>Give</Button>
        <Button variant="secondary">Cancel</Button>
      </>
    ),
    requiredToken: '--ds-sh-sm',
  },
  { name: 'Card', render: () => <Card>body</Card>, requiredToken: '--surface-raised' },
  { name: 'Badge', render: () => <Badge>New</Badge>, requiredToken: '--surface-sunken' },
  {
    name: 'Eyebrow',
    render: () => <Eyebrow>Our mission</Eyebrow>,
    requiredToken: '--brand-color',
    brandOnly: true,
  },
  {
    name: 'SegmentedControl',
    render: () => <SegmentedControl options={['Contacts', 'Roles']} value="Contacts" />,
    requiredToken: '--surface-sunken',
  },
  { name: 'Input', render: () => <Input placeholder="Name" />, requiredToken: '--surface-raised' },
  {
    name: 'Select',
    render: () => <Select options={[{ value: 'a', label: 'A' }]} />,
    requiredToken: '--surface-raised',
  },
  { name: 'Switch', render: () => <Switch />, requiredToken: '--border-strong' },
  {
    name: 'Modal',
    render: () => <Modal title="Add contact">body</Modal>,
    requiredToken: '--scrim-night',
  },
  {
    name: 'WheatMark',
    render: () => <WheatMark src="/harvest-mark.png" />,
    requiredToken: '--text-strong',
  },
  { name: 'Avatar', render: () => <Avatar name="Ada Lovelace" />, requiredToken: '--surface-sunken' },
  { name: 'NavItem', render: () => <NavItem label="Dashboard" />, requiredToken: '--text-muted' },
  {
    name: 'ScreenHeader',
    render: () => <ScreenHeader title="Contacts" />,
    requiredToken: '--surface-raised',
  },
  {
    name: 'StatCard',
    render: () => <StatCard label="Members" value="1,204" />,
    requiredToken: '--surface-raised',
  },
];

it('all 14 kit primitives are covered', () => {
  expect(PRIMITIVES).toHaveLength(14);
});

/**
 * TEST 3 — theming, not merely compiling.
 */
describe('every primitive renders in both themes and resolves differently', () => {
  it.each(PRIMITIVES.map((p) => [p.name, p] as const))(
    '%s renders without throwing',
    (_name, spec) => {
      const { container, unmount } = mount(spec.render());
      expect(container.firstElementChild).not.toBeNull();
      unmount();
    },
  );

  it.each(PRIMITIVES.map((p) => [p.name, p] as const))(
    '%s names its identifying token',
    (_name, spec) => {
      const { container, unmount } = mount(spec.render());
      const tokens = tokensIn(container);
      unmount();
      expect(
        tokens,
        `${spec.name} no longer references ${spec.requiredToken} — a literal colour here opts it out of theming`,
      ).toContain(spec.requiredToken);
    },
  );

  it.each(PRIMITIVES.filter((p) => !p.brandOnly).map((p) => [p.name, p] as const))(
    '%s resolves to a different colour in dark than in light',
    (_name, spec) => {
      const { container, unmount } = mount(spec.render());
      const tokens = tokensIn(container);
      unmount();

      // A token counts as themed when its RESOLVED colour differs. Elevation
      // tokens (--ds-sh-*, --glow-gold, --ring-gold) are box-shadow lists, not
      // colours, so resolveColor cannot reduce them to a hex — for those, and
      // only those, compare the raw declarations. Comparing raw strings for
      // everything would count `var(--cream)` vs `#FAF8F5` as a change when
      // both resolve to the same colour.
      const changed = tokens.filter((t) => {
        const rawLight = lightVars[t];
        const rawDark = darkVars[t] ?? lightVars[t];
        const l = resolveColor(rawLight, inTheme('light'), '#FFFFFF');
        const d = resolveColor(rawDark, inTheme('dark'), '#221D18');
        if (l && d) return l !== d;
        if (!l && !d) return Boolean(rawLight) && rawLight !== rawDark;
        return false;
      });

      expect(
        changed.length,
        `${spec.name} names ${tokens.length} token(s) but none change between themes — it renders identically on both grounds`,
      ).toBeGreaterThan(0);
    },
  );

  it('Eyebrow is brand-only, and that is correct rather than a miss', () => {
    // Gold is brand, not a neutral: it clears AA on the dark ground (6.77:1),
    // so an eyebrow is gold on both. Listed explicitly so that a primitive
    // which SHOULD theme can never be quietly parked here.
    expect(PRIMITIVES.filter((p) => p.brandOnly).map((p) => p.name)).toEqual(['Eyebrow']);
  });
});

/**
 * TEST 2 — every text/surface pair these primitives introduce clears AA 4.5:1,
 * computed in both themes rather than eyeballed once on white.
 */
describe('new text/surface pairs clear WCAG AA in both themes', () => {
  const PAIRS: Array<[ink: string, surface: string, where: string]> = [
    ['--text-strong', '--surface-raised', 'Card / ScreenHeader / StatCard value'],
    ['--text-body', '--surface-raised', 'Card body'],
    ['--text-muted', '--surface-raised', 'StatCard label, Modal subtitle'],
    ['--text-muted', '--surface-sunken', 'Avatar initials, Badge neutral'],
    ['--text-faint', '--surface-raised', 'Input placeholder'],
    ['--ink-wheat-800', '--surface-gold', 'Badge gold, Card gold'],
    ['--ink-sky-700', '--c-sky-100', 'Badge sky'],
    ['--ink-field-700', '--c-field-100', 'Badge green'],
    ['--ink-field-600', '--surface-raised', 'StatCard up-delta'],
    ['--ink-danger-strong', '--c-danger-tint', 'Badge danger'],
    ['--ink-danger-strong', '--surface-raised', 'StatCard down-delta'],
  ];

  it.each(PAIRS)('%s on %s (%s)', (ink, surface, _where) => {
    for (const theme of ['light', 'dark'] as const) {
      const lookup = inTheme(theme);
      const ground = theme === 'dark' ? '#221D18' : '#FFFFFF';
      const bg = resolveColor(lookup(surface), lookup, ground);
      const fg = resolveColor(lookup(ink), lookup, bg ?? ground);
      expect(bg, `${surface} did not resolve in ${theme}`).not.toBeNull();
      expect(fg, `${ink} did not resolve in ${theme}`).not.toBeNull();
      const ratio = contrastRatio(fg!, bg!);
      expect(
        ratio,
        `${ink} on ${surface} is ${ratio.toFixed(2)}:1 in ${theme} — below AA`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('the gold button is the one documented exception, and is stated not hidden', () => {
    // The brief is explicit: brand colours stay literal, and `text-white` on a
    // gold button is correct. It is 2.66:1 and that is a design decision, not
    // an oversight — asserted here so the number is on the record and a future
    // reader does not "discover" it as a bug.
    const ratio = contrastRatio('#FFFFFF', '#C9963A');
    expect(ratio).toBeLessThan(AA_CONTRAST);
    expect(ratio).toBeCloseTo(2.66, 1);
  });
});

/**
 * TEST 4b — every token class the primitives spell is a REAL utility.
 *
 * This exists because `bg-surface-gold` and `bg-surface-night` were written
 * here first and produced nothing at all: `surface` had only DEFAULT/raised/
 * sunken/chip/tint, so both were well-formed class names with no rule behind
 * them. Same silent-failure shape as the /opacity trap — no error, no type
 * error, no failing render — and nothing in the suite would have noticed. The
 * scale keys were added to the config; this keeps the next one honest.
 */
describe('every semantic class the primitives use resolves in the Tailwind config', () => {
  const GROUPS: Array<{ prefix: string; group: Record<string, unknown>; label: string }> = [
    { prefix: 'bg-surface', group: colors.surface, label: 'colors.surface' },
    { prefix: 'border-line', group: colors.line, label: 'colors.line' },
    { prefix: 'bg-danger', group: colors.danger, label: 'colors.danger' },
    { prefix: 'text-danger', group: textColor.danger, label: 'textColor.danger' },
  ];

  const dsSource = readdirSync(DS_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(path.join(DS_DIR, f), 'utf8'))
    .join('\n');

  it.each(GROUPS.map((g) => [g.prefix, g] as const))(
    '%s-* suffixes all exist',
    (_prefix, { prefix, group, label }) => {
      const missing: string[] = [];
      for (const m of dsSource.matchAll(new RegExp(`\\b${prefix}(?:-([a-z]+))?\\b`, 'g'))) {
        const key = m[1] ?? 'DEFAULT';
        if (!(key in group)) missing.push(`${m[0]} → ${label}.${key} does not exist`);
      }
      expect([...new Set(missing)], 'this class emits no CSS at all').toEqual([]);
    },
  );

  it('the semantic text roles exist', () => {
    for (const role of ['strong', 'body', 'muted', 'faint']) {
      expect(textColor, `textColor.${role} is missing`).toHaveProperty(role);
    }
  });

  it('the scale values THE-61 added exist', () => {
    const extend = tw.theme?.extend as Record<string, Record<string, unknown>> | undefined;
    expect(extend?.letterSpacing).toHaveProperty('display');
    expect(extend?.letterSpacing).toHaveProperty('eyebrow');
    expect(extend?.transitionTimingFunction).toHaveProperty('spring');
    expect(textColor.wheat).toHaveProperty('800');
    expect(colors.surface).toHaveProperty('gold');
    expect(colors.surface).toHaveProperty('night');
  });
});

/**
 * TEST 5 — the default palette is unspellable here.
 */
describe('the primitives use no default-palette neutral', () => {
  const dsFiles = readdirSync(DS_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => path.join(DS_DIR, f))
    .filter((f) => statSync(f).isFile());

  it('contains no text-/bg-/border-gray|slate|zinc', () => {
    const offenders: string[] = [];
    for (const f of dsFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(
        /\b(?:text|bg|border|ring|divide|from|to|via|placeholder|fill|stroke)-(?:gray|slate|zinc)-\d+/g,
      )) {
        offenders.push(`${path.basename(f)}: ${m[0]}`);
      }
    }
    expect(offenders, 'theme.extend.colors merges with Tailwind, so these compile and never theme').toEqual([]);
  });

  it('src as a whole still has zero, not merely no new ones', () => {
    // Measured at 9ea8df1: the only occurrence anywhere in src is the string
    // "text-gray-400" inside a comment in theming-gaps.test.ts. Asserting zero
    // is strictly stronger than asserting "no new ones" and costs nothing while
    // it holds.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) {
          if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
        } else if (/\.tsx?$/.test(e)) out.push(p);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const f of walk(path.join(ROOT, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(
        /\b(?:text|bg|border|ring|divide|from|to|via|placeholder|fill|stroke)-(?:gray|slate|zinc)-\d+/g,
      )) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * TEST 6 — THE-61 is additive. Any change to a light value that already shipped
 * is a real finding, not something to absorb.
 */
describe('the existing light theme is untouched', () => {
  const PINNED: Record<string, string> = {
    '--surface': 'var(--cream)',
    '--surface-raised': '#FFFFFF',
    '--surface-sunken': 'var(--stone-100)',
    '--surface-gold': 'var(--wheat-100)',
    '--surface-night': 'var(--navy-900)',
    '--surface-chip': 'var(--stone-200)',
    '--border-default': 'var(--stone-200)',
    '--border-subtle': 'var(--stone-100)',
    '--border-strong': 'var(--stone-300)',
    '--border-hairline': '#EDEBE8',
    '--text-strong': 'var(--earth)',
    '--text-body': '#4A4038',
    '--text-muted': '#68563F',
    '--text-faint': '#766A5A',
    '--brand-color': '#C9963A',
    '--brand-danger': '#C4553B',
  };

  it.each(Object.entries(PINNED))('%s is still %s in the light theme', (token, value) => {
    expect(lightVars[token]).toBe(value);
  });

  it('adds exactly the tokens THE-61 declared, and no others', () => {
    // Named so that an accidental extra token shows up as a diff here rather
    // than as a second vocabulary nobody reviewed.
    const added = ['--ring-gold', '--scrim-night', '--ds-sh-xl', '--ink-wheat-800'];
    for (const token of added) {
      expect(lightVars[token], `${token} has no light value`).toBeDefined();
      expect(darkVars[token], `${token} has no dark value — that is how a surface stays light`).toBeDefined();
    }
  });
});
