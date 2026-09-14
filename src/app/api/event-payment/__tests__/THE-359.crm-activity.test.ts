import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-359 · 🔴 A CONFIRMED EVENT PAYMENT NOW APPEARS IN THE CRM — AND IS NOT
 * COUNTED TWICE.
 *
 * THE FOUNDER: "in crm it doesnt show that i have paid for an event after i
 * confirmed but it appears in the accounting. it should appear in the crm as an
 * activity that i paid for the event and the amount as donation activity."
 *
 * Tests 11-15 of the ticket, driven through the REAL route handler with the
 * Admin SDK and THE-350's writer mocked at their module boundaries — so what is
 * asserted is the handler's own behaviour and not a paraphrase of it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE SHAPE THIS SUITE EXISTS TO PIN, AND WHY IT IS THE SHAPE
 *
 * THE-350 settled the relationship between the two records and it must hold:
 *
 *   · The INVOICE is the money. It is written by `recordManualDonation` and by
 *     nothing else, so the dashboard figure, `AdminAccounting`, the year-end
 *     statement and the member's own giving history all count it once.
 *   · The ACTIVITY carries `amount: null` plus `invoiceId`, with
 *     `invoiceAmountCents` as a display mirror under a name nothing in this
 *     repository sums.
 *
 * An activity carrying a real `amount` would be picked up by every reader that
 * sums `contactActivities.amount` — the field the Stripe donation webhook
 * writes, in DOLLARS — and `totalDonated` would double. That is a false
 * financial record, which is the same class of defect as a double invoice.
 *
 * ⚠️ `recordManualDonation` IS MOCKED, NOT REIMPLEMENTED, for THE-351's reason:
 * the claim under test is "this route calls THE-350's writer and writes no
 * second money record", and the way to assert that is to watch the writer being
 * called and to watch every other write NOT being an invoice.
 *
 * ⚠️ EVERY FIXTURE INSTANT IS FAR-FUTURE AND BUILT FROM PARTS. #468 turned
 * `main` red with a date pinned near the run date.
 */

const { mockRecordManualDonation } = vi.hoisted(() => ({ mockRecordManualDonation: vi.fn() }));
const { mockRequireTenantPermission } = vi.hoisted(() => ({ mockRequireTenantPermission: vi.fn() }));

/** Every write, by collection path, plus every query the route runs. */
const { writes, regDoc, contactRows, queries, activityAddThrows } = vi.hoisted(() => ({
  writes: { current: [] as { path: string; payload: Record<string, unknown> }[] },
  regDoc: { current: {} as Record<string, unknown> | null },
  contactRows: { current: [] as Array<{ id: string; data: Record<string, unknown> }> },
  activityAddThrows: { current: false },
  queries: { current: [] as Array<{ path: string; field: string; value: unknown }> },
}));

function makeDocRef(path: string): any {
  return {
    __path: path,
    get: async () => ({
      exists: true,
      data: () => (path.includes('/events/') ? { title: 'Crusade Bangladesh' } : regDoc.current),
    }),
    update: async (payload: Record<string, unknown>) => {
      writes.current.push({ path, payload });
      // 🔴 PHASE 3b STAMPS THE INVOICE ID THROUGH `ref.update`, NOT THE
      // TRANSACTION, and that stamp is the permanent idempotence guard — the
      // lock only narrows the race window. A harness whose registration never
      // changes cannot express "the second press finds what the first one
      // wrote", so test 14 would pass against a route with no guard at all.
      if (path.endsWith('/registrations/reg1') && regDoc.current) {
        regDoc.current = { ...regDoc.current, ...payload };
      }
    },
    set: async (payload: Record<string, unknown>) => { writes.current.push({ path, payload }); },
    collection: (name: string) => makeCollRef(`${path}/${name}`),
  };
}
function makeCollRef(path: string): any {
  const coll: any = {
    __path: path,
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (payload: Record<string, unknown>) => {
      if (path === 'contactActivities' && activityAddThrows.current) {
        throw new Error('contactActivities unavailable');
      }
      writes.current.push({ path, payload });
      return { id: `${path}-written` };
    },
  };
  coll.where = (field: string, _op: string, value: unknown) => {
    queries.current.push({ path, field, value });
    return coll;
  };
  coll.limit = () => coll;
  coll.orderBy = () => coll;
  coll.get = async () => ({
    docs: path === 'contacts'
      ? contactRows.current.map((r) => ({ id: r.id, data: () => r.data }))
      : [],
  });
  return coll;
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeCollRef(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async (ref: { __path: string }) => ({
        exists: regDoc.current !== null,
        data: () => regDoc.current,
        __path: ref.__path,
      }),
      update: (ref: { __path: string }, payload: Record<string, unknown>) => {
        writes.current.push({ path: ref.__path, payload });
        // 🔴 THE LOCK IS REAL IN THIS HARNESS. Phase 1 writes
        // `paymentConfirmStartedAt` onto the registration and phase 3b stamps
        // the invoice id onto it; a harness whose registration never changes
        // cannot express "the second press sees what the first one did", which
        // is the whole of test 14.
        regDoc.current = { ...(regDoc.current ?? {}), ...payload };
      },
    }),
  },
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '__DELETE__', serverTimestamp: () => '__NOW__' },
}));
vi.mock('@/lib/manual-donation', () => ({
  recordManualDonation: mockRecordManualDonation,
  MANUAL_DONATION_SOURCES: ['crm_manual', 'event_manual'],
}));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: mockRequireTenantPermission }));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: vi.fn(),
  captureHandledError: vi.fn(),
}));

const { POST } = await import('../confirm/route');

const post = (body: unknown) =>
  POST(new NextRequest('https://kingdom-living.theharvest.app/api/event-payment/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  }));

const CALL = { tenantId: 'kingdom-living', registrationId: 'reg1' };

/** Every `contactActivities` document the route wrote. */
const activities = () =>
  writes.current.filter((w) => w.path === 'contactActivities').map((w) => w.payload);
/** Anything at all written into a collection whose name mentions invoices. */
const invoiceWrites = () => writes.current.filter((w) => /invoice/i.test(w.path));
/**
 * Every write that lands anywhere under `contacts`.
 *
 * ⚠️ `startsWith`, NOT EQUALITY, AND MUTATION IS WHY. The first version of this
 * helper compared `w.path === 'contacts'`, which catches an `add()` to the
 * collection and MISSES a `doc(id).set()`, whose path is `contacts/<id>`. A
 * planted server-side `totalDonated` bump — written exactly that way — walked
 * straight through it.
 */
const contactWrites = () => writes.current.filter((w) => w.path.split('/')[0] === 'contacts');

beforeEach(() => {
  vi.clearAllMocks();
  writes.current = [];
  queries.current = [];
  regDoc.current = {
    name: 'Dana Okafor',
    email: 'dana@example.com',
    amount: 5000,
    eventId: 'ev1',
    paymentStatus: 'unpaid',
    paymentReference: 'HV-263J8N',
    paymentClaimedAt: '2031-09-05T10:00:00.000Z',
    paymentClaimPendingAt: '2031-09-05T10:00:00.000Z',
  };
  contactRows.current = [
    { id: 'contact1', data: { email: 'dana@example.com', tenantId: 'kingdom-living', firstName: 'Dana' } },
  ];
  mockRequireTenantPermission.mockResolvedValue({ uid: 'admin-uid', email: 'pastor@kingdom.example' });
  mockRecordManualDonation.mockResolvedValue({
    ok: true, invoiceId: 'inv1', receiptNumber: 'R-1-ABCDEF',
    recipientEmail: 'dana@example.com', visibleToMember: true,
    issuedAt: '2031-09-07T09:00:00.000Z',
  });
});

/* ═══ 11 · confirming writes a DONATION activity, naming the event ════════ */

describe('11 · confirming writes a DONATION activity on the contact', () => {
  it('🔴 one activity, of type donation, on the contact matched by email', async () => {
    const res = await post(CALL);
    expect(res.status, 'the confirmation itself failed').toBe(200);

    const acts = activities();
    expect(acts.length, '🔴 CONFIRMING WROTE NO CRM ACTIVITY — the founder’s complaint')
      .toBe(1);
    expect(acts[0].type, 'the activity is not a donation').toBe('donation');
    expect(acts[0].contactId, 'the activity landed on no contact').toBe('contact1');
    // The contact's OWN concrete tenantId — a null or mismatched one is why an
    // activity can write and never appear in the timeline.
    expect(acts[0].tenantId).toBe('kingdom-living');
    expect(acts[0].createdBy, 'the activity does not record who vouched').toBe('admin-uid');
    expect(acts[0].createdAt).toBe('__NOW__');
  });

  it('🔴 the description NAMES THE EVENT', async () => {
    await post(CALL);
    expect(activities()[0].description, 'the timeline row does not say which event this was')
      .toBe('Event ticket — Crusade Bangladesh');
    // The same description the invoice carries, so the timeline row and the
    // giving statement say the same thing about the same gift.
    expect(mockRecordManualDonation.mock.calls[0][0].description)
      .toBe('Event ticket — Crusade Bangladesh');
  });

  it('🔴 it is matched by EMAIL, within the tenant', async () => {
    await post(CALL);
    const q = queries.current.find((x) => x.path === 'contacts');
    expect(q, 'no contact lookup ran at all').toBeTruthy();
    expect(q!.field, 'the contact is looked up by something other than email').toBe('email');
    expect(q!.value).toBe('dana@example.com');
    // ⚠️ A SINGLE-FIELD QUERY, TENANT FILTERED IN MEMORY. An equality `where` on
    // a second field would be a COMPOSITE index, and `firestore.indexes.json`
    // is not deployed by `deploy-rules.yml` — the query would throw
    // `failed-precondition` in production and pass in every test.
    expect(queries.current.filter((x) => x.path === 'contacts').length,
      'the contact lookup composites two fields and needs an index that is never deployed')
      .toBe(1);
  });

  it('🔴 a contact at ANOTHER tenant is never written to', async () => {
    contactRows.current = [
      { id: 'other-tenant-contact', data: { email: 'dana@example.com', tenantId: 'grace' } },
    ];
    await post(CALL);
    expect(activities(), '🔴 an activity landed on another tenant’s contact').toEqual([]);
  });

  it('🔵 a registrant with NO contact record gets no activity, and no contact is minted', async () => {
    /**
     * A PUBLIC REGISTRANT MAY NOT BE IN THE CRM AT ALL — a crusade is mostly
     * people with no account and no contact row. Reported rather than guessed:
     * this route SKIPS. Minting a contact as a side effect of a ticket
     * confirmation would populate the CRM from the public event form and spend
     * the tenant's `maxContacts` capacity without anybody asking, which is a CRM
     * data-model decision and not this route's to take. The invoice still
     * records the money, so nothing about the gift is lost.
     */
    contactRows.current = [];
    const res = await post(CALL);
    expect(res.status, 'a missing contact failed the confirmation').toBe(200);
    expect(activities()).toEqual([]);
    expect(contactWrites(),
      '🔴 a contact was created as a side effect of confirming a ticket').toEqual([]);
    // 🔴 AND THE MONEY WAS STILL RECORDED.
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);
    expect((await res.json()).invoiceId).toBe('inv1');
  });

  it('🔵 a registration with no email is not looked up at all', async () => {
    regDoc.current = { ...(regDoc.current as Record<string, unknown>), email: null };
    const res = await post(CALL);
    expect(res.status).toBe(200);
    expect(queries.current.filter((x) => x.path === 'contacts'),
      'an empty-string email was queried, which would match every contact with no email')
      .toEqual([]);
    expect(activities()).toEqual([]);
  });
});

/* ═══ 12 · the activity carries amount: null and an invoiceId ═════════════ */

describe('12 · the activity carries THE-350’s shape exactly', () => {
  it('🔴 amount: null, the invoice id, and the amount only as a display mirror', async () => {
    await post(CALL);
    const a = activities()[0];

    // 🔴 THE FIELD EVERY MONEY READER SUMS IS NULL, and it is PRESENT-and-null
    // rather than absent: a reader doing `?? 0` on a missing key and a reader
    // doing it on an explicit null behave the same, but the explicit null is
    // the record that this was decided.
    expect('amount' in a, 'the activity omits `amount` rather than nulling it').toBe(true);
    expect(a.amount, '🔴 THE ACTIVITY CARRIES A REAL AMOUNT — the gift is counted twice')
      .toBeNull();

    // 🔴 IT POINTS AT THE MONEY RATHER THAN COPYING IT.
    expect(a.invoiceId, 'the activity does not reference the invoice').toBe('inv1');

    // ⚠️ THE DISPLAY MIRROR: cents, keyed to the invoice, under a name nothing
    // in this repository sums.
    expect(a.invoiceAmountCents, 'the timeline has no figure to render').toBe(5000);
  });

  it('🔴 the mirror is in CENTS and matches the invoice, to the penny', async () => {
    regDoc.current = { ...(regDoc.current as Record<string, unknown>), amount: 12345 };
    await post(CALL);
    expect(mockRecordManualDonation.mock.calls[0][0].amountCents).toBe(12345);
    expect(activities()[0].invoiceAmountCents,
      'the display mirror and the invoice disagree about the amount').toBe(12345);
    // Not dollars. 123.45 here would render as $1.23 through `formatCents`.
    expect(activities()[0].invoiceAmountCents).not.toBe(123.45);
  });
});

/* ═══ 13 · the gift is NOT counted twice ══════════════════════════════════ */

describe('13 · one gift, one money record', () => {
  it('🔴 exactly one invoice, written by THE-350’s writer, and none by this route', async () => {
    await post(CALL);
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);
    expect(invoiceWrites(),
      '🔴 THIS ROUTE WROTE ITS OWN INVOICE — a second money writer').toEqual([]);
  });

  it('🔴 summing contactActivities.amount over this gift yields ZERO', async () => {
    /**
     * 🔴 THE DOUBLE-COUNT, EXPRESSED AS THE ARITHMETIC A READER ACTUALLY DOES.
     * The Stripe donation webhook writes `contactActivities.amount` in DOLLARS,
     * so any reader summing that field is summing money. This route's row must
     * contribute nothing to that sum, because its money is already on the
     * invoice.
     */
    await post(CALL);
    const summed = activities().reduce((n, a) => n + (typeof a.amount === 'number' ? a.amount : 0), 0);
    expect(summed, '🔴 THE GIFT IS COUNTED TWICE — once on the invoice and once on the activity')
      .toBe(0);

    // And the total a church would actually see is the invoice's, once.
    const invoiceTotal = mockRecordManualDonation.mock.calls
      .reduce((n, [args]) => n + (args as { amountCents: number }).amountCents, 0);
    expect(invoiceTotal).toBe(5000);
    expect(invoiceTotal + summed * 100, 'the two records add up to more than the gift').toBe(5000);
  });

  it('🔴 and the contact’s own running total is not touched from here', async () => {
    /**
     * 🔵 REPORTED, NOT ASSUMED. `totalDonated` is a client-maintained running
     * total: `AdminCRM` writes it from a read-modify-write of a value it already
     * holds. A server-side bump from this route would race that write and could
     * lose one of them. The founder asked for an ACTIVITY, not a total, and the
     * invoice — which every giving figure already reads — carries the money.
     */
    await post(CALL);
    expect(contactWrites(),
      '🔴 the confirm route now writes the contact document — a lost-update race with '
      + "AdminCRM's own read-modify-write of the same field")
      .toEqual([]);
    for (const a of activities()) {
      expect(a, 'the activity carries a totalDonated of its own').not.toHaveProperty('totalDonated');
    }
  });
});

/* ═══ 14 · confirming twice produces ONE invoice and ONE activity ═════════ */

describe('14 · confirming is idempotent, in both records', () => {
  it('🔴 two presses: one invoice, one activity', async () => {
    const first = await post(CALL);
    expect(first.status).toBe(200);
    expect((await first.json()).ok).toBe(true);

    const second = await post(CALL);
    const body = await second.json();
    // The second press is TOLD what the first one did rather than refused.
    expect(body.alreadyConfirmed, 'the second press was not recognised as a repeat').toBe(true);
    expect(body.invoiceId).toBe('inv1');

    expect(mockRecordManualDonation, '🔴 A DOUBLE INVOICE — a false financial record')
      .toHaveBeenCalledTimes(1);
    expect(activities().length, '🔴 A DOUBLE CRM ACTIVITY — the gift appears twice on the timeline')
      .toBe(1);
  });

  it('🔴 four presses change nothing further', async () => {
    for (let i = 0; i < 4; i++) await post(CALL);
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);
    expect(activities().length).toBe(1);
  });

  it('🔴 a FAILED confirm writes NO activity and does NOT mark the ticket paid', async () => {
    mockRecordManualDonation.mockResolvedValue({ ok: false, error: 'refused', code: 'AMOUNT' });
    const res = await post(CALL);
    expect(res.status, 'a failed confirmation reported success').toBe(500);
    expect((await res.json()).error).toBe('refused');
    expect(activities(),
      '🔴 an activity was written for a gift that was never recorded').toEqual([]);
    // The payment state is untouched, so `paymentStateOf` still reads claimed.
    expect(regDoc.current).not.toHaveProperty('paymentInvoiceId');
    expect((regDoc.current as Record<string, unknown>).paymentStatus).toBe('unpaid');
  });

  it('🔴 a CRM write that throws does not un-confirm a gift that landed', async () => {
    /**
     * The activity runs LAST and is best-effort for the same reason the invoice
     * runs first: the money record is the one that must not be lost. By the time
     * it runs, the invoice exists and the ticket is stamped — a display gap on
     * one screen must not undo either.
     */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The activity write itself throws; everything before it is untouched.
    activityAddThrows.current = true;
    try {
      const res = await post(CALL);
      expect(res.status, 'a failed timeline write failed the whole confirmation').toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.invoiceId, 'the recorded gift was lost with the timeline row').toBe('inv1');
      expect(activities()).toEqual([]);
      // The ticket is still confirmed — the stamp landed before this ran.
      expect((regDoc.current as Record<string, unknown>).paymentInvoiceId).toBe('inv1');
      expect(warn, 'the failure was swallowed silently').toHaveBeenCalled();
    } finally {
      activityAddThrows.current = false;
      warn.mockRestore();
    }
  });
});

/* ═══ 15 · no second money writer ═════════════════════════════════════════ */

describe('15 · confirming still calls recordManualDonation', () => {
  it('🔴 with the event source, the audit trail and the amount in cents', async () => {
    await post(CALL);
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);
    const args = mockRecordManualDonation.mock.calls[0][0] as Record<string, unknown>;
    expect(args.tenantId).toBe('kingdom-living');
    expect(args.amountCents).toBe(5000);
    expect(args.email).toBe('dana@example.com');
    expect(args.source, 'the gift is no longer separable from a processed one')
      .toBe('event_manual');
    // 🔴 WHO VOUCHED. If a member disputes the gift the tenant needs the admin's
    // id — Harvest has no opinion of its own to offer.
    expect(args.recordedBy).toBe('admin-uid');
  });

  it('🔴 and the route’s source imports exactly one money writer', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/app/api/event-payment/confirm/route.ts'), 'utf8');
    /**
     * THE-340 found ELEVEN inlined copies of a Resend send with none of them a
     * function. A second inlined invoice write here would be that mistake in the
     * money ledger, so the SOURCE is checked as well as the behaviour: nothing
     * in this route may reach an invoices collection directly.
     */
    expect(src).toContain("import { recordManualDonation } from '@/lib/manual-donation';");
    /**
     * ⚠️ ASSEMBLED FROM FRAGMENTS SO IT CANNOT MATCH ITSELF. #496 found TWO of
     * its own guards self-matching — a grep whose needle is spelled as a
     * literal in the file it greps finds itself and passes forever. This
     * suite's subject is a different file, but the discipline is cheap and the
     * next copy of this pattern may not be.
     */
    const needle = new RegExp(`collection\\(\\s*['"]${['invo', 'ices'].join('')}['"]`);
    expect(src, '🔴 the confirm route reaches the invoices collection directly')
      .not.toMatch(needle);
    // The needle really does find what it is looking for.
    expect(`adminDb.collection('${['invo', 'ices'].join('')}')`).toMatch(needle);
  });
});
