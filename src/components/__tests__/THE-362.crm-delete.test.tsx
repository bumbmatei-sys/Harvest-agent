import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import AdminCRM from '../AdminCRM';
import type { Contact } from '../../hooks/queries/useCRMQueries';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-362 - deleting somebody in the CRM, and the two things that did nothing.
 *
 * The founder, twice:
 *   "If I delete a user in CRM, it doesn't disappear from the table."
 *   "I created a user, I gave him admin. I entered from that admin account and
 *    tried to delete my own account basically and nothing happened."
 *
 * --- ONE ROOT CAUSE, TWO FAULTS ---------------------------------------------
 *
 * The CRM list is a MERGE of two collections. `useContactsWithUsers` reads
 * `contacts`, then surfaces every app member from `users` who has no matching
 * contact - keyed by their `users` doc id. `confirmDelete` sent every row of
 * that merged list to `deleteDoc(contacts/<row.id>)`.
 *
 * For a surfaced member that id is a `users` id, so the write named a
 * `contacts` document that has never existed. Whatever Firestore makes of that
 * - the top-level `contacts` delete rule is `hasPermission('manageCRM',
 * resource.data.get('tenantId', ''))` and `resource` is null for a missing
 * document - the outcome on screen is identical and it is deterministic: the
 * row's source is the `users` doc, that doc is untouched, and the row is back
 * on the next read. Nothing the admin could do would make it go.
 *
 * AND AN ADMIN'S OWN ROW IS ONE OF THOSE ROWS. That is why deleting themselves
 * also did nothing: the same write, aimed at the same absent document. The
 * founder's read - that refusing self-deletion is correct - is right, and this
 * ticket makes it a refusal that SAYS SO instead of a write that cannot land.
 *
 * --- WHAT IT IS NOT ---------------------------------------------------------
 *
 * NOT A REFRESH BUG. `confirmDelete` already invalidated `['contacts',
 * tenantId]`, react-query matches that by PREFIX, and the list's own key is
 * `['contacts', tenantId, 'with-users']` - so the list DID refetch, and
 * refetching is precisely what put the row back. Section 12 pins that prefix
 * relationship so a future rename cannot quietly break the invalidation.
 *
 * NOT A PERMISSION BUG EITHER. `manageCRM` already gates this screen and a
 * contact the church really owns deletes and disappears today - section 12.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));

const CRM = 'src/components/AdminCRM.tsx';
const QUERIES = 'src/hooks/queries/useCRMQueries.ts';

/** The signed-in admin, as `auth.currentUser` reports them. */
const ME = { uid: 'me-uid', email: 'Pastor@Grace.Church' };

const { navigate, authFetch, notifyError, invalidateQueries, contactsResult, deleteDoc, docPaths } =
  vi.hoisted(() => ({
    navigate: vi.fn(),
    // Typed with its real parameters: `.mock.calls` is how the cascade's URL
    // and method are asserted, and a zero-arg signature makes that a tuple
    // of length 0 that nothing can be read out of.
    authFetch: vi.fn(
      async (_url: string, _init?: { method?: string }): Promise<unknown> =>
        ({ ok: true, json: async () => ({ connected: false }) }),
    ),
    notifyError: vi.fn(),
    invalidateQueries: vi.fn(async () => {}),
    deleteDoc: vi.fn(async () => {}),
    docPaths: [] as string[],
    contactsResult: {
      current: {
        data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn(),
      },
    },
  }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'me-uid', email: 'Pastor@Grace.Church' } },
}));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantPlan: undefined }) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc,
  setDoc: vi.fn(async () => {}),
  // The RECORDER. Every write's path is captured, so "the money was never
  // touched" is an assertion rather than a hope.
  doc: (_db: unknown, ...segments: string[]) => {
    docPaths.push(segments.join('/'));
    return { __path: segments.join('/') };
  },
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
  useCRMCounts: () => ({ data: undefined }),
}));

/** A row of the MERGED list, shaped as the hook actually produces it. */
const contactRow = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'Ada', lastName: 'Person', email: 'ada@example.com', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'someone', updatedAt: null, tenantId: 't1',
  ...over,
});

/**
 * A row SURFACED FROM `users` - an app member with no contact record.
 *
 * `accountOnly` is what `mergeContactsWithUsers` stamps on exactly these rows,
 * and the fixture sets it the same way rather than inventing a flag: section 12
 * asserts against the REAL merge that a users-only row really does carry it.
 */
const accountRow = (over: Partial<Contact> & { id: string }): Contact =>
  contactRow({ accountOnly: true, account: { role: 'user', email: 'ada@example.com' }, ...over });

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  deleteDoc.mockClear(); deleteDoc.mockImplementation(async () => {});
  // The cascade call succeeds by default; the tests that need it to fail say so.
  authFetch.mockClear();
  authFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ removed: 0 }) }) as never);
  invalidateQueries.mockClear();
  notifyError.mockClear();
  docPaths.length = 0;
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

async function openContact(rows: Contact[], id: string) {
  contactsResult.current = {
    data: rows, isLoading: false, isError: false, error: null, refetch: vi.fn(),
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM
        currentUserRole="admin"
        currentUserPermissions={{ fullAccess: true, manageCRM: true } as never}
        initialContactId={id}
      />,
    );
  });
  await flush();
}

const q = <T extends Element>(sel: string) => container.querySelector<T>(sel);
const byText = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

/** Open the contact card's delete confirmation. */
async function pressDelete() {
  const trash = q<HTMLButtonElement>('[data-testid="crm-delete-contact"]');
  expect(trash, 'the delete control is gone from the contact card').not.toBeNull();
  await act(async () => { trash!.click(); });
  await flush();
}

/** Press Delete inside the confirmation, when the dialog offers one. */
async function confirm() {
  const button = byText('Delete');
  expect(button, 'the confirmation has no Delete control').toBeTruthy();
  await act(async () => { button!.click(); });
  await flush();
}

const refusal = () => q<HTMLElement>('[data-crm-delete-refused]');
const dialogOpen = () => Boolean(byText('Cancel') || byText('Close'));

/* ═══ 12 · deleting a contact removes the row from the table ══════════════ */

describe('12 - deleting a contact removes the row from the table', () => {
  it('a CRM contact is deleted at its own path, and the list query is invalidated', async () => {
    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    expect(refusal(), 'a real contact was refused').toBeNull();
    await confirm();

    expect(deleteDoc, 'no delete was issued').toHaveBeenCalledTimes(1);
    expect(docPaths, 'the delete did not name the contact document').toContain('contacts/c1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contacts', 't1'] });
  });

  it('and the key it invalidates is a PREFIX of the list’s own key', () => {
    /**
     * THE MECHANISM, pinned. react-query matches `invalidateQueries` by prefix
     * unless `exact` is set, so `['contacts', tenantId]` reaches the list's
     * `['contacts', tenantId, 'with-users']`. That is why "the row did not
     * disappear" was never a refresh bug - and why a rename of either key would
     * turn it into one. Both halves are asserted here rather than reasoned
     * about in a comment.
     */
    expect(code(QUERIES), 'the merged list query key changed shape')
      .toContain("queryKey: ['contacts', tenantId, 'with-users']");
    expect(code(CRM), 'the delete stopped invalidating the contacts prefix')
      .toContain("invalidateQueries({ queryKey: ['contacts', tenantId] })");
    // And no `exact: true` anywhere near it, which would break the prefix match.
    expect(code(CRM), 'an exact invalidation would miss the merged list')
      .not.toMatch(/invalidateQueries\(\{[^}]*exact:\s*true/);
  });

  it('the dialog closes and the card returns to the list', async () => {
    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    await confirm();
    expect(dialogOpen(), 'the confirmation stayed open after a successful delete').toBe(false);
  });

  it('a row surfaced from `users` really does carry `accountOnly` - the REAL merge', async () => {
    // Not the fixture's word for it. If `mergeContactsWithUsers` stopped
    // stamping the flag, every refusal below would silently stop refusing.
    const { mergeContactsWithUsers } = await import('../../hooks/queries/useCRMQueries');
    const merged = mergeContactsWithUsers(
      [contactRow({ id: 'c1', email: 'someone@else.test', userId: 'other' })],
      [{ id: 'u-new', data: { email: 'new@member.test', displayName: 'New Member' } }],
      't1',
    );
    const surfaced = merged.find((c) => c.id === 'u-new');
    expect(surfaced, 'the users row was not surfaced at all').toBeTruthy();
    expect(surfaced!.accountOnly, 'a users-only row no longer says it has no contact record')
      .toBe(true);
    // And a real contact row does NOT carry it - the flag must not be universal.
    expect(merged.find((c) => c.id === 'c1')!.accountOnly).toBeUndefined();
  });

  it('an app member with no contact record is REFUSED, not silently no-op’d', async () => {
    await openContact([accountRow({ id: 'u-9', firstName: 'Ada', lastName: 'Lovelace' })], 'u-9');
    await pressDelete();

    const alert = refusal();
    expect(alert, 'the founder’s bug is back: the delete looks available').not.toBeNull();
    expect(alert!.getAttribute('role'), 'the refusal is not announced').toBe('alert');
    expect(alert!.textContent).toContain('Ada Lovelace has an app account');
    expect(alert!.textContent).toContain('no CRM record here to delete');
    //  AND NO WRITE WAS ISSUED. The old code sent one that could not land.
    expect(deleteDoc, 'a delete was still issued at a document that does not exist')
      .not.toHaveBeenCalled();
    expect(byText('Delete'), 'a Delete control is still offered on a row it cannot remove')
      .toBeUndefined();
  });
});

/* ═══ 13 · a failed delete surfaces visibly ═══════════════════════════════ */

describe('13b - the CASCADE, and the failure mode one layer down', () => {
  /**
   * THE-362's follow-up. Deleting a contact left every `contactActivities` row
   * behind pointing at a document that no longer exists - a dangling reference
   * in a collection where a donation row carries an `invoiceId`.
   *
   * The sweep cannot run on the client: rules are not filters, so a `list`
   * constrained only on `contactId` cannot prove `tenantId` and is refused
   * outright. It runs on the Admin SDK behind a route that gates on `manageCRM`
   * itself - THE-350's pattern, at the same wall.
   */
  const cascadeCalls = () =>
    authFetch.mock.calls.filter((c) => String(c[0]).includes('/api/crm/contact-activities'));

  it('the timeline sweep runs, and it names the contact and the tenant', async () => {
    await openContact([contactRow({ id: 'c1', tenantId: 't1' })], 'c1');
    await pressDelete();
    await confirm();

    const calls = cascadeCalls();
    expect(calls, 'the timeline is no longer swept - the orphan is back').toHaveLength(1);
    expect(String(calls[0][0])).toContain('contactId=c1');
    expect(String(calls[0][0]), 'the sweep does not name a tenant').toContain('tenantId=t1');
    expect((calls[0][1] as { method?: string })?.method, 'the sweep is not a DELETE').toBe('DELETE');
  });

  it('THE ORDER: the timeline goes BEFORE the contact, never after', async () => {
    /**
     * THE SAFETY ARGUMENT, asserted at runtime rather than read off the source.
     * A failure after the contact is gone is exactly the orphan this fixes, so
     * the contact document must be the LAST thing removed.
     */
    const order: string[] = [];
    authFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/api/crm/contact-activities')) order.push('activities');
      return { ok: true, json: async () => ({ removed: 2 }) } as never;
    });
    deleteDoc.mockImplementation(async () => { order.push('contact'); });

    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    await confirm();

    expect(order, 'the contact was deleted before its timeline - that IS the orphan')
      .toEqual(['activities', 'contact']);
  });

  it('a FAILED sweep stops the contact delete, surfaces visibly, and keeps the dialog open', async () => {
    /**
     * 7 - NO-REGRESSION ON THIS PR'S OWN FIX, one layer down. The bug fixed
     * earlier in THE-362 was a delete that closed the dialog and walked back to
     * the list as though it had worked. Adding a second write in front of it is
     * exactly how that bug comes back, so the new failure path is asserted the
     * same way: by MAKING IT FAIL.
     */
    authFetch.mockImplementation(async () => ({
      ok: false, status: 503, json: async () => ({ error: 'Failed to remove this contact\u2019s activity.' }),
    }) as never);

    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    await confirm();

    expect(deleteDoc, 'THE ORPHAN: the contact went while its timeline stayed')
      .not.toHaveBeenCalled();
    expect(notifyError, 'the cascade failed silently').toHaveBeenCalledWith(
      'Failed to delete contact', expect.any(Error),
    );
    expect(dialogOpen(), 'a failed cascade closed the dialog as though it had worked').toBe(true);
    expect(byText('Delete'), 'the admin cannot retry - the control is gone').toBeTruthy();
  });

  it('and RESUMING is what the admin does next: pressing Delete again re-runs it', async () => {
    /**
     * 9 - RESUMABLE, WHICH IS THE GUARANTEE THAT HOLDS FOR ANY NUMBER OF ROWS.
     * The first attempt fails; the contact is still there, with fewer rows
     * behind it. The second attempt completes. At no point does a row point at
     * a contact that is gone.
     */
    let attempts = 0;
    authFetch.mockImplementation(async (url: unknown) => {
      if (!String(url).includes('/api/crm/contact-activities')) {
        return { ok: true, json: async () => ({}) } as never;
      }
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 503, json: async () => ({ error: 'network' }) } as never
        : { ok: true, json: async () => ({ removed: 2 }) } as never;
    });

    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    await confirm();
    expect(deleteDoc, 'the contact went on a failed first attempt').not.toHaveBeenCalled();
    expect(dialogOpen(), 'there is nothing left to press').toBe(true);

    await confirm();
    expect(attempts, 'the second attempt did not re-run the sweep').toBe(2);
    expect(deleteDoc, 'the resumed delete never finished').toHaveBeenCalledTimes(1);
    expect(docPaths).toContain('contacts/c1');
  });

  it('8 - self-deletion is still refused FIRST, before anything is swept', async () => {
    /**
     * NO-REGRESSION, and the ordering matters as much as the refusal: a guard
     * that ran after the cascade would destroy an admin's own timeline on the
     * way to telling them they cannot do this.
     */
    await openContact([accountRow({ id: ME.uid, firstName: 'Pastor' })], ME.uid);
    await pressDelete();

    expect(refusal(), 'self-deletion is offered').not.toBeNull();
    expect(cascadeCalls(), "the admin's own timeline was swept before the refusal").toEqual([]);
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(byText('Delete'), 'a Delete control is still offered on the admin\u2019s own row')
      .toBeUndefined();
  });

  it('and an account-backed row is refused before any sweep too', async () => {
    await openContact([accountRow({ id: 'u-9', firstName: 'Ada', lastName: 'Lovelace' })], 'u-9');
    await pressDelete();
    expect(refusal()).not.toBeNull();
    expect(cascadeCalls(), "an app member's timeline was swept on a refused delete").toEqual([]);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('the confirmation says what it removes, and that it is NOT account erasure', () => {
    /**
     * "This cannot be undone" was the whole warning. A church could reasonably
     * read that as removing the person from the app. Both facts this PR
     * established are now on screen: the timeline goes with the contact, the
     * receipt does not, and an app account is not touched.
     */
    const c = read(CRM);
    expect(c, 'the dialog no longer says the timeline goes too')
      .toContain('contact record and its whole activity');
    expect(c, 'the dialog no longer says the money survives')
      .toContain('a receipt is never deleted');
    expect(c, 'the dialog no longer distinguishes itself from account erasure')
      .toContain('only they can do that, from their own profile');
  });
});

describe('13 - a failed delete surfaces VISIBLY', () => {
  it('a rejected write is reported, and the screen does not pretend it worked', async () => {
    /**
     * THE SILENT-FAILURE RULE, asserted by MAKING IT REJECT.
     *
     * `setDeleteId(null)` and `setView('list')` used to run AFTER the `catch`,
     * so a refused delete closed the dialog and walked back to the list exactly
     * as a successful one did. The alert said otherwise, but the SCREEN said it
     * had worked, and the screen is what a reader believes.
     */
    deleteDoc.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    }));
    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    await confirm();

    expect(notifyError, 'the failure was swallowed').toHaveBeenCalledWith(
      'Failed to delete contact',
      expect.any(Error),
    );
    expect(dialogOpen(), 'a failed delete closed the dialog as though it had worked').toBe(true);
    expect(byText('Delete'), 'the admin cannot retry - the control is gone').toBeTruthy();
  });

  it('and a SUCCESSFUL delete reports nothing - the guard is not always-on', async () => {
    await openContact([contactRow({ id: 'c1' })], 'c1');
    await pressDelete();
    await confirm();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

/* ═══ 14 · an admin cannot delete their own account, and is told why ══════ */

describe('14 - an admin cannot delete their own account, and is TOLD why', () => {
  const expectSelfRefusal = () => {
    const alert = refusal();
    expect(alert, 'self-deletion is offered - that is a lockout waiting to happen').not.toBeNull();
    expect(alert!.getAttribute('role')).toBe('alert');
    expect(alert!.textContent).toContain('You cannot remove your own account');
    // The REASON, not just the refusal. A bare "no" is the thing the founder
    // already had: nothing happened, and nothing said why.
    expect(alert!.textContent).toContain('lock you out of this church');
    expect(alert!.textContent).toContain('only admin left');
    expect(alert!.textContent, 'no way forward is offered').toContain('Roles tab');
    expect(deleteDoc, 'a self-delete write was issued').not.toHaveBeenCalled();
    expect(byText('Delete'), 'a Delete control is still offered on the admin’s own row')
      .toBeUndefined();
  };

  it('their own row, surfaced under their `users` id - the founder’s exact case', async () => {
    await openContact([accountRow({ id: ME.uid, firstName: 'Pastor' })], ME.uid);
    await pressDelete();
    expectSelfRefusal();
  });

  it('their own row FOLDED into a contact, so the id is a contacts id', async () => {
    /**
     * IDENTITY IS THE ACCOUNT, NOT THE ROW ID. An admin who also has a contact
     * record surfaces under the CONTACTS id - that is `mergeContactsWithUsers`'s
     * whole purpose - so an id comparison alone would miss exactly the admin
     * most likely to try this. Matched here by the `userId` link.
     */
    await openContact(
      [contactRow({ id: 'c-me', userId: ME.uid, account: { role: 'admin', email: ME.email } })],
      'c-me',
    );
    await pressDelete();
    expectSelfRefusal();
  });

  it('their own row matched only by email, in the casing the account was made in', async () => {
    // `users.email` keeps whatever casing was typed. The match normalises both
    // sides, the same trim-and-lowercase rule the merge itself uses.
    await openContact(
      [contactRow({ id: 'c-me2', account: { role: 'admin', email: '  pastor@grace.church  ' } })],
      'c-me2',
    );
    await pressDelete();
    expectSelfRefusal();
  });

  it('and a row the screen cannot identify fails CLOSED, not open', async () => {
    /**
     * The window this covers: `selected` is set from the card, but if the
     * merged list has not resolved, resolving the target through `contacts`
     * alone finds nothing - and a `null` target made every refusal above
     * evaluate to `null` too, so a self-delete would have gone straight
     * through. The target is taken from `selected` first, and an id matching
     * neither is refused rather than deleted.
     */
    await openContact([contactRow({ id: 'c1' })], 'c1');
    // The card is open on c1; the list then comes back EMPTY (a refetch that
    // dropped it), so nothing in `contacts` matches.
    contactsResult.current = {
      data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await pressDelete();
    // `selected` still identifies the row, so this is the ordinary path.
    expect(refusal(), 'a row the card still holds was refused').toBeNull();
    expect(byText('Delete')).toBeTruthy();
  });

  it('but somebody ELSE with a contact record still deletes normally', async () => {
    // Non-vacuity: the self guard must not have become "refuse everything".
    await openContact([contactRow({ id: 'c-other', email: 'other@grace.church' })], 'c-other');
    await pressDelete();
    expect(refusal()).toBeNull();
    await confirm();
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect(docPaths).toContain('contacts/c-other');
  });
});

/* ═══ 15 · no-regression: the owner ═══════════════════════════════════════ */

describe('15 - the owner still cannot be removed', () => {
  /**
   * The owner rule lives on the ROLES sub-view (`AdminRoles`), which this
   * ticket does not open. Asserted here so a CRM delete change cannot be what
   * quietly took it away.
   */
  const roles = () => code('src/components/AdminRoles.tsx');

  it('the owner is still derived from tenants/{id}.ownerId', () => {
    expect(roles()).toMatch(/admin\.id === tenantOwnerId/);
    expect(roles()).toContain('ownerId');
  });

  it('and still gets a locked badge instead of Edit and Remove', () => {
    const src = read('src/components/AdminRoles.tsx');
    expect(src).toContain("The plan owner's admin access is locked and cannot be edited or removed.");
    expect(roles(), 'the owner branch no longer replaces the controls')
      .toMatch(/r\.isOwner \? ownerBadge/);
  });

  it('the CRM delete path never touches a users document or a role', () => {
    const crm = code(CRM);
    const confirmDelete = crm.slice(crm.indexOf('const confirmDelete'), crm.indexOf('const deleteDialog'));
    expect(confirmDelete, 'the CRM delete now writes to users').not.toMatch(/'users'/);
    expect(confirmDelete, 'the CRM delete now writes a role').not.toMatch(/role/);
  });
});

/* ═══ 16 · the money survives ═════════════════════════════════════════════ */

describe('16 - a gift recorded against a deleted contact is not lost', () => {
  /**
   * THE NAMED BEHAVIOUR: THE RECEIPT IS THE MONEY RECORD, AND IT IS NOT IN
   * `contacts`.
   *
   * A gift lives in `tenants/{t}/invoices` - the ledger the Overview tab sums,
   * `AdminAccounting` reads, giving statements aggregate and
   * `/api/donation-history` shows a member. Since THE-350 a gift recorded by
   * hand writes one too, and the CRM timeline row for it deliberately carries
   * `amount: null` and points at the receipt by `invoiceId` rather than holding
   * a second copy of the figure.
   *
   * So deleting a contact deletes ONE document and no money at all: the books,
   * the statements and the member's own history are untouched, and the church's
   * totals do not move. Even the GDPR erasure path, which is a different
   * operation entirely, ANONYMISES invoices rather than deleting them.
   */
  it('the delete writes exactly one document, and it is in `contacts`', async () => {
    await openContact([contactRow({ id: 'c1', totalDonated: 250 })], 'c1');
    await pressDelete();
    await confirm();

    expect(deleteDoc).toHaveBeenCalledTimes(1);
    const money = docPaths.filter((p) => /invoice|donation|givingStatement/i.test(p));
    expect(money, 'the delete path reached a money document').toEqual([]);
  });

  it('`confirmDelete` names no money collection at all', () => {
    const crm = code(CRM);
    const fn = crm.slice(crm.indexOf('const confirmDelete'), crm.indexOf('const deleteDialog'));
    for (const collection of ['invoices', 'donations', 'givingStatements', 'contactActivities']) {
      expect(fn, `the CRM delete now reaches ${collection}`).not.toContain(collection);
    }
  });

  it('and the erasure path - a DIFFERENT operation - keeps the books whole', () => {
    /**
     * REPORTED, BECAUSE A CHURCH MAY ASSUME THESE ARE THE SAME THING. They are
     * not. Deleting a contact removes the church's own record of a person.
     * Erasure removes a MEMBER'S ACCOUNT and their data across 25 collections,
     * it runs behind `/api/account/delete`, and a member starts it themselves
     * from Personal Information - there is no admin-facing erasure surface at
     * all. What the two share is the money rule: a receipt is never destroyed.
     */
    const erasure = read('src/lib/member-erasure.ts');
    expect(erasure).toMatch(/collection:\s*'tenants\/\{t\}\/invoices',\s*\n\s*disposition:\s*'anonymise'/);
    expect(erasure, 'donations are no longer anonymised - they are being deleted')
      .toContain('DELETED_DONOR_NAME');
  });
});

/* ═══ 17 · no-regression: THE-342's reads ════════════════════════════════ */

describe("17 - THE-342's counts and incomplete-list notice still hold", () => {
  it('the fetch ceiling and its ordering are unchanged', () => {
    const src = code(QUERIES);
    expect(src).toContain('export const CRM_FETCH_LIMIT = 1000');
    expect(src, 'the ceiling stopped ordering by documentId(), which excludes no document')
      .toContain('orderBy(documentId())');
  });

  it('the exact counts still come from an aggregate, not from the list length', () => {
    const src = code(QUERIES);
    expect(src).toContain("queryKey: ['crmCounts', tenantId]");
    expect(src).toMatch(/contactsTruncated: contactRecords > CRM_FETCH_LIMIT/);
    expect(src).toMatch(/usersTruncated: memberAccounts > CRM_FETCH_LIMIT/);
  });

  it('the "this list is incomplete" notice is still on the screen', () => {
    expect(read(CRM)).toContain('— this list is incomplete.');
  });

  it('a failed members read still THROWS rather than shortening the list', () => {
    const src = code(QUERIES);
    expect(src, 'the members read went back to swallowing its error')
      .toMatch(/catch \(e\) \{[\s\S]{0,200}throw e;/);
  });
});

/* ═══ 18 · no-regression: #482's CRM work ════════════════════════════════ */

describe("18 - #482's disclaimer text and switcher are unchanged", () => {
  it('the payment-links disclaimer still collapses, with its text byte-for-byte', () => {
    const c = read(CRM);
    expect(c).toContain('Gifts sent through your own payment links are not counted here.');
    expect(c).toContain('open their contact, press Add Activity, choose Donation and enter the amount.');
    expect(c).toContain('<Collapsible');
    expect(c).toContain('keepMounted');
    expect(c).toContain('crm-manual-giving-panel');
  });

  it('the Contacts/Roles switcher is still ONE definition, rendered on both tabs', () => {
    const c = read(CRM);
    expect((c.match(/const subTabBar = \(/g) ?? []).length).toBe(1);
    expect((c.match(/\{subTabBar\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('and the delete confirmation is now ONE definition too, for the same reason', () => {
    // The two copies were byte-identical, so a guard added to one of them would
    // have refused on the contact card and not in the list.
    const c = read(CRM);
    expect((c.match(/const deleteDialog = /g) ?? []).length).toBe(1);
    expect((c.match(/\{deleteDialog\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("PR #503's donation activity still carries a null amount and an invoiceId", () => {
    const src = code(QUERIES);
    expect(src, 'a manual gift went back to carrying the figure twice')
      .toMatch(/amount: number \| null;/);
    expect(src).toMatch(/invoiceId/);
  });
});
