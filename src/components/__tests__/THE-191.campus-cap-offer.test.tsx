import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import AdminChurches from '../AdminChurches';
import { getPlanFeatures, UNLIMITED_CAP } from '../../utils/plan-features';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-191, INVERTED BY THE-370 — pressing "Add church" now that campuses are free.
 *
 * ─── What this file used to pin ──────────────────────────────────────────────
 *
 * THE-191 found a refusal that was FALSE and INVISIBLE. At the cap the button
 * was `disabled` with a `title` reading "Your plan includes 1 church. Upgrade to
 * Ministry to add more" — false, because `maxChurches` was 1 on every tier
 * including Ministry, and invisible, because a `title` needs a hover and a
 * disabled button never fires `onClick`. THE-191 replaced it with an OFFER that
 * read the live Campus price from `/api/dodo/addons` and sent the admin to
 * billing to buy one.
 *
 * ─── 🔴 THE OFFER IS NOW FALSE IN ITS TURN ──────────────────────────────────
 *
 * The founder retired the campus add-on — "remove the campus addon. let them add
 * as many as they want." Dodo has the two Campus products DETACHED from all nine
 * plan products, `maxChurches` is `UNLIMITED_CAP` on all three paid tiers, and
 * there is no campus meaning left to price. So THE-191's copy — "Every Harvest
 * plan includes 1 campus — Ministry included. A second campus is an add-on",
 * over a live figure — states two things that are not true and points at a
 * product that cannot be bought.
 *
 * ⚠️ THE SUBJECT OF THIS FILE IS UNCHANGED: what happens when an admin presses
 * "Add church". Only the answer moved, which is why the guards are inverted here
 * rather than deleted — the same mount, the same button, the opposite outcome.
 *
 * ─── 🔴 WHY NO TEST HERE SPELLS A PRICE, STILL ───────────────────────────────
 *
 * For a stronger reason than before. THE-191 asserted the figure came from the
 * catalogue rather than a literal; THE-370 asserts THERE IS NO FIGURE. A campus
 * costs nothing on any plan that has campuses, so a price anywhere on this
 * screen is wrong whatever its source — including the dead
 * `ENTERPRISE_PRICE_PER_CHURCH = 10` path this ticket deleted, which uncapping
 * `maxChurches` would otherwise have switched back on.
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
vi.mock('../ChurchEnrollment', () => ({ default: () => <div data-testid="enrollment-form" /> }));
// One church already exists. Under THE-191 that was exactly AT the cap of 1;
// under THE-370 it is one of unlimited on a paid tier, and over free's 0.
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return addBtn!;
}

const screenText = () => container.textContent || '';

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

describe('THE-370 — Add Church now that campuses are uncapped', () => {
  it('🔴 the campus cap is UNLIMITED on every paid tier — the fact that inverts this file', () => {
    // Asserted from the matrix so that a tier re-capped at 1 breaks this rather
    // than the wording. This is the exact assertion THE-191 made in reverse.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(getPlanFeatures(plan).maxChurches, `${plan} should have unlimited campuses`)
        .toBe(UNLIMITED_CAP);
    }
  });

  it('🔴 a paid tier at one campus is NOT at a limit — the form opens, no offer', async () => {
    await mountAndPressAdd(() => {});

    // The form, not a panel about money.
    expect(container.querySelector('[data-testid="enrollment-form"]'),
      'pressing Add church did not open the add form').toBeTruthy();
    expect(screenText()).not.toContain('Campuses are on the paid plans');
    expect(screenText()).not.toMatch(/add-on/i);
  });

  it('🔴 NO FIGURE ANYWHERE ON THE SCREEN, on any paid tier', async () => {
    // THE-191's offer quoted a live price; the deleted $10/mo per-church path
    // printed a running total in the header and a "Confirm & Add Church
    // ($10/mo)" button. Uncapping `maxChurches` is exactly what would have
    // switched that second one back on, so this asserts the whole screen.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      tenant.current = { tenantId: 't1', tenantPlan: plan };
      await act(async () => { root.render(<AdminChurches onOpenBilling={() => {}} />); });
      expect(screenText(), `${plan} names a figure on the campuses screen`).not.toMatch(/\$\d/);
    }
  });

  it('🔴 asks the add-on catalogue NOTHING — there is no campus to price', async () => {
    await mountAndPressAdd(() => {});
    // THE-191 fetched `/api/dodo/addons` lazily when the offer opened. Nothing
    // on this screen has a price to look up any more, so nothing is fetched.
    const addonReads = authFetch.mock.calls.filter(([url]) => String(url).includes('/api/dodo/addons'));
    expect(addonReads, 'the screen still reads the add-on catalogue').toHaveLength(0);
  });

  it('the "Add church" button is still reachable, never disabled', async () => {
    const addBtn = await mountAndPressAdd(() => {});
    // THE-191's original finding, and it still holds: a disabled button cannot
    // fire its own handler, so a refusal behind one says nothing on touch.
    expect(addBtn.hasAttribute('disabled'), 'a disabled button cannot explain anything').toBe(false);
  });
});

describe('THE-370 — Forever Free is the one tier with a campus cap', () => {
  beforeEach(() => {
    tenant.current = { tenantId: 't1', tenantPlan: 'free' };
  });

  it('🔵 free is 0 and stays 0 — campuses are what paying buys', () => {
    /* 🔵 THE DECISION, RECORDED. The founder's sentence was about the ADD-ON —
       "remove the campus addon, let them add as many as they want" — and a free
       tenant has never been able to buy it or to hold a campus at all.

       0 is also load-bearing beyond this screen: `hasFeature` reads 0 as falsy,
       which is what keeps `getMinPlanForFeatureCell('maxChurches')` answering
       'plus'. Uncapping free would make the cell true on every tier and delete
       the row from every plan-comparison surface that derives from it. */
    expect(getPlanFeatures('free').maxChurches).toBe(0);
    expect(getPlanFeatures('free').maxChurches).not.toBe(UNLIMITED_CAP);
  });

  it('🔴 explains the PLAN, and offers no add-on and no price', async () => {
    await mountAndPressAdd(() => {});

    const text = screenText();
    expect(text).toContain('Campuses are on the paid plans');
    expect(text).toContain('no per-campus charge');
    // 🔴 The two things THE-191's copy said that are now false.
    expect(text, 'the retired add-on is still being offered').not.toMatch(/add-on/i);
    expect(text, 'a campus is being priced').not.toMatch(/\$\d/);
    expect(text).not.toMatch(/Every Harvest plan includes/i);
    // And the form did NOT open — free is genuinely at its cap.
    expect(container.querySelector('[data-testid="enrollment-form"]')).toBeNull();
  });

  it('sends them to the plans, not to a product', async () => {
    const openBilling = vi.fn();
    await mountAndPressAdd(openBilling);

    const cta = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').toLowerCase().includes('see the plans'),
    );
    expect(cta, 'the explanation gives no way forward').toBeTruthy();
    // 🔴 The old CTA bought a campus. This one opens the plan list.
    expect(screenText().toLowerCase()).not.toContain('add a campus');
    await act(async () => { cta!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(openBilling).toHaveBeenCalledTimes(1);
  });
});

describe('THE-370 — no surface says a campus costs money', () => {
  const src = () => stripComments(
    fs.readFileSync(path.join(process.cwd(), 'src/components/AdminChurches.tsx'), 'utf8'),
  );

  it('the false tier-upgrade claim THE-191 removed has not come back', () => {
    expect(src(), 'the false tier-upgrade claim is back').not.toMatch(/Upgrade to Ministry/i);
    expect(src()).not.toMatch(/upgrade[^.]{0,40}to add (more|another) (church|campus)/i);
  });

  it('🔴 and neither has any campus PRICE — the $10/mo path is gone', () => {
    const code = src();
    // The dead per-church billing this ticket deleted, by every name it had.
    expect(code, 'the per-church price constant is back').not.toMatch(/ENTERPRISE_PRICE_PER_CHURCH/);
    expect(code, 'a per-church price literal is back').not.toMatch(/\$\d+\/mo/);
    expect(code, 'the per-church billing endpoints are being called again')
      .not.toMatch(/churches\/(add|remove)-billing/);
    // And no figure of any kind is spelled on this screen.
    expect(code, 'a money literal is spelled in this component').not.toMatch(/\$\$?\{?\d/);
  });

  it('🔴 the retired campus add-on is not named anywhere in the component', () => {
    const code = src();
    expect(code, 'the campus add-on meaning is back').not.toMatch(/'campus'/);
    expect(code, 'the add-on catalogue is being read again').not.toMatch(/fetchOfferableAddons/);
    expect(code, 'an add-on price formatter is back').not.toMatch(/formatAddonPrice/);
  });
});
