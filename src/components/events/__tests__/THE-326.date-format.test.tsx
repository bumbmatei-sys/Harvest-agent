import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import VolunteerRotaView from '../VolunteerRotaView';
import { fmtDay, type RotaReadState, type RotaService } from '../volunteer-rota';
import type { ServicePlanItem } from '../service-plan';

/**
 * THE-326 — the date selector rendered `1788513540000`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE DEFECT, AND WHY IT WAS ONLY EVER VISIBLE ON THE CLOSED CONTROL.
 *
 * The rota's "Who is on" panel picks a service by date. A `select`'s value must
 * be a string, and the identity of a service here is its date, so the value is
 * `String(day.getTime())`. The OPTIONS were never wrong — every `SelectItem` has
 * always been labelled with `fmtDay` — but the TRIGGER rendered
 * `<SelectValue placeholder="Pick a date" />` with no children, and Base UI's
 * `Select.Value` with no children renders THE VALUE. So a church saw the epoch
 * on the closed control and a real date the moment it opened the list, which is
 * exactly what the founder's screenshot shows.
 *
 * The fix is the primitive's own documented API — "Accepts a function that
 * returns a `ReactNode` to format the selected value" — resolving the value back
 * through `fmtDay`, the SAME function the options use, so the closed control
 * reads back the line that was picked.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ WHY THIS FILE EXISTS BESIDE THE CHROMIUM SUITE. `THE-326.services.layout`
 * measures the tab overlap in a real browser, where the page is STATIC markup —
 * and `Tabs.Panel` defaults to `keepMounted: false`, so the panel this selector
 * lives in is not on that page at all. Reaching it needs a click, which needs
 * React, which is this file. No layout question is asked here; every assertion
 * is about RENDERED TEXT, which happy-dom answers correctly.
 *
 * ⚠️ THE FIXTURE IS FIVE YEARS OUT AND `now` IS A PROP — the #468 fuse. A
 * fixture pinned near today turned `main` red for everyone the moment the clock
 * passed it. `VolunteerRotaView` takes `now`, so nothing here reads the system
 * clock and no timer needs faking.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2031, 4, 7, 9, 0, 0);            // Wed 7 May 2031
const SUN_11 = new Date(2031, 4, 11, 10, 0, 0);
const SUN_18 = new Date(2031, 4, 18, 10, 0, 0);

const item = (id: string, title: string, minutes: number, order: number): ServicePlanItem => ({
  id, title, minutes, order, personId: 'u-ada', personName: 'Ada Pastor', note: null,
});

const service = (eventId: string, planId: string, startsAt: Date): RotaService => ({
  eventId, eventTitle: 'Sunday Morning', startsAt, planId, planName: 'Order of service',
  items: [item(`${eventId}a`, 'Welcome', 5, 0)],
});

const SERVICES: RotaService[] = [
  service('e11', 'p11', SUN_11),
  service('e18', 'p18', SUN_18),
];

const PEOPLE = [{ id: 'u-ada', name: 'Ada Pastor' }];

const READ: RotaReadState = {
  failed: false, plansTruncated: false, eventsTruncated: false,
  oldestEventStart: new Date(2029, 0, 1),
};

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

const renderView = async () => {
  await act(async () => {
    root.render(
      <VolunteerRotaView
        services={SERVICES}
        people={PEOPLE}
        read={READ}
        loading={false}
        now={NOW}
        onAssign={() => {}}
      />,
    );
  });
};

const tab = (label: string): HTMLElement => {
  const found = [...host.querySelectorAll('[data-slot="tabs-trigger"]')]
    .find((el) => (el.textContent ?? '').trim() === label);
  if (!found) throw new Error(`no tab labelled "${label}"`);
  return found as HTMLElement;
};

const dateTrigger = (): HTMLElement => {
  const found = host.querySelector('[aria-label="Service date"]');
  if (!found) throw new Error('the service-date selector is not on screen');
  return found as HTMLElement;
};

/**
 * What the CLOSED control actually says, without the chevron.
 *
 * ⚠️ The trigger's own `textContent` folds in the decorative caret the primitive
 * draws beside the value, so a comparison against an option's label would fail
 * on a glyph rather than on the thing being tested. `[data-slot="select-value"]`
 * is the element `Select.Value` renders and is exactly the text under test.
 */
const shownValue = (): string => {
  const el = dateTrigger().querySelector('[data-slot="select-value"]');
  if (!el) throw new Error('the selector renders no value element');
  return (el.textContent ?? '').trim();
};

/** Every run of 12+ digits in what the screen actually says. */
const epochsIn = (text: string): string[] => text.match(/\b\d{12,}\b/g) ?? [];

describe('5 · the date selector renders a formatted date, never a raw epoch', () => {
  it('the fixture is really showing the picker — so the rest is not vacuous', async () => {
    await renderView();
    await act(async () => { tab('Who is on').click(); });
    expect(dateTrigger()).toBeTruthy();
  });

  it('🔴 the closed selector shows a formatted date, not the epoch behind it', async () => {
    await renderView();
    await act(async () => { tab('Who is on').click(); });

    const shown = shownValue();

    // 🔴 THE DEFECT: this is what shipped, and it is what must never come back.
    expect(
      epochsIn(shown),
      `the selector shows "${shown}" — a raw millisecond value reached a church`,
    ).toEqual([]);

    // 🔴 AND THE POSITIVE HALF, because an empty sweep also passes on a control
    // that renders nothing at all. It shows the date it defaulted to — the next
    // service on or after `now` — in `fmtDay`'s own spelling.
    expect(shown, `the selector says "${shown}"`).toContain(fmtDay(SUN_11));
  });

  it('and it still agrees with the option list it was chosen from', async () => {
    await renderView();
    await act(async () => { tab('Who is on').click(); });

    // ⚠️ THE REASON THE FORMAT IS `fmtDay` AND NOT A SECOND SPELLING. The
    // trigger and the options must read the same, or the closed control
    // disagrees with the list it came from. `fmtDay` is also what the week
    // headings and the run-sheet rows already say.
    const shown = shownValue();
    await act(async () => { dateTrigger().click(); });
    const options = [...document.querySelectorAll('[data-slot="select-item"]')]
      .map((el) => (el.textContent ?? '').trim());

    expect(options.length, 'the option list did not open').toBeGreaterThan(0);
    expect(options, `the trigger says "${shown}", which is in no option`).toContain(shown);
    for (const option of options) {
      expect(epochsIn(option), `an option reads "${option}"`).toEqual([]);
    }
  });

  /**
   * 🔴 THE SAME DEFECT ON THE CONTROL BESIDE IT, AND HOW IT WAS FOUND.
   *
   * ⚠️ THIS ONE IS NOT IN THE SCREENSHOT. It was found by THE-326's own source
   * guard while that guard was being mutation-tested: the sweep for a
   * self-closing `<SelectValue/>` reported a SECOND one, on the person picker.
   * Its value is `personId` — a `users/{uid}` id — so an assigned row's closed
   * picker read `u-ada` where it should read "Ada Pastor".
   *
   * 🔴 IT IS THE SAME BUG, NOT A NEW SCOPE. Same file, same primitive, same
   * cause, same one-line shape of fix. Leaving it would have meant weakening
   * the guard to walk past it, which is the tell that it belongs here.
   */
  it('🔴 the person picker shows a NAME, never the `users/{uid}` behind it', async () => {
    await renderView();
    const assigned = [...host.querySelectorAll('[data-slot="select-value"]')]
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => t !== 'Unassigned');

    expect(assigned.length, 'no assigned picker rendered — this claim is vacuous')
      .toBeGreaterThan(0);
    for (const shown of assigned) {
      expect(shown, `a picker shows "${shown}", which is a document id`).not.toMatch(/^u-/);
      expect(shown).toBe('Ada Pastor');
    }
  });

  it('and an unassigned row still says so, rather than printing its sentinel', async () => {
    // ⚠️ The placeholder path: `UNASSIGNED` is `__unassigned__`, and a render
    // function that forgot it would print that on screen.
    await renderView();
    const shown = [...host.querySelectorAll('[data-slot="select-value"]')]
      .map((el) => (el.textContent ?? '').trim());
    expect(shown.join(' | '), 'the unassigned sentinel reached the screen')
      .not.toContain('__unassigned__');
  });

  it('🔴 and no raw epoch appears anywhere the rota renders, on any tab', async () => {
    await renderView();
    for (const label of ['Rota', 'Who is on', 'Not served recently']) {
      await act(async () => { tab(label).click(); });
      expect(
        epochsIn(host.textContent ?? ''),
        `a raw timestamp is rendered on the "${label}" tab`,
      ).toEqual([]);
    }
  });
});
