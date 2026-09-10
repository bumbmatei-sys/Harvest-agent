/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-277 — Signups gets its own page, and the file it left keeps its money path
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── What this ticket actually was ───────────────────────────────────────────
 *
 * 🔴 A MOVE AND A RESTYLE, NOT A BUILD. The founder asked for "the option to
 * search by city and when they signed up 1 3 7 30 days", and every part of that
 * already shipped inside `AnalyticsAndRoles.tsx` as the CRM screen's Analytics
 * sub-tab: the city search, the four windows, the signup date, the results
 * summary, the new-signups tile, and BOTH CSV exports. Nothing here rebuilds
 * any of it. Section 1 is the proof that what moved still works; the rest is
 * the proof that what stayed did not move.
 *
 * ─── The two halves, and which one is dangerous ──────────────────────────────
 *
 *   · `AdminSignups.tsx`  — the MOVED half. Members who created an account.
 *     Carries no seat logic and no permission catalogue, which is exactly why
 *     it was safe to restyle in the same PR.
 *   · `AdminRoles.tsx`    — the half that STAYED, renamed for what it is.
 *     🔴 Holds `maxAdmins` seat enforcement (a plan-gated MONEY PATH) and the
 *     permission catalogue. Section 4 pins both byte-for-byte.
 *
 * ─── Where the assertions in section 6 came from ─────────────────────────────
 *
 * ⚠️ Sections 4 and 5 of `AdminCRM.desktop-layout.test.tsx` used to assert the
 * Analytics tab's action widths, its emoji sweep and its tile icons. Their
 * subject is no longer reachable from that file's harness, so they were MOVED
 * here rather than deleted — see the note that stands in their place there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';

import AdminSignups from '../AdminSignups';
import {
  TIME_PERIODS, CONTACT_CSV_HEADERS, ONBOARDING_CSV_FIXED_HEADERS, contactCsvRow,
  filterByPeriod, filterByLocation, type UserRecord,
} from '../../lib/signups-export';
import { FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY, CONTAINERS } from '../layout/form-layout';
import {
  allTokens, maxWidthPx, arbitraryPx, breakpointOf,
  isResponsive, REM_PX_MOBILE,
} from '../../test/support/class-inventory';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const digest = (rel: string) =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/* ── mocks ─────────────────────────────────────────────────────────────────
   Shaped exactly like AdminRoles.maxAdmins's, so both halves of the split are
   exercised against the same Firestore stub. */
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'me', getIdToken: async () => null } } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  SUPER_ADMIN_EMAIL: 'bumbmatei@proton.me',
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', DELETE: 'delete' },
  handleFirestoreError: () => {},
}));

let mockUsers: Array<Record<string, unknown>> = [];
const writes = vi.hoisted(() => ({ deletes: [] as string[] }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: { __path?: string }, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async () => ({
    forEach: (cb: (d: unknown) => void) =>
      mockUsers.forEach((u) => cb({ id: u.id, data: () => u })),
  }),
  deleteDoc: async (ref: { __path?: string }) => { writes.deletes.push(ref?.__path ?? ''); },
}));

/* ── fixtures ──────────────────────────────────────────────────────────────
   `daysAgo` rather than fixed dates: the period filter measures from now, so a
   frozen date would make these rows age out of the 30-day window over time. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const signup = (id: string, city: string, country: string, days: number) => ({
  id, displayName: id, email: `${id}@church.org`,
  city, country, phone: `+40 700 ${id}`, acceptedJesus: true,
  createdAt: daysAgo(days),
  onboardingAnswers: { q_how: 'A friend' },
});

const FIXTURES = [
  signup('ana', 'Cluj', 'Romania', 0),
  signup('bogdan', 'Cluj', 'Romania', 2),
  signup('cristi', 'Bucharest', 'Romania', 5),
  signup('dana', 'Lisbon', 'Portugal', 20),
  signup('emil', 'Lisbon', 'Portugal', 200),
];

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminSignups />);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container;
}

const click = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

const buttonLabelled = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label);

/** The clickable control inside a named stat tile. */
const tileButton = (root: ParentNode, handle: string): HTMLButtonElement => {
  const btn = region(root, handle).querySelector('button');
  if (!btn) throw new Error(`the [${handle}] tile is not activatable`);
  return btn as HTMLButtonElement;
};

const region = (root: ParentNode, name: string): HTMLElement => {
  const el = root.querySelector(`[${name}]`);
  if (!el) throw new Error(`no region [${name}] — it was renamed or removed`);
  return el as HTMLElement;
};

const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const carries = (el: Element, rule: string) =>
  rule.split(/\s+/).every((t) => tokensOf(el).includes(t));

beforeEach(() => { mockUsers = [...FIXTURES]; writes.deletes.length = 0; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 The moved feature still works
// ═══════════════════════════════════════════════════════════════════════════

describe('1 — the Signups page renders the city search, the 4 period buttons, and the results summary', () => {
  it('renders the city search, the four period buttons and the results summary', async () => {
    const c = await mount();

    // The city search. Found by its PLACEHOLDER — the founder's own words for
    // what it does — not by a class, so a test cannot pass against the wrong input.
    const search = Array.from(c.querySelectorAll('input'))
      .find((i) => (i.getAttribute('placeholder') ?? '').startsWith('Search by city'));
    expect(search, 'the city/country search is gone').toBeTruthy();

    // The four windows.
    const periods = Array.from(region(c, 'data-period-field').querySelectorAll('button'));
    expect(periods).toHaveLength(4);

    // And the summary, which only exists after a search — the screen opens with
    // no result card at all, exactly as the sub-tab did.
    expect(c.querySelector('[data-results-summary]'), 'a summary rendered before any search').toBeNull();
    await click(buttonLabelled(c, 'Search')!);
    const summary = region(c, 'data-results-summary').textContent ?? '';
    // Default window is 7 days: ana/bogdan/cristi are inside it, dana and emil are not.
    expect(summary).toBe('3 results — last 7 days');
  });

  it('narrows by city, and says so in the summary', async () => {
    const c = await mount();
    const search = Array.from(c.querySelectorAll('input'))
      .find((i) => (i.getAttribute('placeholder') ?? '').startsWith('Search by city'))!;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'cluj');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonLabelled(c, 'Search')!);

    // Two of the three inside the 7-day window are in Cluj, and the query is
    // echoed back verbatim — the "{n} results in {q} — last {p} days" line.
    expect(region(c, 'data-results-summary').textContent).toBe('2 results in "cluj" — last 7 days');
  });

  it('counts a single result in the singular, and a single day as "day"', async () => {
    const c = await mount();
    await click(Array.from(region(c, 'data-period-field').querySelectorAll('button'))[0]); // Today
    await click(buttonLabelled(c, 'Search')!);
    expect(region(c, 'data-results-summary').textContent).toBe('1 result — last 1 day');
  });

  it('heads the screen with Total Users, Countries and the period tile', async () => {
    const c = await mount();
    const text = c.textContent ?? '';
    for (const label of ['Total Users', 'All time', 'Countries', 'Represented', 'New signups']) {
      expect(text, `the "${label}" tile copy is gone`).toContain(label);
    }
    // Five fixtures, three countries-worth of cities across two countries.
    expect(text).toContain('5');
    expect(new Set(FIXTURES.map((f) => f.country)).size).toBe(2);
  });

  it('still opens the All Users and Countries sub-views, and drills into one country', async () => {
    const c = await mount();
    await click(tileButton(c, 'data-tile-countries'));
    expect(c.textContent).toContain('Countries (2)');

    const romania = Array.from(c.querySelectorAll('td')).find((td) => td.textContent === 'Romania')!;
    await click(romania.parentElement!);
    expect(c.textContent, 'the country drill-down is gone').toContain('Romania (3)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 The four windows are exactly the ones the founder asked for
// ═══════════════════════════════════════════════════════════════════════════

describe('2 — the period buttons are exactly [1, 3, 7, 30]', () => {
  it('are exactly 1, 3, 7 and 30 days, in that order', () => {
    // The module is the single definition; the screen maps it. Pinning the
    // array here and the RENDER below is what makes the two inseparable.
    expect([...TIME_PERIODS]).toEqual([1, 3, 7, 30]);
  });

  it('renders one button per window, labelled Today / 3d / 7d / 30d', async () => {
    const c = await mount();
    const labels = Array.from(region(c, 'data-period-field').querySelectorAll('button'))
      .map((b) => (b.textContent ?? '').trim());
    expect(labels).toEqual(['Today', '3d', '7d', '30d']);
  });

  it('each button selects its own window, and the summary follows it', async () => {
    const c = await mount();
    const buttons = () => Array.from(region(c, 'data-period-field').querySelectorAll('button'));
    // 1 / 3 / 7 / 30 against the fixtures: 1 / 2 / 3 / 4 rows respectively.
    const expected = [1, 2, 3, 4];
    for (let i = 0; i < 4; i++) {
      await click(buttons()[i]);
      await click(buttonLabelled(c, 'Search')!);
      expect(buttons()[i].getAttribute('aria-pressed'), `window ${TIME_PERIODS[i]} is not marked selected`).toBe('true');
      expect(region(c, 'data-results-summary').textContent)
        .toBe(`${expected[i]} result${expected[i] === 1 ? '' : 's'} — last ${TIME_PERIODS[i]} day${TIME_PERIODS[i] === 1 ? '' : 's'}`);
    }
  });

  it('the screen reads the module rather than spelling the windows again', () => {
    const s = src('src/components/AdminSignups.tsx');
    expect(s, 'the screen spells its own period list, which can drift from the module')
      .not.toMatch(/\[\s*1\s*,\s*3\s*,\s*7\s*,\s*30\s*\]/);
    expect(s).toContain('TIME_PERIODS.map(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 NO-REGRESSION: the CSV shape is what it was
// ═══════════════════════════════════════════════════════════════════════════

describe('3 — both CSV exports produce the same columns as before', () => {
  /**
   * 🔴 THE HEADERS THE PRE-SPLIT FILE SHIPPED, TYPED OUT HERE.
   *
   * A literal, never a re-read of the module: comparing the module with itself
   * would pass no matter what either said. Churches open these files in
   * spreadsheets with columns mapped by POSITION, so a rename, a reorder or an
   * insertion is a silent break in somebody's Monday.
   */
  const SHIPPED = [
    'Name', 'Phone Number', 'Email', 'Registration Date', 'Country', 'City', 'Accepted Jesus',
  ];

  it('the contact export has the same seven columns, in the same order', () => {
    expect([...CONTACT_CSV_HEADERS]).toEqual(SHIPPED);
  });

  it('the onboarding export is those same seven, then the tenant questions', () => {
    // The onboarding file is the contact file plus one column per tenant-defined
    // question. The FIXED prefix is what a test can pin; the tail is tenant data.
    expect([...ONBOARDING_CSV_FIXED_HEADERS]).toEqual(SHIPPED);
  });

  it('a row still carries the same seven cells, with the same Unknown fallbacks', () => {
    const full: UserRecord = {
      id: 'x', name: 'Ana', email: 'ana@church.org', city: 'Cluj', country: 'Romania',
      phone: '+40 700', acceptedJesus: true, registeredAt: '2026-01-15T00:00:00.000Z',
    };
    expect(contactCsvRow(full)).toEqual([
      'Ana', '+40 700', 'ana@church.org',
      new Date(full.registeredAt).toLocaleDateString('en-US'),
      'Romania', 'Cluj', 'Yes',
    ]);

    // Every fallback the pre-split file used, unchanged: a missing phone, city
    // or country reads "Unknown", and acceptedJesus has THREE states — the
    // undefined one is "Unknown", not "No".
    const bare: UserRecord = {
      id: 'y', name: 'B', email: '', city: '', country: '', phone: '',
      registeredAt: '2026-01-15T00:00:00.000Z',
    };
    expect(contactCsvRow(bare).slice(4)).toEqual(['Unknown', 'Unknown', 'Unknown']);
    expect(contactCsvRow({ ...bare, acceptedJesus: false })[6]).toBe('No');
    expect(contactCsvRow(full).length).toBe(CONTACT_CSV_HEADERS.length);
  });

  it('keeps the formula-injection guard the export always had', async () => {
    const { escapeCsvValue } = await import('../../lib/signups-export');
    // A cell beginning =, +, @ or - is a formula to a spreadsheet, so it is
    // prefixed with a quote. Not cosmetic: this is the CSV-injection guard.
    for (const dangerous of ['=1+1', '+1', '@SUM(A1)', '-2']) {
      expect(escapeCsvValue(dangerous)).toBe(`"'${dangerous}"`);
    }
    expect(escapeCsvValue('He said "hi"'), 'quote doubling is gone').toBe('"He said ""hi"""');
  });

  it('the period and location filters behave exactly as they did', () => {
    const rows: UserRecord[] = FIXTURES.map((f) => ({
      id: f.id as string, name: f.displayName as string, email: f.email as string,
      city: f.city as string, country: f.country as string, phone: f.phone as string,
      registeredAt: f.createdAt as string,
    }));
    expect(filterByPeriod(rows, 1)).toHaveLength(1);
    expect(filterByPeriod(rows, 30)).toHaveLength(4);
    // City OR country, case-insensitive substring; a blank query matches all.
    expect(filterByLocation(rows, 'cluj').map((r) => r.id)).toEqual(['ana', 'bogdan']);
    expect(filterByLocation(rows, 'ROMANIA')).toHaveLength(3);
    expect(filterByLocation(rows, '   ')).toHaveLength(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 NO-REGRESSION: the money path and the catalogue did not move
// ═══════════════════════════════════════════════════════════════════════════

describe('4 — maxAdmins seat enforcement is unchanged', () => {
  const ROLES = src('src/components/AdminRoles.tsx');

  /**
   * 🔴 EVERY SEAT LINE THE PRE-SPLIT FILE HELD, TYPED OUT.
   *
   * ⚠️ A HASH OR A `git show` WOULD BE THE WRONG TOOL HERE. The file legitimately
   * changed — that is the ticket — so a whole-file digest would only say "it
   * changed" and CI's clone depth is not this suite's business either. What must
   * not have changed is this: the seat expressions, character for character.
   */
  const SEAT_LINES = [
    'const maxAdmins = resolveAdminLimit(tenantPlan);',
    'const adminSeatsUsed = countAdminSeats(admins);',
    'const atAdminLimit = isAtAdminLimit(adminSeatsUsed, maxAdmins);',
    'const adminLimitNotice = adminLimitMessage(maxAdmins);',
    'if (atAdminLimit && wouldSpendNewSeat(admins, admin.id)) {',
    'if (atAdminLimit) return;',
  ];

  it('every seat expression survives the split character for character', () => {
    for (const line of SEAT_LINES) {
      expect(ROLES, `seat enforcement changed: ${line}`).toContain(line);
    }
  });

  it('still imports the whole seat helper set from utils/admin-seats', () => {
    for (const helper of [
      'resolveAdminLimit', 'countAdminSeats', 'isAtAdminLimit',
      'adminLimitMessage', 'wouldSpendNewSeat', 'UNLIMITED',
    ]) {
      expect(ROLES, `${helper} is no longer imported`).toContain(helper);
    }
    expect(ROLES).toContain("from '../utils/admin-seats'");
  });

  it('🔴 adds no server-side gate — the client-side cap is a settled decision', () => {
    // course-adoption.ts:36 records it: "#278 (maxAdmins) and #280 (maxContacts)
    // both landed that way deliberately." This ticket is a file split; inventing
    // a server gate inside it would be a product decision taken in a refactor.
    expect(src('src/utils/course-adoption.ts')).toContain('#278');
    expect(ROLES, 'a server-side seat check appeared').not.toMatch(/\/api\/[a-z-]*seat/i);
  });

  it('the screen that MOVED carries no seat logic at all', () => {
    // The reason a restyle of AdminSignups cannot endanger the money path: the
    // money path is not in it.
    const signups = src('src/components/AdminSignups.tsx');
    for (const term of ['maxAdmins', 'adminSeats', 'atAdminLimit', 'admin-seats', 'wouldSpendNewSeat']) {
      expect(signups, `${term} leaked into the Signups screen`).not.toContain(term);
    }
  });

  it("and its own test file still names it, so the pinned suite really is the one that runs", () => {
    // The suite was RENAMED with the component (AnalyticsAndRoles.maxAdmins →
    // AdminRoles.maxAdmins) and not otherwise touched.
    const pinned = src('src/components/__tests__/AdminRoles.maxAdmins.test.tsx');
    expect(pinned).toContain("describe('AdminRoles — maxAdmins enforcement'");
    expect(pinned).toContain("import AdminRoles from '../AdminRoles'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 🔴 NO-REGRESSION: every permission section is still there
// ═══════════════════════════════════════════════════════════════════════════

describe('5 — all permission sections are still present', () => {
  /**
   * 🔴 EVERY SECTION, ENUMERATED BY NAME.
   *
   * ⚠️ THE TICKET SAID "~25" AND THERE ARE 23. Counted from the catalogue on
   * unmodified main: Content 6, Ministry 7, Broadcasting 5, Administration 5.
   * The list is written out rather than counted so a DROP names the section it
   * dropped — a count alone would say "22, expected 23" and leave the reviewer
   * to find which. A permission silently dropped is an admin who can suddenly
   * see giving records.
   */
  const SECTIONS: Record<string, string[]> = {
    content: ['writeArticles', 'createPosts', 'createCourses', 'uploadRag', 'manageNewsletter', 'manageDocs'],
    ministry: ['modifyChurches', 'manageCRM', 'manageCommunity', 'manageForms', 'manageFundraising', 'manageAccounting', 'manageGivingStatements'],
    broadcasting: ['manageEvents', 'manageCheckin', 'manageQR', 'manageLivestream', 'manageSms'],
    admin: ['analytics', 'manageAdmins', 'manageBranding', 'manageAffiliate', 'manageSettings'],
  };
  const ALL = Object.values(SECTIONS).flat();

  it('every one of the 23 sections is still in the catalogue, by name', async () => {
    const { PERMISSION_CATEGORIES, ALL_PERMISSION_DEFS } = await import('../AdminRoles');
    const byId = new Map(PERMISSION_CATEGORIES.map((c) => [c.id, c.items.map((i) => i.key as string)]));

    for (const [id, keys] of Object.entries(SECTIONS)) {
      expect(byId.has(id), `the "${id}" category is gone`).toBe(true);
      for (const key of keys) {
        expect(byId.get(id), `"${key}" fell out of the ${id} category`).toContain(key);
      }
      expect(byId.get(id), `the ${id} category gained or lost a row`).toEqual(keys);
    }
    expect(ALL_PERMISSION_DEFS.map((d) => d.key)).toEqual(ALL);
    expect(ALL_PERMISSION_DEFS).toHaveLength(23);
  });

  it('normalizePermissions still round-trips every one of them', async () => {
    const { normalizePermissions } = await import('../AdminRoles');
    const granted = Object.fromEntries(ALL.map((k) => [k, true]));
    const out = normalizePermissions(granted) as unknown as Record<string, unknown>;
    for (const key of ALL) {
      expect(out[key], `"${key}" is lost on read — an admin would silently lose it`).toBe(true);
    }
    // And the legacy migration the catalogue has always carried.
    expect((normalizePermissions({ seeFormsInbox: true }) as unknown as Record<string, unknown>).manageForms).toBe(true);
    // Defensive against junk, exactly as before.
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect(() => normalizePermissions(junk)).not.toThrow();
    }
  });

  it('the two display-hidden rows are hidden from the UI but KEPT in the catalogue', async () => {
    const roles = await import('../AdminRoles');
    // Hiding a row must never strip the flag off a stored doc — the catalogue
    // stays complete so an admin who holds it keeps it.
    expect(roles.ALL_PERMISSION_DEFS.map((d) => d.key)).toContain('manageAffiliate');
    expect(roles.ALL_PERMISSION_DEFS.map((d) => d.key)).toContain('manageSms');
    expect(roles.VISIBLE_PERMISSION_DEFS.length).toBeLessThanOrEqual(roles.ALL_PERMISSION_DEFS.length);
    expect(roles.normalizePermissions({ manageAffiliate: true, manageSms: true }))
      .toMatchObject({ manageAffiliate: true, manageSms: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 🔴 The Analytics permission gates the new page
// ═══════════════════════════════════════════════════════════════════════════

describe('6 — the Analytics permission gates the Signups page', () => {
  const DASH = src('src/components/AdminDashboard.tsx');

  it('🔴 gates the NAV ENTRY on the analytics permission', () => {
    /* The clause, as written: the plan cell AND the permission.
       🔴 THE PLAN CELL IS `signups` SINCE THE-335, not `crm`. THE-277 carried
       this gate over as `crm`, which was right while the two screens were
       entitled together; the founder has since split them ("The free plan should
       have signup feature not CRM since we separated them") and a shared cell
       cannot express that — crm:false on free took this screen, and the
       analytics on it, away in the same edit.
       ⚠️ THE PERMISSION HALF IS UNTOUCHED, which is what this section is about:
       `analytics` still gates the page, and no `analytics` PLAN cell was
       invented. "Free gets analytics" is now `signups: true` and nothing else. */
    expect(DASH).toMatch(
      /navAllows\(features\?\.signups\) &&\s*\(hasFullAccess \|\| perms\.analytics\) &&\s*\{ id: 'signups', label: 'Signups', icon: UserPlus \},/
    );
  });

  it('🔴 gates the RENDER on the same plan cell, with an upgrade wall behind it', () => {
    expect(DASH).toMatch(
      /activeTab === 'signups' \?\s*\([\s\S]*?planAllows\(features\?\.signups\)\s*\?\s*<div className="p-4 lg:p-0"><AdminSignups \/><\/div>\s*:\s*<PlanUpgradeScreen featureName="Signups" featureKey="signups"/
    );
  });

  it('is the SAME gate the CRM sub-tab used, moved rather than invented', () => {
    // Before the split, `AdminCRM.canViewAnalytics` asked exactly this pair.
    // ⚠️ Its derivation is GONE from AdminCRM — if it were still there the
    // permission would open two surfaces and the split would be a duplication.
    const crm = src('src/components/AdminCRM.tsx');
    expect(crm, 'AdminCRM still derives canViewAnalytics').not.toContain('canViewAnalytics');
    expect(crm, 'the Analytics sub-tab pill is still rendered').not.toMatch(/>\s*Analytics\s*</);
    expect(crm, "AdminCRM still renders AdminRoles in analytics mode").not.toContain('mode="analytics"');
  });

  it('no longer lets the analytics permission alone open the CRM tab', () => {
    // An analytics-only admin used to get CRM (to reach the sub-tab). They now
    // get Signups instead, and CRM would be a page with no sub-tab they may open.
    expect(DASH).toMatch(
      /navAllows\(features\?\.crm\) &&\s*\(hasFullAccess \|\| perms\.manageCRM \|\| perms\.manageAdmins\) &&\s*\{ id: 'crm', label: 'CRM', icon: Users \},/
    );
  });

  it('does NOT gate itself inside the component — one gate, where this app puts gates', () => {
    const s = src('src/components/AdminSignups.tsx');
    expect(s, 'the screen re-derives its own permission gate, so there are now two')
      .not.toMatch(/currentUserPermissions|currentUserRole|perms\./);
  });

  it('is registered as a real section, so the URL resolves rather than bouncing', async () => {
    const { ADMIN_SECTION_TABS, TAB_TO_SLUG, SLUG_TO_TAB, isAdminSectionSlug } =
      await import('../../lib/admin-sections');
    expect(ADMIN_SECTION_TABS).toContain('signups');
    expect(TAB_TO_SLUG['signups']).toBe('signups');
    expect(SLUG_TO_TAB['signups']).toBe('signups');
    expect(isAdminSectionSlug('signups')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · 🔴 The rename kept the two exports AdminDashboard imports
// ═══════════════════════════════════════════════════════════════════════════

describe('7 — Permission and normalizePermissions still resolve for AdminDashboard.tsx', () => {
  it('AdminDashboard imports both, from the renamed module', () => {
    // 🔴 THE IMPORT WAS UPDATED; there is no re-export shim. A shim would have
    // left a file named after the thing the rename says is the wrong name.
    expect(src('src/components/AdminDashboard.tsx'))
      .toContain("import { Permission, normalizePermissions } from './AdminRoles';");
  });

  it('and both actually resolve at runtime, not merely in the text', async () => {
    const mod = await import('../AdminRoles');
    expect(typeof mod.normalizePermissions).toBe('function');
    // `Permission` is a type, so it is erased — what proves it resolves is that
    // the typecheck passes AND the value side of the same module still answers.
    expect(mod.normalizePermissions({})).toHaveProperty('analytics', false);
    expect(mod.normalizePermissions({})).toHaveProperty('fullAccess', false);
  });

  it('nothing anywhere still POINTS at the old filename', () => {
    // A stale import would not typecheck, but a stale PATH in a guard test —
    // several read source files BY NAME as strings — would pass silently.
    //
    // ⚠️ COMMENTS ARE STRIPPED FIRST, deliberately. Four files still SAY
    // "AnalyticsAndRoles" in prose, and all four should: explaining a rename
    // means naming what was renamed. What must be gone is anything that
    // RESOLVES to the old module — an import, a `vi.mock`, or a read path.
    const files = require('node:child_process')
      .execSync("git ls-files src docs tests", { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter((f: string) => /\.(ts|tsx|css|md|json)$/.test(f))
      // ⚠️ THIS FILE EXCLUDES ITSELF, and it has to: a sweep for a string
      // necessarily contains that string, in code rather than in a comment.
      // Excluded by exact path so the exclusion cannot widen to anything else.
      .filter((f: string) => f !== 'src/components/__tests__/THE-277.signups-split.test.tsx');

    const pointers = files.filter((f: string) => {
      const code = src(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block and CSS comments
        .replace(/^\s*\/\/.*$/gm, '')       // line comments
        .replace(/^\s*<!--[\s\S]*?-->/gm, ''); // markdown comments
      return /AnalyticsAndRoles/.test(code);
    });
    expect(pointers, 'something still resolves to the old module').toEqual([]);
  });

  it('the module that stayed is named for what it holds', () => {
    // Admins and permissions — the current name described the smaller half.
    const roles = src('src/components/AdminRoles.tsx');
    expect(roles).toContain('export const PERMISSION_CATEGORIES');
    expect(roles).toContain('export const normalizePermissions');
    expect(roles, 'the Signups half is still in the file it was split out of')
      .not.toContain('data-search-registrations');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · 🔴 No emoji on EITHER page
// ═══════════════════════════════════════════════════════════════════════════

describe('8 — no emoji appears in the rendered output of either page', () => {
  /**
   * Pictographs, dingbats, arrows-as-icons and the variation selector that
   * turns a character into one. An emoji is a glyph from the platform font: it
   * takes no `color`, so it cannot be themed, and it draws differently on
   * Android, iOS and Windows. `lucide-react` is already imported by both files.
   */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

  /** The seven this ticket names, so a regression reports the one that came back. */
  const NAMED = { '📋': 'Onboarding', '⚠️': 'error', '🔍': 'empty', '📞': 'phone', '📍': 'location', '⬇': 'Download', '←': 'Back' };

  it('renders no emoji anywhere on the Signups page, in any sub-view', async () => {
    const c = await mount();
    const views: string[] = [];

    await click(buttonLabelled(c, 'Search')!);          // results
    views.push(c.textContent ?? '');
    const del = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete');
    await click(del!);                                   // the delete dialog
    views.push(c.textContent ?? '');
    await click(buttonLabelled(c, 'Cancel')!);
    await click(tileButton(c, 'data-tile-total'));               // all users
    views.push(c.textContent ?? '');

    for (const text of views) {
      const found = [...text].filter((ch) => EMOJI.test(ch));
      expect(found, `an emoji renders: ${found.join(' ')}`).toEqual([]);
    }
  });

  it('spells none of the seven in either source file', () => {
    for (const rel of ['src/components/AdminSignups.tsx', 'src/components/AdminRoles.tsx']) {
      const body = src(rel);
      for (const [glyph, what] of Object.entries(NAMED)) {
        // The doc comments deliberately QUOTE the ticket's markers (🔴/⚠️), so
        // only the code half of each file is swept for the seven UI ones.
        const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code, `${rel} renders the ${what} emoji again`).not.toContain(glyph);
      }
    }
  });

  it('draws each stat tile icon with lucide, which takes the tile accent', async () => {
    // Moved from AdminCRM.desktop-layout §5. An icon is a component, not a
    // character: `color` on the wrapper actually reaches it.
    const c = await mount();
    for (const handle of ['data-tile-total', 'data-tile-countries', 'data-tile-period']) {
      expect(region(c, handle).querySelector('svg'), `the [${handle}] tile draws no icon`).toBeTruthy();
    }
    expect(src('src/components/AdminSignups.tsx')).toContain("from \"lucide-react\"");
  });

  it('drops the LIVE badge, because these tiles are a snapshot and not a subscription', async () => {
    // Also moved from §5. The claim is checkable at the source: one getDocs,
    // no onSnapshot.
    const c = await mount();
    expect(Array.from(c.querySelectorAll('*')).filter((e) => (e.textContent ?? '').trim() === 'LIVE')).toEqual([]);
    const s = src('src/components/AdminSignups.tsx');
    expect(s.match(/\bonSnapshot\s*\(/g), 'the tiles now subscribe, so LIVE may be true again').toBeNull();
    expect(s).toMatch(/\bgetDocs\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · 🔴 No hardcoded colour, and both palettes resolve — Classic first
// ═══════════════════════════════════════════════════════════════════════════

describe('9 — no colour is hardcoded and both palettes resolve', () => {
  const GLOBALS = src('src/app/globals.css');

  const varsIn = (selectorTest: (sel: string) => boolean): Record<string, string> => {
    const out: Record<string, string> = {};
    postcss.parse(GLOBALS).walkRules((rule) => {
      if (!selectorTest(rule.selector)) return;
      rule.walkDecls((decl) => { if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim(); });
    });
    return out;
  };
  const resolve = (name: string, scope: Record<string, string>, depth = 0): string => {
    const v = scope[name];
    if (!v || depth > 10) return v ?? '';
    const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
    return m ? resolve(m[1], scope, depth + 1) : v;
  };

  /**
   * 🔴 CLASSIC FIRST — it has been the DEFAULT palette since #409, so it is the
   * one a church actually sees. Harvest follows.
   */
  const PALETTES: Array<[string, Record<string, string>]> = [
    ['Classic light', { ...varsIn((s) => s === ':root'), ...varsIn((s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"')) }],
    ['Classic dark', { ...varsIn((s) => s === ':root'), ...varsIn((s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"'))) }],
    ['Harvest light', varsIn((s) => s === ':root')],
    ['Harvest dark', { ...varsIn((s) => s === ':root'), ...varsIn((s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette')) }],
  ];

  it('the Signups screen paints no literal colour at all — no hex, no rgb(), no inline style', () => {
    const s = src('src/components/AdminSignups.tsx');
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/#[0-9A-Fa-f]{3,8}\b/g), 'a hex colour is hardcoded').toBeNull();
    expect(code.match(/\brgba?\(/g), 'a literal rgb()/rgba() is painted').toBeNull();
    // 🔴 THE REASON the design system could not reach the source file: an inline
    // style out-ranks every class, so no palette could apply to one.
    expect(code.match(/style=\{\{/g), 'the screen grew an inline style object').toBeNull();
  });

  it('renders no literal colour at runtime either, across every sub-view', async () => {
    const c = await mount();
    await click(buttonLabelled(c, 'Search')!);
    const inline = Array.from(c.querySelectorAll<HTMLElement>('[style]'))
      .flatMap((el) => (el.getAttribute('style') ?? '').split(';').map((d) => d.trim()).filter(Boolean))
      .filter((d) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(d));
    expect(inline, 'the Signups page renders a literal colour').toEqual([]);
  });

  it('🔴 every colour token the screen spells resolves in ALL FOUR palettes, Classic first', () => {
    // The tokens this screen names, read out of the file rather than listed, so
    // a token added tomorrow is checked tomorrow.
    const s = src('src/components/AdminSignups.tsx');
    const CUSTOM_PROPS = [...new Set([...s.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(CUSTOM_PROPS.length, 'the screen names no token at all — did it stop theming?').toBeGreaterThan(0);

    for (const [palette, scope] of PALETTES) {
      for (const token of CUSTOM_PROPS) {
        const value = resolve(token, scope);
        expect(value, `${token} does not resolve in ${palette}`).toBeTruthy();
      }
    }
  });

  it('and the token CLASSES it spells are ones the theme actually defines', () => {
    // `bg-surface-gold` is a well-formed class name that produced no rule at all
    // until the utility existed — an absence that is invisible without a check.
    const config = src('tailwind.config.ts');
    const ROLES = ['surface', 'raised', 'sunken', 'gold', 'line', 'strong', 'muted', 'body', 'faint', 'danger'];
    for (const role of ROLES) {
      expect(config, `the "${role}" token role is not in the theme`).toContain(role);
    }
    // And the two ramps the tiles read for their accents.
    expect(config).toContain('--ink-blue-600');
    expect(config).toContain('--ink-green-600');
  });

  it('there is no default family left to read these tokens in (THE-338)', () => {
    // 🔴 INVERTED: THE-338 removed the family axis, so the constant that named
    // the default is gone rather than pointing somewhere else.
    expect(src('src/lib/theme.ts')).not.toContain('DEFAULT_PALETTE_FAMILY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · 🔴 Line 1139's rule: a medium FIELD, not a row
// ═══════════════════════════════════════════════════════════════════════════

describe('10 — the four period buttons are still a medium field, not a row', () => {
  it('🔴 carries FIELD_WIDTH.medium, and not the group width a ROW would take', async () => {
    const c = await mount();
    const field = region(c, 'data-period-field');
    // The documented rule: four period buttons are a `medium` FIELD, not a row
    // that should stretch to whatever the card has spare.
    expect(carries(field, FIELD_WIDTH.medium), 'the period buttons lost the medium field width').toBe(true);
    expect(tokensOf(field), 'the period buttons took the ROW width — the rule is undone')
      .not.toContain(FIELD_WIDTH.group.split(' ')[0]);
    expect(maxWidthPx(FIELD_WIDTH.medium)).toBe(280);
  });

  it('is four columns of one grid, so the buttons share the field rather than the card', async () => {
    const c = await mount();
    const field = region(c, 'data-period-field');
    expect(tokensOf(field)).toContain('grid-cols-4');
    expect(field.querySelectorAll('button')).toHaveLength(4);
  });

  it('the rule is stated in the source, where the next reader will look', () => {
    const s = src('src/components/AdminSignups.tsx');
    expect(s).toMatch(/`medium` FIELD, not a row/);
    expect(s).toContain('FIELD_WIDTH.medium');
  });

  it('and the cap is sm:-gated, so a phone still gets four full-width columns', () => {
    // `medium` is `sm:max-w-[280px]`: below 640px the grid is the card's width,
    // which is what keeps the buttons tappable on a phone.
    expect(breakpointOf(FIELD_WIDTH.medium)).toBe('sm');
  });

  /* ── Moved from AdminCRM.desktop-layout §4 ─────────────────────────────── */

  it('puts Rule 3 on Search and on Reset, by their labels', async () => {
    const c = await mount();
    for (const label of ['Reset', 'Search']) {
      expect(carries(buttonLabelled(c, label)!, ACTION_BUTTON), `${label} lost Rule 3`).toBe(true);
    }
  });

  it('sets no inline flex weight that would out-rank the rule', async () => {
    const c = await mount();
    for (const label of ['Reset', 'Search']) {
      const btn = buttonLabelled(c, label)!;
      expect(btn.getAttribute('style') ?? '', `${label} sets flex inline`).not.toMatch(/(^|;)\s*flex:/);
      expect(btn.getAttribute('style') ?? '', `${label} sets padding inline`).not.toMatch(/(^|;)\s*padding:/);
    }
    expect(tokensOf(buttonLabelled(c, 'Reset')!)).toContain('flex-[1]');
    expect(tokensOf(buttonLabelled(c, 'Search')!)).toContain('flex-[2]');
    // The phone's 11px padding, carried at exactly the number it replaced.
    expect(arbitraryPx('p-[11px]', REM_PX_MOBILE)).toBe(11);
    expect(tokensOf(buttonLabelled(c, 'Reset')!)).toContain('p-[11px]');
  });

  it('gives both actions the one density height, not a third one', async () => {
    const c = await mount();
    for (const label of ['Reset', 'Search']) {
      expect(carries(buttonLabelled(c, label)!, CONTROL_DENSITY.action), `${label} invents its own height`).toBe(true);
    }
  });

  it('sizes the location filter to what a city name needs', async () => {
    const c = await mount();
    const filter = c.querySelector(`.${CSS.escape(FIELD_WIDTH.long)}`);
    expect(filter, 'the location filter lost its field width').toBeTruthy();
    expect(maxWidthPx(FIELD_WIDTH.long)).toBe(440);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · 🔴 No horizontal overflow at 380 / 768 / 1024 / 1280 / 1440
// ═══════════════════════════════════════════════════════════════════════════

describe('11 — no horizontal overflow at 380/768/1024/1280/1440', () => {
  /**
   * ⚠️ WIDTH IS NOT MONOTONIC HERE, which is why all five are checked and not
   * just the narrowest and the widest. globals.css trims the rem above 1024px,
   * so a rem-based cap is 768px at a tablet and 696px at a monitor — WIDER at
   * the smaller viewport. That is the trap this section exists for, and it is
   * why every measure on this screen is stated in px.
   *
   * The check is on the CLASS LAYER, not on live layout: happy-dom has no
   * layout engine, so a `getBoundingClientRect` here would return zeros and
   * assert nothing. The repo's own layout suites work the same way.
   */
  const VIEWPORTS = [380, 768, 1024, 1280, 1440];
  /** The shell's content box at each viewport: the page measure caps at 1120. */
  const contentBox = (vw: number) => Math.min(vw - (vw >= 1024 ? 48 : 32), 1120);

  it('spells no fixed width, so nothing can be wider than the box it sits in', async () => {
    const c = await mount();
    const fixed = allTokens(c).filter((t) => /(^|:)w-\[\d+px\]/.test(t));
    expect(fixed, 'a fixed pixel width would overflow the narrowest viewport').toEqual([]);
  });

  it('every max-width it does spell fits inside the content box at all five widths', async () => {
    const c = await mount();
    const caps = [...new Set(allTokens(c))]
      .map((t) => ({ token: t, px: maxWidthPx(t) }))
      .filter((x): x is { token: string; px: number } => x.px !== null);

    for (const vw of VIEWPORTS) {
      for (const { token, px } of caps) {
        // A cap behind `sm:` cannot bind below 640px, so it cannot overflow a phone.
        const bp = breakpointOf(token);
        if (bp && vw < ({ sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 })[bp]!) continue;
        expect(px, `${token} is wider than the ${vw}px content box`).toBeLessThanOrEqual(contentBox(vw));
      }
    }
  });

  it('🔴 carries no rem-based container, which is what makes width non-monotonic', async () => {
    const c = await mount();
    const rem = allTokens(c).filter((t) => /(^|:)max-w-(xs|sm|md|lg|xl|\dxl)$/.test(t));
    expect(rem, 'a rem container is back — it is wider at 768 than at 1280').toEqual([]);
  });

  it('scrolls its wide tables INSIDE their own card, so the page body never does', async () => {
    const c = await mount();
    await click(tileButton(c, 'data-tile-total'));
    const table = c.querySelector('table');
    expect(table, 'the All Users table is gone').toBeTruthy();

    // Every table must have an `overflow-x-auto` ancestor below the page root:
    // seven columns cannot fit 380px, and the correct answer is that the CARD
    // scrolls, never the document.
    for (const t of Array.from(c.querySelectorAll('table'))) {
      let el: Element | null = t.parentElement;
      let guarded = false;
      while (el && el !== c) {
        if (tokensOf(el).includes('overflow-x-auto')) { guarded = true; break; }
        el = el.parentElement;
      }
      expect(guarded, 'a table can push the page sideways at 380px').toBe(true);
    }
  });

  it('takes the page measure from the shared module rather than inventing one', () => {
    const s = src('src/components/AdminSignups.tsx');
    expect(s).toMatch(/from ['"]\.\/layout\/form-layout['"]/);
    // And no per-screen measure of its own: every sm:-gated size it spells has
    // to be one form-layout defines.
    const OWNED = new Set([...CONTAINERS, FIELD_WIDTH.medium, FIELD_WIDTH.long, ACTION_BUTTON, CONTROL_DENSITY.action]
      .flatMap((r) => r.split(/\s+/)));
    const stray = (s.match(/sm:(?:max-w|h|py|w)-\[[^\]]+\]/g) ?? []).filter((t) => !OWNED.has(t));
    expect(stray, 'the screen defines a width of its own').toEqual([]);
  });

  it('every responsive token it renders is one the module owns', async () => {
    const c = await mount();
    const OWNED = new Set([...CONTAINERS, FIELD_WIDTH.medium, FIELD_WIDTH.long, ACTION_BUTTON, CONTROL_DENSITY.action]
      .flatMap((r) => r.split(/\s+/)));
    const SIZE = /^(?:max-w-|h-|py-|w-|gap-)\[/;
    const stray = [...new Set(allTokens(c))]
      .filter((t) => isResponsive(t) && SIZE.test(t.replace(/^sm:/, '')) && !OWNED.has(t));
    expect(stray, 'a size is defined per screen').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · 🔴 The files this ticket was told not to touch
// ═══════════════════════════════════════════════════════════════════════════

describe('12 — AdminDocs.tsx, AdminDashboardHome.tsx, firestore.rules and functions/ byte-identical', () => {
  /**
   * ⚠️ A HASH, NOT A `git show`. CI's clone depth is not this suite's business,
   * and a shell-out at assertion time would make it one. The same discipline
   * posthog-admin-sections.test.ts already uses for the same purpose.
   *
   * THE-275 owns AdminDocs.tsx and the notes tree; THE-276 owns
   * AdminDashboardHome.tsx and src/components/dashboard/**. Both are in flight
   * against this same main, so these digests are what prove this branch stayed
   * out of their files.
   */
  const UNTOUCHED: Record<string, string> = {
    'src/components/AdminDocs.tsx': '5fcb116153258c951936094edf64a5a4abc7be6222f1d5a9fbc25760d99e1368',
    'src/components/AdminDashboardHome.tsx': 'b256a71dcf562c27945e8b586b6e46cf8426bef0a6ea71280102af1df2c9becc',
    'functions/src/index.ts': '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
  };

  /**
   * ⚠️ THE OTHER TICKET LANDED, and that is what this overlay records.
   *
   * The digests above were taken while THE-276 was still in flight, and the
   * claim they make — "this branch stayed out of THE-276's files" — is about
   * THIS branch's authorship, not about the file never moving. THE-276 has
   * since rewritten `AdminDashboardHome.tsx` (it replaced three unordered
   * `limit(500)` reads with exact `getCountFromServer` aggregations and put the
   * dashboard behind a tab shell), so on any tree that carries both tickets the
   * original value is simply stale.
   *
   * 🔴 Named rather than the assertion being dropped, the same treatment
   * THE-273's sonner.tsx fix gets across the primitive suites: every other
   * entry is still compared against exactly one digest, and a value that is
   * neither — THIS branch editing one of them — still fails.
   */
  const MOVED_SINCE: Record<string, readonly string[]> = {
    'src/components/AdminDashboardHome.tsx': [
      // THE-276 (#421), as described above.
      '4d8917c0a31dac5a8a9526e3a1c7e05d786f947bcad72a14d73d488383c23621',
      /*
       * ⚠️ THE-283 (slice 2 of 6) landed the Growth tab, and this records it —
       * the same treatment, for the same reason, one slice on. That ticket
       * mounts the new tab by passing a `growth` panel to `DashboardTabs` and
       * holds the Growth tab's own read beside the Overview one, so
       * `AdminDashboardHome.tsx` moves again. 🔴 THIS branch still did not
       * author a byte of it, which is the claim the entry preserves: a value
       * that is none of the three still fails.
       */
      '3fc6dad47ca367c0afef2b02e0f18c24b9c06bab109e59fb64ee4f3f96703567',
      /*
       * ⚠️ THE-290 (slice 3 of 6) landed the Giving tab, and this records it —
       * the same treatment, for the same reason, one slice further on. That
       * ticket mounts the new tab by passing a `giving` panel to
       * `DashboardTabs` and holds the Giving tab's own read beside the Growth
       * one, so `AdminDashboardHome.tsx` moves a third time. 🔴 THIS branch
       * still did not author a byte of it, which is the claim the entry
       * preserves: a value that is none of the four still fails.
       */
      'd0d4c9d4e3b09ee6d4985ab893c23982c0a10ce5a505220e266cd31dfcc2f71e',
      /*
       * ⚠️ THE-294 (slices 4 and 5 of 6) landed the Engagement and Content tabs,
       * and this records it — the same treatment, for the same reason, two
       * slices further on. That ticket mounts both new tabs by passing
       * `engagement` and `content` panels to `DashboardTabs` and holds each
       * tab's own read beside the Giving one, so `AdminDashboardHome.tsx` moves
       * a fourth time. 🔴 THIS branch still did not author a byte of it, which
       * is the claim the entry preserves: a value that is none of the five
       * still fails.
       */
      '4ca12eef2f6409cb08601f5947011935387d58bbfbbaa3a12710d125905b17bf',
    ],
    // THE-275, the same situation one ticket over. It owns AdminDocs.tsx and has
    // rewritten it: the notes screen was a drill-down (a folder-directory view,
    // then an editor that was the only place the tree existed) and is now two
    // panes with the tree always mounted. This branch still did not author a
    // byte of it — the entry records that the OTHER ticket landed, exactly as
    // the AdminDashboardHome one above does for THE-276.
    // APPENDED BY THE-346, never substituted: THE-275's value above stays
    // accepted, so a merge ref cut before this ticket landed still passes and a
    // digest that is NEITHER still fails. THE-346 owns the notes editor toolbar
    // and its menu - the labelled Export button became the three dots the founder
    // asked for, the hand-rolled menu became the dropdown-menu primitive with an
    // Export submenu, three share rows were added and the expand toggle moved to
    // sit beside "Notes". This branch still did not author a byte of it.
    'src/components/AdminDocs.tsx': [
      '46c8403674c79dcacbb3a0c60f183b77a3e265d33b441b2ea05c1e00fe42b15f',
      '277d2af4d151a45e6e908ea0488e3c053072824abf0c7e36f67dfff050452137',
      /*
       * THE-347, appended beside THE-346's value and never over it. That
       * ticket's own `handleShareToBlogDraft` wrote `createdAt:
       * serverTimestamp()` into `blog_posts`, whose other two writers both
       * write `new Date().toISOString()` and whose interface declares a string
       * - so some documents held a Timestamp OBJECT on that field, and
       * `/admin/blog` went down with React error #31 when one reached JSX.
       * THE-347 changes that ONE expression to an ISO string so no further
       * mixed documents are created. The twelve `serverTimestamp()` writes
       * belonging to the `docs` collection are deliberately untouched - `docs`
       * stores Timestamps consistently - and no menu row, toolbar, share flow
       * or Firestore path in this file moved.
       */
      'b903be259b175a5cf3c2d7df05970fe5e4c7fe8862a16676b296359fc6cc32dc',
    ],
  };

  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so
   * a legitimate rules change is one new record rather than 50 edits.
   */
  it('firestore.rules carries no edit from this ticket', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.keys(UNTOUCHED))('%s carries no edit from this ticket', (file) => {
    const accepted = [UNTOUCHED[file], ...(MOVED_SINCE[file] ?? [])];
    expect(accepted, `${file} changed — it belongs to another ticket`).toContain(digest(file));
  });

  it('🔴 AdminDocs is still mounted from AdminDashboard, and so is AdminDashboardHome', () => {
    // This ticket DOES edit AdminDashboard.tsx — it is the one of the three
    // allowed to, because only it needs a nav entry. So the two mounts that
    // belong to the other tickets are pinned by shape rather than by digest.
    const dash = src('src/components/AdminDashboard.tsx');
    expect(dash).toContain("import AdminDocs from './AdminDocs';");
    expect(dash).toContain("import AdminDashboardHome from './AdminDashboardHome';");
    expect(dash).toContain('<AdminDocs initialDocId={itemId} onItemConsumed={clearItemId} />');
    expect(dash).toMatch(/<AdminDashboardHome\s/);
  });

  it('and no file under src/components/dashboard was added, edited or read', () => {
    // ⚠️ WHAT THIS CHECKS, once THE-276 has landed on the same main. `git diff
    // HEAD` compares the WORKING TREE to the current commit, so on a tree that
    // carries both tickets it says "nothing uncommitted here touches those
    // paths" — not "this branch never authored them". Authorship is what the
    // digest pin above establishes, and the MOVED_SINCE overlay beside it is
    // where THE-276's own edit to AdminDashboardHome.tsx is recorded. Left as
    // it is rather than widened: a stricter version would have to fail on the
    // merged tree, which would be wrong — this branch did not write those files.
    const touched = require('node:child_process')
      .execSync('git diff --name-only HEAD -- src/components/dashboard functions firestore.rules || true',
        { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
    expect(touched, "this branch touched another ticket's files").toEqual([]);
  });

  it('adopts no shadcn primitive — that is Phase 8, and three tickets guard it', () => {
    // 🔴 THE-266, THE-272 and THE-274 each assert that NOTHING outside
    // src/components/ui imports a primitive: "installing is this ticket, not
    // adopting". The restyle here is written in the token layer instead, which
    // is the same vocabulary the primitives are built from — so this screen
    // converts cleanly when Phase 8 comes for it.
    expect(src('src/components/AdminSignups.tsx')).not.toContain('@/components/ui/');
  });
});
