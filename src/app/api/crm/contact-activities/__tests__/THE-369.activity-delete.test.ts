import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 🔴 #496'S PARSER-BACKED STRIPPER, IMPORTED AND NEVER COPIED. Every content
 * grep below runs over its output, because the collection route this suite
 * asserts about is MOSTLY PROSE — the words `invoice`, `amount` and `contactId`
 * appear constantly in its docblocks, and a raw grep would report that
 * documentation as the defect it is looking for.
 */
import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from '@/__tests__/__fixtures__/firestore-rules-pin';

/**
 * THE-369 · 🔴 ONE ACTIVITY OFF A TIMELINE, AND THE GIFT BEHIND IT.
 *
 * THE FOUNDER: "make sure that if i delete the activity, it is deleted from the
 * dashboard analytics donation as well."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 DRIVEN THROUGH THE REAL HANDLER, OVER A STORE THAT REALLY DELETES
 *
 * The harness below is an in-memory Firestore with a REAL `runTransaction`:
 * `tx.get` reads the store, `tx.delete` is buffered and applied on commit, and a
 * transaction that returns without committing leaves the store untouched. That
 * matters because almost every claim here is about WHAT IS STILL THERE
 * afterwards — an invoice that survived a refusal, a receipt that survived a
 * CONTACT delete, another tenant's row that survived an id.
 *
 * ⚠️ A HARNESS THAT ONLY RECORDED CALLS COULD NOT EXPRESS ANY OF THAT. It would
 * pass against a route that called delete on the right reference and against one
 * that called it on nothing at all.
 *
 * ⚠️ EVERY FIXTURE INSTANT IS FAR-FUTURE AND BUILT FROM PARTS — #468 turned
 * `main` red with a date pinned near the run date, and nothing here is near
 * today.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER (THE-331 pinned `AdminCommunity.tsx:491`
 * and a deletion moved it to `:311`), and no assertion here reads this branch's
 * diff — #511 retired the last guard that did.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * The store
 * ═══════════════════════════════════════════════════════════════════════════ */

type Doc = Record<string, unknown>;

const { store, permission, commitFails } = vi.hoisted(() => ({
  /** Every document, keyed by its full path. A delete really removes the key. */
  store: { current: new Map<string, Record<string, unknown>>() },
  permission: { granted: true },
  /**
   * 🔴 MAKES THE COMMIT FAIL, which is the only way to tell a TRANSACTION from
   * two sequential deletes. Both shapes look identical on the happy path.
   */
  commitFails: { current: false },
}));

const { mockRequireTenantPermission, mockCapture } = vi.hoisted(() => ({
  mockRequireTenantPermission: vi.fn(),
  mockCapture: vi.fn(),
}));

function docRef(p: string): any {
  return {
    __path: p,
    get: async () => snapOf(p),
    collection: (name: string) => collRef(`${p}/${name}`),
    delete: async () => { store.current.delete(p); },
  };
}
function collRef(p: string): any {
  const c: any = { __path: p, doc: (id: string) => docRef(`${p}/${id}`) };
  c.where = () => c;
  c.limit = () => c;
  c.get = async () => ({
    docs: [...store.current.entries()]
      .filter(([k]) => k.startsWith(`${p}/`) && k.slice(p.length + 1).indexOf('/') === -1)
      .map(([k, v]) => ({ id: k.split('/').pop()!, data: () => v, ref: docRef(k) })),
  });
  return c;
}
function snapOf(p: string) {
  const v = store.current.get(p);
  return { exists: v !== undefined, data: () => v, id: p.split('/').pop()! };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => collRef(name),
    /**
     * 🔴 A REAL TWO-PHASE TRANSACTION, because atomicity is the claim.
     * Deletions are BUFFERED and applied only when the body returns normally, so
     * a refusal that returns before writing leaves the store exactly as it was —
     * which is what "nothing was deleted" has to mean to be worth asserting.
     */
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending: string[] = [];
      const out = await fn({
        get: async (ref: { __path: string }) => snapOf(ref.__path),
        delete: (ref: { __path: string }) => { pending.push(ref.__path); },
      });
      // 🔴 A FAILED COMMIT APPLIES NOTHING. A route that deleted the activity
      // with its own `await ref.delete()` before reaching the invoice would have
      // already lost the row here; a transaction has lost neither.
      if (commitFails.current) throw new Error('ABORTED: the transaction could not commit');
      for (const p of pending) store.current.delete(p);
      return out;
    },
    /**
     * `deleteByQuery` commits each page as ONE batch. Real enough that the
     * cascade test below is about what the store holds afterwards rather than
     * about which methods were called.
     */
    batch: () => {
      const pending: string[] = [];
      return {
        delete: (ref: { __path: string }) => { pending.push(ref.__path); },
        commit: async () => { for (const p of pending) store.current.delete(p); },
      };
    },
  },
}));

vi.mock('@/lib/api-auth', () => ({
  requireTenantPermission: mockRequireTenantPermission,
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: mockCapture,
  captureHandledError: mockCapture,
}));

const { DELETE } = await import('../[activityId]/route');

/* ═══════════════════════════════════════════════════════════════════════════
 * Fixtures — far-future, built from parts
 * ═══════════════════════════════════════════════════════════════════════════ */

const TENANT = 'grace-chapel';
const OTHER_TENANT = 'river-of-life';
const CONTACT = 'G6c04DRQwp2ngo6G9d6K';

/** 2031, assembled rather than written, so no fixture can drift near a run date. */
const YEAR = 2031;
const iso = (month: number, day: number) =>
  new Date(Date.UTC(YEAR, month - 1, day, 12, 0, 0)).toISOString();

const GIFT_CENTS = 25_000;       // $250.00
const OTHER_GIFT_CENTS = 7_500;  // $75.00

function activity(id: string, over: Doc = {}): [string, Doc] {
  return [`contactActivities/${id}`, {
    contactId: CONTACT, tenantId: TENANT, type: 'note',
    description: 'Called about Sunday', amount: null,
    createdAt: iso(3, 4), createdBy: 'admin-uid', ...over,
  }];
}
function invoice(id: string, tenant: string, over: Doc = {}): [string, Doc] {
  return [`tenants/${tenant}/invoices/${id}`, {
    type: 'donation_receipt', recipientName: 'Grace Giver',
    recipientEmail: 'grace.giver@example.org', amount: GIFT_CENTS, currency: 'usd',
    description: 'Sunday offering, cash', receiptNumber: 'R-1900000000000-AB12CD',
    issuedAt: iso(3, 4), tenantName: 'Grace Chapel', pdfUrl: null,
    source: 'crm_manual', status: 'recorded', recordedBy: 'admin-uid',
    relatedId: 'manual:R-1900000000000-AB12CD', ...over,
  }];
}

function seed(entries: Array<[string, Doc]>) {
  store.current = new Map(entries);
}

function req(activityId: string, qs = `?tenantId=${TENANT}`) {
  return new NextRequest(
    `https://example.com/api/crm/contact-activities/${activityId}${qs}`,
    { headers: { authorization: 'Bearer token' } },
  );
}
const call = (activityId: string, qs?: string) =>
  DELETE(req(activityId, qs), { params: { activityId } });

const has = (p: string) => store.current.has(p);
const ledgerOf = (tenant: string) =>
  [...store.current.entries()]
    .filter(([k]) => k.startsWith(`tenants/${tenant}/invoices/`))
    .map(([, v]) => v);

beforeEach(() => {
  vi.clearAllMocks();
  permission.granted = true;
  commitFails.current = false;
  mockRequireTenantPermission.mockImplementation(async () => ({ uid: 'admin-uid', email: 'admin@grace.org' }));
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 · A NOTE, CALL, MEETING OR EMAIL CAN BE DELETED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · a note, call, meeting or email activity can be deleted', () => {
  for (const type of ['note', 'call', 'meeting', 'email'] as const) {
    it(`🔴 a ${type} activity is deleted, and it is a HARD delete`, async () => {
      seed([activity('a1', { type, description: `A ${type}` })]);
      const res = await call('a1');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ removed: 1, invoiceRemoved: false });

      // 🔴 HARD, NOT SOFT, AND THE STORE IS WHAT SAYS SO. A timeline full of
      // tombstones is worse than a lost note: the row a church deleted because
      // it was typed on the wrong person would still be sitting on that person.
      expect(has('contactActivities/a1'), `a ${type} was tombstoned rather than deleted`).toBe(false);
      expect(store.current.size, 'something else was deleted as well').toBe(0);
    });
  }

  it('🔴 nothing is written in place of the row — no tombstone field anywhere', async () => {
    seed([activity('a1'), activity('a2')]);
    await call('a1');
    // The surviving row is byte-identical: no `deletedAt`, no `deleted: true`,
    // no sibling marker. A soft delete would have to leave SOMETHING.
    expect(store.current.get('contactActivities/a2')).toEqual(activity('a2')[1]);
    expect([...store.current.keys()]).toEqual(['contactActivities/a2']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 · ONLY THAT ROW
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · the row disappears, and only that row', () => {
  it('🔴 four siblings on the same contact are untouched', async () => {
    seed([
      activity('a1', { type: 'note' }),
      activity('a2', { type: 'call' }),
      activity('a3', { type: 'meeting' }),
      activity('a4', { type: 'email' }),
      activity('a5', { type: 'note' }),
    ]);
    const res = await call('a3');
    expect(res.status).toBe(200);
    expect([...store.current.keys()].sort()).toEqual([
      'contactActivities/a1', 'contactActivities/a2',
      'contactActivities/a4', 'contactActivities/a5',
    ]);
  });

  it('🔴 an id that names nothing deletes nothing and says 404', async () => {
    seed([activity('a1')]);
    const res = await call('does-not-exist');
    expect(res.status).toBe(404);
    expect(has('contactActivities/a1')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 · THE DONATION DECISION, AND THE REASONING IN THE MESSAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · a donation activity takes its invoice with it', () => {
  it(
    '🔴 the INVOICE is the money and `contactActivities` is read as money by nothing, '
    + 'so a delete that removed only the row would leave the gift in the dashboard figure, '
    + 'in accounting, in the member’s giving history and on their statement while the '
    + 'church watched the row vanish and concluded the money had moved with it',
    async () => {
      seed([
        activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
        invoice('inv1', TENANT),
      ]);
      const res = await call('a1');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        removed: 1, invoiceRemoved: true, amountCents: GIFT_CENTS,
      });
      expect(has('contactActivities/a1'), 'the timeline row survived').toBe(false);
      expect(has(`tenants/${TENANT}/invoices/inv1`), 'the money was left behind').toBe(false);
    },
  );

  it('🔴 the row carries `amount: null`, so the figure comes from the INVOICE', async () => {
    seed([
      activity('a1', { type: 'donation', amount: null, invoiceId: 'inv1', invoiceAmountCents: 999 }),
      // The row's display mirror deliberately DISAGREES with the ledger here.
      // What is reported must be what the books actually lost.
      invoice('inv1', TENANT, { amount: GIFT_CENTS }),
    ]);
    const body = await (await call('a1')).json();
    expect(body.amountCents, 'the route echoed the row rather than reading the ledger')
      .toBe(GIFT_CENTS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 · THE FOUNDER'S DECISION
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · deleting a donation activity ALSO deletes its invoice', () => {
  it('🔴 the receipt is gone from the ledger, not merely unlinked', async () => {
    seed([
      activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
      invoice('inv1', TENANT),
      invoice('inv2', TENANT, { amount: OTHER_GIFT_CENTS, receiptNumber: 'R-1900000000001-ZZ99XX' }),
    ]);
    await call('a1');
    // Not anonymised, not flagged, not zeroed — GONE. Anonymising is
    // `member-erasure.ts`'s job under a different lawful basis, and an
    // anonymised receipt still counts on the dashboard.
    expect(ledgerOf(TENANT)).toHaveLength(1);
    expect(ledgerOf(TENANT)[0]).toMatchObject({ amount: OTHER_GIFT_CENTS });
  });

  it('🔴 and it is ATOMIC — a refusal leaves BOTH documents where they were', async () => {
    seed([
      activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
      invoice('inv1', TENANT, { source: 'event_manual' }),
    ]);
    const res = await call('a1');
    expect(res.status).toBe(409);
    expect(has('contactActivities/a1'), 'the row went without its invoice').toBe(true);
    expect(has(`tenants/${TENANT}/invoices/inv1`)).toBe(true);
  });

  it(
    '🔴 A FAILED COMMIT LOSES NEITHER \u2014 the delete is ONE transaction, '
    + 'not the activity followed by the invoice',
    async () => {
      /**
       * 🔴 THE ORDERING THAT IS NOT AVAILABLE HERE. Activity-first would mean a
       * failure that removes the row and leaves the gift on the books with no
       * pointer left to find it by — the silent money-behind failure this whole
       * ticket exists to prevent, and with no screen left to retry from. The
       * collection route argues RESUMABLE over ATOMIC because a batch cannot span
       * a contact's whole timeline; here it is exactly two documents, so the
       * transaction spans them and this is the stronger guarantee.
       */
      seed([
        activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
        invoice('inv1', TENANT),
      ]);
      commitFails.current = true;

      const res = await call('a1');
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringContaining('Nothing was deleted'),
      });

      expect(has('contactActivities/a1'), 'the row went while the money stayed').toBe(true);
      expect(has(`tenants/${TENANT}/invoices/inv1`), 'the receipt went while the row stayed').toBe(true);
      expect(mockCapture, 'a failed money-path delete was not reported').toHaveBeenCalled();
    },
  );

  it('🔴 a pointer whose target is already gone is finished, not refused', async () => {
    // The one partial state this route can produce is one an earlier attempt
    // left; deleting the row completes it and there is no money left to weigh.
    seed([activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS })]);
    const res = await call('a1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ invoiceRemoved: false, amountCents: null });
    expect(has('contactActivities/a1')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5b · THE DASHBOARD FIGURE, MEASURED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5b · the dashboard giving figure drops by exactly that amount', () => {
  it('🔴 measured through the Overview tab’s OWN reducers, not a paraphrase', async () => {
    const { toInvoiceRow, readableReceipts } = await import('@/components/dashboard/dashboard-data');

    /** The giving figure exactly as `useOverviewData` derives it, in CENTS. */
    const givingCents = (): number => {
      const read = readableReceipts(ledgerOf(TENANT).map((d) => toInvoiceRow(d as Doc)));
      if (read.kind !== 'complete') throw new Error(`the ledger refused: ${read.reason}`);
      return read.rows.reduce((sum, r) => sum + r.amountCents, 0);
    };

    seed([
      activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
      invoice('inv1', TENANT),
      invoice('inv2', TENANT, { amount: OTHER_GIFT_CENTS, receiptNumber: 'R-1900000000001-ZZ99XX' }),
    ]);

    const before = givingCents();
    expect(before, 'the fixture ledger is not two readable gifts')
      .toBe(GIFT_CENTS + OTHER_GIFT_CENTS);

    await call('a1');

    const after = givingCents();
    // 🔴 EXACTLY, and in both directions: the figure fell by the gift, and it
    // fell by NOTHING ELSE. "It went down" would pass for a ledger emptied.
    expect(before - after, 'the dashboard figure did not fall by the gift').toBe(GIFT_CENTS);
    expect(after, 'the delete took more than the one gift').toBe(OTHER_GIFT_CENTS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5c · WHAT ELSE LOSES IT — ENUMERATED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5c · accounting, the member’s history and their statement all lose it', () => {
  /**
   * 🔴 ONE DOCUMENT, FIVE READERS, AND THAT IS WHY THE COST IS WHAT IT IS.
   * THE-350's whole design is that a manual gift is shaped byte-for-byte like a
   * webhook receipt so every reader ALREADY BUILT counts it with no new code.
   * Deleting it is that property running backwards, and each reader below is
   * named with the query that makes it true.
   */
  const READERS: ReadonlyArray<readonly [surface: string, file: string, pattern: RegExp]> = [
    ['the dashboard giving figure', 'src/components/dashboard/dashboard-data.ts',
      /collection\(db, 'tenants', tenantId, 'invoices'\)/],
    ['AdminAccounting', 'src/components/AdminAccounting.tsx',
      /collection\(db, 'tenants', tid, 'invoices'\)/],
    ['the member’s own giving history', 'src/app/api/donation-history/route.ts',
      /collection\('invoices'\)/],
    ['their year-end giving statement', 'src/app/api/giving-statements/generate/route.ts',
      /collection\('invoices'\)/],
    ['their downloadable receipt', 'src/app/api/donation-history/download/route.ts',
      /collection\('invoices'\)\.doc\(invoiceId\)/],
  ];

  it.each(READERS)('%s reads the collection this delete removes from', (_surface, file, pattern) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(src, `${file} no longer reads the invoices collection`).toMatch(pattern);
  });

  it('🔴 and the document really leaves that collection, so all five lose it', async () => {
    seed([
      activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
      invoice('inv1', TENANT),
    ]);
    await call('a1');
    expect(ledgerOf(TENANT), 'the receipt survived somewhere in the ledger').toEqual([]);
  });

  it('🔴 a MANUAL gift never had a downloadable PDF, so no download is orphaned', async () => {
    // Reported rather than assumed: `recordManualDonation` writes `pdfUrl: null`
    // and nothing generates one, and the download route refuses an empty path
    // BEFORE it signs anything. So a member cannot be holding a downloaded
    // receipt for a gift this route can reach, and the confirmation copy does
    // not claim otherwise.
    const writer = readFileSync(path.join(process.cwd(), 'src/lib/manual-donation.ts'), 'utf8');
    expect(writer, 'a manual gift gained a PDF').toMatch(/pdfUrl:\s*null,/);
    const dl = readFileSync(
      path.join(process.cwd(), 'src/app/api/donation-history/download/route.ts'), 'utf8');
    expect(dl, 'the download route stopped refusing an absent PDF')
      .toMatch(/if \(!pdfPath\) \{[\s\S]*?status: 404/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5e · THE DECISION MUST NOT LEAK INTO THE CASCADE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5e · deleting a CONTACT still keeps their receipts', () => {
  it('🔴 the bulk DELETE removes every row and NOT ONE INVOICE', async () => {
    const { DELETE: BULK } = await import('../route');
    vi.resetModules();
    seed([
      activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
      activity('a2', { type: 'note' }),
      activity('a3', { type: 'call' }),
      invoice('inv1', TENANT),
      invoice('inv2', TENANT, { amount: OTHER_GIFT_CENTS, receiptNumber: 'R-1900000000001-ZZ99XX' }),
    ]);

    const res = await BULK(new NextRequest(
      `https://example.com/api/crm/contact-activities`
      + `?contactId=${CONTACT}&tenantId=${TENANT}`,
      { headers: { authorization: 'Bearer token' }, method: 'DELETE' },
    ));
    expect(res.status).toBe(200);

    // 🔴 DELETING A PERSON IS NOT CORRECTING A GIFT. #506 established that the
    // receipt stays on the church's books when a contact goes, and THIS ticket's
    // decision — that a deliberate single-gift delete reaches the money — must
    // not leak one inch into the cascade.
    expect(ledgerOf(TENANT), 'the contact cascade deleted a receipt').toHaveLength(2);
    expect([...store.current.keys()].filter((k) => k.startsWith('contactActivities/')))
      .toEqual([]);
  });

  it('🔴 the collection route contains no reference to the invoices collection at all', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/api/crm/contact-activities/route.ts'), 'utf8');
    const code = stripped(src);
    // ⚠️ OVER PARSER-STRIPPED SOURCE. That file is MOSTLY PROSE and the words
    // `invoice`, `amount` and `contactId` appear constantly in its docblocks —
    // a raw grep here would report its own documentation as the defect.
    expect(code, 'the cascade route learned to read or write invoices')
      .not.toMatch(/collection\(\s*['"]invoices['"]\s*\)/);
    expect(code, 'the cascade route reached for a tenant subcollection')
      .not.toMatch(/collection\(\s*['"]tenants['"]\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 · A NON-DONATION ACTIVITY MOVES NO MONEY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · accounting totals are unchanged by deleting a non-donation activity', () => {
  it.each(['note', 'call', 'meeting', 'email'] as const)(
    '🔴 deleting a %s leaves the ledger byte-identical',
    async (type) => {
      seed([
        activity('a1', { type }),
        invoice('inv1', TENANT),
        invoice('inv2', TENANT, { amount: OTHER_GIFT_CENTS, receiptNumber: 'R-1900000000001-ZZ99XX' }),
      ]);
      const before = JSON.stringify(ledgerOf(TENANT));
      const res = await call('a1');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ invoiceRemoved: false, amountCents: null });
      expect(JSON.stringify(ledgerOf(TENANT)), `deleting a ${type} moved the books`).toBe(before);
    },
  );

  it(
    '🔴 AND A ROW THAT DOES POINT AT A PROCESSED RECEIPT IS REFUSED \u2014 '
    + 'the money really moved, so its receipt is not this screen\u2019s to remove',
    async () => {
      /**
       * 🔴 DEFENCE IN DEPTH, AND REACHED RATHER THAN DESCRIBED. No writer in the
       * repository produces this row today — `lib/donation-webhook.ts` writes its
       * CRM entry with an `amount` in DOLLARS and NO `invoiceId` — but
       * "unreachable" is a property of today's writers, not of this route. An
       * invoice with NO `source` is what every historical receipt is, and
       * `isManuallyRecordedDonation` reads that absence as "processed".
       */
      seed([
        activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
        invoice('inv1', TENANT, { source: undefined, status: 'paid', relatedId: 'pi_3Abc123' }),
      ]);
      const res = await call('a1');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('processed_gift');
      expect(body.error, 'the refusal does not say the money really moved')
        .toMatch(/processed by a payment provider/i);
      expect(has('contactActivities/a1'), 'the row went anyway').toBe(true);
      expect(has(`tenants/${TENANT}/invoices/inv1`), 'a PROCESSED receipt was deleted').toBe(true);
    },
  );

  it('🔴 a source nobody declared is refused too \u2014 failing closed', async () => {
    seed([
      activity('a1', { type: 'donation', invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS }),
      invoice('inv1', TENANT, { source: 'kiosk_manual' }),
    ]);
    const res = await call('a1');
    expect(res.status).toBe(409);
    expect(ledgerOf(TENANT), 'an undeclared source was deleted').toHaveLength(1);
  });

  it(
    '🔴 THE ACCEPTED SET IS EXACTLY `crm_manual`, AND THE SET IT IS DRAWN FROM IS PINNED '
    + '\u2014 so a THIRD manual source cannot inherit this ticket\u2019s answer by default',
    async () => {
      /**
       * 🔴 WHY THIS IS A PIN AND NOT A CASE. `isManuallyRecordedDonation` reads an
       * ABSENT `source` as "processed", so every value outside
       * `MANUAL_DONATION_SOURCES` is already refused by the branch above — which
       * makes the `unrecognised_source` branch unreachable TODAY and reachable
       * the moment somebody appends a third value. That is exactly when a church
       * must not silently acquire the power to delete a new kind of receipt.
       *
       * ⚠️ SO THE GUARD IS ON THE SET. Adding a third source turns this red, and
       * whoever adds it has to decide what deleting one means.
       */
      const { MANUAL_DONATION_SOURCES } = await import('@/lib/manual-donation');
      expect([...MANUAL_DONATION_SOURCES].sort(),
        'a manual donation source was added \u2014 decide what deleting one means')
        .toEqual(['crm_manual', 'event_manual']);

      // And the route names the one it accepts, rather than accepting "manual".
      const code = stripped(readFileSync(
        path.join(process.cwd(), 'src/app/api/crm/contact-activities/[activityId]/route.ts'), 'utf8'));
      expect(code, 'the route stopped requiring crm_manual explicitly')
        .toMatch(/inv\.source !== 'crm_manual'/);
      expect(code, 'the route stopped refusing an unrecognised source')
        .toMatch(/code: 'unrecognised_source'/);
      expect(code, 'the route stopped consulting the one place that answers "is this manual"')
        .toMatch(/isManuallyRecordedDonation\(inv\)/);
    },
  );

  it('🔴 a PRE-THE-350 donation row with a dollar `amount` and no pointer is the same case', async () => {
    // What `lib/donation-webhook.ts` writes for a Stripe gift: `amount` in
    // DOLLARS and NO `invoiceId`. Its receipt is never in this route's reach.
    seed([
      activity('a1', { type: 'donation', amount: 250, description: 'Partnership donation via Stripe' }),
      invoice('inv1', TENANT),
    ]);
    const res = await call('a1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ invoiceRemoved: false });
    expect(ledgerOf(TENANT), 'a processed gift’s receipt was deleted').toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 · AN EVENT TICKET
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('7 · an event-payment activity cannot revoke a held ticket', () => {
  it('🔴 the delete is REFUSED, and both documents survive it', async () => {
    seed([
      activity('a1', {
        type: 'donation', description: 'Event ticket — Crusade Bangladesh',
        invoiceId: 'inv1', invoiceAmountCents: GIFT_CENTS,
      }),
      invoice('inv1', TENANT, { source: 'event_manual' }),
    ]);
    const res = await call('a1');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('event_ticket');
    expect(body.error, 'the refusal does not say a ticket is being held')
      .toMatch(/ticket/i);
    expect(has('contactActivities/a1')).toBe(true);
    expect(has(`tenants/${TENANT}/invoices/inv1`)).toBe(true);
  });

  it('🔴 nothing this route can delete is read by `paymentStateOf` — checked, not assumed', async () => {
    // The reason a ticket could not be revoked even if the invoice HAD gone:
    // the state is a STRING FIELD on the registration and the invoice document
    // is never fetched. That is also why the refusal above is about the
    // one-way trap and not about revocation.
    const { paymentStateOf } = await import('@/lib/event-payment-claims');
    expect(paymentStateOf({ amount: GIFT_CENTS, paymentInvoiceId: 'inv1' })).toBe('confirmed');
    // Same registration, with the invoice deleted from the store: unchanged.
    seed([]);
    expect(paymentStateOf({ amount: GIFT_CENTS, paymentInvoiceId: 'inv1' })).toBe('confirmed');

    const claims = readFileSync(
      path.join(process.cwd(), 'src/lib/event-payment-claims.ts'), 'utf8');
    const fn = claims.slice(claims.indexOf('export function paymentStateOf'));
    expect(fn.slice(0, fn.indexOf('\n}')), 'paymentStateOf learned to read the invoice')
      .not.toMatch(/invoices|\.get\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 · TENANCY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 · a delete cannot reach another tenant’s activity', () => {
  it('🔴 an id alone proves nothing — the row survives and the answer is 404', async () => {
    seed([activity('a1', { tenantId: OTHER_TENANT })]);
    const res = await call('a1');
    expect(res.status).toBe(404);
    expect(has('contactActivities/a1'), 'another church’s row was deleted by id').toBe(true);
  });

  it('🔴 a row with NO tenantId is refused too — absent is not a match', async () => {
    seed([activity('a1', { tenantId: undefined })]);
    const res = await call('a1');
    expect(res.status).toBe(404);
    expect(has('contactActivities/a1')).toBe(true);
  });

  it('🔴 another tenant’s row is INDISTINGUISHABLE from one that does not exist', async () => {
    seed([activity('a1', { tenantId: OTHER_TENANT })]);
    const present = await call('a1');
    seed([]);
    const absent = await call('a1');
    expect(present.status).toBe(absent.status);
    expect(await present.json()).toEqual(await absent.json());
  });

  it('🔴 the gate is `requireTenantPermission(request, tenantId, \'manageCRM\')`', async () => {
    seed([activity('a1')]);
    await call('a1');
    expect(mockRequireTenantPermission).toHaveBeenCalledWith(
      expect.anything(), TENANT, 'manageCRM',
    );
  });

  it('🔴 a refused gate deletes nothing, and never reaches the store', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireTenantPermission.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    seed([activity('a1'), invoice('inv1', TENANT)]);
    const res = await call('a1');
    expect(res.status).toBe(403);
    expect(store.current.size, 'a refused caller still reached the store').toBe(2);
  });

  it('🔴 a missing tenantId is a 400, not a guess', async () => {
    seed([activity('a1')]);
    const res = await DELETE(
      new NextRequest('https://example.com/api/crm/contact-activities/a1'),
      { params: { activityId: 'a1' } },
    );
    expect(res.status).toBe(400);
    expect(has('contactActivities/a1')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 · THE BULK DELETE IS UNCHANGED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('9 · the bulk DELETE used by the contact cascade is unchanged', () => {
  const COLLECTION_ROUTE = 'src/app/api/crm/contact-activities/route.ts';

  it('🔴 the collection route is BYTE-IDENTICAL to what THE-362 left', () => {
    /**
     * 🔴 THIS IS WHY THE SINGLE DELETE IS A SECOND ROUTE. The cascade's contract
     * — activities first, contact last, invoices never — is depended on by
     * `AdminCRM.confirmDelete`, and a branch added to that handler would be one
     * edit away from deciding between two opposite answers off a query string.
     * The file is not edited at all, so "byte-identical behaviour" is not an
     * argument about a diff; it is the absence of one.
     */
    const digest = createHash('sha256')
      .update(readFileSync(path.join(process.cwd(), COLLECTION_ROUTE)))
      .digest('hex');
    expect(digest, `${COLLECTION_ROUTE} was edited — the cascade depends on it`)
      .toBe('9b00ac802fe23c82ff6b8b8472316fb4d1dad3012f4a7e705017adbb85526c7a');
  });

  it('🔴 its query is still ONE single-field where, with the tenant filtered per document', () => {
    const code = stripped(readFileSync(path.join(process.cwd(), COLLECTION_ROUTE), 'utf8'));
    // A second equality filter would need a composite index, and
    // `firestore.indexes.json` is not deployed by this repo's CI.
    expect(code).toMatch(/\.where\('contactId', '==', contactId\)/);
    expect((code.match(/\.where\(/g) ?? []).length, 'a second filter appeared').toBe(2);
    expect(code, 'the per-document cross-tenant guard was removed')
      .toMatch(/\(data\) => \(data\.tenantId \?\? null\) === tenantId/);
    expect(code, 'the cascade stopped paging through deleteByQuery')
      .toMatch(/deleteByQuery\(/);
  });

  it('🔴 and it still gates on exactly the same permission', () => {
    const code = stripped(readFileSync(path.join(process.cwd(), COLLECTION_ROUTE), 'utf8'));
    expect(code).toMatch(/requireTenantPermission\(request, tenantId, 'manageCRM'\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 · THE CASCADE'S ORDER AND ITS RESUMABILITY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('10 · activities first, contact last, and a partial cascade is resumable', () => {
  const CRM = 'src/components/AdminCRM.tsx';
  const crmCode = () => stripped(readFileSync(path.join(process.cwd(), CRM), 'utf8'));

  it('🔴 the activities route is called BEFORE the contact document is deleted', () => {
    const code = crmCode();
    const fn = code.slice(code.indexOf('const confirmDelete = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    const routeCall = body.indexOf('/api/crm/contact-activities?contactId=');
    const contactDelete = body.indexOf("deleteDoc(doc(db, 'contacts'");
    expect(routeCall, 'the cascade no longer calls the activities route').toBeGreaterThan(-1);
    expect(contactDelete, 'the cascade no longer deletes the contact').toBeGreaterThan(-1);
    expect(routeCall, 'the contact is deleted before its activities — that manufactures the orphan')
      .toBeLessThan(contactDelete);
  });

  it('🔴 a failed activities delete THROWS, so the contact is still there to retry on', () => {
    const code = crmCode();
    const fn = code.slice(code.indexOf('const confirmDelete = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body, 'a refused activities delete no longer stops the contact delete')
      .toMatch(/if \(!res\.ok\) \{[\s\S]*?throw new Error/);
    // And the walk-back lives in the success path only — #506's own fix.
    const catchBlock = body.slice(body.lastIndexOf('} catch (e) {'));
    expect(catchBlock, 'a failed cascade still returns to the list').not.toMatch(/setView\('list'\)/);
    expect(catchBlock, 'a failed cascade still closes the dialog').not.toMatch(/setDeleteId\(null\)/);
  });

  it('🔴 THE-369 added no second caller of the bulk route', () => {
    const code = crmCode();
    const calls = code.match(/\/api\/crm\/contact-activities\?contactId=/g) ?? [];
    expect(calls.length, 'the cascade endpoint gained a caller').toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 · NOTHING SUMS contactActivities AS MONEY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('11 · nothing sums contactActivities as money, and `amount` is still null', () => {
  it('🔴 the CRM’s activity write still carries `amount: null`', () => {
    const crm = stripped(readFileSync(path.join(process.cwd(), 'src/components/AdminCRM.tsx'), 'utf8'));
    const add = crm.slice(
      crm.indexOf("addDoc(collection(db, 'contactActivities')"),
      crm.indexOf('});', crm.indexOf("addDoc(collection(db, 'contactActivities')")),
    );
    expect(add.length, 'the activity write could not be located').toBeGreaterThan(100);
    expect(add, 'a gift recorded in the CRM gained a money-bearing amount')
      .toMatch(/amount:\s*null,/);
  });

  it('🔴 and the confirmation route’s row does too', () => {
    const src = stripped(readFileSync(
      path.join(process.cwd(), 'src/app/api/event-payment/confirm/route.ts'), 'utf8'));
    const add = src.slice(src.indexOf("collection('contactActivities').add("));
    expect(add.slice(0, add.indexOf('});')), 'the event activity gained an amount')
      .toMatch(/amount:\s*null,/);
  });

  it('🔴 THE-369 introduced no reducer over an activity amount', () => {
    // THE-350's sweep, run again over this branch's tree. `deleteActivityCents`
    // reads ONE row's display mirror to write a sentence; it sums nothing.
    const offenders = walkSrc().filter((abs) => {
      const src = stripped(readFileSync(abs, 'utf8'));
      return /contactActivities/.test(src)
        && /activit\w*\s*\.\s*reduce\s*\([^)]*amount/i.test(src);
    });
    expect(offenders, 'a surface sums contactActivities as money').toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12-13 · NO-REGRESSION ON #512 AND #482
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('12 · #512’s GivingDocsLink is intact and still a closed union', () => {
  const LINK = 'src/components/admin/GivingDocsLink.tsx';

  it('🔴 the page is a closed union and the label is DERIVED from it', () => {
    const src = readFileSync(path.join(process.cwd(), LINK), 'utf8');
    const code = stripped(src);
    // A union of string literals, not a string — so a surface cannot point at a
    // typo, a missing page or a fourth page.
    expect(code).toMatch(/export type GivingDocsPage\s*=/);
    expect(code, 'the label stopped being derived from the page')
      .toMatch(/const \{ href, label \} = GIVING_DOCS\[page\];/);
    expect(code, 'a caller can now pass its own label').not.toMatch(/label\??:\s*string/);
  });

  it('🔴 the CRM still renders exactly one, inside the donation branch', () => {
    const crm = stripped(readFileSync(path.join(process.cwd(), 'src/components/AdminCRM.tsx'), 'utf8'));
    expect((crm.match(/<GivingDocsLink/g) ?? []).length, 'a second link appeared in the CRM').toBe(1);
    expect(crm, 'the link left the donation branch')
      .toMatch(/actForm\.type === 'donation'/);
    // THE-369 renders no link of its own — the delete dialog is not a place to
    // send somebody away to read procedure.
    expect(crm, 'the delete dialog inlined a fourth page')
      .not.toMatch(/GivingDocsLink[\s\S]{0,400}deleteActivity/);
  });
});

describe('13 · #482’s disclaimer text and switcher are unchanged', () => {
  const crm = () => readFileSync(path.join(process.cwd(), 'src/components/AdminCRM.tsx'), 'utf8');

  it('🔴 the payment-links disclaimer still collapses, with its text byte-for-byte', () => {
    const c = crm();
    expect(c).toContain('Gifts sent through your own payment links are not counted here.');
    expect(c).toContain('open their contact, press Add Activity, choose Donation and enter the amount.');
    expect(c).toContain('<Collapsible');
    expect(c).toContain('keepMounted');
    expect(c).toContain('crm-manual-giving-panel');
  });

  it('🔴 the Contacts/Roles switcher is still ONE definition on both tabs', () => {
    const c = crm();
    expect((c.match(/const subTabBar = \(/g) ?? []).length).toBe(1);
    expect((c.match(/\{subTabBar\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(c).toContain('min-h-11 min-w-11 sm:min-h-0 sm:min-w-0');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 15-17 · HOUSE RULES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('15 · no colour is hardcoded and no emoji ships', () => {
  const OURS = [
    'src/app/api/crm/contact-activities/[activityId]/route.ts',
    'src/components/AdminCRM.tsx',
  ];

  it.each(OURS)('%s hardcodes no colour in shipped code', (rel) => {
    // 🔴 OVER PARSER-STRIPPED SOURCE, which is also what makes this honest: the
    // docblocks in both files cite tickets as `#500`, `#506` and `#512`, and a
    // raw grep would read a ticket number as a CSS shorthand.
    const code = stripped(readFileSync(path.join(process.cwd(), rel), 'utf8'));
    const ours = code.split('\n').filter((l) => /THE-369|deleteActivity|ACTIVITY_NOUNS/.test(l));
    for (const line of ours) {
      expect(line, 'a colour literal shipped').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(line, 'a raw rgb/hsl literal shipped').not.toMatch(/\b(rgb|hsl)a?\(/);
    }
  });

  it.each(OURS)('%s ships no emoji outside its comments', (rel) => {
    const code = stripped(readFileSync(path.join(process.cwd(), rel), 'utf8'));
    expect(code, 'an emoji reached shipped code')
      .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it.each(OURS)('%s is written with LF line endings', (rel) => {
    expect(readFileSync(path.join(process.cwd(), rel), 'utf8'), 'CRLF reached the tree')
      .not.toMatch(/\r/);
  });
});

describe('16 · this suite pins no line number, no near date and no branch diff', () => {
  const SUITES = [
    'src/app/api/crm/contact-activities/__tests__/THE-369.activity-delete.test.ts',
    'src/components/__tests__/THE-369.activity-delete.test.tsx',
    'src/components/__tests__/THE-369.activity-delete.layout.test.tsx',
  ];

  it.each(SUITES)('%s pins no source line number', (rel) => {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
    // THE-331 pinned `AdminCommunity.tsx:491` and a deletion moved it to `:311`.
    expect(stripped(src), 'a test pins a file to a line number')
      .not.toMatch(/\.tsx?:\d+/);
  });

  it.each(SUITES)('%s builds every instant from parts, far from today', (rel) => {
    const code = stripped(readFileSync(path.join(process.cwd(), rel), 'utf8'));
    const years = [...code.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
    const thisYear = new Date().getFullYear();
    for (const y of years) {
      expect(Math.abs(y - thisYear), `a fixture year ${y} sits near today`).toBeGreaterThan(2);
    }
  });

  /**
   * 🔴 THE NEEDLES ARE ASSEMBLED FROM PARTS so this assertion cannot match its
   * own source. A guard that has to spell `exec`+`Sync` in order to forbid it is
   * a guard that fails on itself, which is how a check like this gets quietly
   * deleted instead of quietly kept.
   */
  const SHELL_NEEDLES = ['child' + '_process', 'exec' + 'Sync', 'spawn' + 'Sync', 'git ' + 'diff'];

  it.each(SUITES)('%s asserts nothing about this branch\u2019s diff', (rel) => {
    // #511 RETIRED the last guard that did; the direction is fewer, not more. A
    // guard that reads a diff expires the moment the branch merges.
    const code = stripped(readFileSync(path.join(process.cwd(), rel), 'utf8'));
    for (const needle of SHELL_NEEDLES) {
      expect(code, `a guard reaches for ${needle} \u2014 that reads the branch, not the code`)
        .not.toContain(needle);
    }
  });
});

describe('17 · the files this ticket may not touch are byte-identical', () => {
  it('🔴 firestore.rules is at a digest some ticket recorded', () => {
    // It AUTO-DEPLOYS on merge with no emulator tests in CI. Reached through the
    // shared module rather than respelled — THE-325's sweep exists because a
    // copy-per-suite literal is how one of them comes to be wrong.
    expect(rulesDigestFailure(),
      'firestore.rules moved — it auto-deploys to production on merge').toBeNull();
  });

  it('🔴 firestore.indexes.json is unchanged — no composite index was needed', () => {
    // Both routes run one single-field query or a get by id; neither builds a
    // query a composite index could serve.
    expect(digestOf('firestore.indexes.json'))
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
  });

  it('🔴 functions/ and layout.tsx are unchanged', () => {
    expect(digestOf('functions/src/index.ts'))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
    expect(digestOf('src/app/layout.tsx'))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Helpers — declared last so the assertions above read first
 * ═══════════════════════════════════════════════════════════════════════════ */

const stripped = (src: string): string => stripComments(src);

function digestOf(rel: string): string {
  return createHash('sha256').update(readFileSync(path.join(process.cwd(), rel))).digest('hex');
}

/** Every shipped `.ts`/`.tsx` under `src`, excluding tests. */
function walkSrc(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
    }
  };
  walk(path.join(process.cwd(), 'src'));
  return out;
}
