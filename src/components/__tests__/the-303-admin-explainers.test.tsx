import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GIVING_PROVIDER_NAMES_OR } from '../donations/giving-providers';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-303 — BUGS 5 AND 6: the two explainers, and the line accounting must not
 * cross.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   5. "Put the whole text in donations as collapsible. Is too long."
 *   6. "I added an activity from a user in CRM that donated cash … but in
 *      accounting it shows 0 dollars given."
 *
 * 🔴 THE TWO ARE THE SAME SHAPE ON PURPOSE. Bug 5's copy is folded, not cut —
 * every word of it is load-bearing. Bug 6's answer is a new fold saying the
 * thing accounting never said, rather than a new SUM, because summing CRM
 * activities into the church's books would double-count every gift recorded
 * both ways. The last two describes below are what stop that ever being done.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');

/* ── mocks: the network and the data layer only ─────────────────────────────── */
const h = vi.hoisted(() => ({
  tenantDoc: { current: {} as Record<string, unknown> },
  invoices: { current: [] as Record<string, unknown>[] },
  /** Every Firestore collection path either screen actually opened. */
  paths: [] as string[],
}));

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => { h.paths.push(seg.join('/')); return { __p: seg.join('/') }; },
  query: (c: any) => c,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => h.tenantDoc.current }),
  getDocs: async () => ({ docs: [] }),
  updateDoc: async () => {},
  addDoc: async () => ({ id: 'x' }),
  setDoc: async () => {},
  deleteDoc: async () => {},
  serverTimestamp: () => 'TS',
  writeBatch: () => ({ set: () => {}, commit: async () => {} }),
  onSnapshot: (q: any, cb: (s: unknown) => void) => {
    const rows = String(q?.__p || '').endsWith('invoices') ? h.invoices.current : [];
    cb({ docs: rows.map((d, i) => ({ id: `r${i}`, data: () => d })) });
    return () => {};
  },
}));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => async () => ({ data: {} }),
}));
vi.mock('../settings/useTenantId', () => ({ getTenantId: async () => 'grace' }));
vi.mock('../settings/PaymentSection', () => ({ default: () => null }));
vi.mock('../../utils/tenant-scope', () => ({
  getWriteTenantScope: async () => 'grace',
  getTenantScope: async () => 'grace',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async () => ({ ok: true, json: async () => ({ connected: false }) }),
}));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../../utils/open-statement-pdf', () => ({ openStatementPdf: async () => {} }));
vi.mock('../AdminGivingStatements', () => ({ default: () => null }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ branding: h.tenantDoc.current.config ?? {} }),
  useTenantOptional: () => ({ planFeatures: { taxReceipt: true, accountingTools: true, givingStatements: true } }),
}));

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
};
async function mount(el: React.ReactElement) {
  await act(async () => { root = createRoot(container); root.render(el); });
  await flush();
  return container;
}
const donations = async () => mount(React.createElement((await import('../AdminDonations')).default));
const accounting = async () => mount(React.createElement((await import('../AdminAccounting')).default));

const click = async (el: Element | null) => {
  expect(el, 'the control under test was not rendered').not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};

/** Whitespace-normalised text, so a line wrap in the source is not a failure. */
const flat = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  h.tenantDoc.current = {};
  h.invoices.current = [];
  h.paths = [];
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container.remove();
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — 🔴 the donations explainer is collapsible AND its text is unchanged
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · the donations explainer is collapsible and its text is unchanged', () => {
  /**
   * 🔴 THE WORDS, VERBATIM. Not "it mentions statements" — the sentences, so
   * that softening, trimming or rewriting any of them fails here. Every one of
   * these is a fact a church would otherwise discover in January from a member
   * asking where their receipt is.
   */
  const WORDS = [
    'Harvest does not process these gifts.',
    `The money goes straight from your member to your own ${GIVING_PROVIDER_NAMES_OR} account.`,
    'There is no Harvest fee, no Harvest receipt, and nothing for Harvest to refund or dispute',
    'these accounts are yours, and so is everything that happens in them.',
    'Gifts given this way will not appear on giving statements.',
    "Harvest never sees them, so they are missing from donation history, from a member's receipts, and from every year-end statement you generate.",
    'Only gifts given through Stripe are recorded and receipted.',
    'Your CRM will not record them either.',
    'A member who gives this way keeps a total given of $0, no last-gift date and the Member stage',
    'the same as someone who has never given.',
    'To record one, open the contact in your CRM, press Add Activity, choose Donation and enter the amount: that adds to their total given and dates the gift.',
    'It does not put the gift on a giving statement, and nothing else does either',
    'statements are built from Stripe gifts alone.',
    'Everything you enter here is shown publicly on your Give page, including the email addresses',
    'that is how a member sends to the right account. Use an address you are happy to publish.',
  ];

  it('🔴 folds by default, and the summary line still names the thing that matters', async () => {
    await donations();
    const trigger = container.querySelector('[data-testid="donations-disclosure-toggle"]')!;
    expect(trigger, 'the explainer is not collapsible').not.toBeNull();
    expect(trigger.getAttribute('aria-expanded'), 'it opens by default — it is still too long')
      .toBe('false');
    // What a church reads without opening it: the one fact that changes what
    // they do next.
    expect(flat(trigger)).toContain('Harvest does not process these gifts');

    const panel = container.querySelector('[data-testid="donations-disclosure"]')!;
    expect(panel.hasAttribute('hidden'), 'the panel is not actually folded').toBe(true);
  });

  it('🔴 opens on the trigger, and closes again', async () => {
    await donations();
    const trigger = container.querySelector('[data-testid="donations-disclosure-toggle"]')!;
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelector('[data-testid="donations-disclosure"]')!.hasAttribute('hidden'),
      'the panel stayed folded after the trigger was pressed',
    ).toBe(false);

    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('🔴 NOT ONE WORD WAS CUT OR SOFTENED — every sentence is still there', async () => {
    await donations();
    await click(container.querySelector('[data-testid="donations-disclosure-toggle"]'));
    const text = flat(container.querySelector('[data-testid="donations-disclosure"]'));
    for (const sentence of WORDS) {
      expect(text, `the explainer lost or reworded: "${sentence}"`).toContain(sentence);
    }
  });

  it('the providers are still named from the TABLE, not typed out', async () => {
    // Adding a seventh provider must update this sentence with no edit — the
    // reason THE-254 replaced five hand-written lists with one constant.
    await donations();
    await click(container.querySelector('[data-testid="donations-disclosure-toggle"]'));
    expect(flat(container.querySelector('[data-testid="donations-disclosure"]')))
      .toContain(GIVING_PROVIDER_NAMES_OR);
    expect(code('src/components/AdminDonations.tsx')).toMatch(/GIVING_PROVIDER_NAMES_OR/);
  });

  it('⚠️ the fold does not hide the editor, the share button or Save', async () => {
    // Folding prose must not fold the screen. Everything an admin came here to
    // DO is still on the page with the disclosure shut.
    await donations();
    expect(container.querySelector('#giving-wise-url'), 'the links editor got folded away').not.toBeNull();
    expect(container.querySelector('[data-testid="giving-share-button"]')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => /Save payment links/i.test(b.textContent || '')),
      'Save got folded away',
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — accounting explains that cash and non-Stripe gifts do not appear
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · accounting explains that cash and non-Stripe gifts do not appear', () => {
  it('🔴 carries a collapsed note, and the summary line answers the founder’s question', async () => {
    await accounting();
    const trigger = container.querySelector('[data-testid="accounting-cash-note-toggle"]');
    expect(trigger, 'accounting still says nothing about a cash gift').not.toBeNull();
    expect(trigger!.getAttribute('aria-expanded')).toBe('false');
    // "in accounting it shows 0 dollars given. Is it because I didn't donate
    // through stripe?" — the shut state answers exactly that.
    expect(flat(trigger)).toContain('Why a cash or payment-link gift shows as $0 here');
  });

  it('🔴 and says, when opened, why — and where the gift IS recorded', async () => {
    await accounting();
    await click(container.querySelector('[data-testid="accounting-cash-note-toggle"]'));
    const text = flat(container.querySelector('[data-testid="accounting-cash-note"]'));
    expect(text).toContain('These totals count Stripe gifts only.');
    expect(text, 'cash is not named — it is what the founder actually recorded').toContain('Cash');
    expect(text).toContain(GIVING_PROVIDER_NAMES_OR);
    expect(text, 'the CRM remedy is not connected to the $0').toContain('Recording one in your CRM does not change these');
    expect(text).toContain('Add Activity');
    expect(text, 'the double-count reason is not given').toContain('would count a Stripe gift twice');
    expect(text).toContain('a giving statement generated');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — 🔴 accounting does NOT sum CRM activities
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('8 · accounting does NOT sum CRM activities', () => {
  it('🔴 opens `invoices` and `givingStatements`, and no CRM collection at all', async () => {
    await accounting();
    expect(h.paths.length, 'the screen opened no collection — the check is vacuous').toBeGreaterThan(0);
    for (const p of h.paths) {
      expect(
        p,
        `AdminAccounting opened "${p}" — a CRM collection in the church's books is a double count`,
      ).not.toMatch(/contacts|contactActivities|activities|donations$/);
    }
    expect(h.paths.some((p) => p.endsWith('invoices')), 'it stopped reading invoices').toBe(true);
  });

  it('🔴 its totals are the INVOICE sum and nothing else', async () => {
    // Two receipted gifts this year, in CENTS as the webhook writes them.
    const year = new Date().getFullYear();
    h.invoices.current = [
      { type: 'donation_receipt', amount: 5000, currency: 'usd', recipientName: 'A', recipientEmail: 'a@x.io', receiptNumber: 'R1', issuedAt: new Date(`${year}-01-15T00:00:00Z`).toISOString(), status: 'sent' },
      { type: 'donation_receipt', amount: 2500, currency: 'usd', recipientName: 'B', recipientEmail: 'b@x.io', receiptNumber: 'R2', issuedAt: new Date(`${year}-01-16T00:00:00Z`).toISOString(), status: 'sent' },
    ];
    await accounting();
    // $75, not $7,500 (cents read as dollars) and not $175 (a CRM gift added in).
    expect(flat(container)).toContain('$75');
    expect(flat(container), 'a CRM total leaked into the books').not.toContain('$175');
  });

  it('🔴 the source names no CRM field anywhere', () => {
    const src = code('src/components/AdminAccounting.tsx');
    for (const field of ['totalDonated', 'lastDonationAt', 'contactActivities', 'useContactActivities']) {
      expect(src, `AdminAccounting reads ${field} — that is the double count`).not.toMatch(field);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — cents and dollars are never mixed
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('9 · cents and dollars are never mixed', () => {
  it('🔴 `invoices.amount` is CENTS and is divided exactly once, on read', () => {
    const src = code('src/components/AdminAccounting.tsx');
    const divisions = src.match(/amount:\s*\(data\.amount \|\| 0\) \/ 100/g) ?? [];
    expect(divisions, 'the one normalisation of invoice cents moved or multiplied').toHaveLength(1);
    // ⚠️ EXACTLY TWO DIVISIONS ON THE SCREEN, AND THEY ARE DIFFERENT FIELDS.
    // `invoices.amount` above, and `givingStatements.totalAmount` at its own
    // render site — a separate collection with its own cents field, divided
    // where it is drawn rather than on read. Neither is applied twice, which
    // is what produced $10,550,000 from $105,500 before THE-246.
    const all = src.match(/\/ 100/g) ?? [];
    expect(all, 'a third division appeared — a cents field is being scaled twice').toHaveLength(2);
    expect(src, 'the statements total lost its own normalisation')
      .toMatch(/fmt\(s\.totalAmount \/ 100\)/);
  });

  it('🔴 `contacts.totalDonated` and `contactActivities.amount` are DOLLARS, and stay in the CRM', () => {
    // The unit contract, stated where it is declared. AGENTS.md records a 100×
    // error already shipped from exactly this pair.
    expect(read('src/hooks/queries/useCRMQueries.ts'))
      .toMatch(/DOLLARS for donation activities/);
    expect(read('src/hooks/queries/useCRMQueries.ts'))
      .toMatch(/totalDonated/);
    // Neither reaches the books.
    expect(code('src/components/AdminAccounting.tsx')).not.toMatch(/totalDonated/);
  });

  it('⚠️ the note quotes no AMOUNT — only the $0 the founder was looking at', async () => {
    // 🔴 The safest way not to mix units is not to state one. This note exists
    // to explain a missing figure, and it names no total, no threshold and no
    // sum of its own — the single `$0` it does carry is the symptom the founder
    // reported, not a value computed from anything.
    await accounting();
    await click(container.querySelector('[data-testid="accounting-cash-note-toggle"]'));
    const text = flat(container.querySelector('[data-testid="accounting-cash-note"]'));
    expect(text, 'the explanatory note quotes a money amount').not.toMatch(/\$[1-9]/);
    expect(text, 'the $0 the note exists to explain went missing').toContain('$0');
  });
});
