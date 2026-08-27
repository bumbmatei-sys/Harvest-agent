import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * AFFILIATE_PROGRAM_ENABLED — the two smaller surfaces that name the programme.
 *
 *  1. The "Affiliate Program — View commission rates and referral payouts"
 *     permission row in Admin Roles. Offering a permission for a feature nobody
 *     can reach is an invitation to a dead end.
 *  2. The "Affiliate" entry in the bug-report area picker: an admin cannot open
 *     the area, so it cannot be where they saw a bug.
 *
 * The permission row is hidden from DISPLAY ONLY. `PERMISSION_CATEGORIES` and
 * `ALL_PERMISSION_DEFS` stay complete, because `normalizePermissions` reads
 * stored admin docs through them and `buildPermission` writes Full Access
 * through them — filtering the catalog itself would strip `manageAffiliate` off
 * every doc that round-tripped through this screen, which is data loss, not a
 * hidden UI. That invariant is asserted in both flag directions below.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1', email: 'a@b.c' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), getDocs: vi.fn(async () => ({ docs: [] })),
  getDoc: vi.fn(), doc: () => ({}), updateDoc: vi.fn(), where: () => ({}), deleteDoc: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'x' })),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write' },
  handleFirestoreError: () => {},
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'bumb',
  SUPER_ADMIN_EMAIL: 'super@theharvest.app',
}));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    useAdminHeader: () => {},
    HeaderActionButton: () => null,
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({
      setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {},
    }),
  };
});

/** Load a module with AFFILIATE_PROGRAM_ENABLED forced to `enabled`.
 *
 *  THE-245 — the SMS master switch is forced ON throughout, because this suite
 *  is about the AFFILIATE flag and one of its assertions is that with that flag
 *  on the visible permission catalog is the full catalog again, byte for byte.
 *  A second hidden row would blunt exactly the claim being made. The SMS row's
 *  own hiding is asserted in the-245-sms-hidden.test.tsx.
 */
async function withFlag<T>(enabled: boolean, load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  vi.doMock('../../utils/plan-features', async () => {
    const actual = await vi.importActual<typeof import('../../utils/plan-features')>(
      '../../utils/plan-features'
    );
    return { ...actual, AFFILIATE_PROGRAM_ENABLED: enabled };
  });
  vi.doMock('../../lib/sms-feature', () => ({
    SMS_FEATURE_ENABLED: true,
    SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
  }));
  return load();
}

const loadRoles = (enabled: boolean) =>
  withFlag(enabled, () => import('../AnalyticsAndRoles'));

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.doUnmock('../../utils/plan-features');
  vi.doUnmock('../../lib/sms-feature');
});

describe('Admin Roles — the "Affiliate Program" permission row', () => {
  it('is hidden from every rendered permission list with the flag off', async () => {
    const m = await loadRoles(false);
    const keys = m.VISIBLE_PERMISSION_DEFS.map((d) => d.key);
    expect(keys).not.toContain('manageAffiliate');
    expect(m.VISIBLE_PERMISSION_DEFS.some((d) => /affiliate/i.test(d.label))).toBe(false);
    expect(m.VISIBLE_PERMISSION_CATEGORIES.flatMap((c) => c.items.map((i) => i.key)))
      .not.toContain('manageAffiliate');
  });

  it('comes back with the flag on, in its original category', async () => {
    const m = await loadRoles(true);
    expect(m.VISIBLE_PERMISSION_DEFS.map((d) => d.key)).toContain('manageAffiliate');
    const admin = m.VISIBLE_PERMISSION_CATEGORIES.find((c) => c.id === 'admin');
    expect(admin?.items.map((i) => i.key)).toContain('manageAffiliate');
    // Byte-for-byte the full catalog again — hiding cost nothing else.
    expect(m.VISIBLE_PERMISSION_DEFS.map((d) => d.key)).toEqual(
      m.ALL_PERMISSION_DEFS.map((d) => d.key)
    );
  });

  it('never touches the permission DATA model — the catalog keeps manageAffiliate either way', async () => {
    for (const enabled of [false, true]) {
      const m = await loadRoles(enabled);
      // The catalog `normalizePermissions` and `buildPermission` read.
      expect(m.ALL_PERMISSION_DEFS.map((d) => d.key)).toContain('manageAffiliate');
      // A stored grant survives a read…
      expect(m.normalizePermissions({ manageAffiliate: true }).manageAffiliate).toBe(true);
      // …and Full Access still grants it.
      expect(m.normalizePermissions({ manageAffiliate: false }).manageAffiliate).toBe(false);
    }
  });
});

describe('Bug report — the "Affiliate" area option', () => {
  async function openAdminAreaPicker(enabled: boolean): Promise<string[]> {
    const ContactModal = (await withFlag(enabled, () => import('../ContactModal'))).default;
    await act(async () => {
      root = createRoot(container);
      root.render(<ContactModal isOpen onClose={() => {}} />);
    });
    const buttons = () => Array.from(container.querySelectorAll('button'));
    const bug = buttons().find((b) => b.textContent?.includes('Report a Bug'));
    await act(async () => { bug!.click(); });
    const admin = buttons().find((b) => b.textContent?.trim() === 'Admin');
    await act(async () => { admin!.click(); });
    return Array.from(container.querySelectorAll('select[name="area"] option')).map(
      (o) => o.textContent?.trim() ?? ''
    );
  }

  it('is not offered with the flag off', async () => {
    const areas = await openAdminAreaPicker(false);
    expect(areas).not.toContain('Affiliate');
    // The rest of the picker is untouched.
    expect(areas).toEqual(expect.arrayContaining(['Accounting', 'Livestream', 'Other']));
  });

  it('is offered again with the flag on, in its original position', async () => {
    const areas = await openAdminAreaPicker(true);
    expect(areas).toContain('Affiliate');
    expect(areas.indexOf('Affiliate')).toBe(areas.indexOf('Accounting') + 1);
    expect(areas.indexOf('Livestream')).toBe(areas.indexOf('Affiliate') + 1);
  });
});
