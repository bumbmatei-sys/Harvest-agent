import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import AdminChurches from '../AdminChurches';
import { getPlanFeatures } from '../../utils/plan-features';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-191 — pressing "Add church" at the campus cap.
 *
 * ─── The defect these guards pin ─────────────────────────────────────────────
 *
 * At the cap the button was `disabled` and carried a `title` reading "Your plan
 * includes 1 church. Upgrade to Ministry to add more."
 *
 * 🔴 That sentence was FALSE. `maxChurches` is 1 on every tier, Ministry
 * included — `the campus cap is 1 on EVERY tier` below asserts it from the
 * matrix rather than from this comment. A church following that advice would
 * have paid $199/mo and hit the same cap.
 *
 * 🔴 And on touch it was INVISIBLE: a `title` needs a hover, and a disabled
 * button never fires `onClick`, so the matching branch in
 * `handleAddChurchClick` could not run at all.
 *
 * ─── 🔴 WHY NO TEST HERE SPELLS A PRICE ──────────────────────────────────────
 *
 * The figure is asserted to come FROM THE CATALOGUE READ, never from a literal
 * in `AdminChurches.tsx`. `names the cost` feeds the component a catalogue
 * payload and reads the rendered string back, so the assertion moves with Dodo
 * instead of pinning a number that a reprice would make wrong — which is the
 * defect this ticket is fixing, one layer down. `$10` is still in this file's
 * dead `ENTERPRISE_PRICE_PER_CHURCH` path and `catalogue.ts` still says "$15" in
 * a comment; the live price is neither, and that is precisely the point.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authFetch, tenant, getTenantScope } = vi.hoisted(() => ({
  authFetch: vi.fn(),
  tenant: { current: { tenantId: 't1', tenantPlan: 'max' as string | undefined } },
  getTenantScope: vi.fn(async () => 't1'),
}));

vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope }));
vi.mock('../ChurchEnrollment', () => ({ default: () => <div /> }));
// One church already exists, so the tenant sits exactly AT the cap of 1.
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  deleteDoc: vi.fn(async () => {}),
  onSnapshot: (_q: unknown, onNext: (snap: unknown) => void) => {
    onNext({ forEach: (cb: (d: unknown) => void) => cb({ id: 'c1', data: () => ({ name: 'First Campus' }) }) });
    return () => {};
  },
}));

let container: HTMLDivElement;
let root: Root;

/** The live catalogue answer, shaped as `/api/dodo/addons` returns it. */
const catalogueOk = (priceMinorUnits: number, currency = 'USD', billing = 'monthly') => ({
  ok: true,
  json: async () => ({
    billing,
    plan: 'max',
    addons: [
      { addon: 'adminSeat', name: 'Admin Seat', priceMinorUnits: 900, currency },
      { addon: 'campus', name: 'Campus', priceMinorUnits, currency },
    ],
  }),
});

async function mountAndPressAdd(onOpenBilling?: () => void) {
  await act(async () => {
    root.render(<AdminChurches onOpenBilling={onOpenBilling} />);
  });
  const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').toLowerCase().includes('add church'),
  );
  expect(addBtn, 'the "Add church" button is not on screen').toBeTruthy();
  await act(async () => {
    addBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // Let the lazy catalogue read settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return addBtn!;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  tenant.current = { tenantId: 't1', tenantPlan: 'max' };
  authFetch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('THE-191 — Add Church at the campus limit', () => {
  it('the campus cap is 1 on EVERY tier, Ministry included', () => {
    // The fact that made the old copy false. Asserted from the matrix so that
    // a tier granting a second campus would break this instead of the wording.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(getPlanFeatures(plan).maxChurches, `${plan} should include exactly one campus`).toBe(1);
    }
  });

  it('names the cost and offers the add-on', async () => {
    authFetch.mockResolvedValue(catalogueOk(1200));
    await mountAndPressAdd(() => {});

    const text = container.textContent || '';
    // The price came from the catalogue payload above, formatted with its period.
    expect(text, 'the offer does not name what a campus costs').toContain('$12/month');
    expect(text.toLowerCase()).toContain('campus');
    // 🔴 And the route forward exists.
    const cta = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').toLowerCase().includes('add a campus'),
    );
    expect(cta, 'the offer names a price but gives no way to buy it').toBeTruthy();
  });

  it('opens the billing screen when the church accepts the offer', async () => {
    const openBilling = vi.fn();
    authFetch.mockResolvedValue(catalogueOk(1200));
    await mountAndPressAdd(openBilling);

    const cta = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').toLowerCase().includes('add a campus'),
    )!;
    await act(async () => { cta.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(openBilling).toHaveBeenCalledTimes(1);
  });

  it('the "Add church" button is reachable at the cap, not disabled', async () => {
    authFetch.mockResolvedValue(catalogueOk(1200));
    const addBtn = await mountAndPressAdd(() => {});
    // The whole failure mode: a disabled button cannot fire its own handler, so
    // the refusal had no way to say anything on a device without hover.
    expect(addBtn.hasAttribute('disabled'), 'a disabled button cannot offer anything').toBe(false);
  });

  it('a failed catalogue read names NO figure', async () => {
    authFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Add-ons are unavailable right now.' }) });
    await mountAndPressAdd(() => {});

    const text = container.textContent || '';
    // 🔴 No fabricated price, and the failure is SAID rather than rendered blank.
    expect(text).not.toMatch(/\$\d/);
    expect(text).toContain('Add-ons are unavailable right now.');
  });

  it('a campus this build cannot sell is refused, without a price', async () => {
    // Campus absent from the response = the active add-on table does not map it.
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ billing: 'monthly', plan: 'max', addons: [{ addon: 'adminSeat', name: 'Admin Seat', priceMinorUnits: 900, currency: 'USD' }] }),
    });
    await mountAndPressAdd(() => {});

    const text = container.textContent || '';
    expect(text).not.toMatch(/\$\d/);
    expect(text).toContain('A campus cannot be added on this account yet.');
  });

  it('the campus cap still fails CLOSED on an unknown plan', async () => {
    // No-regression on `plan-features.ts`'s deliberate `plus` fall-back: an
    // unknown/loading plan must still cap at 1, so the cap protects Harvest.
    expect(getPlanFeatures(undefined as never).maxChurches).toBe(1);
    expect(getPlanFeatures('not-a-plan' as never).maxChurches).toBe(1);

    tenant.current = { tenantId: 't1', tenantPlan: undefined };
    authFetch.mockResolvedValue(catalogueOk(1200));
    await mountAndPressAdd(() => {});
    // At the cap on an unknown plan the offer opens — the add form does NOT.
    expect(container.textContent || '').toContain('Add another campus');
  });

  it('no surface tells a church to upgrade a TIER for a campus', () => {
    const src = stripComments(
      fs.readFileSync(path.join(process.cwd(), 'src/components/AdminChurches.tsx'), 'utf8'),
    );
    // The exact false claim, and the shape of it.
    expect(src, 'the false tier-upgrade claim is back').not.toMatch(/Upgrade to Ministry/i);
    expect(src).not.toMatch(/upgrade[^.]{0,40}to add (more|another) (church|campus)/i);
  });
});
