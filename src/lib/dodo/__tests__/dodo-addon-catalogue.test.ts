import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// catalogue.ts consumes the validated dodoConfig, so config.ts evaluates on
// import and the three required variables must exist first. Hoisted above the
// static imports below by vitest.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: mockCapture,
  captureHandledError: vi.fn(),
}));

import {
  DODO_ADDON_MEANINGS,
  DODO_ADDON_UNMAPPED,
  DODO_LIVE_ADDONS,
  DODO_TEST_ADDONS,
  allMappedAddonIds,
  resolveAddonMeaning,
  type DodoAddonMeaning,
} from '../catalogue';
import { mapDodoAddons, reportUnrecognisedDodoAddons } from '../addons';
import type { BillingPeriod } from '../provider';

/**
 * REP-5a — the add-on catalogue: ten add-ons, two modes, and one deliberate gap.
 *
 * ⚠️ DODO ADD-ONS HAVE NO METADATA FIELD, so nothing at runtime can say what an
 * `adn_` id means. The table in `catalogue.ts` IS the mapping, which makes it
 * exactly as load-bearing as the product ids beside it and worth pinning the
 * same way: a transposed add-on id is a church charged for Unlimited Contacts
 * and granted an admin seat, and nothing about that is visible in a log.
 *
 * 🔴 EVERY TARGET BELOW IS NAMED BY ITS LABEL, never matched by a pattern. A
 * regex over `adn_` matches all ten ids and would happily pass on the wrong one;
 * a regex over `500` matches a price, a pack size and a plan's contact
 * allowance. The fixture table is the only way an id is referred to here.
 */

/** Which mode an id belongs to, and what it means. Transcribed, not derived. */
type VerifiedAddon = { meaning: DodoAddonMeaning; period: BillingPeriod; id: string; label: string };

/**
 * The TEST-mode add-ons, as recorded when they were created in Dodo.
 *
 * 🔴 SIX, NOT TEN — THE-370. The Campus and Contacts +500 rows are deleted from
 * this fixture because they are deleted from the table: both products are
 * detached from all nine live plan products and neither meaning exists any more.
 */
const DODO_TEST_ADDONS_AS_RECORDED = [
  { meaning: 'aiAssistant', period: 'monthly', id: 'adn_0NlNfaOwHWiV8CrPNREiU', label: 'AI Assistant - Monthly' },
  { meaning: 'aiAssistant', period: 'yearly', id: 'adn_0NlNfaSduoV543Ey8y9tR', label: 'AI Assistant - Annual' },
  { meaning: 'adminSeat', period: 'monthly', id: 'adn_0NlNfaVFaLLWXU8KXw1JI', label: 'Admin Seat - Monthly' },
  { meaning: 'adminSeat', period: 'yearly', id: 'adn_0NlNfaXplUpTTYwm1jJCV', label: 'Admin Seat - Annual' },
  { meaning: 'unlimitedContacts', period: 'monthly', id: 'adn_0NlNfaqEXuZZsLYWtKcer', label: 'Unlimited Contacts - Monthly' },
  { meaning: 'unlimitedContacts', period: 'yearly', id: 'adn_0NlNfaspQfXIgGxB6d0Bd', label: 'Unlimited Contacts - Annual' },
] as const satisfies readonly VerifiedAddon[];

/**
 * The LIVE-mode add-ons, as recorded when they were created in Dodo.
 *
 * 🔴 SIX, NOT TEN — THE-370, and the four removed ids are recorded in the PR
 * rather than here: a retired id left in a fixture is the "stale excuse that
 * outlives its product" the site's own add-on contract refuses.
 *
 * ⚠️ UNLIMITED CONTACTS WAS REPRICED IN DODO AT THE SAME TIME ($40 → $30
 * monthly, $480 → $360 annual). Its two ids are unchanged and no price lives in
 * this repo, so nothing in this fixture moves for it.
 */
const DODO_LIVE_ADDONS_AS_RECORDED = [
  { meaning: 'aiAssistant', period: 'monthly', id: 'adn_0NlKtuImtSn7PcdvjnSni', label: 'AI Assistant - Monthly' },
  { meaning: 'aiAssistant', period: 'yearly', id: 'adn_0NlKtw3IOHfv1GGCevNol', label: 'AI Assistant - Annual' },
  { meaning: 'adminSeat', period: 'monthly', id: 'adn_0NlKtw7AayNYI6YYwphQ5', label: 'Admin Seat - Monthly' },
  { meaning: 'adminSeat', period: 'yearly', id: 'adn_0NlKtw9lWLs0VRN9hWciX', label: 'Admin Seat - Annual' },
  { meaning: 'unlimitedContacts', period: 'monthly', id: 'adn_0NlKtwKAhJgz0jeaqDX2c', label: 'Unlimited Contacts - Monthly' },
  { meaning: 'unlimitedContacts', period: 'yearly', id: 'adn_0NlKtwMjMlsjzZ8z2Wt7P', label: 'Unlimited Contacts - Annual' },
] as const satisfies readonly VerifiedAddon[];

/** Load `catalogue.ts` fresh under a chosen mode, then put the env back. */
const withEnvironment = async (mode: string) => {
  vi.resetModules();
  const previous = process.env.DODO_PAYMENTS_ENVIRONMENT;
  process.env.DODO_PAYMENTS_ENVIRONMENT = mode;
  try {
    return {
      catalogue: await import('../catalogue'),
      addons: await import('../addons'),
    };
  } finally {
    process.env.DODO_PAYMENTS_ENVIRONMENT = previous;
    vi.resetModules();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test 1 ───────────────────────────────────────────────────────────────────

describe('every add-on id is pinned exactly, in both modes', () => {
  it.each(DODO_TEST_ADDONS_AS_RECORDED)(
    'test mode: $label is $id and means $meaning',
    ({ meaning, period, id }) => {
      expect(DODO_TEST_ADDONS[meaning][period]).toBe(id);
    },
  );

  it.each(DODO_LIVE_ADDONS_AS_RECORDED)(
    'live mode: $label is $id and means $meaning',
    ({ meaning, period, id }) => {
      expect(DODO_LIVE_ADDONS[meaning][period]).toBe(id);
    },
  );

  it('pins the whole table, so an id cannot be ADDED unnoticed either', () => {
    // The assertions above would still pass if a fourth meaning appeared, or if
    // a mapped id were duplicated onto a second meaning. This compares the
    // tables whole, in both directions.
    const flatten = (table: typeof DODO_TEST_ADDONS) =>
      Object.entries(table)
        .flatMap(([meaning, periods]) =>
          Object.entries(periods).map(([period, id]) => ({ meaning, period, id })),
        )
        .filter((entry) => entry.id !== DODO_ADDON_UNMAPPED);

    const asRecorded = (fixture: readonly VerifiedAddon[]) =>
      fixture.map(({ meaning, period, id }) => ({ meaning, period, id }));

    expect(flatten(DODO_TEST_ADDONS)).toEqual(asRecorded(DODO_TEST_ADDONS_AS_RECORDED));
    expect(flatten(DODO_LIVE_ADDONS)).toEqual(asRecorded(DODO_LIVE_ADDONS_AS_RECORDED));
  });
});

// ── Test 2 — 🔴 THE-370: the four retired ids resolve to NOTHING ─────────────

/**
 * The four add-on ids THE-370 retired, in both modes.
 *
 * 🔴 WRITTEN DOWN HERE AND NOWHERE ELSE IN THE BUILD. These ids must not appear
 * in `catalogue.ts` — that is half of what this guard asserts — so the only way
 * to prove they resolve to nothing is to hold them somewhere that is not the
 * table. A test fixture is that place: it can name a product the build must not
 * know, which is exactly the assertion.
 */
const RETIRED_ADDON_IDS = [
  { mode: 'test', label: 'Campus - Monthly', id: 'adn_0NlNfafdHZgpetrweMI31' },
  { mode: 'test', label: 'Campus - Annual', id: 'adn_0NlNfaiGQpP5IAxXI82Fz' },
  { mode: 'test', label: 'Contacts +500 - Monthly', id: 'adn_0NlNfakv8J9oKpmVGavKm' },
  { mode: 'test', label: 'Contacts +500 - Annual', id: 'adn_0NlNfanWnF8iZ0A8rESdW' },
  { mode: 'live', label: 'Campus - Monthly', id: 'adn_0NlKwDcuqIWoVK7Qay13L' },
  { mode: 'live', label: 'Campus - Annual', id: 'adn_0NlKwDgKMpuqzR5VmlCBD' },
  { mode: 'live', label: 'Contacts +500 - Monthly', id: 'adn_0NlKtwD3VfBLgx2LTw69O' },
  { mode: 'live', label: 'Contacts +500 - Annual', id: 'adn_0NlKtwGbLRk2nPC07uC6o' },
] as const;

describe('THE-370 — the campus and contactPack add-ons no longer exist', () => {
  it('neither meaning is in the vocabulary', () => {
    expect(DODO_ADDON_MEANINGS).not.toContain('campus' as never);
    expect(DODO_ADDON_MEANINGS).not.toContain('contactPack' as never);
    expect([...DODO_ADDON_MEANINGS].sort()).toEqual(
      ['adminSeat', 'aiAssistant', 'unlimitedContacts'],
    );
  });

  it('neither table carries a row for either, in either mode', () => {
    for (const table of [DODO_TEST_ADDONS, DODO_LIVE_ADDONS]) {
      expect(Object.keys(table).sort()).toEqual(
        ['adminSeat', 'aiAssistant', 'unlimitedContacts'],
      );
    }
  });

  it.each(RETIRED_ADDON_IDS)(
    '🔴 $mode mode: $label ($id) resolves to nothing',
    async ({ mode, id }) => {
      const resolve = mode === 'live'
        ? (await withEnvironment('live_mode')).catalogue.resolveAddonMeaning
        : resolveAddonMeaning;
      // Not "close enough", not a partial grant — unknown.
      expect(resolve(id)).toBeNull();
    },
  );

  it('🔴 a subscription still carrying a retired id GRANTS NOTHING and is REPORTED', async () => {
    const live = await withEnvironment('live_mode');

    const result = live.addons.mapDodoAddons([
      { addon_id: 'adn_0NlKwDcuqIWoVK7Qay13L', quantity: 3 },
      { addon_id: 'adn_0NlKtwD3VfBLgx2LTw69O', quantity: 2 },
    ]);

    // 🔴 NOTHING GRANTED. The resolved set is exactly "owns nothing".
    expect(result.addons).toEqual({
      aiAssistant: 0,
      adminSeats: 0,
      unlimitedContacts: false,
    });
    // 🔴 AND NOT SILENTLY DROPPED — both are handed back to be reported, which
    // is what makes a church being charged for a retired product discoverable.
    expect(result.unrecognised.map((s) => s.addon_id).sort()).toEqual(
      ['adn_0NlKtwD3VfBLgx2LTw69O', 'adn_0NlKwDcuqIWoVK7Qay13L'],
    );
  });

  it('a retired id alongside a live one costs the live one nothing', async () => {
    const live = await withEnvironment('live_mode');

    const result = live.addons.mapDodoAddons([
      { addon_id: 'adn_0NlKwDcuqIWoVK7Qay13L', quantity: 1 },
      { addon_id: 'adn_0NlKtw7AayNYI6YYwphQ5', quantity: 2 },
    ]);

    expect(result.addons.adminSeats).toBe(2);
    expect(result.unrecognised).toHaveLength(1);
  });
});

// ── Test 3 ───────────────────────────────────────────────────────────────────

describe('live and test add-on ids still never overlap', () => {
  it('shares not one id between the two modes', () => {
    // Widened to string: the fixtures are `as const`, so a literal-typed
    // `includes` would be a COMPILE-time comparison of two disjoint unions —
    // trivially true, and proving nothing at runtime.
    const testIds: string[] = DODO_TEST_ADDONS_AS_RECORDED.map((addon) => addon.id);
    const liveIds: string[] = DODO_LIVE_ADDONS_AS_RECORDED.map((addon) => addon.id);

    expect(new Set(testIds).size).toBe(testIds.length);
    expect(new Set(liveIds).size).toBe(liveIds.length);
    expect(testIds.filter((id) => liveIds.includes(id))).toEqual([]);
  });

  it('treats the other mode\'s ids as foreign, exactly as products are treated', async () => {
    // Same rule as `resolvePlanFromProductId`: under one mode, the other mode's
    // ids are unknown — never "close enough". Both directions.
    const live = await withEnvironment('live_mode');
    for (const { id, label } of DODO_TEST_ADDONS_AS_RECORDED) {
      expect(live.catalogue.resolveAddonMeaning(id), label).toBeNull();
    }
    for (const { id, label } of DODO_LIVE_ADDONS_AS_RECORDED) {
      expect(resolveAddonMeaning(id), label).toBeNull();
    }
  });
});

// ── Test 4 — 🔴 THE TEST-MODE-ONLY QUALIFIER COMES OFF ────────────────────────

describe('each mode now maps all three meanings at both periods', () => {
  it.each(DODO_ADDON_MEANINGS)('test mode maps %s at monthly AND yearly', (meaning) => {
    for (const period of ['monthly', 'yearly'] as const) {
      const id = DODO_TEST_ADDONS[meaning][period];
      expect(id).not.toBe(DODO_ADDON_UNMAPPED);
      // Round-trip: the table's id resolves back to the table's meaning.
      expect(resolveAddonMeaning(id as string)).toBe(meaning);
    }
  });

  it.each(DODO_ADDON_MEANINGS)('live mode maps %s at monthly AND yearly', async (meaning) => {
    const live = await withEnvironment('live_mode');
    for (const period of ['monthly', 'yearly'] as const) {
      const id = live.catalogue.DODO_LIVE_ADDONS[meaning][period];
      expect(id).not.toBe(DODO_ADDON_UNMAPPED);
      expect(live.catalogue.resolveAddonMeaning(id as string)).toBe(meaning);
    }
  });

  it('resolves the six recorded test ids and nothing else', () => {
    expect(new Set(allMappedAddonIds())).toEqual(
      new Set(DODO_TEST_ADDONS_AS_RECORDED.map((addon) => addon.id)),
    );
  });

  it('resolves the six recorded live ids and nothing else', async () => {
    const live = await withEnvironment('live_mode');
    expect(new Set(live.catalogue.allMappedAddonIds())).toEqual(
      new Set(DODO_LIVE_ADDONS_AS_RECORDED.map((addon) => addon.id)),
    );
  });

  it('carries an Admin Seat purchase all the way to a seat count, in test mode', () => {
    // Was a Campus purchase until THE-370 retired that product. Admin Seat is
    // the remaining COUNTED meaning, so it is what exercises the same path.
    // Both periods, because they are separate products.
    for (const period of ['monthly', 'yearly'] as const) {
      const seatId = DODO_TEST_ADDONS.adminSeat[period] as string;
      const mapped = mapDodoAddons([{ addon_id: seatId, quantity: 2 }]);
      expect(mapped.unrecognised).toEqual([]);
      expect(mapped.addons.adminSeats).toBe(2);
    }
  });

  it('reads a monthly and an annual add-on as the SAME meaning', () => {
    // Period is a billing fact, not an entitlement one: an annual seat is one
    // seat, same as a monthly one.
    const monthly = mapDodoAddons([{ addon_id: DODO_TEST_ADDONS.adminSeat.monthly as string, quantity: 1 }]);
    const yearly = mapDodoAddons([{ addon_id: DODO_TEST_ADDONS.adminSeat.yearly as string, quantity: 1 }]);
    expect(monthly.addons).toEqual(yearly.addons);
  });
});

// ── Test 5 ───────────────────────────────────────────────────────────────────

describe('an unrecognised add-on id is still reported, not silently dropped', () => {
  it('hands the unknown id back instead of skipping it', () => {
    const mapped = mapDodoAddons([{ addon_id: 'adn_something_this_build_never_heard_of', quantity: 3 }]);

    expect(mapped.unrecognised).toEqual([
      { addon_id: 'adn_something_this_build_never_heard_of', quantity: 3 },
    ]);
    // And it did not become some other entitlement on the way past.
    expect(mapped.addons).toEqual({
      aiAssistant: 0,
      adminSeats: 0,
      unlimitedContacts: false,
    });
  });

  it('reports one money-path error per unmapped id, carrying the id and subscription', () => {
    const unknown = [
      { addon_id: 'adn_unknown_one', quantity: 1 },
      { addon_id: 'adn_unknown_two', quantity: 2 },
    ];

    const reported = reportUnrecognisedDodoAddons(unknown, {
      step: 'dodo-plan-changed-unrecognised-addon',
      subscriptionId: 'sub_1',
      tenantId: 'grace-chapel',
    });

    expect(reported).toBe(2);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    for (const { addon_id } of unknown) {
      expect(mockCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          step: 'dodo-plan-changed-unrecognised-addon',
          level: 'error',
          tenantId: 'grace-chapel',
          ids: expect.objectContaining({ addonId: addon_id, subscriptionId: 'sub_1' }),
        }),
      );
    }
  });

  it('grants the add-ons it DOES recognise alongside the one it does not', () => {
    // One unknown id must not cost a church the add-ons that mapped.
    const mapped = mapDodoAddons([
      { addon_id: DODO_TEST_ADDONS.adminSeat.monthly as string, quantity: 3 },
      { addon_id: 'adn_unknown', quantity: 1 },
      { addon_id: DODO_TEST_ADDONS.aiAssistant.monthly as string, quantity: 2 },
    ]);

    expect(mapped.addons.adminSeats).toBe(3);
    expect(mapped.addons.aiAssistant).toBe(2);
    expect(mapped.unrecognised).toEqual([{ addon_id: 'adn_unknown', quantity: 1 }]);
  });

  it('reports nothing when every id maps', () => {
    const mapped = mapDodoAddons(
      DODO_TEST_ADDONS_AS_RECORDED.map((addon) => ({ addon_id: addon.id, quantity: 1 })),
    );
    expect(reportUnrecognisedDodoAddons(mapped.unrecognised, {
      step: 'dodo-plan-changed-unrecognised-addon',
      subscriptionId: 'sub_1',
    })).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

// ── The module's own rules, same as the product catalogue's ──────────────────

describe('the add-on table follows the same rules as the product catalogue', () => {
  const codeOnly = readFileSync(resolve(__dirname, '../catalogue.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('reads no environment variable and has no ?? fallback', () => {
    expect(codeOnly).not.toContain('process.env');
    expect(codeOnly).not.toContain('??');
  });

  it('selects the active add-on table from dodoConfig.environment, like the products', () => {
    expect(codeOnly).toContain('ADDONS_BY_ENVIRONMENT[dodoConfig.environment]');
  });

  it('no add-on price literal appears in the repo', () => {
    // Add-on prices ($19/$228, $10/$120, $15/$180, $20/$240, $59/$708) are a
    // Dodo-side fact. A copy here would be a second source of truth that drifts.
    for (const price of [19, 228, 10, 120, 15, 180, 20, 240, 59, 708]) {
      const asLiteral = new RegExp(`(?<![\\w.])${price}(?![\\w.])`);
      expect(asLiteral.test(codeOnly), `catalogue.ts writes ${price} as a literal`).toBe(false);
    }
  });
});
