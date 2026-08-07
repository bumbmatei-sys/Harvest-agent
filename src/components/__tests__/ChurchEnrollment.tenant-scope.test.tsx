import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * ChurchEnrollment resolves the tenant TWICE, and the two calls must NOT agree.
 * This is the tenth and last site of the getTenantScope/getWriteTenantScope
 * class (#249 ×3, #250 ×5, #251 ×1) — it survived the earlier sweeps because
 * #249 lumped the create branch in with the ownership pre-check above it.
 *
 *   • the CREATE branch needs getWriteTenantScope() — getTenantScope() returns
 *     null by design for a super admin with no host scope, and a church stamped
 *     `tenantId: null` is fully visible but permanently unmanageable: update and
 *     delete on churches/{id} both gate on
 *     hasPermission('modifyChurches', resource.data.tenantId), which never
 *     passes for a null tenant. Nothing throws — the create succeeds and looks
 *     fine, and the failure surfaces when someone later tries to edit.
 *
 *   • the UPDATE branch's ownership pre-check needs getTenantScope() — there
 *     null deliberately SKIPS the check so a super admin can edit any tenant's
 *     church. Swapping it would resolve to the platform tenant and make every
 *     other tenant's church fail the mismatch guard.
 *
 * Tests 1–2 pin the fix; tests 3–4 pin the pre-check that must NOT change.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Both resolvers, independently controllable — the whole bug is that they
// differ for a super admin with no host scope.
const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
  PLATFORM_TENANT_ID: 'harvest',
}));

const fx = vi.hoisted(() => ({
  adds: [] as Array<{ path: string; data: any }>,
  updates: [] as Array<{ path: string; data: any }>,
  // tenantId carried by the church doc being edited, as read back by getDoc.
  existingTenantId: 'tenant-1' as string | null,
}));

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'admin-uid', email: 'a@test.com' } },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  addDoc: async (col: any, data: any) => { fx.adds.push({ path: col?.__path, data }); return { id: 'new-church' }; },
  updateDoc: async (ref: any, data: any) => { fx.updates.push({ path: ref?.__path, data }); },
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: fx.existingTenantId }) }),
}));

vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  handleFirestoreError: () => {},
}));

// Third-party address widget — needs a Google Maps key and a live script tag.
// Irrelevant to tenant scoping; the test fills lat/lng directly instead.
vi.mock('react-google-autocomplete', () => ({ default: () => null }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => null }));

const ChurchEnrollment = (await import('../ChurchEnrollment')).default;

let container: HTMLDivElement;
let root: Root;

function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function field(name: string): HTMLInputElement {
  const el = container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
  if (!el) throw new Error(`field "${name}" not found — the form markup changed, test needs updating`);
  return el;
}

/** Mount, fill the minimum the submit handler needs, and submit. */
async function mountAndSubmit(initialData?: any) {
  await act(async () => {
    root = createRoot(container);
    root.render(<ChurchEnrollment onBack={() => {}} initialData={initialData} />);
    await Promise.resolve();
  });

  // Real lat/lng keep handleSubmit off the Nominatim geocoding fallback, which
  // would otherwise hit the network.
  if (!initialData) {
    await act(async () => { setValue(field('churchName'), 'Grace Chapel'); });
    await act(async () => { setValue(field('lat'), '45.75'); });
    await act(async () => { setValue(field('lng'), '21.22'); });
  }

  const form = container.querySelector('form');
  if (!form) throw new Error('form not found — test needs updating');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  fx.adds = [];
  fx.updates = [];
  fx.existingTenantId = 'tenant-1';
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

/** Apex super admin: read scope null ("all tenants"), write scope the platform tenant. */
function apexSuperAdmin() {
  scope.read = null;
  scope.write = 'harvest';
}

// ─────────────────────────────────────────────────────────────────────────────
// The create branch — the bug itself.
// ─────────────────────────────────────────────────────────────────────────────
describe('ChurchEnrollment — church create', () => {
  it('stamps tenantId "harvest" for an apex super admin, not null', async () => {
    apexSuperAdmin();
    await mountAndSubmit();

    const write = fx.adds.find((a) => a.path === 'churches');
    expect(write, 'no church write was captured').toBeDefined();
    expect(write!.data.tenantId).toBe('harvest');
    // The whole point: a null here is fully visible but permanently
    // unmanageable by the owning church.
    expect(write!.data.tenantId).not.toBeNull();
  });

  it('is unchanged for an ordinary tenant admin on a subdomain', async () => {
    await mountAndSubmit();

    const write = fx.adds.find((a) => a.path === 'churches');
    expect(write!.data.tenantId).toBe('tenant-1');
  });

  it('writes null rather than undefined when neither resolver yields a tenant', async () => {
    // Signed-out/unresolved: getWriteTenantScope() returns null for a
    // non-super-admin. `|| null` must survive — the Firestore SDK throws on
    // undefined, so dropping it would turn a bad field into a crash.
    scope.read = null;
    scope.write = null;
    await mountAndSubmit();

    const write = fx.adds.find((a) => a.path === 'churches');
    expect(write!.data.tenantId).toBeNull();
    expect('tenantId' in write!.data).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ownership pre-check — must NOT be swapped to getWriteTenantScope().
// These are the guard against over-applying the fix above.
// ─────────────────────────────────────────────────────────────────────────────
describe('ChurchEnrollment — church update ownership pre-check', () => {
  const EXISTING = { id: 'church-1', name: 'Grace Chapel', lat: 45.75, lng: 21.22 };

  it("lets an apex super admin edit another tenant's church with a null read scope", async () => {
    apexSuperAdmin();
    fx.existingTenantId = 'other-tenant';
    await mountAndSubmit(EXISTING);

    // A null read scope deliberately skips the mismatch guard. Had the
    // pre-check used getWriteTenantScope() it would resolve to 'harvest',
    // mismatch 'other-tenant', and bail before updateDoc.
    expect(fx.updates.map((u) => u.path)).toContain('churches/church-1');
  });

  it('still rejects a genuine tenant mismatch', async () => {
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    fx.existingTenantId = 'other-tenant';
    await mountAndSubmit(EXISTING);

    expect(fx.updates).toHaveLength(0);
  });
});
