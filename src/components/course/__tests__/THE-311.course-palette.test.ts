// @vitest-environment node
//
// Nothing here needs a DOM: every question is answered from the SOURCE, from
// globals.css parsed for real with postcss, or from `git diff`. The one
// question that needs a layout engine — "did a pixel move" — lives in
// `THE-311.course-palette.layout.test.tsx`, in real Chromium.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

import { contrastRatio, deriveOnDarkAccent, AA_CONTRAST, DARK_SURFACE, CLASSIC_DARK_SURFACE } from '../../../lib/theme';
import * as C from '../../../utils/course.constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE-311 — the course screens follow the theme
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THE DEFECT. `src/utils/course.constants.ts` had 17 exports and exactly ONE
 * of them was var-backed. Every course screen therefore painted a white card
 * with near-black text whatever theme was active — and Classic has been the
 * DEFAULT family since THE-265 (#409), so a member's course library was a light
 * page inside a dark app on the very palette most of them get.
 *
 * ⚠️ NOTHING HERE IS EYEBALLED. Every ratio below is computed by the same
 * `contrastRatio()` the production code uses, over values resolved through the
 * REAL cascade in globals.css (postcss), in all four palettes. Classic is
 * asserted first because it is the default.
 *
 * ── Premises checked against the tree, and where they were wrong ────────────
 * The ticket's own framing is recorded here because two parts of it did not
 * survive contact with the repo, and a future reader deserves the corrected
 * version rather than the brief:
 *
 *  • "Nine files import it. AdminCourseEditor.tsx is 86 KB." — TEN files
 *    import it (eight components, two tests) and `AdminCourseEditor.tsx` is
 *    NOT one of them. It carries its own private, ALREADY-MIGRATED copy of the
 *    same constant names at line 74, as do `AdminRAG.tsx:53` and
 *    `AdminRoles.tsx:28`. That copy is where eight of this file's mappings come
 *    from — they are adoption of a settled spelling, not invention. Asserted
 *    below so the claim cannot rot.
 *
 *  • "CourseCard.tsx and the member screens sit under sha256 digest guards." —
 *    they do not. The only sha256 ledgers in the repo cover
 *    `src/components/ui/**` and `tailwind.config.ts`. What actually guards the
 *    course screens is `changedSince()` byte-identity in THE-282, that file's
 *    class-token and import-list assertions, and the two measured layout
 *    suites. So THE-311 had NO digest to append to, which is why no digest was
 *    appended and none was substituted.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const CONSTANTS = 'src/utils/course.constants.ts';

/* ── The base commit, resolved exactly as THE-282 resolves it ──────────────
   Copied deliberately rather than imported: THE-282's file is a test, not a
   module, and importing it would run its suite twice. The fallback chain is
   the same one and for the same CI reason — a `pull_request` run checks out
   `refs/pull/N/merge`, where `origin/main` may not exist. */
function baseRef(): string {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { /* next */ }
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so "byte-identical" would measure nothing.');
}

/** ⚠️ ONE `git diff` at module load, never per assertion. */
const CHANGED: string[] = execFileSync('git', ['diff', '--name-only', baseRef()], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const changed = (...prefixes: string[]) => CHANGED.filter((f) => prefixes.some((p) => f.startsWith(p)));

/* ── The four palettes, resolved through the real cascade ─────────────────── */

function varsIn(css: string, selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
  });
  return out;
}

const GLOBALS = src('src/app/globals.css');
const rootVars = varsIn(GLOBALS, (s) => s === ':root');
const harvestDark = varsIn(GLOBALS, (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'));
const classicLight = varsIn(GLOBALS, (s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'));
const classicDark = varsIn(GLOBALS, (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')));

/** Classic FIRST — it is the default family. */
const PALETTES = [
  { name: 'Classic light', scope: { ...rootVars, ...classicLight }, dark: false, ground: null as string | null },
  { name: 'Classic dark', scope: { ...rootVars, ...harvestDark, ...classicDark }, dark: true, ground: CLASSIC_DARK_SURFACE },
  { name: 'Harvest light', scope: { ...rootVars }, dark: false, ground: null },
  { name: 'Harvest dark', scope: { ...rootVars, ...harvestDark }, dark: true, ground: DARK_SURFACE },
] as const;

/** Resolve a `var()` chain (and `rgb(var(--triplet))`) inside a scope to a hex. */
function resolveColour(value: string, scope: Record<string, string>, depth = 0): string | null {
  if (depth > 12) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toUpperCase();
  const triplet = /^rgb\(\s*var\((--[a-z0-9-]+)\)\s*\)$/i.exec(v);
  if (triplet) {
    const raw = scope[triplet[1]];
    if (!raw) return null;
    const n = raw.trim().split(/\s+/).map(Number);
    if (n.length !== 3 || n.some(Number.isNaN)) return null;
    return '#' + n.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i.exec(v);
  if (ref) {
    const next = scope[ref[1]];
    return next === undefined ? null : resolveColour(next, scope, depth + 1);
  }
  return null;
}

const toRgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
const mixHex = (a: string, b: string, t: number) => {
  const A = toRgb(a), B = toRgb(b);
  return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
};

/**
 * What `GOLD_LIGHT` (`--surface-gold`) actually PAINTS in a palette.
 *
 * ⚠️ On light it is `var(--wheat-100)`, an opaque hex. On dark it is
 * `color-mix(… <accent> 16%, transparent)` — TRANSLUCENT — so it composites
 * onto whatever it is drawn on, which in every course call site is the card
 * (`--surface-raised`). The composite is computed here rather than guessed.
 */
function goldTintGround(p: (typeof PALETTES)[number]): string {
  const raised = resolveColour('var(--surface-raised)', p.scope)!;
  if (!p.dark) return resolveColour('var(--surface-gold)', p.scope)!;
  const decl = p.scope['--surface-gold'];
  const pct = Number(/\s(\d+)%/.exec(decl)![1]);
  // On dark the accent is the contrast-corrected one layout.tsx injects.
  const accent = deriveOnDarkAccent(resolveColour('var(--brand-color)', rootVars)!, p.ground!);
  return mixHex(raised, accent, pct / 100);
}

/* ═════════════════════════════════════════════════════════════════════════
   1 · Every export resolves through a palette token
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * The mapping, constant by constant. `token` is the custom property the value
 * must reach; `why` is why that one and not another.
 *
 * 🔴 There is no `null` entry. Every one of the seventeen constants found an
 * EXISTING home, so STOP condition 2 ("a constant has no token to map onto")
 * was never reached and no token was defined — which test 5 proves from
 * `git diff` rather than from this sentence.
 */
const MAPPING: ReadonlyArray<{ name: keyof typeof C; token: string; why: string }> = [
  { name: 'GOLD', token: '--brand-color', why: 'the tenant accent; already var-backed and untouched' },
  { name: 'GOLD_LIGHT', token: '--surface-gold', why: 'globals.css declares it for exactly this role: "soft gold tint fill (icon discs, active pills)"' },
  { name: 'GOLD_ON_TINT', token: '--ink-wheat-800', why: 'THE-61 minted it for gold ink ON the gold tint, because the kit\'s own wheat-700-on-wheat-100 measured 4.33:1' },
  { name: 'GOLD_HOVER', token: '--brand-color', why: 'the repo-wide hover spelling, already inlined five times in these very files' },
  { name: 'GOLD_BTN', token: '--brand-color', why: 'both gradient stops derive from the tenant accent; the spelling already ships in three sibling files' },
  { name: 'BG', token: '--surface', why: 'the page ground' },
  { name: 'BG_WARM', token: '--surface-tint', why: 'the warm off-white fill role; equals --surface on dark so it recedes' },
  { name: 'CARD', token: '--surface-raised', why: 'cards and panels; inverts direction on dark' },
  { name: 'TEXT', token: '--text-strong', why: 'headings and emphasis' },
  { name: 'TEXT2', token: '--text-muted', why: 'secondary copy' },
  { name: 'TEXT3', token: '--text-faint', why: 'eyebrows and timestamps — the third step of the same ramp' },
  { name: 'BORDER', token: '--border-default', why: 'the common container border' },
  { name: 'BORDER_LIGHT', token: '--border-subtle', why: 'hairlines' },
  { name: 'GREEN', token: '--ink-green-700', why: 'the success ink ramp; -600 is the old hex exactly but fails AA at 3.15:1 on the tint in both light palettes' },
  { name: 'GREEN_BG', token: '--c-green-50', why: 'the success tint; #F0FDF4 to the byte in light, so the ground does not move' },
  { name: 'SHADOW_SM', token: '--ds-sh-sm', why: 'the app\'s elevation ramp, which globals.css already re-derives on dark as a hairline highlight plus a deeper black' },
  { name: 'SHADOW_MD', token: '--ds-sh-md', why: 'ditto, one step up' },
  { name: 'SHADOW_LG', token: '--ds-sh-lg', why: 'ditto, two steps up' },
];

describe('1 — every course.constants export resolves through a palette token', () => {
  it('the mapping covers every export, and every export is in the mapping', () => {
    const exported = Object.keys(C).sort();
    expect(MAPPING.map((m) => m.name as string).sort(), 'an export is unmapped, or the mapping names one that is gone')
      .toEqual(exported);
  });

  it.each(MAPPING)('$name resolves through $token — $why', ({ name, token }) => {
    const value = C[name] as string;
    expect(value, `${name} is not a string`).toBeTypeOf('string');
    expect(value, `${name} does not reference ${token}`).toContain(token);
    // 🔴 And it carries no LIVE hex of its own.
    //
    // `var(--x, #fallback)` is stripped before the scan, exactly as
    // theming-member-app.test.ts strips it and for the same reason: the token
    // always resolves in a running app, so the hex is reached only if the
    // variable is deleted outright.
    //
    // ⚠️ EVERYTHING ELSE IS ALLOWLISTED BY NAME AND BY VALUE, not by a regex
    // that would also wave through a restored gold. There is exactly one entry:
    // GOLD_BTN's lighten target. Restoring `#C9963A` or `#D4A843` as a gradient
    // stop fails here, naming the constant — which is the mutation the ticket
    // asks this guard to catch.
    const ALLOWED: Partial<Record<keyof typeof C, readonly string[]>> = {
      // The second stop lightens the accent toward white. White is not a
      // palette colour to theme — it is the direction the mix travels, the
      // same role `--cream` plays inside deriveOnDarkAccent — and it is the
      // spelling already shipping in AdminCourseEditor, AdminRAG and AdminRoles.
      GOLD_BTN: ['#ffffff'],
    };
    const live = (value.replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'VAR')
      .match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [])
      .filter((h) => !(ALLOWED[name] ?? []).includes(h.toLowerCase()));
    expect(live, `${name} still carries a live hex`).toEqual([]);
  });

  it('🔴 and the token each one names is really declared in globals.css', () => {
    for (const { name, token } of MAPPING) {
      expect(GLOBALS, `${token} (for ${name}) is not declared — this would be minting a token`)
        .toMatch(new RegExp(`\\${token}:`));
    }
  });

  it('the eight names taken from the already-migrated sibling copies match them verbatim', () => {
    // ⚠️ The ticket said AdminCourseEditor.tsx imports this module. It does not
    // — it carries its own migrated copy, and so do AdminRAG and AdminRoles.
    for (const file of ['src/components/AdminCourseEditor.tsx', 'src/components/AdminRAG.tsx', 'src/components/AdminRoles.tsx']) {
      const s = src(file);
      expect(s, `${file} unexpectedly imports course.constants`).not.toContain('course.constants');
      expect(s, `${file} no longer carries the migrated GOLD_BTN spelling`).toContain(C.GOLD_BTN);
    }
    const editor = src('src/components/AdminCourseEditor.tsx');
    for (const [name, value] of [['BG', C.BG], ['CARD', C.CARD], ['TEXT', C.TEXT], ['TEXT2', C.TEXT2], ['BORDER', C.BORDER]] as const) {
      expect(editor, `the editor's ${name} no longer matches`).toContain(`const ${name} = "${value}"`);
    }
  });

  it('the course screens carry no course-owned hex outside the two documented placeholders', () => {
    const FILES = [
      'AuthorProfile.tsx', 'CourseCard.tsx', 'CourseCurriculum.tsx', 'CourseLibrary.tsx',
      'CourseOverview.tsx', 'CoursePreview.tsx', 'LessonView.tsx', 'ProgressBar.tsx', 'QuizPanel.tsx',
    ].map((f) => `src/components/course/${f}`);
    /**
     * ⚠️ TWO DELIBERATE EXCEPTIONS, and neither is a surface this ticket owns.
     *
     * `#2e4057`/`#1a2a3a` is the THUMBNAIL PLACEHOLDER gradient — the stand-in
     * drawn when a course has no image. It must stay dark in both themes for
     * the same reason `--surface-night` and `prose-invert` do: `text-white`
     * overlays it in every palette, so a ground that inverted would put white
     * on near-white. It is a picture, not chrome.
     */
    const PLACEHOLDER = /#2e4057|#1a2a3a/gi;
    for (const f of FILES) {
      const body = src(f)
        // Comments are prose. They quote the old hexes on purpose.
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
        .replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'VAR')
        .replace(PLACEHOLDER, 'PLACEHOLDER');
      expect(body.match(/#[0-9A-Fa-f]{6}\b/g) ?? [], `${f} carries a hex that cannot follow a palette`).toEqual([]);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   2 · The screens render correctly in all four palettes
   ═════════════════════════════════════════════════════════════════════════ */

/** The constants that name a single colour — the ones a palette must resolve. */
const COLOUR_CONSTANTS = ['GOLD', 'GOLD_LIGHT', 'GOLD_ON_TINT', 'BG', 'BG_WARM', 'CARD', 'TEXT', 'TEXT2', 'TEXT3', 'BORDER', 'BORDER_LIGHT', 'GREEN', 'GREEN_BG'] as const;

describe('2 — course screens render correctly in all four palettes', () => {
  it.each(PALETTES)('$name resolves every colour constant to a real value', (p) => {
    for (const name of COLOUR_CONSTANTS) {
      const value = C[name];
      const hex = name === 'GOLD_LIGHT' ? goldTintGround(p) : resolveColour(value, p.scope);
      expect(hex, `${name} does not resolve in ${p.name} — it would paint nothing`).not.toBeNull();
      expect(hex, `${name} resolved to something that is not a colour in ${p.name}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each(PALETTES)('$name puts the card and the body text on the right side of the ground', (p) => {
    const card = resolveColour(C.CARD, p.scope)!;
    const text = resolveColour(C.TEXT, p.scope)!;
    const lum = (h: string) => toRgb(h).reduce((a, c) => a + c, 0) / 3;
    if (p.dark) {
      expect(lum(card), `${p.name}: the card is not a dark surface — the old #FFFFFF is back`).toBeLessThan(80);
      expect(lum(text), `${p.name}: the heading ink is not light — the old #1a1a1a is back`).toBeGreaterThan(180);
    } else {
      expect(lum(card), `${p.name}: the card is not a light surface`).toBeGreaterThan(200);
      expect(lum(text), `${p.name}: the heading ink is not dark`).toBeLessThan(80);
    }
  });

  it('🔴 the four palettes really are four — no two resolve the card and ink alike', () => {
    const seen = PALETTES.map((p) => `${resolveColour(C.CARD, p.scope)}/${resolveColour(C.TEXT, p.scope)}/${resolveColour(C.BORDER, p.scope)}`);
    expect(new Set(seen).size, `two palettes render identically: ${seen.join(' , ')}`).toBe(4);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   3 · Every foreground/background pair clears AA
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * The pairs the course screens actually paint, read off the call sites rather
 * than imagined. Each is `[ink, ground, label]` as constant NAMES.
 */
const PAIRS: ReadonlyArray<[string, string, string]> = [
  ['TEXT', 'CARD', 'headings on a card'],
  ['TEXT', 'BG', 'headings on the page'],
  ['TEXT', 'BG_WARM', 'headings on the warm fill'],
  ['TEXT2', 'CARD', 'secondary copy on a card'],
  ['TEXT2', 'BG', 'secondary copy on the page'],
  ['TEXT3', 'CARD', 'eyebrows on a card'],
  ['TEXT3', 'BG', 'eyebrows on the page'],
  ['GOLD_ON_TINT', 'GOLD_LIGHT', 'accent ink on the gold tint (author chip, level chip, quiz selection)'],
  ['GREEN', 'GREEN_BG', 'the complete badge'],
  ['GREEN', 'CARD', 'the complete tick on a card'],
];

/**
 * 🔴 THE ONE PAIR THAT DOES NOT CLEAR AA, RECORDED RATHER THAN HIDDEN.
 *
 * `GOLD` used as INK on a light ground is 2.66:1 on `CARD` and 2.48-2.51:1 on
 * `BG`. It is NOT a pair THE-311 maps: `GOLD` was already
 * `var(--brand-color, #C9963A)` before this ticket and is byte-identical after
 * it, so this is the accent's own property and the migration neither caused nor
 * worsened it. globals.css cards the identical failure on `--ring` in its own
 * words — "Gold on a white sidebar is 2.66:1, under the 3:1 non-text bar…
 * Closing it means moving --brand-color". Closing it here would mean replacing
 * the tenant accent with a fixed dark gold wherever gold TEXT appears, which is
 * an app-wide design decision and a different ticket.
 *
 * The ratios are ASSERTED, not merely described, so the day someone does close
 * it this line fails and the card comes down.
 */
const CARDED_LIGHT_GOLD_INK = { 'Classic light': 2.66, 'Harvest light': 2.66 } as const;

describe('3 — every foreground/background pair clears AA, in all four palettes', () => {
  it.each(PALETTES)('$name', (p) => {
    const failures: string[] = [];
    const report: string[] = [];
    for (const [inkName, groundName, label] of PAIRS) {
      const ink = resolveColour(C[inkName as keyof typeof C] as string, p.scope)!;
      const ground = groundName === 'GOLD_LIGHT' ? goldTintGround(p) : resolveColour(C[groundName as keyof typeof C] as string, p.scope)!;
      const r = contrastRatio(ink, ground);
      report.push(`${label}: ${r.toFixed(2)}:1 (${ink} on ${ground})`);
      if (r < AA_CONTRAST) failures.push(`${label} — ${r.toFixed(2)}:1 (${ink} on ${ground})`);
    }
    expect(failures, `${p.name} — these pairs are under AA (${AA_CONTRAST}:1):\n  ${failures.join('\n  ')}\nAll pairs:\n  ${report.join('\n  ')}`)
      .toEqual([]);
  });

  it('🔴 a pair pointed at its own ground fails this test — the guard guards', () => {
    // The mutation the ticket asks for, run in-process rather than by hand:
    // point CARD's ink at CARD and every palette collapses to 1.00:1.
    for (const p of PALETTES) {
      const card = resolveColour(C.CARD, p.scope)!;
      expect(contrastRatio(card, card), `${p.name}: a self-pair did not collapse`).toBeCloseTo(1, 5);
      expect(contrastRatio(card, card)).toBeLessThan(AA_CONTRAST);
    }
  });

  it('records the accent-as-ink failure on light rather than pretending it is gone', () => {
    for (const p of PALETTES) {
      const gold = resolveColour(C.GOLD, p.scope)!;
      const card = resolveColour(C.CARD, p.scope)!;
      const r = contrastRatio(gold, card);
      const carded = (CARDED_LIGHT_GOLD_INK as Record<string, number>)[p.name];
      if (carded === undefined) {
        expect(r, `${p.name}: gold ink on a card should be comfortable on dark, measured ${r.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(AA_CONTRAST);
      } else {
        expect(r, `${p.name}: gold-on-card moved — recheck whether the card can come down`).toBeCloseTo(carded, 1);
      }
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 · No new token was defined
   ═════════════════════════════════════════════════════════════════════════ */

describe('5 — no new token was defined', () => {
  it('🔴 globals.css and tailwind.config.ts are byte-identical to the base branch', () => {
    expect(changed('src/app/globals.css', 'tailwind.config.ts'), 'a token was defined for this ticket').toEqual([]);
  });

  it('and no ui primitive, dependency or digest ledger moved', () => {
    expect(changed('src/components/ui/'), 'a primitive or its digest ledger was touched').toEqual([]);
    expect(changed('package.json', 'package-lock.json'), 'a dependency was added').toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   6-10 · The no-regression pins
   ═════════════════════════════════════════════════════════════════════════ */

describe('6 — the drag-to-reorder still works at level, section and lesson', () => {
  const EDITOR = 'src/components/AdminCourseEditor.tsx';

  it('🔴 AdminCourseEditor.tsx is byte-identical to the base branch', () => {
    // THE-282 pins this file and exempts THE-305 alone. THE-311 adds no
    // exemption: it never opened the editor.
    expect(changed(EDITOR), 'THE-311 modified the editor').toEqual([]);
  });

  /**
   * 🔴 ANCHORED PER DEPTH, on that depth's own `key={…}`.
   *
   * ⚠️ A first draft matched the handler bodies alone and a mutation walked
   * straight past it: the section and lesson depths spell an IDENTICAL
   * `onDragStart`, so breaking one still matched the other and the test stayed
   * green while naming the wrong thing. Each pattern now starts at
   * `key={level.id}` / `key={sec.id}` / `key={lesson.id}` and runs through that
   * wrapper's own `onDragEnd`, so exactly one depth can satisfy each.
   */
  const DEPTH = [
    ['level', /key=\{level\.id\} draggable\s*\n\s*onDragStart=\{\(e\) => \{ e\.stopPropagation\(\); dragLevel\.current = i; \}\}\s*\n\s*onDragEnter=\{\(\) => \{ if \(dragLevel\.current === null\) return; dragOverLevel\.current = i; \}\}\s*\n\s*onDragEnd=\{onLevelDragEnd\}/],
    ['section', /key=\{sec\.id\} draggable\s*\n\s*onDragStart=\{\(e\) => \{ e\.stopPropagation\(\); dragging\.current = i; \}\}\s*\n\s*onDragEnter=\{\(\) => \{ if \(dragging\.current === null\) return; dragOver\.current = i; \}\}\s*\n\s*onDragEnd=\{onDragEnd\}/],
    ['lesson', /key=\{lesson\.id\} draggable\s*\n\s*onDragStart=\{\(e\) => \{ e\.stopPropagation\(\); dragging\.current = i; \}\}\s*\n\s*onDragEnter=\{\(\) => \{ if \(dragging\.current === null\) return; dragOver\.current = i; \}\}\s*\n\s*onDragEnd=\{onDragEnd\}/],
  ] as const;

  it.each(DEPTH)('%s depth still commits on dragend with the split stopPropagation', (depth, shape) => {
    expect(src(EDITOR), `the ${depth} depth's drag wiring changed`).toMatch(shape);
  });

  it('🔴 THE-186 (#413) is intact: no onDragOver, no onDrop, and dragenter does NOT stopPropagation', () => {
    const s = src(EDITOR);
    expect(s, 'an onDragOver appeared — #413 removed these deliberately').not.toMatch(/onDragOver=/);
    expect(s, 'an onDrop appeared — #413 removed these deliberately').not.toMatch(/onDrop=/);
    // The split: start/end stop propagation, enter must NOT, because an
    // ancestor has to see dragenter fired inside its descendants.
    expect(s).not.toMatch(/onDragEnter=\{[^}]*stopPropagation/);
    expect((s.match(/onDragStart=\{\(e\) => \{ e\.stopPropagation\(\)/g) ?? []).length,
      'a depth lost its onDragStart stopPropagation').toBe(3);
  });
});

describe('7 — the #425 toolbar still renders as one horizontally-scrolling row', () => {
  const TOOLBAR = 'src/components/editor/RichTextToolbar.tsx';
  it('is byte-identical to the base branch', () => {
    expect(changed(TOOLBAR), 'THE-311 modified the toolbar').toEqual([]);
  });
  it('and still declares one row with horizontal overflow', () => {
    const s = src(TOOLBAR);
    expect(s, 'the single-row constraint is gone').toMatch(/flex-nowrap|whitespace-nowrap/);
    expect(s, 'the horizontal scroller is gone').toMatch(/overflow-x-auto/);
  });
});

describe('8 — #445 (THE-305) header is unchanged', () => {
  it('the header THE-305 built is untouched, because the editor is untouched', () => {
    expect(changed('src/components/AdminCourseEditor.tsx'), 'THE-311 modified THE-305\'s header').toEqual([]);
  });

  /**
   * ⚠️ ONE THE-305 GUARD WAS AMENDED, AND ONLY ONE. Its
   * `reads nothing out of course.constants.ts` assertion carried two claims:
   * that the editor does not import that module (THE-305's own, untouched) and
   * that the file was byte-identical (only ever a statement about THE-305's
   * diff, and false the moment anyone fixed the hexes it was complaining
   * about). It now pins the CONTENT of the diff instead — no colour literal may
   * be added — which is strictly stronger than a name on an exemption list.
   *
   * 🔴 APPENDED, NEVER SUBSTITUTED. No pinned VALUE anywhere was rewritten:
   * `main` went red for everyone the week a PR replaced a digest, and nothing
   * here replaces one. The layout half of THE-305 is untouched, which is the
   * half that pins measured geometry.
   */
  const THE_311_AMENDED = ['src/components/__tests__/THE-305.course-editor-header.test.tsx'];

  it('THE-305\'s measured-geometry suite is byte-identical, and only its source guard moved', () => {
    expect(changed('src/components/__tests__/THE-305.course-editor-header.layout.test.tsx'),
      'THE-311 touched THE-305\'s measured geometry').toEqual([]);
    expect(changed('src/components/__tests__/THE-305.').filter((f) => !THE_311_AMENDED.includes(f)),
      'a second THE-305 guard was amended').toEqual([]);
  });

  it('and the amendment kept THE-305\'s own claim rather than deleting it', () => {
    const guard = src(THE_311_AMENDED[0]);
    expect(guard, 'THE-305\'s claim that the editor does not import the module was dropped')
      .toContain("expect(readSrc('AdminCourseEditor.tsx')).not.toContain('course.constants');");
    expect(guard, 'the amendment is not recorded with its ticket').toContain('AMENDED BY THE-311');
  });
});

describe('9 — THE-282\'s status logic is unchanged, and there is still no Paused', () => {
  const UTILS = 'src/utils/course.utils.ts';
  it('the three statuses are exactly not-started / Ongoing / Done', () => {
    const s = src(UTILS);
    expect(s).toContain("'not-started'");
    expect(s).toMatch(/Ongoing/);
    expect(s).toMatch(/Done/);
    expect(s, 'a Paused status appeared').not.toMatch(/\bPaused\b|'paused'/);
  });
  it('and the card still derives it from verifyCourseCompletion via getCourseStatus', () => {
    expect(src(UTILS)).toContain('verifyCourseCompletion');
    expect(src('src/components/course/CourseCard.tsx')).toContain('getCourseStatus');
  });
});

describe('10 — course.utils.ts\'s definition of complete is unchanged', () => {
  it('is byte-identical to the base branch', () => {
    expect(changed('src/utils/course.utils.ts'), 'THE-311 changed the definition of complete').toEqual([]);
  });
  it('and course-adoption.ts was not touched either', () => {
    expect(changed('src/utils/course-adoption.ts')).toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   11 · The configurable-brand property
   ═════════════════════════════════════════════════════════════════════════ */

describe('11 — a tenant with a custom brand colour gets it in GOLD_BTN', () => {
  /** What the browser computes for the gradient, given a tenant's `--brand-color`. */
  const stops = (brand: string): string[] => {
    const body = C.GOLD_BTN.replace(/var\(\s*--brand-color\s*,\s*#[0-9A-Fa-f]{6}\s*\)/g, brand);
    return [
      /linear-gradient\(135deg,\s*(#[0-9A-Fa-f]{6})/.exec(body)![1],
      /color-mix\(in srgb,\s*(#[0-9A-Fa-f]{6})/.exec(body)![1],
    ];
  };

  it('🔴 both stops are the tenant\'s colour, not Harvest gold', () => {
    const TENANT = '#2E5AAC';
    expect(stops(TENANT), 'a gradient stop is not the tenant accent').toEqual([TENANT, TENANT]);
    expect(C.GOLD_BTN.match(/#C9963A/g)?.length ?? 0,
      'a hardcoded gold survives outside the var() fallbacks').toBe(2);
    // Both survivors are inside `var(--brand-color, #C9963A)`, i.e. dead unless
    // the variable is deleted outright. Nothing else is a literal gold.
    expect(C.GOLD_BTN.replace(/var\(\s*--brand-color\s*,\s*#C9963A\s*\)/g, 'VAR'))
      .not.toMatch(/#C9963A|#D4A843/i);
  });

  it('the default tenant still gets Harvest gold as the first stop', () => {
    expect(stops('#C9963A')[0]).toBe('#C9963A');
    expect(rootVars['--brand-color'], 'the default accent moved').toBe('#C9963A');
  });

  it('and layout.tsx really does inject a tenant colour into --brand-color', () => {
    // Read, never written — the ticket forbids editing this file, and test 13
    // proves it was not.
    expect(src('src/app/layout.tsx')).toContain('--brand-color:${brandColor}');
  });

  it('deriveOnDarkAccent could NOT have built this gradient, which is why color-mix does', () => {
    // 🔴 The check the ticket asked for, run rather than argued. The function
    // returns an accent that already clears AA UNTOUCHED — Harvest gold is
    // 6.77:1 on the dark ground — so both stops would be identical and the
    // gradient would collapse to a flat fill.
    const gold = '#C9963A';
    expect(deriveOnDarkAccent(gold, DARK_SURFACE), 'deriveOnDarkAccent moved Harvest gold').toBe(gold);
    expect(contrastRatio(gold, DARK_SURFACE)).toBeGreaterThan(AA_CONTRAST);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   12-13 · Hygiene and the out-of-scope files
   ═════════════════════════════════════════════════════════════════════════ */

describe('12 — no emoji anywhere in what THE-311 touched', () => {
  it.each(CHANGED.filter((f) => /\.(ts|tsx|css)$/.test(f)))('%s', (file) => {
    const body = src(file);
    // The ticket bans EMOJI, not the 🔴/⚠️/✅ annotation glyphs this repo's
    // comments are written in — those are pictographs used as severity marks
    // and predate this ticket in every file here. The ban is on emoji in what
    // RENDERS, so the scan is over JSX text and string literals only.
    const rendered = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const emoji = rendered.match(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu) ?? [];
    expect(emoji, `${file} renders an emoji — lucide-react is already imported`).toEqual([]);
  });
});

describe('13 — firestore.rules, functions/ and layout.tsx are byte-identical', () => {
  it.each(['firestore.rules', 'functions/', 'src/app/layout.tsx'])('%s', (p) => {
    expect(changed(p), `${p} was modified`).toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   The `progress` adoption decision
   ═════════════════════════════════════════════════════════════════════════ */

describe('ui/progress was NOT adopted, and THE-272\'s closed adopter list is unchanged', () => {
  it('the adopter list still names exactly THE-290\'s two dashboard widgets', () => {
    const guard = src('src/__tests__/the-272-shadcn-batch-b.test.ts');
    expect(guard).toContain('const THE_290_PROGRESS_ADOPTERS = [');
    expect(changed('src/__tests__/the-272-shadcn-batch-b.test.ts'), 'the adopter list was amended').toEqual([]);
  });
  it('and course/ProgressBar.tsx does not import the primitive', () => {
    const bar = src('src/components/course/ProgressBar.tsx');
    expect(bar, 'ProgressBar adopted ui/progress without the list being amended')
      .not.toMatch(/from ['"][^'"]*ui\/progress['"]/);
    expect(bar, 'the decision is not recorded in the component').toContain('WAS CONSIDERED AND NOT ADOPTED');
  });
});
