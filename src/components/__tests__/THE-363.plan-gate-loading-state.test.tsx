import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE-363 · THE-110 + THE-127 — a plan that has not loaded is not a refusal.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape, in one sentence ──────────────────────────────────────────────
 *
 * A capability gate answers THREE things — permitted, not permitted, and NOT
 * YET KNOWN — and every gate in this repo collapsed the third into one of the
 * other two. `AdminBlog`'s `canAutomate` collapsed it into NOT PERMITTED
 * (`tenantPlan ? …automatedBlog : false`), so the Automate button was absent
 * on first paint and appeared when the tenant document resolved; that is
 * THE-110's flicker. `usePlanGate` collapses it the other way
 * (`if (!ctx.tenantPlan) return true`), which flashes a control the church may
 * not have and then retracts it.
 *
 * ── 🔴 WHAT A GATE RENDERS WHILE UNKNOWN, and why it is neither ─────────────
 *
 * A SKELETON IN THE CONTROL'S OWN FOOTPRINT. Not the permitted state — that
 * shows a church a feature it may not have bought and then takes it away. Not
 * the denied state — that is the defect. A skeleton says the only true thing
 * ("the answer is still coming") and reserves the space, so the header does not
 * reflow when the answer lands, which is the other half of what "flicker" meant
 * here.
 *
 * ── ⚠️ THE-127's PREMISE IS CORRECTED, NOT ADOPTED ──────────────────────────
 *
 * The card reads: "client capability gates cannot see grace ... so a church in
 * a grace period is briefly told it cannot do something it can." The first
 * clause is true and the second does not follow, and section 3 below is what
 * establishes that rather than asserting it. `recordDodoSubscriptionOnHold`
 * writes ONE timestamp to the server-only private document and explicitly
 * leaves `tenants/{id}.status` on `active` — "the church keeps giving,
 * publishing and sending for the whole window". So a church INSIDE grace is
 * permitted everything by the recorded status alone, and the client gate needs
 * no sight of grace to get that right. The gate's real exposure to a
 * not-yet-known answer is the PLAN, which is what sections 1 and 2 pin.
 *
 * ── Rules of this suite ─────────────────────────────────────────────────────
 *
 * NO LINE NUMBER IS PINNED ANYWHERE. THE-331 pinned `AdminCommunity.tsx:491`
 * and a deletion shifted it to `:311`. Every source assertion here greps
 * PARSER-STRIPPED source through the shared #496 stripper, IMPORTED rather than
 * copied, and every needle that could match its own spelling in this file is
 * ASSEMBLED FROM FRAGMENTS — #504 shipped three guards that matched themselves
 * and therefore could not fail.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Far from today, deliberately. #468 pinned a fixture near the day it was
 * written and turned `main` red once the day passed. `toFake: ['Date']` is
 * load-bearing: without it the timers this screen's Firestore mocks rely on are
 * faked too and nothing ever resolves.
 */
const NOW = new Date('2025-01-15T12:00:00.000Z');

const storePlan = vi.hoisted(() => ({ current: null as string | null }));
const platformOverride = vi.hoisted(() => ({ current: false }));

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'user-1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  deleteDoc: async () => {},
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    next({ docs: [] });
    return () => {};
  },
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'grace',
  hasPlatformOverride: () => platformOverride.current,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ tenantPlan: storePlan.current }),
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async () => ({ ok: true, json: async () => ({}) }),
}));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', DELETE: 'delete' },
  handleFirestoreError: () => {},
}));
/**
 * Only the editor is stubbed. AdminBlog, its header, the real `Skeleton`
 * primitive and `plan-gate-state` are all REAL — stubbing any of them would
 * leave the claim asserted against the stub.
 */
vi.mock('../AdminBlogPostEditor', () => ({ default: () => null }));

import AdminBlog from '../AdminBlog';
import { resolvePlanGateState, planGatePermits } from '../../utils/plan-gate-state';
import { getPlanFeatures, PLAN_ORDER } from '../../utils/plan-features';
import {
  tenantAllows,
  tenantCapabilities,
  resolveTenantGraceState,
  resolveEffectiveTenantStatus,
  TENANT_STATUS_ACTIVE,
  TENANT_STATUS_ARCHIVED,
  DODO_GRACE_PERIOD_MS,
  GATED_WHEN_ARCHIVED,
  NEVER_GATED,
} from '../../lib/tenant-lifecycle';
import { resolveCourseLimit } from '../../utils/course-adoption';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const stripped = (rel: string) => stripComments(read(rel));

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => { vi.useRealTimers(); });

beforeEach(() => {
  storePlan.current = null;
  platformOverride.current = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => { root.render(<AdminBlog />); });
}

/** The Automate control, if the header is rendering it at all. */
const automateButton = () =>
  Array.from(host.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').includes('Automate'),
  ) ?? null;

/** The skeleton the gate stands up while the answer is not yet known. */
const gatePending = () => host.querySelector('[data-testid="automate-gate-pending"]');

// ═════════════════════════════════════════════════════════════════════════════
// 1 · A gate renders NEITHER permitted NOR denied while the plan is unknown
// ═════════════════════════════════════════════════════════════════════════════

describe('a gate renders neither permitted nor denied while the plan is unknown', () => {
  it('names the third state rather than collapsing it', () => {
    // The state is NAMED — a boolean cannot carry it, which is the whole reason
    // the resolver returns a union.
    expect(resolvePlanGateState('automatedBlog', { plan: null })).toBe('unknown');
    expect(resolvePlanGateState('automatedBlog', { plan: undefined })).toBe('unknown');

    // And the two definite answers are still definite.
    expect(resolvePlanGateState('automatedBlog', { plan: 'max' })).toBe('permitted');
    expect(resolvePlanGateState('automatedBlog', { plan: 'free' })).toBe('denied');
  });

  it('renders the skeleton, and NOT the control, while the plan is unknown', async () => {
    storePlan.current = null;
    await render();

    // Neither wrong answer.
    expect(automateButton(), 'the permitted control must not flash').toBeNull();
    // ...and the denied state is not "render nothing": the footprint is held.
    const pending = gatePending();
    expect(pending, 'the unknown state must render something of its own').not.toBeNull();
    expect(pending!.getAttribute('data-slot')).toBe('skeleton');
  });

  it('is the installed Skeleton primitive, not a hand-rolled div', () => {
    // `data-slot="skeleton"` above can only come from the primitive, and the
    // import is pinned here so a later edit cannot quietly re-hand-roll it.
    // Needle assembled from fragments — spelling it whole would match itself.
    const src = stripped('components/AdminBlog.tsx');
    const needle = ['ui', '/', 'skeleton'].join('');
    expect(src).toContain(needle);
  });

  it('resolves to a definite answer once the plan lands', async () => {
    storePlan.current = 'max';
    await render();
    expect(gatePending()).toBeNull();
    expect(automateButton()).not.toBeNull();

    act(() => root.unmount());
    host.remove();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    storePlan.current = 'free';
    await render();
    expect(gatePending()).toBeNull();
    expect(automateButton(), 'a tier without the cell is still denied').toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · The Blog Automate button does not flicker — asserted ACROSS the load
// ═════════════════════════════════════════════════════════════════════════════

describe('the Blog Automate button does not flicker', () => {
  /**
   * The flicker is a SEQUENCE, so the assertion has to be one. A single frame
   * cannot distinguish "absent because denied" from "absent because unknown",
   * which is exactly why the defect survived: every existing test looked at one
   * frame.
   */
  it('never renders the denied state on the way to permitted', async () => {
    const frames: Array<{ button: boolean; pending: boolean }> = [];

    storePlan.current = null;
    await render();
    frames.push({ button: !!automateButton(), pending: !!gatePending() });

    // The tenant document lands and the store publishes the tier.
    storePlan.current = 'max';
    await render();
    frames.push({ button: !!automateButton(), pending: !!gatePending() });

    // Frame 1 is the unknown state: skeleton, no control.
    expect(frames[0]).toEqual({ button: false, pending: true });
    // Frame 2 is permitted: control, no skeleton.
    expect(frames[1]).toEqual({ button: true, pending: false });

    // 🔴 THE FLICKER CLAIM. At no frame was the header in the state a church
    // reads as "you do not have this" — nothing rendered, no skeleton — while
    // the answer was still on its way.
    const blank = frames.filter((f) => !f.button && !f.pending);
    expect(blank, 'a fully blank frame IS the flicker').toEqual([]);
  });

  it('a plan that re-resolves does not take the control away and give it back', async () => {
    // THE-259's bounded post-purchase re-read republishes the tier. A gate that
    // collapsed unknown into denied blinked the control off on every such pass.
    const seen: boolean[] = [];

    storePlan.current = 'max';
    await render();
    seen.push(!!automateButton());

    for (const plan of ['max', 'max', 'max']) {
      storePlan.current = plan;
      await render();
      seen.push(!!automateButton());
    }

    expect(seen, 'the control is present on every frame').toEqual([true, true, true, true]);
  });

  it('the side effect fires only on a definite yes', () => {
    // A fetch fired on an unresolved entitlement asks for something nobody has
    // established the church can have.
    expect(planGatePermits(resolvePlanGateState('automatedBlog', { plan: null }))).toBe(false);
    expect(planGatePermits(resolvePlanGateState('automatedBlog', { plan: 'max' }))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · A church in grace is not told it lacks a capability it has
// ═════════════════════════════════════════════════════════════════════════════

describe('a church in grace is not told it lacks a capability it has', () => {
  const HELD = Date.parse('2025-01-01T00:00:00.000Z');

  it('is INSIDE the window for the fixture used below', () => {
    // Pin the premise rather than trusting the arithmetic silently.
    expect(resolveTenantGraceState({ onHoldAt: new Date(HELD).toISOString(), now: HELD + 1000 }))
      .toBe('in-grace');
  });

  it('keeps every capability while the window is open', () => {
    // The recorded status during grace. `recordDodoSubscriptionOnHold` writes
    // ONE private timestamp and leaves this on `active` on purpose.
    const caps = tenantCapabilities(TENANT_STATUS_ACTIVE);
    for (const capability of [...NEVER_GATED, ...GATED_WHEN_ARCHIVED]) {
      expect(caps[capability], `${capability} must survive grace`).toBe(true);
    }
  });

  it('and the derived status agrees — grace does not archive early', () => {
    const onHoldAt = new Date(HELD).toISOString();
    // One millisecond inside the window.
    expect(
      resolveEffectiveTenantStatus({
        status: TENANT_STATUS_ACTIVE,
        onHoldAt,
        now: HELD + DODO_GRACE_PERIOD_MS - 1,
      }),
    ).toBe(TENANT_STATUS_ACTIVE);
    // And the boundary is still closed at exactly the window — no loosening.
    expect(
      resolveEffectiveTenantStatus({
        status: TENANT_STATUS_ACTIVE,
        onHoldAt,
        now: HELD + DODO_GRACE_PERIOD_MS,
      }),
    ).toBe(TENANT_STATUS_ARCHIVED);
  });

  it('an UNLOADED lifecycle state is not a refusal either', () => {
    // The same three-state rule, on the lifecycle side. `undefined` is "the
    // tenant document has not landed", and it must not read as archived.
    for (const capability of [...NEVER_GATED, ...GATED_WHEN_ARCHIVED]) {
      expect(tenantAllows(undefined, capability), `${capability} on an unloaded status`).toBe(true);
    }
  });

  it('a not-yet-known PLAN is not a refusal at any boolean gate', () => {
    // The generalisation of THE-110 across the matrix: for every boolean cell,
    // an unloaded plan resolves to `unknown` and never to `denied`.
    const cells = Object.entries(getPlanFeatures('max'))
      .filter(([, v]) => typeof v === 'boolean')
      .map(([k]) => k as Parameters<typeof resolvePlanGateState>[0]);

    expect(cells.length, 'the matrix must actually have boolean cells').toBeGreaterThan(5);
    for (const cell of cells) {
      expect(resolvePlanGateState(cell, { plan: null }), cell).toBe('unknown');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · The course cap STILL fails CLOSED on an unknown plan  (no-regression)
// ═════════════════════════════════════════════════════════════════════════════

describe('the course cap still fails CLOSED on an unknown plan', () => {
  /**
   * 🔴 DELIBERATE, and recorded in `plan-features.ts` beside `maxCourses`:
   * "AdminCourses gates the 'New course' button (fail closed on an
   * unknown/loading plan — falls back to `plus`)". A cap protects Harvest; a
   * capability gate protects nobody. Loosening this is STOP condition 2.
   */
  it('an unknown plan resolves the cap to the `plus` allowance, not to unlimited', () => {
    const plusCap = getPlanFeatures('plus').maxCourses;

    expect(resolveCourseLimit(null)).toBe(plusCap);
    expect(resolveCourseLimit(undefined)).toBe(plusCap);
    // Not unlimited, and not the top tier's allowance.
    expect(resolveCourseLimit(null)).not.toBe(-1);
    expect(resolveCourseLimit(null)).not.toBe(getPlanFeatures('max').maxCourses);
  });

  it('the fail-closed note still stands beside the cell it describes', () => {
    // The REASON is load-bearing and a future reader must find it. Pinned by
    // CONTENT, never by line number.
    const raw = read('utils/plan-features.ts');
    const phrase = ['fail closed on an unknown', '/loading plan'].join('');
    expect(raw).toContain(phrase);
  });

  it('the cap is not reachable through the capability resolver at all', () => {
    // The type forbids it; this pins the runtime shape behind that type so a
    // widened signature cannot silently make a cap fail open.
    const booleanCells = Object.entries(getPlanFeatures('max'))
      .filter(([, v]) => typeof v === 'boolean')
      .map(([k]) => k);
    expect(booleanCells).not.toContain('maxCourses');
    expect(booleanCells).not.toContain('maxChurches');
    expect(booleanCells).not.toContain('maxAdmins');
    expect(booleanCells).not.toContain('maxContacts');
  });

  it('every tier still publishes a finite, non-negative course allowance or explicit unlimited', () => {
    for (const plan of PLAN_ORDER) {
      const cap = getPlanFeatures(plan).maxCourses;
      expect(cap === -1 || cap >= 0, `${plan} maxCourses`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · No gate became a security boundary
// ═════════════════════════════════════════════════════════════════════════════

describe('no gate became a security boundary', () => {
  /**
   * Card 86bbtx3dj settled that plan caps are CLIENT-SIDE BY DESIGN and that
   * `firestore.rules` scopes by membership and permission, never by plan. A
   * gate is a display decision. This pins that the rules file did not acquire a
   * plan-shaped condition as a side effect of this ticket.
   *
   * ⚠️ NO DIGEST OF `firestore.rules` IS RECORDED ANYWHERE IN THIS PR — #504
   * was caught spelling the live digest as a literal, and the ownership
   * register explicitly must not carry one.
   */
  const rules = () => readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');

  it('the rules still scope by membership and by permission', () => {
    const src = rules();
    // Needles assembled from fragments so they cannot match their own spelling.
    expect(src).toContain(['tenant', 'Id'].join(''));
    expect(src).toContain(['request', '.auth'].join(''));
  });

  it('the rules do not gate on a plan tier', () => {
    const src = rules();
    // The tier ids, as a rules-language field read would have to spell them.
    for (const tier of PLAN_ORDER) {
      expect(src, `firestore.rules must not read the '${tier}' tier`)
        .not.toContain(["'", tier, "'"].join(''));
    }
    const planField = ['.', 'plan'].join('');
    expect(src, 'firestore.rules must not read a plan field').not.toContain(planField);
  });

  it('the gate module says out loud that it is not a boundary', () => {
    const raw = read('utils/plan-gate-state.ts');
    const claim = ['client', '-side by design'].join('');
    expect(raw).toContain(claim);
  });

  it('the gate resolver reads only the tier and never a rules document', () => {
    const src = stripped('utils/plan-gate-state.ts');
    // It must not have grown a Firestore dependency.
    expect(src).not.toContain(['firebase', '/firestore'].join(''));
    expect(src).not.toContain(['getDoc', '('].join(''));
  });
});
