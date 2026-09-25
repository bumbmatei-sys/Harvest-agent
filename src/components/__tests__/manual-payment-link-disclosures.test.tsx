import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import postcss from 'postcss';
import {
  GIVING_PROVIDERS,
  GIVING_PROVIDER_NAMES,
  GIVING_PROVIDER_NAMES_OR,
} from '../donations/giving-providers';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-249 — what the manual payment links do NOT do, said in all three places.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * PR 387 (THE-246) shipped a church's own payment links — PayPal, Cash App,
 * Venmo, Zelle, and Revolut and Wise since THE-254. 🔴 HARVEST IS NOT IN THAT
 * FLOW AT ALL: a member taps the link
 * and pays the church directly through the provider. Three things therefore
 * silently do not happen, and every one of them is verified from the code here
 * rather than taken from the ticket:
 *
 *   1. NO RECEIPT.  `issueDonationReceipt` is called from exactly one module,
 *      `src/lib/donation-webhook.ts`, and every caller of THAT is a Stripe
 *      webhook. Nothing else in the app issues one.
 *   2. NO GIVING STATEMENT.  The generator reads
 *      `tenants/{id}/invoices` and keeps only `type === 'donation_receipt'`.
 *      The only writer of such a document is the same Stripe donation webhook,
 *      so no admin surface can put a gift on a statement.
 *   3. NO CRM RECORD.  `contacts.totalDonated` / `lastDonationAt` — and the
 *      pipeline stage derived from them — are written by that webhook, or by
 *      the CRM's own Add Activity → Donation. A PayPal gift reaches neither.
 *
 * ─── The remedy, and its exact limit ────────────────────────────────────────
 *
 * ⚠️ The founder's phrasing — it "won't appear in CRM the amount given unless
 * added manually by admin" — points at a control that MUST be shown to exist
 * before the copy may point at it. Section 5 drives the real one: it opens a
 * contact, presses Add Activity, picks Donation, types an amount and saves,
 * and reads the write back. It is a real path, and it is reachable from every
 * tier that can reach the links editor (both gate on `fundraising`).
 *
 * 🔴 AND IT FIXES THE CRM ONLY. It writes `contactActivities` and `contacts`;
 * it writes no invoice, so it cannot reach a giving statement. Section 5 pins
 * that too — a disclosure whose remedy is oversold is worse than none.
 *
 * ─── Method ─────────────────────────────────────────────────────────────────
 *
 * Every copy claim below is asserted against RENDERED OUTPUT — the real
 * component, mounted, its `textContent` read — never against an exported
 * constant. A constant can be true while the surface that was supposed to show
 * it renders nothing.
 *
 * ⚠️ The digests in section 9 are LITERALS, not a `git show` at assertion time
 * (the same rule AdminDonations.section.test.tsx follows). CI's clone depth is
 * not this suite's business.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The same source with every comment removed. Needed because the notes this
 * ticket adds NAME the things they are about — `donation_receipt`,
 * `hasManualGivingLinks` — and a raw substring search would read a comment
 * explaining a rule as the rule being broken.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');

/**
 * One block of JSX, from a marker to the anchor that follows it. Anchored at
 * BOTH ends deliberately: a lazy `[\s\S]*?</div>` stops at the first nested
 * close, which reads a three-line slice of a twelve-line block as the whole of
 * it and then finds nothing wrong with it.
 *
 * 🔴 Returns '' for a block it cannot find, and never throws. A marker that has
 * gone is a COPY REGRESSION — exactly what this suite is for — and a throw here
 * would abort collection, so the run would go red with a stack trace instead of
 * the named assertion that says which disclosure disappeared.
 */
const between = (rel: string, start: string, end: string): string => {
  const src = read(rel);
  const from = src.indexOf(start);
  if (from < 0) return '';
  const to = src.indexOf(end, from + start.length);
  return to < 0 ? '' : src.slice(from, to);
};

/**
 * The three blocks this ticket adds, by their own markers. Read lazily, per
 * test, for the same reason `between` does not throw.
 */
const addedBlocks = (): Record<string, string> => ({
  'Donations — the CRM gap and the remedy': between(
    'src/components/AdminDonations.tsx',
    '<b className="text-strong">Your CRM will not record them either.</b>', '</p>'),
  'Giving statements — what the PDF omits': between(
    'src/components/AdminGivingStatements.tsx',
    'data-testid="statements-manual-links"', '{/* Section B'),
  'CRM — why a contact reads $0': between(
    'src/components/AdminCRM.tsx',
    'data-testid="crm-manual-giving"', '{/* Coverage line'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — the network and the data hooks only. Every component under test, and
// every module that decides what it says, is REAL: `giving-providers` (the
// validator the CRM note keys off), `AdminUI`, `plan-features`, `form-layout`.
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  tenantDoc: { current: {} as Record<string, unknown> },
  ctx: { current: { tenantPlan: 'max' as string | undefined, planFeatures: undefined as unknown, branding: {} as unknown } },
  contacts: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  activities: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  writes: { added: [] as Record<string, unknown>[], set: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] },
  /** THE-350 — every authFetch the screen made, so the ledger POST is checkable. */
  requests: [] as { url: string; body: Record<string, unknown> | null }[],
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1', email: 'admin@grace.org' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  getDocs: async () => ({ docs: [] }),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => h.tenantDoc.current }),
  updateDoc: async (_r: unknown, payload: Record<string, unknown>) => { h.writes.updated.push(payload); },
  addDoc: async (_c: unknown, payload: Record<string, unknown>) => { h.writes.added.push(payload); return { id: 'act1' }; },
  setDoc: async (_r: unknown, payload: Record<string, unknown>) => { h.writes.set.push(payload); },
  deleteDoc: async () => {},
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: () => ({ set: () => {}, commit: async () => {} }),
}));
vi.mock('../settings/useTenantId', () => ({ getTenantId: async () => 'grace' }));
vi.mock('../settings/PaymentSection', () => ({ default: () => null }));
/**
 * 🔴 AMENDED BY THE-350. The stub now RECORDS what was posted and answers the
 * manual-donation route the way the real one does, because Add Activity →
 * Donation goes through `/api/donations/manual` before it writes anything to
 * the CRM: `tenants/{t}/invoices` is gated on `manageAccounting` in
 * firestore.rules while the recording admin holds `manageCRM`, so the ledger
 * write is server-side by necessity. A stub that answered `{}` would leave the
 * end-to-end test below measuring a refused gift.
 */
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async (url: string, init?: { body?: string }) => {
    h.requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (typeof url === 'string' && url.startsWith('/api/donations/manual')) {
      return { ok: true, json: async () => ({ invoiceId: 'inv_1', receiptNumber: 'R-1-AAA', visibleToMember: true }) };
    }
    return { ok: true, json: async () => ({}) };
  },
}));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../../utils/open-statement-pdf', () => ({ openStatementPdf: async () => {} }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 'grace', isAuthReady: true, isSuperAdmin: false }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
vi.mock('../AdminScreenHeader', async (o) => ({
  ...(await o<typeof import('../AdminScreenHeader')>()),
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {} }),
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => h.ctx.current }));
vi.mock('../../hooks/queries/useCRMQueries', async (o) => ({
  ...(await o<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => h.contacts.current,
  useContactActivities: () => h.activities.current,
  useCRMCounts: () => ({ data: undefined }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mounting
// ─────────────────────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
};

async function mount(element: React.ReactElement) {
  await act(async () => { root = createRoot(container); root.render(element); });
  mounted = true;
  await flush();
  return container;
}

/** The links editor, as an admin on a fundraising tier sees it. */
const donations = async () =>
  mount(React.createElement((await import('../AdminDonations')).default));

/** The Statements screen — the surface that produces the tax document. */
const statements = async () =>
  mount(React.createElement((await import('../AdminGivingStatements')).default));

/** The CRM list, with full access so nothing is hidden by permission. */
const crm = async () => {
  const AdminCRM = (await import('../AdminCRM')).default;
  return mount(
    React.createElement(AdminCRM, {
      currentUserRole: 'admin',
      currentUserPermissions: { fullAccess: true } as never,
    }),
  );
};

/** One PayPal link saved — the state in which a church HAS the gap. */
const WITH_LINKS = { givingLinks: { paypal: { url: 'https://paypal.me/gracechurch', handle: '@grace' } } };

const text = () => (container.textContent ?? '').replace(/\s+/g, ' ');

const click = async (el: Element) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

/**
 * Type into a control the way React notices.
 *
 * ⚠️ The prototype the setter comes off must be the element's OWN — React's
 * value tracker is bypassed by calling the native setter, and calling
 * `HTMLInputElement`'s on a `<textarea>` throws inside jsdom rather than
 * failing an assertion, which reads as a broken test instead of a broken form.
 */
const type = async (el: HTMLElement, value: string) => {
  const proto = el instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};

const buttonSaying = (re: RegExp) =>
  Array.from(container.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  h.tenantDoc.current = { config: {} };
  h.ctx.current = { tenantPlan: 'max', planFeatures: undefined, branding: {} };
  h.contacts.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  h.activities.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  h.writes = { added: [], set: [], updated: [] };
  h.requests = [];
});

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount(); });
  mounted = false;
  container.remove();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1-5. The Donations section — the moment a church decides to add a link.
// ═════════════════════════════════════════════════════════════════════════════
describe('the Donations section states that Harvest does not process these gifts', () => {
  it('says it in the church\'s own words, above the fields it is about', async () => {
    await donations();
    expect(text()).toMatch(/Harvest does not process these gifts/i);
    // 🔴 Built from the table, not typed: this asserts the RENDERED sentence
    // names every provider the product actually offers, and keeps doing so
    // when the table grows. A written-out list here would pass while the
    // screen told a church its Revolut gifts were covered.
    expect(text(), 'where the money actually goes is not said')
      .toContain(`straight from your member to your own ${GIVING_PROVIDER_NAMES_OR} account`);

    // Document order: a warning read after the paste is a warning that failed.
    const warning = Array.from(container.querySelectorAll('p'))
      .find((p) => /Harvest does not process these gifts/i.test(p.textContent ?? ''))!;
    const firstField = container.querySelector(`#giving-${GIVING_PROVIDERS[0].id}-url`)!;
    expect(
      warning.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the disclosure sits below the fields',
    ).toBeTruthy();
  });

  it('names all four providers, so no church reads it as being about one', async () => {
    await donations();
    for (const p of GIVING_PROVIDERS) {
      expect(text(), `${p.label} is not named in the disclosure`).toContain(p.label);
    }
  });
});

describe('it states that receipts are not generated for them', () => {
  it('says there is no Harvest receipt, and nothing to refund or dispute', async () => {
    await donations();
    expect(text()).toMatch(/no Harvest receipt/i);
    expect(text()).toMatch(/nothing for Harvest to refund or dispute/i);
  });

  it('🔴 and that is true of the code: only the Stripe webhook issues one', () => {
    // `issueDonationReceipt` is the single receipt writer. Its only importer is
    // the donation webhook module, whose own callers are Stripe endpoints — so
    // there is no non-Stripe path to a receipt for the copy to be wrong about.
    const receipt = read('src/lib/donation-receipt.ts');
    expect(receipt).toMatch(/export async function issueDonationReceipt/);
    const webhook = read('src/lib/donation-webhook.ts');
    expect(webhook).toMatch(/import \{ issueDonationReceipt \} from '@\/lib\/donation-receipt'/);
    for (const file of ['src/components/AdminDonations.tsx', 'src/components/AdminCRM.tsx']) {
      expect(read(file), `${file} issues a receipt`).not.toMatch(/issueDonationReceipt/);
    }
  });
});

describe('it states that nothing records these gifts until a church records them', () => {
  it('🔴 says the tax document will be missing them, not merely that they are untracked', async () => {
    /**
     * 🔴 AMENDED BY THE-350, and the amendment is a correction.
     *
     * THE-249 asserted "will not appear on giving statements". That was true of
     * a manual entry that wrote a `contactActivities` row and nothing else. Add
     * Activity → Donation now writes the same `donation_receipt` invoice the
     * Stripe webhook writes, so the sentence became FALSE and a screen telling a
     * church its own books cannot hold a gift it just recorded is the same class
     * of false claim this file exists to catch.
     *
     * ⚠️ THE GAP IS UNCHANGED AND IS STILL ASSERTED: Harvest never SEES a gift
     * sent through a church's own link, so ON THEIR OWN these gifts are missing
     * from every one of those surfaces.
     */
    await donations();
    expect(text()).toMatch(/Gifts given this way are not recorded until you record them/i);
    expect(text(), 'the donation-history gap is not stated').toMatch(/donation history/i);
    expect(text(), 'the year-end statement is not named').toMatch(/every year-end statement you generate/i);
    expect(text(), 'the copy no longer says the gap is what happens on their own')
      .toMatch(/on their own they are missing/i);
  });

  it('🔴 and that is true of the code: statements read Stripe invoices only', () => {
    // The generator's source of truth, asserted as the INVARIANT rather than a
    // whole-file digest — THE-229 is editing this file's anonymisation branch
    // in parallel, and pinning its bytes here would fail on their merge while
    // proving nothing extra. What matters to this ticket is the query and the
    // filter, and both are pinned.
    const gen = read('src/app/api/giving-statements/generate/route.ts');
    expect(gen, 'the statement generator no longer reads `invoices`')
      .toMatch(/\.collection\('invoices'\)/);
    expect(gen, 'the donation_receipt filter is gone')
      .toMatch(/if \(inv\.type !== 'donation_receipt'\) continue;/);
    // And the only writer of such a document is the Stripe donation webhook.
    const writers = ['src/lib/donation-webhook.ts'];
    for (const file of writers) {
      expect(read(file)).toMatch(/type: 'donation_receipt'/);
    }
    for (const file of ['src/components/AdminCRM.tsx', 'src/components/AdminDonations.tsx', 'src/components/AdminGivingStatements.tsx']) {
      expect(code(file), `${file} writes a donation_receipt invoice`)
        .not.toMatch(/donation_receipt/);
    }
  });
});

describe('it states that the CRM will not record them unless entered manually', () => {
  it('names every giving field that stays empty', async () => {
    await donations();
    expect(text()).toMatch(/Your CRM will not record them either/i);
    expect(text(), 'the $0 total is not stated').toMatch(/total given of \$0/i);
    expect(text(), 'the missing last-gift date is not stated').toMatch(/no last-gift date/i);
    expect(text(), 'the pipeline stage is not stated').toMatch(/the Member stage/i);
    expect(text(), 'the comparison that makes it land is missing')
      .toMatch(/the same as someone who has never given/i);
  });
});

describe('it points to the manual entry path', () => {
  it('names the control by the words on it', async () => {
    await donations();
    expect(text()).toMatch(/press Add Activity, choose Donation and enter the amount/i);
    // 🔴 THE-350 — what it achieves is now ALL FIVE SURFACES, and the copy says
    // each of them rather than stopping at the contact's own total.
    expect(text(), 'what the manual entry actually achieves is not said')
      .toMatch(/adds to their total given, dates the gift, and writes a donation receipt/i);
    expect(text(), 'the dashboard is not named').toMatch(/counts on your dashboard/i);
    expect(text(), 'accounting is not named').toMatch(/in your accounting/i);
    expect(text(), 'the giving statement is not named').toMatch(/giving statement/i);
    expect(text(), "the member's own history is not named").toMatch(/own donation history/i);
  });

  it('🔴 and that control EXISTS — driven end to end, not read off the source', async () => {
    // ⚠️ STOP CONDITION 2. If no manual donation entry existed, the disclosure
    // above would name a problem with no solution. So it is exercised: open a
    // contact, press Add Activity, choose Donation, type an amount, save.
    h.ctx.current.branding = WITH_LINKS;
    h.contacts.current.data = [{
      id: 'c1', firstName: 'Ada', lastName: 'Ng', email: 'ada@grace.org', phone: '',
      type: 'member', notes: '', tags: [], totalDonated: 0, lastDonationAt: null,
      memberSince: null, createdAt: null, createdBy: 'u1', updatedAt: null, tenantId: 'grace',
    }];
    await crm();

    await click(Array.from(container.querySelectorAll('p, div, span'))
      .find((el) => (el.textContent ?? '').trim() === 'Ada Ng')!);
    expect(text(), 'the contact did not open').toMatch(/total given/i);

    await click(buttonSaying(/Add Activity/));
    const donationChip = Array.from(container.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === 'donation');
    expect(donationChip, '🔴 no manual donation entry exists — the disclosure has no remedy')
      .toBeTruthy();
    await click(donationChip!);

    await type(container.querySelector('input[type="number"]') as HTMLElement, '40');
    await type(
      container.querySelector('textarea[placeholder="What happened?"]') as HTMLElement,
      'PayPal gift, 3 Aug',
    );
    await click(buttonSaying(/^\s*Add\s*$/));

    /**
     * 🔴 THE-350 — THE LEDGER WRITE, FIRST. This is the founder's exact
     * complaint measured through the REAL mounted screen: "if I add a donation
     * from a user in CRM it updates the CRM but not the dashboard". A $40 gift
     * must now reach `tenants/{t}/invoices`, which is what the dashboard,
     * accounting, the giving statement and the member's own history all read.
     */
    const ledger = h.requests.find((r) => r.url === '/api/donations/manual');
    expect(ledger, '🔴 the gift never reached the money ledger — this is the bug').toBeTruthy();
    // 🔴 INTEGER CENTS. `AdminAccounting` shipped the inverse and rendered
    // $105,500 as $10,550,000; 40 dollars is 4000 cents, never 40 and never 400000.
    expect(ledger!.body!.amountCents, 'the amount did not reach the ledger in integer cents')
      .toBe(4000);
    expect(Number.isInteger(ledger!.body!.amountCents as number)).toBe(true);
    // 🔴 The identity key, and the source that tells a manual gift from a processed one.
    expect(ledger!.body!.email, "the giver's email did not reach the ledger").toBe('ada@grace.org');
    expect(ledger!.body!.source, 'the gift is indistinguishable from a processed one')
      .toBe('crm_manual');
    expect(ledger!.body!.description).toBe('PayPal gift, 3 Aug');
    expect(ledger!.body!.tenantId).toBe('grace');

    // The activity, and the contact's own totals.
    const activity = h.writes.added.find((w) => w.type === 'donation');
    expect(activity, 'no donation activity was written').toBeTruthy();
    /**
     * 🔴 THE ACTIVITY LINKS, IT DOES NOT DUPLICATE. `amount` is the field the
     * Stripe webhook writes in DOLLARS and the field any future money reader
     * would reach for; on a gift recorded here it is null, and the row points
     * at the invoice instead. One gift, one money record — a gift counted twice
     * is worse than a gift counted once in the wrong place.
     */
    expect(activity!.amount, 'the activity carries money as well as the invoice — double count')
      .toBeNull();
    expect(activity!.invoiceId, 'the activity does not reference the invoice it belongs to')
      .toBe('inv_1');
    expect(activity!.invoiceAmountCents, 'the timeline has no figure to render').toBe(4000);

    // ⚠️ `totalDonated` is UNCHANGED and still in DOLLARS — the contact's own
    // running total, the same field the webhook increments for a Stripe gift.
    const contact = h.writes.set.find((w) => 'totalDonated' in w);
    expect(contact, 'the contact total was not updated').toBeTruthy();
    expect(contact!.totalDonated, 'the gift did not add to total given').toBe(40);
    expect(contact!.lastDonationAt, 'the gift was not dated').toBe('SERVER_TS');
  });

  it('🔴 and the copy does NOT oversell it — the ONE gap left is named', async () => {
    /**
     * 🔴 INVERTED BY THE-350, and it is still the same question: does the copy
     * match what the code does?
     *
     * THE-249 asserted the copy said a manual entry reaches NO statement,
     * because it wrote only a `contactActivities` row. It now writes the
     * `donation_receipt` invoice statements are built from, so the honest test
     * is that the copy says so — and that the ONE case where a recorded gift
     * still cannot reach its giver is named rather than left for January.
     */
    await donations();
    expect(text(), 'the copy still says a recorded gift reaches no statement')
      .not.toMatch(/It does not put the gift on a giving statement/i);
    expect(text(), 'the copy still says statements are Stripe-only')
      .not.toMatch(/statements are built from Stripe gifts alone/i);
    expect(text(), 'the no-email exception is not named')
      .toMatch(/no email address is the one exception/i);

    // 🔴 And that is true of the CODE. The CRM reaches the ledger through the
    // route — it does not, and may not, write `invoices` from the browser: the
    // rule gates that collection on `manageAccounting`, which the admin
    // recording a gift need not hold.
    const crmSrc = read('src/components/AdminCRM.tsx');
    expect(crmSrc, 'the CRM writes the invoices collection directly from the client')
      .not.toMatch(/'invoices'/);
    expect(crmSrc, 'the CRM no longer records the gift in the ledger at all')
      .toMatch(/authFetch\('\/api\/donations\/manual'/);
    // The one server-side writer, and the shape statements read.
    expect(read('src/lib/manual-donation.ts')).toMatch(/type: 'donation_receipt',/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. The giving-statement surface — the moment the tax document is produced.
// ═════════════════════════════════════════════════════════════════════════════
describe('the giving-statement surface carries the same limitation', () => {
  it('🔴 states it above the Generate button, in the terms a tax document needs', async () => {
    await statements();
    // AMENDED BY THE-362: a gift recorded in the CRM now writes a receipt and
    // therefore DOES reach a statement. The gap this asserts is still stated -
    // it is now "until somebody records it" rather than "never".
    expect(text()).toMatch(/These statements cover every gift with a receipt/i);
    expect(text(), 'the providers are not named').toContain(GIVING_PROVIDER_NAMES);
    expect(text(), 'the consequence to the MEMBER is not stated')
      .toMatch(/will see a total lower than what they actually gave you/i);
    /**
     * AMENDED BY THE-362, and this one was defending the false claim outright.
     *
     * It required the screen to say a CRM entry does NOT reach a statement.
     * That was true when it was written and false from THE-350 onward - the
     * manual path writes the same `donation_receipt` invoice the generator
     * aggregates, proven end to end in `THE-362.manual-gift-reaches-the-books`.
     *
     * What a tax document surface actually needs stated is the CONDITION, and
     * there are two: a link gift reaches a statement only once somebody records
     * it, and a gift recorded against a contact with NO EMAIL ADDRESS cannot
     * reach one at all, because the generator groups by email and skips an
     * empty one. Both are asserted; the false absolute is not.
     */
    expect(text(), 'the screen does not say recording is what puts a gift on a statement')
      .toMatch(/only once somebody records it/i);
    expect(text(), 'the emailless gift - on the books, on no statement - is not stated')
      .toMatch(/no email\s+address cannot appear at all/i);
    expect(text(), 'the church is not told what to do instead')
      .toMatch(/Check your own provider records before you send/i);

    const block = container.querySelector('[data-testid="statements-manual-links"]')!;
    const generate = buttonSaying(/Generate/);
    expect(
      block.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the disclosure sits below the button it is about',
    ).toBeTruthy();
  });

  it('is unconditional — a church that adds a link next week generates the same PDF', async () => {
    // Every other gate on this screen keys off a plan feature. This one is
    // about what the document CONTAINS, which no tenant state changes.
    h.ctx.current.branding = {};
    await statements();
    expect(container.querySelector('[data-testid="statements-manual-links"]')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. The CRM — why a contact can read $0 having given.
// ═════════════════════════════════════════════════════════════════════════════
describe('the CRM surface explains why a contact may show no giving', () => {
  it('says it once, beneath the totals it is about, and names the remedy', async () => {
    h.ctx.current.branding = WITH_LINKS;
    await crm();
    const note = container.querySelector('[data-testid="crm-manual-giving"]');
    expect(note, 'the CRM says nothing about the gap').toBeTruthy();

    const copy = (note!.textContent ?? '').replace(/\s+/g, ' ');
    expect(copy).toMatch(/Gifts sent through your own payment links are not counted here/i);
    expect(copy, 'the per-contact symptom is not described')
      .toMatch(/stays at \$0 total given, with no last gift and the Member stage/i);
    expect(copy, 'the remedy is not named').toMatch(/press Add Activity, choose Donation/i);

    // Beneath the giving totals, which is what it explains.
    const totals = Array.from(container.querySelectorAll('p'))
      .find((p) => (p.textContent ?? '').trim() === 'Total Given')!;
    expect(
      totals.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the note sits above the totals it explains',
    ).toBeTruthy();
  });

  it('⚠️ is section-level, not per contact — one note however many contacts', async () => {
    h.ctx.current.branding = WITH_LINKS;
    h.contacts.current.data = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, firstName: 'P', lastName: `${i}`, email: `p${i}@grace.org`, phone: '',
      type: 'member', notes: '', tags: [], totalDonated: 0, lastDonationAt: null,
      memberSince: null, createdAt: null, createdBy: 'u1', updatedAt: null, tenantId: 'grace',
    }));
    await crm();
    expect(container.querySelectorAll('[data-testid="crm-manual-giving"]')).toHaveLength(1);
  });

  it('⚠️ is silent for a church with no links — the banner nobody reads', async () => {
    // A church with no payment links has no gap: every gift it can receive is a
    // Stripe gift. Showing it the note on every CRM load is the noise that
    // teaches admins to skip the notes that matter.
    h.ctx.current.branding = {};
    await crm();
    expect(container.querySelector('[data-testid="crm-manual-giving"]')).toBeNull();
  });

  it('⚠️ is silent for a link that no longer validates, exactly as the Give page is', async () => {
    // `readGivingLinks` re-validates on read. A host that is no longer on the
    // provider allow-list stops being a link on the member Give page, so it
    // must stop counting as a published link here too.
    h.ctx.current.branding = { givingLinks: { paypal: { url: 'https://paypa1.example.com/grace' } } };
    await crm();
    expect(container.querySelector('[data-testid="crm-manual-giving"]')).toBeNull();
  });

  it('adds no query — it reads the tenant config the shell already holds', () => {
    const src = read('src/components/AdminCRM.tsx');
    expect(src).toMatch(/const hasManualGivingLinks = useMemo\(\(\) => readGivingLinks\(branding\)\.length > 0, \[branding\]\);/);
    // The screen's read surface is unchanged: the same three CRM hooks it had.
    expect((src.match(/useContactsWithUsers|useContactActivities|useCRMCounts/g) ?? []).length)
      .toBeGreaterThan(0);
    expect(src, 'the CRM gained a getDoc for the tenant document').not.toMatch(/getDoc\(/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. The contrast — Stripe still does all three, and still says so.
// ═════════════════════════════════════════════════════════════════════════════
describe('the Stripe disclosure is unchanged and still true', () => {
  it('🔴 still promises a record, a receipt and a statement', async () => {
    await donations();
    expect(text()).toMatch(/Card and bank gifts, taken inside the app/i);
    expect(text()).toMatch(/Harvest records every gift, sends the receipt, and includes it on your year-end giving statements/i);
    /**
     * ⚠️ THE CONTRAST HALF WAS RETIRED BY THE-350. It read "Only gifts given
     * through Stripe are recorded and receipted", which became false the moment
     * Add Activity → Donation started writing the same `donation_receipt`
     * invoice. The Stripe promise itself is UNCHANGED and still asserted above,
     * word for word; what is gone is the claim about everything else.
     */
    expect(text(), 'the retired contrast line is back, and it is not true')
      .not.toMatch(/Only gifts given through Stripe are recorded and receipted/i);
    // What replaced it: the manual path, named as a thing that also works.
    expect(text(), 'the manual path is not named as a real alternative')
      .toMatch(/writes a donation receipt/i);
  });

  it('🔴 and every clause of that promise is backed by the webhook', () => {
    // Not a string pin: each of the three claims is checked against the module
    // that makes it happen, so the Stripe copy cannot quietly become the lie
    // the manual-links copy exists to prevent.
    const webhook = read('src/lib/donation-webhook.ts');
    expect(webhook, 'records every gift — the CRM write is gone')
      .toMatch(/totalDonated: FieldValue\.increment|totalDonated/);
    expect(webhook, 'sends the receipt — the receipt call is gone')
      .toMatch(/await issueDonationReceipt\(/);
    expect(webhook, 'includes it on statements — the invoice line is gone')
      .toMatch(/type: 'donation_receipt'/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Behaviour untouched.
// ═════════════════════════════════════════════════════════════════════════════
describe('no statement, receipt, CRM write or Stripe path changed', () => {
  /**
   * ⚠️ `src/app/api/giving-statements/generate/route.ts` and the member-deletion
   * modules are DELIBERATELY ABSENT from this map. THE-229 is editing the
   * statement anonymisation logic in the same window; a byte pin here would
   * fail on their merge without saying anything this ticket cares about. The
   * two things this ticket depends on in that file — the `invoices` query and
   * the `donation_receipt` filter — are pinned as invariants in section 3.
   */
  const UNCHANGED: Readonly<Record<string, string>> = {
    'src/lib/donation-webhook.ts':
      'f835ce195029a246a06d00e4202f8149c54b3a37b4ad9e425a7c1081a317aeed',
    'src/lib/donation-receipt.ts':
      'a7d4872a73e7eb3518d47c264373428d1663afd43032506e5402123cdab1723a',
    'src/lib/donation-history.ts':
      '47e4c9edfe038efd2497df976254868faef08f8a6c208b4885203908ffda19db',
    /*
     * ⚠️ RE-RECORDED BY THE-155, and by nothing else in this list.
     *
     * Two docblocks in that file still described paid event tickets as
     * DESTINATION charges; THE-154 made them direct charges. Prose only — the
     * comment-stripped source is byte-identical and `PLATFORM_FEE_MAP` is
     * untouched, so nothing THE-249 depends on moved: Harvest is still not in
     * the manual-link path, and the fee on the Stripe path is still 0.
     */
    'src/lib/stripe-connect.ts':
      'ca494d925deb1e6dde5a740cbef0c1d24fc48e8e8655222b53ba4cda19b4d6e1',
    /*
     * ⚠️ RE-RECORDED BY THE-256, and by nothing else in this list.
     *
     * Stripe closed the platform account as `rejected.fraud` on 2026-08-27, so
     * the donate route now answers 503 while `STRIPE_CONNECT_ENABLED` is false —
     * one refusal, first in the handler, and not another byte changed.
     *
     * 🔴 THAT IS THIS TICKET'S PREMISE, NOT A THREAT TO IT. THE-249 exists
     * because the manual payment links are a path Harvest is NOT in: no receipt,
     * no statement, no fee, no endpoint. Hiding the Stripe path is precisely
     * what leaves the manual one standing — `GivingLinks.tsx` and
     * `giving-providers.ts` are untouched by THE-256, every disclosure this
     * suite pins is unchanged, and the links editor sits on the same screen as
     * the hidden Stripe panel and keeps working. The unchanged digests around
     * this one say so, `donation-webhook.ts` and the Connect webhook included.
     */
    'src/app/api/stripe/donate/route.ts':
      '04c78731552a29297e41495af61e5202eae7461d954806a3792c0e763ccd26b9',
    'src/app/api/stripe/connect/webhook/route.ts':
      'febfc599c9ffedb31843bc7cb00e58ae50fb2db09998dfd455ad6b2d37054b1e',
    'src/app/api/giving-statements/config/route.ts':
      '48ad99a41cafd02a423493abf73308195108551c0da9d542f979f6cf8cc083b6',
    /*
     * RE-RECORDED BY THE-342, and here is the whole of what moved: FOUR
     * `orderBy(documentId())` clauses and one docblock.
     *
     * THE-249 pinned this file to prove its ticket was copy and placement only.
     * THE-342 deliberately edits it, because all four CRM reads carried an
     * UNORDERED `limit(CRM_FETCH_LIMIT)`. Firestore has no default order — an
     * unordered limit is served in `__name__` order over random document ids —
     * so the thousand rows were an arbitrary and unstable thousand, and the
     * same admin refreshing the CRM could be shown a different thousand people.
     * "Showing 1,000 of 1,240" was true about the number while saying nothing
     * about WHICH.
     *
     * IT IS A READ SHAPE, AND ONLY A READ SHAPE. This file's claim — that no
     * statement, receipt, CRM WRITE or Stripe path changed — is unchanged and
     * still true:
     *
     *   • no write moved. There is no setDoc, updateDoc or addDoc in the file
     *     and none was added; the four edits are query constraints on reads.
     *   • no ceiling moved. `CRM_FETCH_LIMIT` is still 1000 for both
     *     collections and both scoping paths, so the card's 500/1000 split
     *     still does not exist and nothing about the counts changed.
     *   • no scoping moved. The super-admin gate, the platform-tenant filter,
     *     the `NO_TENANT_SCOPE_MESSAGE` throw and `mergeContactsWithUsers` are
     *     byte-identical.
     *   • no index is needed. Every automatic single-field index is keyed
     *     (field, __name__), so `where('tenantId','==',x)` plus this ordering
     *     is a prefix scan of an index that already exists.
     *
     * The digest still asserts byte-for-byte identity; only the bytes it names
     * moved.
     *
     * ─── RE-RECORDED AGAIN BY THE-350, and again the whole of what moved ────
     *
     * TWO OPTIONAL FIELDS ON A TYPE AND ONE CORRECTED DOC COMMENT. `ContactActivity`
     * gains `invoiceId` and `invoiceAmountCents`, and `amount`'s comment now says
     * what it means: DOLLARS for a Stripe gift the webhook logs and for every
     * manual activity written before THE-350, and ALWAYS NULL on a gift recorded
     * by hand since it — because the money record for such a gift is the
     * `tenants/{t}/invoices` receipt the row points at, and carrying the figure
     * in `amount` as well would be one gift in two money-bearing documents.
     *
     * ⚠️ IT IS A TYPE, AND ONLY A TYPE. Every claim above still holds and is
     * still the reason this file is pinned here: no write moved (there is still
     * no setDoc, updateDoc or addDoc in the file), no ceiling moved, no scoping
     * moved, THE-342's four `orderBy(documentId())` clauses are untouched, and
     * no index is needed. The CRM WRITE this ticket does change is in
     * `AdminCRM.tsx`, which this file exercises end to end above rather than
     * pinning by hash.
     */
        /**
     * RE-RECORDED BY THE-362, and here is the whole of what moved: `Contact`
     * gains ONE optional field, `accountOnly?: true`.
     *
     * It is the fact the CRM delete had no way to ask for. This list MERGES
     * `contacts` with `users`, and a consumer of the merged array could not
     * tell a CRM record from a surfaced app member - so the delete aimed at
     * `contacts/<row.id>` for every row, and for an app member that id is a
     * `users` id naming a document that has never existed. The founder: "If I
     * delete a user in CRM, it doesn't disappear from the table."
     *
     * NO READ, NO QUERY AND NO FETCH SHAPE MOVED, which is what this pin exists
     * to prove: the four `orderBy(documentId())` clauses, `CRM_FETCH_LIMIT`,
     * the scoping branch, the super-admin gate, the `NO_TENANT_SCOPE_MESSAGE`
     * throw, the members-read rethrow and the merge itself are byte-identical,
     * and THE-342's own guards still measure every one of them against the file
     * on disk rather than trusting a hash to stand in for them.
     */
    /**
     * RE-RECORDED BY #519 (newsletter opt-in). What moved: the contacts/users
     * MERGE and its helpers move verbatim into `src/lib/crm-merge.ts`, which this
     * hook imports and re-exports, so the server CSV export runs the identical
     * merge; and `Contact` gains ONE optional field, `accountProfile`, carrying
     * the users doc's tenantId, createdAt and newsletter consent fields. NO
     * READ, NO QUERY AND NO FETCH SHAPE MOVED: the four `orderBy(documentId())`
     * clauses, `CRM_FETCH_LIMIT`, the scoping branch and the super-admin gate
     * are byte-identical, and still no write lives in this file.
     */
'src/hooks/queries/useCRMQueries.ts':
      'd273ea858f0433f534282a3bd42df2a4f898887fb0dc8fef8e36a9a5f5959f04',
    // Re-recorded by THE-261: its v4 migration renamed shadow-sm and
    // outline-none across the app so those utilities keep painting what they
    // painted under v3. AdminAccounting carries those spellings and nothing
    // else moved in it — no statement, receipt, CRM write or Stripe path is a
    // class name. The digest still asserts byte-for-byte identity; only the
    // bytes it names moved, and the diff beside this commit is where from.
    /*
     * ⚠️ RE-RECORDED BY THE-303, and here is the whole of what moved.
     *
     * THE-249 pinned this file to prove its ticket was copy and placement only.
     * THE-303 DELIBERATELY edits it, because the founder asked accounting for
     * the one thing it had never said: "I added an activity from a user in CRM
     * that donated cash … but in accounting it shows 0 dollars given."
     *
     * ONE ADDITION, and nothing else in the file moved: a collapsible note
     * between the summary cards and the QuickBooks section, saying that these
     * totals are built from Stripe receipts alone and that a CRM Donation
     * activity is a separate record.
     *
     * 🔴 IT IS COPY, AND ONLY COPY. It reads nothing, writes nothing and gates
     * nothing:
     *
     *   • no collection was added — `the-303-admin-explainers.test.tsx` asserts
     *     the screen still opens `invoices` and `givingStatements` and NO CRM
     *     collection, by watching the paths it actually subscribes to.
     *   • no total changed — the same suite feeds two invoices in cents and
     *     asserts the screen reads $75, and that `/ 100` still appears exactly
     *     twice, on two different fields.
     *   • `totalDonated`, `lastDonationAt` and `contactActivities` appear
     *     nowhere in this file, asserted by name. Summing CRM activities into
     *     the church's books would double-count every gift recorded both ways,
     *     which is why the answer is a sentence and not a sum.
     */
    /**
     * RE-RECORDED BY THE-362, and here is the whole of what moved: TWO
     * OCCURRENCES OF ONE WORD, inside the note THE-303 added.
     *
     * The founder: "Hide everything that talks about stripe. In donations,
     * everywhere." The cash note named the processor twice — "These totals
     * count Stripe gifts only" and "would count a Stripe gift twice" — on a
     * screen a church reads about its own giving.
     *
     * THE CLAIM IS UNCHANGED, only the noun. "Gifts Harvest processed" is
     * the same set the old sentence meant, said without the brand: a gift is on
     * this screen when Harvest issued a receipt for it, and the reason the two
     * records are kept apart is still that a card gift already writes both.
     *
     * AND NOTHING ELSE IN THE FILE MOVED. No collection was added, no total
     * changed, `/ 100` still appears exactly twice on two different fields, and
     * `totalDonated` / `lastDonationAt` / `contactActivities` still appear
     * nowhere — every one of those is asserted by name in
     * `the-303-admin-explainers.test.tsx`, which runs against the file on disk
     * rather than trusting this hash to stand in for it.
     */
    'src/components/AdminAccounting.tsx':
      '9e9b77792d2316217b13fe2b700574db414fbce511ab9bd8945d04ed3b7faf0c',
  };

  it.each(Object.keys(UNCHANGED))('%s is byte-for-byte unchanged', (file) => {
    const digest = createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');
    expect(digest, `${file} changed — this ticket is copy and placement only`).toBe(UNCHANGED[file]);
  });

  it('🔴 leaves firestore.rules and functions/ alone', () => {
    // firestore.rules auto-deploys to production on merge to main.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
    expect(createHash('sha256').update(readFileSync(join(ROOT, 'functions/src/index.ts'))).digest('hex'))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
  });

  it('the three edited screens gained no write and no endpoint', () => {
    // AdminGivingStatements keeps its two endpoints and nothing else.
    const stmt = read('src/components/AdminGivingStatements.tsx');
    expect((stmt.match(/authFetch\(/g) ?? []).length, 'the statements screen gained a request').toBe(3);
    expect(stmt).toContain("authFetch('/api/giving-statements/config')");
    expect(stmt).toContain("authFetch('/api/giving-statements/generate'");
    expect(stmt, 'the statements screen now writes to Firestore')
      .not.toMatch(/\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch)\(/);

    // AdminDonations keeps exactly its one write, at the one dotted path.
    const don = read('src/components/AdminDonations.tsx');
    expect((don.match(/\bupdateDoc\(/g) ?? []).length).toBe(1);
    expect(don).toContain("'config.givingLinks': buildGivingLinkRecord(draft),");
    expect(don, 'the donations screen gained a second write')
      .not.toMatch(/\b(addDoc|setDoc|deleteDoc|writeBatch)\(/);

    /**
     * The CRM's write surface, ENUMERATED so a screen cannot gain a silent one.
     *
     * ⚠️ ONE `setDoc(` APPENDED BY THE-369, AND THE LIST SAYS WHICH. That ticket
     * lets a church delete ONE row from a contact's timeline, and when the row
     * is a gift the CRM itself recorded the receipt goes with it — so the
     * contact's `totalDonated` has to come back down. It is the SAME
     * read-modify-write `addActivity` uses to put it up, in the same component,
     * deliberately: the total is client-maintained, and THE-359 declined to bump
     * it from a server route precisely because a server write would race this
     * one. Subtracting it anywhere else would reintroduce that race.
     *
     * 🔴 APPENDED, NEVER REWRITTEN. The five calls this list already held are
     * all still here and still named; a call that is in neither set still fails,
     * which is the whole threat the enumeration was built for. The deletion
     * itself adds no `deleteDoc(` — it goes through an Admin-SDK route, because
     * a client cannot reach `tenants/{t}/invoices` at all.
     */
    const crmSrc = read('src/components/AdminCRM.tsx');
    const calls = (crmSrc.match(/\b(addDoc|setDoc|deleteDoc|updateDoc|writeBatch)\(/g) ?? []).sort();
    expect(calls, 'the CRM gained or lost a write call').toEqual(
      [
        'addDoc(', 'addDoc(', 'deleteDoc(', 'setDoc(', 'setDoc(', 'setDoc(', 'writeBatch(',
        // APPENDED BY THE-369 — the `totalDonated` decrement. See the note above.
        'setDoc(',
      ].sort(),
    );
  });

  it('the CRM note is presentation — it gates nothing that reads or writes', () => {
    const src = code('src/components/AdminCRM.tsx');
    // The predicate is spelled exactly twice in CODE: where it is derived, and
    // where it is rendered. A third use would be a gate on something that is
    // not copy — a query, a write, a filter.
    expect((src.match(/hasManualGivingLinks/g) ?? []).length).toBe(2);
    expect(src).toMatch(/\{showGiving && hasManualGivingLinks && \(/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Colour and palettes.
// ═════════════════════════════════════════════════════════════════════════════
describe('no colour is hardcoded and both palettes resolve', () => {
  /** The elements this ticket adds, on every surface, as rendered. */
  const addedRegions = (): Element[] => {
    const out: Element[] = [];
    for (const sel of ['[data-testid="statements-manual-links"]', '[data-testid="crm-manual-giving"]']) {
      const el = container.querySelector(sel);
      if (el) out.push(el, ...Array.from(el.querySelectorAll('*')));
    }
    return out;
  };

  it('renders no literal colour and no inline style on anything it adds', async () => {
    h.ctx.current.branding = WITH_LINKS;
    for (const open of [statements, crm]) {
      await open();
      const regions = addedRegions();
      expect(regions.length, 'the added block did not render').toBeGreaterThan(0);
      for (const el of regions) {
        /**
         * 🔴 THE-338 NARROWED THIS FROM "no inline style" TO "no inline
         * COLOUR", and the distinction is the whole point of the assertion.
         *
         * The CRM note is now a Collapsible (the founder asked for the
         * disclaimer to fold), and base-ui's panel sets its own measurement
         * variables inline — `--collapsible-panel-height`, `--collapsible-
         * panel-width`. Those are how the primitive animates its own height;
         * they carry no colour and no layout decision this ticket made.
         *
         * What this test exists to catch is a hardcoded COLOUR escaping
         * globals.css, which is exactly what the class scan below it checks.
         * So the style attribute is checked for the same thing rather than
         * for being absent — a `style="color: #C4553B"` still fails here.
         */
        const inline = el.getAttribute('style') ?? '';
        expect(inline, `${el.tagName} carries an inline colour`)
          .not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|(?:^|;)\s*(?:color|background)/);
        for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
          expect(cls, `${cls} looks like a literal colour`)
            .not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);
        }
      }
      if (mounted) await act(async () => { root.unmount(); });
      mounted = false;
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  it('adds no colour literal to any of the three blocks it writes', () => {
    // Block-scoped rather than whole-file: all three screens carry colour
    // literals that predate this ticket (the CRM's stage palette, the
    // statements screen's GOLD constant). A file-level count would either pass
    // trivially or pin somebody else's decision. What this ticket may not do is
    // add one, and the blocks it adds are exactly where that would show.
    for (const [label, block] of Object.entries(addedBlocks())) {
      expect(block, `${label}: the block did not resolve`).toBeTruthy();
      expect(block, `${label} hardcodes a colour`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
      expect(block, `${label} carries an inline style`).not.toMatch(/style=\{\{/);
    }
  });

  it('every token the new blocks spell is defined for both palettes', () => {
    // Harvest and Classic × light and dark. Resolved out of the REAL
    // globals.css, never pinned to a hex.
    const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
    const varsIn = (match: (sel: string) => boolean) => {
      const out: Record<string, string> = {};
      postcss.parse(css).walkRules((rule) => {
        if (!match(rule.selector)) return;
        rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
      });
      return out;
    };
    const rootVars = varsIn((s) => s.trim() === ':root');
    const darkVars = varsIn((s) => /\[data-theme="dark"\]/.test(s) && !/data-palette/.test(s));
    const palettes: Record<string, Record<string, string>> = {
      light: { ...rootVars },
      dark: { ...rootVars, ...darkVars },
    };
    const resolve = (vars: Record<string, string>, token: string): string | null => {
      let value: string | undefined = vars[token];
      for (let hops = 0; hops < 8 && value; hops++) {
        const ref: RegExpMatchArray | null = value.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
        if (!ref) return value;
        value = vars[ref[1]];
      }
      return value ?? null;
    };
    expect(Object.keys(palettes)).toHaveLength(2);

    // The tokens behind the classes the new blocks use: the card and sunken
    // grounds, the border, the body/strong inks, and the gold the icon takes.
    const TOKENS = [
      '--surface-raised', '--surface-sunken', '--border-default',
      '--text-body', '--text-strong', '--brand-color',
    ];
    for (const [name, vars] of Object.entries(palettes)) {
      expect(Object.keys(vars).length, `${name} defines no variables`).toBeGreaterThan(0);
      for (const token of TOKENS) {
        const resolved = resolve(vars, token);
        expect(resolved, `${token} unset for ${name}`).toBeTruthy();
        expect(resolved, `${token} is not a colour for ${name}`).toMatch(/^(#|rgb|hsl|color-mix|var)/);
      }
    }
    // The two palettes must actually differ, or "both palettes" is one wearing
    // two names. (THE-338: this compared the two FAMILIES; with one family the
    // same property is that the two MODES differ.)
    expect(resolve(palettes.dark, '--surface-raised'))
      .not.toBe(resolve(palettes.light, '--surface-raised'));
  });

  it('invents no width and shrinks no touch target', () => {
    // The measures on these screens are the ones form-layout.ts already set,
    // and the Donations paragraph sits inside the READING_MEASURE block THE-246
    // put its warning in.
    /**
     * 🔴 THE-338 — THE CRM BLOCK IS DELIBERATELY NO LONGER PROSE.
     *
     * The founder asked for this disclaimer to collapse ("make that
     * disclaimer in CRM collapsible"), so it now has a trigger, and a trigger
     * is a tap target: `min-h-11` below `sm`. Under the original rule that
     * reads as "sets a height", which was written when every block here was a
     * paragraph — so the CRM entry is checked against the rule that actually
     * applies to a control, and the other two keep the prose rule unchanged.
     *
     * ⚠️ It is exempted from "sets a height" ONLY for the 44px minimum. A
     * fixed height, or a width, still fails for the CRM block too.
     */
    const CRM = 'CRM — why a contact reads $0';
    for (const [label, block] of Object.entries(addedBlocks())) {
      expect(block, `${label} invents a width`).not.toMatch(/max-w-|\bw-\[|min-w-/);
      if (label === CRM) {
        // A fixed or arbitrary height still fails; only `min-h-*` is allowed,
        // and only because it is the tap-target floor asserted on the next line.
        expect(block, `${label} sets a fixed height`).not.toMatch(/(?<!min-)\bh-\[|(?<!min-)\bh-\d/);
        expect(block, `${label} lost the 44px tap target on its trigger`).toMatch(/min-h-11/);
        expect(block, `${label} lost its disclosure trigger`).toMatch(/CollapsibleTrigger/);
      } else {
        expect(block, `${label} sets a height`).not.toMatch(/\bh-\[|\bh-\d|min-h-/);
        expect(block, `${label} adds an interactive control`).not.toMatch(/<button|<input|<a\s/);
      }
    }
    // The disclosure THE-246 wrote still sits inside the reading measure, so
    // the paragraph added to it inherits a measure rather than needing one.
    expect(read('src/components/AdminDonations.tsx'))
      .toMatch(/border-b border-line \$\{READING_MEASURE\}/);
  });
});
