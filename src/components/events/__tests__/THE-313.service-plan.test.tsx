import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  DEFAULT_ITEM_MINUTES,
  MAX_PLAN_ITEMS,
  buildRunSheetText,
  emptyItem,
  fmtClock,
  isTemplateShape,
  itemClockTimes,
  itemsFromTemplate,
  moveItem,
  orderedItems,
  findDoubleBookings,
  planEndsAt,
  planFromTemplate,
  planTotalMinutes,
  renumber,
  reorderItems,
  templateFromPlan,
  type ServicePlanItem,
} from '../service-plan';
import { ItemRow } from '../ServicePlanRow';

/**
 * THE-313 — the order of service, part 1 of 3. What it actually does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 SECTION 2 IS THE TICKET. Everything else here is a boundary around it.
 *
 * A church's order of service today is a document somebody emails round on
 * Thursday, and the one thing that document cannot do is recalculate. Move the
 * notices from four minutes to seven and every time after them is wrong,
 * silently, on the copy in twenty inboxes. So the assertion that matters is not
 * "a plan can hold items" — it is that CHANGING ONE DURATION MOVES EVERYTHING
 * AFTER IT, and section 2 asserts it by changing a duration and reading the
 * clock times of the rows below.
 *
 * ⚠️ Mutation-verified while this file was written: setting `itemClockTimes` to
 * hand every row `start` unchanged — i.e. a run sheet that does NOT recalculate
 * — fails section 2 and nothing else in the suite. Removing the ArrowUp /
 * ArrowDown branch from `ServicePlanPanel` fails section 4 and nothing else.
 * Letting `itemsFromTemplate` carry `personId` through fails section 5 alone.
 * Writing a second timestamp representation fails section 8 alone. Each was
 * reverted and the suite is green.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THE ARITHMETIC IS TESTED WITHOUT A COMPONENT.
 *
 * `itemClockTimes`, `reorderItems`, `moveItem` and `overlappingAssignments` are
 * plain functions in `service-plan.ts` precisely so that part 2 (volunteer
 * rotas) can ask them without rendering — a double-booking warning is a
 * question about the clock, and a rule that lives inside a component can only
 * be re-implemented by the ticket that comes after it. Testing them as
 * functions is testing them the way part 2 will use them.
 *
 * The COMPONENT sections (4 and 6) exist for the things that are genuinely
 * about the DOM: that the keyboard path reaches a real focusable control and
 * moves the item, and that the share surface hands the run sheet to the
 * mechanism rather than to a URL builder.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The three files this ticket adds, read from disk.
 *
 * ⚠️ `path.join(__dirname, …)`, NOT `new URL(…, import.meta.url)`: under
 * vitest's transform `import.meta.url` is not a `file:` URL and `readFileSync`
 * rejects it outright.
 */
const HERE = path.resolve(__dirname);
const SRC = {
  plan: path.join(HERE, '../service-plan.ts'),
  panel: path.join(HERE, '../ServicePlanPanel.tsx'),
  row: path.join(HERE, '../ServicePlanRow.tsx'),
  queries: path.join(HERE, '../../../hooks/queries/useServicePlanQueries.ts'),
} as const;

const read = (file: string): string => readFileSync(file, 'utf8');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (file: string): string =>
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ═════════════════════════════════════════════════════════════════════════════
   Fixtures. A real Sunday morning, with durations that do not divide evenly —
   a fixture of five ten-minute items would pass an implementation that ignored
   the durations entirely and just multiplied by the index.
   ═══════════════════════════════════════════════════════════════════════════ */

const START = new Date(2026, 8, 6, 10, 0, 0); // Sunday 6 September 2026, 10:00 local.

const item = (
  id: string,
  title: string,
  minutes: number,
  order: number,
  extra: Partial<ServicePlanItem> = {},
): ServicePlanItem => ({
  id, title, minutes, order, personId: null, personName: null, note: null, ...extra,
});

const SUNDAY: ServicePlanItem[] = [
  item('a', 'Welcome', 3, 0, { personId: 'u-pastor', personName: 'Ada Pastor' }),
  item('b', 'Worship set', 22, 1, { personId: 'u-lead', personName: 'Ben Lead', note: 'Key of G' }),
  item('c', 'Notices', 4, 2),
  item('d', 'Sermon', 31, 3, { personId: 'u-pastor', personName: 'Ada Pastor' }),
  item('e', 'Response', 9, 4),
];

/** The clock label of every row, in order. The suite's one shared reading. */
const clockLabels = (items: readonly ServicePlanItem[], start: Date | null): string[] =>
  itemClockTimes(items, start).map((c) => fmtClock(c.startsAt));

/* ═════════════════════════════════════════════════════════════════════════════
   1. A plan can be created against an event, with ordered items.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a plan can be created against an event, with ordered items', () => {
  it('a fresh plan is one blank item at order 0', () => {
    const first = emptyItem(0);
    expect(first.order).toBe(0);
    expect(first.minutes).toBe(DEFAULT_ITEM_MINUTES);
    expect(first.personId).toBeNull();
    expect(first.id).toMatch(/^[a-z0-9]+$/);
  });

  it('two items created in the same tick still get distinct ids', () => {
    // The ids key part 2's rota rows. A collision there assigns one volunteer's
    // slot to another item, so this is asserted rather than assumed of Math.random.
    const ids = new Set(Array.from({ length: 500 }, (_, i) => emptyItem(i).id));
    expect(ids.size).toBe(500);
  });

  it('items come back in their own order regardless of the array they arrive in', () => {
    const shuffled = [SUNDAY[3], SUNDAY[0], SUNDAY[4], SUNDAY[1], SUNDAY[2]];
    expect(orderedItems(shuffled).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('renumber makes order contiguous from zero after any mutation', () => {
    const withoutMiddle = SUNDAY.filter((i) => i.id !== 'c');
    expect(renumber(withoutMiddle).map((i) => i.order)).toEqual([0, 1, 2, 3]);
  });

  it('a plan bounded at MAX_PLAN_ITEMS is a bound on the UI, not a Firestore limit', () => {
    expect(MAX_PLAN_ITEMS).toBeGreaterThan(20);
    expect(MAX_PLAN_ITEMS).toBeLessThanOrEqual(200);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   2. 🔴 THE TICKET. Clock times derive, and one duration moves everything after.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("each item's clock time derives from the start time plus preceding durations", () => {
  it('the first item starts at the service start, and each next one after the last', () => {
    // 10:00 +3 → 10:03 +22 → 10:25 +4 → 10:29 +31 → 11:00
    expect(clockLabels(SUNDAY, START)).toEqual(['10:00', '10:03', '10:25', '10:29', '11:00']);
  });

  it('an item ends where the next one begins — no gap and no overlap', () => {
    const clocks = itemClockTimes(SUNDAY, START);
    for (let i = 1; i < clocks.length; i++) {
      expect(clocks[i].startsAt!.getTime()).toBe(clocks[i - 1].endsAt!.getTime());
    }
  });

  it('the service ends at the start plus every duration', () => {
    expect(planTotalMinutes(SUNDAY)).toBe(69);
    expect(fmtClock(planEndsAt(SUNDAY, START))).toBe('11:09');
  });

  /**
   * 🔴 THIS IS THE FEATURE, AND THIS IS THE MUTATION THAT PROVES IT.
   *
   * Lengthen the worship set by eight minutes. Everything above it must not
   * move; everything below it must move by exactly eight. An implementation
   * that stored clock times, or that computed them from anything other than the
   * durations above each row, fails here and passes every other test in the file.
   */
  it('changing ONE duration moves every clock time after it, and none before it', () => {
    const before = clockLabels(SUNDAY, START);
    expect(before).toEqual(['10:00', '10:03', '10:25', '10:29', '11:00']);

    const longerWorship = SUNDAY.map((i) => (i.id === 'b' ? { ...i, minutes: 30 } : i));
    const after = clockLabels(longerWorship, START);

    // Untouched above the change.
    expect(after.slice(0, 2)).toEqual(['10:00', '10:03']);
    // Moved by exactly the eight minutes that were added, below it.
    expect(after.slice(2)).toEqual(['10:33', '10:37', '11:08']);
    // And the whole service is eight minutes longer.
    expect(planTotalMinutes(longerWorship)).toBe(planTotalMinutes(SUNDAY) + 8);
    expect(fmtClock(planEndsAt(longerWorship, START))).toBe('11:17');
  });

  it('shortening a duration moves the rest EARLIER by the same amount', () => {
    const shorterSermon = SUNDAY.map((i) => (i.id === 'd' ? { ...i, minutes: 21 } : i));
    expect(clockLabels(shorterSermon, START)).toEqual(['10:00', '10:03', '10:25', '10:29', '10:50']);
  });

  it('a reorder moves clock times too — the sequence is what the clock reads', () => {
    // Move the sermon (index 3) to the top. Every clock time is redealt.
    const moved = reorderItems(SUNDAY, 3, 0);
    expect(moved.map((i) => i.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(clockLabels(moved, START)).toEqual(['10:00', '10:31', '10:34', '10:56', '11:00']);
  });

  it('a zero-minute item occupies no clock time and does not move the row after it', () => {
    const withZero = renumber([...SUNDAY.slice(0, 2), item('z', 'Silence', 0, 99), ...SUNDAY.slice(2)]);
    const labels = clockLabels(withZero, START);
    expect(labels[2]).toBe('10:25');
    expect(labels[3]).toBe('10:25');
  });

  it('an event with no start time yields offsets and no clocks, rather than inventing one', () => {
    const clocks = itemClockTimes(SUNDAY, null);
    expect(clocks.map((c) => c.startsAt)).toEqual([null, null, null, null, null]);
    expect(clocks.map((c) => c.offsetMinutes)).toEqual([0, 3, 25, 29, 60]);
    expect(planEndsAt(SUNDAY, null)).toBeNull();
    // And the label degrades rather than throwing.
    expect(fmtClock(null)).toBe('--:--');
  });

  it('the clock crosses midnight without wrapping the date', () => {
    const lateStart = new Date(2026, 8, 6, 23, 50, 0);
    expect(clockLabels(SUNDAY, lateStart)).toEqual(['23:50', '23:53', '00:15', '00:19', '00:50']);
  });

  /**
   * ⚠️ Written now, in the ticket that owns the arithmetic, for part 2's
   * double-booking warning — and asserted here because part 2 will TRUST it.
   *
   * 🔴 A CLASH IS IMPOSSIBLE WITHIN ONE PLAN, BY CONSTRUCTION. The items of a
   * run sheet are laid end to end, so Ada opening the service AND preaching is
   * one person doing two things in a row. A real clash is two PLANS — the 9am
   * and the 10:30 that overruns into it — which is why the function takes many.
   */
  it('the same person twice in ONE plan is never a clash, however the plan is shaped', () => {
    expect(findDoubleBookings([{ planId: 'p1', items: SUNDAY, start: START }])).toEqual([]);
    // Even with two zero-minute rows, which occupy no clock time at all.
    const zeroed = SUNDAY.map((i) => ({ ...i, minutes: 0 }));
    expect(findDoubleBookings([{ planId: 'p1', items: zeroed, start: START }])).toEqual([]);
  });

  it('but the same person across two overlapping plans IS one, for part 2', () => {
    const nineAm = new Date(2026, 8, 6, 9, 0, 0);
    // The 9am runs 09:00–10:09; Ben leads worship 09:03–09:25.
    // The 10:00 (START) has Ben leading worship 10:03–10:25 — no overlap.
    expect(findDoubleBookings([
      { planId: 'early', items: SUNDAY, start: nineAm },
      { planId: 'main', items: SUNDAY, start: START },
    ])).toEqual([]);

    // Move the second service to 09:10 and the two worship sets collide.
    const nineTen = new Date(2026, 8, 6, 9, 10, 0);
    const clashes = findDoubleBookings([
      { planId: 'early', items: SUNDAY, start: nineAm },
      { planId: 'main', items: SUNDAY, start: nineTen },
    ]);
    expect(clashes.length).toBeGreaterThan(0);
    const ben = clashes.find((c) => c.personId === 'u-lead')!;
    expect(ben.a.planId).toBe('early');
    expect(ben.b.planId).toBe('main');
    expect(ben.a.item.title).toBe('Worship set');
  });

  it('adjacency is not an overlap — one stage to the next is normal', () => {
    const solo = [item('x', 'Reading', 10, 0, { personId: 'u-1', personName: 'Cal' })];
    const at10 = new Date(2026, 8, 6, 10, 0, 0);
    const at1010 = new Date(2026, 8, 6, 10, 10, 0);
    expect(findDoubleBookings([
      { planId: 'a', items: solo, start: at10 },
      { planId: 'b', items: solo, start: at1010 },
    ])).toEqual([]);
    // One minute earlier and they do overlap.
    const at1009 = new Date(2026, 8, 6, 10, 9, 0);
    expect(findDoubleBookings([
      { planId: 'a', items: solo, start: at10 },
      { planId: 'b', items: solo, start: at1009 },
    ])).toHaveLength(1);
  });

  it('an undated plan is skipped rather than guessed at, and an unassigned item never clashes', () => {
    const solo = [item('x', 'Reading', 10, 0, { personId: 'u-1', personName: 'Cal' })];
    const at10 = new Date(2026, 8, 6, 10, 0, 0);
    expect(findDoubleBookings([
      { planId: 'a', items: solo, start: at10 },
      { planId: 'b', items: solo, start: null },
    ])).toEqual([]);
    const nobody = [item('x', 'Reading', 10, 0)];
    expect(findDoubleBookings([
      { planId: 'a', items: nobody, start: at10 },
      { planId: 'b', items: nobody, start: at10 },
    ])).toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   3. An item can carry a person, chosen from real people.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('an item can carry a person, chosen from real people', () => {
  /**
   * 🔴 THE NAMED SOURCE IS `users`, SCOPED BY `tenantId`. The reasoning is in
   * `useServicePlanQueries.ts`; what is asserted here is that the module says
   * so and reads nothing else, because "which collection" is the question
   * THE-299 found this repo getting wrong in `contactActivities.contactId`.
   */
  it('the people query reads `users` and never `contacts`', () => {
    const code = codeOf(SRC.queries);
    expect(code).toContain("collection(db, 'users')");
    expect(code).toContain("where('tenantId', '==', tenantId)");
    expect(code).not.toMatch(/collection\((?:db, )?'contacts'\)/);
    expect(code).not.toContain('contactActivities');
    expect(code).not.toContain('tenant_private');
  });

  it('an item holds the person id AND the name it was assigned under', () => {
    const assigned = SUNDAY[1];
    expect(assigned.personId).toBe('u-lead');
    expect(assigned.personName).toBe('Ben Lead');
  });

  it('an unassigned item is null on both, never undefined — Firestore rejects undefined', () => {
    const blank = emptyItem(0);
    expect(blank.personId).toBeNull();
    expect(blank.personName).toBeNull();
    expect(Object.values(blank)).not.toContain(undefined);
  });

  it('the person id survives a reorder, which is what part 2 keys on', () => {
    const moved = reorderItems(SUNDAY, 1, 4);
    const worship = moved.find((i) => i.id === 'b')!;
    expect(worship.personId).toBe('u-lead');
    expect(worship.order).toBe(4);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   4. 🔴 Reorder works by DRAG and by KEYBOARD.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('reorder works by drag AND by keyboard', () => {
  it('the pure move is one position, and out of range is a no-op rather than a wrap', () => {
    expect(moveItem(SUNDAY, 2, -1).map((i) => i.id)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(moveItem(SUNDAY, 2, 1).map((i) => i.id)).toEqual(['a', 'b', 'd', 'c', 'e']);
    // 🔴 First up and last down must NOT wrap — a held key at either end would
    // otherwise walk an item silently round the list.
    expect(moveItem(SUNDAY, 0, -1).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(moveItem(SUNDAY, 4, 1).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a move renumbers, so order stays contiguous and matches the array', () => {
    const moved = moveItem(SUNDAY, 0, 1);
    expect(moved.map((i) => i.order)).toEqual([0, 1, 2, 3, 4]);
    expect(moved.map((i) => i.id)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  /**
   * 🔴 THE DRAG MECHANISM IS #413's, AND THIS ASSERTS IT BY READING THE SOURCE.
   *
   * That commit's whole finding is that the commit rides on `dragend` with NO
   * `onDragOver` and NO `onDrop`, and that `stopPropagation` is split by event
   * type because an ancestor must see a `dragenter` fired inside its
   * descendants. A component that re-derived a drag from first principles would
   * pass every behavioural test in this file and be the bug #413 fixed.
   */
  it('the panel uses #413s mechanism: no onDragOver, no onDrop, commit on dragend', () => {
    const code = codeOf(SRC.panel) + codeOf(SRC.row);

    expect(code).not.toContain('onDragOver');
    expect(code).not.toContain('onDrop');
    expect(code).toContain('onDragStart');
    expect(code).toContain('onDragEnter');
    expect(code).toContain('onDragEnd');
    // dragstart and dragend stop; dragenter deliberately does not.
    expect(code).toMatch(/onDragStart=\{\(e\) => \{ e\.stopPropagation\(\)/);
    expect(code).toMatch(/onDragEnter=\{\(\) => \{ if \(dragging\.current === null\) return;/);
    // 🔴 The commit is the updater form, not a snapshot.
    expect(code).toMatch(/commit\(\(prev\) => reorderItems\(prev, from, to\)\)/);
  });

  /**
   * 🔴 THE KEYBOARD PATH, ASSERTED IN THE DOM AND NOT IN A COMMENT.
   *
   * Tab reaches a real `<button>`; ArrowUp / ArrowDown move the item; the event
   * is `preventDefault`ed so the page does not scroll away from what is moving.
   * Removing the branch fails this and nothing else.
   */
  describe('in the DOM', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });
    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    /**
     * 🔴 THE REAL `ItemRow`, NOT A REPLICA.
     *
     * An earlier draft of this test mounted a hand-written copy of the handler
     * and it PASSED with the panel's real ArrowUp/ArrowDown branch deleted —
     * which is exactly the mutation this section exists to catch. So the row
     * component is exported from `ServicePlanPanel.tsx` and mounted here. The
     * host supplies only what a row needs from its parent: the list, and the
     * `moveItem` commit the panel itself passes down.
     */
    const Host: React.FC<{ onOrder: (ids: string[]) => void }> = ({ onOrder }) => {
      const [items, setItems] = React.useState<ServicePlanItem[]>(SUNDAY);
      React.useEffect(() => { onOrder(items.map((i) => i.id)); }, [items, onOrder]);
      const noop = React.useCallback(() => {}, []);
      return (
        <div>
          {orderedItems(items).map((it, i) => (
            <ItemRow
              key={it.id}
              item={it}
              index={i}
              clock="10:00"
              people={[]}
              onChange={noop}
              onRemove={noop}
              onMove={(delta) => setItems((prev) => moveItem(prev, i, delta))}
              onDragStart={noop}
              onDragEnter={noop}
              onDragEnd={noop}
            />
          ))}
        </div>
      );
    };

    const press = (el: Element, key: string) => {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => { el.dispatchEvent(ev); });
      return ev;
    };

    it('ArrowUp on an item handle moves it one position earlier', () => {
      const seen: string[][] = [];
      act(() => { root.render(<Host onOrder={(ids) => seen.push(ids)} />); });

      const handle = container.querySelector('[data-plan-handle="2"]')!;
      expect(handle.tagName).toBe('BUTTON'); // 🔴 focusable, in tab order, by construction
      expect(handle.getAttribute('aria-label')).toBe('Move Notices');
      expect(handle.getAttribute('aria-keyshortcuts')).toBe('ArrowUp ArrowDown');

      press(handle, 'ArrowUp');
      expect(seen[seen.length - 1]).toEqual(['a', 'c', 'b', 'd', 'e']);
    });

    it('ArrowDown moves it one position later, and the key is preventDefaulted', () => {
      const seen: string[][] = [];
      act(() => { root.render(<Host onOrder={(ids) => seen.push(ids)} />); });

      const ev = press(container.querySelector('[data-plan-handle="0"]')!, 'ArrowDown');
      expect(seen[seen.length - 1]).toEqual(['b', 'a', 'c', 'd', 'e']);
      // 🔴 Otherwise the page scrolls away from the item being moved.
      expect(ev.defaultPrevented).toBe(true);
    });

    it('a key that is not an arrow does nothing and is NOT preventDefaulted', () => {
      const seen: string[][] = [];
      act(() => { root.render(<Host onOrder={(ids) => seen.push(ids)} />); });

      const ev = press(container.querySelector('[data-plan-handle="0"]')!, 'Enter');
      expect(seen[seen.length - 1]).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(ev.defaultPrevented).toBe(false);
    });

    it('the row ships that exact handler — the mounted component is the real one', () => {
      const src = read(SRC.row);
      expect(src).toContain("if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;");
      expect(src).toContain("onMove(e.key === 'ArrowUp' ? -1 : 1);");
      expect(src).toContain('aria-keyshortcuts="ArrowUp ArrowDown"');
      expect(src).toContain('data-plan-handle={index}');
      // 🔴 The handle is a <button>: focusable and in the tab order with no
      // tabIndex of its own. A <div role="button"> would need one and would be
      // the mouse-only reorder this ticket forbids.
      expect(src).toMatch(/<button\s+type="button"\s+data-plan-handle=/);
      // And the PANEL keys its rows by item id, which is what preserves focus
      // across the move — a key of `index` would rebuild the focused node.
      expect(read(SRC.panel)).toContain('key={item.id}');
    });
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   5. A template creates a plan without carrying people or a date.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a template creates a plan without carrying people or a date', () => {
  const TEMPLATE = { name: 'Sunday Morning', items: SUNDAY };

  it('is ONE data model: a template is a plan with eventId null', () => {
    const template = templateFromPlan({ items: SUNDAY }, 'Sunday Morning', 't1');
    expect(template.eventId).toBeNull();
    expect(template.isTemplate).toBe(true);
    expect(isTemplateShape(template)).toBe(true);

    const plan = planFromTemplate(TEMPLATE, 'evt-1', 't1');
    expect(plan.eventId).toBe('evt-1');
    expect(plan.isTemplate).toBe(false);
    expect(isTemplateShape(plan)).toBe(true);
  });

  /** 🔴 The mutation: let a template carry a person and this is what fails. */
  it('carries NO person, in either direction', () => {
    const template = templateFromPlan({ items: SUNDAY }, 'Sunday Morning', 't1');
    expect(template.items.map((i) => i.personId)).toEqual([null, null, null, null, null]);
    expect(template.items.map((i) => i.personName)).toEqual([null, null, null, null, null]);

    const plan = planFromTemplate(TEMPLATE, 'evt-1', 't1');
    expect(plan.items.map((i) => i.personId)).toEqual([null, null, null, null, null]);
    expect(plan.items.map((i) => i.personName)).toEqual([null, null, null, null, null]);
    // …even though the source plan had two people on it.
    expect(SUNDAY.filter((i) => i.personId).length).toBe(3);
  });

  it('carries NO date, because an item has no date field to carry', () => {
    const plan = planFromTemplate(TEMPLATE, 'evt-1', 't1');
    for (const it of plan.items) {
      expect(Object.keys(it).sort())
        .toEqual(['id', 'minutes', 'note', 'order', 'personId', 'personName', 'title']);
    }
    // The clock comes from the EVENT, so a plan started from a template has one
    // as soon as it is attached to a dated event and none before.
    expect(clockLabels(plan.items, START)).toEqual(['10:00', '10:03', '10:25', '10:29', '11:00']);
    expect(itemClockTimes(plan.items, null).every((c) => c.startsAt === null)).toBe(true);
  });

  it('carries the titles, the durations, the notes and the ORDER', () => {
    const plan = planFromTemplate(TEMPLATE, 'evt-1', 't1');
    expect(plan.items.map((i) => i.title)).toEqual(SUNDAY.map((i) => i.title));
    expect(plan.items.map((i) => i.minutes)).toEqual(SUNDAY.map((i) => i.minutes));
    expect(plan.items.map((i) => i.note)).toEqual(SUNDAY.map((i) => i.note));
    expect(plan.items.map((i) => i.order)).toEqual([0, 1, 2, 3, 4]);
    expect(plan.name).toBe('Sunday Morning');
  });

  /**
   * 🔴 Fresh ids. Two plans started from one template must not share item ids,
   * or part 2's `(planId, itemId)` assignment becomes ambiguous the second time
   * a church uses its own template.
   */
  it('gives every item a FRESH id, so two plans from one template do not collide', () => {
    const one = itemsFromTemplate(SUNDAY).map((i) => i.id);
    const two = itemsFromTemplate(SUNDAY).map((i) => i.id);
    expect(one).not.toEqual(SUNDAY.map((i) => i.id));
    expect(one).not.toEqual(two);
    expect(new Set([...one, ...two]).size).toBe(10);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   6. The plan can be shared or printed — by a named mechanism.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the plan can be shared', () => {
  it('the run sheet is the whole payload: times, titles, durations, people, notes', () => {
    const text = buildRunSheetText('Sunday Morning', SUNDAY, START);
    expect(text).toContain('Sunday Morning');
    expect(text).toContain('Starts 10:00');
    expect(text).toContain('10:03  Worship set (22 min) - Ben Lead');
    expect(text).toContain('Key of G');
    expect(text).toContain('10:29  Sermon (31 min) - Ada Pastor');
    expect(text).toContain('Ends 11:09');
  });

  it('and it RECALCULATES with the durations, like the screen does', () => {
    const longer = SUNDAY.map((i) => (i.id === 'b' ? { ...i, minutes: 30 } : i));
    const text = buildRunSheetText('Sunday Morning', longer, START);
    expect(text).toContain('10:33  Notices');
    expect(text).toContain('Ends 11:17');
    expect(text).not.toContain('10:25  Notices');
  });

  it('an undated event shares offsets instead of clocks, rather than failing', () => {
    const text = buildRunSheetText('Sunday Morning', SUNDAY, null);
    expect(text).toContain('+3 min  Worship set (22 min) - Ben Lead');
    expect(text).not.toContain('Starts');
    expect(text).not.toContain('Ends');
  });

  it('an empty plan says so rather than sharing a blank sheet', () => {
    expect(buildRunSheetText('Sunday Morning', [], START)).toContain('No items yet.');
  });

  /**
   * 🔴 THE PAYLOAD CONTAINS NO URL, AND NOTHING HERE TOUCHES `giving-share.ts`.
   *
   * The ticket forbids reusing that module's URL builder or loosening its host
   * validation. The strongest form of honouring that is a payload with nothing
   * for either to be asked about — so this asserts the ABSENCE, in the text and
   * in the imports, rather than asserting that a validator was called correctly.
   */
  it('emits no URL at all, and imports nothing from the giving share module', () => {
    const text = buildRunSheetText('Sunday Morning', SUNDAY, START);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('theharvest.app');

    for (const file of [SRC.plan, SRC.panel, SRC.row]) {
      const code = codeOf(file);
      expect(code, `${file} reaches into the giving share module`)
        .not.toMatch(/from ['"][^'"]*giving-share['"]/);
      expect(code, `${file} reaches into the giving providers allow-list`)
        .not.toMatch(/from ['"][^'"]*giving-providers['"]/);
      expect(code).not.toContain('HARVEST_APEX');
      expect(code).not.toContain('buildGivingPageUrl');
    }
  });

  /**
   * The MECHANISM, named: `navigator.share` feature-detected in an effect, and
   * a clipboard copy that is always rendered and never conditional — the shape
   * `GivingShareSheet.tsx` established. NOT a print stylesheet: that would be
   * new global CSS reaching every screen in the app.
   */
  it('uses the share sheet mechanism, feature-detected in an effect', () => {
    const code = codeOf(SRC.panel);

    expect(code).toContain("typeof navigator.share === 'function'");
    expect(code).toMatch(/useEffect\(\(\) => \{\s*setCanNativeShare/);
    // The copy button is unconditional; only the native share is gated.
    expect(code).toMatch(/canNativeShare \? \(/);
    expect(code).toContain('navigator.clipboard.writeText(runSheet)');
    expect(code).toContain('data-plan-copy');
    // 🔴 No `url` key in the share payload — there is no URL to put in one.
    expect(code).toMatch(/navigator\.share\(\{ title: [^}]*text: runSheet \}\)/);
    // 🔴 And no print stylesheet was added.
    expect(code).not.toContain('@media print');
    expect(code).not.toContain('window.print');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   7. 🔴 No Firestore orderBy sequences the items — the `order` field does.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no Firestore orderBy is used to sequence items', () => {
  const FILES = Object.values(SRC);

  it.each(FILES)('%s imports no orderBy and calls none', (file) => {
    expect(codeOf(file)).not.toMatch(/\borderBy\b/);
  });

  it('the query module filters on ONE field and never combines two, so no composite index exists to need', () => {
    const code = codeOf(SRC.queries);

    // Every `query(...)` call, and the `where(` count inside each.
    const calls = [...code.matchAll(/query\(([\s\S]*?)\n\s*\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      const wheres = (call.match(/where\(/g) || []).length;
      expect(wheres, `a query combines ${wheres} where clauses — that is a composite index`).toBeLessThanOrEqual(1);
      expect(call).not.toMatch(/\borderBy\b/);
    }
  });

  it('the sequence is the order field, and orderedItems is the only reader of it', () => {
    // Reverse the array; the rendered sequence is unchanged, because it is the
    // FIELD that sequences and not the array Firestore happened to return.
    expect(orderedItems([...SUNDAY].reverse()).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // And a plan whose order fields disagree with the array is read by the field.
    const scrambled = SUNDAY.map((i, idx) => ({ ...i, order: SUNDAY.length - 1 - idx }));
    expect(orderedItems(scrambled).map((i) => i.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('no timestamp field is used to sequence anything', () => {
    const code = codeOf(SRC.queries);
    // `sortByTime` is `query-helpers`' in-memory timestamp sort. Sequencing a
    // run sheet by one would be #405's defect wearing a different hat.
    expect(code).not.toContain('sortByTime');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   8. 🔴 Only ONE timestamp representation is written. Never both.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('only one timestamp representation is written', () => {
  const FILES = Object.values(SRC);

  /**
   * ⚠️ `invoices.issuedAt` and `contactActivities.createdAt` each hold BOTH ISO
   * strings and Firestore Timestamps in this database, and Firestore sorts
   * across types by TYPE FIRST — a collection holding both is not untidy, it is
   * unsortable. This feature writes `serverTimestamp()` and nothing else.
   */
  it('every timestamp a document receives comes from serverTimestamp()', () => {
    const code = codeOf(SRC.queries);
    expect(code).toContain('serverTimestamp()');
    // 🔴 The mutation: add any of these and this fails.
    expect(code).not.toContain('toISOString');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('new Date(');
    expect(code).not.toContain('Timestamp.fromDate');
    expect(code).not.toContain('Timestamp.now');
  });

  it.each(FILES)('%s writes no ISO string into a document', (file) => {
    const code = codeOf(file);
    expect(code).not.toContain('toISOString');
    expect(code).not.toContain('toUTCString');
    expect(code).not.toContain('toJSON()');
  });

  it('and a CLOCK TIME is never stored at all — it is derived every time', () => {
    const code = codeOf(SRC.queries);
    // The written item shape, verbatim. `startsAt` / `endsAt` / `clock` would be
    // a second representation of a fact the durations already carry, and it
    // would be the stale one the moment a duration above it changed.
    expect(code).not.toContain('startsAt');
    expect(code).not.toContain('endsAt');
    expect(code).not.toContain('clockTime');
    // The item field list a write sends.
    expect(code).toMatch(/id: item\.id,[\s\S]*?title:[\s\S]*?minutes:[\s\S]*?order: i,[\s\S]*?personId:[\s\S]*?personName:[\s\S]*?note:/);
  });

  it('the ItemClock the UI reads is a Date, produced in memory and never persisted', () => {
    const clock = itemClockTimes(SUNDAY, START)[1];
    expect(clock.startsAt).toBeInstanceOf(Date);
    // It is not on the item, which is what gets written.
    expect(Object.keys(clock.item)).not.toContain('startsAt');
  });
});
