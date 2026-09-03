import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact, CRMCounts } from '../../hooks/queries/useCRMQueries';
import { IMPORT_CHUNK_SIZE, CSV_EMPTY_MESSAGE, CSV_HEADER_ONLY_MESSAGE } from '../../utils/csv-import';

/**
 * THE-74 — CSV import in the CRM, at the screen.
 *
 * The parsing, mapping, de-duplication, batching and summary wording are pinned
 * as pure functions in src/utils/__tests__/csv-import.test.ts. What is pinned
 * HERE is everything that only exists once those parts are wired to a write:
 * the tenantId on the document, the explicit type on the document, the cap
 * gate, the chunked batches, the partial-failure report, and the fact that the
 * manual add came through untouched.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  navigate, authFetch, notifyError, invalidateQueries,
  contactsResult, countsResult, tenantCtx, appStore, writes, batchFailure,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  countsResult: { current: { data: undefined as unknown } },
  tenantCtx: { tenantPlan: 'max' as string | undefined },
  appStore: { current: { currentTenantId: 't1' as string | null, isAuthReady: true, isSuperAdmin: false } },
  // Every write this screen can make, kept apart by MECHANISM: the manual add
  // uses addDoc, the import uses batched sets. Keeping them in separate buckets
  // is what lets "the manual add is unchanged" be asserted rather than assumed.
  writes: {
    added: [] as Record<string, unknown>[],
    set: [] as Record<string, unknown>[],
    deleted: [] as unknown[],
    committed: [] as Record<string, unknown>[],
    batchSizes: [] as number[],
  },
  batchFailure: { failFromCommit: null as number | null, message: 'the connection dropped' },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async (_c: unknown, data: Record<string, unknown>) => { writes.added.push(data); return { id: 'a1' }; }),
  deleteDoc: vi.fn(async (ref: unknown) => { writes.deleted.push(ref); }),
  setDoc: vi.fn(async (_r: unknown, data: Record<string, unknown>) => { writes.set.push(data); }),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
  // A faithful stand-in for a Firestore batch, ATOMICITY INCLUDED: a batch that
  // throws on commit contributes nothing. That is the property the partial
  // failure report depends on, so a mock that leaked half a failed batch would
  // let a broken report pass.
  writeBatch: vi.fn(() => {
    const ops: Record<string, unknown>[] = [];
    return {
      set: vi.fn((_ref: unknown, data: Record<string, unknown>) => { ops.push(data); }),
      commit: vi.fn(async () => {
        const index = writes.batchSizes.length;
        if (batchFailure.failFromCommit !== null && index >= batchFailure.failFromCommit) {
          throw new Error(batchFailure.message);
        }
        writes.batchSizes.push(ops.length);
        writes.committed.push(...ops);
      }),
    };
  }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => appStore.current }));
vi.mock('../AdminScreenHeader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../AdminScreenHeader')>()),
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));
// Only the data hooks are stubbed. csv-import.ts, contact-capacity.ts and
// PLAN_FEATURES all stay REAL — the numbers and the parsing this screen
// enforces are the ones the modules publish.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useCRMCounts: () => countsResult.current,
  useContactActivities: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: () => {} }),
}));

const base = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.org', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 't1',
  ...over,
});

const accountRow = (i: number): Contact => base({
  id: `u${i}`, firstName: 'Member', lastName: `N${i}`,
  email: `member${i}@church.org`, type: 'member',
  account: { role: 'user', email: `member${i}@church.org` },
});

const counts = (over: Partial<CRMCounts> = {}): CRMCounts => ({
  contactRecords: 0, memberAccounts: 0, platformWide: false,
  contactsTruncated: false, usersTruncated: false,
  ...over,
});

/** A Breeze-shaped export: arbitrary headings, CRLF, a BOM, a quoted comma. */
const CHURCH_EXPORT =
  '﻿Given,Surname,Primary Email,Home Phone,Internal ID\r\n'
  + 'Ruth,Boaz,ruth@church.org,+1 555 0100,A-1\r\n'
  + 'Naomi,Elimelech,naomi@church.org,+1 555 0101,A-2\r\n'
  + '"Smith, John",Smith,john@church.org,,A-3\r\n';

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
};

async function mountCRM() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminCRM currentUserRole="admin" currentUserPermissions={{ fullAccess: true } as never} />);
  });
  await flush();
}

const byId = <T extends HTMLElement>(testid: string): T | null =>
  container.querySelector(`[data-testid="${testid}"]`) as T | null;

const click = async (el: HTMLElement) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

/** Choose a file on the real file input, the way the browser would. */
async function chooseFile(text: string, name = 'members.csv') {
  const input = byId<HTMLInputElement>('crm-import-file')!;
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
}

/** Drive one of the mapping / type selects. */
async function choose(testid: string, value: string) {
  const el = byId<HTMLSelectElement>(testid)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

/** Open the panel, load a file, and map the church-export columns. */
async function openAndMap(file = CHURCH_EXPORT) {
  await click(byId<HTMLButtonElement>('crm-import-contacts')!);
  await chooseFile(file);
  await choose('crm-import-map-firstName', '0');
  await choose('crm-import-map-lastName', '1');
  await choose('crm-import-map-email', '2');
  await choose('crm-import-map-phone', '3');
}

const runImport = async () => { await click(byId<HTMLButtonElement>('crm-import-run')!); };

const resultText = () =>
  byId('crm-import-result')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  contactsResult.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  countsResult.current = { data: counts() };
  tenantCtx.tenantPlan = 'max';
  appStore.current = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false };
  writes.added = []; writes.set = []; writes.deleted = [];
  writes.committed = []; writes.batchSizes = [];
  batchFailure.failFromCommit = null;
  batchFailure.message = 'the connection dropped';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ── 1 ── ─────────────────────────────────────────────────────────────────────
describe('a valid CSV imports every row', () => {
  it('writes one contact per row in the file', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed).toHaveLength(3);
    expect(writes.committed.map(c => c.firstName)).toEqual(['Ruth', 'Naomi', 'Smith, John']);
  });

  it('carries every mapped value onto the document, quoted comma and all', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed[0]).toMatchObject({
      firstName: 'Ruth', lastName: 'Boaz',
      email: 'ruth@church.org', phone: '+1 555 0100',
    });
    expect(writes.committed[2]).toMatchObject({ firstName: 'Smith, John' });
  });

  it('leaves an unmapped column out of the document entirely', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();
    // "Internal ID" was never mapped, so A-1 reaches nothing.
    expect(JSON.stringify(writes.committed)).not.toContain('A-1');
  });

  it('says what it did, and refreshes the list so the new people are visible', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(resultText()).toContain('Imported 3 contacts');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contacts', 't1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['crmCounts', 't1'] });
  });
});

// ── 2 ── ─────────────────────────────────────────────────────────────────────
describe('columns are mapped by the user, not inferred from header names', () => {
  it('nothing is written until the user points at a first-name column', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(CHURCH_EXPORT);
    await choose('crm-import-type-default', 'member');

    // The headings are `Given` / `Primary Email`. Even a heading called
    // `First Name` would not be picked up — the mapping is the user's.
    expect(byId('crm-import-preview-row')).toBeNull();
    expect(byId<HTMLButtonElement>('crm-import-run')!.disabled).toBe(true);
  });

  it('offers a mapping control for every importable field', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(CHURCH_EXPORT);
    for (const field of ['firstName', 'lastName', 'email', 'phone', 'type', 'street', 'city', 'state', 'zip', 'country', 'notes']) {
      expect(byId(`crm-import-map-${field}`)).not.toBeNull();
    }
  });

  it('every mapping control defaults to "not imported" — nothing is pre-guessed', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(CHURCH_EXPORT);
    for (const field of ['firstName', 'email', 'phone', 'notes']) {
      expect(byId<HTMLSelectElement>(`crm-import-map-${field}`)!.value).toBe('');
    }
  });

  it('honours a mapping the user chose, even a surprising one', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(CHURCH_EXPORT);
    await choose('crm-import-map-firstName', '2');   // the email column
    await choose('crm-import-type-default', 'member');
    await runImport();
    expect(writes.committed[0].firstName).toBe('ruth@church.org');
  });
});

// ── 3 ── ─────────────────────────────────────────────────────────────────────
describe('a preview shows the mapped rows before anything is written', () => {
  it('renders the mapped rows, and writes nothing while it does', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');

    const rows = container.querySelectorAll('[data-testid="crm-import-preview-row"]');
    expect(rows.length).toBeGreaterThan(0);
    const text = byId('crm-import-preview-row')!.textContent ?? '';
    expect(text).toContain('Ruth Boaz');
    expect(text).toContain('ruth@church.org');

    // Nothing has been written. The preview is a look, not a commit.
    expect(writes.committed).toHaveLength(0);
    expect(writes.added).toHaveLength(0);
    expect(writes.batchSizes).toHaveLength(0);
  });

  it('shows the type each row will carry, and where that type came from', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'donor');

    const first = byId('crm-import-preview-row')!;
    expect(first.textContent).toContain('Donor');
    expect(first.querySelector('[data-testid="crm-import-type-source"]')!.textContent)
      .toContain('your choice');
  });

  it('marks a type that came out of the file as such', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('Given,Kind\r\nRuth,donor\r\n');
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-type', '1');
    await choose('crm-import-type-default', 'member');

    const first = byId('crm-import-preview-row')!;
    expect(first.textContent).toContain('Donor');
    expect(first.querySelector('[data-testid="crm-import-type-source"]')!.textContent)
      .toContain('from your file');
  });

  it('counts what will be imported and what will be skipped, before the import', async () => {
    contactsResult.current = {
      data: [base({ id: 'c1', email: 'ruth@church.org', firstName: 'Ruth' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');

    const summary = byId('crm-import-counts')!.textContent!.replace(/\s+/g, ' ');
    expect(summary).toContain('2 to import');
    expect(summary).toContain('1 already in your CRM');
  });

  it('warns, before writing, about rows that a second upload would duplicate', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('Given,Primary Email\r\nRuth,\r\nNaomi,naomi@church.org\r\n');
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-email', '1');
    await choose('crm-import-type-default', 'member');

    expect(byId('crm-import-unmatchable')!.textContent).toMatch(/no email address/i);
    expect(writes.committed).toHaveLength(0);
  });

  it('says so when the loaded list is too short to check every duplicate against', async () => {
    countsResult.current = { data: counts({ contactRecords: 5000, contactsTruncated: true }) };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    expect(byId('crm-import-truncation')!.textContent).toMatch(/duplicate check covers only/i);
  });
});

// ── 4 ── THE TRUST TEST ──────────────────────────────────────────────────────
describe('re-importing the same file does not duplicate contacts', () => {
  it('the second upload of an already-imported file writes nobody', async () => {
    // The CRM now holds what a first import put there.
    contactsResult.current = {
      data: [
        base({ id: 'c1', firstName: 'Ruth', email: 'ruth@church.org' }),
        base({ id: 'c2', firstName: 'Naomi', email: 'naomi@church.org' }),
        base({ id: 'c3', firstName: 'John', email: 'john@church.org' }),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');

    // There is nothing to import, so the button will not even offer it.
    expect(byId<HTMLButtonElement>('crm-import-run')!.disabled).toBe(true);
    expect(byId('crm-import-counts')!.textContent).toContain('0 to import');
    expect(writes.committed).toHaveLength(0);
  });

  it('writes only the people added to the file since the last import', async () => {
    contactsResult.current = {
      data: [
        base({ id: 'c1', firstName: 'Ruth', email: 'ruth@church.org' }),
        base({ id: 'c2', firstName: 'Naomi', email: 'naomi@church.org' }),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed).toHaveLength(1);
    expect(writes.committed[0]).toMatchObject({ email: 'john@church.org' });
    expect(resultText()).toContain('2 already in your CRM');
  });

  it('a duplicate is skipped, never used to overwrite the contact already there', async () => {
    contactsResult.current = {
      data: [base({ id: 'c1', firstName: 'Ruth', email: 'ruth@church.org', notes: 'Leads the choir' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    // The existing contact was not touched by any mechanism: no batched write
    // carries her, and no setDoc/addDoc ran at all.
    expect(writes.committed.map(c => c.email)).not.toContain('ruth@church.org');
    expect(writes.set).toHaveLength(0);
    expect(writes.added).toHaveLength(0);
  });

  it('matches someone who exists only as an app account, not just as a contact row', async () => {
    // The CRM list is a merge, so the dedupe index covers `users` rows too —
    // otherwise an import would give an existing member a second row.
    contactsResult.current = {
      data: [accountRow(0), base({ id: 'u9', firstName: 'Ruth', email: 'RUTH@Church.org', account: { role: 'user', email: 'RUTH@Church.org' } })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed.map(c => c.email)).not.toContain('ruth@church.org');
    expect(writes.committed).toHaveLength(2);
  });
});

// ── 5 ── THE BLANK-BADGE GUARD ───────────────────────────────────────────────
describe('every imported contact has an explicit type', () => {
  it('every written document carries a type from the union', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'both');
    await runImport();

    expect(writes.committed).toHaveLength(3);
    for (const written of writes.committed) {
      expect(Object.keys(written)).toContain('type');
      expect(written.type).toBeDefined();
      expect(['donor', 'member', 'both']).toContain(written.type);
    }
  });

  it('refuses to import at all until a type has been chosen', async () => {
    await mountCRM();
    await openAndMap();
    // Columns mapped, type not answered.
    expect(byId<HTMLSelectElement>('crm-import-type-default')!.value).toBe('');
    expect(byId<HTMLButtonElement>('crm-import-run')!.disabled).toBe(true);

    await runImport();
    expect(writes.committed).toHaveLength(0);
    expect(writes.batchSizes).toHaveLength(0);
  });

  it('the type control has no pre-selection — the choice is the church’s', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(CHURCH_EXPORT);
    const select = byId<HTMLSelectElement>('crm-import-type-default')!;
    expect(select.value).toBe('');
    expect(select.value).not.toBe('member');
  });
});

// ── 6 ── ─────────────────────────────────────────────────────────────────────
describe('no imported contact is labelled with a type the file did not state', () => {
  it('a file with no type column gets the type the admin picked, never "member" by default', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'donor');
    await runImport();

    expect(writes.committed.map(c => c.type)).toEqual(['donor', 'donor', 'donor']);
  });

  it('a file that DOES state a type has it honoured per row', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('Given,Kind\r\nRuth,donor\r\nNaomi,both\r\nBoaz,member\r\n');
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-type', '1');
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed.map(c => c.type)).toEqual(['donor', 'both', 'member']);
  });

  it('a value the union does not contain is not coerced into one — it takes the chosen type', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('Given,Kind\r\nRuth,Volunteer\r\nNaomi,Guest\r\n');
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-type', '1');
    await choose('crm-import-type-default', 'donor');
    await runImport();

    expect(writes.committed.map(c => c.type)).toEqual(['donor', 'donor']);
    expect(JSON.stringify(writes.committed)).not.toContain('Volunteer');
  });
});

// ── 7 ── THE TEN-BUG CLASS ───────────────────────────────────────────────────
describe('every imported contact carries a concrete tenantId, never null', () => {
  it('stamps the resolved tenant on every written document', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed).toHaveLength(3);
    for (const written of writes.committed) {
      expect(written.tenantId).toBe('t1');
      expect(written.tenantId).not.toBeNull();
      expect(written.tenantId).not.toBeUndefined();
      expect(written.tenantId).not.toBe('');
    }
  });

  it('a super admin with no tenant in context writes the platform tenant, not null', async () => {
    // This is the case that produced the bug class: getTenantScope() answers
    // null for a super admin, and null means ALL TENANTS on a read.
    appStore.current = { currentTenantId: null, isAuthReady: true, isSuperAdmin: true };
    countsResult.current = { data: counts({ platformWide: true }) };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed.length).toBeGreaterThan(0);
    for (const written of writes.committed) {
      expect(written.tenantId).toBe('harvest');
      expect(written.tenantId).not.toBeNull();
    }
  });

  it('a tenant that never resolved still writes a concrete id, never null', async () => {
    // The exact state the bug class comes from: no tenant in context and no
    // super-admin standing, so the screen's own `tenantId` is null. The write
    // must still land on a real id — a null tenantId means ALL TENANTS on a
    // read, and a contact written with one is unreadable and uneditable.
    appStore.current = { currentTenantId: null, isAuthReady: true, isSuperAdmin: false };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed.length).toBeGreaterThan(0);
    for (const written of writes.committed) {
      expect(written.tenantId).toBe('harvest');
      expect(written.tenantId).not.toBeNull();
    }
  });

  it('uses the same tenant resolution the manual add uses', async () => {
    await mountCRM();
    // Manual add first…
    await click(byId<HTMLButtonElement>('crm-add-contact')!);
    const input = container.querySelector('input[placeholder="First name"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'Ruth');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll('button')).find(b => /add contact/i.test(b.textContent ?? ''))!);

    // …then the import. Both must land on the same concrete id.
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.added[0].tenantId).toBe(writes.committed[0].tenantId);
  });
});

// ── 8 ── THE CAP ─────────────────────────────────────────────────────────────
//
// DECISION: at the cap the file is REFUSED, whole — the same gate the manual
// add carries. `maxContacts` counts ACCOUNTS, and an imported contact creates
// none, so trimming a file "to fit" would report a limit that nothing consumed.
describe('an import that exceeds the plan cap behaves as decided, and says so', () => {
  beforeEach(() => {
    tenantCtx.tenantPlan = 'plus'; // Individual — 150
    contactsResult.current = {
      data: Array.from({ length: 150 }, (_, i) => accountRow(i)),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 150 }) };
  });

  it('closes the import entry point, and says why on hover', async () => {
    await mountCRM();
    const button = byId<HTMLButtonElement>('crm-import-contacts')!;
    // Disabled, not hidden — the same shape the manual add uses.
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/upgrade your plan/i);
  });

  it('refuses to open the panel even if the button is clicked', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    expect(byId('crm-import-modal')).toBeNull();
    expect(writes.committed).toHaveLength(0);
  });

  it('says the limit ONCE — no second copy from the import surface', async () => {
    await mountCRM();
    // The screen's existing notice, and only it. Not a running meter, and not
    // repeated by the import button as its own banner.
    expect(container.querySelectorAll('[data-testid="crm-contact-limit"]')).toHaveLength(1);
    expect(byId('crm-contact-limit')!.textContent).toMatch(/upgrade your plan/i);
  });

  it('uses contactLimitMessage’s own wording, naming no price and no add-on', async () => {
    await mountCRM();
    const title = byId<HTMLButtonElement>('crm-import-contacts')!.title;
    expect(title).toContain('Donors who gave without creating an account');
    expect(title).not.toMatch(/\$|add-?on|per month|\bbuy\b/i);
  });

  it('under the cap the import is open and imports the whole file', async () => {
    // The other half of the decision: no headroom arithmetic, no partial
    // trimming — under the cap a 3-row file is 3 contacts.
    countsResult.current = { data: counts({ memberAccounts: 3 }) };
    contactsResult.current = {
      data: Array.from({ length: 3 }, (_, i) => accountRow(i)),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    expect(byId<HTMLButtonElement>('crm-import-contacts')!.disabled).toBe(false);
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();
    expect(writes.committed).toHaveLength(3);
  });
});

// ── 9 ── PARTIAL FAILURE ─────────────────────────────────────────────────────
describe('a failure partway through reports exactly which rows were written', () => {
  /** 600 people: two batches at IMPORT_CHUNK_SIZE. */
  const bigFile = 'Given,Primary Email\r\n'
    + Array.from({ length: 600 }, (_, i) => `Person${i},person${i}@church.org`).join('\r\n')
    + '\r\n';

  const mapBig = async () => {
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(bigFile);
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-email', '1');
    await choose('crm-import-type-default', 'member');
  };

  it('reports the exact number that reached Firestore when a later batch fails', async () => {
    batchFailure.failFromCommit = 1;    // batch 0 commits, batch 1 throws
    await mountCRM();
    await mapBig();
    await runImport();

    // Atomicity: the failed batch contributed nothing.
    expect(writes.committed).toHaveLength(IMPORT_CHUNK_SIZE);
    expect(resultText()).toContain(`Imported ${IMPORT_CHUNK_SIZE.toLocaleString()} contacts`);
    expect(resultText()).toContain(`${(600 - IMPORT_CHUNK_SIZE).toLocaleString()} not imported`);
  });

  it('names the last line saved and the first line that was not', async () => {
    batchFailure.failFromCommit = 1;
    await mountCRM();
    await mapBig();
    await runImport();

    // Header is line 1, so row N of the file is line N + 1.
    expect(resultText()).toContain(`through line ${IMPORT_CHUNK_SIZE + 1} was saved`);
    expect(resultText()).toContain(`nothing from line ${IMPORT_CHUNK_SIZE + 2} on`);
  });

  it('surfaces the real reason, not a generic failure', async () => {
    batchFailure.failFromCommit = 1;
    batchFailure.message = 'Missing or insufficient permissions.';
    await mountCRM();
    await mapBig();
    await runImport();
    expect(resultText()).toContain('Missing or insufficient permissions.');
  });

  it('stops at the first failing batch rather than scattering the gap', async () => {
    batchFailure.failFromCommit = 1;
    await mountCRM();
    await mapBig();
    await runImport();
    // One batch committed; the second failed and the loop ended there.
    expect(writes.batchSizes).toEqual([IMPORT_CHUNK_SIZE]);
  });

  it('a failure in the first batch says plainly that nothing was saved', async () => {
    batchFailure.failFromCommit = 0;
    await mountCRM();
    await mapBig();
    await runImport();

    expect(writes.committed).toHaveLength(0);
    expect(resultText()).toContain('Imported 0 contacts');
    expect(resultText()).toContain('Nothing was saved');
    expect(resultText()).not.toMatch(/through line \d/);
  });

  it('is never silent — a half-finished import always leaves a report on screen', async () => {
    batchFailure.failFromCommit = 1;
    await mountCRM();
    await mapBig();
    await runImport();
    expect(byId('crm-import-result')).not.toBeNull();
    expect(resultText()!.length).toBeGreaterThan(0);
  });

  it('still refreshes the list, so the rows that DID land are visible', async () => {
    batchFailure.failFromCommit = 1;
    await mountCRM();
    await mapBig();
    await runImport();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contacts', 't1'] });
  });
});

// ── 10 ── ────────────────────────────────────────────────────────────────────
describe('an import larger than one Firestore batch is chunked', () => {
  const bigFile = 'Given,Primary Email\r\n'
    + Array.from({ length: 1000 }, (_, i) => `Person${i},person${i}@church.org`).join('\r\n')
    + '\r\n';

  it('splits into batches that each stay under Firestore’s 500-operation ceiling', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(bigFile);
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-email', '1');
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.batchSizes.length).toBeGreaterThan(1);
    for (const size of writes.batchSizes) expect(size).toBeLessThanOrEqual(500);
    expect(writes.batchSizes).toEqual([IMPORT_CHUNK_SIZE, IMPORT_CHUNK_SIZE, 1000 - 2 * IMPORT_CHUNK_SIZE]);
  });

  it('writes every one of the 1,000 people exactly once', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile(bigFile);
    await choose('crm-import-map-firstName', '0');
    await choose('crm-import-map-email', '1');
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.committed).toHaveLength(1000);
    expect(new Set(writes.committed.map(c => c.email)).size).toBe(1000);
    expect(resultText()).toContain('Imported 1,000 contacts');
  });

  it('a file that fits in one batch is one batch', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();
    expect(writes.batchSizes).toEqual([3]);
  });
});

// ── 12 ── ────────────────────────────────────────────────────────────────────
describe('an empty file and a header-only file are rejected with a readable message', () => {
  it('rejects an empty file, and never reaches the mapping step', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('', 'empty.csv');

    expect(byId('crm-import-error')!.textContent).toContain(CSV_EMPTY_MESSAGE);
    expect(byId('crm-import-map-firstName')).toBeNull();
    expect(writes.committed).toHaveLength(0);
  });

  it('rejects a header-only file with its own distinct message', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('First Name,Email\r\n', 'headers.csv');

    expect(byId('crm-import-error')!.textContent).toContain(CSV_HEADER_ONLY_MESSAGE);
    expect(byId('crm-import-map-firstName')).toBeNull();
  });

  it('the message is readable — no stack, no "parse error"', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('');
    expect(byId('crm-import-error')!.textContent).not.toMatch(/parse|undefined|null|Error:/i);
  });

  it('a good file after a rejected one clears the error and proceeds', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-import-contacts')!);
    await chooseFile('');
    expect(byId('crm-import-error')).not.toBeNull();

    await chooseFile(CHURCH_EXPORT);
    expect(byId('crm-import-error')).toBeNull();
    expect(byId('crm-import-map-firstName')).not.toBeNull();
  });
});

// ── 13 ── ────────────────────────────────────────────────────────────────────
describe('the manual add path is unchanged', () => {
  const addManually = async (firstName: string) => {
    await click(byId<HTMLButtonElement>('crm-add-contact')!);
    const input = container.querySelector('input[placeholder="First name"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, firstName);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll('button')).find(b => /add contact/i.test(b.textContent ?? ''))!);
  };

  it('still writes through addDoc, with the same payload it always had', async () => {
    await mountCRM();
    await addManually('Ruth');

    expect(writes.added).toHaveLength(1);
    expect(writes.added[0]).toMatchObject({
      firstName: 'Ruth', type: 'member', tenantId: 't1',
      lastDonationAt: null, memberSince: null,
      createdAt: 'SERVER_TS', createdBy: 'u1',
    });
    // And it did NOT get rerouted through the import's batched write.
    expect(writes.batchSizes).toHaveLength(0);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('the manual form still defaults a NEW contact to Member — that choice is untouched', async () => {
    await mountCRM();
    await click(byId<HTMLButtonElement>('crm-add-contact')!);
    const select = Array.from(container.querySelectorAll('select'))
      .find(s => Array.from(s.options).some(o => o.value === 'both'))!;
    expect(select.value).toBe('member');
  });

  it('the import never uses the manual add’s writer', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();
    // One collection, and the import did not become a second addDoc caller.
    expect(writes.added).toHaveLength(0);
    expect(writes.committed).toHaveLength(3);
  });

  it('the edit path and the activity write are untouched by an import', async () => {
    contactsResult.current = {
      data: [base({ id: 'c1', firstName: 'Existing', email: 'existing@church.org' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();

    expect(writes.set).toHaveLength(0);
    expect(writes.deleted).toHaveLength(0);
  });

  it('manual add still works after an import in the same session', async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    await runImport();
    await click(Array.from(container.querySelectorAll('button')).find(b => /^Done$/.test(b.textContent?.trim() ?? ''))!);

    await addManually('Naomi');
    expect(writes.added).toHaveLength(1);
    expect(writes.added[0]).toMatchObject({ firstName: 'Naomi', tenantId: 't1' });
  });
});

// ── 14 ── ────────────────────────────────────────────────────────────────────
describe('no colour is hardcoded', () => {
  const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

  const openPanel = async () => {
    await mountCRM();
    await openAndMap();
    await choose('crm-import-type-default', 'member');
    return byId('crm-import-modal')!;
  };

  it('the import panel contains no hex, rgb or hsl literal', async () => {
    const modal = await openPanel();
    expect(modal.innerHTML).not.toMatch(HEX);
    expect(modal.innerHTML).not.toMatch(/rgba?\(/i);
    expect(modal.innerHTML).not.toMatch(/hsla?\(/i);
  });

  it('no element in the import panel carries an inline colour', async () => {
    const modal = await openPanel();
    for (const el of Array.from(modal.querySelectorAll('[style]'))) {
      const style = el.getAttribute('style') ?? '';
      expect(style).not.toMatch(/color|background/i);
    }
  });

  it('the import button carries no colour literal either', async () => {
    await mountCRM();
    const button = byId<HTMLButtonElement>('crm-import-contacts')!;
    expect(button.outerHTML).not.toMatch(HEX);
    expect(button.getAttribute('style')).toBeNull();
    // A token class, so a tenant's brand colour and both themes follow it.
    expect(button.className).toContain('bg-surface-raised');
  });

  it('the preview does not restyle the Type pill — that colour belongs to the list', async () => {
    const modal = await openPanel();
    // The preview states the type as text. It deliberately does not reuse the
    // badge's colour classes, so nothing here collides with the Type-badge work
    // landing in this file.
    expect(modal.querySelector('[data-testid="crm-type-badge"]')).toBeNull();
    expect(modal.innerHTML).not.toContain('bg-sky-100');
    expect(modal.innerHTML).not.toContain('color-mix');
  });

  it('uses no font size below 11px', async () => {
    const modal = await openPanel();
    const sizes = modal.innerHTML.match(/text-\[(\d+)px\]/g) ?? [];
    for (const size of sizes) {
      expect(Number(size.match(/(\d+)/)![1])).toBeGreaterThanOrEqual(11);
    }
  });
});
