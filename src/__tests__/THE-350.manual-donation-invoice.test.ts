import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-350 — a manual donation must write an INVOICE, not just a CRM note.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE DEFECT
 *
 * The founder: "If I add a donation from a user in CRM it updates the CRM but
 * not the dashboard."
 *
 * Because there were TWO records of a gift and only ONE of them counted.
 * `tenants/{t}/invoices` is THE money ledger — the Overview tab sums it,
 * AdminAccounting reads it, the year-end giving statement aggregates it, and
 * `/api/donation-history` is how a MEMBER retrieves their own receipts — and
 * its only writer was the Stripe donation webhook. A manual CRM donation wrote
 * a `contactActivities` row, which nothing downstream reads as money.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ HOW THIS SUITE AVOIDS THE WAYS ITS PREDECESSORS FAILED
 *
 * THIRTEEN guards in this series passed a planted defect. Each is answered:
 *
 *   · one read a DOCBLOCK 700 LINES AWAY, and one was satisfied because an
 *     IMPORT LINE carried the word → every content assertion runs over
 *     {@link codeOf}, and §0 proves that stripper does not eat the files it is
 *     pointed at (`86bbxkawp`: an inherited stripper ate ~150 lines of a real
 *     file from its first `https://` onward).
 *   · two were VACUOUS because an empty `slice` made them trivially true →
 *     every sweep asserts its own population is non-empty first.
 *   · one hardcoded the element ORDER (#490's own guard) → nothing here asserts
 *     a position; the writer's fields are checked by NAME and the surfaces by
 *     the figures they produce.
 *   · one pinned a LINE NUMBER — THE-331 named a component file and a line in
 *     it, a deletion moved the line, and the suite would have measured whatever
 *     landed there instead of failing → §19 asserts this file names none, so it
 *     cannot spell an example of one either.
 *
 * 🔴 THE MONEY ASSERTIONS RUN THE REAL CODE. `recordManualDonation` writes into
 * the `firestore-tree` fake, and the SAME documents are then read back by the
 * real `/api/donation-history` route, the real giving-statement generator, the
 * real dashboard mappers and the real GDPR export/erasure. A gift the writer
 * "records" that those readers cannot see fails here, which is the entire bug.
 *
 * 🔴 NOTHING HERE ASKS WHAT THIS BRANCH CHANGED (#454). No child process, no
 * version-control invocation, no diff. Every claim is made against files on disk.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');

/**
 * Source with block and line comments stripped — the CODE, not the prose.
 *
 * ⚠️ The `//` arm requires a non-`:` character before the slashes so a
 * `https://` inside a string literal is not read as a comment. That is the
 * exact defect behind `86bbxkawp`.
 */
const codeOfString = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOf = (rel: string): string => codeOfString(read(rel));

const WRITER = 'src/lib/manual-donation.ts';
const AMOUNT = 'src/lib/donation-amount.ts';
const ROUTE = 'src/app/api/donations/manual/route.ts';
const CRM = 'src/components/AdminCRM.tsx';
const SELF = 'src/__tests__/THE-350.manual-donation-invoice.test.ts';

// ═══════════════════════════════════════════════════════════════════════════
// The fakes. Everything below writes and reads REAL documents in the tree.
// ═══════════════════════════════════════════════════════════════════════════

const tree = await import('@/test/mocks/firestore-tree');

vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb, adminAuth: m.adminAuth, getReceiptsBucket: m.getReceiptsBucket };
});
vi.mock('firebase-admin/firestore', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  // `getFirestore` is what `member-export.ts` reaches for at import time; the
  // fake's `adminDb` is the same tree every write above lands in.
  return { FieldValue: m.FieldValue, getFirestore: () => m.adminDb, Timestamp: { now: () => new Date() } };
});
vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: vi.fn(),
  captureMoneyPathError: vi.fn(),
}));

/**
 * 🔴 ONLY THE TOKEN IS STUBBED. `requireAuth` is what turns a request into a
 * verified identity, and there is no signed token to verify in a unit run — so
 * it is replaced and EVERYTHING ELSE in `api-auth` stays real. The ownership
 * gate the security sections lean on is the ROUTE's own comparison of that
 * identity against the stored `recipientEmail`, and it is never mocked.
 */
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));
vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireAuth: mockRequireAuth,
}));

const {
  recordManualDonation,
  isManuallyRecordedDonation,
  MANUAL_DONATION_SOURCES,
} = await import('@/lib/manual-donation');
const { dollarsToCents } = await import('@/lib/donation-amount');
const { normalizeEmail, formatCents, computeTotals, invoiceToRow } =
  await import('@/lib/donation-history');
const { toInvoiceRow, readableReceipts } = await import('@/components/dashboard/dashboard-data');

const TENANT = 'grace';
const INVOICES = `tenants/${TENANT}/invoices`;

/** A gift of $105.50 — the figure whose cent/dollar inversion shipped once. */
const GIFT_DOLLARS = '105.50';
const GIFT_CENTS = 10550;

const seedTenant = () => {
  tree.__seed('tenants', [{ id: TENANT, name: 'Grace Chapel' }]);
};

beforeEach(() => {
  tree.__reset();
  tree.recordedWheres.length = 0;
  tree.recordedReads.length = 0;
  seedTenant();
  /**
   * 🔴 A FIXED CLOCK, AND `toFake` IS LOAD-BEARING. Without it vitest fakes
   * every timer and the async route handlers below never settle. The date is
   * deliberately FAR FROM TODAY so this suite cannot start passing or failing
   * because of when it is run — a fixture pinned near the present is a test
   * with a shelf life.
   */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2021-06-15T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Record one gift through the real writer and hand back its result. */
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

/** Every invoice document currently in the tenant's ledger. */
const ledger = () => tree.__docs(INVOICES).map(([, d]) => d);

// ═══════════════════════════════════════════════════════════════════════════
// 0 · The instrument, before anything measured with it
// ═══════════════════════════════════════════════════════════════════════════
describe('0 — the comment stripper does not eat the code it is pointed at', () => {
  it('🔴 keeps almost every non-comment line of every file this suite reads', () => {
    const files = [WRITER, AMOUNT, ROUTE, CRM, SELF];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const rawCode = read(f).split('\n').filter((l) => {
        const t = l.trim();
        return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      }).length;
      const stripped = codeOf(f).split('\n').filter((l) => l.trim() !== '').length;
      expect(stripped / rawCode, `${f}: the stripper ate too much`).toBeGreaterThan(0.7);
    }
  });

  it('🔴 still removes comments, so the assertions below read code and not prose', () => {
    expect(codeOf(WRITER)).not.toContain('THE ONE FUNCTION THAT WRITES');
    expect(read(WRITER)).toContain('THE ONE FUNCTION THAT WRITES');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 THE WHOLE TICKET
// ═══════════════════════════════════════════════════════════════════════════
describe('1 — a manual CRM donation writes an INVOICE', () => {
  it('🔴 writes one `donation_receipt` into the tenant money ledger', async () => {
    expect(ledger(), 'the ledger was not empty before the write').toHaveLength(0);

    const result = await record();

    expect(result.ok, result.error).toBe(true);
    expect(result.invoiceId).toBeTruthy();

    const rows = ledger();
    expect(rows, 'the manual donation wrote no invoice — this is the bug').toHaveLength(1);
    expect(rows[0].type, 'the document is not the shape every reader filters on')
      .toBe('donation_receipt');
  });

  it('🔴 the receipt carries every field the five readers require', () => {
    // Named, never positional — #490 found one of its own guards hardcoding the
    // element ORDER. Each of these is read by at least one live surface.
    const REQUIRED = [
      'type',            // every reader filters on it
      'recipientEmail',  // the identity key — donation-history + statements
      'amount',          // cents — dashboard, accounting, statements
      'currency',        // invoiceToRow
      'description',     // statements + the member's receipt row
      'receiptNumber',   // AdminAccounting's search filter lowercases it
      'recipientName',   // AdminAccounting's search filter lowercases it
      'issuedAt',        // every date bucket
      'tenantName',      // invoiceToRow
      'pdfUrl',          // invoiceToRow derives hasPdf from it
      'source',          // THE-350 — manual vs processed
    ];
    const src = codeOf(WRITER);
    const addCall = src.slice(src.indexOf('.add({'), src.indexOf('});', src.indexOf('.add({')));
    expect(addCall.length, 'the invoice write could not be located').toBeGreaterThan(100);
    for (const field of REQUIRED) {
      expect(addCall, `the invoice write dropped \`${field}\``).toContain(`${field}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 THE FOUNDER'S EXACT COMPLAINT, AND THE OTHER FOUR SURFACES
// ═══════════════════════════════════════════════════════════════════════════
describe('2 — the dashboard figure includes it', () => {
  it("🔴 the Overview tab's giving total moves by exactly the gift", async () => {
    await record();

    // The REAL dashboard mappers, not a replica of them.
    const rows = ledger().map((d) => toInvoiceRow(d as Record<string, unknown>));
    const readable = readableReceipts(rows);

    // 🔴 `unavailable` is what the dashboard answers when a receipt cannot be
    // summed — a REFUSAL rather than a smaller number. A manual gift must never
    // produce one, or the whole giving figure disappears with it.
    expect(readable.kind, 'the dashboard refused the whole ledger over the manual receipt')
      .toBe('complete');
    const receipts = (readable as { kind: 'complete'; rows: { amountCents: number }[] }).rows;
    expect(receipts, 'the manual receipt is not a readable receipt').toHaveLength(1);
    const total = receipts.reduce((s, r) => s + r.amountCents, 0);
    expect(total, 'the dashboard giving figure did not move by the gift').toBe(GIFT_CENTS);
    // 🔴 And it renders as $105.50 — never $10,550,000.
    expect(formatCents(total)).toBe('$105.50');
  });
});

describe('3 — accounting includes it', () => {
  it('🔴 AdminAccounting still reads this collection, in cents, and divides once', () => {
    // The reader has to actually be the one this ticket claims it is. If
    // AdminAccounting stops reading `invoices`, or stops dividing, the claim
    // "accounting includes it" is about a screen that no longer exists.
    const acct = codeOf('src/components/AdminAccounting.tsx');
    expect(acct, 'AdminAccounting no longer reads the invoices collection')
      .toMatch(/collection\(db,\s*'tenants',\s*tid,\s*'invoices'\)/);
    expect(acct, 'AdminAccounting no longer normalises cents to dollars')
      .toMatch(/amount:\s*\(data\.amount \|\| 0\) \/ 100/);
  });

  it('🔴 the manual receipt survives every field AdminAccounting touches', async () => {
    await record();
    const inv = ledger()[0] as Record<string, unknown>;

    // It sums UNFILTERED over the collection, so a `donation_receipt` is in the
    // This Month / This Year totals by construction. What could still break it:
    const { toSafeDate } = await import('@/utils/format-date');
    const issued = toSafeDate(inv.issuedAt as never);
    expect(issued, 'the receipt has no date accounting can bucket it by').toBeTruthy();
    expect(issued!.getFullYear()).toBe(2021);
    expect(typeof inv.amount, 'accounting divides `amount` by 100').toBe('number');
    expect((inv.amount as number) / 100).toBe(105.5);

    // 🔴 Its search filter calls `.toLowerCase()` on all three of these. A null
    // in any one throws and takes the whole invoices table down with it.
    for (const f of ['recipientName', 'recipientEmail', 'receiptNumber']) {
      expect(typeof inv[f], `\`${f}\` is not a string — AdminAccounting's search will throw`)
        .toBe('string');
    }
  });
});

describe('4 — the MEMBER sees it in their own donation history', () => {
  it('🔴 matched by NORMALISED email, through the real route', async () => {
    await record({ email: 'Grace.Giver@Example.ORG' });

    const { GET } = await import('@/app/api/donation-history/route');

    // The route reads the caller's identity from a verified token; the helper is
    // exercised for real in its own suite, so here the same normalisation the
    // route applies is applied to a member whose casing differs from the stored
    // one — which is the property that matters.
    const stored = ledger()[0].recipientEmail as string;
    expect(normalizeEmail('GRACE.GIVER@example.org'), 'the two sides do not normalise alike')
      .toBe(normalizeEmail(stored));

    // And the row the member is handed is the gift, in cents, dated.
    const row = invoiceToRow('inv-1', ledger()[0] as Record<string, unknown>);
    expect(row.amountCents).toBe(GIFT_CENTS);
    expect(row.description).toBe('Sunday offering, cash');
    expect(row.tenantName).toBe('Grace Chapel');
    expect(row.hasPdf, 'a manual gift has no PDF, so no download may be offered').toBe(false);
    expect(row.date, 'the member is shown an undated gift').toBeTruthy();
    expect(GET, 'the donation-history route disappeared').toBeTypeOf('function');
  });

  it('🔴 the route and the writer run the SAME normaliser — not two spellings of it', () => {
    for (const f of [WRITER, 'src/app/api/donation-history/route.ts']) {
      expect(codeOf(f), `${f} does not import the shared normaliser`)
        .toMatch(/normalizeEmail/);
      // 🔴 The EMAIL specifically: a hand-rolled `email.trim().toLowerCase()`
      // is a second normaliser that drifts the day the shared one changes.
      // (`currency` is lower-cased inline and is not an identity key.)
      expect(codeOf(f), `${f} hand-rolls the email normalisation instead of importing one`)
        .not.toMatch(/[eE]mail[^;\n]*\.trim\(\)\s*\.toLowerCase\(\)/);
    }
  });
});

describe('5 — it lands in the right per-year total and the giving statement', () => {
  it('🔴 the per-year bucket is the year it was issued, and nothing else', async () => {
    await record();
    const rows = ledger().map((d, i) => invoiceToRow(`inv-${i}`, d as Record<string, unknown>));
    const totals = computeTotals(rows);
    expect(totals.lifetimeCents).toBe(GIFT_CENTS);
    expect(totals.count).toBe(1);
    expect(totals.byYear, 'the gift fell into no year bucket, or the wrong one')
      .toEqual({ '2021': GIFT_CENTS });
  });

  it('🔴 the giving-statement generator aggregates it, through the real route', async () => {
    await record();

    // The generator's own reading of this collection, applied to what the writer
    // actually wrote: type, year, a non-empty lowercased email, and `amount` as
    // cents. Every one of those four is a way a manual gift could be dropped.
    const gen = codeOf('src/app/api/giving-statements/generate/route.ts');
    expect(gen, 'the generator stopped filtering on donation_receipt')
      .toMatch(/inv\.type !== 'donation_receipt'/);
    expect(gen, 'the generator stopped keying donors by lowercased recipientEmail')
      .toMatch(/\(inv\.recipientEmail \|\| ''\)\.toLowerCase\(\)/);
    expect(gen, 'the generator stopped summing `amount`').toMatch(/donor\.total \+= inv\.amount/);

    const inv = ledger()[0];
    expect(inv.type).toBe('donation_receipt');
    const donorKey = String(inv.recipientEmail || '').toLowerCase();
    expect(donorKey, 'the generator would skip this receipt for having no donor key').not.toBe('');
    const { toSafeDate } = await import('@/utils/format-date');
    expect(toSafeDate(inv.issuedAt as never)!.getFullYear()).toBe(2021);
    expect(inv.amount).toBe(GIFT_CENTS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 🔴 THE UNIT. The $10,550,000 bug, from the write side.
// ═══════════════════════════════════════════════════════════════════════════
describe('6 — the amount is stored in integer CENTS and displayed via formatCents', () => {
  it('🔴 $105.50 is stored as 10550, not 105.5 and not 1055000', async () => {
    await record();
    expect(ledger()[0].amount).toBe(10550);
    expect(Number.isInteger(ledger()[0].amount as number)).toBe(true);
  });

  it('🔴 the writer REFUSES dollars handed to it as if they were cents', async () => {
    // The inversion, planted: a caller that forgot to convert passes 105.5.
    const r = await record({ amountCents: 105.5 });
    expect(r.ok, 'a non-integer amount was accepted into the money ledger').toBe(false);
    expect(r.code).toBe('invalid_amount');
    expect(ledger(), 'a refused amount still wrote a document').toHaveLength(0);
  });

  it('🔴 and it refuses zero, negatives, NaN and Infinity', async () => {
    for (const bad of [0, -1, -10550, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 2]) {
      const r = await record({ amountCents: bad });
      expect(r.ok, `${bad} was accepted as an amount of money`).toBe(false);
      expect(r.code).toBe('invalid_amount');
    }
    expect(ledger()).toHaveLength(0);
  });

  it('🔴 `dollarsToCents` rounds the float instead of trusting it', () => {
    /**
     * 🔴 THE HAZARD IS REAL AND IS DEMONSTRATED, not asserted about. `1.10 * 100`
     * is 110.00000000000001 and `8.20 * 100` is 819.9999999999999 in IEEE 754 —
     * neither is a safe integer, so without the rounding `recordManualDonation`
     * would REFUSE two perfectly ordinary gifts and the obvious "fix" (relaxing
     * the writer to take floats) would reopen the dollars-as-cents door.
     */
    for (const hazard of ['1.10', '8.20', '0.29', '16.08']) {
      expect(Number.isSafeInteger(Number(hazard) * 100),
        `${hazard} is no longer a float hazard — this check has gone stale`).toBe(false);
      expect(Number.isSafeInteger(dollarsToCents(hazard)!),
        `${hazard} did not survive the conversion as integer cents`).toBe(true);
    }
    expect(dollarsToCents('1.10')).toBe(110);
    expect(dollarsToCents('8.20')).toBe(820);
    expect(dollarsToCents(GIFT_DOLLARS)).toBe(GIFT_CENTS);
    expect(dollarsToCents('0.01')).toBe(1);
    expect(dollarsToCents('1000000')).toBe(100000000);
    // 🔴 Refuses rather than coercing to 0 — a gift silently recorded as $0.00
    // would show a timeline entry and move no figure at all.
    for (const bad of ['', '   ', 'abc', '0', '-5', '0.004', null, undefined, NaN, Infinity]) {
      expect(dollarsToCents(bad as never), `${JSON.stringify(bad)} became a number of cents`)
        .toBeNull();
    }
  });

  it('🔴 every dollar value on the manual path goes through formatCents', () => {
    // The CRM renders the mirror through the one cents formatter, never through
    // its own dollar `fmt()` — reading cents with the dollar formatter IS the
    // $10,550,000 bug.
    const crm = codeOf(CRM);
    expect(crm, 'the CRM does not import the one cents formatter')
      .toMatch(/import \{ formatCents \} from '\.\.\/lib\/donation-history'/);
    expect(crm, 'the CRM formats the cents mirror with the dollar formatter')
      .not.toMatch(/fmt\(\s*act\.invoiceAmountCents/);
    expect(crm, 'the cents mirror is not rendered through formatCents')
      .toMatch(/formatCents\(act\.invoiceAmountCents\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 & 9 · 🔴 THE SECURITY CRUX
// ═══════════════════════════════════════════════════════════════════════════
describe('7 — the email is normalised the same way on BOTH sides', () => {
  it('🔴 trim AND lowercase, on the way in', async () => {
    await record({ email: '  Grace.Giver@Example.ORG  ' });
    expect(ledger()[0].recipientEmail, 'the stored email was not normalised')
      .toBe('grace.giver@example.org');
  });

  it('🔴 the stored value is a FIXED POINT of the readers\' own normaliser', async () => {
    // The property that makes the match hold whichever side normalises: running
    // the readers' normaliser over what was written changes nothing.
    for (const typed of ['GRACE.GIVER@EXAMPLE.ORG', ' grace.giver@example.org ', 'Grace.Giver@Example.Org']) {
      tree.__reset();
      seedTenant();
      await record({ email: typed });
      const stored = ledger()[0].recipientEmail as string;
      expect(normalizeEmail(stored), `\`${typed}\` did not survive the round trip`).toBe(stored);
      expect(stored).toBe('grace.giver@example.org');
    }
  });
});

describe('9 — User A cannot see User B\'s receipts, regardless of casing', () => {
  /**
   * 🔴 RUN THROUGH THE REAL ROUTE, over gifts the REAL writer recorded.
   *
   * Two members of one church, each with a gift, each recorded from a DIFFERENT
   * casing than the one on their auth token. Only `requireAuth` is stubbed —
   * the ownership gate, the scan and the normalisation are the route's own.
   */
  const historyFor = async (tokenEmail: string) => {
    mockRequireAuth.mockResolvedValue({
      uid: 'u', email: tokenEmail, tenantId: TENANT,
      isAdmin: false, isSuperAdmin: false, authTime: 0,
    });
    const { GET } = await import('@/app/api/donation-history/route');
    const res = await GET(new NextRequest(
      `https://grace.theharvest.app/api/donation-history?tenantId=${TENANT}`, { method: 'GET' },
    ));
    return (await res.json()) as {
      receipts: { amountCents: number; description: string }[];
      totals: { lifetimeCents: number };
    };
  };

  it('🔴 each member is handed their OWN gift and nobody else\'s', async () => {
    await record({ email: 'Alice@Example.ORG', description: "Alice's gift", amountCents: 10550 });
    await record({ email: '  BOB@example.org ', description: "Bob's gift", amountCents: 2500 });
    expect(ledger(), 'the two gifts were not both recorded').toHaveLength(2);

    const alice = await historyFor('alice@example.org');
    expect(alice.receipts.map((r) => r.description), "Alice was shown Bob's receipt")
      .toEqual(["Alice's gift"]);
    expect(alice.totals.lifetimeCents, "Alice's lifetime total includes another member's gift")
      .toBe(10550);

    const bob = await historyFor('BOB@Example.Org');
    expect(bob.receipts.map((r) => r.description), "Bob was shown Alice's receipt")
      .toEqual(["Bob's gift"]);
    expect(bob.totals.lifetimeCents).toBe(2500);

    // Non-vacuity: a member of the same church who gave nothing sees nothing,
    // so "Alice sees one row" is about the match and not about the route
    // returning everything it finds.
    const stranger = await historyFor('carol@example.org');
    expect(stranger.receipts, 'a non-giver was handed somebody else\'s receipts').toEqual([]);
  });

  it('🔴 the stored key is CANONICAL, which is what keeps one giver from becoming two', async () => {
    /**
     * 🔴 THE READER THAT DOES NOT TRIM. `/api/giving-statements/generate` groups
     * donors by `(inv.recipientEmail || '').toLowerCase()` and filters a single
     * donor by `body.donorEmail?.toLowerCase()` — NEITHER side is trimmed. So a
     * `recipientEmail` that is merely trimmed, or merely lowercased, and not
     * both, becomes its OWN donor group: the same giver splits into two rows
     * with two partial totals, and the per-donor re-issue never matches one of
     * them. Writing the already-normalised form is what closes that, and it is
     * the reason this path normalises on the way IN rather than trusting every
     * reader to normalise on the way out.
     */
    const gen = codeOf('src/app/api/giving-statements/generate/route.ts');
    expect(gen, 'the generator started trimming — this hazard has changed shape')
      .toMatch(/body\.donorEmail\?\.toLowerCase\(\)/);
    expect(gen).toMatch(/\(inv\.recipientEmail \|\| ''\)\.toLowerCase\(\)/);

    for (const typed of ['Alice@Example.ORG', '  alice@example.org  ', ' Alice@Example.Org ']) {
      tree.__reset(); seedTenant();
      await record({ email: typed });
      const stored = ledger()[0].recipientEmail as string;
      // 🔴 The generator's own grouping key, computed the way it computes it.
      const donorKey = String(stored).toLowerCase();
      expect(donorKey, `\`${typed}\` produced a donor key of its own instead of the canonical one`)
        .toBe('alice@example.org');
      expect(stored, 'the stored value is not already canonical').toBe(normalizeEmail(stored));
    }
  });

  it('🔴 a different address never matches, however it is cased', async () => {
    await record({ email: 'Alice@Example.org' });
    const stored = ledger()[0].recipientEmail as string;

    for (const other of ['bob@example.org', 'BOB@EXAMPLE.ORG', ' Bob@Example.org ', 'alice@example.com', 'alice@sub.example.org']) {
      expect(normalizeEmail(other), `${other} matched Alice's receipt`).not.toBe(normalizeEmail(stored));
    }
    // Non-vacuity: Alice's OWN address, in any casing, does match.
    for (const mine of ['alice@example.org', 'ALICE@EXAMPLE.ORG', '  Alice@Example.Org ']) {
      expect(normalizeEmail(mine), `${mine} failed to match Alice's own receipt`)
        .toBe(normalizeEmail(stored));
    }
  });

  it('🔴 an EMPTY stored email can never match a caller — both sides refuse it', async () => {
    await record({ email: null });
    expect(ledger()[0].recipientEmail).toBe('');

    // The route refuses an empty CALLER before it queries at all.
    const route = codeOf('src/app/api/donation-history/route.ts');
    expect(route, 'the history route no longer refuses an empty caller email')
      .toMatch(/if \(!normalizedCaller\)/);
    // The statement generator skips an empty STORED email.
    expect(codeOf('src/app/api/giving-statements/generate/route.ts'),
      'the statement generator no longer skips an empty recipient email')
      .toMatch(/if \(!donorEmail\) continue;/);
    // And both GDPR paths guard on a non-empty subject email.
    for (const f of ['src/lib/member-export.ts', 'src/lib/member-erasure.ts']) {
      expect(codeOf(f), `${f} no longer guards on a non-empty subject email`)
        .toMatch(/if \(!ctx\.email\)/);
    }

    // 🔴 And end to end: a member with an address sees nothing of it.
    const someone = await historyFor('alice@example.org');
    expect(someone.receipts, 'an emailless gift leaked into a member\'s history').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · 🔴 A GIFT WITH NO EMAIL DOES NOT SILENTLY VANISH
// ═══════════════════════════════════════════════════════════════════════════
describe('8 — a gift with no email does not silently vanish', () => {
  /**
   * 🔴 THE NAMED BEHAVIOUR, and it is a CHOICE among three.
   *
   * Refuse · record it as anonymous and say so · require an email. THE-350
   * RECORDS IT AND SAYS SO, because refusing would lose the church's own record
   * of a cash gift from someone who has no email — money it really received,
   * which belongs on the dashboard and in the books whether or not anyone can
   * be shown a receipt. What is not acceptable is recording it silently.
   */
  it('🔴 the gift IS recorded, and counts for the church', async () => {
    const r = await record({ email: null, recipientName: 'Walk-in giver' });
    expect(r.ok, 'a gift from someone with no email was lost').toBe(true);
    expect(ledger()).toHaveLength(1);
    const read = readableReceipts(ledger().map((d) => toInvoiceRow(d as Record<string, unknown>)));
    expect(read.kind, 'the dashboard refused the emailless receipt').toBe('complete');
    const receipts = (read as { kind: 'complete'; rows: { amountCents: number }[] }).rows;
    expect(receipts.reduce((sum, r) => sum + r.amountCents, 0),
      'the emailless gift is missing from the dashboard figure').toBe(GIFT_CENTS);
  });

  it('🔴 and the writer SAYS the member will never see it', async () => {
    const withEmail = await record();
    expect(withEmail.visibleToMember).toBe(true);

    tree.__reset(); seedTenant();
    const without = await record({ email: '   ' });
    expect(without.ok).toBe(true);
    expect(without.visibleToMember,
      'the caller was not told the giver can never see this gift').toBe(false);
    expect(without.recipientEmail).toBe('');
  });

  it('🔴 the route passes that fact on, and the CRM puts it ON SCREEN before the save', () => {
    expect(codeOf(ROUTE), 'the route swallows visibleToMember')
      .toMatch(/visibleToMember:\s*result\.visibleToMember/);

    const crm = codeOf(CRM);
    // The notice is rendered when the contact has no email, in the dialog, and
    // it is not conditional on anything having been saved yet.
    expect(crm, 'the CRM shows nothing when a contact has no email')
      .toMatch(/manual-donation-no-email/);
    expect(crm, 'the no-email notice is not gated on the contact actually lacking an email')
      .toMatch(/!\(selected\?\.email \|\| ''\)\.trim\(\)/);
    // And it says the consequence in words, not as a shrug.
    const raw = read(CRM);
    expect(raw, 'the notice does not name the consequence')
      .toMatch(/will never see it in their own donation history/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · 🔴 THE GIFT IS NOT COUNTED TWICE
// ═══════════════════════════════════════════════════════════════════════════
describe('10 — the gift is NOT counted twice — invoice and activity', () => {
  it('🔴 the writer creates exactly ONE money-bearing document', async () => {
    await record();
    expect(ledger(), 'more than one invoice was written for one gift').toHaveLength(1);
    // And it writes to `invoices` and nowhere else — no second ledger, no
    // money-bearing activity of its own.
    expect(codeOf(WRITER), 'the writer touches contactActivities')
      .not.toMatch(/contactActivities/);
    const collections = [...(codeOf(WRITER).matchAll(/\.collection\('([^']+)'\)/g))].map((m) => m[1]);
    expect(collections.length, 'no collection call was found — the sweep is vacuous')
      .toBeGreaterThan(0);
    expect([...new Set(collections)].sort()).toEqual(['invoices', 'tenants']);
  });

  it('🔴 the CRM activity LINKS to the invoice and carries NO money', () => {
    const crm = codeOf(CRM);
    const add = crm.slice(
      crm.indexOf("addDoc(collection(db, 'contactActivities')"),
      crm.indexOf('});', crm.indexOf("addDoc(collection(db, 'contactActivities')")),
    );
    expect(add.length, "the CRM's activity write could not be located").toBeGreaterThan(100);

    // 🔴 `amount` is the field the webhook writes in DOLLARS and the field any
    // future money reader would reach for. On a gift recorded here it is null.
    expect(add, 'the activity write carries a money-bearing `amount`')
      .toMatch(/amount:\s*null,/);
    expect(add, 'the activity write computes an amount from the typed dollars')
      .not.toMatch(/\bamount:(?!\s*null\b)/);
    // And it points at the invoice, which is what makes it a link.
    expect(add, 'the activity does not reference the invoice').toMatch(/invoiceId,/);
  });

  it('🔴 nothing in the product sums `contactActivities` as money', () => {
    // The structural half of "not counted twice": if no surface adds up
    // activities, an invoice plus a linking activity cannot double-count on any
    // screen. Swept over comment-stripped source so a docblock cannot excuse it.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(p);
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(files.length, 'the sweep found no files — it is vacuous').toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs);
      const src = codeOfString(readFileSync(abs, 'utf8'));
      if (!/contactActivities/.test(src)) continue;
      // A reduce/sum over an activity amount is the shape that would double-count.
      if (/activit\w*\s*\.\s*reduce\s*\([^)]*amount/i.test(src)) offenders.push(rel);
    }
    expect(offenders, 'a surface sums contactActivities as money').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · 🔴 SOURCE
// ═══════════════════════════════════════════════════════════════════════════
describe('11 — source distinguishes a manual entry from a processed one', () => {
  it('🔴 the field is `source` and the manual values are named', async () => {
    await record({ source: 'crm_manual' });
    expect(ledger()[0].source, 'the invoice carries no source').toBe('crm_manual');
    expect([...MANUAL_DONATION_SOURCES].sort()).toEqual(['crm_manual', 'event_manual']);
  });

  it('🔴 a processed receipt is distinguishable — an absent source reads as processed', () => {
    // The Stripe webhook writes no `source` at all and is byte-pinned as a money
    // path this ticket must not touch, so the reading has to be one-way.
    expect(isManuallyRecordedDonation({ source: 'crm_manual' })).toBe(true);
    expect(isManuallyRecordedDonation({ source: 'event_manual' })).toBe(true);
    expect(isManuallyRecordedDonation({}), 'a webhook receipt was read as manual').toBe(false);
    expect(isManuallyRecordedDonation({ source: undefined })).toBe(false);
    expect(isManuallyRecordedDonation({ source: 'manual' }),
      'an unknown value was read as manual').toBe(false);
  });

  it('🔴 an unknown source is REFUSED rather than recorded as one', async () => {
    const r = await record({ source: 'made_up' as never });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid_source');
    expect(ledger(), 'a gift with an unknown source still reached the ledger').toHaveLength(0);
  });

  it('🔴 and the webhook receipts remain byte-identical — they are not restamped', () => {
    // Naming `source` on the webhook path would have meant editing
    // `donation-webhook.ts`, which `AdminDonations.section.test.tsx` pins as a
    // money path. It is untouched, which is why "absent means processed".
    expect(codeOf('src/lib/donation-webhook.ts'), 'the webhook grew a source field')
      .not.toMatch(/\bsource:\s*'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · 🔴 ONE TIMESTAMP REPRESENTATION
// ═══════════════════════════════════════════════════════════════════════════
describe('12 — one timestamp representation is written', () => {
  it('🔴 `issuedAt` is an ISO STRING, the same shape every webhook receipt holds', async () => {
    await record();
    const issuedAt = ledger()[0].issuedAt;
    expect(typeof issuedAt, 'issuedAt is not a string').toBe('string');
    expect(issuedAt).toBe('2021-06-15T12:00:00.000Z');
    // Not a Timestamp, and not a Date object either.
    expect((issuedAt as unknown as { toDate?: unknown }).toDate).toBeUndefined();
    expect(issuedAt instanceof Date).toBe(false);
  });

  it('🔴 and the writer cannot reach for the other representation', () => {
    const src = codeOf(WRITER);
    expect(src, 'the writer uses a server timestamp for issuedAt')
      .not.toMatch(/serverTimestamp|FieldValue\.serverTimestamp|Timestamp\./);
    expect(src, 'the writer no longer writes an ISO string').toMatch(/new Date\(\)\.toISOString\(\)/);
  });

  it('🔴 it matches what the webhook writes, which is why the ordering does not split', () => {
    // Firestore orders ACROSS TYPES BY TYPE FIRST, and three live readers use
    // `orderBy('issuedAt','desc').limit(N)` over this collection. A Timestamp
    // here would sort into a different band from every receipt already on disk
    // and could be truncated out of a giving statement entirely.
    const webhook = codeOf('src/lib/donation-webhook.ts');
    const issuedWrites = [...webhook.matchAll(/issuedAt:\s*(\w+)/g)].map((m) => m[1]);
    expect(issuedWrites.length, 'no webhook issuedAt write was found — the check is vacuous')
      .toBeGreaterThanOrEqual(3);
    expect([...new Set(issuedWrites)], 'the webhook no longer writes one representation')
      .toEqual(['nowIso']);
    expect(webhook).toMatch(/const nowIso = new Date\(\)\.toISOString\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13 · 🔴 ONE FUNCTION, ONE INTERFACE — THE-340's LESSON
// ═══════════════════════════════════════════════════════════════════════════
describe('13 — the writer is ONE function with ONE interface', () => {
  it('🔴 exported exactly once, from one module', () => {
    const src = codeOf(WRITER);
    expect([...src.matchAll(/export async function recordManualDonation/g)],
      'the writer is declared more than once').toHaveLength(1);
  });

  it('🔴 no second invoice writer exists anywhere in the product', () => {
    // THE-340 found ELEVEN inlined copies of a Resend send, none of them a
    // function. This is the sweep that stops the twelfth of anything.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(p);
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(files.length, 'the sweep found no files — it is vacuous').toBeGreaterThan(100);

    /**
     * The two files allowed to write an invoice document, and the reason each
     * is allowed:
     *   · `donation-webhook.ts` — the Stripe path, pinned byte-for-byte as a
     *     money path this ticket may not touch.
     *   · `manual-donation.ts` — this ticket's one writer.
     * Anything else creating a `donation_receipt` is the twelfth copy.
     */
    const ALLOWED = ['src/lib/donation-webhook.ts', WRITER];
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
      if (ALLOWED.includes(rel)) continue;
      const src = codeOfString(readFileSync(abs, 'utf8'));
      // ⚠️ A WRITE in an object literal — `type: 'donation_receipt',` — and not
      // the TYPE UNION `type: 'donation_receipt' | 'event_ticket' | 'invoice';`
      // that AdminAccounting declares for the documents it reads. A union is a
      // reader describing the shape; only a trailing comma is a write.
      if (/type:\s*'donation_receipt',/.test(src)) offenders.push(rel);
    }
    expect(offenders, 'a second place writes a donation receipt').toEqual([]);

    // Non-vacuity: the two allowed files really do contain what the sweep hunts.
    for (const a of ALLOWED) {
      expect(codeOf(a), `${a} no longer writes a donation_receipt — the sweep is blind`)
        .toMatch(/type:\s*'donation_receipt',/);
    }
  });

  it('🔴 the interface takes an amount, an email, a description and a source — NOT a contact', () => {
    const src = codeOf(WRITER);
    const iface = src.slice(src.indexOf('interface ManualDonationInput'), src.indexOf('interface ManualDonationResult'));
    expect(iface.length, 'the input interface could not be located').toBeGreaterThan(100);
    for (const field of ['tenantId', 'amountCents', 'email', 'description', 'source']) {
      expect(iface, `the writer's input dropped \`${field}\``).toMatch(new RegExp(`\\b${field}\\b`));
    }
    // 🔴 THE-351 calls this with an event registration. A contact-shaped
    // parameter would force it to fake one, or to inline its own copy.
    expect(iface, 'the writer takes a contact — THE-351 cannot call it')
      .not.toMatch(/\bcontact\b|\bContact\b|contactId/);
    expect(codeOf(WRITER), 'the writer reads the CRM contacts collection')
      .not.toMatch(/collection\('contacts'\)/);
  });

  it('🔴 the CRM reaches it through the route and never writes the ledger itself', () => {
    const crm = codeOf(CRM);
    expect(crm, 'the CRM does not call the manual-donation route')
      .toMatch(/authFetch\('\/api\/donations\/manual'/);
    expect(crm, 'the CRM writes the invoices collection from the browser')
      .not.toMatch(/'invoices'/);
  });

  it('🔴 it never throws for a refusal — every rejection is a returned code', async () => {
    for (const [over, code] of [
      [{ tenantId: '' }, 'invalid_tenant'],
      [{ tenantId: 'no-such-church' }, 'invalid_tenant'],
      [{ amountCents: 0 }, 'invalid_amount'],
      [{ description: '   ' }, 'invalid_description'],
      [{ source: 'nope' as never }, 'invalid_source'],
    ] as const) {
      const r = await record(over as never);
      expect(r.ok).toBe(false);
      expect(r.code, `the wrong code came back for ${JSON.stringify(over)}`).toBe(code);
      expect(r.error, 'a refusal came back with no message for the admin').toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14 · 🔴 A FAILED WRITE SURFACES VISIBLY AND DOES NOT LOSE INPUT
// ═══════════════════════════════════════════════════════════════════════════
describe('14 — a failed write surfaces visibly and does not lose input', () => {
  it('🔴 a rejecting Firestore comes back as a FAILURE, never an empty success', async () => {
    // Made to reject, so the guard is asserted rather than asserted about.
    const failing = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ name: 'Grace Chapel' }) }),
          collection: () => ({ add: async () => { throw new Error('PERMISSION_DENIED'); } }),
        }),
      }),
    };
    vi.resetModules();
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: failing }));
    const { recordManualDonation: writer } = await import('@/lib/manual-donation');
    const r = await writer({
      tenantId: TENANT, amountCents: GIFT_CENTS, email: 'a@b.org',
      description: 'Sunday offering, cash', source: 'crm_manual',
    });
    vi.doUnmock('@/lib/firebase-admin');
    vi.resetModules();

    expect(r.ok, 'a rejected write was reported as a success').toBe(false);
    expect(r.code).toBe('write_failed');
    expect(r.invoiceId, 'a failed write handed back an invoice id').toBeUndefined();
    expect(r.error, 'a failed write said nothing an admin could read').toBeTruthy();
  });

  it('🔴 the CRM writes NOTHING when the ledger refuses', () => {
    const crm = codeOf(CRM);
    const fn = crm.slice(crm.indexOf('const addActivity = async'), crm.indexOf('const sendEmail = async'));
    expect(fn.length, 'addActivity could not be located').toBeGreaterThan(500);

    // The ledger call must come BEFORE the timeline write and the totalDonated
    // write. Order, not presence: CRM-first would leave the founder's exact bug.
    const ledgerCall = fn.indexOf("authFetch('/api/donations/manual'");
    const activityWrite = fn.indexOf("addDoc(collection(db, 'contactActivities')");
    const contactWrite = fn.indexOf('setDoc(doc(db, ');
    expect(ledgerCall, 'addActivity does not call the ledger').toBeGreaterThan(-1);
    expect(activityWrite, 'addActivity no longer writes a timeline entry').toBeGreaterThan(-1);
    expect(contactWrite, 'addActivity no longer bumps totalDonated').toBeGreaterThan(-1);
    expect(ledgerCall, 'the timeline is written before the ledger answers').toBeLessThan(activityWrite);
    expect(ledgerCall, 'totalDonated is bumped before the ledger answers').toBeLessThan(contactWrite);
    // A refusal throws, so nothing after it runs.
    expect(fn, 'a refused ledger write does not stop the CRM writes')
      .toMatch(/if \(!res\.ok \|\| !data\?\.invoiceId\) \{[\s\S]*?throw new Error/);
  });

  it('🔴 the banner is present, is an alert, and the dialog keeps what was typed', () => {
    const crm = codeOf(CRM);
    const raw = read(CRM);

    expect(crm, 'there is no error banner in the activity dialog').toMatch(/manual-donation-error/);
    // `role="alert"` — announced, not merely drawn.
    const banner = raw.slice(raw.indexOf('{activityError && ('), raw.indexOf('{activityError && (') + 900);
    expect(banner, 'the failure banner is not an alert').toMatch(/role="alert"/);
    expect(banner, 'the banner does not say the input was kept')
      .toMatch(/what you typed has been kept/);

    // 🔴 THE INPUT IS KEPT: the failure path must not close the dialog or reset
    // the form. Both of those live in the SUCCESS path only.
    const fn = crm.slice(crm.indexOf('const addActivity = async'), crm.indexOf('const sendEmail = async'));
    const catchBlock = fn.slice(fn.lastIndexOf('} catch (e) {'));
    expect(catchBlock.length, 'the catch block could not be located').toBeGreaterThan(50);
    expect(catchBlock, 'a failed save closes the dialog').not.toMatch(/setShowAddActivity\(false\)/);
    expect(catchBlock, 'a failed save clears the typed value').not.toMatch(/setActForm\(/);
    expect(catchBlock, 'a failed save is not surfaced in the dialog').toMatch(/setActivityError\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15 · 🔴 GDPR
// ═══════════════════════════════════════════════════════════════════════════
describe('15 — erasure and export handle a manual invoice', () => {
  it('🔴 both reach it: same collection, same type filter, same email match', async () => {
    await record({ email: 'Grace.Giver@Example.ORG' });
    const inv = ledger()[0];

    // Both GDPR paths query `invoices where type == 'donation_receipt'` and then
    // match `lower(recipientEmail)` in memory. A manual receipt written in the
    // webhook's own shape is reached by both with no change to either.
    for (const f of ['src/lib/member-export.ts', 'src/lib/member-erasure.ts']) {
      const src = codeOf(f);
      expect(src, `${f} no longer queries the invoices collection`)
        .toMatch(/collection\('invoices'\)\.where\('type', '==', 'donation_receipt'\)/);
      expect(src, `${f} no longer matches on lowercased recipientEmail`)
        .toMatch(/lower\(data\.recipientEmail\)/);
    }

    expect(inv.type, 'a manual receipt is invisible to both GDPR paths').toBe('donation_receipt');
    const { lower } = { lower: (v: unknown) => String(v ?? '').trim().toLowerCase() };
    expect(lower(inv.recipientEmail), 'the subject would not match their own manual receipt')
      .toBe('grace.giver@example.org');
  });

  it('🔴 the export declares invoices as exported, and the erasure anonymises them', async () => {
    const { MEMBER_EXPORT_DECISIONS } = await import('@/lib/member-export');
    const decision = (MEMBER_EXPORT_DECISIONS as Record<string, { disposition: string }>)['tenants/{t}/invoices'];
    expect(decision, 'invoices left the export map').toBeTruthy();
    expect(decision.disposition, 'a manual receipt is not exportable to its subject').toBe('export');

    // The erasure anonymises rather than deletes — a tax record is kept — and a
    // manual receipt is anonymised on exactly the same terms.
    expect(codeOf('src/lib/member-erasure.ts'))
      .toMatch(/recipientEmail:\s*pseudonym/);
    expect(codeOf('src/lib/member-erasure.ts')).toMatch(/donorDeleted:\s*true/);
  });

  it('🔴 the writer adds no field that would survive an erasure carrying identity', async () => {
    await record({ email: 'Grace.Giver@Example.ORG', recipientName: 'Grace Giver' });
    // The erasure rewrites `recipientName` and `recipientEmail`. Any OTHER field
    // this writer adds must not carry the giver's identity, or erasure would be
    // incomplete for manual gifts alone.
    const inv = ledger()[0] as Record<string, unknown>;
    const ERASED = new Set(['recipientName', 'recipientEmail']);
    for (const [k, v] of Object.entries(inv)) {
      if (ERASED.has(k)) continue;
      const s = typeof v === 'string' ? v.toLowerCase() : '';
      expect(s, `\`${k}\` carries the giver's email and would survive erasure`)
        .not.toContain('grace.giver@example.org');
      expect(s, `\`${k}\` carries the giver's name and would survive erasure`)
        .not.toContain('grace giver');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16 & 17 · 🔴 NO-REGRESSION
// ═══════════════════════════════════════════════════════════════════════════
describe('16 — nothing writes plan from the client', () => {
  it('🔴 an invoice is not an entitlement', () => {
    // #434 removed a client-side `plan` write; the webhook is its single writer.
    for (const f of [WRITER, AMOUNT, ROUTE, CRM]) {
      const src = codeOf(f);
      expect(src, `${f} writes a plan field`).not.toMatch(/\bplan:\s*['"]/);
      expect(src, `${f} writes a plan through an update`).not.toMatch(/\{\s*plan:/);
    }
  });
});

describe("17 — #482's collapsible disclaimer and switcher are intact", () => {
  it('🔴 the payment-links disclaimer still collapses, with its text unchanged', () => {
    const c = read(CRM);
    expect(c).toContain('Gifts sent through your own payment links are not counted here.');
    expect(c).toContain('open their contact, press Add Activity, choose Donation and enter the amount.');
    expect(c).toContain('<Collapsible');
    expect(c).toContain('keepMounted');
    expect(c).toContain('crm-manual-giving-panel');
  });

  it('🔴 the Contacts/Roles switcher is still ONE definition', () => {
    const c = read(CRM);
    expect((c.match(/const subTabBar = \(/g) ?? []).length,
      'the switcher must be defined exactly once').toBe(1);
    expect((c.match(/\{subTabBar\}/g) ?? []).length,
      'the one switcher must be rendered on both sub-views').toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17b/c/d · 🔴 THE FALSE-CLAIM SWEEP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The admin surfaces a church reads about card giving, and the module that
 * words the refusal for both of them.
 *
 * ⚠️ `AdminDonations` and `AdminFundraising` both mount `PaymentSection`, which
 * renders `STRIPE_CONNECT_HIDDEN_MESSAGE` — so the sentence a church sees on the
 * Donations screen and on the Fundraising screen is ONE string in ONE file.
 * That is the "two places" the ticket names, and fixing the constant fixes both.
 */
const CARD_GIVING_SURFACES = [
  'src/lib/stripe-connect-feature.ts',
  'src/components/settings/PaymentSection.tsx',
  'src/components/AdminDonations.tsx',
  'src/components/AdminFundraising.tsx',
] as const;

describe('17b — no surface says card giving is "temporarily" unavailable', () => {
  it('🔴 named per file, over comment-stripped source', () => {
    expect(CARD_GIVING_SURFACES.length).toBeGreaterThan(0);
    for (const f of CARD_GIVING_SURFACES) {
      const src = codeOf(f);
      // 🔴 Non-vacuity FIRST, and by content rather than by length: a short
      // module is legitimately short, but one the stripper ate has lost its
      // exports. `86bbxkawp` is the stripper that ate ~150 lines of a real file.
      expect(src, `${f}: the stripper left nothing recognisable to check`)
        .toMatch(/export|import|return|=>/);
      expect(src.split('\n').filter((l) => l.trim()).length,
        `${f}: the stripper ate the file`).toBeGreaterThan(2);
      expect(src, `${f} tells a church card giving is TEMPORARILY unavailable`)
        .not.toMatch(/temporar/i);
    }
  });

  it('🔴 the sweep is not blind — it catches the sentence it was written for', () => {
    expect(codeOfString("const M = 'Temporarily unavailable';")).toMatch(/temporar/i);
    // And the sentence really is gone from the CODE of the file that held it.
    // ⚠️ `codeOf`, not `read`: the module's docblock QUOTES the old wording to
    // explain why it was replaced, and making the explanation the thing that
    // fails the test is exactly backwards.
    expect(codeOf('src/lib/stripe-connect-feature.ts')
      .includes(['Temporarily', 'unavailable'].join(' ')),
      'the old wording is still in the code').toBe(false);
  });
});

describe('17c — no surface implies a migration is in progress or gives a date', () => {
  it('🔴 no migration, no date, no "coming soon" on the admin card-giving surfaces', () => {
    for (const f of CARD_GIVING_SURFACES) {
      const src = codeOf(f);
      expect(src, `${f} says a payment-provider migration is under way`)
        .not.toMatch(/migrat/i);
      expect(src, `${f} tells a church card giving is coming`)
        .not.toMatch(/coming soon|back soon|shortly|in the meantime|for now,/i);
    }
  });

  it('🔴 and the message itself carries no promise of any kind', async () => {
    const { STRIPE_CONNECT_HIDDEN_MESSAGE } = await import('@/lib/stripe-connect-feature');
    expect(STRIPE_CONNECT_HIDDEN_MESSAGE)
      .not.toMatch(/temporar|migrat|coming soon|shortly|soon\b|\b20\d{2}\b|\bweeks?\b|\bdays?\b/i);
    // Non-vacuity: the pattern really does catch what it claims to.
    expect('back soon in 2026').toMatch(/coming soon|shortly|soon\b|\b20\d{2}\b/i);
  });
});

describe('17d — whatever replaces it is TRUE', () => {
  it('🔴 it names the manual path, and this ticket is what makes that true', async () => {
    const { STRIPE_CONNECT_HIDDEN_MESSAGE, STRIPE_CONNECT_ENABLED } =
      await import('@/lib/stripe-connect-feature');

    // Quoted, so the claim is reviewable rather than described.
    expect(STRIPE_CONNECT_HIDDEN_MESSAGE).toBe(
      'Card giving inside the app is off. Your own payment links still work, and a gift you record in the CRM counts on your dashboard, in accounting and on your giving statements.',
    );

    // 🔴 CLAIM 1 — "card giving inside the app is off". The switch says so.
    expect(STRIPE_CONNECT_ENABLED, 'the message says card giving is off while it is on').toBe(false);

    // 🔴 CLAIM 2 — "your own payment links still work". The editor is on the
    // Donations screen and the member Give page renders them.
    expect(codeOf('src/components/AdminDonations.tsx'), 'the payment-links editor is gone')
      .toMatch(/GivingLinks|GIVING_PROVIDERS/);

    // 🔴 CLAIM 3 — "a gift you record in the CRM counts on your dashboard, in
    // accounting and on your giving statements". Only true because of THE-350:
    // the CRM calls the writer, the writer writes the ledger, and §§2-5 above
    // measure each of the three surfaces against a real recorded gift.
    expect(codeOf(CRM)).toMatch(/authFetch\('\/api\/donations\/manual'/);
    expect(codeOf(WRITER)).toMatch(/type:\s*'donation_receipt'/);
  });

  it('🔴 the panel renders the message and no control that cannot be used', () => {
    const panel = codeOf('src/components/settings/PaymentSection.tsx');
    expect(panel, 'the panel stopped rendering the one hidden message')
      .toMatch(/\{STRIPE_CONNECT_HIDDEN_MESSAGE\}/);
    expect(panel, 'the panel spells the sentence instead of importing it')
      .not.toMatch(/Card giving inside the app/);
    // The Connect UI is still mounted only behind the switch.
    expect(panel).toMatch(/STRIPE_CONNECT_ENABLED\s*\?\s*<StripeConnectPanel\s*\/>/);
  });
});

describe('17e — the rest of the sweep: REPORTED, and pinned so the report cannot go stale', () => {
  /**
   * 🔴 TWO MORE PLACES NAMED CARD GIVING, AND NEITHER WAS FIXED HERE. Pinned by
   * VALUE rather than described in a PR body, so the day either one moves this
   * suite says so and the report stops being a claim nobody re-checked.
   *
   * ⚠️ THE PIN DID ITS JOB: THE-357 (this file's first row) took the share
   * sheet, and the row below it is now a pin on the CORRECTED copy rather than
   * on the promise. The portal route's note is still prose and is still only
   * reported.
   */
  /**
   * ⚠️ AMENDED BY THE-357, ON THE HANDOVER THIS BLOCK ITSELF WROTE: "the ticket
   * that corrects it will have to move this line and say why". This is that
   * ticket, and this is why.
   *
   * 🔴 THE-350's REPORT WAS RIGHT AND IS NOT WITHDRAWN. The share sheet said
   * "Card giving through Stripe Connect is coming soon. Until then, these are
   * the ways your members can give." — the same false promise as the two admin
   * surfaces THE-350 fixed, on a third surface it correctly judged out of scope.
   * What kept THE-350 off it was `the-313-guards`, which pins
   * `giving-share.ts` by digest, and THE-350's reading of that pin: appending a
   * digest there "to get past a guard built to catch exactly this would defeat
   * it".
   *
   * ⚠️ THE-357 ESTABLISHED THAT THE APPEND PATH IS THE GUARD'S OWN DESIGN, not a
   * way past it. THE-313's `UNTOUCHED` header prescribes it in terms — "APPENDED,
   * NEVER SUBSTITUTED … a value that is NEITHER — i.e. this ticket editing the
   * file — still fails" — and three later tickets have used it on that same map
   * (THE-314 via #452, THE-351 and THE-355), each appending WITH a reason that
   * names the property the pin exists for and states it is unchanged. What that
   * entry exists for is narrow and written down beside it: "do NOT reuse
   * `giving-share.ts`'s URL builder or loosen its host validation." THE-357
   * changes one exported SENTENCE and touches neither, and it says so by pinning
   * `buildGivingPageUrl`'s six rules verbatim in its own suite — so the guard is
   * STRONGER after the append than before it, not weaker.
   *
   * 🔴 SO THE PIN BELOW IS INVERTED RATHER THAN DELETED. It pinned the promise
   * so the report could not go stale; it now pins the ABSENCE of one, on the
   * same constant, so the correction cannot be undone quietly either. Restoring
   * "coming soon" fails here and in THE-357's own sweep.
   */
  it('🔴 the share sheet no longer says "coming soon" — corrected by THE-357', async () => {
    const { GIVING_SHARE_CARD_GIVING_OFF } = await import('@/components/donations/giving-share');
    expect(GIVING_SHARE_CARD_GIVING_OFF,
      'the share sheet copy changed — re-read the report in this test before accepting it')
      .toBe('Card giving inside the app is off. These are the ways your members can give, and a gift you record in the CRM counts on your dashboard, in accounting and on your giving statements.');
    expect(GIVING_SHARE_CARD_GIVING_OFF, 'the share sheet promises card giving again')
      .not.toMatch(/temporar|migrat|coming soon|shortly|in the meantime|for now|until then|soon\b|\b20\d{2}\b/i);
    // And the file is still under THE-313's pin, at an APPENDED accepted value:
    // THE-357 added one beside THE-313's own, and substituted none.
    expect(codeOf('src/__tests__/the-313-guards.test.ts'),
      "giving-share.ts left THE-313's untouched set — the pin was removed rather than appended to")
      .toMatch(/src\/components\/donations\/giving-share\.ts/);
  });

  it('🔴 the portal route\'s note is a COMMENT, not user copy — reported, not fixed', () => {
    /**
     * `app/api/stripe/portal/route.ts` carries "…be unavailable. It gets its
     * honest name when the Stripe path is retired." That is a docblock
     * explaining why the ROUTE PATH is still spelled `/api/stripe/portal`, and
     * no church ever reads it. Asserted to be exactly that — prose and not a
     * string — so it stays reported rather than quietly becoming a surface.
     */
    const portal = 'src/app/api/stripe/portal/route.ts';
    expect(read(portal), 'the portal note is gone — the report is stale')
      .toMatch(/It gets its honest name when the Stripe path is retired/);
    expect(codeOf(portal), 'the portal note became user-facing copy')
      .not.toMatch(/It gets its honest name/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18 · House rules
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 🔴 THE SEVEN HEXES `AdminCRM.tsx` ALREADY CARRIED, pinned BY VALUE rather than
 * waved through — the brand fallbacks in `var(--brand-color, #B8962E)`, the
 * donor-chip pair and the card tints. This ticket may not add an eighth and may
 * not change any of these: recolouring the CRM is a palette pass, not a money
 * fix, and #482 already established that raw scales on this screen were the
 * defect. Recorded as a literal, never re-derived — a guard that recomputes its
 * own baseline cannot fail.
 */
const CRM_PRE_EXISTING_HEXES = [
  '#10B981', '#B8962E', '#C9963A', '#ECFDF5', '#F3EEE7', '#FBF3E4', '#fff',
] as const;

describe('18 — primitives, touch targets, colour and emoji', () => {
  const ADDED_OR_EDITED = [WRITER, AMOUNT, ROUTE, CRM, 'src/lib/stripe-connect-feature.ts'];

  it('🔴 no colour is hardcoded in anything this ticket added or edited', () => {
    /**
     * ⚠️ AdminCRM carries hexes that PREDATE this ticket — the `#B8962E` brand
     * fallbacks in `var(--brand-color, #B8962E)` and the pipeline chips. They are
     * pinned BY VALUE rather than waved through, so this ticket cannot add a
     * different one and cannot change any of them.
     */
    const crmHexes = (codeOf(CRM).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
    expect(crmHexes.length, 'the pre-existing hexes vanished — this pin is now vacuous')
      .toBeGreaterThan(0);
    expect([...new Set(crmHexes)].sort(), 'AdminCRM gained a hardcoded colour')
      .toEqual(CRM_PRE_EXISTING_HEXES);

    for (const f of ADDED_OR_EDITED) {
      if (f === CRM) continue;
      expect(codeOf(f).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${f} hardcodes a colour`).toEqual([]);
    }
  });

  it('🔴 no raw Tailwind colour scale in the markup this ticket added', () => {
    // #482 found `divide-stone-200` at 12.06:1 on a dark card across 13 screens.
    const raw = read(CRM);
    const added = [
      raw.slice(raw.indexOf('manual-donation-reach') - 400, raw.indexOf('manual-donation-reach') + 400),
      raw.slice(raw.indexOf('manual-donation-no-email') - 200, raw.indexOf('manual-donation-no-email') + 900),
      raw.slice(raw.indexOf('manual-donation-error') - 300, raw.indexOf('manual-donation-error') + 800),
    ];
    for (const block of added) {
      expect(block.length, 'a block this ticket added could not be located').toBeGreaterThan(300);
      expect(block, 'a raw Tailwind colour scale in a notice this ticket added')
        .not.toMatch(/\b(divide|bg|text|border)-(stone|zinc|slate|gray|neutral|red|amber|green|blue|orange|yellow)-\d{2,3}\b/);
    }
  });

  it('🔴 no emoji in the product files this ticket added or edited', () => {
    // The PICTOGRAPH range, as `the-333` and THE-342 both draw it.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu;
    // ⚠️ The house 🔴 marker is legal in a docblock and this repo uses it
    // everywhere; what may never ship is an emoji in RENDERED COPY. So the sweep
    // runs over comment-stripped source, which is where product strings live.
    for (const f of ADDED_OR_EDITED) {
      expect(codeOf(f).match(EMOJI) ?? [], `${f} ships an emoji in its code`).toEqual([]);
    }
    // Non-vacuity, both ways.
    expect('🔴'.match(EMOJI)).not.toBeNull();
    expect('★'.match(EMOJI), 'the sweep would eat a legal dingbat').toBeNull();
  });

  it('🔴 every element that has a primitive uses it — or the rejection is named', () => {
    /**
     * ⚠️ 43 PRIMITIVES ARE ON DISK and `accordion` is the only absent one —
     * enumerated here rather than taken on trust.
     *
     * 🔴 THIS TICKET COMPOSES NONE OF THEM INTO `AdminCRM.tsx`, AND THAT IS THE
     * INSTRUCTION, not an oversight. AdminCRM is the eighth hand-rolled file and
     * is carded separately; composing it here would be a visual pass smuggled in
     * behind a money fix, on a 2,300-line file, in the same PR as a ledger write.
     *
     * Per element, what was rejected and why:
     *   · the no-email notice and the failure banner → `ui/alert` REJECTED.
     *     It is the right primitive and it is what a follow-up should use; it is
     *     not used here because this file composes no primitive except the
     *     `Collapsible` #482 already introduced, and a single `<Alert>` beside
     *     eight hand-rolled panels reads as an accident rather than a system.
     *     They reuse the dialog's own chrome verbatim — every colour a semantic
     *     token, asserted above.
     *   · the amount field → `ui/field` + `ui/input` REJECTED, same reason; the
     *     existing labelled `<input>` is untouched.
     *   · the dialog itself → `ui/dialog` REJECTED; this ticket did not open the
     *     modal's shell, and converting it would move every control in it.
     */
    const primitives = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx')).map((f) => f.replace(/\.tsx$/, ''));
    expect(primitives.length, 'the primitive set changed size unexpectedly').toBe(43);
    expect(primitives, 'accordion appeared on disk').not.toContain('accordion');
    for (const p of ['alert', 'field', 'input', 'dialog', 'badge', 'empty', 'button']) {
      expect(primitives, `${p} is not installed`).toContain(p);
    }
    /**
     * 🔴 THE EXACT IMPORT LIST, and THE-362 APPENDED THE SECOND ENTRY.
     *
     * THE-350 rejected `ui/alert` above and said in as many words that it "is
     * the right primitive and it is what a follow-up should use". THE-362 IS
     * that follow-up: the founder's "I tried to delete my own account and
     * nothing happened" needs a REFUSAL on screen, `alert` is the primitive
     * this repo installs for one, and it arrives on its own rather than beside
     * a money-ledger write — which is the whole of what THE-350 objected to.
     *
     * 🔴 WHAT THIS GUARD STILL ASSERTS IS UNCHANGED: the list is EXACT, so a
     * third primitive cannot appear without a ticket saying why, and THE-350's
     * own rejections stand — the amount field is still a labelled `<input>`,
     * the modal is still not `ui/dialog`, and the two notices THIS ticket did
     * not touch are still the dialog's own chrome.
     */
    const expected = [
      "import { Alert, AlertDescription, AlertTitle } from './ui/alert';",
      "import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';",
    ];
    const imports = read(CRM).match(/^import .*from '(\.\/ui\/|@\/components\/ui\/)[^']*';$/gm) ?? [];
    expect(imports, 'a primitive was composed into AdminCRM without a ticket recording it')
      .toEqual(expected);
  });

  it('🔴 every tappable target this ticket added is >= 44px below sm', () => {
    // The notices are text, not controls: this ticket adds NO tappable target.
    // Asserted rather than assumed, because "I added no button" is exactly the
    // claim a stray `<button>` would falsify.
    const raw = read(CRM);
    for (const testid of ['manual-donation-reach', 'manual-donation-no-email', 'manual-donation-error']) {
      const at = raw.indexOf(testid);
      expect(at, `${testid} is not rendered`).toBeGreaterThan(-1);
      const block = raw.slice(at, raw.indexOf('</div>', at) + 6);
      expect(block, `${testid} carries a control that would need a 44px target`)
        .not.toMatch(/<button|<input|<a\s|role="button"|onClick=/);
    }
    // The one control this ticket touched — Cancel — kept its class list; it
    // only gained a state reset.
    expect(raw, 'the Cancel button lost its chrome')
      .toMatch(/setShowAddActivity\(false\); setActivityError\(null\);[\s\S]{0,140}py-2\.5/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19 & 20 · The suite's own rules, and the files that must not move
// ═══════════════════════════════════════════════════════════════════════════
describe('19 — this suite pins no line number, no near-today fixture, no branch diff', () => {
  it('🔴 no test pins a line number', () => {
    // THE-331 pinned a component by FILE AND LINE; a deletion shifted the line,
    // so the suite would have measured whatever landed there instead of failing.
    // Every locator here is a name or a balanced expression, never a position.
    const src = read(SELF);
    expect(src, 'this suite pins a source line number').not.toMatch(/\.tsx?:\d+/);
  });

  it('🔴 no fixture is pinned near today', () => {
    /**
     * ⚠️ THE REAL CLOCK, and it has to be. `beforeEach` fakes Date for every
     * test in this file, so asking `new Date()` here would compare the fixture
     * year against ITSELF and pass at any distance — a guard that cannot fail.
     */
    vi.useRealTimers();
    const today = new Date().getFullYear();
    const src = codeOf(SELF);
    const years = [...src.matchAll(/'(\d{4})-\d{2}-\d{2}T/g)].map((m) => Number(m[1]));
    expect(years.length, 'no fixture date was found — the check is vacuous').toBeGreaterThan(0);
    expect(today, 'the real clock was not restored — this guard is measuring the fake one')
      .toBeGreaterThan(2024);
    for (const y of years) {
      expect(today - y,
        `a fixture is pinned to ${y}, which is near today`).toBeGreaterThanOrEqual(2);
    }
    // And the clock is faked with `toFake`, which is load-bearing.
    expect(src, 'the clock is faked without `toFake`')
      .toMatch(/vi\.useFakeTimers\(\{ toFake: \['Date'\] \}\)/);
  });

  it('🔴 no guard here asserts anything about this branch\'s diff (#454)', () => {
    const src = read(SELF);
    // Needles assembled at run time so this test cannot pass by containing them.
    for (const needle of [['child_', 'process'].join(''), ['exec', 'Sync'].join(''), ['git', ' show'].join('')]) {
      expect(src.includes(needle), `this suite reaches for ${needle}`).toBe(false);
    }
    expect(src.includes(['changed', 'Since'].join('')), 'this suite asks what the branch changed').toBe(false);
  });

  it('🔴 the self-check above is not vacuous — it can see this file', () => {
    expect(codeOf(SELF).length).toBeGreaterThan(5000);
    expect(codeOf(SELF)).toContain('recordManualDonation');
  });

  it('🔴 the source files this suite reads all carry LF, never CRLF', () => {
    for (const f of [WRITER, AMOUNT, ROUTE, CRM, SELF]) {
      expect(read(f).includes('\r\n'), `${f} carries CRLF line endings`).toBe(false);
    }
  });
});

describe('20 — firestore.rules, the indexes file, functions/ and layout.tsx are untouched', () => {
  it('🔴 firestore.rules is at a digest some ticket recorded — it auto-deploys', async () => {
    const { rulesDigestFailure } = await import('./__fixtures__/firestore-rules-pin');
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('🔴 an admin-written invoice needs NO rule change, and the rule is asserted as it stands', () => {
    /**
     * 🔴 STOP CONDITION 2, ANSWERED WITHOUT TOUCHING THE FILE.
     *
     * `tenants/{t}/invoices` is gated on `hasPermission('manageAccounting')`. A
     * CRM admin holds `manageCRM`, so a CLIENT write would be refused for
     * exactly the admins who record gifts. The answer was NOT to loosen the
     * rule — it auto-deploys on merge with no emulator tests, and loosening it
     * would hand every CRM admin direct write access to the money ledger —
     * but to write through the Admin SDK behind a route that checks the
     * permission itself.
     *
     * The rule is asserted AS IT STANDS so this suite goes red the day it moves
     * and the reasoning above becomes stale.
     */
    const rules = read('firestore.rules');
    expect(rules, 'the invoices rule moved — re-check whether the route still stands in for it')
      .toContain("allow write: if hasPermission('manageAccounting', tenantId);");
    expect(rules).toContain('match /invoices/{invoiceId} {');
    // And the route really does impose a permission of its own.
    expect(codeOf(ROUTE), 'the route writes the ledger with no permission check')
      .toMatch(/requireTenantPermission\(request, tenantId, 'manageCRM'\)/);
  });

  it('🔴 no composite index is required by anything this ticket added', () => {
    /**
     * STOP CONDITION 5. `firestore.indexes.json` DOES NOT DEPLOY — `deploy-rules
     * .yml` runs `firestore:rules,storage` only — so an index added there would
     * be inert and the query would throw `failed-precondition` in production
     * while every test stayed green.
     *
     * The writer performs ONE `get()` by document id and ONE `add()`. It builds
     * no query at all, so there is nothing to index.
     */
    const src = codeOf(WRITER);
    expect(src, 'the writer builds a query').not.toMatch(/\.where\(|\.orderBy\(/);
    expect(codeOf(ROUTE), 'the route builds a query').not.toMatch(/\.where\(|\.orderBy\(/);
  });

  it('🔴 firestore.indexes.json, functions/ and layout.tsx are byte-identical', () => {
    const PINNED: Record<string, string> = {
      'firestore.indexes.json': sha256(readFileSync(path.join(REPO_ROOT, 'firestore.indexes.json'))),
      'src/app/layout.tsx': sha256(readFileSync(path.join(REPO_ROOT, 'src/app/layout.tsx'))),
    };
    /**
     * ⚠️ RECORDED, NOT RE-DERIVED — the values below are literals computed once
     * when this file was written. A guard that recomputes its own baseline
     * cannot fail; it would simply describe whatever it was handed.
     */
    const RECORDED: Record<string, string> = {
      'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
      'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
    };
    for (const [file, actual] of Object.entries(PINNED)) {
      expect(actual, `${file} was modified — this ticket must not touch it`).toBe(RECORDED[file]);
    }

    // functions/ file for file.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(path.relative(REPO_ROOT, p).split(path.sep).join('/'));
      }
    };
    walk(path.join(REPO_ROOT, 'functions'));
    expect(files.length, 'the functions/ walk found nothing — it is vacuous').toBeGreaterThan(0);
    const treeDigest = sha256(files.sort().map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(treeDigest, 'functions/ was modified — this ticket must not touch it')
      .toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });
});
