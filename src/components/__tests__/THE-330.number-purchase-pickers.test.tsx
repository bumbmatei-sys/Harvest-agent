import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* 🔴 THE-335 — THE MASTER SWITCH IS MOCKED ON.
   `SMS_FEATURE_ENABLED` is false on disk again, and `AdminSms` and `SmsSection`
   are one-line wrappers that render `null` while it is — so without this every
   assertion in this file would measure an empty string and the suite would pass
   while proving nothing about the composition it exists to pin. That is the
   failure mode this repo has been bitten by eleven times.

   ⚠️ MOCKED RATHER THAN THE SUITE DELETED OR SKIPPED. The switch's whole design
   is that the feature comes back INTACT; these suites are what proves it is
   still intact, so they have to keep running. `the-245-sms-hidden.test.ts` is
   where "no surface is reachable today" is asserted. */
vi.mock('../../lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));


/**
 * THE-330 — THE NUMBER PURCHASE FORM ASKS FOR TWO LETTERS AND THEN FAILS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The defect, from production ─────────────────────────────────────────────
 *
 * The founder: *"for sms put a list to choose the available countries. how is
 * someone supposed to know only from putting the 2 letters. also, fetch the
 * numbers so i can choose from."*
 *
 * From his screenshot of `/admin/sms`:
 *   1. Country was a FREE-TEXT box. He typed `DE`.
 *   2. Area code was a FREE-TEXT box. He typed `615` — a NASHVILLE code, in
 *      Germany.
 *   3. Check availability answered: *"local numbers in DE can't send or receive
 *      SMS. Pick another type, or buy without SMS."*
 *
 * 🔴 So the form let him name a country that cannot text and only said so
 * afterwards — and "pick another type" was advice about a field the form did
 * not have.
 *
 * ── 🔴 The rule this suite enforces ─────────────────────────────────────────
 *
 * A CHURCH MUST NEVER LEARN A CONSTRAINT FROM A FAILURE. Every "you can't do
 * that" the provider can state in advance is on screen BEFORE the Buy button,
 * not in an error after it. Section 7 sweeps the error paths and requires a
 * matching pre-purchase disclosure for each.
 *
 * ── ⚠️ The subtle one ───────────────────────────────────────────────────────
 *
 * SMS capability is per (COUNTRY, TYPE), never per country. The provider's
 * country-level `smsAvailable` mirrors the FIRST (default) type only, and the
 * default is documented as "the WhatsApp-safe choice" — a fact about WhatsApp.
 * So the two disagree in BOTH directions, and section 3 asserts both: GB
 * `mobile` texts while GB `local` does not, and US `local` texts while US
 * `toll_free` does not. Deciding from the country flag would put GB `local` on
 * sale and hand a church a number that is billed monthly and cannot text.
 *
 * ⚠️ EVERY ASSERTION BELOW WAS MUTATION-VERIFIED — the change was planted, the
 * named test confirmed to fail, and the change reverted. That matters more than
 * usual in this series: nine guards here passed a planted defect, including one
 * that passed with its own gate DELETED because the assertion's message
 * contained the string it grepped for. So the behavioural claims are asserted in
 * a RENDERED DOM wherever a rendered DOM can carry them, and every source grep
 * strips comments first (`codeOf`) so a sentence in a docblock can never satisfy
 * one.
 *
 * ⚠️ Nothing here shells out to `git`, and nothing here asserts anything about
 * the current branch's diff (#454's standing sweep). Every claim is about the
 * files as they are on disk, or about a rendered DOM.
 */

const SRC = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * 🔴 COMMENTS STRIPPED BEFORE EVERY SOURCE GREP — the most important helper
 * here. This file's own prose names `DE`, `615`, `smsAvailable` and
 * `formatPlanPrice`; a naive `toContain` over raw source would read those as the
 * thing it was asked to find. That is the exact recorded failure mode in this
 * series.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const SMS_SECTION = 'components/settings/SmsSection.tsx';
const SMS_COUNTRIES = 'lib/sms-countries.ts';
const ZERNIO = 'lib/zernio.ts';
const NUMBERS_ROUTE = 'app/api/sms/numbers/route.ts';

/* ═══════════════════════════════════════════════════════════════════════════
   Harness — a real React DOM with the provider's endpoints answered.
   ═══════════════════════════════════════════════════════════════════════════ */

const json = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve('') });

/**
 * 🔴 THE CATALOGUE FIXTURE — THE PROVIDER'S SHAPE, AND THE TICKET'S HARD CASES.
 *
 * Eleven countries in the live data have an SMS-capable type; five that sell
 * numbers have none. This fixture carries a representative of every case the
 * screen has to express, and deliberately includes the two directions in which
 * the country-level flag and the per-type flag DISAGREE:
 *
 *   · GB — country `smsAvailable: false` (it mirrors `local`, the default),
 *     yet its `mobile` type TEXTS. A country-level read would hide GB entirely.
 *   · US — country `smsAvailable: true`, yet its `toll_free` type does NOT
 *     text. A country-level read would offer `toll_free` as a texting number.
 *
 * ⚠️ NO DATE ANYWHERE IN THIS FIXTURE. A fixture pinned near "today" turned
 * `main` red for everyone in #468.
 */
const CATALOGUE = [
  {
    code: 'US', tier: 1, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
    types: [
      { numberType: 'local', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true },
      { numberType: 'toll_free', smsAvailable: false, whatsappAvailable: false, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true },
    ],
  },
  {
    code: 'CA', tier: 1, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
    types: [{ numberType: 'local', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'VI', tier: 1, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
    types: [{ numberType: 'local', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'PR', tier: 1, monthlyCents: 500, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
    types: [{ numberType: 'local', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 500, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'NL', tier: 2, monthlyCents: 500, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [
      { numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 500, needsKyc: false, fulfilment: 'instant', inStock: true },
      { numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 500, needsKyc: false, fulfilment: 'instant', inStock: true },
    ],
  },
  {
    // 🔴 THE HARD CASE. Country flag FALSE, `mobile` type TRUE.
    code: 'GB', tier: 3, monthlyCents: 300, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [
      { numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true },
      { numberType: 'national', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true },
      { numberType: 'toll_free', smsAvailable: false, whatsappAvailable: false, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true },
      { numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true },
    ],
  },
  {
    code: 'BE', tier: 3, monthlyCents: 300, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'LT', tier: 3, monthlyCents: 300, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'AU', tier: 3, monthlyCents: 900, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 900, needsKyc: true, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'PL', tier: 3, monthlyCents: 1300, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 1300, needsKyc: true, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'SE', tier: 3, monthlyCents: 1300, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 1300, needsKyc: true, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'ZA', tier: 3, monthlyCents: 1500, needsKyc: true,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 1500, needsKyc: true, fulfilment: 'instant', inStock: true }],
  },
  /* ── The five that sell numbers and CANNOT TEXT. The founder's exact case. ── */
  {
    code: 'DE', tier: 2, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [
      { numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true },
      { numberType: 'national', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true },
    ],
  },
  {
    code: 'FR', tier: 2, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'ES', tier: 2, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'IT', tier: 2, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  {
    code: 'IE', tier: 2, monthlyCents: 300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
    types: [{ numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true }],
  },
  /* ── Out of stock entirely, and by-request-only. Both are constraints the
       provider states in advance and neither may be offered as buyable. ── */
  {
    code: 'AR', tier: 2, monthlyCents: 700, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: false,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 700, needsKyc: false, fulfilment: 'instant', inStock: false }],
  },
  {
    code: 'HU', tier: 2, monthlyCents: 2300, needsKyc: false,
    callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
    types: [{ numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 2300, needsKyc: false, fulfilment: 'request', inStock: true }],
  },
];

const AREA_OPTIONS = [
  { ndc: '615', name: 'Nashville, TN', count: 42 },
  { ndc: '212', name: 'New York, NY', count: 118 },
];

const NUMBERS = [
  { phoneNumber: '+16155550100', features: ['voice', 'sms', 'mms'] },
  { phoneNumber: '+16155550101', features: ['voice', 'sms'] },
];

/** Mutable so one test can choose the failure path and another the answer.
 *  `vi.hoisted` because the mock factory is hoisted above every declaration. */
const server = vi.hoisted(() => ({
  countriesOk: true as boolean,
  countries: null as null | unknown[],
  number: null as null | Record<string, unknown>,
  /** Every request URL the panel made, so the ROUTE it asks can be asserted. */
  seen: [] as string[],
  /** Every POST body, so the purchase payload can be asserted. */
  posted: [] as unknown[],
}));

vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn((url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    server.seen.push(u);
    if (init?.method === 'POST') {
      server.posted.push(JSON.parse(init.body || '{}'));
      return json({ number: { phoneNumber: '+16155550100', status: 'active', monthlyCostUsd: 3, country: 'US' } });
    }
    if (u.includes('countries=1')) {
      return server.countriesOk
        ? json({ countries: server.countries, fetchedAt: null })
        : json({ error: 'The provider could not be reached.' }, false, 502);
    }
    if (u.includes('areas=1')) return json({ areaOptions: AREA_OPTIONS });
    if (u.includes('available=1')) return json({ available: NUMBERS.length, numbers: NUMBERS });
    if (u.startsWith('/api/sms/numbers')) return json({ number: server.number });
    if (u.startsWith('/api/sms-usage')) return json({});
    return json({});
  }),
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  onSnapshot: vi.fn(() => () => {}), doc: vi.fn(), getDoc: vi.fn(), Timestamp: {},
}));

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  server.countriesOk = true;
  server.countries = CATALOGUE;
  server.number = null;
  server.seen = [];
  server.posted = [];
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host.remove();
  vi.clearAllMocks();
});

/** Mount the number panel and let every effect settle. */
const openPanel = async () => {
  const { SmsNumberPanel } = await import('../settings/SmsSection');
  await act(async () => {
    root = createRoot(host);
    root.render(React.createElement(SmsNumberPanel));
  });
  // Two flushes: the catalogue read settles, then the country/type effects it
  // triggers settle in turn.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return host;
};

/** Choose a country and let the type, area and preview effects settle. */
const chooseCountry = async (code: string) => {
  const sel = host.querySelector('#sms-country') as HTMLSelectElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(sel, code);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

const optionsOf = (id: string): HTMLOptionElement[] =>
  [...host.querySelectorAll(`#${id} option`)] as HTMLOptionElement[];

const buyButton = () =>
  [...host.querySelectorAll('button')].find((b) => /buy a number/i.test(b.textContent || '')) || null;

/* ═══════════════════════════════════════════════════════════════════════════
   1 · 🔴 The country field is a PICKER, populated from the provider.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · the country field is a picker populated from the provider, not free text', () => {
  it('🔴 the country field is a <select>, and no text box remains for it', async () => {
    await openPanel();
    const field = host.querySelector('#sms-country');
    expect(field, 'the country field is missing').toBeTruthy();
    // 🔴 THE MUTATION THIS CATCHES: make the country free text again.
    expect(field!.tagName, 'the country is not a picker').toBe('SELECT');
    expect(host.querySelector('input#sms-country'), 'the country is a free-text box again').toBeNull();
  });

  it('🔴 every country the provider returned is offered, and it asked the provider for them', async () => {
    await openPanel();
    expect(
      server.seen.some((u) => u.includes('countries=1')),
      'the panel never asked the provider for a country list',
    ).toBe(true);
    expect(optionsOf('sms-country').length, 'the picker is not the provider\'s list').toBe(CATALOGUE.length);
  });

  it('🔴 1b · every country shows its full NAME and its code, never a bare two-letter code', async () => {
    await openPanel();
    for (const { code } of CATALOGUE) {
      const option = optionsOf('sms-country').find((o) => o.value === code);
      expect(option, `${code} is not offered`).toBeTruthy();
      const text = option!.textContent || '';
      // 🔴 THE MUTATION THIS CATCHES: render a bare `DE` instead of
      // "Germany (DE)". The name must be present AND be more than the code.
      expect(text, `${code} is shown as a bare code`).toMatch(new RegExp(`\\(${code}\\)`));
      const name = text.split('(')[0].trim();
      expect(name.length, `${code} has no country name beside its code`).toBeGreaterThan(2);
      expect(name.toUpperCase(), `${code}'s "name" is just the code again`).not.toBe(code);
    }
  });

  it('🔴 1c · every field the provider returns PER COUNTRY is rendered', async () => {
    await openPanel();
    await chooseCountry('GB');
    const facts = host.querySelector('[data-country-facts]');
    expect(facts, 'the per-country facts are not rendered at all').toBeTruthy();

    /**
     * 🔴 ENUMERATED PER FIELD, AND EACH ASSERTED AGAINST ITS OWN ROW — so
     * dropping ANY ONE fails and NAMES the field it dropped.
     *
     * ⚠️ THIS ASSERTION WAS ITSELF FOUND BY MUTATION, AND IT WAS WRONG. It first
     * read the whole facts block as one string and tested each field's copy
     * against it. Deleting the `needsKyc` row PASSED: the neighbouring `tier`
     * note reads "…requires identity documents before a number is issued", and a
     * case-insensitive search for "Identity documents" found THAT. A guard
     * satisfied by a different field's copy is exactly the failure mode this
     * series has hit nine times. Scoping each field to its own row is what fixes
     * it — a row that is gone cannot be satisfied by its neighbour.
     */
    const REQUIRED: [string, RegExp][] = [
      ['name+code', /United Kingdom \(GB\)/],
      ['smsAvailable', /^Can send SMS/],
      ['inStock', /^In stock/],
      ['monthlyCents', /\$3\/month/],
      ['needsKyc', /^Identity documents/],
      ['tier', /^Regulation/],
    ];
    for (const [field, re] of REQUIRED) {
      const row = facts!.querySelector(`[data-country-field="${field}"]`);
      expect(row, `the per-country field \`${field}\` is not on screen`).toBeTruthy();
      expect(
        re.test((row!.textContent || '').trim()),
        `the per-country field \`${field}\` renders nothing recognisable: "${row!.textContent}"`,
      ).toBe(true);
    }

    /** 🔴 And the VALUES are the provider's, not defaults. GB is in stock, can
     *  text (on `mobile`), needs identity documents and costs $3. */
    const value = (field: string) =>
      (facts!.querySelector(`[data-country-field="${field}"] dd`)?.textContent || '').trim();
    expect(value('smsAvailable'), 'GB is reported as unable to text').toBe('Yes');
    expect(value('inStock'), 'GB is reported as out of stock').toBe('Yes');
    expect(value('needsKyc'), 'GB is reported as needing no identity documents').toBe('Required');
    expect(value('monthlyCents'), 'GB\'s price is not the provider\'s').toBe('$3/month');
  });

  it('🔴 1d · every field the provider returns PER TYPE is rendered, for every type', async () => {
    await openPanel();
    await chooseCountry('GB');
    const matrix = host.querySelector('[data-type-matrix]');
    expect(matrix, 'the per-type matrix is not rendered at all').toBeTruthy();

    // Every one of GB's FOUR types has a row — not only the one that texts.
    const gb = CATALOGUE.find((c) => c.code === 'GB')!;
    for (const t of gb.types) {
      expect(
        host.querySelector(`[data-number-type="${t.numberType}"]`),
        `GB's \`${t.numberType}\` type has no row`,
      ).toBeTruthy();
    }

    /**
     * 🔴 ENUMERATED PER FIELD, asserted on the `mobile` ROW specifically, so a
     * dropped column fails and names itself. `mobile` is the row whose values
     * differ from the country-level mirror, which is what makes it the one worth
     * reading.
     */
    const row = host.querySelector('[data-number-type="mobile"]')!;
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent || '');
    const all = cells.join(' | ');
    const REQUIRED: [string, RegExp][] = [
      ['numberType', /mobile/],
      ['smsAvailable', /Yes/],
      ['callsAvailable', /Yes/],
      ['whatsappAvailable', /Yes/],
      ['monthlyCents', /\$3\/month/],
      ['needsKyc', /Required/],
      ['fulfilment', /Buy now/i],
      ['inStock', /In stock/i],
    ];
    for (const [field, re] of REQUIRED) {
      expect(re.test(all), `the per-type field \`${field}\` is not on the mobile row`).toBe(true);
    }
    // Eight columns, one per provider field — a dropped column changes this.
    expect(cells.length, 'the per-type matrix does not carry eight fields').toBe(8);
  });

  it('🔴 1e · each listed number shows its OWN features list', async () => {
    await openPanel();
    await chooseCountry('US');
    const check = [...host.querySelectorAll('button')].find((b) => /check availability/i.test(b.textContent || ''))!;
    await act(async () => { check.click(); });
    await act(async () => { await Promise.resolve(); });

    const rows = [...host.querySelectorAll('[data-available-number]')];
    expect(rows.length, 'no numbers were listed').toBe(NUMBERS.length);
    /**
     * 🔴 PER ROW, from that row's own `features`. The two fixture numbers differ
     * — one has `mms` and the other does not — so a render that badged the same
     * capabilities on every row fails here.
     */
    for (const [i, n] of NUMBERS.entries()) {
      const badges = [...rows[i].querySelectorAll('[data-number-feature]')]
        .map((b) => b.getAttribute('data-number-feature'));
      expect(badges.sort(), `${n.phoneNumber} does not show its own features`).toEqual([...n.features].sort());
    }
    expect(
      rows[0].querySelectorAll('[data-number-feature="mms"]').length,
      'the first number lost its own mms capability',
    ).toBe(1);
    expect(
      rows[1].querySelectorAll('[data-number-feature="mms"]').length,
      'the second number was given a capability it does not have',
    ).toBe(0);
  });

  it('🔴 1f · the area code is CHOSEN from areaOptions, never typed', async () => {
    await openPanel();
    await chooseCountry('US');
    const area = host.querySelector('#sms-area');
    expect(area, 'the area code field is missing').toBeTruthy();
    // 🔴 THE MUTATION THIS CATCHES: make the area code a free-text box.
    expect(area!.tagName, 'the area code is not a picker').toBe('SELECT');
    expect(host.querySelector('input#sms-area'), 'the area code is a free-text box again').toBeNull();

    expect(
      server.seen.some((u) => u.includes('areas=1')),
      'the panel never asked the provider which areas have stock',
    ).toBe(true);
    const values = optionsOf('sms-area').map((o) => o.value);
    // "Any area" plus each area the provider reported — and nothing invented.
    expect(values, 'the area options are not the provider\'s').toEqual(['', '615', '212']);
    const nashville = optionsOf('sms-area').find((o) => o.value === '615')!;
    expect(nashville.textContent, 'the area is offered as a bare number with no place')
      .toMatch(/Nashville, TN/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · 🔴 A country that cannot text is marked, and cannot be bought for SMS.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · a country with no SMS-capable type cannot be bought for SMS', () => {
  /** The five that sell numbers and cannot text. NAMED, so a regression says
   *  which country it re-admitted. */
  const MUTE = ['DE', 'FR', 'ES', 'IT', 'IE'] as const;

  for (const code of MUTE) {
    it(`🔴 ${code} is listed, is marked as unable to text, and offers no Buy button`, async () => {
      await openPanel();
      // ⚠️ IT IS LISTED. Hiding it would leave a church wondering why its own
      // country is absent; showing it unmarked is what broke today.
      const option = optionsOf('sms-country').find((o) => o.value === code);
      expect(option, `${code} is not listed at all`).toBeTruthy();
      expect(option!.textContent, `${code} is listed with no warning that it cannot text`)
        .toMatch(/cannot send SMS/i);

      await chooseCountry(code);
      // 🔴 THE MUTATION THIS CATCHES: offer Germany for an SMS purchase.
      expect(buyButton(), `${code} can still be bought for SMS`).toBeNull();
      expect(host.textContent, `${code} does not say WHY it cannot be bought`)
        .toMatch(/none of its number types can send or receive SMS/i);
      // And no type or area picker either — there is nothing to configure.
      expect(host.querySelector('#sms-type'), `${code} still offers a type picker`).toBeNull();
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · 🔴 The SMS-capable countries ARE offered — and the PER-TYPE flag decides.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · the SMS-capable countries are offered, and capability is per type', () => {
  const CAN_SMS = ['US', 'CA', 'VI', 'PR', 'NL', 'GB', 'BE', 'LT', 'AU', 'PL', 'SE', 'ZA'] as const;

  for (const code of CAN_SMS) {
    it(`${code} is offered for SMS`, async () => {
      await openPanel();
      const option = optionsOf('sms-country').find((o) => o.value === code);
      expect(option, `${code} is not offered`).toBeTruthy();
      expect(option!.textContent, `${code} is wrongly marked as unable to text`)
        .not.toMatch(/cannot send SMS/i);
      await chooseCountry(code);
      expect(buyButton(), `${code} cannot be bought for SMS`).toBeTruthy();
    });
  }

  /**
   * 🔴 THE SUBTLE ONE. GB's COUNTRY-level `smsAvailable` is FALSE and its
   * `mobile` type texts; NL is the same shape. A render that decided from the
   * country flag would hide both — and a purchase gate that did would refuse
   * them. Six of the twelve above are in exactly this position, so the
   * country-level read fails half the list.
   */
  it('🔴 the countries whose capability lives on a NON-default type are still offered', async () => {
    await openPanel();
    for (const code of ['GB', 'NL', 'BE', 'LT', 'AU', 'PL', 'SE', 'ZA']) {
      const country = CATALOGUE.find((c) => c.code === code)!;
      expect(country.smsAvailable, `the fixture for ${code} no longer tests this case`).toBe(false);
      const option = optionsOf('sms-country').find((o) => o.value === code)!;
      expect(option.textContent, `${code} was judged by its country flag, not its types`)
        .not.toMatch(/cannot send SMS/i);
    }
  });

  it('🔴 5 · GB `mobile` texts and GB `local` does not — only `mobile` is selectable', async () => {
    await openPanel();
    await chooseCountry('GB');
    const byType = Object.fromEntries(optionsOf('sms-type').map((o) => [o.value, o]));
    // Every type is SHOWN, so the church can see why the others are not offered…
    for (const t of ['local', 'national', 'toll_free', 'mobile']) {
      expect(byType[t], `GB's \`${t}\` is missing from the type picker`).toBeTruthy();
    }
    // …and only the one that texts is SELECTABLE.
    expect(byType.mobile.disabled, 'GB mobile cannot be chosen, yet it is the type that texts').toBe(false);
    for (const t of ['local', 'national', 'toll_free']) {
      // 🔴 THE MUTATION THIS CATCHES: decide capability from the country flag
      // instead of the type flag. GB would then offer `local`, and the number
      // the church is billed for every month would be mute.
      expect(byType[t].disabled, `GB \`${t}\` is selectable, and it cannot text`).toBe(true);
      expect(byType[t].textContent, `GB \`${t}\` is offered with no warning`).toMatch(/cannot send SMS/i);
    }
    // And the type actually chosen is the texting one.
    expect((host.querySelector('#sms-type') as HTMLSelectElement).value).toBe('mobile');
  });

  it('🔴 5 · US `local` texts and US `toll_free` does not — the same rule, the other way', async () => {
    await openPanel();
    await chooseCountry('US');
    const byType = Object.fromEntries(optionsOf('sms-type').map((o) => [o.value, o]));
    expect(byType.local.disabled, 'US local cannot be chosen, yet it is the type that texts').toBe(false);
    expect(byType.toll_free.disabled, 'US toll_free is selectable, and it cannot text').toBe(true);
    expect((host.querySelector('#sms-type') as HTMLSelectElement).value).toBe('local');
    // ⚠️ The COUNTRY flag is true for US. A render that read it would have
    // offered `toll_free` as a texting number.
    expect(CATALOGUE.find((c) => c.code === 'US')!.smsAvailable).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 · A number TYPE can be chosen, and only the country's own types are offered.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · a number type can be chosen, and only the country\'s own types are offered', () => {
  it('the type picker exists at all — the field the error message told users to change', async () => {
    await openPanel();
    await chooseCountry('US');
    const type = host.querySelector('#sms-type');
    expect(type, 'there is still no type field, and the provider\'s error names one').toBeTruthy();
    expect(type!.tagName).toBe('SELECT');
  });

  it('🔴 only THIS country\'s types are offered, and every one of them is', async () => {
    await openPanel();
    for (const code of ['US', 'GB', 'CA']) {
      await chooseCountry(code);
      const offered = optionsOf('sms-type').map((o) => o.value).sort();
      const own = CATALOGUE.find((c) => c.code === code)!.types.map((t) => t.numberType).sort();
      expect(offered, `${code} offers types that are not its own`).toEqual(own);
    }
  });

  it('each type is offered with its own SMS capability and its own price', async () => {
    await openPanel();
    await chooseCountry('GB');
    const byType = Object.fromEntries(optionsOf('sms-type').map((o) => [o.value, o.textContent || '']));
    expect(byType.mobile, 'the GB mobile option carries no price').toMatch(/\$3\/month/);
    expect(byType.local, 'the GB local option does not say it cannot text').toMatch(/cannot send SMS/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6 · Real numbers are listed to choose from.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · real numbers are listed', () => {
  it('lists actual numbers rather than a yes/no count', async () => {
    await openPanel();
    await chooseCountry('US');
    const check = [...host.querySelectorAll('button')].find((b) => /check availability/i.test(b.textContent || ''))!;
    await act(async () => { check.click(); });
    await act(async () => { await Promise.resolve(); });
    for (const n of NUMBERS) {
      expect(host.textContent, `${n.phoneNumber} is not listed`).toContain(n.phoneNumber);
    }
  });

  it('and it asks with the CHOSEN type, so the pool previewed is the pool bought from', async () => {
    await openPanel();
    await chooseCountry('GB');
    const check = [...host.querySelectorAll('button')].find((b) => /check availability/i.test(b.textContent || ''))!;
    await act(async () => { check.click(); });
    await act(async () => { await Promise.resolve(); });
    const searched = server.seen.filter((u) => u.includes('available=1'));
    expect(searched.length, 'no availability search was made').toBeGreaterThan(0);
    // ⚠️ Without the type the provider previews the country's WhatsApp-safe
    // DEFAULT, which in GB is not the texting pool.
    expect(searched[searched.length - 1], 'the search did not carry the chosen type').toMatch(/type=mobile/);
  });

  /**
   * 🔴 STATED PLAINLY, BECAUSE IT IS TRUE: a chosen number CANNOT be purchased.
   * The provider's purchase takes country, type and area code — never a phone
   * number — and assigns the digits itself. A "choose this number" affordance
   * would be a promise the purchase cannot keep.
   */
  it('🔴 the list does not imply a specific number can be bought, and says so', async () => {
    await openPanel();
    await chooseCountry('US');
    const check = [...host.querySelectorAll('button')].find((b) => /check availability/i.test(b.textContent || ''))!;
    await act(async () => { check.click(); });
    await act(async () => { await Promise.resolve(); });

    const { NUMBERS_ARE_A_PREVIEW } = await import('../settings/SmsSection');
    expect(host.textContent, 'the screen does not say a specific number cannot be reserved')
      .toContain(NUMBERS_ARE_A_PREVIEW);
    // No row is a control: no button, no radio, no checkbox inside a number row.
    for (const row of host.querySelectorAll('[data-available-number]')) {
      expect(
        row.querySelectorAll('button, input[type="radio"], input[type="checkbox"]').length,
        'a number row offers a choice the purchase cannot honour',
      ).toBe(0);
    }
    // And the purchase body never carries a phone number.
    const buy = buyButton()!;
    await act(async () => { buy.click(); });
    await act(async () => { await Promise.resolve(); });
    for (const body of server.posted) {
      expect(
        Object.keys(body as Record<string, unknown>),
        'the purchase claims to take a specific number',
      ).not.toContain('phoneNumber');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7 · 🔴 Price, KYC, stock and fulfilment — disclosed BEFORE the Buy button.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · every constraint the provider can state in advance is on screen first', () => {
  it('the monthly price is shown before the Buy button', async () => {
    await openPanel();
    await chooseCountry('AU');
    const buy = buyButton();
    expect(buy, 'AU cannot be bought').toBeTruthy();
    // $9/month, from `monthlyCents: 900` — the provider's figure.
    expect(host.textContent, 'the recurring price is not on screen').toMatch(/\$9\/month/);
    // 🔴 BEFORE, positionally: the price appears earlier in the document.
    const priceNode = [...host.querySelectorAll('p')].find((p) => /\$9\/month/.test(p.textContent || ''))!;
    expect(
      priceNode.compareDocumentPosition(buy!) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the price is not before the Buy button',
    ).toBeTruthy();
  });

  /** 🔴 NAMED PER COUNTRY, so a regression says which one it stopped warning. */
  for (const code of ['GB', 'BE', 'LT', 'AU', 'PL', 'SE', 'ZA'] as const) {
    it(`KYC is warned about BEFORE purchase for ${code}`, async () => {
      await openPanel();
      await chooseCountry(code);
      const buy = buyButton();
      expect(buy, `${code} cannot be bought`).toBeTruthy();
      expect(host.textContent, `${code} needs identity documents and does not say so`)
        .toMatch(/requires identity documents before the number is issued/i);
      const warning = [...host.querySelectorAll('[data-slot="alert"]')]
        .find((a) => /requires identity documents/i.test(a.textContent || ''))!;
      expect(
        warning.compareDocumentPosition(buy!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${code}'s KYC warning is not before the Buy button`,
      ).toBeTruthy();
    });
  }

  it('a country that needs NO identity documents does not claim it does', async () => {
    await openPanel();
    await chooseCountry('US');
    expect(host.textContent, 'US is falsely warned about identity documents')
      .not.toMatch(/requires identity documents before the number is issued/i);
  });

  it('🔴 9 · out-of-stock and request-only types are not offered as instantly buyable', async () => {
    await openPanel();
    // AR — SMS-capable, and out of stock entirely.
    await chooseCountry('AR');
    let option = optionsOf('sms-type').find((o) => o.value === 'mobile')!;
    expect(option.disabled, 'an out-of-stock type is selectable').toBe(true);
    expect(option.textContent, 'an out-of-stock type does not say so').toMatch(/out of stock/i);

    // HU — SMS-capable, in stock, but sourced by carrier REQUEST.
    await chooseCountry('HU');
    option = optionsOf('sms-type').find((o) => o.value === 'mobile')!;
    expect(option.disabled, 'a by-request-only type is offered as instantly buyable').toBe(true);
    expect(option.textContent, 'a by-request-only type does not say so').toMatch(/by request only/i);
    // And its price is the type's own — HU toll-free economics differ per type.
    expect(host.textContent, 'the HU price is not the type\'s own').toMatch(/\$23\/month/);
  });

  /**
   * 🔴 1g · THE SWEEP. Every constraint the ROUTE can answer with an error has
   * a matching PRE-PURCHASE disclosure on the screen.
   *
   * ⚠️ THIS IS THE ASSERTION MOST AT RISK OF PASSING ON ITS OWN TEXT, so the
   * route is read through `codeOf` (comments stripped) and each disclosure is
   * asserted in the RENDERED DOM, never in the source.
   */
  it('🔴 1g · no constraint the provider could state in advance is only revealed by an error', async () => {
    const route = codeOf(read(NUMBERS_ROUTE));
    /** Each error the route can answer, and where the screen says it first. */
    const PAIRED: { code: string; disclosedBy: () => Promise<RegExp> }[] = [
      {
        // "local numbers in DE can't send or receive SMS" — the founder's error.
        code: 'TYPE_NOT_SMS_CAPABLE',
        disclosedBy: async () => /cannot send SMS/i,
      },
      {
        // "no SMS-capable numbers available in DE right now".
        code: 'SMS_POOL_UNAVAILABLE',
        disclosedBy: async () => /out of stock/i,
      },
      {
        // "no numbers available in area code 615" — a hard 409, never a fallback.
        code: 'AREA_CODE_UNAVAILABLE',
        disclosedBy: async () => /Nashville, TN/,
      },
    ];
    for (const { code } of PAIRED) {
      expect(route.includes(code), `the route no longer answers ${code}`).toBe(true);
    }

    // 🔴 Each disclosure, IN THE RENDERED DOM, before any purchase is attempted.
    await openPanel();
    await chooseCountry('GB');
    const typeText = optionsOf('sms-type').map((o) => o.textContent).join(' ');
    expect(typeText, 'TYPE_NOT_SMS_CAPABLE has no pre-purchase disclosure')
      .toMatch(await PAIRED[0].disclosedBy());

    await chooseCountry('AR');
    expect(optionsOf('sms-type').map((o) => o.textContent).join(' '), 'SMS_POOL_UNAVAILABLE has no pre-purchase disclosure')
      .toMatch(await PAIRED[1].disclosedBy());

    await chooseCountry('US');
    expect(optionsOf('sms-area').map((o) => o.textContent).join(' '), 'AREA_CODE_UNAVAILABLE has no pre-purchase disclosure')
      .toMatch(await PAIRED[2].disclosedBy());

    // And the KYC 202, which THE-318 surfaces AFTER the attempt, is ALSO
    // disclosed before it.
    await chooseCountry('GB');
    expect(host.textContent, 'the KYC 202 is still only learned from the response')
      .toMatch(/requires identity documents before the number is issued/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   10 · 🔴 A failed country fetch shows a FAILURE, never an empty picker.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('10 · a failed country fetch shows a failure, never an empty picker', () => {
  it('🔴 renders the failure and NO picker at all', async () => {
    server.countriesOk = false;
    await openPanel();
    // 🔴 THE MUTATION THIS CATCHES: show an empty picker on a failed fetch.
    // An empty list states "no countries are available", which is a lie: the
    // truth is that Harvest could not ASK.
    expect(host.querySelector('#sms-country'), 'a failed fetch rendered a picker anyway').toBeNull();
    expect(host.querySelectorAll('[data-slot="alert"]').length, 'the failure is not announced')
      .toBeGreaterThan(0);
    expect(host.textContent, 'the failure is not stated').toMatch(/could not be reached|could not be loaded/i);
    expect(buyButton(), 'a number can be bought with no country list').toBeNull();
  });

  it('and it offers a way to retry, which asks the provider again', async () => {
    server.countriesOk = false;
    await openPanel();
    const retry = [...host.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent || ''));
    expect(retry, 'a failed fetch offers no way to retry').toBeTruthy();
    server.countriesOk = true;
    await act(async () => { retry!.click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('#sms-country'), 'the retry did not recover the picker').toBeTruthy();
  });

  it('🔴 an unparseable answer is a FAILURE too, not zero countries', async () => {
    server.countries = null;   // 200, but no catalogue on it
    await openPanel();
    expect(host.querySelector('#sms-country'), 'a malformed answer rendered a picker').toBeNull();
    expect(host.querySelectorAll('[data-slot="alert"]').length, 'a malformed answer is not announced')
      .toBeGreaterThan(0);
  });
});
