import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact, ContactActivity } from '../../hooks/queries/useCRMQueries';

/**
 * THE-369 · 🔴 THE SCREEN A CHURCH ACTUALLY SEES BEFORE A RECEIPT IS DESTROYED.
 *
 * THE FOUNDER: "make sure that if i delete the activity, it is deleted from the
 * dashboard analytics donation as well."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 MOUNTED AND DRIVEN, NOT GREPPED
 *
 * THE-331's hole, recorded in THE-337's own header: its only claim about a new
 * menu was a SOURCE GREP, which was true of a menu that never opened. So every
 * claim here is made by clicking: the row menu is opened, the Delete item is
 * pressed, the dialog is READ OFF THE DOM, and `authFetch` is made to resolve or
 * to reject so that both outcomes are exercised rather than described.
 *
 * ⚠️ `authFetch` IS THE SEAM, and it is made to FAIL for section 3. A guard that
 * only ever saw a success would pass against a dialog that closes on every
 * answer — which is precisely #506's bug, one layer up.
 *
 * ⚠️ EVERY FIXTURE INSTANT IS FAR-FUTURE AND BUILT FROM PARTS (#468), and
 * nothing here is pinned to a line number (THE-331 pinned
 * `AdminCommunity.tsx:491`; a deletion moved it).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  navigate, authFetch, notifyError, invalidateQueries, contactsResult, activitiesResult, setDocSpy,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  activitiesResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  setDocSpy: vi.fn(async () => {}),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-uid', email: 'admin@grace.org' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantPlan: undefined }) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: setDocSpy,
  doc: (_db: unknown, coll: string, id: string) => ({ __path: `${coll}/${id}` }),
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 'grace-chapel', isAuthReady: true, isSuperAdmin: false }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useContactActivities: () => activitiesResult.current,
  useCRMCounts: () => ({ data: undefined }),
}));

/* ═══════════════════════════════════════════════════════════════════════════
 * Fixtures — far-future, assembled from parts
 * ═══════════════════════════════════════════════════════════════════════════ */

const TENANT = 'grace-chapel';
const YEAR = 2031;
const at = (month: number, day: number) => new Date(Date.UTC(YEAR, month - 1, day, 12, 0, 0)).toISOString();

const GIFT_CENTS = 25_000;      // $250.00
const GIFT_DOLLARS = 250;

const contact = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'Grace', lastName: 'Giver', email: 'grace.giver@example.org', phone: '',
  type: 'donor', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'admin-uid', updatedAt: null, tenantId: TENANT,
  ...over,
});

const activity = (over: Partial<ContactActivity> & { id: string }): ContactActivity => ({
  contactId: 'c1', type: 'note', description: 'Called about Sunday',
  amount: null, createdAt: at(3, 4), createdBy: 'admin-uid',
  ...over,
} as ContactActivity);

const GIFT_ROW = activity({
  id: 'act-gift', type: 'donation', description: 'Sunday offering, cash',
  amount: null, invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS, createdAt: at(4, 6),
});

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountCRM() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM currentUserRole="admin" currentUserPermissions={{ fullAccess: true } as never} />,
    );
  });
  await flush();
}

/** Open the contact card by clicking its list row — the real way in. */
async function openContact(name: string) {
  const row = [...container.querySelectorAll('tbody tr')]
    .find((tr) => tr.querySelector('p.text-sm.font-semibold')?.textContent?.trim() === name);
  expect(row, `no list row named ${name}`).toBeTruthy();
  await act(async () => { (row as HTMLElement).click(); });
  await flush();
}

/**
 * Press the Delete item on one timeline row's menu.
 *
 * 🔴 BOTH STEPS ARE REAL CLICKS. Base UI renders the menu content only once the
 * trigger has been pressed, so a test that reached straight for the item would
 * be asserting about an element the church can never get to.
 */
async function openRowMenuAndDelete(activityId: string) {
  const trigger = container.querySelector(`[data-activity-menu="${activityId}"]`);
  expect(trigger, `no row menu for ${activityId}`).toBeTruthy();
  await act(async () => { (trigger as HTMLElement).click(); });
  await flush();
  const item = document.querySelector(`[data-activity-delete="${activityId}"]`);
  expect(item, `the menu for ${activityId} opened no Delete item`).toBeTruthy();
  await act(async () => { (item as HTMLElement).click(); });
  await flush();
}

const dialog = () => document.querySelector('[data-testid="crm-confirm-delete-activity"]')
  ?.closest('div.bg-surface-raised') as HTMLElement | null;
const dialogText = () => dialog()?.textContent ?? '';
const confirmButton = () =>
  document.querySelector('[data-testid="crm-confirm-delete-activity"]') as HTMLButtonElement | null;
const errorBanner = () => document.querySelector('[data-activity-delete-error]');
const timelineRows = () =>
  [...container.querySelectorAll('[data-activity-menu]')].map((e) => e.getAttribute('data-activity-menu'));

async function pressDelete() {
  const btn = confirmButton();
  expect(btn, 'the dialog offers no Delete button').toBeTruthy();
  await act(async () => { btn!.click(); });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  contactsResult.current = {
    data: [contact({ id: 'c1', totalDonated: GIFT_DOLLARS })],
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  };
  activitiesResult.current = {
    data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
  };
  // The Gmail status probe the screen fires on mount; every other call is
  // overridden per test.
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ connected: false }) });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
  document.body.innerHTML = '';
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1-2 · A ROW CAN BE DELETED, AND ONLY THAT ROW
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · a note, call, meeting or email activity can be deleted from the timeline', () => {
  for (const [type, noun] of [
    ['note', 'note'], ['call', 'call'], ['meeting', 'meeting'], ['email', 'email'],
  ] as const) {
    it(`🔴 a ${type} offers a Delete that names it a ${noun}`, async () => {
      activitiesResult.current = {
        data: [activity({ id: 'a1', type, description: `A ${type}` })],
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
      await mountCRM();
      await openContact('Grace Giver');

      const trigger = container.querySelector('[data-activity-menu="a1"]');
      expect(trigger, `a ${type} row has no menu`).toBeTruthy();
      // The control names the thing it acts on, derived from the row's type.
      expect(trigger!.getAttribute('aria-label')).toBe(`Options for this ${noun}`);

      await openRowMenuAndDelete('a1');
      expect(dialogText(), `the ${type} dialog does not name it`).toContain(`Delete this ${noun}?`);
    });
  }

  it('🔴 confirming calls the single-activity route with the contact’s own tenant', async () => {
    activitiesResult.current = {
      data: [activity({ id: 'a1' })], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: false, amountCents: null }) }
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('a1');
    await pressDelete();

    const call = authFetch.mock.calls.find(([u]) => String(u).includes('/contact-activities/a1'));
    expect(call, 'the delete never reached the route').toBeTruthy();
    expect(String(call![0])).toContain(`tenantId=${TENANT}`);
    expect((call![1] as { method?: string }).method).toBe('DELETE');
    // 🔴 THE COLLECTION ROUTE IS NOT TOUCHED. A single delete that reached the
    // cascade endpoint would empty the whole timeline.
    expect(String(call![0]), 'the single delete hit the cascade endpoint')
      .not.toContain('?contactId=');
  });

  it('🔴 a non-donation delete moves no total — `totalDonated` is not written', async () => {
    activitiesResult.current = {
      data: [activity({ id: 'a1', type: 'call' })], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: false, amountCents: null }) }
        : { ok: true, json: async () => ({ connected: false }) });
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('a1');
    await pressDelete();
    expect(setDocSpy, 'deleting a call rewrote the contact').not.toHaveBeenCalled();
  });
});

describe('2 · the row disappears, and only that row', () => {
  it('🔴 the timeline refetches the one contact’s activities, and nothing else', async () => {
    activitiesResult.current = {
      data: [activity({ id: 'a1' }), activity({ id: 'a2', type: 'call' }), activity({ id: 'a3', type: 'meeting' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: false, amountCents: null }) }
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    expect(timelineRows()).toEqual(['a1', 'a2', 'a3']);

    await openRowMenuAndDelete('a2');
    await pressDelete();

    // The route was asked for a2 and for nothing else.
    const deletes = authFetch.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/api/crm/contact-activities/'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/contact-activities/a2?');

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['contactActivities', TENANT, 'c1'],
    });

    // And the two survivors are still drawn — the screen removed nothing itself.
    expect(timelineRows()).toEqual(['a1', 'a2', 'a3']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 · A FAILED DELETE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · a failed delete surfaces VISIBLY and does NOT remove the row', () => {
  /** Each way a delete can fail, made to happen rather than described. */
  const FAILURES = [
    ['the route refuses it', async () => ({
      ok: false, status: 409,
      json: async () => ({ error: 'This gift paid for an event ticket that somebody is holding.', code: 'event_ticket' }),
    })],
    ['the route 500s', async () => ({
      ok: false, status: 500, json: async () => ({ error: 'This activity could not be removed. Nothing was deleted.' }),
    })],
    ['the request itself rejects', async () => { throw new Error('NetworkError: failed to fetch'); }],
  ] as const;

  it.each(FAILURES)('🔴 when %s the dialog STAYS OPEN with the reason in it', async (_label, impl) => {
    activitiesResult.current = {
      data: [GIFT_ROW, activity({ id: 'a2' })], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? (impl as () => Promise<unknown>)()
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    await pressDelete();

    // 🔴 #506's BUG, WHICH THIS IS THE FIX FOR ONE LAYER DOWN: the dialog closed
    // and returned to the list on failure as if it had succeeded.
    expect(dialog(), 'the dialog closed on a failed delete').toBeTruthy();
    expect(errorBanner(), 'the failure is not on screen').toBeTruthy();
    expect(errorBanner()!.textContent, 'the banner says nothing about what failed')
      .toContain('This activity was not deleted');
    // 🔴 ANNOUNCED, NOT MERELY DRAWN, and asserted on the BANNER ITSELF rather
    // than on "some element in the dialog carries role=alert" — the refusal
    // Alert is also in this subtree, so a looser query would report a failure as
    // announced when only the other one was.
    expect(errorBanner()!.getAttribute('role'),
      'the failure banner is not the `alert` primitive \u2014 a screen reader is never told')
      .toBe('alert');

    /**
     * 🔴 AND THE TIMELINE IS NOT REFETCHED, WHICH IS WHAT ACTUALLY REMOVES A ROW.
     *
     * ⚠️ ASSERTED ON THE INVALIDATION, NOT ON THE DOM, AND THAT IS THE ONLY
     * HONEST PLACE FOR IT. This suite feeds the timeline from a stubbed
     * `useContactActivities`, so the rows on screen cannot change no matter what
     * the component does — "the row is still there" would pass against a
     * component that had already dropped it. What the component DOES control is
     * whether it invalidates `['contactActivities', …]`, and in production that
     * invalidation is the one and only thing that takes the row off the screen.
     * Moving it out of the `try`, or above the `throw`, is exactly #506's bug —
     * and it fails here.
     */
    const invalidatedActivities = (invalidateQueries.mock.calls as unknown as unknown[][])
      .map((args) => args[0] as { queryKey?: unknown[] } | undefined)
      .filter((arg) => Array.isArray(arg?.queryKey) && arg!.queryKey![0] === 'contactActivities');
    expect(invalidatedActivities,
      'a failed delete refetched the timeline \u2014 the row leaves the screen anyway').toEqual([]);
    // Nothing else was invalidated either: the contact list is untouched too.
    expect(invalidateQueries, 'a failed delete still refreshed the screen').not.toHaveBeenCalled();
    expect(timelineRows()).toContain('act-gift');
    expect(notifyError, 'the failure never reached the shared error path').toHaveBeenCalled();
    // Nothing was written in the contact either.
    expect(setDocSpy, 'a failed delete still moved the running total').not.toHaveBeenCalled();
  });

  it('🔴 the route’s own refusal wording is what the church reads', async () => {
    const refusal = 'This gift paid for an event ticket that somebody is holding.';
    activitiesResult.current = {
      data: [GIFT_ROW], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: false, status: 409, json: async () => ({ error: refusal, code: 'event_ticket' }) }
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    await pressDelete();

    // The rule lives on the server, where the receipt can be read; the screen
    // renders what it is told rather than keeping a second copy of the rule.
    expect(errorBanner()!.textContent).toContain(refusal);
  });

  it('🔴 a successful delete DOES close the dialog — so the test above is not vacuous', async () => {
    activitiesResult.current = {
      data: [activity({ id: 'a1' })], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: false, amountCents: null }) }
        : { ok: true, json: async () => ({ connected: false }) });
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('a1');
    await pressDelete();
    expect(dialog(), 'a successful delete left the dialog open').toBeFalsy();
    expect(errorBanner()).toBeFalsy();
    // 🔴 AND IT DOES REFETCH, so "a failure does not" above is a real contrast
    // rather than an assertion about a call nothing ever makes.
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['contactActivities', TENANT, 'c1'],
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5d · NO INVOICE IS EVER DELETED SILENTLY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5d · no invoice is ever deleted SILENTLY', () => {
  beforeEach(() => {
    activitiesResult.current = {
      data: [GIFT_ROW], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
  });

  it('🔴 the confirmation NAMES THE AMOUNT, in the heading and in the body', async () => {
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');

    const text = dialogText();
    // $250.00 — the ledger's cents through `formatCents`, never the dollar
    // formatter. Reading cents with the dollar formatter is AdminAccounting's
    // own $10,550,000 bug, and doing it above a Delete button would be that bug
    // with a church's approval underneath it.
    expect(text, 'the confirmation does not name the amount').toContain('$250.00');
    expect(text, 'the heading does not name the gift').toContain('Delete this $250.00 gift?');
    expect((text.match(/\$250\.00/g) ?? []).length, 'the amount is stated only once')
      .toBeGreaterThanOrEqual(2);
  });

  it('🔴 it says the RECEIPT goes, not just the row', async () => {
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    const text = dialogText();
    expect(text).toContain('This removes the receipt for $250.00 from your books');
    expect(text, 'the copy lets a church think only the timeline changes')
      .toContain('not only this row on the timeline');
  });

  it('🔴 it names ACCOUNTING and the member’s GIVING STATEMENT by name', async () => {
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    const text = dialogText();
    for (const claim of [
      'dashboard giving figure',
      'accounting totals',
      'giving history',
      'giving statement',
      'receipt number is not reused',
    ]) {
      expect(text, `the confirmation never mentions ${claim}`).toContain(claim);
    }
    // "This cannot be undone" is present AND is not the whole warning — #506
    // established that standard on the contact dialog one layer up.
    expect(text).toContain('This cannot be undone');
    expect(text.length, 'the warning is one sentence long').toBeGreaterThan(300);
  });

  it('🔴 a NON-donation row gets none of that copy — it would be a false claim', async () => {
    activitiesResult.current = {
      data: [activity({ id: 'a1', type: 'note' })], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('a1');
    const text = dialogText();
    expect(text).not.toContain('receipt');
    expect(text, 'a note is not said to leave accounting alone')
      .toContain('your accounting totals and giving statements do not change');
  });

  it(
    '🔴 a gift whose amount cannot be read offers NO DELETE BUTTON AT ALL '
    + '— a confirmation that cannot state what it is about must not carry one',
    async () => {
      activitiesResult.current = {
        data: [activity({
          id: 'a1', type: 'donation', description: 'Sunday offering',
          invoiceId: 'inv1', invoiceAmountCents: undefined,
        } as Partial<ContactActivity> & { id: string })],
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
      await mountCRM();
      await openContact('Grace Giver');
      await openRowMenuAndDelete('a1');

      expect(document.querySelector('[data-activity-delete-refused]'),
        'a receipt with no readable amount was still offered for deletion').toBeTruthy();
      expect(confirmButton(), 'the refusal still carried a Delete button').toBeFalsy();
      expect(document.querySelector('[data-activity-delete-refused]')!.textContent)
        .toContain('Nothing has been deleted');
    },
  );

  it('🔴 and the delete cannot be issued from that state even if the markup were bypassed', async () => {
    activitiesResult.current = {
      data: [activity({
        id: 'a1', type: 'donation', invoiceId: 'inv1', invoiceAmountCents: undefined,
      } as Partial<ContactActivity> & { id: string })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('a1');
    // The guard is in the handler as well as in the markup — THE-362's rule.
    const before = authFetch.mock.calls.length;
    const closeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close');
    expect(closeBtn, 'the refusal offers no way out').toBeTruthy();
    await act(async () => { closeBtn!.click(); });
    await flush();
    expect(authFetch.mock.calls.length, 'a refusal issued a request').toBe(before);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * totalDonated
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5f · the contact’s running total comes back down, by exactly the gift', () => {
  it('🔴 decremented on the CLIENT, where `addActivity` bumps it — never from a route', async () => {
    activitiesResult.current = {
      data: [GIFT_ROW], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: true, amountCents: GIFT_CENTS }) }
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    await pressDelete();

    expect(setDocSpy, 'the running total was not corrected').toHaveBeenCalled();
    const payload = (setDocSpy.mock.calls.at(-1) as unknown as unknown[])[1] as Record<string, unknown>;
    // $250 given, $250 deleted, $0 left — in DOLLARS, the unit this field holds.
    expect(payload.totalDonated, 'the total did not fall by the gift').toBe(0);
    // 🔴 `lastDonationAt` IS NOT REWOUND. Answering "when did they last give"
    // after a deletion needs the whole timeline, and a guessed date would be a
    // new false fact where a stale one is only a display fact.
    expect(payload).not.toHaveProperty('lastDonationAt');
  });

  it('🔴 and NOT when the ledger kept the money', async () => {
    activitiesResult.current = {
      data: [GIFT_ROW], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        // The pointer's target was already gone: the row goes, the books do not move.
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: false, amountCents: null }) }
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    await pressDelete();
    expect(setDocSpy, 'the total fell for a gift the ledger never lost').not.toHaveBeenCalled();
  });

  it(
    '🔴 A FAILED TOTAL CORRECTION IS NOT REPORTED AS A FAILED DELETE '
    + '\u2014 by then the row and its receipt are already gone',
    async () => {
      /**
       * 🔴 THE DANGEROUS DIRECTION OF FALSE. The route has returned 200 and the
       * delete was atomic, so saying "this activity could not be removed" would
       * send a church to press Delete again and be told it cannot be found. What
       * is actually wrong is ONE derived display figure; the ledger, the
       * dashboard and the books are already correct.
       */
      activitiesResult.current = {
        data: [GIFT_ROW], isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
      setDocSpy.mockRejectedValueOnce(new Error('PERMISSION_DENIED'));
      authFetch.mockImplementation(async (url: string) =>
        url.startsWith('/api/crm/contact-activities/')
          ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: true, amountCents: GIFT_CENTS }) }
          : { ok: true, json: async () => ({ connected: false }) });

      await mountCRM();
      await openContact('Grace Giver');
      await openRowMenuAndDelete('act-gift');
      await pressDelete();

      // The delete SUCCEEDED, so the dialog closes and no failure banner claims
      // otherwise — and the timeline is refetched, because the row really went.
      expect(dialog(), 'a successful delete was reported as a failure').toBeFalsy();
      expect(errorBanner(), 'a bookkeeping slip was drawn as a failed delete').toBeFalsy();
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['contactActivities', TENANT, 'c1'],
      });

      // And the real problem is reported, as itself.
      expect(notifyError, 'the failed total correction was swallowed').toHaveBeenCalled();
      const said = notifyError.mock.calls.map(([m]) => String(m)).join(' | ');
      expect(said, 'the message claims the delete failed').not.toContain('Failed to delete activity');
      expect(said, 'the message does not say the gift WAS deleted')
        .toContain('The gift was deleted');
    },
  );

  it('🔴 a total is floored at zero rather than driven negative', async () => {
    contactsResult.current = {
      data: [contact({ id: 'c1', totalDonated: 10 })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    activitiesResult.current = {
      data: [GIFT_ROW], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    authFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/crm/contact-activities/')
        ? { ok: true, json: async () => ({ removed: 1, invoiceRemoved: true, amountCents: GIFT_CENTS }) }
        : { ok: true, json: async () => ({ connected: false }) });

    await mountCRM();
    await openContact('Grace Giver');
    await openRowMenuAndDelete('act-gift');
    await pressDelete();
    const payload = (setDocSpy.mock.calls.at(-1) as unknown as unknown[])[1] as Record<string, unknown>;
    expect(payload.totalDonated).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12-13 · NO-REGRESSION, AS RENDERED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('12-13 · #512’s link and #482’s work still render', () => {
  it('🔴 the Add Activity → Donation branch still carries exactly one GivingDocsLink', async () => {
    await mountCRM();
    await openContact('Grace Giver');
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Activity'));
    expect(add, 'the Add Activity control is gone').toBeTruthy();
    await act(async () => { (add as HTMLElement).click(); });
    await flush();

    const donationPill = [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.trim().toLowerCase() === 'donation');
    expect(donationPill, 'the Donation type is gone from Add Activity').toBeTruthy();
    await act(async () => { (donationPill as HTMLElement).click(); });
    await flush();

    const links = [...container.querySelectorAll('a[target="_blank"]')]
      .filter((a) => /recording a gift/i.test(a.textContent ?? ''));
    expect(links, 'the docs link left the donation branch, or gained a twin').toHaveLength(1);
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });

  it('🔴 the Contacts/Roles switcher is still one control, on the screen', async () => {
    await mountCRM();
    const pills = [...container.querySelectorAll('button')]
      .filter((b) => ['Contacts', 'Roles'].includes(b.textContent?.trim() ?? ''));
    expect(pills.length, 'the switcher was duplicated or lost').toBe(2);
    for (const p of pills) expect(p.className).toContain('min-h-11');
  });
});
