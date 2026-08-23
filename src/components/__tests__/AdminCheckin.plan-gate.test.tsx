import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import AdminCheckin from '../AdminCheckin';
import { PLAN_ORDER, PLAN_DISPLAY_NAMES, getPlanFeatures } from '../../utils/plan-features';

/**
 * THE-213 · defect 1, the CLIENT half — the admin screen offers no check-in on
 * a tier whose `checkInSystem` cell is false.
 *
 * ⚠️ THIS IS THE HALF THAT WAS ALREADY THERE, and it is pinned here precisely
 * because it was not enough on its own: AdminCheckin has withheld its Check-In
 * sub-tab since it shipped, and the founder still reached a working check-in.
 * The refusal that matters is the server one (see
 * app/api/checkin/__tests__/checkin-plan-gate.test.ts) — a hidden sub-tab is
 * not a gate, and check-in WRITES.
 *
 * What this file adds is the regression pin the screen never had: that the
 * sub-tab is withheld, that the create form behind it is unreachable, and — the
 * part that is easy to lose in a refactor — that a `manageCheckin`-only admin
 * on such a tier is NOT silently dropped into the QR generator instead.
 *
 * ⚠️ QR CODES ARE NOT CHECK-IN and are available on every plan, so the QR
 * sub-tab stays on every tier. That includes its "Check-In Session" QR TYPE,
 * which this PR deliberately does not touch: `checkInSystem` is false on
 * Individual as well as free, so gating that selector would change a PRICED
 * tier's screen, which the brief forbids. It is harmless either way now — the
 * URL such a QR encodes is refused by the server gate — and it is written up in
 * the PR body as an entry point found and left.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ctx, paths } = vi.hoisted(() => ({
  ctx: { current: undefined as unknown },
  paths: { current: [] as string[] },
}));

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:,' } }));
vi.mock('firebase/firestore', () => {
  const track = (seg: string[]) => { paths.current.push(seg.join('/')); return { __path: seg.join('/') }; };
  return {
    collection: (_db: unknown, ...seg: string[]) => track(seg),
    query: (c: any) => c,
    orderBy: () => ({}),
    limit: () => ({}),
    doc: (_db: unknown, ...seg: string[]) => track(seg),
    addDoc: vi.fn(async () => ({ id: 'x' })),
    updateDoc: vi.fn(async () => {}),
    deleteDoc: vi.fn(async () => {}),
    getDocs: async () => ({ docs: [] }),
    onSnapshot: (_q: unknown, cb: (s: unknown) => void) => { cb({ docs: [] }); return () => {}; },
    serverTimestamp: () => 'ts',
    Timestamp: class {},
  };
});
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false }),
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenantOptional: () => ctx.current }));
vi.mock('../AdminQR', () => ({ default: () => <div data-testid="qr-generator" /> }));

let host: HTMLDivElement;
let root: Root;

async function mount(plan: string | null, perms: { canCheckin?: boolean; canQR?: boolean } = {}) {
  ctx.current = plan === null
    ? { planFeatures: null, tenantPlan: null }
    : { planFeatures: { ...getPlanFeatures(plan as never), unlimitedContacts: false }, tenantPlan: plan };
  await act(async () => {
    root = createRoot(host);
    root.render(<AdminCheckin canCheckin={perms.canCheckin ?? true} canQR={perms.canQR ?? true} />);
  });
  await act(async () => { await Promise.resolve(); });
}

const labels = () => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim() || '');
const text = () => host.textContent || '';
const qrGenerator = () => host.querySelector('[data-testid="qr-generator"]');

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  paths.current = [];
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host.remove();
});

describe('a free tenant cannot reach check-in from the admin screen', () => {
  it('offers no Check-In sub-tab', async () => {
    await mount('free');
    expect(labels()).not.toContain('Check-In');
  });

  it('offers no "New session" control — the create form is unreachable', async () => {
    await mount('free');
    expect(labels()).not.toContain('New session');
    expect(text()).not.toContain('Generate a QR code attendees can scan to check in.');
  });

  it('🔴 does NOT silently drop a check-in-only admin into the QR generator', async () => {
    // The reason the sub-tab resolution is a three-way and not a fallback: an
    // admin holding manageCheckin but not manageQR, on a tier without the
    // feature, holds NEITHER surface. Landing them in a generator they are not
    // permitted to use is the THE-193 shape all over again.
    await mount('free', { canCheckin: true, canQR: false });

    expect(qrGenerator(), 'a manageCheckin-only admin was given the QR generator').toBeNull();
    expect(text()).toContain("You don't have access to Check-In or QR Codes.");
  });

  it('keeps the QR generator for an admin who holds manageQR — QR is on every plan', async () => {
    await mount('free', { canCheckin: true, canQR: true });
    expect(qrGenerator()).not.toBeNull();
  });
});

describe('every tier is answered by its own checkInSystem cell', () => {
  for (const plan of PLAN_ORDER) {
    const allowed = getPlanFeatures(plan).checkInSystem;
    const name = PLAN_DISPLAY_NAMES[plan];

    it(`${name} ${allowed ? 'offers' : 'withholds'} the Check-In sub-tab`, async () => {
      await mount(plan);
      expect(labels().includes('Check-In')).toBe(allowed);
    });
  }

  it('🔴 the two tiers that PAY for check-in keep the session list and its create form', async () => {
    for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).checkInSystem)) {
      await act(async () => { root?.unmount(); });
      await mount(plan);
      expect(labels(), `${PLAN_DISPLAY_NAMES[plan]} lost the create control`).toContain('New session');
    }
  });
});
