import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AnalyticsAndRoles from '../AnalyticsAndRoles';
import { AdminHeaderContext } from '../AdminScreenHeader';
import { PLAN_ORDER, getPlanFeatures, PLAN_PRICING } from '../../utils/plan-features';
import { SUPER_ADMIN_EMAILS } from '../../utils/super-admins';

/**
 * Pins maxAdmins enforcement on the Roles screen (mirrors the maxCourses
 * fail-closed pattern in AdminCourses): the "Add Admin" entry point disables
 * once the tenant's billable admin seats reach their plan's maxAdmins, falls
 * back to 'plus' on an unknown/loading plan, and — the load-bearing one — NEVER
 * demotes or hides an admin a tenant already has beyond a (possibly lowered) cap.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUPER_EMAIL = SUPER_ADMIN_EMAILS[0];

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'me', getIdToken: async () => null } } }));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  SUPER_ADMIN_EMAIL: 'bumbmatei@proton.me',
}));

const tenantCtx = vi.hoisted(() => ({ tenantPlan: undefined as string | undefined }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));

const notify = vi.hoisted(() => ({ errors: [] as Array<{ message: unknown; title: unknown }> }));
vi.mock('../../utils/notify', () => ({
  notifyError: (message: unknown, title: unknown) => { notify.errors.push({ message, title }); },
  notifySuccess: () => {},
}));

// Every Firestore write the Roles screen can make, recorded. Test 3 asserts this
// stays EMPTY for an over-cap tenant: enforcing the cap must not touch a soul.
const writes = vi.hoisted(() => ({ updates: [] as any[], deletes: [] as string[] }));

let mockUsers: Array<Record<string, any>> = [];
let mockOwnerId: string | null = null;

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async (ref: any) => ({
    exists: () => true,
    data: () => (String(ref?.__path).startsWith('tenants/') ? { ownerId: mockOwnerId } : {}),
  }),
  getDocs: async () => ({
    forEach: (cb: (d: any) => void) =>
      mockUsers.forEach((u) => cb({ id: u.id, data: () => u })),
  }),
  updateDoc: async (ref: any, data: unknown) => { writes.updates.push({ path: ref?.__path, data }); },
  deleteDoc: async (ref: any) => { writes.deletes.push(ref?.__path); },
}));

// ── fixtures ────────────────────────────────────────────────────────────────

/** A permissionless admin — a row that occupies a seat but holds no flags. */
const bareAdmin = (id: string) => ({ id, displayName: id, email: `${id}@church.org`, role: 'admin' });
const fullAdmin = (id: string) => ({ ...bareAdmin(id), permissions: { fullAccess: true } });
const member = (id: string) => ({ id, displayName: id, email: `${id}@church.org`, role: 'user' });
/** Harvest platform staff, sitting inside a tenant's user list. */
const superAdmin = (id: string) => ({ id, displayName: id, email: SUPER_EMAIL, role: 'super_admin' });

let container: HTMLDivElement;
let root: Root;
let headerAction: React.ReactNode = null;

/**
 * Renders the screen plus whatever it publishes into the shared admin header,
 * so the REAL HeaderActionButton (and its real disabled/title behaviour) is
 * what the assertions see.
 */
function Harness() {
  const [action, setAction] = React.useState<React.ReactNode>(null);
  headerAction = action;
  const api = React.useMemo(
    () => ({ setHeaderAction: setAction, setHeaderOverride: () => {}, setHeaderHidden: () => {} }),
    []
  );
  return (
    <AdminHeaderContext.Provider value={api}>
      <div data-testid="header">{action}</div>
      <AnalyticsAndRoles
        currentUserRole="admin"
        currentUserPermissions={{ manageAdmins: true } as any}
        mode="roles"
      />
    </AdminHeaderContext.Provider>
  );
}

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness />);
    // Flush getTenantScope() → getDoc(tenant) → getDocs(users) and the header effect.
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function addAdminButton(): HTMLButtonElement {
  const el = container.querySelector('[data-testid="header"] button');
  if (!el) throw new Error('No header action button rendered');
  return el as HTMLButtonElement;
}

/** The "N of M admins used" line the Roles tab renders. */
function seatUsageText(): string {
  const el = Array.from(container.querySelectorAll('div')).find((d) =>
    /^\d+ (of \d+ )?admins?( used)?$/.test((d.textContent || '').trim())
  );
  if (!el) throw new Error('No seat-usage line found');
  return (el.textContent || '').trim();
}

const bodyText = () => container.textContent || '';
const editorIsOpen = () => !!container.querySelector('button[aria-label="Close"]');

describe('AnalyticsAndRoles — maxAdmins enforcement', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = undefined;
    mockUsers = [];
    mockOwnerId = null;
    writes.updates = [];
    writes.deletes = [];
    notify.errors = [];
    headerAction = null;
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  // ── 1. at the cap ─────────────────────────────────────────────────────────

  it('at the cap: the Add Admin entry point is disabled and explains why', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxAdmins: 2
    mockUsers = [fullAdmin('owner'), fullAdmin('volunteer'), member('m1')];
    await mount();

    const button = addAdminButton();
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/up to 2 admins/i);
    expect(button.title).toMatch(/upgrade your plan/i);

    // And the reason is on screen, not only in a tooltip a phone cannot show.
    expect(bodyText()).toMatch(/up to 2 admins/i);
    expect(seatUsageText()).toBe('2 of 2 admins used');
  });

  it('at the cap: the form does not open, so nobody fills it in to fail on save', async () => {
    tenantCtx.tenantPlan = 'plus';
    mockUsers = [fullAdmin('owner'), fullAdmin('volunteer')];
    await mount();

    await act(async () => { addAdminButton().click(); });
    expect(editorIsOpen()).toBe(false);
  });

  it('falls back to Individual (2) when the plan is unknown or still loading', async () => {
    tenantCtx.tenantPlan = undefined;
    mockUsers = [fullAdmin('owner'), fullAdmin('volunteer')];
    await mount();
    expect(addAdminButton().disabled).toBe(true);
  });

  // ── 2. below the cap ──────────────────────────────────────────────────────

  it('below the cap: promotion works unchanged — the button is live and opens the form', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxAdmins: 2
    mockUsers = [fullAdmin('owner'), member('m1')];
    await mount();

    const button = addAdminButton();
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('');
    expect(seatUsageText()).toBe('1 of 2 admins used');
    // No at-cap banner while there is a seat left.
    expect(bodyText()).not.toMatch(/upgrade your plan/i);

    await act(async () => { button.click(); });
    expect(editorIsOpen()).toBe(true);
  });

  it('below the cap on a larger plan: Small Team gets 5 seats, not Individual 2', async () => {
    tenantCtx.tenantPlan = 'pro'; // maxAdmins: 5
    mockUsers = [fullAdmin('a'), fullAdmin('b'), fullAdmin('c')];
    await mount();
    expect(addAdminButton().disabled).toBe(false);
    expect(seatUsageText()).toBe('3 of 5 admins used');
  });

  // ── 3. THE IMPORTANT ONE: over the cap, nobody loses access ───────────────

  it('a tenant already OVER its cap keeps every existing admin — nobody is demoted', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxAdmins: 2 — this tenant has 5
    const existing = ['owner', 'a', 'b', 'c', 'd'];
    mockOwnerId = 'owner';
    mockUsers = [...existing.map(fullAdmin), member('m1')];
    await mount();

    // Every admin is still listed…
    for (const id of existing) expect(bodyText()).toContain(`${id}@church.org`);
    expect(seatUsageText()).toBe('5 of 2 admins used');

    // …and NOTHING was written. No role change, no permission reset, no delete.
    expect(writes.updates).toEqual([]);
    expect(writes.deletes).toEqual([]);

    // Only the next promotion is blocked.
    expect(addAdminButton().disabled).toBe(true);
    // The copy says so out loud rather than leaving it ambiguous.
    expect(bodyText()).toMatch(/keeps their access/i);
  });

  it('an over-cap tenant can still EDIT an existing admin — the cap never strands a roster', async () => {
    tenantCtx.tenantPlan = 'plus';
    // Owner is badge-locked (firestore.rules owns that), so the first Edit
    // button on screen belongs to 'a' — an ordinary admin on an over-cap tenant.
    mockOwnerId = 'owner';
    mockUsers = [fullAdmin('owner'), fullAdmin('a'), fullAdmin('b')];
    await mount();

    const edit = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Edit'
    ) as HTMLButtonElement;
    expect(edit).toBeTruthy();
    await act(async () => { edit.click(); });
    expect(editorIsOpen()).toBe(true);

    // Saving that edit is a permissions change, not a new seat — it goes through.
    const save = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Save Changes'
    ) as HTMLButtonElement;
    await act(async () => { save.click(); for (let i = 0; i < 8; i++) await Promise.resolve(); });

    expect(writes.updates.map((w) => w.path)).toEqual(['users/a']);
    expect(notify.errors).toEqual([]);
  });

  // ── 4. super admins are not a purchased seat ─────────────────────────────

  it('super admins are excluded from the count — asserted with one present in the tenant', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxAdmins: 2
    mockUsers = [fullAdmin('owner'), superAdmin('harvest-staff'), member('m1')];
    await mount();

    // 2 admin rows are listed, but only 1 is a seat the church bought.
    expect(bodyText()).toContain(SUPER_EMAIL);
    expect(seatUsageText()).toBe('1 of 2 admins used');
    expect(addAdminButton().disabled).toBe(false);
  });

  it('a super admin carrying role:admin still does not consume a seat', async () => {
    // The Roles list only upgrades the displayed role from SUPER_ADMIN_EMAILS[0];
    // the count must exclude every address on the frozen list regardless of role.
    tenantCtx.tenantPlan = 'plus';
    mockUsers = [
      fullAdmin('owner'),
      { id: 'staff2', displayName: 'staff2', email: SUPER_ADMIN_EMAILS[1], role: 'admin' },
    ];
    await mount();
    expect(seatUsageText()).toBe('1 of 2 admins used');
    expect(addAdminButton().disabled).toBe(false);
  });

  // ── 5. the documented counting rule ──────────────────────────────────────

  it('counts a permissionless admin — otherwise the cap is sidestepped by promoting later', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxAdmins: 2
    mockUsers = [fullAdmin('owner'), bareAdmin('no-perms')];
    await mount();

    expect(bodyText()).toContain('No permissions assigned');
    expect(seatUsageText()).toBe('2 of 2 admins used');
    expect(addAdminButton().disabled).toBe(true);
  });

  it('counts the plan owner — Individual 2 is a solo pastor plus one volunteer', async () => {
    tenantCtx.tenantPlan = 'plus';
    mockOwnerId = 'owner';
    mockUsers = [fullAdmin('owner'), fullAdmin('volunteer')];
    await mount();

    expect(bodyText()).toContain('Owner');
    expect(seatUsageText()).toBe('2 of 2 admins used');
    expect(addAdminButton().disabled).toBe(true);
  });

  it('counts the owner even when the ownerId read fails — the cap never loosens on error', async () => {
    // tenants/{id}.ownerId is loaded best-effort and degrades to null. An owner
    // exemption would silently raise the cap by one whenever that read broke.
    tenantCtx.tenantPlan = 'plus';
    mockOwnerId = null;
    mockUsers = [fullAdmin('owner'), fullAdmin('volunteer')];
    await mount();
    expect(seatUsageText()).toBe('2 of 2 admins used');
    expect(addAdminButton().disabled).toBe(true);
  });

  it('does not count plain members', async () => {
    tenantCtx.tenantPlan = 'plus';
    mockUsers = [fullAdmin('owner'), member('m1'), member('m2'), member('m3')];
    await mount();
    expect(seatUsageText()).toBe('1 of 2 admins used');
  });

  // ── 6. copy contract ─────────────────────────────────────────────────────

  it('the at-cap copy contains no price and no seat add-on offer', async () => {
    tenantCtx.tenantPlan = 'plus';
    mockUsers = [fullAdmin('owner'), fullAdmin('volunteer')];
    await mount();

    // Extra seats at $10/mo are decided but UNBUILT — offering them would be the
    // fifth advertised-but-absent feature.
    const surfaces = [bodyText(), addAdminButton().title];
    for (const text of surfaces) {
      expect(text).not.toMatch(/add[- ]?on|extra seat|seat pack|buy |purchase|checkout/i);
      expect(text).not.toMatch(/\$\d|\/mo\b|per month/i);
      // All NINE prices now, not just two per tier — three terms means three
      // figures a seat-limit message must still never quote.
      for (const byTerm of Object.values(PLAN_PRICING)) {
        for (const price of Object.values(byTerm)) {
          expect(text).not.toContain(`$${price}`);
        }
      }
      expect(text).not.toContain('$10');
    }
    expect(addAdminButton().title).toMatch(/upgrade your plan/i);
  });

  // ── 7. caps come from PLAN_FEATURES, not literals ────────────────────────

  it("each plan's cap resolves from PLAN_FEATURES — 2 / 5 / 15", async () => {
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxAdmins)).toEqual([2, 5, 15]);

    for (const plan of PLAN_ORDER) {
      const cap = getPlanFeatures(plan).maxAdmins;
      // One under the cap: still open. Exactly at it: closed.
      for (const [seats, expectedDisabled] of [[cap - 1, false], [cap, true]] as const) {
        act(() => { root?.unmount(); });
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        tenantCtx.tenantPlan = plan;
        mockUsers = Array.from({ length: seats }, (_, i) => fullAdmin(`a${i}`));
        await mount();

        expect(seatUsageText()).toBe(`${seats} of ${cap} admins used`);
        expect(addAdminButton().disabled).toBe(expectedDisabled);
      }
    }
  });
});
