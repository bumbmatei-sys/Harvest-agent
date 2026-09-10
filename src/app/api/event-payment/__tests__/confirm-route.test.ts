import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-351 · 🔴 CONFIRMING IS A CLAIM BY THE CHURCH, AND IT IS RECORDED ONCE.
 *
 * Tests 8, 9, 10, 11, 12 and 19 of the ticket, driven through the REAL route
 * handler with the Admin SDK and THE-350's writer mocked at their module
 * boundaries — so what is asserted is the handler's own behaviour and not a
 * paraphrase of it.
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

/* ═══ 8 · Confirm writes an invoice VIA THE-350's WRITER ══════════════════ */

describe('8 · Confirm writes an invoice via THE-350’s writer, not a second one', () => {
  it('calls recordManualDonation with the registration’s own money', async () => {
    const res = await post(CALL);
    expect(res.status).toBe(200);
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);
    const arg = mockRecordManualDonation.mock.calls[0][0];
    expect(arg.tenantId).toBe('grace');
    // 🔴 CENTS, straight off the registration. THE-350 REFUSES a non-integer
    // rather than coercing, so a caller that converted here would be the bug.
    expect(arg.amountCents).toBe(5000);
    expect(arg.email).toBe('Dana@Example.COM');
    expect(arg.recipientName).toBe('Dana Okafor');
  });

  it('🔴 writes no invoice document of its own — the writer is the only path', async () => {
    await post(CALL);
    const invoiceWrites = writes.current.filter((w) => w.path.includes('invoices'));
    expect(invoiceWrites, 'the confirm route writes its own invoice — a second money path')
      .toEqual([]);
  });

  it('🔴 does not import a Firestore invoice write at all', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/api/event-payment/confirm/route.ts'), 'utf8',
    );
    const { stripComments } = await import('../../../../__tests__/__fixtures__/the-346-strip-comments');
    const code = stripComments(src);
    expect(code, 'the confirm route reaches the invoices collection directly')
      .not.toMatch(/collection\(\s*['"]invoices['"]\s*\)/);
    expect(code, 'the confirm route does not call THE-350’s writer')
      .toContain('recordManualDonation(');
  });
});

/* ═══ 9 · what one press reaches ═════════════════════════════════════════ */

describe('9 · Confirm updates the dashboard, accounting, the CRM and the member’s history', () => {
  it('reaches all five by writing the one document every one of them reads', async () => {
    await post(CALL);
    const arg = mockRecordManualDonation.mock.calls[0][0];
    /**
     * 🔴 ENUMERATED, AND THE ENUMERATION IS THE POINT. THE-350's writer emits a
     * `donation_receipt` into `tenants/{t}/invoices` shaped byte-for-byte like a
     * webhook receipt, and that ONE document is what every downstream surface
     * already reads:
     *
     *   · the Overview tab's giving figure  (`dashboard-data.ts`)
     *   · AdminAccounting                    (reads `invoices`)
     *   · the year-end giving statement      (`/api/giving-statements/generate`)
     *   · the member's own giving history    (`/api/donation-history`)
     *   · their per-year totals and receipt  (same route)
     *
     * So what this asserts is that the call carries everything those five need
     * — a tenant, cents, the identity key and a description — because a call
     * missing any of them reaches fewer than five with nothing going red.
     */
    expect(arg.tenantId).toBeTruthy();
    expect(Number.isSafeInteger(arg.amountCents) && arg.amountCents > 0).toBe(true);
    expect(arg.email, 'no identity key — the member could never retrieve this').toBeTruthy();
    expect(arg.description, 'no description — the giving statement has nothing to print').toBeTruthy();
    expect(arg.description, 'the description does not name the event').toContain('Autumn Retreat');
  });

  it('and the registration is stamped so every surface agrees it is paid', async () => {
    await post(CALL);
    const stamp = writes.current.find((w) => w.path.endsWith('registrations/reg1')
      && 'paymentInvoiceId' in w.payload);
    expect(stamp, 'the ticket was never marked confirmed').toBeTruthy();
    expect(stamp!.payload.paymentInvoiceId).toBe('inv1');
    expect(stamp!.payload.paymentStatus).toBe('confirmed');
  });
});

/* ═══ 10 · IDEMPOTENCE ═══════════════════════════════════════════════════ */

describe('10 · Confirm is IDEMPOTENT — two taps, ONE invoice', () => {
  it('🔴 a second press writes no second invoice and returns the first one', async () => {
    const first = await post(CALL);
    expect(first.status).toBe(200);

    // The document now looks as the first press left it.
    regDoc.current = { ...regDoc.current, paymentInvoiceId: 'inv1', paymentStatus: 'confirmed' };

    const second = await post(CALL);
    const body = await second.json();

    expect(mockRecordManualDonation, '🔴 A SECOND INVOICE — a false financial record')
      .toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect(body.invoiceId, 'the second press did not report the first press’s invoice').toBe('inv1');
    expect(body.alreadyConfirmed).toBe(true);
  });

  it('🔴 a double-submit inside the lock window is refused, not written twice', async () => {
    // The first press is still in flight: the transaction has taken the lock
    // and the writer has not answered yet.
    regDoc.current = { ...regDoc.current, paymentConfirmStartedAt: new Date().toISOString() };
    const res = await post(CALL);
    expect(res.status).toBe(409);
    expect(mockRecordManualDonation, 'a double-submit reached the money writer')
      .not.toHaveBeenCalled();
  });

  it('but a STALE lock does not strand the row forever', async () => {
    const { CONFIRM_LOCK_TTL_MS } = await import('@/lib/event-payment-claims');
    regDoc.current = {
      ...regDoc.current,
      paymentConfirmStartedAt: new Date(Date.now() - CONFIRM_LOCK_TTL_MS - 1000).toISOString(),
    };
    const res = await post(CALL);
    expect(res.status, 'a crashed request left this person unconfirmable').toBe(200);
    expect(mockRecordManualDonation).toHaveBeenCalledTimes(1);
  });
});

/* ═══ 11 · WHO and WHEN ══════════════════════════════════════════════════ */

describe('11 · the confirmation records WHO confirmed it and WHEN', () => {
  it('stamps the admin’s uid, their address and an ISO timestamp', async () => {
    const res = await post(CALL);
    const body = await res.json();
    const stamp = writes.current.find((w) => 'paymentConfirmedBy' in w.payload)!;

    // 🔴 If a member disputes the gift later, the church needs the name of the
    // admin who vouched for it — Harvest has no opinion of its own to offer.
    expect(stamp.payload.paymentConfirmedBy).toBe('admin-uid');
    expect(stamp.payload.paymentConfirmedByName).toBe('pastor@grace.example');
    expect(String(stamp.payload.paymentConfirmedAt))
      .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(body.confirmedAt).toBe(stamp.payload.paymentConfirmedAt);

    // And the AUDIT TRAIL reaches the invoice too, through THE-350's own field.
    expect(mockRecordManualDonation.mock.calls[0][0].recordedBy).toBe('admin-uid');
  });

  it('and keeps WHEN THE MEMBER PRESSED — the queue key goes, the fact stays', async () => {
    await post(CALL);
    const stamp = writes.current.find((w) => 'paymentConfirmedBy' in w.payload)!;
    const { CLAIM_QUEUE_FIELD } = await import('@/lib/event-payment-claims');
    // The queue key is deleted, so the row leaves the inbox...
    expect(stamp.payload[CLAIM_QUEUE_FIELD]).toBe('__DELETE__');
    // ...and `paymentClaimedAt`, the audit fact, is NOT touched by the write.
    expect(Object.keys(stamp.payload)).not.toContain('paymentClaimedAt');
  });
});

/* ═══ 12 · the source distinguishes it ═══════════════════════════════════ */

describe('12 · `source` distinguishes a manually confirmed payment', () => {
  it('is `event_manual`, THE-350’s own value for this caller', async () => {
    await post(CALL);
    expect(mockRecordManualDonation.mock.calls[0][0].source).toBe('event_manual');
  });

  it('🔴 and THE-350 reads that value as manual rather than processed', async () => {
    // Asserted against THE-350's own reader, not against a copy of the string:
    // a caller comparing to a value that module does not emit would file every
    // manually confirmed gift as processed, silently.
    const real = await vi.importActual<typeof import('@/lib/manual-donation')>('@/lib/manual-donation');
    const { EVENT_CONFIRMATION_SOURCE } = await import('@/lib/event-payment-claims');
    expect(real.MANUAL_DONATION_SOURCES).toContain(EVENT_CONFIRMATION_SOURCE);
    expect(real.isManuallyRecordedDonation({ source: EVENT_CONFIRMATION_SOURCE })).toBe(true);
    // A Stripe receipt carries no `source` at all and must stay "processed".
    expect(real.isManuallyRecordedDonation({})).toBe(false);
  });
});

/* ═══ 19 · a failed confirmation ═════════════════════════════════════════ */

describe('19 · a failed confirmation does NOT mark the ticket paid, and surfaces', () => {
  it('🔴 writes no payment state and releases the lock', async () => {
    mockRecordManualDonation.mockResolvedValue({
      ok: false, error: 'The gift could not be recorded. Nothing was saved — try again.',
      code: 'write_failed',
    });

    const res = await post(CALL);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error, 'the failure did not surface to the admin').toBeTruthy();
    expect(body.error).toMatch(/nothing was saved/i);

    // Nothing that would make this ticket read as paid was written.
    const payloads = writes.current.map((w) => w.payload);
    for (const p of payloads) {
      expect(p, 'a FAILED confirmation marked the ticket paid').not.toHaveProperty('paymentInvoiceId');
      expect(p.paymentStatus, 'a FAILED confirmation set paymentStatus').not.toBe('confirmed');
    }
    // And the lock is released so the admin can try again.
    const release = payloads.find((p) => p.paymentConfirmStartedAt === '__DELETE__');
    expect(release, 'a failed confirmation left the row locked').toBeTruthy();
  });

  it('🔴 and the row stays in the inbox — the queue key is not deleted', async () => {
    mockRecordManualDonation.mockResolvedValue({ ok: false, error: 'nope', code: 'write_failed' });
    const { CLAIM_QUEUE_FIELD } = await import('@/lib/event-payment-claims');
    await post(CALL);
    for (const w of writes.current) {
      expect(w.payload[CLAIM_QUEUE_FIELD],
        'a failed confirmation removed the person from the inbox').not.toBe('__DELETE__');
    }
  });

  it('a free ticket has nothing to confirm and is refused', async () => {
    regDoc.current = { ...regDoc.current, amount: 0 };
    const res = await post(CALL);
    expect(res.status).toBe(400);
    expect(mockRecordManualDonation).not.toHaveBeenCalled();
  });
});

/* ═══ 7 · the security assertion ═════════════════════════════════════════ */

describe('7 · a church CANNOT confirm another church’s registration', () => {
  it('🔴 the permission is imposed on the NAMED tenant before anything is read', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireTenantPermission.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await post({ tenantId: 'someone-else', registrationId: 'reg1' });
    expect(res.status).toBe(403);
    expect(mockRequireTenantPermission).toHaveBeenCalledWith(
      expect.anything(), 'someone-else', 'manageEvents',
    );
    expect(writes.current, 'a refused caller still wrote something').toEqual([]);
    expect(mockRecordManualDonation).not.toHaveBeenCalled();
  });
});
