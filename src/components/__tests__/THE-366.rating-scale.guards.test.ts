import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  RATING_MAX, RATING_MIN, SCALE_DEFAULT_MIN, SCALE_DEFAULT_MAX,
  SCALE_LIMIT_MIN, SCALE_LIMIT_MAX, TAP_TARGET, POINT_SIZE_CLASSES,
  pointsFor, clampRange, normaliseAnswer, toCsvCell, aggregateScale,
} from '../forms/rating-scale';
import { FIELD_TYPES_WITH_ANSWERS, TREATMENT, summariseField, type AnswerField } from '../forms/form-answers';

/**
 * THE-366 — the `rating` and `scale` field types.
 *
 * Everything here is asserted over the SHIPPED source or over the shipped
 * functions, never over a replica: THE-346 found by mutation that a guard whose
 * subject is retyped in the guard measures a fiction the moment the real thing
 * drifts.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** 🔴 Every content grep runs over PARSER-STRIPPED source — #496's stripper is
 *  IMPORTED, not copied, wherever a suite needs one. This file needs only
 *  comment stripping, which is that stripper's own first step, spelled once. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
const code = (rel: string) => strip(read(rel));

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — a rating field renders, validates and exports as a NUMBER
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · a rating field renders, validates and exports as a NUMBER', () => {
  it('the builder offers both types, and the public form renders both', () => {
    const admin = code('src/components/AdminForms.tsx');
    expect(admin, 'the builder cannot create a rating').toMatch(/\{ type: 'rating', label: '[^']+' \}/);
    expect(admin, 'the builder cannot create a scale').toMatch(/\{ type: 'scale', label: '[^']+' \}/);
    const union = admin.match(/type FieldType = ([^;]+);/)![1];
    expect(union).toContain("'rating'");
    expect(union).toContain("'scale'");

    const pub = code('src/components/PublicForm.tsx');
    expect(pub, 'the public form has no branch for these types')
      .toContain("f.type === 'rating' || f.type === 'scale'");
    expect(pub, 'the public form renders something other than the shared control')
      .toContain('<RatingScaleInput');
  });

  it('a rating offers exactly five points, and a scale its declared run', () => {
    expect(pointsFor('rating')).toEqual([1, 2, 3, 4, 5]);
    expect(RATING_MIN).toBe(1);
    expect(RATING_MAX).toBe(5);
    // A rating IGNORES a range: five is the convention the stars encode.
    expect(pointsFor('rating', { min: 0, max: 9 })).toEqual([1, 2, 3, 4, 5]);
    expect(pointsFor('scale')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pointsFor('scale', { min: 0, max: 4 })).toEqual([0, 1, 2, 3, 4]);
  });

  it('validates: a value outside the run, or not a whole number, is not an answer', () => {
    expect(normaliseAnswer(3, 'rating')).toBe(3);
    expect(normaliseAnswer('3', 'rating')).toBe(3);
    expect(normaliseAnswer(6, 'rating'), 'a 6 was admitted on a 1-5 rating').toBeUndefined();
    expect(normaliseAnswer(2.5, 'rating'), 'a fraction was admitted').toBeUndefined();
    expect(normaliseAnswer('four', 'rating')).toBeUndefined();
    expect(normaliseAnswer(true, 'rating'), 'a boolean was admitted').toBeUndefined();
    expect(normaliseAnswer(11, 'scale'), 'an 11 was admitted on a 1-10 scale').toBeUndefined();
  });

  it('🔴 exports as a NUMBER, not a label', () => {
    expect(toCsvCell(4, 'rating')).toBe('4');
    expect(toCsvCell('4', 'rating')).toBe('4');
    expect(toCsvCell(7, 'scale')).toBe('7');
    // The cell is the numeral and nothing else — no star, no "of 5", no word.
    for (const v of [1, 2, 3, 4, 5]) {
      expect(toCsvCell(v, 'rating'), 'the cell is not a bare numeral').toMatch(/^\d+$/);
    }
  });

  it('🔴 a scale whose own run includes 0 keeps a CHOSEN 0 — it is a real answer', () => {
    // This is why "unanswered" is expressed as ABSENCE and not as the value 0:
    // the two are different facts and a sentinel cannot tell them apart.
    expect(normaliseAnswer(0, 'scale', { min: 0, max: 10 })).toBe(0);
    expect(toCsvCell(0, 'scale', { min: 0, max: 10 })).toBe('0');
    const agg = aggregateScale([0, 0, 10], 'scale', { min: 0, max: 10 });
    expect(agg.answered, 'a chosen 0 was dropped from the count').toBe(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — an unanswered rating exports EMPTY, never zero
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · an unanswered rating exports EMPTY, never zero', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['the empty string', ''],
    ['whitespace', '   '],
  ])('%s exports as the empty string', (_label, value) => {
    const cell = toCsvCell(value, 'rating');
    expect(cell, 'an unanswered rating exported as something').toBe('');
    expect(cell, 'an unanswered rating exported as a zero').not.toBe('0');
  });

  it('🔴 a 0 on a 1-5 RATING is not an answer at all — there is no zero star', () => {
    expect(normaliseAnswer(0, 'rating')).toBeUndefined();
    expect(toCsvCell(0, 'rating'), 'a zero rating reached the CSV').toBe('');
  });

  it('🔴 an unanswered rating is not counted, and does not drag the mean', () => {
    // Ten people, four answered, all of them 5. The mean is 5 — not 2.
    const values = [5, 5, 5, 5, undefined, undefined, null, '', undefined, undefined];
    const agg = aggregateScale(values, 'rating');
    expect(agg.answered, 'unanswered rows were counted as responses').toBe(4);
    expect(agg.mean, 'the unanswered rows dragged the mean down').toBe(5);
  });

  it('🔴 and with nobody answering the mean is ABSENT, not 0.0', () => {
    const agg = aggregateScale([undefined, null, ''], 'rating');
    expect(agg.answered).toBe(0);
    expect(agg.mean, 'an unanswered question reported an average of zero').toBeNull();
    // Every point still gets a row, and every percent is 0 rather than NaN.
    expect(agg.points).toHaveLength(5);
    expect(agg.points.every((p) => p.percent === 0)).toBe(true);
    expect(agg.points.some((p) => Number.isNaN(p.percent)), 'a percent came out NaN').toBe(false);
  });

  it('the summary counts the same way the export does', () => {
    const field: AnswerField = { id: 'q', type: 'rating', label: 'How was it', order: 0 };
    const subs = [
      { id: 'a', submittedAt: null, answers: { q: 5 } },
      { id: 'b', submittedAt: null, answers: { q: 4 } },
      { id: 'c', submittedAt: null, answers: {} },
      // 🔴 A row already in Firestore carrying a 0 — written by anything other
      // than this control. It must not be counted as a rating of zero.
      { id: 'd', submittedAt: null, answers: { q: 0 } },
    ];
    const out = summariseField(field, subs);
    if (out.kind !== 'scale') throw new Error('a rating question is not summarised as a scale');
    expect(out.answered, 'a stored 0 was counted as a rating').toBe(2);
    expect(out.aggregate.mean).toBe(4.5);
  });

  it('🔴 the public form REMOVES the key rather than storing undefined', () => {
    const pub = code('src/components/PublicForm.tsx');
    expect(pub, 'clearing a rating leaves a key behind').toContain('const { [id]: _dropped, ...rest } = a;');
    const control = code('src/components/forms/RatingScaleInput.tsx');
    expect(control, 'the control initialises to a number instead of undefined')
      .toContain('onChange(chosen === point ? undefined : point)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — rating and scale respect the Ministry-only gate
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · rating and scale respect the Ministry-only gate', () => {
  it('custom forms are a gated feature, and exactly ONE plan carries them', () => {
    const plans = read('src/utils/plan-features.ts');
    const flags = [...plans.matchAll(/customForms:\s*(true|false)/g)].map((m) => m[1]);
    expect(flags.length, 'the customForms flag left plan-features').toBeGreaterThan(1);
    expect(flags.filter((f) => f === 'true'), 'custom forms are no longer a single-plan feature')
      .toHaveLength(1);
    // The Ministry plan is the LAST of the four, and the only true.
    expect(flags[flags.length - 1]).toBe('true');
  });

  it('🔴 the builder lives ONLY inside the gated screen — no second mount point', () => {
    // The gate is at screen level: `AdminForms` is entitled by `customForms`.
    // So the guard that matters is that nothing else in the app mounts the
    // builder, which would be a path around the gate.
    const mounts: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const rel = path.relative(REPO_ROOT, p).split(path.sep).join('/');
        if (/\bfrom '.*AdminForms'/.test(strip(readFileSync(p, 'utf8')))) mounts.push(rel);
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(mounts.sort(), 'AdminForms is mounted somewhere new — check that surface is gated too')
      .toEqual(['src/components/AdminDashboard.tsx']);
  });

  it('⚠️ and a SIGNUP is on every plan — the public form carries no plan check', () => {
    // A respondent has no account and no plan; the public form must not gate.
    const pub = code('src/components/PublicForm.tsx');
    expect(pub, 'the public form reads a plan feature').not.toContain('customForms');
    expect(pub, 'the public form reads plan features at all').not.toContain('plan-features');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — the types are wired end to end, and no 44th primitive was installed
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · wired end to end, and the primitive inventory is untouched', () => {
  it('🔴 no 44th primitive — the control is a form field, not a ui/ primitive', () => {
    const ui = readdirSync(path.join(REPO_ROOT, 'src/components/ui')).filter((f) => /\.tsx?$/.test(f));
    expect(ui, 'a primitive was installed — THE-319 pins this inventory at 43 with no append path')
      .toHaveLength(43);
    expect(ui.some((f) => /^(rating|scale|accordion)\./.test(f)), 'a rating primitive was installed')
      .toBe(false);
  });

  it('and no dependency was added — THE-274 pins the lockfile to an exact length', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['lucide-react'], 'the control needs lucide, which must already be here')
      .toBeTruthy();
    const control = code('src/components/forms/RatingScaleInput.tsx');
    const imports = [...control.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => !i.startsWith('.') && i !== 'react' && i !== 'lucide-react'),
      'the control imports a package outside react and lucide-react').toEqual([]);
  });

  it('every field type has a treatment, and the two new ones share the scale treatment', () => {
    expect([...FIELD_TYPES_WITH_ANSWERS]).toContain('rating');
    expect([...FIELD_TYPES_WITH_ANSWERS]).toContain('scale');
    for (const t of FIELD_TYPES_WITH_ANSWERS) {
      expect(TREATMENT[t], `${t} has no treatment`).toBeTruthy();
    }
    expect(TREATMENT.rating).toBe('scale');
    expect(TREATMENT.scale).toBe('scale');
    // 🔴 `number` stays a LIST. It has no declared run, so a mean over it is
    // the meaningless figure form-answers.ts already argues against.
    expect(TREATMENT.number, 'number was given an average it cannot support').toBe('list');
  });

  it('🔴 the builder PREVIEWS the real control, not a drawing of it', () => {
    const admin = code('src/components/AdminForms.tsx');
    expect(admin, 'the builder has no preview').toContain('data-rating-scale-preview');
    expect(admin, 'the preview is not the shipped control').toContain('<RatingScaleInput');
    // A church setting a 1-10 scale must be shown numbers, not ten stars: the
    // preview is passed the field's own type and range.
    expect(admin).toMatch(/type=\{f\.type\}/);
    expect(admin).toMatch(/range=\{\{ min: f\.scaleMin, max: f\.scaleMax \}\}/);
  });

  it('a scale range is clamped, and an inverted one falls back rather than rendering nothing', () => {
    expect(clampRange({ min: 1, max: 10 })).toEqual({ min: 1, max: 10 });
    expect(clampRange({ min: -5, max: 99 })).toEqual({ min: SCALE_LIMIT_MIN, max: SCALE_LIMIT_MAX });
    expect(clampRange({ min: 9, max: 2 }), 'an inverted range rendered an empty control')
      .toEqual({ min: SCALE_DEFAULT_MIN, max: SCALE_DEFAULT_MAX });
    expect(clampRange(undefined)).toEqual({ min: SCALE_DEFAULT_MIN, max: SCALE_DEFAULT_MAX });
    expect(pointsFor('scale', { min: 9, max: 2 }).length).toBeGreaterThan(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — the tap-target classes are literal, and agree with the constants
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · the tap-target floor is spelled where Tailwind can see it', () => {
  it('🔴 the classes are LITERAL — an interpolated one is never generated', () => {
    // Tailwind's JIT scans for whole class names. `min-w-[${n}px]` is never
    // seen, the rule is never generated, and the target silently has no floor.
    expect(POINT_SIZE_CLASSES).toBe('min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px]');
    const control = code('src/components/forms/RatingScaleInput.tsx');
    expect(control, 'the control builds its size classes by interpolation')
      .not.toMatch(/min-[wh]-\[\$\{/);
  });

  it('🔴 and they agree with the numbers the guard measures', () => {
    expect(TAP_TARGET.belowSm).toBe(44);
    expect(TAP_TARGET.smAndUp).toBe(38);
    expect(POINT_SIZE_CLASSES).toContain(`min-w-[${TAP_TARGET.belowSm}px]`);
    expect(POINT_SIZE_CLASSES).toContain(`min-h-[${TAP_TARGET.belowSm}px]`);
    expect(POINT_SIZE_CLASSES).toContain(`sm:min-w-[${TAP_TARGET.smAndUp}px]`);
    expect(POINT_SIZE_CLASSES).toContain(`sm:min-h-[${TAP_TARGET.smAndUp}px]`);
  });

  it('the control wears them, and every point is a real button', () => {
    const control = code('src/components/forms/RatingScaleInput.tsx');
    expect(control).toContain('const POINT_SIZE = POINT_SIZE_CLASSES;');
    expect(control).toContain('${POINT_SIZE} ');
    expect(control, 'a point is not a button').toContain('type="button"');
    expect(control, 'the row is not a radiogroup').toContain('role="radiogroup"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — no colour hardcoded, no emoji, LF endings
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · house rules on the files this ticket adds', () => {
  const ADDED = [
    'src/components/forms/rating-scale.ts',
    'src/components/forms/RatingScaleInput.tsx',
  ];

  it.each(ADDED)('%s hardcodes no colour', (rel) => {
    const src = code(rel);
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], 'a hex colour is hardcoded').toEqual([]);
    expect(src.match(/\b(rgb|rgba|hsl|hsla)\(/g) ?? [], 'a literal colour function').toEqual([]);
    // No raw Tailwind palette step either — the repo paints in tokens.
    expect(src.match(/\b(?:bg|text|border)-(?:red|blue|green|stone|zinc|amber)-\d{2,3}\b/g) ?? [],
      'a raw Tailwind palette step').toEqual([]);
  });

  it.each(ADDED)('%s renders no emoji', (rel) => {
    // U+FE0F stripped, not matched — matching it splits every marker in two.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu;
    const src = code(rel).replace(/️/g, '');
    expect(src.match(EMOJI) ?? [], `${rel} renders an emoji — lucide-react is imported`).toEqual([]);
  });

  it.each(ADDED)('%s is written LF, not CRLF', (rel) => {
    expect(read(rel).includes('\r'), `${rel} carries a CR`).toBe(false);
  });
});
