/**
 * THE-319 — the two files that were hand-rolled instead of composed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, AND WHY NO EXISTING GUARD CAUGHT IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Six files shipped roughly two thousand lines of hand-written markup because
 * every ticket that built them said "no new component — all 29 primitives are
 * installed", and that was read as "do not install anything". So the markup was
 * written by hand instead of composed out of what was already there.
 *
 * ⚠️ THE TOKEN GUARDS COULD NOT HAVE CAUGHT THIS, and that is the point of this
 * file. `theming-gaps`, `theming-shadcn-tokens` and THE-294's audit all ask
 * whether a class RESOLVES. Hand-written Tailwind resolves perfectly well:
 * `rounded-lg border bg-card p-4` is a correct, on-palette, fully themed way of
 * spelling `card`. Nothing was broken. It was a reimplementation of something
 * that already existed, and only a guard that asks "is the PRIMITIVE here" can
 * see it.
 *
 * 🔴 THIS TICKET OWNS EXACTLY TWO OF THE SIX. The other four —
 * `AdminSms.tsx`, `settings/SmsSection.tsx`, `events/ServicePlanPanel.tsx` and
 * `events/ServicePlanRow.tsx` — belong to THE-316, THE-317 and THE-318, are not
 * opened here, and section 7 pins them byte-identical so that they cannot be.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE SAFETY PROPERTY: THIS IS A COMPOSITION CHANGE AND NOTHING ELSE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No figure, no word of copy and no measured value moves. That was verified in
 * Chromium at 380 / 768 / 1024 / 1280 / 1440 before it was written down here:
 * every visible box, the page's own `scrollWidth`, every cell fill, every bar
 * width and every string on both screens is identical to what `main` renders.
 * The suites that hold that ground are THE-299's and THE-298's own layout
 * suites, which are untouched by this ticket and still pass. What this file
 * adds is the claim they cannot make — that the markup is COMPOSED.
 *
 * ⚠️ NOTHING HERE ASSERTS ANYTHING ABOUT THE CURRENT BRANCH'S DIFF, in either
 * direction. THE-315 (#454) is a standing sweep for exactly that shape after
 * four such guards blocked every unrelated PR in this repo, and every claim
 * below is about file CONTENT at whatever ref it is run against.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  loadOwnership,
  ownershipFailure,
  recordedFiles,
} from './__fixtures__/ownership-register';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');

/** Comments stripped, so a class name discussed in prose is not read as code. */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HEATMAP = 'src/components/dashboard/RetentionHeatmap.tsx';
const ANSWERS = 'src/components/forms/FormAnswersView.tsx';
const OWNED = [HEATMAP, ANSWERS] as const;

/* ═══ 1 · Both files import primitives, NAMED PER FILE ═════════════════════ */

/**
 * 🔴 The premise, and it was verified before anything was built: on `main` both
 * files import react, lucide and this repo, and NOTHING from `@/components/ui`.
 *
 * ⚠️ The heatmap's FRAME was never the hand-rolled part, and this list is small
 * because of it. `card`, `skeleton`, `empty` and `spinner` are already composed
 * for it by `WidgetFrame`, which is where THE-276 deliberately put the three
 * widget states so that no widget could forget to have one. Re-importing `card`
 * here would have meant a second card inside the first.
 */
const ADOPTED: Record<string, readonly string[]> = {
  [HEATMAP]: ['table'],
  [ANSWERS]: ['progress'],
};

describe('both files import primitives from @/components/ui', () => {
  it.each(Object.entries(ADOPTED))('%s imports exactly %s', (file, primitives) => {
    const code = codeOf(file);
    const found = [...code.matchAll(/from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\/([\w-]+)['"]/g)]
      .map((m) => m[1])
      .sort();
    expect(found, `${file} composes nothing`).not.toEqual([]);
    expect(found).toEqual([...primitives].sort());
  });

  /**
   * ⚠️ And the heatmap reaches its card, skeleton and empty state THROUGH the
   * frame rather than around it — the reason `card` is not on its list above.
   */
  it('the heatmap still gets card, skeleton and empty from WidgetFrame', () => {
    expect(codeOf(HEATMAP)).toMatch(/from '\.\/WidgetFrame'/);
    const frame = codeOf('src/components/dashboard/WidgetFrame.tsx');
    for (const primitive of ['card', 'empty', 'skeleton', 'spinner']) {
      expect(frame, `WidgetFrame stopped composing ${primitive}`)
        .toMatch(new RegExp(`from '\\.\\./ui/${primitive}'`));
    }
  });
});

/* ═══ 1b · Every element that HAS a primitive USES it ══════════════════════ */

/**
 * 🔴 THE ASSERTION THAT HAD TO BITE, and the one an import count cannot make.
 *
 * An import list proves a primitive is in the file. It does not prove the
 * markup uses it — a file can import `Table` and still hand-write a `<table>`
 * three lines below. So each pair below names a hand-written SUBSTITUTE and the
 * primitive that replaces it, and fails on the substitute's presence. Swap any
 * composed element back for equivalent markup and one of these goes red.
 *
 * ⚠️ These are matched against CODE WITH COMMENTS STRIPPED. Both files discuss
 * the markup they no longer contain at length, and prose is not markup.
 */
const SUBSTITUTES: ReadonlyArray<{
  readonly file: string;
  readonly what: string;
  readonly primitive: string;
  readonly handWritten: RegExp;
  readonly composed: readonly RegExp[];
}> = [
  {
    file: HEATMAP,
    what: 'the screen-reader data table',
    primitive: 'table',
    // A bare JSX `<table>`/`<thead>`/`<tbody>`/`<th>`/`<td>` is the substitute.
    handWritten: /<\/?(?:table|thead|tbody|tfoot|th|td)[\s>/]/,
    composed: [/<Table[\s>]/, /<TableHeader[\s>]/, /<TableBody[\s>]/, /<TableRow[\s>]/, /<TableHead[\s>]/, /<TableCell[\s>]/, /<TableCaption[\s>]/],
  },
  {
    file: ANSWERS,
    what: 'the per-option proportion bar',
    primitive: 'progress',
    // A track `div` with a nested fill whose width is an inline style.
    handWritten: /rounded-full bg-surface-sunken|style=\{\{\s*width/,
    composed: [/<Progress[\s>]/, /\bvalue=\{barValue\(/],
  },
];

describe('every element that has a primitive uses it', () => {
  it.each(SUBSTITUTES)('$file composes $what with `$primitive`', ({ file, primitive, handWritten, composed }) => {
    const code = codeOf(file);
    expect(code, `${file} hand-writes what \`${primitive}\` already is`).not.toMatch(handWritten);
    for (const shape of composed) {
      expect(code, `${file} imports \`${primitive}\` but does not render it (${shape})`).toMatch(shape);
    }
  });

  /**
   * 🔵 What is deliberately NOT composed, recorded so the decision is visible
   * rather than being an omission somebody has to guess at. Each entry names
   * the primitive that was rejected and why, and asserts the rejection still
   * holds — so "we meant to" cannot quietly become "we did".
   */
  const REJECTED = [
    {
      file: HEATMAP,
      element: 'the visible cohort grid',
      rejected: 'chart',
      why: 'recharts has no heatmap and renders NOTHING under happy-dom, so every cell number would stop being assertable',
      stillRefused: /from ['"][^'"]*\/ui\/chart['"]/,
    },
    {
      file: HEATMAP,
      element: 'the visible cohort grid',
      rejected: 'table',
      why: 'a matrix of coloured cells is not a grid of values in columns; the accessible TABLE beside it is, and that one IS composed',
      stillRefused: /<Table[^>]*data-retention-grid/,
    },
    {
      file: HEATMAP,
      element: 'the band legend',
      rejected: 'badge',
      why: '`badge` is a filled pill at h-5 with its own padding and radius; the legend entries are a swatch and a word on a bare wrapping row, and pills would change the measured legend geometry',
      stillRefused: /from ['"][^'"]*\/ui\/badge['"]/,
    },
    {
      file: HEATMAP,
      element: "the summary row's rule",
      rejected: 'separator',
      why: 'it is an SVG `<line>` inside the grid\'s own coordinate system, and `separator` renders a `div`, which cannot live there',
      stillRefused: /from ['"][^'"]*\/ui\/separator['"]/,
    },
    {
      file: ANSWERS,
      element: 'the per-question card',
      rejected: 'card',
      why: '`ui/card` is on the shadcn token layer (bg-card, ring-foreground/10, --radius-xl) and this screen is on the app\'s brand surface layer (bg-surface-raised, border-line, --radius-brand-xl at 24px). tailwind-merge cannot resolve `rounded-xl` against `rounded-brand-xl`, so a composed card would ship two competing radii and its corners would be decided by stylesheet order — a paint change, which this ticket may not make',
      stillRefused: /from ['"][^'"]*\/ui\/card['"]/,
    },
    {
      file: ANSWERS,
      element: 'the no-answers state',
      rejected: 'empty',
      why: '`Empty` is p-6/md:p-12 with an `EmptyMedia` chip; this state is py-16 with a bare 40px glyph at 30% opacity, so composing it would move a measured value and change what is drawn',
      stillRefused: /from ['"][^'"]*\/ui\/empty['"]/,
    },
    {
      file: ANSWERS,
      element: 'the free-text answer rows',
      rejected: 'item',
      why: '`Item` is a bordered w-full row at text-sm/px-3/py-2.5; these are text-[13px]/px-2 on a sunken fill with no border, so composing it would move both the height and the paint',
      stillRefused: /from ['"][^'"]*\/ui\/item['"]/,
    },
  ] as const;

  it.each(REJECTED)('$file leaves $element hand-written, having rejected `$rejected`', ({ file, stillRefused, why }) => {
    expect(why.length, 'a rejection with no reason is not an answer').toBeGreaterThan(40);
    expect(codeOf(file)).not.toMatch(stillRefused);
  });
});

/* ═══ 1c · Inline styles are zero ═════════════════════════════════════════ */

/**
 * 🔴 The dashboard's inline-style count is zero and stays zero, and THE-319
 * takes the answers view to zero with it. `FormAnswersView` carried exactly one
 * — the option bar's width — and `progress` owns that width now.
 *
 * ⚠️ Against CODE, not source. Both files SPELL `style={{ … }}` in prose while
 * explaining the count, and a comment is not an inline style.
 */
describe('inline styles are zero in both files', () => {
  it.each(OWNED)('%s spells no style prop', (file) => {
    expect([...codeOf(file).matchAll(/style=\{\{/g)].length).toBe(0);
  });
});

/* ═══ 2 · No figure, no copy ══════════════════════════════════════════════ */

/**
 * 🔴 THE WHOLE SAFETY PROPERTY, as literals rather than as a shape.
 *
 * Every user-visible string and every number-bearing expression either file
 * renders, pinned. A composition change may not touch one of these, so a
 * reworded sentence or a changed denominator fails here rather than being
 * noticed by a founder.
 */
const COPY: Record<string, readonly string[]> = {
  [HEATMAP]: [
    'Retention cohorts',
    'Of the members who joined in a month, the share with a recorded CRM activity in each later month.',
    'Activity means a check-in, form, registration, gift or logged note — this app records nothing else about a member\'s presence.',
    'Retention by join month, as counts and shares.',
    'Blank: that month has not finished.',
    'not yet observed',
    '`Month ${col}`',
    '`M${col}`',
    '>Joined<',
    '>Members<',
    'All cohorts',
    'members joined inside this ${RETENTION_MONTHS}-month window and are in the grid.',
    'joined earlier,',
    'joined during the month still in progress, and',
    'carry no readable join date; all are counted here and placed in no row.',
    'activities read,',
    'belong to a member,',
    'to a contact who is not one, and',
    'could not be placed.',
  ],
  [ANSWERS]: [
    'This question declares no options and nobody has answered it.',
    '(no longer offered)',
    'No answers yet.',
    'Showing the first {shown.length.toLocaleString()} of',
    'answers. The full set is in the CSV export.',
    'This question collects contact details that identify the person answering, so',
    'the answers are counted here rather than summarised. Open the responses table',
    'or export the CSV to read them.',
    'No answers yet',
    'Partial summary. This form has {total.toLocaleString()} responses and the',
    'figures below count the {counted.toLocaleString()} that could be read in',
    'one go. Export the CSV for the complete set.',
    'This form has no questions.',
    'choose any, so shares can total over 100%',
    'choose one',
    'listed in full',
    'counted only',
  ],
};

/** The figures — every literal number and every expression that computes one. */
const FIGURES: Record<string, readonly string[]> = {
  [HEATMAP]: [
    'const LABEL_W = 88;', 'const SIZE_W = 52;', 'const HEAD_H = 24;',
    'const ROW_H = 28;', 'const COL_W = 42;', 'const GAP = 2;',
    'LABEL_W + SIZE_W + col * COL_W', 'LABEL_W + SIZE_W + RETENTION_MONTHS * COL_W',
    'export const BAND_MIX = [0, 12, 24, 36, 48, 60] as const;',
    'if (share <= 0) return 0;', 'if (share <= 20) return 1;', 'if (share <= 40) return 2;',
    'if (share <= 60) return 3;', 'if (share <= 80) return 4;', 'return 5;',
    '`${Math.round(share)}%`', 'n.toLocaleString()',
    'HEAD_H + (rows.length + 1) * ROW_H + 6', 'HEAD_H + rows.length * ROW_H',
  ],
  [ANSWERS]: [
    'export const LIST_RENDER_LIMIT = 200;',
    'summary.values.slice(0, LIST_RENDER_LIMIT)',
    'Math.max(0, Math.min(100, percent))',
    '{option.count} · {Math.round(option.percent)}%',
    'summary.answered === 1',
    "total === 1 ? 'response' : 'responses'",
  ],
};

describe('no figure and no word of copy changed', () => {
  it.each(Object.entries(COPY))('%s keeps every string it renders', (file, strings) => {
    const src = read(file);
    for (const s of strings) expect(src, `${file} lost: ${s}`).toContain(s);
  });

  it.each(Object.entries(FIGURES))('%s keeps every figure it computes', (file, figures) => {
    const code = codeOf(file);
    for (const f of figures) expect(code, `${file} lost the figure: ${f}`).toContain(f);
  });
});

/* ═══ 3 · The colour scale, untouched ═════════════════════════════════════ */

/**
 * 🔴 THE-299's scale is the one thing composition could most easily have cost,
 * and it is byte-pinned here rather than described. Six static classes, one hue,
 * `--muted` written FIRST so a browser without `color-mix` degrades to a flat
 * grid with legible numbers instead of 2.27:1 blue, and capped at 60% — where
 * the worst of the twenty-four measured ratios is 4.94:1 (Classic dark) and 65%
 * would fall to 4.42:1.
 *
 * ⚠️ The twenty-four ratios themselves are recomputed from globals.css in
 * `the-299-retention-guards.test.ts`, which this ticket does not weaken. What is
 * asserted here is that the INPUT to that computation is the same table.
 */
describe("the heatmap's colour scale is unchanged", () => {
  const BANDS = [100, 88, 76, 64, 52, 40] as const;

  it('is the same six track-first mixes, capped at 60% of --chart-2', () => {
    const code = codeOf(HEATMAP);
    BANDS.forEach((track, i) => {
      const expected = `'fill-[color-mix(in_srgb,var(--muted)_${track}%,var(--chart-2))]'`;
      expect(code, `band ${i} moved`).toContain(expected);
    });
    // 🔴 Track-first, every one of them. `--chart-2` first is the failure mode.
    expect(code).not.toMatch(/color-mix\(in_srgb,var\(--chart-2\)/);
    // 🔴 And the cap holds: 40% muted is 60% chart-2, and nothing goes past it.
    expect(Math.min(...BANDS), 'the 60% cap was raised').toBe(40);
    expect(code).not.toMatch(/var\(--muted\)_(?:3[0-9]|2[0-9]|1?[0-9])%/);
  });

  it('still writes ONE ink for the whole ramp, with no flip at the dark end', () => {
    const code = codeOf(HEATMAP);
    expect(code).toContain('text-strong');
    // The upstream `onFillClass` flip is what the single ink replaced.
    expect(code).not.toMatch(/onFillClass|fill-white|text-white/);
  });

  it('and the guard that recomputes all 24 ratios is still in the tree, unweakened', () => {
    const guard = read('src/__tests__/the-299-retention-guards.test.ts');
    expect(guard).toContain('BAND_MIX');
    expect(guard).toMatch(/4\.5/);
  });
});

/* ═══ 4 · The sr-only wrapper ═════════════════════════════════════════════ */

/**
 * 🔴 THE PAGE-SCROLL DEFECT, and the reason adopting `table` here was safe.
 *
 * `overflow` does not clip a `display: table` element the way it clips a block,
 * so `sr-only` on the `<table>` itself let a fourteen-column table render at its
 * full intrinsic width, invisible, and pushed `documentElement.scrollWidth` to
 * 1,474px on a 380px viewport. THE-299 fixed it by putting `sr-only` on a
 * WRAPPER div.
 *
 * ⚠️ The primitive makes this strictly safer rather than risking it: `Table`
 * renders its own container `div` around the `<table>`, so the `display: table`
 * element is no longer the wrapper's direct child at all. Measured: at every one
 * of the five viewports `documentElement.scrollWidth` is identical to `main`.
 */
describe('the sr-only table is still wrapped', () => {
  it('sr-only is on a wrapper div, never on the table itself', () => {
    const code = codeOf(HEATMAP);
    expect(code, 'the wrapper is gone — this is the 1,474px page-scroll defect')
      .toMatch(/<div className="sr-only">/);
    expect(code, 'sr-only moved onto the table').not.toMatch(/<Table[^>]*sr-only/);
    expect(code).not.toMatch(/<table[^>]*sr-only/);
  });

  it('and the primitive puts its own container between them', () => {
    expect(read('src/components/ui/table.tsx')).toContain('data-slot="table-container"');
  });
});

/* ═══ 5-6 · No-regressions this ticket must not have cost ═════════════════ */

describe('the heatmap still refuses, and still names nobody', () => {
  /**
   * Three collections are count-gated and the grid refuses ENTIRELY, naming
   * which one bound. The fixtures that drive it to 1,000 (draws) and 1,001
   * (refuses) are `the-299-retention-tab.test.tsx`'s and are untouched here.
   */
  it('all three ceilings still have their own wording', () => {
    const data = read('src/components/dashboard/retention-data.ts');
    for (const reason of ['activityCeiling', 'contactCeiling', 'memberCeiling']) {
      expect(data, `${reason} is gone`).toContain(`${reason}:`);
    }
    const tab = read('src/components/__tests__/the-299-retention-tab.test.tsx');
    expect(tab, 'the ceiling fixtures left the tree').toMatch(/toHaveLength\(1000\)/);
  });

  it('and refusal is still the frame\'s single branch, not a widget-local empty', () => {
    const code = codeOf(HEATMAP);
    expect(code).toMatch(/kind: 'unavailable'/);
    // 🔴 `== null`, not `=== null`. An omitted grid is `undefined` through every
    // fixture in this repo, and under `===` it would land in `ready` with no
    // grid — a widget in its READY state rendering nothing at all.
    expect(code).toMatch(/grid == null/);
    expect(code).not.toMatch(/grid === null/);
  });

  /**
   * 🔴 THE-283 made "never name an individual" a property of the TYPE, and the
   * type is what is asserted. A row carries a month key, a month label and
   * counts, and there is no field a name could arrive in.
   */
  it('no individual is named, and the type is still what makes that true', () => {
    const rows = read('src/components/dashboard/retention-data.ts');
    const cohort = rows.slice(rows.indexOf('export interface CohortRow'), rows.indexOf('export interface RetentionGrid'));
    expect(cohort).not.toMatch(/\b(name|email|phone|displayName|firstName|lastName|memberId|contactId)\b/);
    const code = codeOf(HEATMAP);
    expect(code).not.toMatch(/\b(?:member|contact)\.(?:name|email|phone)\b/);
    expect(code).not.toMatch(/data-retention-(?:member|person|name)/);
  });
});

/* ═══ 7-9 · FormAnswersView's decisions, all kept ═════════════════════════ */

describe("THE-298's decisions all survive the composition", () => {
  it('per-question aggregates are still keyed to the form\'s own fields', () => {
    const code = codeOf(ANSWERS);
    expect(code).toMatch(/summary\.field\.id/);
    expect(code).toMatch(/summary\.field\.label/);
    expect(code).toMatch(/data-question=\{summary\.field\.id\}/);
    // Choice gets counts per option; number and date are LISTED, never averaged.
    expect(code).toMatch(/summary\.kind === 'choice'/);
    expect(code).not.toMatch(/\bmean\b|\baverage\b|reduce\(\(.*\).*\/\s*length/);
  });

  it('email and phone are still counted only', () => {
    const code = codeOf(ANSWERS);
    expect(code).toMatch(/data-private-note/);
    expect(read('src/components/forms/form-answers.ts')).toContain('PRIVATE_TYPES');
    // No bar and no list is reachable from the private branch.
    const priv = code.slice(code.indexOf('const PrivateBody'), code.indexOf('const NOTE'));
    expect(priv).not.toMatch(/data-option-bar|data-answer-list|Progress/);
  });

  it('the 200-row cap is still a RENDER cap and still says so', () => {
    const src = read(ANSWERS);
    expect(src).toContain('export const LIST_RENDER_LIMIT = 200;');
    expect(src).toContain('data-list-render-cap');
    expect(src).toContain('Showing the first {shown.length.toLocaleString()} of');
    // 🔴 The counts are over the COMPLETE read; only the <li> count is capped.
    expect(codeOf(ANSWERS)).toMatch(/summary\.values\.length > shown\.length/);
  });

  /**
   * 🔴 `AdminSecondaryButton` measured 41.5px and THE-298 lifted its own control
   * with `min-h-[44px] sm:min-h-0` rather than changing the primitive. Both
   * halves still hold: the primitive is byte-identical, and the lift is still
   * the call site's.
   */
  it('AdminSecondaryButton itself is unchanged, and the lift is still at the call site', () => {
    /** ⚠️ A SET, for THE-276's reason: CI runs against `refs/pull/N/merge`, so a
     *  value another ticket legitimately lands on `main` differs from this
     *  branch's. A value that is NEITHER — this ticket editing it — still fails. */
    const ADMIN_UI = [
      ['2e9ad4cb44b5638421cb085777e2be4f7957d4d850ef3d4a6ce62b1d9fbcda96', 'main at 0de1e2e — the value THE-190 and THE-298 both leave'],
    ] as const;
    const actual = sha256(readFileSync(path.join(REPO_ROOT, 'src/components/admin/AdminUI.tsx')));
    expect(
      ADMIN_UI.find(([digest]) => digest === actual),
      `AdminUI.tsx is at ${actual}, which is none of:\n  ` +
        ADMIN_UI.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
    const layout = read('src/components/__tests__/THE-298.form-answers-layout.test.tsx');
    expect(layout).toContain("const ANSWERS_ACTION_CLASS = 'min-h-[44px] sm:min-h-0'");
    // And this ticket did not reach into the admin layer to "fix" 41.5px.
    expect(read('src/components/admin/AdminUI.tsx')).not.toContain('THE-319');
  });
});

/* ═══ 10 · chart gains no adopter ═════════════════════════════════════════ */

/**
 * 🔴 RE-EXAMINED RATHER THAN INHERITED. THE-298's reason 3 decides it again:
 * recharts renders NOTHING under happy-dom, and the per-question counts are the
 * whole point of that screen, so they have to be assertable in the DOM the suite
 * actually renders. `chart` keeps exactly its four adopters.
 */
describe('chart is still adopted by nothing new', () => {
  it('neither owned file imports it, and the closed list still names four', () => {
    for (const file of OWNED) expect(codeOf(file)).not.toMatch(/\/ui\/chart['"]/);
    const guard = read('src/__tests__/the-272-shadcn-batch-b.test.ts');
    expect(guard).toContain('THE_276_CHART_ADOPTERS');
    const list = guard.slice(guard.indexOf('const THE_276_CHART_ADOPTERS'));
    expect(list.slice(0, list.indexOf('] as const')).match(/'src\//g)).toHaveLength(4);
  });

  /** 🔴 And BOTH adoptions this ticket does make are recorded there, by ticket. */
  it('THE-319\'s two adoptions are recorded in THE-272\'s guard', () => {
    const guard = read('src/__tests__/the-272-shadcn-batch-b.test.ts');
    expect(guard).toContain('THE_319_TABLE_ADOPTERS');
    expect(guard).toContain('THE_319_PROGRESS_ADOPTERS');
    expect(guard).toContain(HEATMAP);
    expect(guard).toContain(ANSWERS);
    // Appended, never substituted: every earlier ticket's list is still there.
    for (const earlier of [
      'THE_276_CHART_ADOPTERS', 'THE_283_TABLE_ADOPTERS',
      'THE_290_TABLE_ADOPTERS', 'THE_290_PROGRESS_ADOPTERS', 'THE_294_TABLE_ADOPTERS',
    ]) expect(guard, `${earlier} was replaced rather than appended to`).toContain(earlier);
    // 🔴 And `pagination` is STILL adopted by nothing.
    expect(guard).toMatch(/for \(const name of \['pagination'\]\)/);
  });
});

/* ═══ 12-13 · No new token, dependency, colour or emoji ═══════════════════ */

describe('nothing was minted, added or hardcoded', () => {
  /**
   * ⚠️ The bridge has held with ZERO additions through #410, #416, #417 and
   * #419. These two digests are this ticket's share of keeping it that way.
   */
  it('package.json and package-lock.json carry no edit from this ticket', () => {
    const guard = read('src/__tests__/the-299-retention-guards.test.ts');
    for (const file of ['package.json', 'package-lock.json']) {
      const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
      expect(guard, `${file} moved — this ticket added a dependency`).toContain(actual);
    }
  });

  it('no colour is hardcoded and no emoji is rendered', () => {
    for (const file of OWNED) {
      const code = codeOf(file);
      expect(code, `${file} hardcodes a hex`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, `${file} hardcodes rgb/hsl/oklch`).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
      // 🔴 Emoji in RENDERED text. The docblocks above use them as markers and
      // are stripped before this runs, which is why `codeOf` is what is scanned.
      expect(code, `${file} renders an emoji`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  /**
   * 🔴 Four palettes ship and Classic is the DEFAULT since #409, so a token
   * that resolves in one and not the others is the failure. Both files spell
   * only tokens the config or globals already declare.
   */
  it('every colour-bearing class both files spell already resolves', () => {
    const css = read('src/app/globals.css');
    const config = read('tailwind.config.ts');
    /** ⚠️ `text-`/`border-` are two families in one prefix. `text-sm` is a SIZE
     *  and `border-t` is a SIDE, and neither resolves to a colour, so the
     *  non-colour spellings are named here rather than being silently skipped
     *  by a looser regex. */
    const NOT_A_COLOUR = new Set([
      'text-sm', 'text-xs', 'text-center', 'border-t', 'border-t-transparent', 'fill-current',
    ]);
    const spelled = new Set<string>();
    for (const file of OWNED) {
      for (const m of codeOf(file).matchAll(/\b(?:bg|text|fill|stroke|border)-((?!\[)[a-z][\w-]*)/g)) {
        if (NOT_A_COLOUR.has(m[0])) continue;
        spelled.add(m[1]);
      }
    }
    expect(spelled.size).toBeGreaterThan(4);
    for (const token of spelled) {
      const root = token.split('-')[0];
      expect(`${config}${css}`, `${token} resolves to nothing in any palette`).toContain(root);
    }
    // Classic first, and still the default.
    expect(css).toContain('[data-palette="classic"]');
    expect(read('src/__tests__/the-265-classic-default.test.ts')).toBeTruthy();
  });

  it('no sm:-gated size is minted outside form-layout', () => {
    for (const file of OWNED) {
      const minted = [...codeOf(file).matchAll(/sm:(?:max-w|w|h|gap|space-[xy]|p[xytblr]?|m[xytblr]?)-\[[^\]]+\]/g)];
      expect(minted.map((m) => m[0]), `${file} writes its own sm: size`).toEqual([]);
    }
  });
});

/* ═══ 11 · Tap targets ════════════════════════════════════════════════════ */

/**
 * 🔴 Every tappable target is >= 44px below `sm`; above `sm`, Rule 4 fixes a
 * control at 38px and a test asserts `DENSITY_PX.control < 44` DELIBERATELY.
 *
 * ⚠️ Neither owned file renders a control at all — the heatmap has no
 * interactive element and the answers view's only button is the shell's,
 * measured in THE-298's layout suite. So the claim here is that the rule is
 * intact and that this ticket introduced no control that would have to meet it.
 */
describe('the tap-target rule is intact and this ticket added no control', () => {
  it('neither file renders a button, link or input', () => {
    for (const file of OWNED) {
      expect(codeOf(file), `${file} grew a control`).not.toMatch(/<(?:button|a|input|select|textarea)[\s>]/i);
      expect(codeOf(file), `${file} composes an interactive primitive`)
        .not.toMatch(/\/ui\/(?:button|input|select|switch|checkbox|toggle|dialog|sheet|popover|dropdown-menu)['"]/);
    }
  });

  it('and Rule 4 still fixes a control at 38px above sm, on purpose', () => {
    const layout = read('src/components/layout/form-layout.ts');
    expect(layout).toMatch(/38/);
    expect(read('src/components/__tests__/THE-298.form-answers-layout.test.tsx'))
      .toMatch(/DENSITY_PX\.control/);
  });
});

/* ═══ 14 · The four files this ticket does NOT own ════════════════════════ */

/**
 * 🔴 Four more files carry the same defect and belong to THE-316, THE-317 and
 * THE-318. They are pinned byte-identical here so that "helpfully" fixing one
 * fails in this PR rather than in theirs.
 *
 * ⚠️ A SET per file, not a single digest, for THE-276's reason: CI runs against
 * `refs/pull/N/merge`, so a file a parallel ticket legitimately lands on `main`
 * holds a different value there than on this branch. A value that is NEITHER —
 * i.e. THIS ticket editing it — still fails, which is the whole threat.
 */
/**
 * 🔴 THE ENTRIES MOVED, NOT THE CLAIM. THE-322 lifted this map out of this file
 * and into one JSON record PER TICKET under
 * `src/__tests__/__fixtures__/ownership/`, unioned at run time by
 * `ownership-register.ts`. Every digest that was written out here is there,
 * byte for byte, carrying the ticket that recorded it and the reason it gives.
 *
 * ⚠️ WHY. This literal was SHARED: every PR that composed a component appended
 * to it, so THE-317, THE-320 and THE-321 conflicted on this one file in
 * sequence and each rebase created the next — four rebases for four PRs that
 * touched entirely different source files. A ticket now adds its own file and
 * conflicts with nobody.
 *
 * 🔴 THE PROTECTION IS UNCHANGED. A SET per file, for THE-276's reason: CI runs
 * against `refs/pull/N/merge`, so a file a parallel ticket legitimately lands on
 * `main` holds a different value there than on this branch. A value that is
 * NEITHER — i.e. THIS ticket editing it — still fails, which is the whole
 * threat. A file no ticket has recorded at all fails too, so a deleted record
 * cannot pass as an exemption.
 *
 * ⚠️ Recorded by CONTENT, never by asking git what this branch changed.
 */
/**
 * 🔴 THE FOUR FILES THIS TICKET DOES NOT OWN, NAMED — not "whatever the register
 * currently contains".
 *
 * ⚠️ AMENDED BY THE-326, AND THIS IS A BUG FIX IN THE GUARD RATHER THAN A
 * RELAXATION. This was `recordedFiles()`, the whole union, asserted to EQUAL
 * THE-319's four and the union to hold exactly seven entries. That was true for
 * exactly one PR — the migration's — and from the next ticket onward it says the
 * opposite of what `ownership-register.ts` was built for: "A new ticket adds
 * `__fixtures__/ownership/THE-nnn.json` and edits nothing that already exists."
 * As written it failed on any ticket recording any file, which is a guard that
 * blocks every unrelated PR — the shape #454 sweeps for.
 *
 * 🔴 THE CLAIM IS NOT WEAKENED, IT IS AIMED. What THE-319 must prove is that
 * ITS four files are still recorded and still unedited by it. Both halves are
 * below, and both are stricter for being named: a file dropped from the register
 * now fails on the name rather than on a count, and `ownershipFailure` still
 * fails on any digest the union does not accept — including a deleted record,
 * which cannot pass as an exemption.
 */
const NOT_OURS = [
  'src/components/AdminSms.tsx',
  'src/components/events/ServicePlanPanel.tsx',
  'src/components/events/ServicePlanRow.tsx',
  'src/components/settings/SmsSection.tsx',
];

describe('the four files this ticket does not own are byte-identical', () => {
  /** 🔴 The set did not shrink in the move, nor since: THE-319 recorded four
   *  files and the union still names every one of them. */
  it('the register still names all four of THE-319\'s files', () => {
    const recorded = recordedFiles();
    for (const file of NOT_OURS) {
      expect(recorded, `${file} is recorded by no ticket — a deleted record is not an exemption`)
        .toContain(file);
    }
    // And THE-319's own seven migrated entries are all still in the union.
    const mine = loadOwnership().filter((e) => NOT_OURS.includes(e.file));
    expect(mine.length, 'an accepted digest for one of THE-319\'s files was dropped')
      .toBeGreaterThanOrEqual(7);
  });

  it.each(NOT_OURS)('%s carries no edit from THE-319', (file) => {
    expect(ownershipFailure(file)).toBeNull();
  });

  /** 🔴 And this ticket left no trace in any of them. */
  it.each(NOT_OURS)('%s does not mention THE-319', (file) => {
    expect(read(file)).not.toContain('THE-319');
  });
});

/* ═══ 15 · This PR asserts nothing about its own diff ═════════════════════ */

/**
 * 🔴 Four guards of this shape have blocked every unrelated PR in this repo,
 * and THE-315 (#454) is the standing sweep that will catch a fifth. This file
 * is gated on nothing: it reads file CONTENT and never asks git a question.
 */
describe('no guard in this PR asserts anything about the current branch\'s diff', () => {
  it.each(['src/__tests__/THE-319.composition-guards.test.ts', 'src/components/__tests__/THE-319.composed-render.test.tsx'])(
    '%s shells out to no git and reads no diff',
    (file) => {
      const src = read(file);
      /* ⚠️ THE NEEDLES ARE ASSEMBLED, not written out. This assertion is made
         against its own file too, and a guard that fails merely because it
         SPELLS the thing it forbids is a guard nobody can write. */
      const banned = [
        'exec' + 'Sync(', 'spawn' + 'Sync(', 'node:child' + '_process',
        'gi' + 't diff', 'gi' + 't show', 'gi' + 't log', 'gi' + 't rev-parse', 'gi' + 't merge-base',
        'BASE' + '_REF',
      ];
      for (const needle of banned) {
        expect(src, `${file} reaches for \`${needle}\` — a guard that reads its own diff expires when it merges`)
          .not.toContain(needle);
      }
    },
  );

  it('and THE-315\'s standing sweep is still in the tree to catch a fifth', () => {
    expect(read('src/__tests__/THE-315.branch-diff-guards.test.ts')).toBeTruthy();
  });
});

/* ═══ 16 · The files this ticket may not open ═════════════════════════════ */

describe('AdminDashboard.tsx, layout.tsx, firestore and functions/ are byte-identical', () => {
  /**
   * 🔴 THE-325 · firestore.rules LEFT THIS DEFERRAL, and the claim is unchanged.
   * THE-319 pinned it by asserting the-299's guard file spelled the live digest;
   * that guard no longer spells one, because THE-325 moved the accepted SET into
   * `__fixtures__/ownership/` so a legitimate rule change is one edit. What
   * THE-319 asserts is what it always asserted: the rules file on disk is at a
   * digest some ticket recorded, so THIS ticket did not open a file that
   * auto-deploys to production with no emulator test in CI.
   */
  it('firestore.rules is at a digest some ticket recorded', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  /** Deferred to the guards that already pin them, so there is one copy of each
   *  digest in the repo rather than two that can drift apart. */
  it('the pins that already exist still hold', () => {
    const guard = read('src/__tests__/the-299-retention-guards.test.ts');
    for (const file of ['src/components/AdminDashboard.tsx', 'firestore.indexes.json']) {
      const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
      expect(guard, `${file} moved and no accepted digest covers it`).toContain(actual);
    }
  });

  it('src/app/layout.tsx carries no edit from this ticket', () => {
    expect(read('src/app/layout.tsx')).not.toContain('THE-319');
  });

  it('functions/ is unchanged, file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(REPO_ROOT, p).split(path.sep).join('/'));
      }
    };
    walk(path.join(REPO_ROOT, 'functions'));
    const files = out.sort();
    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(read('src/__tests__/the-299-retention-guards.test.ts')).toContain(tree);
  });

  /** 🔴 And no ui primitive was installed, edited or removed. */
  it('all 43 ui primitives are byte-identical — this ticket installed none', () => {
    const files = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .sort()
      .map((f) => `src/components/ui/${f}`);
    expect(files).toHaveLength(43);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(read('src/__tests__/the-299-retention-guards.test.ts'), 'a primitive was edited')
      .toContain(tree);
  });
});
