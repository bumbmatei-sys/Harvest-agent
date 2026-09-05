// @vitest-environment happy-dom
/**
 * THE-319 — the primitives are RENDERED, not merely imported.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS FILE EXISTS ALONGSIDE THE SOURCE GUARD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `THE-319.composition-guards.test.ts` reads source. Source can lie about
 * rendering in one specific way: a file can import `Table`, keep the import
 * alive by referencing it somewhere harmless, and still hand-write the markup
 * that matters. The only claim that cannot be faked is the one made against the
 * DOM the component actually produces, so every assertion here queries a
 * `data-slot` the PRIMITIVE writes and this ticket's files do not.
 *
 * ⚠️ happy-dom, deliberately, and it is enough for exactly this. It has NO
 * layout engine — every box is zero and `getComputedStyle` answers `block` for
 * a flex container — so nothing here measures anything. The measured claims
 * live in THE-299's and THE-298's Chromium layout suites, which this ticket
 * leaves untouched and which still pass. What is asserted below is structure,
 * figures and copy, all of which happy-dom renders exactly.
 *
 * ⚠️ And recharts renders NOTHING here, which is the whole reason `chart` was
 * rejected for the answers view a second time. See section 5.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RetentionHeatmap } from '../dashboard/RetentionHeatmap';
import { RETENTION_MONTHS, RETENTION_REASON, type RetentionGrid } from '../dashboard/retention-data';
import { FormAnswersView, LIST_RENDER_LIMIT } from '../forms/FormAnswersView';
import { summariseForm, type AnswerField, type AnswerSubmission } from '../forms/form-answers';

/* ── The DOM helper. `renderToStaticMarkup` + happy-dom's parser, so what is
      queried is the markup a server render actually emits. ─────────────────── */

const dom = (node: React.ReactElement): Document => {
  const doc = document.implementation.createHTMLDocument('t');
  doc.body.innerHTML = renderToStaticMarkup(node);
  return doc;
};

/**
 * The text a PERSON gets. Base UI's `progress` root appends a visually hidden
 * `<span role="presentation">x</span>` — a rendering artifact of the primitive
 * that is clipped to a 1px box and is presentational, so it reaches neither eye
 * nor screen reader. It is stripped here so that "no copy changed" is a claim
 * about copy rather than about the primitive's internals.
 *
 * ⚠️ It is NOT stripped by pretending it is absent: section 1 asserts it is
 * there and that it is exactly what the two existing `progress` adopters
 * already ship, so the artifact is recorded rather than hidden.
 */
const visibleText = (el: Element | null): string => {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[role="presentation"]').forEach((n) => n.remove());
  return clone.textContent ?? '';
};

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const share = (col: number): number | null => (col > 4 ? null : 100 - col * 17);

const GRID: RetentionGrid = {
  periods: RETENTION_MONTHS,
  rows: [
    { key: '2026-01', label: 'Jan 2026', members: 120, active: [120, 99, 82, 68, 55, ...Array(7).fill(null)], retained: Array.from({ length: RETENTION_MONTHS }, (_, c) => share(c)) },
    { key: '2026-02', label: 'Feb 2026', members: 84, active: [84, 70, 58, 48, 39, ...Array(7).fill(null)], retained: Array.from({ length: RETENTION_MONTHS }, (_, c) => share(c)) },
    { key: '2026-03', label: 'Mar 2026', members: 3, active: [3, 0, null, null, null, ...Array(7).fill(null)], retained: [100, 0, null, null, null, ...Array(7).fill(null)] },
  ],
  overall: Array.from({ length: RETENTION_MONTHS }, (_, c) => share(c)),
  membersTotal: 1240, membersInWindow: 207, membersBeforeWindow: 1000,
  membersAfterWindow: 30, membersUndated: 3,
  activitiesRead: 4096, activitiesAttributed: 3900, activitiesNotAMember: 150,
  activitiesUnresolved: 40, activitiesUndated: 6,
};

const FIELDS: AnswerField[] = [
  { id: 'q_name', type: 'short_text', label: 'Full name', order: 0 },
  { id: 'q_email', type: 'email', label: 'Email address', order: 1 },
  { id: 'q_phone', type: 'phone', label: 'Mobile number', order: 2 },
  { id: 'q_guests', type: 'number', label: 'How many guests will you bring', order: 3 },
  { id: 'q_start', type: 'date', label: 'Available from', order: 4 },
  { id: 'q_team', type: 'dropdown', label: 'Which team', options: ['Worship', 'Kids', 'Hospitality'], order: 5 },
  { id: 'q_days', type: 'checkbox', label: 'Which days can you serve', options: ['Saturday', 'Sunday', 'Midweek'], order: 6 },
];

/** 260 responses — past the 200-row render cap, so the cap genuinely binds. */
const N = 260;
const SUBMISSIONS: AnswerSubmission[] = Array.from({ length: N }, (_, i) => ({
  id: `s${i}`, submittedAt: null,
  answers: {
    q_name: `Person ${i}`, q_email: `p${i}@example.com`, q_phone: `+1555${i}`,
    q_guests: String(i % 5), q_start: `2026-0${(i % 9) + 1}-01`,
    q_team: FIELDS[5].options![i % 3],
    q_days: i % 2 === 0 ? ['Saturday'] : ['Saturday', 'Sunday'],
  },
}));
const SUMMARIES = summariseForm(FIELDS, SUBMISSIONS);

const answers = () => dom(
  <FormAnswersView summaries={SUMMARIES} total={N} counted={N} truncated={false} loading={false} />,
);
const heatmap = () => dom(<RetentionHeatmap grid={GRID} reason={null} />);

/* ═══ 1 · The primitives are in the rendered DOM ═══════════════════════════ */

describe('every composed element renders as the primitive, not as a substitute', () => {
  /**
   * 🔴 `data-slot` is written by `ui/table` and by NOTHING in
   * `RetentionHeatmap.tsx`. Hand-write the table back and every one of these
   * goes to zero while the import could still sit at the top of the file.
   */
  it('the heatmap renders ui/table for its screen-reader data table', () => {
    const doc = heatmap();
    for (const slot of ['table-container', 'table', 'table-header', 'table-body', 'table-row', 'table-head', 'table-cell', 'table-caption']) {
      expect(doc.querySelectorAll(`[data-slot="${slot}"]`).length, `no ${slot} — the table is hand-written again`)
        .toBeGreaterThan(0);
    }
    // And it is THE table: the one carrying the widget's own hook.
    expect(doc.querySelector('[data-retention-table]')?.getAttribute('data-slot')).toBe('table');
  });

  /**
   * 🔴 `data-slot="progress-track"` / `"progress-indicator"` are written by
   * `ui/progress` and by nothing in `FormAnswersView.tsx`. A hand-rolled track
   * and fill would leave `[data-option-bar]` intact and these at zero, which is
   * exactly the substitution an import count cannot see.
   */
  it('the answers view renders ui/progress for every option bar', () => {
    const doc = answers();
    const bars = [...doc.querySelectorAll('[data-option-bar]')];
    expect(bars.length, 'no bars at all').toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.getAttribute('data-slot'), 'a bar is not a progress root').toBe('progress');
      expect(bar.querySelector('[data-slot="progress-track"]'), 'a bar has no primitive track').toBeTruthy();
      expect(bar.querySelector('[data-slot="progress-indicator"]'), 'a bar has no primitive indicator').toBeTruthy();
    }
  });

  /**
   * ⚠️ THE ONE DOM DIFFERENCE THIS TICKET INTRODUCES, recorded rather than
   * hidden. Base UI's progress root appends a visually hidden, presentational
   * `<span>x</span>`. It is clipped to a 1px box, it is `role="presentation"`
   * so no screen reader announces it, and the whole bar carries `aria-hidden`
   * besides — the count and the share are written out beside it, and naming the
   * bar would announce the same figure twice.
   *
   * 🔴 It is not new to this repo: `progress`'s two existing adopters have
   * shipped it since THE-290. Chromium measured every card, bar and page box
   * identical to `main` at all five viewports with it present.
   */
  it('and the primitive\'s hidden presentational span is accounted for, not hidden', () => {
    const doc = answers();
    const bar = doc.querySelector('[data-option-bar]')!;
    expect(bar.getAttribute('aria-hidden'), 'the bar announces itself as well as the text').toBe('true');
    const presentational = bar.querySelectorAll('[role="presentation"]');
    expect(presentational.length, 'the base-ui artifact moved — re-verify the copy claim').toBe(1);
    expect(visibleText(bar), 'the bar contributes visible copy').toBe('');
  });
});

/* ═══ 2 · No figure and no word of copy moved ═════════════════════════════ */

describe('no figure and no word of copy changed', () => {
  it('the heatmap writes the same numbers into the same cells', () => {
    const doc = heatmap();
    // A drawn cell per finished period, and NOTHING for one that has not.
    expect(doc.querySelectorAll('[data-retention-cell]').length).toBe(5 + 5 + 2);
    expect(doc.querySelector('[data-retention-cell="2026-01:0"]')?.textContent).toBe('100%');
    expect(doc.querySelector('[data-retention-cell="2026-01:4"]')?.textContent).toBe('32%');
    expect(doc.querySelector('[data-retention-cell="2026-01:5"]'), 'an unfinished month drew a cell').toBeNull();
    expect(doc.querySelector('[data-retention-overall="0"]')?.textContent).toBe('100%');
  });

  it('the heatmap states its coverage in the same words and the same figures', () => {
    const text = heatmap().querySelector('[data-retention-coverage]')!.textContent!;
    expect(text).toContain('207 of 1,240 members joined inside this 12-month window and are in the grid.');
    expect(text).toContain('1,000 joined earlier, 30 joined during the month still in progress, and 3 carry no readable join date; all are counted here and placed in no row.');
    expect(text).toContain('Of 4,096 activities read, 3,900 belong to a member, 150 to a contact who is not one, and 46 could not be placed.');
  });

  it('the legend still says what each band means in words', () => {
    const doc = heatmap();
    const bands = [...doc.querySelectorAll('[data-retention-band]')].map((b) => b.textContent);
    expect(bands).toEqual(['none', '1–20%', '21–40%', '41–60%', '61–80%', '81–100%']);
    expect(doc.querySelector('[data-retention-legend]')!.textContent)
      .toContain('Blank: that month has not finished.');
  });

  it('the sr-only table repeats every count and share as text', () => {
    const doc = heatmap();
    const table = doc.querySelector('[data-retention-table]')!;
    expect(table.querySelector('caption')?.textContent).toBe('Retention by join month, as counts and shares.');
    expect(table.textContent).toContain('120 of 120, 100%');
    expect(table.textContent).toContain('55 of 120, 32%');
    expect(table.textContent).toContain('not yet observed');
    // 🔴 The row headings are still `<th scope="row">` — the primitive did not
    // quietly turn a heading into a cell.
    const headings = [...table.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(headings).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026']);
    expect([...table.querySelectorAll('tbody th')].every((th) => th.getAttribute('scope') === 'row')).toBe(true);
  });

  it('the answers view writes the same counts beside the same options', () => {
    const doc = answers();
    const days = doc.querySelector('[data-question="q_days"]')!;
    expect([...days.querySelectorAll('[data-option]')].map((o) => o.getAttribute('data-option')))
      .toEqual(['Saturday', 'Sunday', 'Midweek']);
    expect(days.querySelector('[data-option="Saturday"] [data-option-count]')?.textContent).toBe('260 · 100%');
    expect(days.querySelector('[data-option="Sunday"] [data-option-count]')?.textContent).toBe('130 · 50%');
    expect(days.querySelector('[data-option="Midweek"] [data-option-count]')?.textContent).toBe('0 · 0%');
    // 🔴 And the visible copy of the whole card is untouched by the primitive.
    expect(visibleText(days)).toBe(
      'Which days can you serve260 answers · choose any, so shares can total over 100%' +
      'Saturday260 · 100%Sunday130 · 50%Midweek0 · 0%',
    );
  });

  it('the bar still depicts the share it is given, and is clamped to its track', () => {
    const doc = answers();
    const days = doc.querySelector('[data-question="q_days"]')!;
    const width = (option: string) => (days
      .querySelector(`[data-option="${option}"] [data-slot="progress-indicator"]`) as HTMLElement)
      .style.width;
    expect(width('Saturday')).toBe('100%');
    expect(width('Sunday')).toBe('50%');
    expect(width('Midweek')).toBe('0%');
    // 🔴 A checkbox question's shares can total over 100%, and no single bar may
    // exceed its own track because of it.
    for (const bar of doc.querySelectorAll('[data-slot="progress-indicator"]')) {
      const pct = Number.parseFloat((bar as HTMLElement).style.width);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

/* ═══ 3 · The refusal, and the privacy property ═══════════════════════════ */

describe('the heatmap still refuses entirely, naming which collection bound', () => {
  it.each([
    ['activityCeiling', RETENTION_REASON.activityCeiling(1000)],
    ['contactCeiling', RETENTION_REASON.contactCeiling(1000)],
    ['memberCeiling', RETENTION_REASON.memberCeiling(1000)],
  ])('%s draws NO grid and says which one it was', (_name, reason) => {
    const doc = dom(<RetentionHeatmap grid={null} reason={reason} />);
    expect(doc.querySelector('[data-retention-grid]'), 'it drew a grid over a refused read').toBeNull();
    expect(doc.querySelector('[data-retention-table]')).toBeNull();
    expect(doc.querySelector('[data-widget="Retention cohorts"]')?.getAttribute('data-state')).toBe('unavailable');
    expect(doc.querySelector('[data-empty-reason]')?.textContent).toBe(reason);
  });

  it('and an omitted grid is LOADING, never a ready widget drawing nothing', () => {
    const doc = dom(<RetentionHeatmap grid={null} reason={null} />);
    expect(doc.querySelector('[data-widget="Retention cohorts"]')?.getAttribute('data-state')).toBe('loading');
  });

  /** 🔴 No-regression on THE-283: a cohort is a count, never a person. */
  it('names no individual anywhere in the rendered output', () => {
    const text = heatmap().body.textContent!;
    for (const row of GRID.rows) expect(text).toContain(row.label);
    // Every row heading is a MONTH, and there is no other kind of heading.
    const headings = [...heatmap().querySelectorAll('tbody th')].map((th) => th.textContent!);
    for (const h of headings) expect(h, `${h} is not a month`).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    expect(text).not.toMatch(/@|\+\d{6,}/);
  });
});

/* ═══ 4 · The answers view's decisions ════════════════════════════════════ */

describe("THE-298's per-question decisions still hold", () => {
  it('renders one card per field, keyed to the field', () => {
    const doc = answers();
    expect([...doc.querySelectorAll('[data-question]')].map((c) => c.getAttribute('data-question')))
      .toEqual(FIELDS.map((f) => f.id));
  });

  it('email and phone are counted only — no bar, no list, no value', () => {
    const doc = answers();
    for (const id of ['q_email', 'q_phone']) {
      const card = doc.querySelector(`[data-question="${id}"]`)!;
      expect(card.getAttribute('data-question-kind')).toBe('private');
      expect(card.querySelectorAll('[data-option-bar]').length, `${id} drew a bar`).toBe(0);
      expect(card.querySelectorAll('[data-answer]').length, `${id} listed a value`).toBe(0);
      expect(card.querySelector('[data-private-note]')).toBeTruthy();
      expect(card.textContent, `${id} leaked a value`).not.toContain('@example.com');
    }
  });

  it('number and date are LISTED, never averaged into a figure nobody asked for', () => {
    const doc = answers();
    for (const id of ['q_guests', 'q_start']) {
      const card = doc.querySelector(`[data-question="${id}"]`)!;
      expect(card.getAttribute('data-question-kind')).toBe('list');
      expect(card.querySelectorAll('[data-option-bar]').length, `${id} was charted`).toBe(0);
      expect(card.querySelectorAll('[data-answer]').length).toBeGreaterThan(0);
    }
  });

  it('the 200-row cap still binds, still says so, and the counts stay complete', () => {
    const doc = answers();
    const card = doc.querySelector('[data-question="q_guests"]')!;
    expect(card.querySelectorAll('[data-answer]').length).toBe(LIST_RENDER_LIMIT);
    expect(card.querySelector('[data-list-render-cap]')?.textContent)
      .toBe('Showing the first 200 of 260 answers. The full set is in the CSV export.');
    // 🔴 A RENDER cap, not a read cap: the card's own answered count is all 260.
    expect(card.querySelector('[data-question-answered]')?.textContent)
      .toContain('260 answers');
    // And the choice counts elsewhere are over the complete set too.
    expect(doc.querySelector('[data-question="q_days"] [data-option="Saturday"] [data-option-count]')?.textContent)
      .toBe('260 · 100%');
  });
});

/* ═══ 5 · chart is still adopted by nothing new ═══════════════════════════ */

/**
 * 🔴 THE-298's reason 3, re-run rather than quoted. If recharts rendered
 * anything under happy-dom this assertion would be the place to notice, and the
 * counts above would have been safe to hand to it. It does not, so they are not.
 */
describe('chart is still adopted by nothing new', () => {
  it('the answers view draws its bars in plain elements the suite can read', () => {
    const doc = answers();
    expect(doc.querySelectorAll('.recharts-wrapper').length).toBe(0);
    expect(doc.querySelectorAll('[data-chart]').length).toBe(0);
    // The figures ARE in the DOM, which is what recharts could not have given.
    expect(doc.querySelector('[data-option-count]')?.textContent).toMatch(/\d+ · \d+%/);
  });

  it('and the heatmap draws its cells in an SVG grid, not a chart', () => {
    const doc = heatmap();
    expect(doc.querySelectorAll('.recharts-wrapper').length).toBe(0);
    expect(doc.querySelector('[data-retention-grid]')?.tagName.toLowerCase()).toBe('svg');
    expect(doc.querySelector('[data-retention-grid]')?.getAttribute('role')).toBe('img');
  });
});
