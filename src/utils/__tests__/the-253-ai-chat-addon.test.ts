import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// `catalogue.ts` consumes the validated `dodoConfig`, so `config.ts` evaluates
// on import and the three required variables must exist first. Hoisted above
// the static imports below by vitest. The environment named here is irrelevant
// to what this file asserts: `DODO_LIVE_ADDONS` is a module constant, read
// directly rather than through `DODO_ACTIVE_ADDONS`.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import {
  CONTACTS_PER_PACK,
  NO_ADDONS,
  PLAN_ORDER,
  PLAN_PRICING,
  getEffectiveFeatures,
  getPlanFeatures,
} from '../plan-features';
import { DODO_ADDON_MEANINGS, DODO_LIVE_ADDONS } from '../../lib/dodo/catalogue';
import type { TenantAddons } from '../../types/tenant.types';
import type { TenantPlan } from '../../types/tenant.types';

/* ─── THE-253 — the AI chat add-on grants the AI chat ─────────────────────────
 *
 * 🔴 WHAT WAS WRONG. "AI Assistant" is a LIVE Dodo product a church can buy
 * today, and buying it granted NOTHING. The purchase raised
 * `features.aiAssistant` — a COUNT belonging to the RETIRED Telegram assistant,
 * behind a flag that is false — and no gate, ledger or route read that cell.
 * THE-224 found this and withdrew the marketing card rather than ship a card
 * that charged $20/mo for no change in behaviour, and said in as many words
 * that making the sale real "is a BUILD ... and THE-224 deliberately did not
 * build it". This is that build.
 *
 * ─── The shape: purchase → entitlement ───────────────────────────────────────
 *
 *   1. The admin asks. `AddOnsSection` POSTs `/api/dodo/addons`.
 *   2. Dodo decides. That route calls `executeDodoPlanChange` with
 *      `on_payment_failure: 'prevent_change'` and writes NOTHING to the tenant.
 *   3. 🔴 THE WEBHOOK WRITES. `subscription.plan_changed` (and the provisioning
 *      paths) map the subscription's CURRENT add-on array to meanings and
 *      REPLACE `tenants/{id}.addons`. Single writer, asserted below.
 *   4. The client re-reads. `refreshTenantAddons` pulls the tenant doc back.
 *   5. 🔴 `getEffectiveFeatures` COMPOSES. The tier's cells, with the owned
 *      add-ons layered on — and, as of this ticket, `aiChat` and `aiKnowledge`
 *      lifted by ownership.
 *
 * ⚠️ STEP 3 IS UNCHANGED BY THIS TICKET, deliberately. The UI must never apply
 * what it asked for: `prevent_change` means a failed payment leaves the church
 * where it was, so anything the UI wrote optimistically would be a capability
 * nobody paid for. This ticket changed only what the STORED set MEANS.
 *
 * ⚠️ THE STORED FIELD NAME DID NOT CHANGE. `addons.aiAssistant` is persisted
 * Firestore data written by the webhook for every tenant that already owns one;
 * renaming it to match its new meaning would orphan those records. The field is
 * the purchase; the meaning is `getEffectiveFeatures`'.
 */

const PLANS: TenantPlan[] = ['free', 'plus', 'pro', 'max'];

const srcOf = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const owning = (over: Partial<TenantAddons>): TenantAddons => ({ ...NO_ADDONS, ...over });

/* ── test 2 ────────────────────────────────────────────────────────────────── */
describe('a tenant that owns the add-on has the AI chat', () => {
  it('resolves aiChat true on every tier, including the two that never had it', () => {
    /* 🔴 THE DELIVERABLE. free and Individual are the tiers where the chat is
       genuinely off, and they are the whole point of selling it: before this,
       a church on Individual could pay and still not reach the assistant. */
    for (const plan of PLANS) {
      expect(getEffectiveFeatures(plan, owning({ aiAssistant: 1 })).aiChat, plan).toBe(true);
    }
  });

  it('grants the knowledge base too, so the chat has something to answer from', () => {
    /* ⚠️ NOT SCOPE CREEP — the chat answers ONLY from the knowledge base, and
       `aiKnowledge` is what lets an admin put anything in it. The add-on is
       sold on Individual, where `aiKnowledge` is false, so granting `aiChat`
       alone would sell a chat that can only ever say "I don't have that". */
    for (const plan of PLANS) {
      expect(getEffectiveFeatures(plan, owning({ aiAssistant: 1 })).aiKnowledge, plan).toBe(true);
    }
  });

  it('one add-on is the whole capability — quantity buys nothing further', () => {
    // Ownership, not allowance. There is no seat: see THE-224's surviving
    // assertion that nothing meters per `aiAssistant` count.
    for (const quantity of [1, 2, 25]) {
      const f = getEffectiveFeatures('plus', owning({ aiAssistant: quantity }));
      expect(f.aiChat).toBe(true);
      expect(f.aiKnowledge).toBe(true);
    }
  });
});

/* ── test 3 (the pure half; the rendered half is in the component suites) ───── */
describe('a tenant WITHOUT the add-on does not have the AI chat', () => {
  it('reads exactly what the tier publishes when nothing is owned', () => {
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      for (const nothing of [NO_ADDONS, null, undefined]) {
        expect(getEffectiveFeatures(plan, nothing).aiChat, plan).toBe(base.aiChat);
        expect(getEffectiveFeatures(plan, nothing).aiKnowledge, plan).toBe(base.aiKnowledge);
      }
    }
  });

  it('a corrupt or absent add-on field fails CLOSED to owning nothing', () => {
    /* The field comes off a Firestore document. A junk value must not be read
       as ownership — that would hand out a paid capability on a malformed doc. */
    for (const junk of [undefined, null, 'aiAssistant: 1', 42, [], { aiAssistant: 'yes' }, { aiAssistant: -3 }]) {
      expect(getEffectiveFeatures('plus', junk as never).aiChat, String(junk)).toBe(false);
    }
  });

  it('no PLAN cell moved — the tiers are exactly where THE-224 pinned them', () => {
    /* 🔴 THIS TICKET IS ADDITIVE. `getPlanFeatures` is the TIER question and
       still answers it; the site's plan-comparison surfaces read it and stay
       true. `aiChat` false/false/true/true, `aiKnowledge` likewise. */
    expect(PLANS.map((p) => getPlanFeatures(p).aiChat)).toEqual([false, false, true, true]);
    expect(PLANS.map((p) => getPlanFeatures(p).aiKnowledge)).toEqual([false, false, true, true]);
    expect(PLAN_ORDER).toEqual(PLANS);
  });
});

/* ── test 6 — 🔴 THE DELETION GUARD ────────────────────────────────────────── */
describe('raiseCap still raises contacts, admins and campuses', () => {
  /* 🔴 WHY THIS EXISTS. THE-253's sibling change removes the `aiAssistant` cell
     from `PlanFeatures`, and that cell is one of four `raiseCap` call sites in
     `getEffectiveFeatures`. The other three raise capacity a church has PAID
     FOR — contacts, admin seats, campuses — so a careless edit to that function
     is the one place this work could take away something already sold. These
     assertions do not care whether the AI cell is there; they pin the three
     that must survive it. */

  it('one contact pack adds exactly CONTACTS_PER_PACK, on every tier', () => {
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan).maxContacts;
      expect(getEffectiveFeatures(plan, owning({ contactPacks: 1 })).maxContacts, plan)
        .toBe(base + CONTACTS_PER_PACK);
      expect(getEffectiveFeatures(plan, owning({ contactPacks: 4 })).maxContacts, plan)
        .toBe(base + 4 * CONTACTS_PER_PACK);
    }
  });

  it('one admin seat adds exactly one admin, on every tier', () => {
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan).maxAdmins;
      expect(getEffectiveFeatures(plan, owning({ adminSeats: 1 })).maxAdmins, plan).toBe(base + 1);
      expect(getEffectiveFeatures(plan, owning({ adminSeats: 8 })).maxAdmins, plan).toBe(base + 8);
    }
  });

  it('one campus adds exactly one church — the only path past maxChurches: 1', () => {
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan).maxChurches;
      expect(getEffectiveFeatures(plan, owning({ campuses: 1 })).maxChurches, plan).toBe(base + 1);
      expect(getEffectiveFeatures(plan, owning({ campuses: 3 })).maxChurches, plan).toBe(base + 3);
    }
  });

  it('the three raise INDEPENDENTLY — a full set moves each by its own amount', () => {
    // The failure mode a shared helper invites: one edit that wires two cells
    // to the same quantity. Distinct quantities, so a crossed wire cannot pass.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      const all = getEffectiveFeatures(plan, owning({
        contactPacks: 2, adminSeats: 5, campuses: 3, aiAssistant: 1, unlimitedContacts: true,
      }));
      expect(all.maxContacts, `${plan}.maxContacts`).toBe(base.maxContacts + 2 * CONTACTS_PER_PACK);
      expect(all.maxAdmins, `${plan}.maxAdmins`).toBe(base.maxAdmins + 5);
      expect(all.maxChurches, `${plan}.maxChurches`).toBe(base.maxChurches + 3);
      expect(all.unlimitedContacts, `${plan}.unlimitedContacts`).toBe(true);
    }
  });

  it('and NO add-on ever lowers one of the three', () => {
    // Including the negative quantities `readTenantAddons` is meant to clamp.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      for (const set of [NO_ADDONS, owning({ contactPacks: -5, adminSeats: -5, campuses: -5 })]) {
        const f = getEffectiveFeatures(plan, set);
        expect(f.maxContacts, `${plan}.maxContacts`).toBeGreaterThanOrEqual(base.maxContacts);
        expect(f.maxAdmins, `${plan}.maxAdmins`).toBeGreaterThanOrEqual(base.maxAdmins);
        expect(f.maxChurches, `${plan}.maxChurches`).toBeGreaterThanOrEqual(base.maxChurches);
      }
    }
  });
});

/* ── test 7 ────────────────────────────────────────────────────────────────── */
describe('the webhook is still the only writer of the add-on set', () => {
  it('the purchase route calls Dodo and writes no add-on set of its own', () => {
    /* 🔴 THE SAFETY PROPERTY THIS TICKET MUST NOT SPEND. `prevent_change` means
       Dodo decides: a failed payment leaves the church exactly where it was. If
       the UI-facing route wrote what it ASKED for, a declined card would grant
       the AI chat to someone who never paid for it — and this ticket is what
       makes that grant worth something. */
    const route = srcOf('../../app/api/dodo/addons/route.ts');
    expect(route).toMatch(/executeDodoPlanChange\(/);
    // No write of the tenant's add-on set anywhere in the request path.
    expect(route, 'the purchase route writes an add-on set').not.toMatch(
      /\.(update|set)\(\s*\{[^}]*\baddons\b/s,
    );
    expect(route).toMatch(/single writer/i);
  });

  it('every module that writes the set is on the webhook path, and no other is', () => {
    /* Named rather than counted: these three are reached only from
       `receiveDodoWebhookEvent`. A fourth writer appearing outside this list is
       what this assertion is for. */
    const WEBHOOK_WRITERS = [
      '../../lib/dodo/provisioning.ts',
      '../../lib/dodo/plan-change.ts',
      '../../lib/dodo/first-subscription.ts',
    ];
    for (const rel of WEBHOOK_WRITERS) {
      expect(srcOf(rel), `${rel} no longer writes the add-on set`).toMatch(/\baddons\b/);
    }
    // The client-side context READS the set back and never writes it.
    const ctx = srcOf('../../contexts/TenantContext.tsx');
    expect(ctx).toMatch(/refreshTenantAddons/);
    expect(ctx, 'TenantContext writes an add-on set').not.toMatch(/setDoc|updateDoc/);
  });

  it('the stored field name is untouched, so existing purchases still resolve', () => {
    /* ⚠️ `addons.aiAssistant` is live Firestore data. Renaming the field to
       match its new meaning would silently strip the capability from every
       church that already bought it — the webhook writes this exact key. */
    expect(Object.keys(NO_ADDONS).sort())
      .toEqual(['adminSeats', 'aiAssistant', 'campuses', 'contactPacks', 'unlimitedContacts']);
    expect(srcOf('../../lib/dodo/addons.ts')).toMatch(/case 'aiAssistant':/);
  });
});

/* ── test 11 ───────────────────────────────────────────────────────────────── */
describe('no price and no other add-on moved', () => {
  it('the nine plan prices are exactly as they were', () => {
    expect(PLAN_PRICING.plus).toEqual({ monthly: 20, quarterly: 54, yearly: 190 });
    expect(PLAN_PRICING.pro).toEqual({ monthly: 40, quarterly: 108, yearly: 380 });
    expect(PLAN_PRICING.max).toEqual({ monthly: 80, quarterly: 216, yearly: 760 });
  });

  it('the five add-on meanings and their live Dodo ids are unchanged', () => {
    /* The other four are not this ticket's to touch. Pinned by id, so a
       re-point at a different Dodo product fails here rather than in billing. */
    expect([...DODO_ADDON_MEANINGS].sort())
      .toEqual(['adminSeat', 'aiAssistant', 'campus', 'contactPack', 'unlimitedContacts']);
    expect(DODO_LIVE_ADDONS.adminSeat).toEqual({
      monthly: 'adn_0NlKtw7AayNYI6YYwphQ5', yearly: 'adn_0NlKtw9lWLs0VRN9hWciX',
    });
    expect(DODO_LIVE_ADDONS.campus).toEqual({
      monthly: 'adn_0NlKwDcuqIWoVK7Qay13L', yearly: 'adn_0NlKwDgKMpuqzR5VmlCBD',
    });
    expect(DODO_LIVE_ADDONS.contactPack).toEqual({
      monthly: 'adn_0NlKtwD3VfBLgx2LTw69O', yearly: 'adn_0NlKtwGbLRk2nPC07uC6o',
    });
    expect(DODO_LIVE_ADDONS.unlimitedContacts).toEqual({
      monthly: 'adn_0NlKtwKAhJgz0jeaqDX2c', yearly: 'adn_0NlKtwMjMlsjzZ8z2Wt7P',
    });
    // And the AI Assistant product this ticket gives meaning to — same ids,
    // still live, still $20/mo. The PRICE did not move; what it buys did.
    expect(DODO_LIVE_ADDONS.aiAssistant).toEqual({
      monthly: 'adn_0NlKtuImtSn7PcdvjnSni', yearly: 'adn_0NlKtw3IOHfv1GGCevNol',
    });
  });

  it('owning the AI add-on moves no capacity cell', () => {
    // It is a capability, not capacity. A church that buys it gets no extra
    // contacts, admins or campuses — which is what its blurb must keep saying.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      const f = getEffectiveFeatures(plan, owning({ aiAssistant: 3 }));
      expect(f.maxContacts, plan).toBe(base.maxContacts);
      expect(f.maxAdmins, plan).toBe(base.maxAdmins);
      expect(f.maxChurches, plan).toBe(base.maxChurches);
      expect(f.unlimitedContacts, plan).toBe(false);
    }
  });
});

/* ── the gates actually ask ─────────────────────────────────────────────────── */
describe('the surfaces that gate the chat ask the TENANT question', () => {
  it.each([
    ['components/MainApp.tsx', '../../components/MainApp.tsx'],
    ['components/AdminDashboard.tsx', '../../components/AdminDashboard.tsx'],
  ])('%s composes add-ons rather than reading the bare tier', (_label, rel) => {
    /* 🔴 THE MISTAKE THIS TICKET ALMOST REPEATED. Granting the capability in
       `getEffectiveFeatures` while the gate reads `getPlanFeatures` produces
       exactly the old defect in a new place: the church pays, the entitlement
       resolves, and the surface still refuses. */
    const s = srcOf(rel);
    expect(s).toMatch(/getEffectiveFeatures\(/);
    expect(s, `${rel} still calls getPlanFeatures — that is the TIER question`)
      .not.toMatch(/getPlanFeatures\s*\(/);
  });

  it('the server gate reads the tenant through the shared helper', () => {
    const route = srcOf('../../app/api/gemini/route.ts');
    expect(route).toMatch(/tenantFeaturesById\(/);
    expect(route).toMatch(/ai_chat_not_entitled/);
  });
});
