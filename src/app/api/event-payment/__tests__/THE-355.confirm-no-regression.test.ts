import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-355 · 🔴 CONFIRM IS STILL IDEMPOTENT AND STILL CALLS THE-350'S WRITER.
 *
 * Tests 8 and 9 — NO-REGRESSION, and they are asserted here rather than assumed
 * because this ticket adds a SECOND way for a claim to arrive (the public,
 * unauthenticated one) and therefore a second way for two claims to land on one
 * seat. A double invoice is a FALSE FINANCIAL RECORD: the church's books, the
 * dashboard and the member's own giving statement would all say they gave twice.
 *
 * 🔴 SO IT IS PRESSED TWICE AND THE INVOICES ARE COUNTED, rather than described.
 *
 * ⚠️ THE HARNESS IS THE-351's, REUSED WHOLESALE, driving the REAL route handler
 * with the Admin SDK and THE-350's writer mocked at their module boundaries —
 * so what is asserted is the handler's own behaviour and not a paraphrase.
 *
 * ⚠️ `recordManualDonation` IS MOCKED, NOT REIMPLEMENTED. The claim under test
 * is "this route calls THE-350's writer and does not write an invoice itself",
 * and the way to assert that is to watch the writer being called and to watch
 * the `invoices` collection NOT being written by anything else. A stub that
 * wrote an invoice would be a second implementation living in the test file.
 */

const { mockRecordManualDonation } = vi.hoisted(() => ({
  mockRecordManualDonation: vi.fn(),
}));
const { mockRequireTenantPermission } = vi.hoisted(() => ({
  mockRequireTenantPermission: vi.fn(),
}));

/** Every document written, by path — so an invoice write from anywhere shows up. */
const { writes, regDoc, txUpdates } = vi.hoisted(() => ({
  writes: { current: [] as { path: string; payload: Record<string, unknown> }[] },
  regDoc: { current: {} as Record<string, unknown> },
  txUpdates: { current: [] as Record<string, unknown>[] },
}));

function makeDocRef(path: string): any {
  return {
    __path: path,
    get: async () => ({ exists: true, data: () => (path.includes('/events/') ? { title: 'Autumn Retreat' } : regDoc.current) }),
    update: async (payload: Record<string, unknown>) => { writes.current.push({ path, payload }); },
    set: async (payload: Record<string, unknown>) => { writes.current.push({ path, payload }); },
    collection: (name: string) => makeCollRef(`${path}/${name}`),
  };
}
function makeCollRef(path: string): any {
  const coll: any = {
    __path: path,
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (payload: Record<string, unknown>) => {
      writes.current.push({ path, payload });
      return { id: 'written1' };
    },
  };
  coll.where = () => coll; coll.limit = () => coll; coll.orderBy = () => coll;
  coll.get = async () => ({ docs: [] });
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
        txUpdates.current.push(payload);
        writes.current.push({ path: ref.__path, payload });
      },
    }),
  },
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '__DELETE__', serverTimestamp: () => '__NOW__' },
}));
vi.mock('@/lib/manual-donation', () => ({
  recordManualDonation: mockRecordManualDonation,
  // Re-exported by the real module and read by nothing here, but the mock must
  // not silently drop a name a future import would need.
  MANUAL_DONATION_SOURCES: ['crm_manual', 'event_manual'],
}));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: mockRequireTenantPermission }));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: vi.fn(),
  captureHandledError: vi.fn(),
}));

const { POST } = await import('../confirm/route');

const post = (body: unknown) =>
  POST(new NextRequest('https://grace.theharvest.app/api/event-payment/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  }));

const CALL = { tenantId: 'grace', registrationId: 'reg1' };

beforeEach(() => {
  vi.clearAllMocks();
  writes.current = [];
  txUpdates.current = [];
  regDoc.current = {
    name: 'Dana Okafor',
    email: 'Dana@Example.COM',
    amount: 5000,
    eventId: 'ev1',
    paymentStatus: 'unpaid',
    paymentReference: 'HV-4KTM9P',
    paymentClaimedAt: '2031-09-05T10:00:00.000Z',
    paymentClaimPendingAt: '2031-09-05T10:00:00.000Z',
  };
  mockRequireTenantPermission.mockResolvedValue({ uid: 'admin-uid', email: 'pastor@grace.example' });
  mockRecordManualDonation.mockResolvedValue({
    ok: true, invoiceId: 'inv1', receiptNumber: 'R-1-ABCDEF',
    recipientEmail: 'dana@example.com', visibleToMember: true,
    issuedAt: '2031-09-07T09:00:00.000Z',
  });
});

/* ═══ 8 · Confirm is still idempotent — two taps, ONE invoice ═════════════ */

describe('8 · Confirm is still idempotent', () => {
  it('\u{1F534} two taps write ONE invoice', async () => {
    const first = await post(CALL);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.invoiceId).toBe('inv1');
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);

    /**
     * \u{1F534} THE SECOND PRESS LANDS ON A REGISTRATION THAT NOW CARRIES AN INVOICE
     * ID, which is the guard that holds forever: the transaction sees it and
     * returns it rather than writing again. `paymentStateOf` keys `confirmed`
     * on this field for exactly this reason.
     */
    regDoc.current = { ...regDoc.current, paymentInvoiceId: 'inv1', paymentStatus: 'confirmed' };
    const second = await post(CALL);
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(mockRecordManualDonation, '\u{1F534} A SECOND TAP WROTE A SECOND INVOICE')
      .toHaveBeenCalledTimes(1);
    expect(secondBody.alreadyConfirmed, 'the second press did not report itself as a repeat').toBe(true);
    expect(secondBody.invoiceId, 'the second press returned a different invoice').toBe('inv1');
  });

  it('\u{1F534} and nothing else in the whole run ever wrote to an invoices collection', async () => {
    await post(CALL);
    regDoc.current = { ...regDoc.current, paymentInvoiceId: 'inv1' };
    await post(CALL);
    const invoiceWrites = writes.current.filter((w) => w.path.includes('invoice'));
    expect(invoiceWrites, 'something other than THE-350’s writer wrote an invoice').toEqual([]);
  });

  it('\u{1F534} a second press while one is IN FLIGHT is refused, not queued', async () => {
    // The lock closes the race the invoice-id guard cannot: the invoice write is
    // in a different collection reached through a different module, so it cannot
    // be inside the transaction.
    const now = new Date();
    regDoc.current = { ...regDoc.current, paymentConfirmStartedAt: now.toISOString() };
    const res = await post(CALL);
    expect(mockRecordManualDonation, 'a concurrent press reached the writer').not.toHaveBeenCalled();
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  it('\u{1F534} a FAILED confirmation writes no payment state and leaves the row in the queue', async () => {
    mockRecordManualDonation.mockResolvedValue({ ok: false, error: 'the ledger is down' });
    const res = await post(CALL);
    expect(res.status, 'a failed confirmation answered as a success').toBeGreaterThanOrEqual(400);

    const regWrites = writes.current.filter((w) => w.path.endsWith('registrations/reg1'));
    for (const w of regWrites) {
      expect(w.payload, 'a failed confirmation marked the ticket paid').not.toHaveProperty('paymentInvoiceId');
      expect(w.payload, 'a failed confirmation stamped a confirmation time')
        .not.toHaveProperty('paymentConfirmedAt');
    }
    // The queue key must still be there, or the person silently leaves the inbox.
    const deleted = regWrites.some((w) => w.payload.paymentClaimPendingAt === '__DELETE__');
    expect(deleted, '\u{1F534} a failed confirmation removed the person from the inbox').toBe(false);
  });
});

/* ═══ 9 · Confirm still calls recordManualDonation — no second writer ═════ */

describe('9 · Confirm still calls recordManualDonation', () => {
  it('\u{1F534} THE-350’s writer is the one that records the money', async () => {
    await post(CALL);
    expect(mockRecordManualDonation, '\u{1F534} the confirm route stopped calling THE-350’s writer')
      .toHaveBeenCalledTimes(1);
    const args = mockRecordManualDonation.mock.calls[0][0] as Record<string, unknown>;
    expect(args.amountCents, 'the invoice is for a different amount than the seat').toBe(5000);
    expect(args.tenantId).toBe('grace');
    // The admin's own uid reaches the invoice: if the gift is disputed later the
    // church needs the name of the person who vouched, and Harvest has none.
    expect(args.recordedBy, 'the invoice no longer records WHO vouched').toBe('admin-uid');
  });

  it('\u{1F534} with source "event_manual" — what keeps a vouched gift separable', async () => {
    const { EVENT_CONFIRMATION_SOURCE } = await import('@/lib/event-payment-claims');
    await post(CALL);
    const args = mockRecordManualDonation.mock.calls[0][0] as Record<string, unknown>;
    expect(args.source, 'the source moved — a vouched gift is no longer separable from a processed one')
      .toBe(EVENT_CONFIRMATION_SOURCE);
    expect(EVENT_CONFIRMATION_SOURCE).toBe('event_manual');
  });

  it('\u{1F534} the route writes NO invoice of its own — the writer is the only one', async () => {
    /**
     * \u{1F534} ASSERTED TWO WAYS, because either alone is weak. The mock proves the
     * writer was CALLED; the source sweep proves nothing else in the handler
     * writes an invoice, which is what "no second writer" actually claims. A
     * route that called the writer AND added its own row would pass the first.
     */
    await post(CALL);
    expect(writes.current.filter((w) => w.path.includes('invoice'))).toEqual([]);

    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { stripComments } = await import('../../../../__tests__/__fixtures__/the-346-strip-comments');
    const src = stripComments(readFileSync(
      path.join(process.cwd(), 'src/app/api/event-payment/confirm/route.ts'), 'utf8',
    ));
    // Assembled from fragments so this assertion's own text cannot satisfy it.
    const INVOICE_WRITE = new RegExp(["collection\\('in", "voices'\\)"].join(''));
    expect(INVOICE_WRITE.test("adminDb.collection('in" + "voices')"), 'the needle matches nothing').toBe(true);
    expect(src, 'the confirm route reaches the invoices collection directly').not.toMatch(INVOICE_WRITE);
  });
});
