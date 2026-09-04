// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-276-FIX, THE-283 and THE-290
// give. Nothing here needs a DOM: the page is rendered to a string and every
// measurement happens inside a real browser over CDP. Under happy-dom the
// globals carry browser semantics and a request to the browser's own debugger
// port fails same-origin, so the browser could never be attached to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { FORM_CONTAINER, CONTROL_DENSITY, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import { AdminEditorHeader, AdminSecondaryButton } from '../admin/AdminUI';
import FormAnswersView from '../forms/FormAnswersView';
import { summariseForm, type AnswerField, type AnswerSubmission } from '../forms/form-answers';

/**
 * THE-298 — WHERE the per-question answers view renders, measured in Chromium.
 *
 * ─── Why this is measured and not reasoned about ─────────────────────────────
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE. `getBoundingClientRect()` returns zeros on
 * every element and `getComputedStyle` answers `display: block` for a flex
 * container even with the real compiled stylesheet injected. Every other layout
 * guard in this repo reasons about CLASS NAMES, which answers "how wide may
 * this box be" and cannot answer "where did this box actually land".
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell and the ladder is measured whole
 * because of it — #429 measured a panel FALLING at 1024 and #426 measured a card
 * falling twice with its narrowest point at 1280. A test that checked the phone
 * and the desktop would have missed both.
 *
 * ─── The two properties that matter at 380px ─────────────────────────────────
 *
 * 🔴 A LONG LIST MUST SCROLL INSIDE ITS OWN CARD. A free-text question with
 * hundreds of answers is taller than any phone, and the wrong fix is to let that
 * reach the page. #422 established the rule; this asserts the card's own
 * scroller is the thing that scrolls, that it GENUINELY overflows so the claim
 * is not vacuous, and that `documentElement` does not overflow horizontally at
 * all.
 *
 * 🔴 THE LAST CARD MUST CLEAR THE BOTTOM NAV. ⚠️ `pb-safe` compiles to NOTHING
 * in this app — see {@link PB_SAFE}. The clearance here is therefore explicit
 * and does not depend on it, nor on THE-295 landing a fix first.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/**
 * ⚠️ `pb-safe` IS NOT A RULE IN THIS APP. Neither globals.css nor the Tailwind
 * config defines it and no plugin supplies it, so the class compiles to nothing
 * and contributes ZERO bottom padding. THE-295 is fixing that; this file must
 * not wait for it and must not lean on it.
 *
 * The clearance the shell actually provides on a phone is `pb-24` on its scroll
 * container, which is real. The nav replica below carries `pb-safe` anyway —
 * class for class with the shell — so that if THE-295 lands and the class starts
 * meaning something, this test measures the shell that then exists rather than
 * a model of the old one.
 */
const PB_SAFE = 'compiles to nothing today; the clearance below comes from pb-24';

/**
 * ⚠️ HOW THE SHELL IS APPROXIMATED, and what that makes load-bearing.
 *
 * `AdminDashboard.tsx` is THE-291's and this ticket may not open it, so its
 * geometry is REPLICATED from the class strings it carries rather than invented,
 * exactly as THE-283 and THE-290 replicate it.
 *
 * 🔴 THE SIDEBAR AND THE BOTTOM NAV ARE ONE ELEMENT — a single
 * `fixed lg:relative bottom-0 lg:bottom-auto … lg:w-64 lg:h-screen z-[100]` with
 * `pb-safe lg:pb-0`. Rendering a spacer AND a second nav beside it charges the
 * row twice, which is a fixture bug that re-pins every width to a layout the app
 * does not have. So the one element is modelled as its two forms, each where it
 * applies: a `w-[289px]` spacer from `lg`, and an `lg:hidden` bottom bar below.
 *
 * 🔴 NO WIDTH ASSERTION READS ANY OF THESE NUMBERS — every width claim below is
 * relative or about overflow. The one assertion that depends on the replication
 * is the bottom-nav clearance, and what it proves is that THIS SCREEN's last
 * card does not grow past the clearance the shell provides, which is the
 * property a screen can break and the only part of it this ticket owns.
 */
const SHELL_NOTE = 'see the block comment above';

/**
 * The phone floor on the answers view's own control.
 *
 * ⚠️ MEASURED. `AdminSecondaryButton` renders 41.5px at 380px in Chromium —
 * 2.5px under the 44px floor — so the floor goes on THIS button rather than on
 * the primitive, which every secondary button in the admin app shares. Above
 * `sm` the reset hands the box back to Rule 4's 38px.
 *
 * 🔴 Spelled here AND asserted against AdminForms.tsx below, so the replica in
 * this file cannot drift away from the screen it is standing in for.
 */
const ANSWERS_ACTION_CLASS = 'min-h-[44px] sm:min-h-0';

/* ── The form under test, and a hostile set of answers ────────────────────── */

const FIELDS: AnswerField[] = [
  { id: 'q_name', type: 'short_text', label: 'Full name', order: 0 },
  {
    id: 'q_story',
    type: 'long_text',
    label: 'Tell us, in your own words, what drew you to this church and where you would most like to serve',
    order: 1,
  },
  { id: 'q_email', type: 'email', label: 'Email address', order: 2 },
  { id: 'q_phone', type: 'phone', label: 'Mobile number', order: 3 },
  { id: 'q_guests', type: 'number', label: 'How many guests will you bring', order: 4 },
  {
    id: 'q_team',
    type: 'dropdown',
    label: 'Which team would you like to join',
    // ⚠️ Deliberately hostile: a church genuinely writes an option this long,
    // and a bar row sized against "Kids" would pass a test it should fail.
    options: [
      'Worship & Production — Sunday mornings and Thursday rehearsal',
      'Kids & Family Ministry (nursery through fifth grade)',
      'Hospitality',
      'Car Park & Welcome',
    ],
    order: 5,
  },
  { id: 'q_first', type: 'radio', label: 'Is this your first time', options: ['Yes', 'No'], order: 6 },
  { id: 'q_days', type: 'checkbox', label: 'Which days can you serve', options: ['Saturday', 'Sunday', 'Midweek'], order: 7 },
  { id: 'q_start', type: 'date', label: 'Available from', order: 8 },
];

/** 640 responses — past the 500 page size, and long enough that lists overflow. */
const N = 640;
const SUBMISSIONS: AnswerSubmission[] = Array.from({ length: N }, (_, i) => ({
  id: `s${String(i).padStart(4, '0')}`,
  submittedAt: null,
  answers: {
    q_name: `Person ${i}`,
    q_story:
      i % 3 === 0
        ? 'A friend invited me and I have been coming ever since. I would love to help with the children if there is room.'
        // ⚠️ A single unbroken token — the thing that overflows a card if the
        // text is not allowed to break.
        : `https://example.org/a/very/long/unbroken/answer/that/nothing/will/wrap/for/me/${i}`,
    q_email: `person${i}@example.com`,
    q_phone: `+15550${String(i).padStart(4, '0')}`,
    q_guests: String(i % 5),
    q_team: FIELDS[5].options![i % 4],
    q_first: i % 2 === 0 ? 'Yes' : 'No',
    q_days: i % 2 === 0 ? ['Saturday'] : ['Saturday', 'Sunday', 'Midweek'],
    q_start: `2026-0${(i % 9) + 1}-01`,
  },
}));

const SUMMARIES = summariseForm(FIELDS, SUBMISSIONS);

const SELECTORS = {
  scroller: '[data-shell-scroll]',
  measure: '[data-answers-measure]',
  view: '[data-answers-view]',
  scope: '[data-answers-scope]',
  firstCard: '[data-question="q_name"]',
  storyCard: '[data-question="q_story"]',
  storyScroller: '[data-question="q_story"] [data-answer-scroller]',
  teamCard: '[data-question="q_team"]',
  lastCard: '[data-question="q_start"]',
  bottomNav: '[data-shell-bottom-nav]',
} as const;

interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  boxes: Record<string, { x: number; width: number; right: number; top: number; bottom: number } | null>;
  storyScroller: { clientHeight: number; scrollHeight: number; clientWidth: number; scrollWidth: number; overflowY: string; overflowX: string } | null;
  /** Every button on the surface, with its measured box. */
  controls: { label: string; width: number; height: number }[];
  bars: number;
  navPosition: string;
  scrolled: { lastBottom: number; navTop: number; scrolledBy: number } | null;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  expect(SHELL_NOTE).toBeTruthy();
  expect(PB_SAFE).toBeTruthy();
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The nav IN ITS SIDEBAR FORM, from `lg`. No width assertion reads it. */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        {/*
          AdminDashboard's own scroll container on a height-constrained parent so
          it genuinely scrolls: `pb-24` is what provides the bottom-nav clearance
          on a phone, and `lg:pb-8` removes it at `lg` where the same nav has
          become the sidebar beside it. 🔴 Without the height constraint the
          container grows to its content and never scrolls, so a clearance
          assertion against it would measure nothing.

          ⚠️ `p-0 lg:p-6` is omitted for the reason THE-290 records: it costs
          43.5px at the 14.5px desktop rem base and #429's pinned ladder does not
          model it, so leaving it out keeps this ladder comparable with that one.
          The VERTICAL clearance, which the bottom-nav test needs, is kept.
        */}
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8">
          {/* AdminForms' answers view, wrapper and measure class for class. */}
          <div data-answers-measure className={FORM_CONTAINER} style={{ paddingBottom: 120 }}>
            <AdminEditorHeader
              onBack={() => {}}
              backLabel="All forms"
              title="Volunteer Sign-Up"
              subtitle={`${N} responses`}
              actions={
                <AdminSecondaryButton className={ANSWERS_ACTION_CLASS}>All responses</AdminSecondaryButton>
              }
            />
            <FormAnswersView
              summaries={SUMMARIES}
              total={N}
              counted={N}
              truncated={false}
              loading={false}
            />
          </div>
        </div>
      </div>
      {/*
        🔴 The SAME nav in its bottom-bar form, below `lg` only. `lg:hidden`
        because the spacer above already stands for it from `lg`.
      */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the298-'));
  const file = path.join(dir, 'answers.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const reading = await browser.evaluateAt<Reading>(viewport, `(() => {
      const sel = ${JSON.stringify(SELECTORS)};
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, width: b.width, right: b.right, top: b.top, bottom: b.bottom };
      };
      const boxes = {};
      for (const k of Object.keys(sel)) boxes[k] = box(document.querySelector(sel[k]));

      const story = document.querySelector(sel.storyScroller);
      const cs = story && getComputedStyle(story);
      const storyScroller = story ? {
        clientHeight: story.clientHeight, scrollHeight: story.scrollHeight,
        clientWidth: story.clientWidth, scrollWidth: story.scrollWidth,
        overflowY: cs.overflowY, overflowX: cs.overflowX,
      } : null;

      const controls = [...document.querySelectorAll(sel.measure + ' button, ' + sel.measure + ' a')]
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { label: (el.textContent || '').replace(/\\s+/g, ' ').trim() || el.tagName,
                   width: b.width, height: b.height };
        });

      const nav = document.querySelector(sel.bottomNav);

      // The clearance case only EXISTS at the bottom of the scroll container.
      const scroller = document.querySelector(sel.scroller);
      let scrolled = null;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        const last = document.querySelector(sel.lastCard);
        scrolled = {
          lastBottom: last ? last.getBoundingClientRect().bottom : 0,
          navTop: nav ? nav.getBoundingClientRect().top : 0,
          scrolledBy: scroller.scrollTop,
        };
        scroller.scrollTop = 0;
      }

      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        boxes, storyScroller, controls,
        bars: document.querySelectorAll('[data-option-bar]').length,
        navPosition: nav ? getComputedStyle(nav).position : 'absent',
        scrolled,
      };
    })()`);
    readings.set(viewport, reading);
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number) => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/* ═════════════════════════════════════════════════════════════════════════════
   The ladder — recorded whole, because width here is not monotonic.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the answers view lands where the shell leaves room, at every viewport', () => {
  it('renders every question at every viewport', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.boxes.view, `${v}px: the answers view is absent`).toBeTruthy();
      for (const key of ['firstCard', 'storyCard', 'teamCard', 'lastCard'] as const) {
        expect(r.boxes[key], `${v}px: ${key} is absent`).toBeTruthy();
        expect(r.boxes[key]!.width, `${v}px: ${key} has no width`).toBeGreaterThan(0);
      }
    }
  });

  it('records the measured width ladder rather than asserting a single number', () => {
    // ⚠️ Recorded, not asserted against a formula. #429 measured this shell's
    // content box FALLING at 1024 (the sidebar takes 289px the moment `lg`
    // applies) and #426 measured a card narrowest at 1280. The numbers below are
    // what Chromium reported; the assertions that follow are relative or about
    // overflow, so none of them depends on a particular one.
    const ladder = VIEWPORTS.map((v) => Math.round(at(v).boxes.measure!.width));
    expect(ladder).toHaveLength(5);
    for (const w of ladder) expect(w).toBeGreaterThan(0);
    // The non-monotonic step is REAL and is stated rather than smoothed over:
    // the content box is wider at 768 than at 1024, because crossing `lg` hands
    // 289px to the sidebar.
    expect(ladder[1], 'the 768 → 1024 fall this shell is known for is gone')
      .toBeGreaterThan(ladder[2]);
  });

  it('caps the view with the shared page measure and mints nothing beside it', () => {
    expect(FORM_CONTAINER).toBe('sm:max-w-[1120px] sm:mx-auto');
    for (const v of VIEWPORTS) {
      expect(at(v).boxes.measure!.width, `${v}px: the view exceeded the shared measure`)
        .toBeLessThanOrEqual(1120 + 0.5);
    }
  });

  it('draws a bar for every option of every choice question, and for nothing else', () => {
    const expected = SUMMARIES
      .filter((s) => s.kind === 'choice')
      .reduce((n, s) => n + (s.kind === 'choice' ? s.options.length : 0), 0);
    expect(expected).toBeGreaterThan(0);
    for (const v of VIEWPORTS) {
      expect(at(v).bars, `${v}px: the bars moved`).toBe(expected);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   13. A long list scrolls inside its card; the page body does not move.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('long lists scroll inside their card and the page body does not move at 380px', () => {
  it('GENUINELY overflows its own scroller, so the claim is not vacuous', () => {
    const s = at(380).storyScroller!;
    expect(s, 'the free-text card has no scroller').toBeTruthy();
    expect(s.scrollHeight, 'the list fits — this fixture proves nothing')
      .toBeGreaterThan(s.clientHeight);
    expect(s.overflowY, 'the card does not scroll its own overflow').toBe('auto');
  });

  it('keeps the page body still at 380px — the overflow never reaches it', () => {
    // 🔴 #422's rule. Horizontal body scroll on a phone makes every other card
    // drift under the thumb, and a free-text answer that is one unbroken URL is
    // exactly what causes it. The fixture above contains those on purpose.
    const r = at(380);
    expect(r.docScrollWidth, 'the page scrolls horizontally at 380px').toBeLessThanOrEqual(380);
    expect(r.bodyScrollWidth, 'the body scrolls horizontally at 380px').toBeLessThanOrEqual(380);
  });

  it('keeps the page still at every other viewport too', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).docScrollWidth, `${v}px: the page scrolls horizontally`).toBeLessThanOrEqual(v);
    }
  });

  it('keeps every card inside the measure, long labels and long options included', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      const m = r.boxes.measure!;
      for (const key of ['storyCard', 'teamCard', 'lastCard'] as const) {
        const b = r.boxes[key]!;
        expect(b.right, `${v}px: ${key} runs past the measure`).toBeLessThanOrEqual(m.right + 0.5);
        expect(b.x, `${v}px: ${key} starts before the measure`).toBeGreaterThanOrEqual(m.x - 0.5);
      }
    }
  });

  it('clears the bottom nav once the container is scrolled to its end', () => {
    // 🔴 The one assertion that depends on the shell replica, and it is the
    // property this SCREEN owns: its last card must not grow past the clearance
    // the shell provides. ⚠️ That clearance is `pb-24`, not `pb-safe` — see the
    // PB_SAFE note. The nav is `fixed` at `z-[100]`, so anything under it is
    // unreadable rather than merely low.
    const r = at(380);
    expect(r.navPosition, 'the nav replica is not fixed — the test would prove nothing').toBe('fixed');
    const s = r.scrolled!;
    expect(s.scrolledBy, 'the container did not scroll — nothing was tested').toBeGreaterThan(0);
    expect(s.lastBottom, 'the last card ends underneath the bottom nav').toBeLessThanOrEqual(s.navTop);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   12. Controls.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('every control is ≥44px below sm; Rule 4’s 38px holds above', () => {
  it('measures every control on the answers view at 380px and records the result', () => {
    // ⚠️ RECORDED, in the idiom AdminMinistry.desktop-layout.test.tsx already
    // uses ("records the measured result rather than asserting a 44px floor").
    // The view's only controls are the shell chrome AdminEditorHeader supplies —
    // this ticket adds no control of its own to this surface — so the list below
    // is inherited, and the claim made about it is that this ticket did not
    // shrink it.
    const controls = at(380).controls;
    expect(controls.length, 'the view rendered no control at all').toBeGreaterThan(0);
    for (const c of controls) {
      expect(c.height, `"${c.label}" has no height`).toBeGreaterThan(0);
    }
    // The tappable control this ticket puts on the surface — the route back to
    // the responses table — clears 44px on a phone.
    const toTable = controls.find((c) => c.label === 'All responses');
    expect(toTable, 'the route to the responses table is gone').toBeTruthy();
    expect(toTable!.height, 'the answers view’s own control is under the 44px floor on a phone')
      .toBeGreaterThanOrEqual(44);

    // 🔴 The replica cannot drift from the screen: the class that lifts the
    // button is spelled in AdminForms.tsx too, and this fails if it stops being.
    const src = readFileSync(path.resolve(__dirname, '../AdminForms.tsx'), 'utf8');
    expect(src, 'the screen no longer carries the phone floor this file measured')
      .toContain(`className="${ANSWERS_ACTION_CLASS}"`);
  });

  it('leaves the shell chrome it inherits exactly the size it was', () => {
    // ⚠️ AdminEditorHeader's own "All forms" back button is a text link with no
    // box of its own to lift, and it is shared chrome this ticket does not own.
    // Recorded rather than silently passed over: it measures under the floor,
    // it measured under the floor before this ticket, and nothing here shrank
    // it. Raising it is a change to AdminUI.tsx and every screen that mounts it.
    const back = at(380).controls.find((c) => c.label === 'All forms');
    expect(back, 'the back control is gone').toBeTruthy();
    expect(back!.height).toBeGreaterThan(0);
    expect(back!.height).toBeLessThan(44);
  });

  it('holds Rule 4 above sm — 38px, deliberately under the 44px floor', () => {
    // ⚠️ Not a defect and not to be fought: above `sm` these are pointer
    // targets, and form-layout.ts fixes a control at 38px on purpose. The
    // module's own test asserts DENSITY_PX.control < 44 for the same reason.
    expect(DENSITY_PX.control).toBe(38);
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(DENSITY_PX.action).toBe(40);
    expect(DENSITY_PX.action).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
    for (const t of [...CONTROL_DENSITY.control.split(' '), ...CONTROL_DENSITY.action.split(' ')]) {
      expect(t.startsWith('sm:'), `"${t}" reaches a phone`).toBe(true);
    }
  });

  it('shrinks no control above sm either — nothing on this surface exceeds the band', () => {
    for (const v of [768, 1024, 1280, 1440] as const) {
      for (const c of at(v).controls) {
        expect(c.height, `${v}px: "${c.label}" is taller than the desktop band`)
          .toBeLessThanOrEqual(56);
      }
    }
  });

  it('adds the form card’s Answers button with the SAME class string as its siblings', () => {
    // 🔴 The button this ticket adds to the form card is not on the surface
    // measured above, so its size is established the stronger way instead: it
    // carries the byte-identical class string of the buttons it sits beside, so
    // it is necessarily the same box. Those siblings are pre-existing 27px
    // targets that THE-190 deliberately left alone (423 of them across the app),
    // and matching them means this ticket shrinks nothing and mints no new size.
    // ⚠️ Reported rather than silently satisfied: the new button is under 44px
    // BECAUSE its four siblings are, and lifting one of five would be a redesign
    // of a row this ticket does not own.
    const src = readFileSync(path.resolve(__dirname, '../AdminForms.tsx'), 'utf8');
    const mobile = 'className="p-1.5 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors"';
    const desktop = 'className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-gold transition-colors"';
    expect(src.split(mobile).length - 1, 'the mobile row no longer shares one class string')
      .toBeGreaterThanOrEqual(3);
    expect(src).toContain(`<button onClick={() => openAnswers(form)} ${mobile}`);
    expect(src).toContain(`<button onClick={() => openAnswers(form)} ${desktop}`);
  });
});
