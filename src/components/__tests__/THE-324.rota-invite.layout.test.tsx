// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros on every
// element and `getComputedStyle(el).overflowX` cannot tell a scroller from a
// block. No assertion below could tell a 44px control from a 25px one.
// Everything here is measured in real Chromium over CDP
// (`src/test/support/browser-measure.ts`), which is why this file selects the
// `node` environment and renders to a string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { FORM_CONTAINER, FORM_MEASURE, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import RotaInviteView from '../events/RotaInviteView';
import RotaRespondView, { type RespondRow } from '../events/RotaRespondView';
import type { ServicePlanItem } from '../events/service-plan';
import type { RotaService } from '../events/volunteer-rota';
import { unfilledSlots, type RotaInvitation } from '../events/rota-invitations';

/**
 * THE-324 — WHERE invite/accept/remind renders, measured in Chromium.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THIS FILE MOUNTS THE REAL COMPONENTS. NEITHER IS A REPLICA.
 *
 * ⚠️ Most Chromium layout suites in this repo render a hand-written copy of the
 * screen and then need a second assertion pinning the copy's class strings
 * against the real file, because the copy drifts the moment somebody edits one
 * and not the other. #449 established the better shape and part 2 kept it:
 * `RotaInviteView.tsx` and `RotaRespondView.tsx` import no Firestore, no
 * react-query and no `fetch`, so `renderToStaticMarkup` renders the SHIPPED
 * components and the boxes measured below are the boxes a church — and a
 * volunteer — sees. There is no replica to pin.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ ONE `MeasuringBrowser` IN THIS PROCESS, AND BOTH PAGES ARE IN IT.
 *
 * Two instances in one process collide on the debugger port and can silently
 * compare a page with itself. So the admin panel and the public accept page are
 * rendered into ONE document, side by side under distinct data attributes, and
 * measured together. `open()` is called exactly once.
 *
 * ⚠️ AND NOTHING IS READ IMMEDIATELY AFTER A RESIZE. `transition-all` is on
 * `button`'s own base class, so a reading taken in the same frame as a resize is
 * a lie and a drifting value is the tell. `evaluateAt`'s settle delay is passed
 * explicitly, as the neighbouring suites pass it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ WIDTH IS NOT MONOTONIC ON THIS SHELL, so the ladder is measured WHOLE:
 * 380 / 768 / 1024 / 1280 / 1440. #429 measured a panel FALLING at 1024 — the
 * shell takes 275.5px away crossing that line — and #426 measured a card falling
 * twice with its narrowest point at 1280. Measuring only the ends would miss
 * both.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/* ═════════════════════════════════════════════════════════════════════════════
   The fixture. ⚠️ Deliberately hostile: real-length names and item titles, and
   enough rows that a list which happened to fit would be visible as such.
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date(2026, 8, 9, 9, 0, 0);
const SUNDAY = new Date(2026, 8, 13, 10, 0, 0);

const ADAEZE = 'Adaeze Okonkwo-Fitzgerald';
const BENJAMIN = 'Benjamin Achterberg';

const item = (
  id: string, title: string, minutes: number, order: number, person: [string, string] | null,
): ServicePlanItem => ({
  id, title, minutes, order,
  personId: person ? person[0] : null,
  personName: person ? person[1] : null,
  note: null,
});

const SERVICE: RotaService = {
  eventId: 'e1',
  eventTitle: 'Sunday Morning Gathering',
  startsAt: SUNDAY,
  planId: 'p1',
  planName: 'Order of service',
  items: [
    item('i1', 'Welcome and call to worship', 3, 0, ['u-a', ADAEZE]),
    item('i2', 'Worship set — four songs, band and singers', 22, 1, ['u-b', BENJAMIN]),
    item('i3', 'Notices, birthdays and the offering', 6, 2, null),
    item('i4', 'Sermon: Ephesians 4 and the shape of a church', 31, 3, ['u-a', ADAEZE]),
    item('i5', 'Response, ministry time and the sending', 12, 4, null),
  ],
};

const INVITED: RotaInvitation = {
  id: 'p1__i1',
  tenantId: 'grace',
  planId: 'p1',
  itemId: 'i1',
  eventId: 'e1',
  personId: 'u-a',
  personName: ADAEZE,
  eventTitle: 'Sunday Morning Gathering',
  itemTitle: 'Welcome and call to worship',
  startsAt: SUNDAY,
  status: 'invited',
  invitedAt: NOW,
  remindedAt: null,
  respondedAt: null,
  reminderCount: 0,
  channels: { email: 'sent', sms: 'sent' },
};

const REPORT = unfilledSlots(
  [SERVICE],
  [INVITED],
  { failed: false, servicesComplete: true, invitationsTruncated: false },
  NOW,
);

const respondRow = (id: string, title: string): RespondRow => ({
  id,
  eventTitle: 'Sunday Morning Gathering',
  itemTitle: title,
  startsAtMs: SUNDAY.getTime(),
  status: 'invited',
});

/* ═════════════════════════════════════════════════════════════════════════════
   The page: the admin panel inside the admin shell, and the public accept page
   below it in its own route wrapper.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Box { x: number; width: number; height: number; right: number }
interface Control { label: string; scope: string; width: number; height: number; minHeight: string; cssHeight: string }
interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  adminCard: Box | null;
  respondCard: Box | null;
  controls: Control[];
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div>
      {/* ── The ADMIN side, inside the admin shell ──────────────────────── */}
      <div className="flex h-screen" data-admin-shell>
        {/* The admin nav in its SIDEBAR form, from lg. `w-64` is the shell's own. */}
        <div className="hidden lg:block w-64 shrink-0" />
        <div className="min-w-0 flex-1 flex flex-col">
          {/* AdminDashboard's scroller, class for class. */}
          <div className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6">
            {/* AdminEvents' rota view wrapper — FORM_CONTAINER, Rule 1a. */}
            <div className={`w-full ${FORM_CONTAINER} space-y-6`} data-admin-scope>
              <RotaInviteView
                report={REPORT}
                loading={false}
                pending={{ messages: 20, smsSegments: 23 }}
                remindersDue={4}
                smsUnavailable
                busy={false}
                outcome={{ kind: 'sent', message: '18 of 20 reached someone, using 23 SMS segments.' }}
                onInvite={() => {}}
                onRemind={() => {}}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── The PUBLIC accept page. 🔴 NO ADMIN SHELL: it is its own route,
             which is why it is the one surface in this ticket that spends a
             MEASURE of its own (Rule 1b). ─────────────────────────────────── */}
      <div data-respond-scope>
        <RotaRespondView
          churchName="Grace Chapel and Community Centre"
          personName={ADAEZE}
          current={respondRow('p1__i1', 'Welcome and call to worship')}
          upcoming={[
            respondRow('p2__i1', 'Sermon: Ephesians 4 and the shape of a church'),
            respondRow('p3__i1', 'Worship set — four songs, band and singers'),
          ]}
          onAnswer={async () => 'accepted'}
        />
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the324-'));
  const file = path.join(dir, 'rota-invite.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    /**
     * 🔴 WAIT OUT `transition-all` BEFORE READING, AND DO NOT TRUST THE FIRST
     * ANSWER EITHER.
     *
     * ⚠️ `button`'s own base class carries `transition-all`, so `height` and
     * `min-height` ANIMATE across a viewport change, and the helper's own settle
     * is a couple of frames — shorter than the transition. A reading taken then
     * is a lie, and A DRIFTING VALUE IS THE TELL: this suite's first run
     * measured a control mid-flight at 39.73px tall with a `min-height` of
     * 1.43px on its way to 44px, and would have recorded a real 39.73px control
     * had it been believed.
     *
     * So the page is read REPEATEDLY and nothing is returned until two
     * consecutive readings are identical. That is a proof the layout has stopped
     * moving, rather than a longer guess at how long it takes.
     */
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(async () => {
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const read = () => {
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, width: b.width, height: b.height, right: b.right };
      };
      const controlsIn = (root, scope) => [...root.querySelectorAll(
        '[data-slot="button"]'
      )].map((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 44),
          scope,
          width: b.width,
          height: b.height,
          minHeight: cs.minHeight,
          cssHeight: cs.height,
        };
      });
      const admin = document.querySelector('[data-admin-scope]');
      const respond = document.querySelector('[data-respond-scope]');
      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        adminCard: box(document.querySelector('[data-rota-invite-card]')),
        respondCard: box(document.querySelector('[data-rota-invitation]')),
        controls: [...controlsIn(admin, 'admin'), ...controlsIn(respond, 'respond')],
      };
      };

      await pause(400);
      let previous = JSON.stringify(read());
      for (let attempt = 0; attempt < 12; attempt++) {
        await pause(150);
        const current = read();
        const serialised = JSON.stringify(current);
        if (serialised === previous) return current;
        previous = serialised;
      }
      throw new Error('the layout never stopped moving at ' + window.innerWidth);
    })()`, 780));
  }
}, 240_000);

afterAll(async () => {
  await browser?.close();
});

const at = (viewport: number): Reading => {
  const r = readings.get(viewport);
  if (!r) throw new Error(`nothing was measured at ${viewport}`);
  return r;
};

/* ═══ 0 · The measurement itself is real ═══════════════════════════════════ */

describe('the measurement is real', () => {
  it('every viewport was measured, and the browser laid both pages out', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.viewport, `the viewport override did not take at ${v}`).toBe(v);
      expect(r.adminCard, `no admin card at ${v}`).not.toBeNull();
      expect(r.respondCard, `no accept card at ${v}`).not.toBeNull();
      expect((r.adminCard as Box).width, `the admin card has no width at ${v}`).toBeGreaterThan(100);
      expect((r.respondCard as Box).width, `the accept card has no width at ${v}`).toBeGreaterThan(100);
    }
  });

  it('and the fixture is the hostile one — five rows, two of them unfilled, real-length names', () => {
    // ⚠️ A guard on the FIXTURE, not on the app: a later edit that trimmed this
    // down would make the assertions below pass by fitting rather than by
    // laying out correctly.
    expect(SERVICE.items).toHaveLength(5);
    expect(REPORT.verdict.complete).toBe(true);
    expect(REPORT.warnings.length).toBeGreaterThanOrEqual(3);
    expect(ADAEZE.length).toBeGreaterThan(20);
  });

  it('exactly ONE browser was opened in this process', () => {
    // ⚠️ Two `MeasuringBrowser` instances in one process collide on the
    // debugger port and can silently compare a page with itself.
    expect(browser).toBeDefined();
    expect(readings.size).toBe(VIEWPORTS.length);
  });
});

/* ═══ 16a · 🔴 THE PAGE BODY NEVER SCROLLS SIDEWAYS, AT ANY OF THE FIVE ═══ */

describe('neither surface makes the page scroll sideways', () => {
  it.each(VIEWPORTS)('🔴 the page body does not scroll sideways at %ipx', (viewport) => {
    const r = at(viewport);
    // ⚠️ Both, because they can disagree: an overflowing child can extend the
    // documentElement's scroll width while `body` still measures the viewport.
    expect(r.docScrollWidth, `the PAGE scrolls sideways at ${viewport}`)
      .toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `the BODY scrolls sideways at ${viewport}`)
      .toBeLessThanOrEqual(viewport);
  });

  it.each(VIEWPORTS)('both cards stay inside the viewport at %ipx', (viewport) => {
    for (const [name, card] of [
      ['the admin card', at(viewport).adminCard as Box],
      ['the accept card', at(viewport).respondCard as Box],
    ] as const) {
      expect(card.x, `${name} starts off-screen at ${viewport}`).toBeGreaterThanOrEqual(0);
      expect(card.right, `${name} ends past the viewport at ${viewport}`)
        .toBeLessThanOrEqual(viewport + 0.5);
    }
  });

  it('🔴 the accept page is capped by FORM_MEASURE and does not run the width of a monitor', () => {
    // Rule 1b — 940px. This surface is its OWN route with no admin shell above
    // it, so nothing else has spent a measure and unbounded it would be 1440px
    // of one card. The number is the module's, not this file's.
    expect(FORM_MEASURE).toContain('940px');
    const wide = at(1440).respondCard as Box;
    expect(wide.width, 'the accept card is not capped at 1440px').toBeLessThanOrEqual(941);
    // And it is NOT capped on a phone — Rule 1b is `sm:`-gated, and below 640px
    // the app must not move.
    const phone = at(380).respondCard as Box;
    expect(phone.width).toBeGreaterThan(300);
  });

  it('width is not monotonic across the ladder, and the whole ladder was measured', () => {
    // ⚠️ Recorded rather than asserted as increasing: #449 measured this shell
    // going 380 → 768 → 748.5 → 1004.5 → 1120, because the sidebar appears at lg
    // and TAKES width away. A test that assumed growth would be wrong here.
    const widths = VIEWPORTS.map((v) => (at(v).adminCard as Box).width);
    expect(widths.length).toBe(5);
    const grewEverywhere = widths.every((w, i) => i === 0 || w > widths[i - 1]);
    expect(grewEverywhere, 'width became monotonic — re-read #429 before trusting the ends')
      .toBe(false);
  });
});

/* ═══ 16b · 🔴 EVERY CONTROL ≥44px BELOW sm; RULE 4 HOLDS ABOVE ═══════════ */

describe('every control is at least 44px below sm, and Rule 4 holds above', () => {
  it('🔴 at 380px every control on BOTH surfaces clears the thumb floor on both axes', () => {
    const controls = at(380).controls;
    expect(controls.length, 'no controls were measured').toBeGreaterThanOrEqual(4);
    for (const c of controls) {
      expect(
        c.height,
        `"${c.label}" (${c.scope}) is ${c.height}px tall at 380px `
        + `(min-height ${c.minHeight}, height ${c.cssHeight})`,
      ).toBeGreaterThanOrEqual(44);
      expect(c.width, `"${c.label}" (${c.scope}) is ${c.width}px wide at 380px`)
        .toBeGreaterThanOrEqual(44);
    }
  });

  it('and BOTH surfaces contributed controls, not just one', () => {
    // ⚠️ Otherwise this passes on a page whose only 44px controls are the admin
    // panel's, and the public accept page — the one a volunteer taps on a phone
    // from a text message — goes unmeasured.
    const scopes = new Set(at(380).controls.map((c) => c.scope));
    expect([...scopes].sort()).toEqual(['admin', 'respond']);
    const labels = at(380).controls.map((c) => c.label);
    expect(labels.some((l) => l === 'Accept this slot'), 'the accept button was not measured').toBe(true);
    expect(labels.some((l) => l === 'Decline this slot'), 'the decline button was not measured').toBe(true);
    expect(labels.some((l) => l.startsWith('Invite')), 'the invite button was not measured').toBe(true);
  });

  it('🔴 from sm up Rule 4 takes over at 40px, which is DELIBERATELY under 44', () => {
    /**
     * `DENSITY_PX.control < 44` is asserted in `form-layout.ts` on purpose: a
     * pointer at a desktop is not a thumb. So this is the two rules AGREEING,
     * not fighting — and what is asserted is that the phone floor is RELEASED
     * above `sm` rather than that it was never applied.
     *
     * ⚠️ The floor is spelled `min-h-[44px]` and released with `sm:min-h-0`.
     * Without the release, `min-height` would beat `height` and these would
     * still be 44 up here; that this measures 40 is the proof the release took.
     *
     * ⚠️ PREMISE CORRECTED BY THE-323 (#465): the Tailwind form `min-h-11` is
     * NOT inert. The 7.63px figure this ticket was handed is a `transition-all`
     * artefact — the SAME drift this suite ran into at 380px and now waits out
     * above. The explicit form still ships because it is absolute at every
     * width, where `min-h-11` is rem-relative and diverges above `lg`.
     */
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(DENSITY_PX.action).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
    for (const v of [768, 1024, 1280, 1440]) {
      const controls = at(v).controls;
      expect(controls.length, `no controls at ${v}`).toBeGreaterThanOrEqual(4);
      for (const c of controls) {
        expect(c.height, `"${c.label}" (${c.scope}) is ${c.height}px at ${v}, not Rule 4's ${DENSITY_PX.action}`)
          .toBeCloseTo(DENSITY_PX.action, 0);
      }
    }
  });

  it('🔴 and every control really carries the floor, measured rather than inferred', () => {
    // The 380px case above would catch a missing floor by its height; this
    // asserts the CAUSE directly, so a failure names itself rather than leaving
    // a reader to work back from a number.
    expect(at(380).controls.every((c) => parseFloat(c.minHeight) >= 44), 'a control has no 44px floor')
      .toBe(true);
    for (const v of [768, 1024, 1280, 1440]) {
      expect(at(v).controls.every((c) => parseFloat(c.minHeight || '0') < 44),
        `the 44px floor was not released above sm at ${v}`).toBe(true);
    }
  });
});
