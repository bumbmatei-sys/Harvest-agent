/**
 * THE-308 — the events month view: what it draws, and what it refuses to.
 *
 * The fence is `src/__tests__/the-308-guards.test.ts`; the measured claims are
 * in `src/components/__tests__/THE-308.month-view.layout.test.tsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ═════════════════════════════════════════════════════════════════════════════
   The recorder. THE-276's shape, so a read's PATH and its constraints are both
   assertable — this ticket's whole read claim is about what constraints are
   ABSENT, which a recorder that only captured paths could not express.
   ═══════════════════════════════════════════════════════════════════════════ */

type BuiltQuery = {
  path: string[];
  where: Array<[string, string, unknown]>;
  orderBy: Array<[string, string]>;
  limit: number | null;
};

const { built, aggregated, fetched, counts, docsFor } = vi.hoisted(() => ({
  built: [] as BuiltQuery[],
  aggregated: [] as string[],
  fetched: [] as string[],
  counts: new Map<string, number | Error>(),
  docsFor: new Map<string, Array<Record<string, unknown>>>(),
}));

const keyOf = (q: BuiltQuery) => q.path.join('/');

vi.mock('../../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments }),
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] as [string, string, unknown] }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: string, dir: string) => ({ __orderBy: [field, dir] as [string, string] }),
  doc: (_db: unknown, ...segments: string[]) => ({ __doc: segments.join('/') }),
  query: (base: { __path: string[] }, ...constraints: Array<Record<string, unknown>>) => {
    const q: BuiltQuery = {
      path: base.__path,
      where: constraints.filter((c) => '__where' in c).map((c) => c.__where as [string, string, unknown]),
      orderBy: constraints.filter((c) => '__orderBy' in c).map((c) => c.__orderBy as [string, string]),
      limit: (constraints.find((c) => '__limit' in c)?.__limit as number) ?? null,
    };
    built.push(q);
    return q;
  },
  getCountFromServer: async (q: BuiltQuery) => {
    aggregated.push(keyOf(q));
    const answer = counts.get(keyOf(q));
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`no count configured for ${keyOf(q)}`);
    return { data: () => ({ count: answer }) };
  },
  getDocs: async (q: BuiltQuery) => {
    fetched.push(keyOf(q));
    const rows = docsFor.get(keyOf(q)) ?? [];
    return {
      docs: rows.map((row, i) => {
        const { __id: pinned, ...data } = row as Record<string, unknown> & { __id?: string };
        return { id: typeof pinned === 'string' ? pinned : `doc-${i}`, data: () => data };
      }),
    };
  },
  getDoc: async () => ({ exists: () => false, data: () => undefined }),
  serverTimestamp: () => ({ __server: true }),
  Timestamp: { fromDate: (d: Date) => ts(d) },
}));

const EventMonthView = (await import('../EventMonthView')).default;
const {
  EVENTS_MONTH_CEILING,
  dayKey,
  daysWithEvents,
  eventStart,
  eventsByDay,
  eventsOn,
  readMonthEvents,
  toMonthEvent,
} = await import('../month-view');

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** A Firestore `Timestamp`, as the SDK hands one back: `toDate()` and `seconds`. */
function ts(d: Date) {
  return { toDate: () => d, seconds: Math.floor(d.getTime() / 1000), toMillis: () => d.getTime() };
}

const SEPT = new Date(2026, 8, 15, 12, 0, 0); // Tue 15 Sep 2026, local
const EVENTS_PATH = 'tenants/grace/events';

const sundayGathering = {
  __id: 'e-sunday',
  title: 'Sunday Morning Gathering',
  startDate: ts(new Date(2026, 8, 13, 10, 30)),
  status: 'published',
  location: 'Main hall',
  isOnline: false,
  registrationEnabled: true,
};

const prayerMeeting = {
  __id: 'e-prayer',
  title: 'Midweek Prayer',
  startDate: ts(new Date(2026, 8, 16, 19, 0)),
  status: 'draft',
  location: '',
  isOnline: true,
  registrationEnabled: false,
};

const alsoOnSunday = {
  __id: 'e-baptism',
  title: 'Baptism Service',
  startDate: ts(new Date(2026, 8, 13, 16, 0)),
  status: 'published',
  location: 'Riverside',
  isOnline: false,
};

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
  return container;
}

beforeEach(() => {
  built.length = 0; aggregated.length = 0; fetched.length = 0;
  counts.clear(); docsFor.clear();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
});

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const bodyText = () => text(container);

/* ═══ 1 · real events, or an explicit empty state ══════════════════════════ */

describe('1 · the month view renders real events, or an explicit empty state', () => {
  it('🔴 draws the events of the selected day, by title', async () => {
    await mount(
      <EventMonthView
        loading={false}
        today={new Date(2026, 8, 13, 9, 0)}
        read={{
          kind: 'complete',
          undated: 0,
          events: [
            toMonthEvent(sundayGathering, 'e-sunday'),
            toMonthEvent(alsoOnSunday, 'e-baptism'),
            toMonthEvent(prayerMeeting, 'e-prayer'),
          ],
        }}
      />,
    );
    expect(bodyText()).toContain('Sunday Morning Gathering');
    expect(bodyText()).toContain('Baptism Service');
    // The 16th is a different day — it is on the grid, not in the day panel.
    expect(text(container.querySelector('[data-day-panel]'))).not.toContain('Midweek Prayer');
  });

  it('marks the days that carry events, and only those', async () => {
    await mount(
      <EventMonthView
        loading={false}
        today={new Date(2026, 8, 13, 9, 0)}
        read={{
          kind: 'complete',
          undated: 0,
          events: [toMonthEvent(sundayGathering, 'e-sunday'), toMonthEvent(prayerMeeting, 'e-prayer')],
        }}
      />,
    );
    const marked = [...container.querySelectorAll('[data-event-count]')];
    expect(marked).toHaveLength(2);
    expect(marked.map((m) => m.getAttribute('data-event-count'))).toEqual(['1', '1']);
  });

  it('and a day with two events counts two, not one', async () => {
    await mount(
      <EventMonthView
        loading={false}
        today={new Date(2026, 8, 13, 9, 0)}
        read={{
          kind: 'complete',
          undated: 0,
          events: [toMonthEvent(sundayGathering, 'e-sunday'), toMonthEvent(alsoOnSunday, 'e-baptism')],
        }}
      />,
    );
    const marked = [...container.querySelectorAll('[data-event-count]')];
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-event-count')).toBe('2');
  });

  it('🔴 a day with nothing on it draws an `empty`, not a blank', async () => {
    await mount(
      <EventMonthView
        loading={false}
        today={new Date(2026, 8, 20, 9, 0)}
        read={{ kind: 'complete', undated: 0, events: [toMonthEvent(sundayGathering, 'e-sunday')] }}
      />,
    );
    expect(container.querySelector('[data-slot="empty"]')).toBeTruthy();
    expect(bodyText()).toContain('Nothing scheduled');
  });

  it('🔴 and a read that is not provably complete SAYS so — it does not draw a quiet month', async () => {
    await mount(
      <EventMonthView loading={false} read={{ kind: 'unavailable', reason: 'Too many to chart' }} />,
    );
    expect(container.querySelector('[data-slot="empty"]')).toBeTruthy();
    expect(bodyText()).toContain('unavailable');
    expect(bodyText()).toContain('Too many to chart');
    // ⚠️ And it must NOT have drawn a grid: an empty grid and an unreadable one
    // are the same picture, which is the whole defect.
    expect(container.querySelector('table')).toBeNull();
  });

  it('says how many events carry no date rather than dropping them silently', async () => {
    await mount(
      <EventMonthView
        loading={false}
        today={SEPT}
        read={{ kind: 'complete', undated: 3, events: [toMonthEvent(sundayGathering, 'e-sunday')] }}
      />,
    );
    expect(bodyText()).toContain('3 events have no date set');
  });

  it('and draws `skeleton` while the read is in flight, never a zero', async () => {
    await mount(<EventMonthView loading read={undefined} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(bodyText()).not.toContain('Nothing scheduled');
  });
});

/* ═══ 2 · 🔴 no demo or seeded data reaches the render ═════════════════════ */

describe('2 · no demo or seeded data reaches the render', () => {
  const HERE = path.resolve(__dirname, '../../../..');
  const src = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');
  const ADDED = [
    'src/components/events/month-view.ts',
    'src/components/events/EventMonthView.tsx',
    'src/hooks/queries/useMonthEvents.ts',
  ];

  /**
   * ⚠️ THE-299 found `cohort-chart` "defaults `data` to seeded demo data" and
   * had to strip it. Nothing was installed here, so there was no demo payload
   * to remove — but the claim worth making is not "we removed it", it is that
   * NONE reaches the screen, and that is asserted the same way either way.
   */
  it('🔴 no added file carries a seeded fixture, a faker, or lorem', () => {
    for (const file of ADDED) {
      const code = src(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${file} imports a faker`).not.toMatch(/faker|@faker-js/i);
      expect(code, `${file} carries lorem text`).not.toMatch(/lorem|ipsum/i);
      expect(code, `${file} names a demo/sample/seed default`)
        .not.toMatch(/\b(demoData|sampleData|seedData|placeholderEvents|DEMO_|SAMPLE_|SEED_|MOCK_)/);
    }
  });

  it('🔴 with an EMPTY complete read the grid shows nothing invented', async () => {
    await mount(
      <EventMonthView loading={false} today={SEPT} read={{ kind: 'complete', undated: 0, events: [] }} />,
    );
    // The grid is drawn — a month with no events is a real answer — but not one
    // cell carries a count, and the day panel is an `empty`.
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('[data-event-count]')).toHaveLength(0);
    expect(bodyText()).toContain('Nothing scheduled');
  });

  it('and the view has no default for `read` — an absent read is not an empty month', async () => {
    await mount(<EventMonthView loading={false} read={undefined} />);
    expect(bodyText()).toContain('unavailable');
  });
});

/* ═══ 1b · 🔴 every element that has a primitive uses it ═══════════════════ */

describe('1b · every element that has a primitive uses it', () => {
  const HERE = path.resolve(__dirname, '../../../..');
  const VIEW = 'src/components/events/EventMonthView.tsx';
  const SCREEN = 'src/components/AdminEvents.tsx';
  const src = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

  /**
   * 🔴 DELIBERATELY NOT AN IMPORT COUNT. "Imports something from ui/" passes
   * the moment a file imports Button once and hand-writes the other nine
   * elements — which is how ~2,000 lines shipped across RetentionHeatmap,
   * ServicePlanPanel, ServicePlanRow, FormAnswersView, AdminSms and SmsSection.
   * So: the import must be present per primitive, AND the hand-written
   * substitute must be absent from the source.
   */
  const REQUIRED_IMPORTS: Record<string, readonly string[]> = {
    [VIEW]: ['badge', 'button', 'calendar', 'card', 'empty', 'item', 'skeleton'],
    [SCREEN]: ['tabs'],
  };

  it('each file imports every primitive its elements need', () => {
    for (const [file, names] of Object.entries(REQUIRED_IMPORTS)) {
      const code = src(file);
      for (const name of names) {
        expect(
          new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${name}['"]`).test(code),
          `${file} does not import the "${name}" primitive`,
        ).toBe(true);
      }
    }
  });

  /** The hand-written shapes each primitive replaces. A match is a DEFECT. */
  const HAND_WRITTEN: ReadonlyArray<{ pattern: RegExp; primitive: string; what: string }> = [
    {
      pattern: /<div[^>]*className=(?:"|\{`)[^"`]*\brounded-(?:brand|lg|xl)\b[^"`]*\bborder\b[^"`]*(?:"|`\})/,
      primitive: 'card',
      what: 'a rounded, bordered box',
    },
    {
      pattern: /<button[^>]*className=(?:"|\{`)[^"`]*\brounded-[\w[\]-]+\b[^"`]*(?:"|`\})/,
      primitive: 'button',
      what: 'a bare <button> with its own rounded styling',
    },
    {
      pattern: /className=(?:"|\{`)[^"`]*\bfixed\b[^"`]*\binset-0\b[^"`]*(?:"|`\})/,
      primitive: 'dialog',
      what: 'a hand-rolled modal scrim',
    },
    {
      // 🔴 THE ONE THIS TICKET IS REALLY ABOUT. Seven columns of hand-built
      // cells is a month grid, retyped — and `calendar` already is one, with
      // the roving focus and grid semantics the retype would not carry.
      pattern: /grid-cols-7|\bgridTemplateColumns\b/,
      primitive: 'calendar',
      what: 'a hand-built seven-column month grid',
    },
    {
      // A row of things with its own flex/padding chrome is an Item.
      pattern: /<div[^>]*className=(?:"|\{`)[^"`]*\bflex\b[^"`]*\bitems-center\b[^"`]*\bpx-3\b[^"`]*\bpy-2/,
      primitive: 'item',
      what: 'a hand-laid row',
    },
    {
      // A status pill drawn by hand.
      pattern: /<span[^>]*className=(?:"|\{`)[^"`]*\brounded-full\b[^"`]*(?:"|`\})/,
      primitive: 'badge',
      what: 'a hand-drawn status pill',
    },
    {
      pattern: /\banimate-pulse\b/,
      primitive: 'skeleton',
      what: 'a hand-rolled loading shimmer',
    },
  ];

  it('🔴 and no hand-written substitute for a primitive survives in the month view', () => {
    // Comments are stripped: the header QUOTES the markup it replaced, and a
    // guard that read prose would fail on its own documentation.
    const code = src(VIEW).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const { pattern, primitive, what } of HAND_WRITTEN) {
      expect(
        pattern.test(code),
        `EventMonthView.tsx hand-writes ${what} — the "${primitive}" primitive covers it`,
      ).toBe(false);
    }
  });

  it('🔴 the month GRID is the calendar primitive, not markup that looks like one', () => {
    const code = src(VIEW);
    expect(code, 'the grid is not <Calendar>').toMatch(/<Calendar\b/);
    // And the day cell EXTENDS the primitive's own button rather than replacing
    // it — the difference between composing and reimplementing.
    expect(code, 'the day cell is not CalendarDayButton').toMatch(/<CalendarDayButton\b/);
  });

  it('the day rows are Items that ARE the tap target, not Items wrapping one', () => {
    // THE-316's defect: an Item containing a button splits the row into a large
    // box holding a small target.
    expect(src(VIEW)).toMatch(/render:\s*<button type="button"/);
  });

  it('🔵 and popover — the primitive deliberately rejected — is named with its reason', () => {
    // "It did not fit" without a named primitive and a reason is not an answer.
    const header = src(VIEW).slice(0, src(VIEW).indexOf("'use client'"));
    expect(header).toMatch(/popover/i);
    expect(header, 'the rejection gives no reason').toMatch(/44px cell|thumb|transient/i);
  });

  it('and the view carries no inline style at all', () => {
    const code = src(VIEW).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/style=\{\{/);
  });
});

/* ═══ 6 · 🔴 the events read is exact or provably complete ═════════════════ */

describe('6 · the events read is exact or provably complete', () => {
  it('🔴 counts FIRST, and only then loads', async () => {
    counts.set(EVENTS_PATH, 3);
    docsFor.set(EVENTS_PATH, [sundayGathering, prayerMeeting, alsoOnSunday]);

    const read = await readMonthEvents('grace');

    expect(aggregated).toEqual([EVENTS_PATH]);
    expect(fetched).toEqual([EVENTS_PATH]);
    expect(read.kind).toBe('complete');
    if (read.kind !== 'complete') throw new Error('unreachable');
    expect(read.events.map((e) => e.id).sort()).toEqual(['e-baptism', 'e-prayer', 'e-sunday']);
  });

  it('🔴 issues NO orderBy and NO where — so no composite index is required', async () => {
    counts.set(EVENTS_PATH, 1);
    docsFor.set(EVENTS_PATH, [sundayGathering]);
    await readMonthEvents('grace');

    const forEvents = built.filter((b) => keyOf(b) === EVENTS_PATH);
    expect(forEvents.length, 'the events query was never built').toBeGreaterThan(0);
    for (const b of forEvents) {
      expect(b.orderBy, 'the month read issued an orderBy').toEqual([]);
      expect(b.where, 'the month read issued a where').toEqual([]);
    }
  });

  /**
   * 🔴 THE FIXTURE IS ABOVE ANY PAGE SIZE. 250 events is larger than the
   * list's own `limit(100)` and larger than any page a reader would guess, so
   * a read that truncated ANYWHERE would drop rows this test names by id.
   */
  it('🔴 holds a fixture far above any page size, whole', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      __id: `e-${i}`,
      title: `Event ${i}`,
      // Spread across September 2026 so every one lands on the grid.
      startDate: ts(new Date(2026, 8, (i % 28) + 1, 9, 0)),
      status: 'published',
    }));
    counts.set(EVENTS_PATH, 250);
    docsFor.set(EVENTS_PATH, many);

    const read = await readMonthEvents('grace');
    expect(read.kind).toBe('complete');
    if (read.kind !== 'complete') throw new Error('unreachable');
    expect(read.events).toHaveLength(250);
    expect(read.events.map((e) => e.id)).toContain('e-0');
    expect(read.events.map((e) => e.id)).toContain('e-249');

    // And every one of the 28 days carries its share — nothing was dropped in
    // the middle, which a length check alone would not catch.
    const byDay = eventsByDay(read.events);
    expect(daysWithEvents(byDay, new Date(2026, 8, 1))).toHaveLength(28);
    expect([...byDay.values()].reduce((n, l) => n + l.length, 0)).toBe(250);
  });

  it('🔴 above the ceiling it refuses ROWS rather than truncating them', async () => {
    counts.set(EVENTS_PATH, EVENTS_MONTH_CEILING + 1);
    docsFor.set(EVENTS_PATH, [sundayGathering]);

    const read = await readMonthEvents('grace');

    expect(read.kind).toBe('unavailable');
    // 🔴 And it did not pay for a page it was going to refuse.
    expect(fetched, 'it fetched documents it had already decided to refuse').toEqual([]);
  });

  it('a failed aggregation is `unavailable` too — never an empty month', async () => {
    counts.set(EVENTS_PATH, new Error('permission-denied'));
    const read = await readMonthEvents('grace');
    expect(read.kind).toBe('unavailable');
    expect(fetched).toEqual([]);
  });

  it('and the bounded query carries the ceiling the count gate uses', async () => {
    counts.set(EVENTS_PATH, 1);
    docsFor.set(EVENTS_PATH, []);
    await readMonthEvents('grace');
    const bounded = built.filter((b) => keyOf(b) === EVENTS_PATH && b.limit !== null);
    expect(bounded.length).toBeGreaterThan(0);
    for (const b of bounded) expect(b.limit).toBe(EVENTS_MONTH_CEILING);
  });
});

/* ═══ 7 · the timestamp discipline ════════════════════════════════════════ */

describe('7 · one timestamp type, and anything else is refused', () => {
  it('reads a Firestore Timestamp', () => {
    const d = new Date(2026, 8, 13, 10, 30);
    expect(eventStart(ts(d))?.getTime()).toBe(d.getTime());
  });

  it('reads the `seconds` form the SDK also hands back', () => {
    expect(eventStart({ seconds: 1789000000 })?.getTime()).toBe(1789000000 * 1000);
  });

  it('🔴 REFUSES an ISO string rather than parsing it', () => {
    // If a string ever reached startDate the single-writer invariant would have
    // broken. Parsing it would place the event on a day the schema says cannot
    // exist, and the grid would look correct.
    expect(eventStart('2026-09-13T10:30:00.000Z')).toBeNull();
    expect(eventStart(1789000000000)).toBeNull();
  });

  it('and null / undefined / a broken Date are all just "undated"', () => {
    expect(eventStart(null)).toBeNull();
    expect(eventStart(undefined)).toBeNull();
    expect(eventStart({ toDate: () => new Date('nonsense') })).toBeNull();
  });

  it('🔴 an undated event lands on NO day and is counted, not dropped', async () => {
    counts.set(EVENTS_PATH, 2);
    docsFor.set(EVENTS_PATH, [sundayGathering, { __id: 'e-nodate', title: 'Undated', status: 'draft' }]);
    const read = await readMonthEvents('grace');
    expect(read.kind).toBe('complete');
    if (read.kind !== 'complete') throw new Error('unreachable');
    expect(read.undated).toBe(1);
    expect(eventsByDay(read.events).size).toBe(1);
  });

  it('buckets by LOCAL day, not by UTC — `toISOString` would move an evening event', () => {
    // A 23:00 local event in a positive-offset zone is the next day in UTC.
    const late = new Date(2026, 8, 13, 23, 30);
    expect(dayKey(late)).toBe('2026-09-13');
  });

  it('and a day\'s events come back in time order', () => {
    const byDay = eventsByDay([
      toMonthEvent(alsoOnSunday, 'e-baptism'),   // 16:00
      toMonthEvent(sundayGathering, 'e-sunday'), // 10:30
    ]);
    expect(eventsOn(byDay, new Date(2026, 8, 13)).map((e) => e.id))
      .toEqual(['e-sunday', 'e-baptism']);
  });
});

/* ═══ 12 · dialogs open above z-100 ═══════════════════════════════════════ */

describe('12 · the layering the bottom nav forces', () => {
  const HERE = path.resolve(__dirname, '../../../..');
  const src = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

  it('the dialog primitive still opens above the z-[100] bottom nav', () => {
    // #437 raised these; this ticket relies on them and changes neither.
    const dialog = src('src/components/ui/dialog.tsx');
    expect(dialog, 'the scrim fell back below the nav').toContain('z-[101]');
    expect(dialog, 'the panel fell back below the nav').toContain('z-[102]');
    expect(dialog).not.toContain('z-50');
  });

  it('🔴 and the month view opens no layer of its own to get this wrong', () => {
    const view = src('src/components/events/EventMonthView.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(view, 'the month view introduced its own z-index').not.toMatch(/\bz-\[?\d/);
    expect(view, 'the month view introduced a fixed overlay').not.toMatch(/\bfixed\b/);
  });
});
