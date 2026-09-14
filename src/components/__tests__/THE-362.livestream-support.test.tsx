import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { getPlanFeatures } from '../../utils/plan-features';

/**
 * THE-362 - "Support This Message", and where it actually went.
 *
 * The founder: "In Livestream the support this message button brings you
 * nowhere. It should go to the donation page."
 *
 * --- What it was wired to, and why that is nowhere ---------------------------
 *
 * `MainApp` satisfied a REQUIRED `onDonate` with
 * `window.open('/?giving=1', '_blank', 'noopener,noreferrer')`. Two faults,
 * and they compound:
 *
 *   1. A NEW TAB ONTO THE APP ROOT. `donations/giving-share.ts` is explicit
 *      that `?giving=1` "is still the in-app deep link a signed-in member
 *      follows to the Give tab ... a member already inside the app should stay
 *      inside it" - THE-303 moved the PUBLIC share link to `/giving` precisely
 *      because the SPA root is not a destination you send someone to. Opening
 *      it in a second tab reboots the whole app for a member who was already
 *      signed into it, and leaves the stream playing in the tab behind them.
 *
 *   2. IT LANDS ON HOME WHENEVER THERE IS NO GIVE PAGE, which is the normal
 *      case today. `MainApp.effectiveTopTab` collapses `'partner'` to Home when
 *      `hasGiving` is false, and `hasGiving` requires `hasGivingRails` - card
 *      giving (off at the master switch since THE-256) OR a saved payment link.
 *      A church with neither gave its members a new tab showing the news feed.
 *      That is the THE-193 dead end, and THE-246 already fixed the same shape
 *      on `Profile`: `onGoToPartner={hasGiving ? ... : undefined}`, with the
 *      CTA hidden when the prop is absent.
 *
 * --- The destination, named -------------------------------------------------
 *
 * The `'partner'` top tab, which renders `PartnerWithUsTab` - the surface the
 * member app's **Give** tab reaches, and the one `?giving=1` exists to jump to.
 * Section 1 asserts that the tab id this button selects IS the id the Give tab
 * strip entry carries and IS the id whose panel mounts `PartnerWithUsTab`, so
 * "the donation page" is established from the code rather than asserted.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));

const MAIN_APP = 'src/components/MainApp.tsx';
const VIEW = 'src/components/LivestreamView.tsx';

/* ═══ the LivestreamView harness ═══════════════════════════════════════════ */

const { streamDoc } = vi.hoisted(() => ({
  streamDoc: { value: {} as Record<string, unknown> },
}));

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', displayName: 'Ada', email: 'ada@example.com' } },
}));

vi.mock('firebase/firestore', () => ({
  doc: (..._a: unknown[]) => ({ __doc: true }),
  collection: (..._a: unknown[]) => ({ __collection: true }),
  query: (..._a: unknown[]) => ({ __query: true }),
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (ref: { __doc?: boolean }, next: (s: unknown) => void) => {
    // The stream document for the `doc(...)` subscription; an empty comment
    // list for the `query(...)` one.
    if (ref.__doc) next({ data: () => streamDoc.value });
    else next({ docs: [] });
    return () => {};
  },
}));

// `authFetch` must RESOLVE: the viewer-count effect calls `.catch()` on its
// return value, so a bare `vi.fn()` throws during mount and would take the
// whole suite down before a single assertion ran.
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock('../TipTapReadOnly', () => ({ default: () => null }));

let LivestreamView: React.ComponentType<{
  tenantId: string | null;
  onBack: () => void;
  onDonate?: () => void;
}>;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  streamDoc.value = { active: true, sessionId: 's1', youtubeVideoId: 'v1', title: 'Sunday', viewerCount: 3 };
  LivestreamView = (await import('../LivestreamView')).default as typeof LivestreamView;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(props: { onDonate?: () => void }) {
  act(() => {
    root.render(
      <LivestreamView tenantId="grace" onBack={() => {}} onDonate={props.onDonate} />,
    );
  });
  return host;
}

const supportButton = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-livestream-support]');

/* ═══ 9 · the support button leads to the donation page ═══════════════════ */

describe('9 - the support button leads to the donation page', () => {
  it('the button is on the screen, and pressing it fires the donate jump', () => {
    const onDonate = vi.fn();
    const el = mount({ onDonate });
    const button = supportButton(el);
    expect(button, 'the Support This Message button is gone').not.toBeNull();
    expect(button!.textContent).toContain('Support This Message');
    act(() => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onDonate, 'the button is unwired - pressing it does nothing').toHaveBeenCalledTimes(1);
  });

  it('it no longer opens a second tab onto the app root', () => {
    const app = code(MAIN_APP);
    const deepLink = ['/?giv', 'ing=1'].join('');
    const opener = ['window', '.open'].join('');
    // The whole handler, as MainApp writes it.
    const mount = app.slice(app.indexOf('<LivestreamView'), app.indexOf('</LivestreamView') + 1 || undefined);
    const handler = app.slice(app.indexOf('<LivestreamView'), app.indexOf('/>', app.indexOf('<LivestreamView')));
    expect(mount.length, 'LivestreamView is no longer mounted by MainApp').toBeGreaterThan(0);
    expect(handler, 'the support button still opens a new tab').not.toContain(opener);
    expect(handler, 'the support button still points at the SPA deep link').not.toContain(deepLink);
  });

  it('it selects the `partner` tab, in the app the member is already in', () => {
    const app = code(MAIN_APP);
    const handler = app.slice(app.indexOf('<LivestreamView'), app.indexOf('/>', app.indexOf('<LivestreamView')));
    expect(handler, 'the handler does not select the Give tab').toContain("setActiveTopTab('partner')");
    expect(handler, 'the handler does not leave the full-screen livestream')
      .toContain("setFullScreenView({ type: 'none' })");
    expect(handler, 'the handler does not return to the Home bottom tab')
      .toContain("setActiveBottomTab('home')");
  });

  it('and `partner` IS the Give tab - the destination, established not assumed', () => {
    /**
     * THE ASSERTION THAT NAMES THE DESTINATION. `'partner'` is only "the
     * donation page" because two other things in MainApp say so: the tab strip
     * entry labelled **Give** carries that id, and the panel for that id mounts
     * `PartnerWithUsTab`. Both are checked here, so a rename that moved the Give
     * page to another id fails this rather than silently re-pointing the button.
     */
    const app = code(MAIN_APP);
    expect(app, "the Give tab strip entry no longer carries the id `partner`")
      .toMatch(/id:\s*'partner',\s*label:\s*'Give'/);
    expect(app, 'the partner panel no longer mounts PartnerWithUsTab')
      .toMatch(/effectiveTopTab === 'partner'[\s\S]{0,800}<PartnerWithUsTab/);
  });

  it('and it is the SAME jump Profile’s "Give again" makes', () => {
    // Not merely a similar one. Two hand-written jumps at one destination is
    // how the two would drift; both set the same two pieces of tab state.
    const app = code(MAIN_APP);
    expect(app).toMatch(/onGoToPartner=\{hasGiving \? \(\) => \{ setActiveBottomTab\('home'\); setActiveTopTab\('partner'\); \}/);
    const handler = app.slice(app.indexOf('<LivestreamView'), app.indexOf('/>', app.indexOf('<LivestreamView')));
    expect(handler).toContain("setActiveBottomTab('home')");
    expect(handler).toContain("setActiveTopTab('partner')");
  });
});

/* ═══ 10 · it is not shown where it would lead nowhere ════════════════════ */

describe('10 - it is not shown on a plan without it', () => {
  it('no Give page, no button - the THE-246 shape', () => {
    // `onDonate` absent is exactly what MainApp passes when `hasGiving` is
    // false. The button must not be drawn at all: a control that lands on the
    // news feed is the dead end this ticket exists to remove.
    const el = mount({});
    expect(supportButton(el), 'the button is drawn with nowhere to go').toBeNull();
    expect(el.textContent, 'the label is still on screen').not.toContain('Support This Message');
  });

  it('MainApp gates the prop on `hasGiving`, and passes `undefined` - not a no-op', () => {
    const app = code(MAIN_APP);
    const handler = app.slice(app.indexOf('<LivestreamView'), app.indexOf('/>', app.indexOf('<LivestreamView')));
    expect(handler, 'the donate jump is ungated').toMatch(/onDonate=\{hasGiving \?/);
    expect(handler, 'a no-op was passed instead of undefined - the button would still draw')
      .toMatch(/:\s*undefined/);
  });

  it('the prop is OPTIONAL in the component, so the gate is expressible', () => {
    expect(code(VIEW), 'onDonate is still required - it cannot be withheld')
      .toMatch(/onDonate\?:\s*\(\)\s*=>\s*void/);
  });

  it('livestream itself is a Pro and Ministry feature, and gated where it is reached', () => {
    /**
     * The plan matrix by NAME rather than by line - THE-331 pinned
     * `AdminCommunity.tsx:491` and a deletion moved it to `:311`.
     */
    expect(getPlanFeatures('free').livestream, 'Free gained livestream').toBe(false);
    expect(getPlanFeatures('plus').livestream, 'Individual gained livestream').toBe(false);
    expect(getPlanFeatures('pro').livestream, 'Small Team lost livestream').toBe(true);
    expect(getPlanFeatures('max').livestream, 'Ministry lost livestream').toBe(true);

    // The admin screen that starts a stream is plan-gated, so a plan without
    // the feature has no way to make one ACTIVE ...
    expect(code('src/components/AdminDashboard.tsx'))
      .toMatch(/planAllows\(features\?\.livestream\)/);
    // ... and the member only reaches this view from a banner that renders when
    // a stream IS active, so the whole surface is behind the same gate.
    expect(code('src/components/LiveNowBanner.tsx')).toContain('if (!active) return null;');
  });
});

/* ═══ the button's own hygiene ════════════════════════════════════════════ */

describe('the control this ticket touched states its own size', () => {
  it('it carries an explicit min-height, not one inferred from padding', () => {
    // #500: every intrinsic `Button` size (24/28/32/36px) is under both floors,
    // so a control this ticket touches declares its own. The MEASUREMENT, in
    // Chromium with animation suppressed, is in the layout suite beside this.
    const view = code(VIEW);
    const button = view.slice(view.indexOf('data-livestream-support'));
    expect(button.slice(0, 400), 'the support button declares no minimum height')
      .toContain('min-h-[44px]');
  });
});
