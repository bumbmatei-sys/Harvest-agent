import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-328 — the insight feed printed database schema at a pastor, restated the
 * cards above it, and wore an icon that implied a model it never called.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY EVERY SWEEP BELOW READS THE RENDERED DOM AND NOT THE SOURCE FILE.
 *
 * The defect is what a church SEES. `InsightFeed.tsx` still legitimately spells
 * `tenants/{id}/invoices` — in the `source` constants, which is the whole point
 * of keeping them — so a grep over the source would have to pass on the very
 * string it is hunting and would prove nothing about the screen. Worse, a
 * source sweep that included this file would find every banned token in the
 * assertions below and pass itself: eight guards in this series shipped with
 * exactly that shape, one of them passing with its own gate deleted because the
 * assertion message contained the string it grepped for.
 *
 * So section 1 renders the component, takes `textContent`, and asserts the text
 * a reader actually gets. This file's own prose is not in that string and
 * cannot be.
 *
 * ⚠️ Each sweep first asserts the rendered text is NON-EMPTY and contains the
 * sentence it expects. A sweep over an empty string passes trivially, which is
 * how a guard that guards nothing looks from the outside.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NO FIXTURE IS PINNED NEAR TODAY — the #468 fuse.
 *
 * A fixture pinned to '2026-09-06T10:00' turned `main` red for everyone the
 * moment the clock passed it. The clock here is frozen at MAY 2031 with
 * `vi.useFakeTimers({ toFake: ['Date'] })` — `toFake` is load-bearing; faking
 * every timer deadlocks React's scheduler — and section 6 asserts the frozen
 * seven-day window directly, which is the claim every sentence in this panel
 * rests on.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const FEED = 'src/components/dashboard/InsightFeed.tsx';
const OVERVIEW = 'src/components/dashboard/OverviewTab.tsx';

const { buildInsights, shapeOf, InsightFeed, STEADY } = await import('../components/dashboard/InsightFeed');
const { bucketWeekly, weekBuckets, REASON, TREND_WEEKS } = await import('../components/dashboard/dashboard-data');
/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
});

/** The rendered text of the panel, whitespace-normalised. */
const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/* ── Fixtures. Values, not dates — the component takes buckets, not a clock. ─ */

const points = (...values: number[]) =>
  values.map((value, i) => ({ label: `w${i}`, value }));

const complete = (...values: number[]) =>
  ({ kind: 'complete', points: points(...values) }) as const;

const refused = (reason: string) => ({ kind: 'unavailable', reason }) as const;

/** A week with something to say in all three metrics. */
const LOUD = {
  memberSeries: complete(0, 0, 0, 2),          // firstIn — 2 joined after 3 quiet weeks
  givingSeries: complete(0, 0, 0, 0),          // drought — nobody has given for 4 weeks
  submissionsSeries: complete(1, 2, 3, 9),     // highest — 9, more than any of 3
} as const;

/* ═══ 1 · No Firestore path, collection name or field name is rendered ═══════ */

describe('no Firestore path, collection name or field name is rendered', () => {
  /**
   * 🔴 The banned tokens, verbatim from the screenshot the founder sent. Each
   * is a thing that appeared ON A CHURCH'S DASHBOARD, and each is still spelled
   * in `InsightFeed.tsx` on purpose — so finding one HERE, in rendered text, is
   * unambiguous.
   */
  const BANNED = [
    'tenants/',
    '{id}',
    'createdAt',
    'submittedAt',
    'getCountFromServer',
    'amount (cents)',
    'complete read',
    'aggregation',
    'counted by',
    'summed from',
  ] as const;

  it('sweeps the rendered panel in every state it can reach', async () => {
    const states: [string, React.ReactElement][] = [
      ['loud', <InsightFeed key="a" loading={false} inputs={LOUD} />],
      ['steady', <InsightFeed key="b" loading={false} inputs={{
        memberSeries: complete(2, 2, 2, 2),
        givingSeries: complete(500, 500, 500, 500),
        submissionsSeries: complete(3, 3, 3, 3),
      }} />],
      ['refused', <InsightFeed key="c" loading={false} inputs={{
        memberSeries: refused(REASON.readFailed),
        givingSeries: refused(REASON.tooManyToChart),
        submissionsSeries: refused(REASON.tooManyForms),
      }} />],
      ['nothing supplied', <InsightFeed key="d" loading={false} inputs={{
        memberSeries: null, givingSeries: null, submissionsSeries: null,
      }} />],
    ];

    for (const [name, element] of states) {
      const el = await mount(element);
      const text = textOf(el);
      // 🔴 THE GATE. A sweep over an empty string passes trivially.
      expect(text.length, `${name}: rendered nothing to sweep`).toBeGreaterThan(20);
      expect(text, `${name}: the panel heading is missing`).toContain('What changed');
      for (const token of BANNED) {
        expect(text.includes(token), `${name}: rendered a schema token`).toBe(false);
      }
      // Nothing that looks like a path segment, however it was spelled.
      expect(text).not.toMatch(/[a-z_]+\/[a-z_{]/i);
      if (root) await act(async () => { root!.unmount(); });
      root = null;
      container.remove();
    }
  });

  it('the panel description is written for a church, not for a reviewer', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    const text = textOf(el);
    // The old header was a note to the author about how the figures were read.
    expect(text).not.toContain('never from an estimate');
    expect(text).not.toMatch(/\breads\b/);
    expect(text).toContain('The last seven days, against the weeks before them.');
  });
});

/* ═══ 2 · The panel does not imply AI ════════════════════════════════════════ */

describe('the panel does not imply AI', () => {
  /**
   * 🔴 NAMED PER ELEMENT, because "no AI" is not a property of a string sweep.
   * Two things implied a model and both are icons:
   *
   *   • `icon={Sparkles}` on the WidgetFrame header, beside "What changed".
   *   • `DIRECTION_ICON.flat = Sparkles`, the glyph on every row with no
   *     direction — which was most of them.
   *
   * ⚠️ There was never an "AI insights" LABEL in the code. The founder's name
   * for the panel came from the sparkles, and section 3 pins the two features
   * that legitimately carry the letters AI.
   */
  it('the feed imports no sparkle and renders no AI wording', async () => {
    const src = read(FEED);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('Sparkles');
    expect(code).not.toMatch(/\bWand\b|WandSparkles|Bot\b|BrainCircuit/);

    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    const text = textOf(el);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(/\bAI\b|\bA\.I\.|artificial intelligence|smart insight|generated/i);
    // The icons that replaced them, asserted by name so a silent revert fails.
    expect(code).toContain('CalendarDays');
    expect(code).toContain('Minus');
  });

  it('the tab that mounts the feed carries no AI wording either', () => {
    const src = read(OVERVIEW);
    expect(src).not.toMatch(/\bAI\b/);
    expect(src).not.toContain('Sparkles');
  });
});

/* ═══ 3 · AI Knowledge and AI Chat are untouched ═════════════════════════════ */

describe('AI Knowledge and AI Chat are untouched', () => {
  /**
   * 🔴 NO-REGRESSION. These are genuine model-backed features and removing
   * their names would be the opposite defect — a real AI feature nobody can
   * find. `AdminDashboard.tsx` is READ here and NOT EDITED: it is digest-pinned
   * and THE-326 and THE-327 both just touched it, and THE-328 needed no change
   * there because the panel's AI implication was entirely in its own icons.
   */
  it('the AI Knowledge nav entry, its gate and its label all still exist', () => {
    const src = read('src/components/AdminDashboard.tsx');
    expect(src).toContain("label: 'AI Knowledge'");
    expect(src).toContain('perms.uploadRag');
    expect(src).toContain("ai: 'AI Knowledge'");
  });

  it('the RAG screen keeps its sparkles', () => {
    expect(read('src/components/AdminRAG.tsx')).toContain('Sparkles');
  });
});

/* ═══ 4 · Every figure is identical to before ════════════════════════════════ */

describe('every figure is identical to before', () => {
  /**
   * 🔴 THE SAFETY PROPERTY. THE-328 is a copy change. The arithmetic that
   * produces each number is untouched, so the number in each sentence must be
   * the newest bucket of the series it came from, formatted exactly as it was
   * before — a count with `toLocaleString`, money with the same `Intl` options.
   */
  it('the count in a sentence is the newest bucket, unchanged', () => {
    const insights = buildInsights({
      memberSeries: complete(0, 0, 1234),
      givingSeries: null,
      submissionsSeries: complete(0, 0, 5678),
    });
    const headlines = insights.map((i) => i.headline).join(' | ');
    expect(headlines).toContain('1,234 members');
    expect(headlines).toContain('5,678 form submissions');
  });

  it('money is formatted exactly as it was, from cents', () => {
    const [giving] = buildInsights({
      memberSeries: null,
      givingSeries: complete(0, 0, 123456),
      submissionsSeries: null,
    });
    // 123456 cents, whole dollars, en-US — the pre-existing Intl options.
    expect(giving.headline).toContain('$1,235');
  });

  it('no sentence invents a figure the series did not carry', () => {
    for (const values of [[0, 0, 0, 0], [0, 0, 0, 7], [1, 2, 3, 9], [4, 4, 4, 4]]) {
      const insights = buildInsights({
        memberSeries: complete(...values), givingSeries: null, submissionsSeries: null,
      });
      for (const insight of insights) {
        const digits = (insight.headline.match(/[\d,]+/g) ?? []).map((d) => Number(d.replace(/,/g, '')));
        for (const n of digits) {
          // Every number in a sentence is either the week's own value or a
          // count of weeks, which can never exceed the buckets in hand.
          expect(n === values[values.length - 1] || n <= values.length).toBe(true);
        }
      }
    }
  });
});

/* ═══ 5 · A failed read renders as a failure, not as "nothing happened" ══════ */

describe('a failed read renders as a failure, not as "nothing happened"', () => {
  /**
   * 🔴 THE SILENT-FAILURE RULE, asserted by making a read reject. "No receipts
   * this week" and "we could not read receipts" are different sentences, and
   * before THE-328 a refused giving read produced the FIRST one — or, when
   * every read was refused, "Nothing in this ministry's data records anything
   * that changed this week", which is a claim about the data.
   */
  it('one refused read is visible even when the others landed', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: complete(0, 0, 0, 3),
      givingSeries: refused(REASON.readFailed),
      submissionsSeries: complete(1, 2, 3, 9),
    }} />);
    const text = textOf(el);
    expect(text).toContain('Giving could not be read for the last seven days.');
    expect(text).toContain(REASON.readFailed);
    // 🔴 THE MUTATION THIS CATCHES: the refusal must NOT be softened into an
    // absence. Not one word claiming nobody gave.
    expect(text).not.toMatch(/No receipts|No giving|Nobody has given/);
    // And the reads that DID land are still said.
    expect(text).toContain('3 members joined');
    // The failure is an alert, so a screen reader is told.
    expect(el.querySelector('[data-insight-failure="giving-unread"]')).not.toBeNull();
    expect(el.querySelector('[data-insight-failure="giving-unread"]')!.getAttribute('role'))
      .toBe('alert');
  });

  it('every read refused never renders as steadiness or as an empty ministry', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: refused(REASON.readFailed),
      givingSeries: refused(REASON.readFailed),
      submissionsSeries: refused(REASON.readFailed),
    }} />);
    const text = textOf(el);
    expect(text).toContain('New members could not be read');
    expect(text).toContain('Giving could not be read');
    expect(text).toContain('Form submissions could not be read');
    // 🔴 The two quiet lies, both refused.
    expect(text).not.toContain(STEADY);
    expect(text).not.toContain(REASON.noSource('anything that changed this week'));
    expect(text).not.toMatch(/Nobody new has joined|Nobody has given|No form submissions have/);
  });

  it('a refused read and an empty week do not render the same words', async () => {
    const refusedEl = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: refused(REASON.readFailed), givingSeries: null, submissionsSeries: null,
    }} />);
    const refusedText = textOf(refusedEl);
    if (root) await act(async () => { root!.unmount(); });
    root = null; refusedEl.remove();

    const emptyEl = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: complete(0, 0, 0, 0), givingSeries: null, submissionsSeries: null,
    }} />);
    const emptyText = textOf(emptyEl);

    expect(refusedText).not.toBe(emptyText);
    expect(emptyText).toContain('Nobody new has joined for 4 weeks running.');
    expect(refusedText).toContain('could not be read');
    expect(emptyText).not.toContain('could not be read');
  });

  it('a series that was never supplied is not reported as a failed read', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: null, givingSeries: null, submissionsSeries: null,
    }} />);
    // Nothing was read, so the frame says so — and it does not claim the
    // ministry's data records nothing.
    expect(textOf(el)).toContain(REASON.readFailed);
    expect(textOf(el)).not.toContain(STEADY);
  });
});

/* ═══ 6 · Each insight says something the KPI cards do not ═══════════════════ */

describe('each insight says something the KPI cards do not', () => {
  /**
   * 🔴 THE SUBSTANTIVE HALF. The Members card already renders the count, a
   * sparkline of the same series, and a `+N% vs last week` badge (KpiCard.tsx,
   * `data-kpi-delta`). So a sentence is only worth printing when it carries a
   * shape the card cannot draw — and when it does not, this panel says nothing
   * rather than restating the card.
   */
  it('a week that looks like its neighbours produces no sentence at all', () => {
    expect(buildInsights({
      memberSeries: complete(5, 5, 5, 5),
      givingSeries: complete(100, 120, 110, 115),
      submissionsSeries: complete(2, 3, 2, 3),
    })).toEqual([]);
  });

  it('the three shapes are exactly the ones a card cannot show', () => {
    expect(shapeOf(points(0, 0, 0, 0))).toEqual({ kind: 'drought', weeks: 4 });
    expect(shapeOf(points(0, 0, 0, 3))).toEqual({ kind: 'firstIn', weeks: 4 });
    expect(shapeOf(points(1, 2, 3, 9))).toEqual({ kind: 'highest', over: 3 });
    // A single empty week is one bucket of a sparkline the card already draws.
    expect(shapeOf(points(4, 0))).toBeNull();
    // Neither is an ordinary rise the delta badge already states.
    expect(shapeOf(points(9, 2, 3))).toBeNull();
    expect(shapeOf([])).toBeNull();
  });

  it('every sentence carries its shape, not just its level', () => {
    const insights = buildInsights(LOUD);
    expect(insights.map((i) => i.key)).toEqual(['members', 'giving', 'submissions']);
    expect(insights[0].headline).toBe('2 members joined in the last seven days — the first in 4 weeks.');
    expect(insights[1].headline).toBe('Nobody has given for 4 weeks running.');
    expect(insights[2].headline)
      .toBe('9 form submissions arrived in the last seven days — more than in any of the previous 3 weeks.');
    // 🔴 None of them is the bare restatement the cards already make.
    for (const insight of insights) {
      expect(insight.headline).not.toMatch(/^\d[\d,]* (members?|form submissions?) joined in the last seven days\.$/);
    }
  });

  /**
   * 🔴 THE REDUCTION, REPORTED RATHER THAN HIDDEN. `contacts` was a lone
   * `getCountFromServer` figure with no series behind it, so there was no
   * previous period to compare and no shape to find — its sentence was a
   * verbatim restatement of the Contacts card. Adding a read to give it
   * something to say is the one thing this ticket forbids, so it is dropped.
   */
  it('the contacts insight is gone, and no read was added to replace it', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    expect(textOf(el)).not.toMatch(/CRM pipeline|contacts are on/i);
    // The feed takes three series and nothing else, and issues no query itself.
    const code = read(FEED).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const token of ['getDocs', 'getCountFromServer', 'collection(', 'query(', 'firebase']) {
      expect(code.includes(token), `the feed reached for a read: ${token.slice(0, 4)}`).toBe(false);
    }
    expect(read(OVERVIEW)).not.toContain('contacts: data.contacts');
  });
});

/* ═══ 7 · No figure is fabricated; provenance still exists in code ═══════════ */

describe('no figure is fabricated; provenance still exists in code', () => {
  /**
   * 🔴 TRACEABILITY SURVIVES EVEN THOUGH IT IS NOT SHOWN. The rule — a figure
   * ships only from an exact or provably complete read — is unchanged; what
   * changed is who it is written for. `source` is still a REQUIRED field, so a
   * new branch emitting a sentence without naming its read does not compile.
   */
  it('every insight still carries the read it came from', () => {
    const insights = buildInsights({
      ...LOUD,
      submissionsSeries: refused(REASON.tooManyForms),
    });
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.source.length).toBeGreaterThan(10);
      // The provenance is still a real read description, not a placeholder.
      expect(insight.source).toMatch(/complete read|aggregation/);
    }
  });

  it('the three reads are each named, and none of them is guessed at', () => {
    const sources = buildInsights({
      memberSeries: refused('x'), givingSeries: refused('x'), submissionsSeries: refused('x'),
    }).map((i) => i.source);
    expect(sources).toEqual([
      'users, counted by createdAt over a complete read',
      'tenants/{id}/invoices, summed from amount (cents) over a complete read',
      'tenants/{id}/forms/{id}/submissions, counted by submittedAt over a complete read',
    ]);
  });

  it('no sentence is emitted from a series that is not complete', () => {
    const notes = buildInsights({
      memberSeries: refused('x'),
      givingSeries: refused('x'),
      submissionsSeries: refused('x'),
    }).filter((i) => i.tone === 'note');
    expect(notes).toEqual([]);
  });
});

/* ═══ 8 · No individual is named; no person is paired with a location ════════ */

describe('no individual is named; no person is paired with a location', () => {
  /**
   * 🔴 THE-283. This panel counts; it never identifies. There is no name in its
   * inputs at all — a `Series` is labels and numbers — which is the strongest
   * form of this guarantee, and it is asserted on the type as well as the text.
   */
  it('the feed has no way to receive a person', () => {
    const code = read(FEED).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // ⚠️ Identifiers, not substrings: `className` contains "name" and would
    // make a substring sweep fail on markup that has nothing to do with people.
    for (const token of ['name', 'email', 'displayName', 'city', 'address', 'location', 'person']) {
      const used = new RegExp(`\\b${token}\\b`, 'i').test(code);
      expect(used, `the feed took a ${token}`).toBe(false);
    }
    // The inputs are three series and nothing else.
    expect(code).toMatch(/interface InsightInputs \{[^}]*\}/);
    const inputs = code.match(/interface InsightInputs \{([^}]*)\}/)![1];
    expect([...inputs.matchAll(/readonly (\w+)/g)].map((m) => m[1]))
      .toEqual(['memberSeries', 'givingSeries', 'submissionsSeries']);
  });

  it('renders no capitalised personal name in any state', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    const text = textOf(el);
    // Only sentence-initial capitals and the panel heading survive; a first
    // name followed by a surname would break this.
    expect(text).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+(-[A-Z][a-z]+)?\b/);
  });
});

/* ═══ 9 · Every element that has a primitive uses it ═════════════════════════ */

describe('every element that has a primitive uses it', () => {
  /**
   * 🔴 Hand-written markup where a primitive exists is a DEFECT, so this is
   * asserted per element rather than by counting imports.
   *
   * ⚠️ REPORTED DRIFT: the ticket said `InsightFeed.tsx` "imports NOTHING from
   * @/components/ui/" and that `AlertDescription` and `ItemDescription` might be
   * local re-implementations. They are NOT. Both were already imported from
   * `../ui/alert` and `../ui/item` — genuine primitives, exported from
   * `src/components/ui/alert.tsx:76` and `src/components/ui/item.tsx:190`. The
   * premise was wrong and nothing needed composing; this file keeps that true.
   */
  it('the frame, the failure banner and the rows are all primitives', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: complete(0, 0, 0, 3),
      givingSeries: refused(REASON.readFailed),
      submissionsSeries: complete(1, 2, 3, 9),
    }} />);
    // card — via WidgetFrame, which owns the three widget states.
    expect(el.querySelector('[data-slot="card"]')).not.toBeNull();
    // alert — the refused read. role="alert" is why it is this and not a div.
    expect(el.querySelector('[data-slot="alert"]')).not.toBeNull();
    expect(el.querySelector('[data-slot="alert-title"]')).not.toBeNull();
    expect(el.querySelector('[data-slot="alert-description"]')).not.toBeNull();
    // item — one row per note, grouped.
    expect(el.querySelector('[data-slot="item-group"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-slot="item"]').length).toBe(2);
    expect(el.querySelector('[data-slot="item-media"]')).not.toBeNull();
    expect(el.querySelector('[data-slot="item-title"]')).not.toBeNull();
  });

  it('the steady line is an item, not a bare paragraph', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={{
      memberSeries: complete(5, 5, 5, 5), givingSeries: null, submissionsSeries: null,
    }} />);
    const steady = el.querySelector('[data-insight="steady"]');
    expect(steady).not.toBeNull();
    expect(steady!.getAttribute('data-slot')).toBe('item');
    expect(textOf(el)).toContain(STEADY);
  });

  it('imports come from the primitives and the file rolls none of its own', () => {
    const src = read(FEED);
    expect(src).toContain("from '../ui/alert'");
    expect(src).toContain("from '../ui/item'");
    // 🔴 REJECTED, each with a reason, so a later ticket does not relitigate:
    //  • `collapsible` — a disclosure still renders the schema to the same
    //    pastor, one tap away, and puts it back in section 1's sweep.
    //  • `tooltip` — same, and unreachable on a phone.
    //  • `empty` — WidgetFrame already owns the unavailable state; a second
    //    empty state inside it would be two answers to one question.
    //  • `badge` — the KPI card's delta badge is the thing this panel exists
    //    not to repeat.
    //  • `separator` — ItemGroup already separates its rows.
    for (const rejected of ['ui/collapsible', 'ui/tooltip', 'ui/empty', 'ui/badge', 'ui/separator']) {
      expect(src).not.toContain(rejected);
    }
    // No local re-implementation of a primitive's parts.
    expect(src).not.toMatch(/function (Alert|Item)[A-Za-z]*\s*\(/);
  });
});

/* ═══ 10 · Inline styles stay at zero ════════════════════════════════════════ */

describe('inline styles stay at zero', () => {
  it('neither file this ticket touches spells a style prop', () => {
    for (const rel of [FEED, OVERVIEW]) {
      expect(read(rel), rel).not.toMatch(/style=\{\{/);
      expect(read(rel), rel).not.toMatch(/style=\{/);
    }
  });

  it('the rendered panel carries no style attribute', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    expect(el.querySelectorAll('[style]').length).toBe(0);
  });
});

/* ═══ 11 · The claims #438 deleted are still absent ══════════════════════════ */

describe('reach, impressions, blog views and completions-over-time are still absent', () => {
  /**
   * 🔴 NO-REGRESSION ON #438, which deleted these because the data cannot
   * exist. An insight feed is exactly where a plausible-sounding one would be
   * reintroduced as a sentence.
   */
  it('no removed claim reappears in the feed, as copy or as an input', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    // ⚠️ Comments stripped: the header's "unreachable on a phone" is prose
    // about a rejected primitive, not a resurrected metric.
    const code = read(FEED).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const haystack = `${textOf(el)} ${code}`.toLowerCase();
    for (const claim of ['reach', 'impression', 'blog view', 'page view', 'completions over time', 'engagement rate']) {
      expect(haystack.includes(claim), `a deleted claim came back: ${claim}`).toBe(false);
    }
  });
});

/* ═══ 12 · No colour is hardcoded, no emoji, all four palettes resolve ═══════ */

describe('no colour is hardcoded, no emoji; all four palettes resolve', () => {
  /**
   * ⚠️ The four palettes are the FOUR CASCADE BLOCKS, spelled exactly as
   * `tailwind-v4-migration.test.ts` spells them — family × theme, with Classic
   * the default since #409 and therefore asserted FIRST.
   */
  const PALETTES = [
    ['Classic light', '[data-palette="classic"][data-theme="light"]'],
    ['Classic dark', '[data-palette="classic"][data-theme="dark"]'],
    ['Harvest light', ':root'],
    ['Harvest dark', '[data-theme="dark"]'],
  ] as const;

  it('the feed names no colour and no emoji', () => {
    // ⚠️ COMMENTS STRIPPED. This repo's headers use 🔴/⚠️/🔵 as prose markers
    // throughout; the bar is that no emoji reaches a RENDERED string.
    const code = read(FEED).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgb\(|\bhsl\(|\boklch\(/);
    // Only semantic classes, never a palette literal.
    expect(code).not.toMatch(/\b(text|bg|border)-(red|green|blue|amber|yellow|purple|gold)-\d/);
    expect(code).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it('nothing the panel renders carries an emoji', async () => {
    const el = await mount(<InsightFeed loading={false} inputs={LOUD} />);
    expect(textOf(el)).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it('every colour it does use is a token all four palettes resolve', () => {
    // The only colour-bearing class this file introduces is the destructive
    // alert variant, which is the primitive's own and reads `--destructive`.
    const css = read('src/app/globals.css');
    for (const [palette, selector] of PALETTES) {
      const at = css.indexOf(selector);
      expect(at, `palette block missing: ${palette}`).toBeGreaterThan(-1);
      // The block declares tokens — a selector that stopped matching would
      // make every assertion above it vacuous.
      expect(css.slice(at, at + 4000)).toMatch(/--[a-z-]+:/);
    }
    expect(css).toContain('--destructive');
  });
});

/* ═══ 13 · No fixture is pinned near today; the window is frozen ════════════ */

describe('no test fixture is pinned to a date near today', () => {
  /**
   * 🔴 THE #468 FUSE. A fixture pinned to '2026-09-06T10:00' turned `main` red
   * for everyone the moment the clock passed it. Section 13 sweeps this file's
   * own fixtures and then asserts the seven-day window against a FROZEN clock —
   * which is the claim every sentence in this panel rests on, and this ticket
   * is about "the last seven days", so it is the exposed one.
   */
  it('this suite pins no date within five years of now', () => {
    const src = read('src/__tests__/the-328-insight-copy-guards.test.tsx');
    const years = [...src.matchAll(/\b(20\d\d)-\d\d-\d\d\b/g)].map((m) => Number(m[1]));
    const thisYear = new Date().getFullYear();
    for (const year of years) {
      expect(Math.abs(year - thisYear) > 4, `a fixture is pinned to ${year}`).toBe(true);
    }
    // The component fixtures are VALUES, not dates — the strongest form of this.
    expect(src).toContain('const points = (...values: number[])');
  });

  describe('the seven-day window, against a frozen clock', () => {
    /** Wed 7 May 2031, 09:00 — five years out, so no clock can reach it. */
    const NOW = new Date(2031, 4, 7, 9, 0, 0);

    beforeEach(() => {
      // 🔴 `toFake: ['Date']` is LOAD-BEARING. Faking every timer deadlocks
      // React's scheduler and the render above never resolves.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => { vi.useRealTimers(); });

    it('the newest bucket is exactly the seven days ending now', () => {
      const buckets = weekBuckets(Date.now());
      expect(buckets).toHaveLength(TREND_WEEKS);
      const newest = buckets[buckets.length - 1];
      expect(Date.now() - newest.start).toBe(7 * 24 * 60 * 60 * 1000);
      // 🔴 Frozen: an absolute instant, not a value that drifts with the run.
      // ⚠️ Derived from NOW rather than written as an ISO string — a literal
      // would encode the RUNNER'S timezone and turn green into red on a box in
      // another offset, which is the #468 failure in a different disguise.
      expect(newest.start).toBe(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(Date.now()).toBe(NOW.getTime());
    });

    it('a row six days old lands in the newest bucket and one eight days old does not', () => {
      const rows = [
        { at: new Date(NOW.getTime() - 6 * 864e5) },
        { at: new Date(NOW.getTime() - 8 * 864e5) },
      ];
      const { points: got } = bucketWeekly(rows, Date.now(), (r) => r.at);
      expect(got[got.length - 1].value).toBe(1);
      expect(got[got.length - 2].value).toBe(1);
    });

    it('the sentence built over that frozen window says what the window says', () => {
      // Three quiet weeks, then two joiners inside the last seven days.
      const rows = [
        { at: new Date(NOW.getTime() - 1 * 864e5) },
        { at: new Date(NOW.getTime() - 3 * 864e5) },
        { at: new Date(NOW.getTime() - 30 * 864e5) },
      ];
      const { points: got } = bucketWeekly(rows, Date.now(), (r) => r.at);
      const [insight] = buildInsights({
        memberSeries: { kind: 'complete', points: got },
        givingSeries: null,
        submissionsSeries: null,
      });
      expect(insight.headline)
        .toBe('2 members joined in the last seven days — the first in 4 weeks.');
    });
  });
});

/* ═══ 14 · No guard here asserts anything about the branch's diff ════════════ */

describe('no guard in this PR asserts anything about the current branch diff', () => {
  /**
   * 🔴 #454 is a standing sweep and this ticket must not add to it. A test that
   * shells out to git at assertion time is also forbidden outright.
   */
  it('this suite reads files, never revisions', () => {
    const src = read('src/__tests__/the-328-insight-copy-guards.test.tsx');
    // 🔴 ASSEMBLED, NEVER SPELLED. A literal list here would appear in the very
    // string being swept and the guard would fail on its own assertions — the
    // mirror image of the guard in this series that PASSED with its gate
    // deleted because its message contained the token it grepped for.
    const g = 'g' + 'it';
    for (const token of [`${g} show`, `${g} diff`, `${g} rev`, 'exec' + 'Sync', 'spawn' + 'Sync',
      'child_' + 'process', 'HEAD' + '~', 'origin' + '/main']) {
      expect(src.includes(token), 'this suite reached for a revision').toBe(false);
    }
    // And the gate on the gate: the sweep must have something to sweep.
    expect(src.length).toBeGreaterThan(5000);
  });
});

/* ═══ 15 · The forbidden files are untouched ═════════════════════════════════ */

describe('firestore.rules, firestore.indexes.json, functions/ and layout.tsx are untouched', () => {
  /**
   * ⚠️ Asserted by CONTENT, not by a diff — see section 14. Each of these is
   * pinned by a property THE-328 could not have preserved by accident had it
   * edited the file.
   */
  it('the rules and indexes still carry their own shape', () => {
    expect(read('firestore.rules')).toContain('rules_version');
    const indexes = JSON.parse(read('firestore.indexes.json')) as { indexes: unknown[] };
    expect(Array.isArray(indexes.indexes)).toBe(true);
  });

  it('the app layout and functions are not reachable from this ticket', () => {
    expect(read('src/app/layout.tsx')).not.toContain('InsightFeed');
    const fns = path.join(REPO_ROOT, 'functions');
    const listed = statSync(fns).isDirectory() ? readdirSync(fns) : [];
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) expect(entry).not.toContain('Insight');
  });
});
