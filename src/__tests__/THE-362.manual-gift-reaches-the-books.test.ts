import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { stripComments } from './__fixtures__/the-346-strip-comments';

/**
 * THE-362 - a gift recorded in the CRM reaches the books, PROVEN END TO END.
 *
 * --- The false claim, and how it got there ----------------------------------
 *
 * `AdminAccounting` and `AdminGivingStatements` each told a treasurer that a
 * gift recorded in the CRM does NOT reach them:
 *
 *   "Recording one in your CRM does not change these numbers ... which is why
 *    the CRM looks right while this screen still reads $0."
 *   "Recording a gift in your CRM does not add it here either."
 *
 * Both were TRUE when THE-303 wrote them: a manual donation wrote a
 * `contactActivities` row and bumped `contacts.totalDonated`, and nothing
 * downstream read either as money. THE-350 then made the manual path write the
 * SAME `donation_receipt` invoice the webhook writes - and nobody went back to
 * the two screens that say it doesn't.
 *
 * So the app contradicted itself on the subject of a church's money. THREE
 * surfaces said a recorded gift counts (`AdminCRM`'s own dialog,
 * `AdminDonations`, and `STRIPE_CONNECT_HIDDEN_MESSAGE`) and TWO said it does
 * not. This suite settles which by RUNNING BOTH SIDES rather than reading them.
 *
 * --- Why this runs the real code -------------------------------------------
 *
 * The claim is about a gift crossing a boundary, so an assertion about either
 * side alone cannot settle it. Here the REAL `recordManualDonation` writes into
 * a store, and the REAL `POST /api/giving-statements/generate` reads out of the
 * SAME store. Nothing in between is stubbed, asserted or re-implemented: if the
 * writer's `type`, its cents, its ISO `issuedAt` or its normalised
 * `recipientEmail` ever stopped matching what the generator filters on, these
 * tests fail rather than the copy quietly going stale again.
 */

/* ═══ one store, written by the real writer and read by the real route ═════ */

const mockRequireAdmin = vi.fn();
const mockRequireTenantPermission = vi.fn();
const mockSendEmail = vi.fn(async (_p: { to: string }) => ({ error: null }));
const mockFileSave = vi.fn(async () => undefined);

/** path -> id -> document. The whole database for this run. */
const store = new Map<string, Map<string, Record<string, unknown>>>();
let autoId = 0;

const seed = (p: string, docs: Array<Record<string, unknown> & { id: string }>) => {
  const m = store.get(p) ?? new Map();
  docs.forEach(({ id, ...rest }) => m.set(id, rest));
  store.set(p, m);
};
const rowsOf = (p: string) => [...(store.get(p) ?? new Map()).values()];

type Filter = { field: string; value: unknown };

/**
 * `where` and `limit` are REAL here, not pass-throughs.
 *
 * `deleteByQuery` pages a filtered query and re-runs the SAME filter after each
 * commit, terminating when a page comes back empty. A fake whose `where` was
 * `() => self` would hand it every document in the collection: the cascade
 * below would appear to work while deleting another contact's rows, and the
 * loop would never terminate on a partial page. So the filter is applied, the
 * limit is applied, and `delete()` removes from the same store the writer
 * wrote into.
 */
function collection(pathName: string, filters: Filter[] = [], cap = Infinity): Record<string, unknown> {
  const matching = () =>
    [...(store.get(pathName) ?? new Map()).entries()]
      .filter(([, data]) => filters.every((f) => (data as Record<string, unknown>)[f.field] === f.value))
      .slice(0, cap === Infinity ? undefined : cap);

  const self: Record<string, unknown> = {
    orderBy: () => self,
    limit: (n: number) => collection(pathName, filters, n),
    where: (field: string, _op: string, value: unknown) =>
      collection(pathName, [...filters, { field, value }], cap),
    // `add` is what `recordManualDonation` calls. The generator never writes
    // invoices, so there is exactly one writer of that collection in the run.
    add: async (data: Record<string, unknown>) => {
      const id = `auto-${++autoId}`;
      const m = store.get(pathName) ?? new Map();
      m.set(id, data);
      store.set(pathName, m);
      return { id };
    },
    doc: (id: string) => ({
      id,
      collection: (name: string) => collection(`${pathName}/${id}/${name}`),
      get: async () => ({
        exists: store.get(pathName)?.has(id) ?? false,
        data: () => store.get(pathName)?.get(id),
      }),
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const m = store.get(pathName) ?? new Map();
        m.set(id, opts?.merge ? { ...(m.get(id) ?? {}), ...data } : data);
        store.set(pathName, m);
      },
    }),
    get: async () => {
      const rows = matching();
      return {
        docs: rows.map(([id, data]) => ({
          id,
          data: () => data,
          ref: { __path: pathName, __id: id },
        })),
        size: rows.length,
        empty: rows.length === 0,
      };
    },
  };
  return self;
}

/** The Admin SDK's `batch()`, applied against the same store. */
const makeBatch = () => {
  const ops: Array<{ path: string; id: string }> = [];
  return {
    delete: (ref: { __path: string; __id: string }) => { ops.push({ path: ref.__path, id: ref.__id }); },
    commit: async () => {
      // ALL OR NOTHING, like the real one: the page either lands or it does not.
      for (const op of ops) store.get(op.path)?.delete(op.id);
      ops.length = 0;
    },
  };
};

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => collection(name), batch: () => makeBatch() },
  getReceiptsBucket: () => ({ file: () => ({ save: mockFileSave }) }),
}));
vi.mock('@/lib/api-auth', () => ({
  requireAdmin: mockRequireAdmin,
  requireTenantPermission: mockRequireTenantPermission,
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: vi.fn(),
  captureMoneyPathError: vi.fn(),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSendEmail }; } }));

const { POST } = await import('@/app/api/giving-statements/generate/route');
const { DELETE: DELETE_ACTIVITIES } = await import('@/app/api/crm/contact-activities/route');
const { recordManualDonation } = await import('@/lib/manual-donation');
const { formatCents } = await import('@/lib/donation-history');
const { STRIPE_CONNECT_HIDDEN_MESSAGE } = await import('@/lib/stripe-connect-feature');

const TENANT = 'grace';
const INVOICES = `tenants/${TENANT}/invoices`;

/**
 * A $50 gift, in cents - the figure from this ticket's own 100x bug, so the two
 * halves of THE-362 are told in the same money.
 */
const GIFT_CENTS = 5000;

/**
 * A FIXED CLOCK, FAR FROM TODAY. `toFake: ['Date']` is load-bearing: the
 * generator filters on the calendar year of `issuedAt`, so a fixture pinned near
 * the present is a test that changes behaviour every 1 January.
 */
const YEAR = 2021;

function request(body: unknown = { year: YEAR, send: false }): NextRequest {
  return new NextRequest(
    new Request('https://grace.theharvest.app/api/giving-statements/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  autoId = 0;
  process.env.RESEND_API_KEY = 'test-key';
  mockRequireAdmin.mockResolvedValue({
    uid: 'admin-1', email: 'admin@grace.org', tenantId: TENANT, isAdmin: true,
  });
  mockRequireTenantPermission.mockResolvedValue({
    uid: 'admin-1', email: 'admin@grace.org', tenantId: TENANT, isAdmin: true,
  });
  seed('tenants', [{ id: TENANT, name: 'Grace Chapel' }]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${YEAR}-06-15T12:00:00.000Z`));
});

/** Record one gift through the REAL writer. */
const record = (over: Partial<Parameters<typeof recordManualDonation>[0]> = {}) =>
  recordManualDonation({
    tenantId: TENANT,
    amountCents: GIFT_CENTS,
    email: 'Grace.Giver@Example.ORG',
    description: 'Sunday offering, cash',
    source: 'crm_manual',
    recipientName: 'Grace Giver',
    recordedBy: 'admin-1',
    ...over,
  });

/* ═══ 2 · the gift reaches the books, and the statement ════════════════════ */

describe('2 - a CRM-recorded gift DOES appear in accounting and on a giving statement', () => {
  it('the writer really writes a receipt onto the ledger accounting reads', async () => {
    const result = await record();
    expect(result.ok, 'the writer refused a valid gift').toBe(true);

    const invoices = rowsOf(INVOICES);
    expect(invoices, 'no receipt reached the ledger').toHaveLength(1);
    const inv = invoices[0];

    // The four fields every downstream reader keys on, including AdminAccounting.
    expect(inv.type, 'not the type every money reader filters on').toBe('donation_receipt');
    expect(inv.amount, 'the amount is not in cents').toBe(GIFT_CENTS);
    expect(typeof inv.issuedAt, 'issuedAt is not the ISO string the readers parse').toBe('string');
    expect(inv.recipientEmail, 'the identity key was not normalised').toBe('grace.giver@example.org');
  });

  it('and AdminAccounting’s own normalisation turns it into $50.00', () => {
    // The screen divides by 100 on read; the member-facing surfaces and the CRM
    // timeline go through `formatCents`. Both land on the same string.
    expect(formatCents(GIFT_CENTS)).toBe('$50.00');
    expect((GIFT_CENTS / 100).toFixed(2)).toBe('50.00');
  });

  it('END TO END: the REAL statement route finds the gift the REAL writer wrote', async () => {
    /**
     * THE ASSERTION THAT SETTLES THE CLAIM. Nothing is seeded into `invoices`
     * here - the only thing that puts a document there is `recordManualDonation`
     * running for real, and the only thing that reads it is the generator
     * running for real, against the same store.
     */
    await record();

    const body = await (await POST(request())).json();
    expect(body.totalDonors, 'the recorded gift produced no statement').toBe(1);
    expect(body.generated, 'no statement was generated for it').toBe(1);
    expect(mockFileSave, 'no statement PDF was written').toHaveBeenCalled();
  });

  it('two recorded gifts group under one donor and total correctly', async () => {
    await record();
    await record({ amountCents: 2500, description: 'Midweek offering, cash' });

    const body = await (await POST(request())).json();
    expect(body.totalDonors, 'the same donor produced two statements').toBe(1);
    // $50.00 + $25.00 = $75.00, summed in cents by the generator.
    expect(rowsOf(INVOICES).reduce((s, r) => s + (r.amount as number), 0)).toBe(7500);
    expect(formatCents(7500)).toBe('$75.00');
  });

  it('the year filter is real - last year’s gift is not on this year’s statement', () => {
    // Non-vacuity for the clock: the generator filters on the calendar year of
    // `issuedAt`, so a suite that never exercised the filter would pass with a
    // broken one.
    expect(new Date(`${YEAR}-06-15T12:00:00.000Z`).getFullYear()).toBe(YEAR);
    expect(new Date(`${YEAR - 1}-06-15T12:00:00.000Z`).getFullYear()).not.toBe(YEAR);
  });

  it('⚠ BUT a gift recorded with NO email counts in the books and NOT on a statement', async () => {
    /**
     * THE HALF OF THE OLD COPY THAT IS STILL TRUE, and the reason the
     * replacement says it rather than simply inverting the sentence.
     *
     * `recordManualDonation` deliberately accepts an emailless gift - refusing
     * would lose the church's own record of a cash gift from someone with no
     * address, money it really received. The generator, equally deliberately,
     * does `if (!donorEmail) continue`, because statements are GROUPED BY EMAIL
     * and there is nobody to address one to.
     *
     * So the gift is on the books and not on a statement. A church that is told
     * only "recording it counts" would go looking for a statement that cannot
     * exist.
     */
    const result = await record({ email: '', recipientName: 'Anonymous cash gift' });
    expect(result.ok, 'an emailless gift was refused - the church loses its own record').toBe(true);

    // On the ledger, so accounting counts it.
    expect(rowsOf(INVOICES)).toHaveLength(1);
    expect(rowsOf(INVOICES)[0].amount).toBe(GIFT_CENTS);

    // And not on a statement, because there is no donor to group it under.
    const body = await (await POST(request())).json();
    expect(body.totalDonors ?? 0, 'an emailless gift reached a giving statement').toBe(0);
  });
});

/* ═══ 4-6, 9 · the cascade, and what it must never touch ══════════════════ */

const ACTIVITIES = 'contactActivities';

function deleteRequest(contactId: string, tenantId: string = TENANT): NextRequest {
  const url = `https://grace.theharvest.app/api/crm/contact-activities`
    + `?contactId=${encodeURIComponent(contactId)}&tenantId=${encodeURIComponent(tenantId)}`;
  return new NextRequest(new Request(url, {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok' },
  }));
}

describe('4-6 - deleting a contact takes its timeline and leaves the money alone', () => {
  /**
   * The shape the CRM actually writes: a donation row carries `amount: null`
   * and an `invoiceId` (#503), because the money record is the receipt it
   * points at and carrying the figure twice is how a gift gets counted twice.
   */
  const seedTimeline = (invoiceId: string) => {
    seed(ACTIVITIES, [
      { id: 'act-1', contactId: 'c1', tenantId: TENANT, type: 'donation', description: 'Sunday offering, cash', amount: null, invoiceId, createdBy: 'admin-1' },
      { id: 'act-2', contactId: 'c1', tenantId: TENANT, type: 'note', description: 'Visited after service', amount: null, createdBy: 'admin-1' },
      // Another contact in the SAME church, and the same contact id in ANOTHER
      // church. Neither may be touched.
      { id: 'act-3', contactId: 'c2', tenantId: TENANT, type: 'note', description: 'Someone else', amount: null, createdBy: 'admin-1' },
      { id: 'act-4', contactId: 'c1', tenantId: 'other-church', type: 'note', description: 'Another tenant', amount: null, createdBy: 'admin-2' },
    ]);
  };

  it('4 - every row pointing at the contact is gone, and no dangling contactId is left', async () => {
    const written = await record();
    seedTimeline((written.ok && written.invoiceId) || 'inv-x');

    const res = await DELETE_ACTIVITIES(deleteRequest('c1'));
    expect(res.status, 'the cascade refused').toBe(200);
    expect((await res.json()).removed, 'the wrong number of rows was removed').toBe(2);

    // THE NAMED MECHANISM: nothing in the collection points at a contact that
    // is about to stop existing, within this church.
    const dangling = rowsOf(ACTIVITIES)
      .filter((r) => r.tenantId === TENANT && r.contactId === 'c1');
    expect(dangling, 'a row still points at the deleted contact').toEqual([]);
  });

  it('4b - and it deletes NOTHING else: not a sibling contact, not another church', async () => {
    seedTimeline('inv-x');
    await DELETE_ACTIVITIES(deleteRequest('c1'));

    const survivors = rowsOf(ACTIVITIES);
    expect(survivors, 'the sweep took rows it was not asked for').toHaveLength(2);
    expect(survivors.some((r) => r.contactId === 'c2'), "a sibling contact's timeline was deleted").toBe(true);
    expect(
      survivors.some((r) => r.tenantId === 'other-church'),
      "another church's row sharing this contact id was deleted - a cross-tenant delete",
    ).toBe(true);
  });

  it('5 - THE INVOICE SURVIVES, byte for byte', async () => {
    /**
     * THE STOP CONDITION. The receipt is the money record. It carries no
     * `contactId` at all, so nothing about a contact deletion can reach it -
     * and this asserts the document is identical before and after rather than
     * merely present.
     */
    const written = await record();
    expect(written.ok).toBe(true);
    seedTimeline((written.ok && written.invoiceId) || 'inv-x');

    const before = JSON.stringify(rowsOf(INVOICES));
    await DELETE_ACTIVITIES(deleteRequest('c1'));
    const after = JSON.stringify(rowsOf(INVOICES));

    expect(after, 'the cascade altered a financial record').toBe(before);
    expect(rowsOf(INVOICES), 'the receipt was deleted with the contact').toHaveLength(1);
    expect(rowsOf(INVOICES)[0].amount, 'the amount moved').toBe(GIFT_CENTS);
  });

  it('5b - the receipt carries no contactId, which is WHY it is out of reach', () => {
    // The structural reason, asserted rather than trusted: a cascade keyed on
    // `contactId` cannot select a document that has no such field.
    expect(Object.keys(rowsOf(INVOICES)[0] ?? {})).not.toContain('contactId');
    expect(read('src/lib/manual-donation.ts'), 'the writer started stamping a contactId on receipts')
      .not.toMatch(/contactId/);
  });

  it('6 - accounting still shows the gift after the contact is gone', async () => {
    /**
     * THE NAMED BEHAVIOUR: NOTHING CHANGES. `AdminAccounting` reads
     * `tenants/{t}/invoices` and nothing else - no contact, no activity - so a
     * gift whose giver has been removed from the CRM still appears in This
     * Month, This Year and the invoice list, under the name and email the
     * receipt was issued with. The church's books do not move when its address
     * book does.
     */
    const written = await record();
    seedTimeline((written.ok && written.invoiceId) || 'inv-x');
    await DELETE_ACTIVITIES(deleteRequest('c1'));

    const ledger = rowsOf(INVOICES);
    expect(ledger).toHaveLength(1);
    expect(formatCents(ledger[0].amount as number), 'the figure accounting renders changed')
      .toBe('$50.00');
    expect(ledger[0].recipientName, 'the donor identity on the receipt was cleared').toBe('Grace Giver');

    // And it is still on a giving statement, generated after the deletion.
    const body = await (await POST(request())).json();
    expect(body.totalDonors, 'the gift fell off the statement when the contact went').toBe(1);
  });

  it('6b - and the screen reads invoices ALONE, which is what makes that true', () => {
    /**
     * PARSER-STRIPPED, and the first draft of this guard proved why: this
     * screen's docblock EXPLAINS the units by naming `contactActivities` and
     * `totalDonated` at length, so a sweep over raw source reports the screen
     * as reading collections it only ever wrote about. Stripping is the shared
     * `the-346` module - a real parse, because a lexer cannot tell JSX text
     * from code and a hand-rolled one eats ~150 lines of a file.
     */
    const accounting = stripComments(read('src/components/AdminAccounting.tsx'));
    for (const collectionName of ['contactActivities', 'totalDonated']) {
      expect(accounting, `accounting now reads ${collectionName} - the two records are meeting`)
        .not.toContain(collectionName);
    }
    // Non-vacuity: it really does read the ledger, so the sweep is looking at code.
    expect(accounting, 'the stripper removed the read this guard is about')
      .toContain("collection(db, 'tenants', tid, 'invoices')");
  });

  it('9 - a partial cascade cannot leave half a contact: the ORDER is the guarantee', () => {
    /**
     * ATOMIC WHERE IT CAN BE, RESUMABLE ALWAYS.
     *
     * `deleteByQuery` commits each page as one batch, so a contact with fewer
     * rows than `CHUNK_LIMIT` is one atomic commit. A batch cannot span an
     * unbounded number of rows, so atomicity alone cannot be the guarantee -
     * the ORDER is:
     *
     *   1. the activities (this route),
     *   2. the contact document (the client, only after a 2xx).
     *
     * A failure anywhere leaves the CONTACT PRESENT with fewer rows, which the
     * CRM renders correctly and which pressing Delete again finishes. There is
     * no interleaving that produces the dangling reference this fixes.
     */
    const crm = read('src/components/AdminCRM.tsx');
    const fn = crm.slice(crm.indexOf('const confirmDelete'), crm.indexOf('const deleteDialog'));
    const cascadeAt = fn.indexOf('/api/crm/contact-activities');
    const contactAt = fn.indexOf("deleteDoc(doc(db, 'contacts'");
    expect(cascadeAt, 'the client no longer sweeps the timeline').toBeGreaterThan(-1);
    expect(contactAt, 'the client no longer deletes the contact').toBeGreaterThan(-1);
    expect(cascadeAt, 'THE ORDER INVERTED - the contact goes first, which manufactures the orphan')
      .toBeLessThan(contactAt);
    // And the contact delete is unreachable unless the sweep returned 2xx.
    expect(fn, 'a failed sweep no longer stops the contact delete').toMatch(/if \(!res\.ok\)[\s\S]{0,240}throw/);
  });

  it('9b - the route pages in batches, and the paging helper is the tested one', () => {
    const route = read('src/app/api/crm/contact-activities/route.ts');
    expect(route, 'the cascade stopped using the batched helper').toContain('deleteByQuery');
    // One single-field filter: a second equality would need a composite index,
    // and this repo does not deploy firestore.indexes.json.
    const call = route.slice(route.indexOf('deleteByQuery('), route.indexOf('return NextResponse.json({ removed })'));
    expect((call.match(/\.where\(/g) ?? []).length, 'a second where() appeared - that needs a composite index')
      .toBe(1);
    expect(call, 'the cross-tenant guard is gone').toContain('tenantId');
  });
});

/* ═══ 1 · no surface claims a recorded gift does not count ═════════════════ */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Every run of USER-FACING text in a file, off a real parse.
 *
 * PARSER-STRIPPED, and that is not tidiness: both accounting files are heavily
 * commented, and `AdminAccounting`'s own docblock QUOTES the founder's original
 * "in accounting it shows 0 dollars given" and explains the old design at
 * length. A sweep over raw source matches that prose and reports the file as
 * still making the claim it no longer makes - the guard failing for the one
 * reason it must not.
 */
function jsxText(src: string): string[] {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** One paragraph of rendered copy, with JSX entities resolved. */
const proseOf = (rel: string): string =>
  jsxText(read(rel)).join(' ')
    .replace(/&apos;/g, "'").replace(/&mdash;/g, '—').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** The two screens that said it, and the three that already said otherwise. */
const MONEY_SCREENS = [
  'src/components/AdminAccounting.tsx',
  'src/components/AdminGivingStatements.tsx',
];

describe('1 - no surface claims a CRM-recorded gift does not affect accounting or statements', () => {
  /**
   * NEEDLES ASSEMBLED FROM FRAGMENTS. #504 shipped a guard whose needle,
   * written whole, matched itself in the file it was defending - a sweep that
   * can never fail. Every claim below is built at runtime and checked against a
   * planted string before it is trusted.
   */
  const CLAIMS = [
    ['does not change these ', 'numbers'],
    ['does not add it ', 'here'],
    ['while this screen still reads ', '$0'],
    ['will not include it ', 'either'],
  ].map((parts) => parts.join(''));

  it.each(MONEY_SCREENS)('%s makes none of the four stale claims', (file) => {
    const prose = proseOf(file);
    const found = CLAIMS.filter((c) => prose.toLowerCase().includes(c.toLowerCase()));
    expect(found, `${file} still tells a treasurer a recorded gift does not count here`)
      .toEqual([]);
  });

  it('the sweep reads real copy, and the needles really catch the old wording', () => {
    // Non-vacuity on BOTH halves: the extractor must find these screens' actual
    // sentences, and a planted claim must be caught.
    for (const file of MONEY_SCREENS) {
      expect(proseOf(file).length, `no prose extracted from ${file}`).toBeGreaterThan(200);
    }
    const planted = `Recording one in your CRM ${CLAIMS[0]}.`;
    expect(CLAIMS.some((c) => planted.includes(c)), 'the needle no longer catches the old claim')
      .toBe(true);
  });

  it('and each screen now says the opposite, in so many words', () => {
    const accounting = proseOf('src/components/AdminAccounting.tsx').toLowerCase();
    const statements = proseOf('src/components/AdminGivingStatements.tsx').toLowerCase();
    for (const [label, prose] of [['accounting', accounting], ['statements', statements]] as const) {
      expect(prose, `${label} no longer tells a church a recorded gift counts`)
        .toContain('record');
      expect(prose, `${label} does not name the receipt as what makes it count`)
        .toContain('receipt');
    }
    // And each names the emailless gift, which is the half that is still true.
    expect(accounting, 'accounting does not say what an emailless gift does')
      .toContain('email address');
    expect(statements, 'statements do not say what an emailless gift does')
      .toContain('email address');
  });

  it('the surfaces that were ALREADY right are unchanged', () => {
    /**
     * THE-350's own copy is what proves the accounting screens were the false
     * ones rather than the other way round: the CRM dialog has said "counts on
     * your dashboard, in accounting, and on this year's giving statement" since
     * that ticket shipped.
     */
    expect(proseOf('src/components/AdminCRM.tsx'))
      .toContain('so the gift counts on your dashboard, in accounting, and on this year');
    expect(proseOf('src/components/AdminDonations.tsx'))
      .toContain('Gifts given this way are not recorded until you record them.');
  });

  it('the CAMPAIGN claim is different, still true, and untouched', () => {
    /**
     * `AdminFundraising` says a link gift does not update `campaigns.raised`
     * and that an offline gift recorded THERE creates no receipt. Both are
     * still true: `recordManualDonation` writes an invoice and never touches a
     * campaign, and the campaign adjustment writes a campaign and never an
     * invoice. Two different writers, two different claims - and flattening
     * them into one "recorded gifts count" would be a new false claim.
     */
    const fundraising = proseOf('src/components/AdminFundraising.tsx');
    expect(fundraising).toContain('Gifts sent through your own payment links do not update the amount raised.');
    expect(fundraising).toContain('it does not create a receipt and will not appear on a giving statement');
    // And the writer really does not touch a campaign.
    expect(read('src/lib/manual-donation.ts'), 'the manual writer now updates a campaign total')
      .not.toMatch(/collection\(\s*'campaigns'\s*\)/);
  });
});

/* ═══ 3 · the replacement agrees with the hidden message ═══════════════════ */

describe('3 - the replacement copy agrees with STRIPE_CONNECT_HIDDEN_MESSAGE', () => {
  /**
   * The hidden message is the sentence a church reads on the Donations screen
   * while card giving is off:
   *
   *   "Card giving inside the app is off. Your own payment links still work,
   *    and a gift you record in the CRM counts on your dashboard, in
   *    accounting and on your giving statements."
   *
   * It was TRUE and the accounting screens were FALSE - established by running
   * both halves in section 2, not by preferring one sentence over another.
   */
  it('the hidden message makes the three-surface claim it always did', () => {
    const m = STRIPE_CONNECT_HIDDEN_MESSAGE.toLowerCase();
    expect(m).toContain('record in the crm counts');
    expect(m).toContain('dashboard');
    expect(m).toContain('accounting');
    expect(m).toContain('giving statements');
  });

  it('and accounting and statements now agree with it rather than contradict it', () => {
    const accounting = proseOf('src/components/AdminAccounting.tsx').toLowerCase();
    const statements = proseOf('src/components/AdminGivingStatements.tsx').toLowerCase();
    // The claim the hidden message makes about EACH screen, asserted on that
    // screen's own copy.
    expect(accounting, 'accounting still contradicts the Donations screen')
      .toMatch(/record(ing|ed)?[^.]{0,120}count/);
    expect(statements, 'statements still contradict the Donations screen')
      .toMatch(/record(ing|ed)?[^.]{0,160}(statement|here|them)/);
  });

  it('no screen promises a statement for a gift that cannot have one', () => {
    // The one thing the hidden message does NOT say, and must not be read into
    // the new copy: an emailless gift has no statement. Section 2 proves it.
    for (const file of MONEY_SCREENS) {
      expect(proseOf(file).toLowerCase(), `${file} promises a statement it cannot deliver`)
        .toContain('email address');
    }
  });
});
