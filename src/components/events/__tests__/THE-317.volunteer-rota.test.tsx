import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import VolunteerRotaView, { type RotaPerson } from '../VolunteerRotaView';
import { itemClockTimes, type ServicePlanItem } from '../service-plan';
import {
  RECENT_WINDOW_DAYS,
  addDays,
  assignPerson,
  notServedRecently,
  overlapWarnings,
  recencyVerdict,
  rotaEvent,
  rotaServices,
  rotaWeeks,
  startOfWeek,
  whoIsOn,
  type RotaReadState,
  type RotaService,
} from '../volunteer-rota';

/**
 * THE-317 — volunteer rotas, part 2 of 3. What it actually does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 SECTIONS 1, 3 AND 5 ARE THE TICKET. Everything else is a boundary.
 *
 *   1  people can be assigned across SEVERAL WEEKS IN ONE VIEW — the whole ask
 *   3  "has not served recently" is EXACT OR PROVABLY COMPLETE, and NAMES ITS
 *      SOURCE — the part the ticket says needs care, and the one where a
 *      plausible wrong answer is worse than none
 *   5  a clash WARNS AND DOES NOT BLOCK — both halves, because either alone
 *      passes a broken implementation
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ MUTATION-VERIFIED WHILE THIS FILE WAS WRITTEN. Each was applied, the suite
 * run, then reverted:
 *
 *   · replacing `<Table>` with a hand-written `<table className="w-full">` and
 *     `<Badge>` with `<span className="rounded-full px-2 py-0.5 text-xs">` —
 *     fails 1b on BOTH halves: the import assertion (the primitive is no longer
 *     imported) AND the substitute sweep (the markup is spelled by hand). 🔴 The
 *     second half is what stops 1b being a check that merely COUNTS imports:
 *     adding an unused `import { Table }` back does not make it pass.
 *   · presenting a failed read as an empty rota (`read.failed` ignored, weeks
 *     rendered) — fails 4 alone.
 *   · returning a partial `people` list when `verdict.complete` is false — fails
 *     3 alone.
 *   · disabling the picker on a warned row (block instead of warn) — fails 5's
 *     second half alone; the first half still passes, which is exactly why both
 *     halves are asserted.
 *   · making `overlapWarnings` compare DATES rather than clock ranges — fails 6
 *     alone, and 5 keeps passing, which is why 6 exists separately.
 *   · sending an email on assignment — fails section 8 of `the-317-guards`.
 *   · adding a field to `ServicePlanItem` — fails section 11 of the same.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY MOST OF THIS IS TESTED WITHOUT FIRESTORE. `volunteer-rota.ts` is plain
 * functions and `VolunteerRotaView.tsx` takes plain props, for the reason
 * `service-plan.ts` and `ServicePlanRow.tsx` are: a rule that lives inside a
 * data layer can only be re-implemented by whoever needs it next, and part 3
 * needs all of these. The COMPONENT sections exist for what is genuinely about
 * the DOM — that the picker is a real control that a person can reach and that
 * changing it produces one assignment.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = path.resolve(__dirname);
const SRC = {
  rota: path.join(HERE, '../volunteer-rota.ts'),
  view: path.join(HERE, '../VolunteerRotaView.tsx'),
  panel: path.join(HERE, '../VolunteerRotaPanel.tsx'),
  queries: path.join(HERE, '../../../hooks/queries/useVolunteerRotaQueries.ts'),
} as const;

const read = (file: string): string => readFileSync(file, 'utf8');
/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (file: string): string =>
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ═════════════════════════════════════════════════════════════════════════════
   Fixtures. Three consecutive Sundays and a Wednesday that OVERLAPS the second
   Sunday's morning — because a fixture of tidy non-overlapping Sundays would
   pass an implementation whose clash detector never fired.

   ⚠️ The durations do not divide evenly. Five ten-minute items would pass an
   implementation that ignored the durations and multiplied by the index.
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date(2026, 8, 2, 9, 0, 0);            // Wed 2 Sep 2026, 09:00
const SUN_6 = new Date(2026, 8, 6, 10, 0, 0);
const SUN_13 = new Date(2026, 8, 13, 10, 0, 0);
const SUN_20 = new Date(2026, 8, 20, 10, 0, 0);
/** Sunday the 13th, 10:15 — a second service that runs INTO the first. */
const EARLY_13 = new Date(2026, 8, 13, 10, 15, 0);

const item = (
  id: string, title: string, minutes: number, order: number,
  extra: Partial<ServicePlanItem> = {},
): ServicePlanItem => ({
  id, title, minutes, order, personId: null, personName: null, note: null, ...extra,
});

const ADA: RotaPerson = { id: 'u-ada', name: 'Ada Pastor' };
const BEN: RotaPerson = { id: 'u-ben', name: 'Ben Lead' };
const CAI: RotaPerson = { id: 'u-cai', name: 'Cai Sound' };
const PEOPLE = [ADA, BEN, CAI];

const service = (
  eventId: string, planId: string | null, startsAt: Date, items: ServicePlanItem[],
  eventTitle = 'Sunday Morning',
): RotaService => ({ eventId, eventTitle, startsAt, planId, planName: 'Order of service', items });

/** Three Sundays. Ben leads on the 6th and the 13th; Cai is on nothing at all. */
const SERVICES: RotaService[] = [
  service('e6', 'p6', SUN_6, [
    item('a', 'Welcome', 3, 0, { personId: ADA.id, personName: ADA.name }),
    item('b', 'Worship set', 22, 1, { personId: BEN.id, personName: BEN.name }),
    item('c', 'Sermon', 27, 2, { personId: ADA.id, personName: ADA.name }),
  ]),
  service('e13', 'p13', SUN_13, [
    item('d', 'Welcome', 4, 0),
    item('e', 'Worship set', 21, 1, { personId: BEN.id, personName: BEN.name }),
  ]),
  service('e20', 'p20', SUN_20, [
    item('f', 'Welcome', 5, 0, { personId: ADA.id, personName: ADA.name }),
  ]),
];

/** The second service on the 13th — Ben reads at 10:15, while he is still leading. */
const CLASHING = service('e13b', 'p13b', EARLY_13, [
  item('g', 'Reading', 6, 0, { personId: BEN.id, personName: BEN.name }),
], 'Sunday Evening Prep');

const CLEAN_READ: RotaReadState = {
  failed: false, plansTruncated: false, eventsTruncated: false,
  oldestEventStart: new Date(2024, 0, 1),
};

/* ── the DOM harness ─────────────────────────────────────────────────────── */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const renderView = async (props: Partial<React.ComponentProps<typeof VolunteerRotaView>> = {}) => {
  const calls: [string, string, RotaPerson | null][] = [];
  await act(async () => {
    root.render(
      <VolunteerRotaView
        services={SERVICES}
        people={PEOPLE}
        read={CLEAN_READ}
        loading={false}
        now={NOW}
        onAssign={(planId, itemId, person) => calls.push([planId, itemId, person])}
        {...props}
      />,
    );
  });
  return calls;
};

/** Open a base-ui `select` and click the option whose label matches. */
const pick = async (trigger: HTMLElement, label: string) => {
  await act(async () => { trigger.click(); });
  const option = [...document.querySelectorAll('[data-slot="select-item"]')]
    .find((o) => o.textContent?.trim() === label) as HTMLElement | undefined;
  expect(option, `no option labelled "${label}"`).toBeTruthy();
  await act(async () => { (option as HTMLElement).click(); });
};

const trigger = (label: string): HTMLElement => {
  const el = host.querySelector(`[aria-label="${label}"]`);
  expect(el, `no control labelled "${label}"`).toBeTruthy();
  return el as HTMLElement;
};

const tab = (name: string): HTMLElement => {
  const el = [...host.querySelectorAll('[data-slot="tabs-trigger"], [role="tab"]')]
    .find((t) => t.textContent?.trim() === name);
  expect(el, `no tab "${name}"`).toBeTruthy();
  return el as HTMLElement;
};

/* ═══ 1 · People can be assigned to plan items ACROSS SEVERAL WEEKS, in ONE
       view. 🔴 THE WHOLE TICKET. ═══════════════════════════════════════════ */

describe('people can be assigned to plan items across several weeks in one view', () => {
  it('renders every week of the horizon at once, from ONE mounted view', async () => {
    await renderView();
    const weeks = host.querySelectorAll('[data-rota-week]');
    // Six weeks from the week of Wed 2 Sep — the three Sundays plus the empty
    // weeks between and after. ⚠️ EMPTY WEEKS ARE RENDERED: a rota that omitted
    // them would read as an unbroken run of Sundays with one quietly missing.
    expect(weeks.length).toBe(6);
    const text = host.textContent ?? '';
    for (const label of ['Week of Sun 30 Aug', 'Week of Sun 6 Sep', 'Week of Sun 13 Sep', 'Week of Sun 20 Sep']) {
      expect(text, `${label} is not on the screen`).toContain(label);
    }
  });

  it('shows a person picker per item on EVERY week, not only the first', async () => {
    await renderView();
    // One per item across all three services: 3 + 2 + 1.
    expect(host.querySelectorAll('[data-slot="select-trigger"]').length).toBe(6);
    // The last week's item has one too — the assertion that "several weeks" is
    // not "the first week, and headings for the rest".
    expect(trigger('Assign Welcome')).toBeTruthy();
    expect(host.querySelector('[aria-label="Assign Sermon"]')).toBeTruthy();
  });

  it('🔴 assigning somebody on the THIRD week produces exactly one assignment, keyed by (planId, itemId)', async () => {
    const calls = await renderView();
    await pick(trigger('Assign Worship set'), 'Cai Sound');
    expect(calls.length).toBe(1);
    const [planId, itemId, person] = calls[0];
    // The FIRST "Worship set" in document order is week 2's, plan p6, item b.
    expect(planId).toBe('p6');
    expect(itemId).toBe('b');
    expect(person).toEqual(CAI);
  });

  it('clearing an assignment hands back null, not an empty string or a blank person', async () => {
    const calls = await renderView();
    await pick(trigger('Assign Worship set'), 'Unassigned');
    expect(calls).toEqual([['p6', 'b', null]]);
  });

  it('🔴 the assignment changes only that item, and only its two person fields', () => {
    const before = SERVICES[0].items;
    const after = assignPerson(before, 'b', CAI);
    expect(after.find((i) => i.id === 'b')).toEqual({
      ...before.find((i) => i.id === 'b'), personId: CAI.id, personName: CAI.name,
    });
    // Every other row is untouched, by value.
    expect(after.filter((i) => i.id !== 'b')).toEqual(before.filter((i) => i.id !== 'b'));
    // And no key was added or removed anywhere.
    for (const row of after) {
      expect(Object.keys(row).sort())
        .toEqual(['id', 'minutes', 'note', 'order', 'personId', 'personName', 'title']);
    }
  });

  it('a week with no service, and a service with no order of service, each say so', async () => {
    await renderView({ services: [...SERVICES, service('e27', null, new Date(2026, 8, 27, 10, 0), [])] });
    const text = host.textContent ?? '';
    expect(text).toContain('No service this week');
    expect(text).toContain('No order of service yet');
  });

  it('rotaWeeks slices ONE read into as many weeks as asked, at no further cost', () => {
    const weeks = rotaWeeks(SERVICES, NOW, 4);
    expect(weeks.length).toBe(4);
    expect(weeks[0].weekStart).toEqual(startOfWeek(NOW));
    expect(weeks.flatMap((w) => w.services.map((s) => s.eventId))).toEqual(['e6', 'e13', 'e20']);
    // Half-open [start, end): a service at the very last instant of a week is
    // in THAT week, and one at the first instant of the next is not.
    expect(weeks[1].services[0].startsAt).toEqual(SUN_6);
  });

  it('rotaServices joins the two reads in memory, drops undated events, and orders by time', () => {
    const events = [
      { id: 'e20', title: 'C', startDate: { toDate: () => SUN_20 } },
      { id: 'e6', title: 'A', startDate: { toDate: () => SUN_6 } },
      { id: 'undated', title: 'No date', startDate: null },
    ].map(rotaEvent);
    const joined = rotaServices(events, [
      // ⚠️ `startAt: null` is THE-329's field, and null is what makes these two
      // EVENT-ANCHORED plans rather than standalone services. The join asserted
      // below is unchanged by that ticket.
      { id: 'p6', eventId: 'e6', startAt: null, name: 'n', items: [item('a', 'Welcome', 3, 0)] },
      { id: 'porphan', eventId: 'gone', startAt: null, name: 'n', items: [] },
    ]);
    expect(joined.map((s) => s.eventId)).toEqual(['e6', 'e20']);
    expect(joined[0].planId).toBe('p6');
    // An event with no plan is still a service — it is the one an admin needs
    // to notice — and it carries no items.
    expect(joined[1].planId).toBeNull();
    expect(joined[1].items).toEqual([]);
  });
});

/* ═══ 1b · 🔴 EVERY ELEMENT THAT HAS A PRIMITIVE USES IT ═══════════════════ */

describe('every element that has a primitive uses it', () => {
  /**
   * 🔴 BOTH HALVES ARE REQUIRED, AND THE SECOND IS THE ONE THAT MATTERS.
   *
   * ⚠️ The ticket's own mutation says so: "Replace a primitive with equivalent
   * hand-written markup → test 1b fails. 🔴 If it passes, the check is counting
   * imports rather than requiring them." An import assertion alone is exactly
   * that check — it stays green while the JSX beneath it is a hand-rolled
   * `<table>` with an unused import left at the top. So the sweep below looks
   * for the SUBSTITUTES, in the rendered markup and in the source, and it is
   * what actually fails when a primitive is swapped out.
   */
  const REQUIRED = [
    'badge', 'button', 'avatar', 'card', 'empty', 'item', 'select', 'skeleton', 'table', 'tabs',
  ] as const;

  it.each(REQUIRED)('the view imports the %s primitive from @/components/ui/', (name) => {
    expect(codeOf(SRC.view), `${name} is not imported`)
      .toMatch(new RegExp(`from ['"]@/components/ui/${name}['"]`));
  });

  it('🔴 and spells NO hand-written substitute for one — this is the half that catches a swap', () => {
    const code = codeOf(SRC.view);
    const SUBSTITUTES: [RegExp, string][] = [
      [/<table[\s>]/, 'a bare <table> — that is `table` (Table/TableHeader/TableRow/TableCell)'],
      [/<thead[\s>]|<tbody[\s>]|<th[\s>]|<td[\s>]/, 'bare table internals — that is `table`'],
      [/role=["'](?:table|row|cell|columnheader|tab|tablist|tabpanel|listbox|option|progressbar)["']/,
        'a hand-written ARIA role — the primitive carries it'],
      [/className=["'`][^"'`]*\brounded-(?:lg|xl|2xl|brand)\b[^"'`]*\bborder\b[^"'`]*\bp-\d/,
        'a bordered, rounded, padded div — that is `card`'],
      [/className=["'`][^"'`]*\bbg-card\b/, 'bg-card spelled by hand — that is `card`'],
      [/className=["'`][^"'`]*\brounded-full\b[^"'`]*\bpx-\d/, 'a hand-made pill — that is `badge`'],
      [/\banimate-pulse\b/, 'a hand-made shimmer — that is `skeleton`'],
      [/<select[\s>]|<option[\s>]/, 'a native select — that is `select`'],
      [/<button[\s>]/, 'a bare <button> — that is `button`'],
    ];
    for (const [re, why] of SUBSTITUTES) {
      expect(re.test(code), `VolunteerRotaView spells ${why}`).toBe(false);
    }
  });

  it('and the rendered markup really is the primitives, not something that looks like them', async () => {
    await renderView();
    for (const slot of ['card', 'card-header', 'card-title', 'card-content', 'tabs', 'tabs-list',
      'tabs-trigger', 'table', 'table-header', 'table-row', 'table-cell', 'select-trigger']) {
      expect(host.querySelector(`[data-slot="${slot}"]`), `no ${slot} rendered`).toBeTruthy();
    }
  });

  it('the `item`, `avatar` and `empty` primitives render on the surfaces that use them', async () => {
    // `item` + `avatar`: the not-served-recently rows, with a never-served member.
    await renderView();
    await act(async () => { tab('Not served recently').click(); });
    expect(host.querySelector('[data-slot="item"]')).toBeTruthy();
    expect(host.querySelector('[data-slot="avatar"]')).toBeTruthy();
    // `empty`: a failed read.
    await renderView({ read: { ...CLEAN_READ, failed: true } });
    expect(host.querySelector('[data-slot="empty"]')).toBeTruthy();
  });
});

/* ═══ 1c · Inline styles ═════════════════════════════════════════════════ */

it('inline styles are zero across every file this ticket adds', () => {
  // The dashboard files hold ZERO. `AdminSms.tsx` has ten, which is what the
  // ticket names as the thing not to repeat. There was no computed cell colour
  // and no derived width to need one: the scroller's minimum is a class, and the
  // only colour in the view is a `badge` variant.
  for (const file of Object.values(SRC)) {
    expect(codeOf(file).match(/style=\{\{/g) ?? [], `${path.basename(file)} has an inline style`)
      .toEqual([]);
  }
});

/* ═══ 2 · "Who is on" for a given date reads the REAL assignments ═════════ */

describe('"who is on" for a given date reads the real assignments', () => {
  it('returns every item of that day, with the names actually stored on them', () => {
    const rows = whoIsOn(SERVICES, SUN_6);
    expect(rows.map((r) => [r.item.title, r.item.personName])).toEqual([
      ['Welcome', 'Ada Pastor'],
      ['Worship set', 'Ben Lead'],
      ['Sermon', 'Ada Pastor'],
    ]);
    // 🔴 NOT summarised, and NOT filtered to the assigned rows: "nobody is on
    // the sound desk" is the answer this question is most often asked to get.
    expect(whoIsOn(SERVICES, SUN_13).map((r) => r.item.personName)).toEqual([null, 'Ben Lead']);
  });

  it('carries the run sheet\'s own derived clock times, not the event start on every row', () => {
    const rows = whoIsOn(SERVICES, SUN_6);
    expect(rows.map((r) => (r.startsAt as Date).getHours() * 60 + (r.startsAt as Date).getMinutes()))
      .toEqual([600, 603, 625]); // 10:00, 10:03, 10:25 — 0, +3, +3+22.
  });

  it('a day with no service is empty, and two services on one day are both included', () => {
    expect(whoIsOn(SERVICES, new Date(2026, 8, 7, 10, 0))).toEqual([]);
    expect(whoIsOn([...SERVICES, CLASHING], SUN_13).length).toBe(3);
  });

  it('the screen reads it for a date the admin picks', async () => {
    await renderView();
    await act(async () => { tab('Who is on').click(); });
    // Defaults to the next service on or after today — Sunday the 6th.
    expect(host.querySelector('[data-rota-who]')).toBeTruthy();
    expect(host.textContent).toContain('Ada Pastor');
    await pick(trigger('Service date'), 'Sun 20 Sep');
    const table = host.querySelector('[data-rota-who]') as HTMLElement;
    expect(table.textContent).toContain('Welcome');
    expect(table.textContent).not.toContain('Worship set');
  });

  it('and an unassigned row says so, rather than rendering blank', async () => {
    await renderView();
    await act(async () => { tab('Who is on').click(); });
    await pick(trigger('Service date'), 'Sun 13 Sep');
    expect((host.querySelector('[data-rota-who]') as HTMLElement).textContent).toContain('Unassigned');
  });
});

/* ═══ 3 · 🔴 "Has not served recently" is EXACT or PROVABLY COMPLETE, and
       NAMES ITS SOURCE ══════════════════════════════════════════════════════ */

describe('"has not served recently" is exact or provably complete', () => {
  /** Two Sundays already past, so somebody CAN have served. */
  const PAST: RotaService[] = [
    service('old1', 'po1', new Date(2026, 5, 7, 10, 0), [       // 7 June — outside the window
      item('x', 'Welcome', 5, 0, { personId: ADA.id, personName: ADA.name }),
    ]),
    service('old2', 'po2', new Date(2026, 7, 30, 10, 0), [      // 30 Aug — inside the window
      item('y', 'Welcome', 5, 0, { personId: BEN.id, personName: BEN.name }),
    ]),
  ];

  it('🔴 NAMES ITS SOURCE, in the type, as the rota\'s own assignment records', () => {
    const out = notServedRecently(PEOPLE, PAST, CLEAN_READ, NOW);
    expect(out.source).toBe('servicePlans');
    // And the source is the one this ticket chose over `contactActivities`. The
    // whole feature must never read it — three established defects (a 1,000-row
    // ceiling, a `contactId` that is two collections, a `createdAt` that is two
    // types) and it does not record serving in the first place.
    for (const file of Object.values(SRC)) {
      expect(codeOf(file), `${path.basename(file)} reads contactActivities`)
        .not.toMatch(/contactActivities/);
    }
  });

  it('is EXACT when the read is complete: the window is the rule, and never-served is included', () => {
    const out = notServedRecently(PEOPLE, PAST, CLEAN_READ, NOW);
    expect(out.verdict.complete).toBe(true);
    expect(out.windowStart).toEqual(addDays(new Date(2026, 8, 2), -RECENT_WINDOW_DAYS));
    // Cai has NEVER served, so Cai is first. Ada last served 7 June, outside the
    // window. Ben served 30 August, inside it, so Ben is not listed at all.
    expect(out.people.map((p) => p.id)).toEqual([CAI.id, ADA.id]);
    expect(out.people[0].lastServedAt).toBeNull();
    expect(out.people[1].lastServedAt).toEqual(new Date(2026, 5, 7, 10, 0));
  });

  it('🔴 a FUTURE assignment does not count as having served, but IS reported', () => {
    // Cai is on the 20th — still has not served, and an admin needs to know both.
    const withFuture = [...PAST, service('e20', 'p20', SUN_20, [
      item('z', 'Sound', 5, 0, { personId: CAI.id, personName: CAI.name }),
    ])];
    const out = notServedRecently(PEOPLE, withFuture, CLEAN_READ, NOW);
    const cai = out.people.find((p) => p.id === CAI.id);
    expect(cai?.lastServedAt).toBeNull();
    expect(cai?.nextScheduledAt).toEqual(SUN_20);
  });

  it.each([
    ['the read rejected', { failed: true }, 'could not be read'],
    ['the plan read hit its ceiling', { plansTruncated: true }, 'more service plans than one read'],
    ['the event read hit its ceiling short of the window',
      { eventsTruncated: true, oldestEventStart: new Date(2026, 8, 1) }, 'does not reach back'],
    ['the event read hit its ceiling and returned no dated event',
      { eventsTruncated: true, oldestEventStart: null }, 'does not reach back'],
  ])('🔴 SHIPS NOTHING when %s', (_label, patch, phrase) => {
    const out = notServedRecently(PEOPLE, PAST, { ...CLEAN_READ, ...patch }, NOW);
    expect(out.verdict.complete).toBe(false);
    expect(out.verdict.reason).toContain(phrase);
    // 🔴 NOT a partial list. A partial list here is a list of names accused of
    // not turning up, some of whom did.
    expect(out.people).toEqual([]);
  });

  it('🔴 PROVES completeness over a TRUNCATED event read that still reaches past the window', () => {
    // The event read came back at its ceiling — but its OLDEST row predates the
    // window, so every event inside the window was returned and the answer is
    // exact regardless of how many older ones were dropped. That is the second
    // thing the ticket's rule allows: provably complete, not merely untruncated.
    const windowStart = addDays(new Date(2026, 8, 2), -RECENT_WINDOW_DAYS);
    expect(recencyVerdict(
      { failed: false, plansTruncated: false, eventsTruncated: true, oldestEventStart: addDays(windowStart, -1) },
      windowStart,
    )).toEqual({ complete: true, reason: null });
    // One day the other side of the line and it is not provable.
    expect(recencyVerdict(
      { failed: false, plansTruncated: false, eventsTruncated: true, oldestEventStart: addDays(windowStart, 1) },
      windowStart,
    ).complete).toBe(false);
  });

  it('and the screen prints the reason rather than an empty list', async () => {
    await renderView({ read: { ...CLEAN_READ, plansTruncated: true } });
    await act(async () => { tab('Not served recently').click(); });
    expect(host.querySelector('[data-rota-empty]')).toBeTruthy();
    expect(host.querySelector('[data-rota-recency]')).toBeNull();
    expect(host.textContent).toContain('This cannot be worked out exactly');
    expect(host.textContent).toContain('more service plans than one read returns');
  });

  it('and "everybody has served" is a DIFFERENT screen from "this cannot be worked out"', async () => {
    await renderView({ services: PAST, people: [BEN] });
    await act(async () => { tab('Not served recently').click(); });
    expect(host.textContent).toContain('Everybody has served recently');
    expect(host.textContent).not.toContain('cannot be worked out');
  });
});

/* ═══ 4 · 🔴 A read failure shows an EMPTY STATE — never a zero, and never an
       empty list presented as fact ═══════════════════════════════════════════ */

describe('a read failure shows an empty state, never a zero or an empty list presented as fact', () => {
  it.each(['Rota', 'Who is on', 'Not served recently'])('on the %s tab', async (name) => {
    await renderView({ read: { ...CLEAN_READ, failed: true } });
    await act(async () => { tab(name).click(); });
    expect(host.querySelector('[data-rota-empty]'), 'no empty state was rendered').toBeTruthy();
    const text = host.textContent ?? '';
    // 🔴 The two shapes a failed read must NEVER take.
    expect(host.querySelector('[data-rota-week]'), 'a week grid was rendered over a failed read').toBeNull();
    expect(host.querySelector('[data-rota-recency]'), 'a name list was rendered over a failed read').toBeNull();
    expect(host.querySelector('[data-rota-who]'), 'a duty table was rendered over a failed read').toBeNull();
    expect(text).not.toMatch(/\b0 (?:people|members|volunteers|double)/);
  });

  it('and the failure is worded as a failure, not as an absence', async () => {
    await renderView({ read: { ...CLEAN_READ, failed: true } });
    expect(host.textContent).toContain('could not be read');
    expect(host.textContent).not.toContain('Everybody has served recently');
  });

  it('loading is a skeleton, which is a THIRD state — not an empty and not a figure', async () => {
    await renderView({ loading: true });
    expect(host.querySelector('[data-rota-loading]')).toBeTruthy();
    expect(host.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(host.querySelector('[data-rota-empty]')).toBeNull();
    expect(host.querySelector('[data-rota-week]')).toBeNull();
  });
});

/* ═══ 5 · 🔴 The same person on two overlapping items is WARNED, NOT BLOCKED.
       BOTH HALVES. ══════════════════════════════════════════════════════════ */

describe('the same person on two overlapping items is warned, not blocked', () => {
  const CLASHED = [...SERVICES, CLASHING];

  it('🔴 HALF ONE — it warns, on both sides of the clash', async () => {
    const warnings = overlapWarnings(CLASHED);
    expect(warnings.length).toBe(1);
    expect(warnings[0].personId).toBe(BEN.id);
    expect([warnings[0].a.item.id, warnings[0].b.item.id].sort()).toEqual(['e', 'g']);

    await renderView({ services: CLASHED });
    expect(host.querySelector('[data-rota-warning-count]')?.textContent).toContain('1 double booking');
    // Both rows carry the warning, not just the later one.
    expect(host.querySelector('[data-rota-clash="e"]')).toBeTruthy();
    expect(host.querySelector('[data-rota-clash="g"]')).toBeTruthy();
  });

  it('🔴 HALF TWO — AND IT DOES NOT BLOCK. The warned row stays assignable.', async () => {
    const calls = await renderView({ services: CLASHED });
    const warnedRow = host.querySelector('[data-rota-row="e"]') as HTMLElement;
    const control = warnedRow.querySelector('[data-slot="select-trigger"]') as HTMLElement;
    expect(control, 'the warned row has no picker at all').toBeTruthy();
    expect(control.hasAttribute('disabled'), 'the warned row is disabled — that is a block').toBe(false);
    expect(control.getAttribute('aria-disabled'), 'the warned row is aria-disabled — that is a block')
      .not.toBe('true');
    // And it genuinely still commits — re-assigning is how an admin RESOLVES a
    // clash, so refusing the write would trap them in it.
    await pick(control, 'Cai Sound');
    expect(calls).toEqual([['p13', 'e', CAI]]);
  });

  it('a church may want somebody doing two things IN A ROW, and that is never a warning', () => {
    // Adjacency is not overlap: one item ends at 10:03 and the next starts at
    // 10:03. Within ONE plan that is guaranteed by construction, so it is also
    // asserted ACROSS plans, where it is a real judgement.
    const backToBack = [
      service('x1', 'px1', new Date(2026, 8, 6, 10, 0), [
        item('m', 'Welcome', 15, 0, { personId: ADA.id, personName: ADA.name }),
      ]),
      service('x2', 'px2', new Date(2026, 8, 6, 10, 15), [
        item('n', 'Prayer', 10, 0, { personId: ADA.id, personName: ADA.name }),
      ]),
    ];
    expect(overlapWarnings(backToBack)).toEqual([]);
    // The same person twice on ONE run sheet is never a clash either.
    expect(overlapWarnings([SERVICES[0]])).toEqual([]);
  });

  it('nothing in the feature refuses an assignment', () => {
    // 🔴 A source-level sweep, because a block can be spelled in more ways than
    // a disabled attribute — an early return, a thrown error, a guard on the
    // handler. None of these words appears near the clash.
    const code = codeOf(SRC.view) + codeOf(SRC.rota) + codeOf(SRC.panel);
    for (const word of ['blockAssignment', 'preventAssignment', 'cannotAssign', 'refuse', 'forbid']) {
      expect(code, `the feature spells ${word}`).not.toContain(word);
    }
  });
});

/* ═══ 6 · Overlap is decided by the run sheet's TIMINGS ═══════════════════ */

describe('overlap is decided by the run sheet\'s timings', () => {
  it('🔴 moving a duration ABOVE an item moves whether it clashes — nothing else changes', () => {
    // Ben reads at 10:15 on the 13th. On the main service he leads the worship
    // set, which starts after a 4-minute welcome: 10:04–10:25. They overlap.
    expect(overlapWarnings([...SERVICES, CLASHING]).length).toBe(1);

    // Shorten ONLY the welcome above it, from 4 minutes to 1. The worship set
    // now runs 10:01–10:22 and STILL overlaps 10:15.
    const shortened = SERVICES.map((s) => s.eventId !== 'e13' ? s : {
      ...s, items: s.items.map((i) => i.id === 'd' ? { ...i, minutes: 1 } : i),
    });
    expect(overlapWarnings([...shortened, CLASHING]).length).toBe(1);

    // Lengthen the welcome to 20 minutes: the worship set moves to 10:20–10:41,
    // and the reading (10:15–10:21) still overlaps it. Lengthen to 26 and the
    // set starts at 10:26, AFTER the reading ends at 10:21 — no clash.
    const pushed = SERVICES.map((s) => s.eventId !== 'e13' ? s : {
      ...s, items: s.items.map((i) => i.id === 'd' ? { ...i, minutes: 26 } : i),
    });
    expect(overlapWarnings([...pushed, CLASHING])).toEqual([]);
    // ⚠️ AND THE ITEM ITSELF WAS NOT TOUCHED. Only a duration ABOVE it moved.
    expect(pushed[1].items.find((i) => i.id === 'e')).toEqual(SERVICES[1].items.find((i) => i.id === 'e'));
  });

  it('no-regression on #449: the clock is still the event start plus the durations above', () => {
    // 🔴 This is part 1's arithmetic, asserted here so that part 2 cannot be the
    // reason it moves. The rota calls `itemClockTimes`; it does not re-derive.
    const clocks = itemClockTimes(SERVICES[0].items, SUN_6);
    expect(clocks.map((c) => c.offsetMinutes)).toEqual([0, 3, 25]);
    expect(clocks.map((c) => (c.startsAt as Date).toISOString())).toEqual([
      new Date(2026, 8, 6, 10, 0).toISOString(),
      new Date(2026, 8, 6, 10, 3).toISOString(),
      new Date(2026, 8, 6, 10, 25).toISOString(),
    ]);
    expect((clocks[2].endsAt as Date).getMinutes()).toBe(52);
  });

  it('an undated service is skipped rather than guessed onto the clock', () => {
    const undated: RotaService = { ...CLASHING, startsAt: null };
    expect(overlapWarnings([...SERVICES, undated])).toEqual([]);
  });

  it('a zero-minute item occupies no clock time and so clashes with nothing', () => {
    const zero = service('z', 'pz', SUN_6, [
      item('q', 'Nothing', 0, 0, { personId: ADA.id, personName: ADA.name }),
    ]);
    expect(overlapWarnings([SERVICES[0], zero])).toEqual([]);
  });
});

/* ═══ 7 · The volunteer side is READ-ONLY ═════════════════════════════════ */

describe('the volunteer side is read-only', () => {
  /**
   * 🔴 THIS TICKET SHIPS NO VOLUNTEER-FACING SURFACE AT ALL, and that is the
   * strongest form of "read-only": there is no editor because there is no
   * screen. Part 3 owns invite, accept and decline.
   *
   * ⚠️ `Profile.tsx`'s "My Events" entry DOES exist, and a rota does belong
   * beside it — see the report. It is not built here: `UserEvents` reads
   * `/api/my-registrations`, which is the member's own TICKETS, and a rota
   * assignment is not a registration. Wiring one in would need either a new API
   * route or a member-side read of `servicePlans` — and the accept/decline that
   * makes such a screen worth opening is part 3's. So the assertion is that the
   * member surfaces are UNTOUCHED, by digest.
   */
  const REPO_ROOT = path.resolve(HERE, '../../../..');
  const MEMBER_SURFACES = ['src/components/Profile.tsx', 'src/components/UserEvents.tsx'];

  it('no member-facing screen was edited by this ticket', () => {
    for (const file of MEMBER_SURFACES) {
      const src = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(src, `${file} now mounts the rota`).not.toContain('VolunteerRota');
      expect(src, `${file} now reads servicePlans`).not.toContain('servicePlans');
    }
  });

  /**
   * ⚠️ AMENDED BY THE-326 — ONE SCREEN STILL, AND IT IS NOW THE SERVICES SCREEN.
   *
   * Service planning was split out of Events into its own section, so the panel
   * hangs off `AdminServices.tsx`. 🔴 THE CLAIM IS NOT WEAKENED: "exactly one
   * screen" is the whole assertion and it still holds — a second mount, on the
   * events screen or anywhere else, still fails here.
   */
  it('the rota is mounted by exactly one screen, and it is the services screen (THE-326)', () => {
    const walkFrom = path.join(REPO_ROOT, 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
        return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      });
    const mounts = walk(walkFrom).filter((f) => {
      if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
      if (f.includes(`${path.sep}events${path.sep}VolunteerRota`)) return false;
      return /VolunteerRotaPanel/.test(readFileSync(f, 'utf8'));
    });
    expect(mounts.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/')))
      .toEqual(['src/components/AdminServices.tsx']);
  });

  it('and the view has no accept, decline, invite or swap control — part 3 owns those', () => {
    const code = codeOf(SRC.view);
    for (const word of ['accept', 'Accept', 'decline', 'Decline', 'invite', 'Invite', 'RSVP', 'swap']) {
      expect(code, `the view spells ${word}, which is part 3's`).not.toContain(word);
    }
  });
});
