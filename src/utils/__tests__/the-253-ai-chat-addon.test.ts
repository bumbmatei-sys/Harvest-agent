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
  NO_ADDONS,
  PLAN_ORDER,
  PLAN_PRICING,
  UNLIMITED_CAP,
  getEffectiveFeatures,
  getMinPlanForFeatureCell,
  getPlanFeatures,
} from '../plan-features';
import { DODO_ADDON_MEANINGS, DODO_LIVE_ADDONS, DODO_LIVE_CATALOGUE } from '../../lib/dodo/catalogue';
import { PLAN_LIMITS } from '../../lib/planLimits';
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

  it('🔴 aiChat is false on EVERY tier at base — free, Individual, Small Team, Ministry', () => {
    /* WAS 'no PLAN cell moved — the tiers are exactly where THE-224 pinned
       them', asserting false/false/true/true for both cells on the reasoning
       that THE-253's first half was ADDITIVE: `getPlanFeatures` answered the
       TIER question, the site's plan-comparison surfaces read it, and they
       stayed true.
     *
     * 🔴 THE SECOND HALF IS NOT ADDITIVE, AND THIS IS ITS CENTRAL ASSERTION.
     * "NO PLAN HAS ANY AI RAG CHAT. Of course there should be no AI RAG chat in
     * any plan if we sell it as an add-on." Two tiers including what is sold
     * separately is the false claim; both cells are false everywhere now, and
     * the site surfaces that read them were corrected in the same batch.
     *
     * Every tier is named rather than mapped blind, so adding a fifth tier that
     * grants the chat fails here rather than passing an array comparison. */
    expect(getPlanFeatures('free').aiChat, 'free').toBe(false);
    expect(getPlanFeatures('plus').aiChat, 'Individual').toBe(false);
    expect(getPlanFeatures('pro').aiChat, 'Small Team').toBe(false);
    expect(getPlanFeatures('max').aiChat, 'Ministry').toBe(false);
    expect(PLANS.map((p) => getPlanFeatures(p).aiChat)).toEqual([false, false, false, false]);

    // `aiKnowledge` moves with it, always — see the note at the lift.
    expect(getPlanFeatures('free').aiKnowledge, 'free').toBe(false);
    expect(getPlanFeatures('plus').aiKnowledge, 'Individual').toBe(false);
    expect(getPlanFeatures('pro').aiKnowledge, 'Small Team').toBe(false);
    expect(getPlanFeatures('max').aiKnowledge, 'Ministry').toBe(false);

    // 🔴 AND NO TIER HAS A MINIMUM PLAN FOR EITHER — nothing may print
    // "Available on Small Team and above" for a thing upgrading does not buy.
    expect(getMinPlanForFeatureCell('aiChat')).toBeNull();
    expect(getMinPlanForFeatureCell('aiKnowledge')).toBeNull();
    expect(PLAN_ORDER).toEqual(PLANS);
  });

  it('🔴 the ONLY path to aiChat is holding the add-on', () => {
    /* The two halves stated together, per tier, so neither can drift from the
       other: false at base, true with one add-on held, on every tier. */
    for (const plan of PLANS) {
      expect(getPlanFeatures(plan).aiChat, `${plan} base`).toBe(false);
      expect(getEffectiveFeatures(plan, NO_ADDONS).aiChat, `${plan} owning nothing`).toBe(false);
      expect(getEffectiveFeatures(plan, owning({ aiAssistant: 1 })).aiChat, `${plan} owning one`).toBe(true);
      expect(getEffectiveFeatures(plan, owning({ aiAssistant: 1 })).aiKnowledge, `${plan} owning one`).toBe(true);
    }
  });

  it('🔴 an add-on never removes what a plan grants — the lift is `||`, not assignment', () => {
    /* ⚠️ READ WHY THIS IS A SOURCE ASSERTION AND NOT A BEHAVIOURAL ONE.
     *
     * This property used to be checkable by mounting Small Team with no add-on
     * and seeing the chat: an assignment (`aiChat: owned.aiAssistant > 0`)
     * would have taken it away, and several tests across this repo caught that.
     * No tier carries `aiChat: true` any anymore, so `base.aiChat || X` and a
     * bare `X` now produce IDENTICAL behaviour for every input — the mutation is
     * invisible to any test that only calls the function.
     *
     * 🔴 THAT MAKES THE PROPERTY MORE FRAGILE, NOT LESS IMPORTANT. It is the
     * rule that keeps a future tier able to include the chat without the add-on
     * silently governing it, and it is exactly the kind of invariant that gets
     * "simplified away" by someone who notices the left operand is always
     * false. So it is pinned where it actually lives: in the source of the lift.
     *
     * ⚠️ Read with `readFileSync`, never `git show` — this asserts about the
     * file on disk, which is what ships, and behaves the same in a shallow CI
     * checkout. */
    const src = srcOf('../plan-features.ts');
    expect(src, 'the aiChat lift is not `base.aiChat || …`')
      .toMatch(/aiChat:\s*base\.aiChat\s*\|\|\s*owned\.aiAssistant\s*>\s*0/);
    expect(src, 'the aiKnowledge lift is not `base.aiKnowledge || …`')
      .toMatch(/aiKnowledge:\s*base\.aiKnowledge\s*\|\|\s*owned\.aiAssistant\s*>\s*0/);
    // Neither may be written as a bare assignment from ownership.
    expect(src, 'the aiChat lift dropped its base operand')
      .not.toMatch(/aiChat:\s*owned\.aiAssistant\s*>\s*0/);
    expect(src, 'the aiKnowledge lift dropped its base operand')
      .not.toMatch(/aiKnowledge:\s*owned\.aiAssistant\s*>\s*0/);

    // And the behavioural half that still bites: a lift never turns a cell OFF.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      for (const q of [0, 1, 9]) {
        const f = getEffectiveFeatures(plan, owning({ aiAssistant: q }));
        if (base.aiChat) expect(f.aiChat, `${plan} lost aiChat at q=${q}`).toBe(true);
        if (base.aiKnowledge) expect(f.aiKnowledge, `${plan} lost aiKnowledge at q=${q}`).toBe(true);
      }
    }
  });
});

/* ── test 6 — 🔴 THE DELETION GUARD ────────────────────────────────────────── */
describe('raiseCap still raises admins, and nothing an add-on bought was lost', () => {
  /* 🔴 WHY THIS EXISTS. THE-253's sibling change removed the `aiAssistant` cell
     from `PlanFeatures`, and that cell was one of four `raiseCap` call sites in
     `getEffectiveFeatures`. The others raised capacity a church had PAID FOR, so
     a careless edit to that function was the one place this work could take away
     something already sold.

     🔴 THREE OF THE FOUR ARE NOW GONE, AND NOT BY CARELESSNESS — THE-370. The
     contact-pack and campus raises went with the two add-ons the founder
     retired, and `maxAdmins` is the one capacity an add-on still buys. Nothing
     was taken away: both retired caps were RAISED in the matrix instead, which
     is the assertion directly below. */

  it('one admin seat adds exactly one admin, on every tier', () => {
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan).maxAdmins;
      expect(getEffectiveFeatures(plan, owning({ adminSeats: 1 })).maxAdmins, plan).toBe(base + 1);
      expect(getEffectiveFeatures(plan, owning({ adminSeats: 8 })).maxAdmins, plan).toBe(base + 8);
    }
  });

  it('🔴 THE-370 took NOTHING AWAY — every retired cap went UP, not down', () => {
    // The one property that makes deleting two add-ons safe: a tenant that held
    // one is not worse off, because the tier itself now publishes at least what
    // the tier-plus-add-on used to.
    //
    // Contacts: Individual 150 → 500, Small Team 500 → 2,000, Ministry
    // 2,000 → 4,000. One retired pack was +500, so every tier gained more than
    // a single pack ever added.
    expect(getPlanFeatures('plus').maxContacts).toBe(500);
    expect(getPlanFeatures('pro').maxContacts).toBe(2_000);
    expect(getPlanFeatures('max').maxContacts).toBe(4_000);
    // Campuses: every paid tier was 1 and is now unlimited, which is strictly
    // more than 1 + any number of retired campus add-ons.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(getPlanFeatures(plan).maxChurches, plan).toBe(UNLIMITED_CAP);
    }
  });

  it('the two raises are INDEPENDENT — a full set moves each by its own amount', () => {
    // The failure mode a shared helper invites: one edit that wires two cells
    // to the same quantity. Distinct quantities, so a crossed wire cannot pass.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      const all = getEffectiveFeatures(plan, owning({
        adminSeats: 5, aiAssistant: 1, unlimitedContacts: true,
      }));
      expect(all.maxAdmins, `${plan}.maxAdmins`).toBe(base.maxAdmins + 5);
      // 🔴 `maxContacts` NO LONGER MOVES AT ALL. It reads straight through from
      // the tier, which is what makes the published number and the tenant's
      // number the same number.
      expect(all.maxContacts, `${plan}.maxContacts`).toBe(base.maxContacts);
      expect(all.maxChurches, `${plan}.maxChurches`).toBe(base.maxChurches);
      expect(all.unlimitedContacts, `${plan}.unlimitedContacts`).toBe(true);
    }
  });

  it('and NO add-on ever lowers a cap', () => {
    // Including the negative quantities `readTenantAddons` is meant to clamp.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      for (const set of [NO_ADDONS, owning({ adminSeats: -5, aiAssistant: -5 })]) {
        const f = getEffectiveFeatures(plan, set);
        expect(f.maxAdmins, `${plan}.maxAdmins`).toBeGreaterThanOrEqual(base.maxAdmins);
        expect(f.maxContacts, `${plan}.maxContacts`).toBe(base.maxContacts);
        expect(f.maxChurches, `${plan}.maxChurches`).toBe(base.maxChurches);
      }
    }
  });

  it('🔴 an UNLIMITED cap is never turned into a small positive number', () => {
    // `raiseCap`'s first line, now a live case rather than a future guard:
    // every paid tier's `maxChurches` is the sentinel, and no add-on may add to
    // it. A `raiseCap` that dropped its sentinel check would read -1 + 0 = -1
    // here and still pass, so the seat count is deliberately non-zero.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      const f = getEffectiveFeatures(plan, owning({ adminSeats: 3 }));
      expect(f.maxChurches, plan).toBe(UNLIMITED_CAP);
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
      .toEqual(['adminSeats', 'aiAssistant', 'unlimitedContacts']);
    expect(srcOf('../../lib/dodo/addons.ts')).toMatch(/case 'aiAssistant':/);
  });
});

/* ── test 11 ───────────────────────────────────────────────────────────────── */
describe('no price and no other add-on moved', () => {
  it('the nine plan prices are exactly as they were', () => {
    expect(PLAN_PRICING.plus).toEqual({ monthly: 20, quarterly: 54, yearly: 190 });
    expect(PLAN_PRICING.pro).toEqual({ monthly: 40, quarterly: 108, yearly: 380 });
    // ⚠️ Moved by THE-343, not by this ticket — the add-on prices below are
    // what this file guards and they are untouched.
    expect(PLAN_PRICING.max).toEqual({ monthly: 60, quarterly: 162, yearly: 564 });
  });

  it('the three surviving add-on meanings and their live Dodo ids are unchanged', () => {
    /* ⚠️ WAS FIVE. THE-370 retired `campus` and `contactPack`; the three below
       are what Dodo still attaches. Pinned by id, so a re-point at a different
       Dodo product fails here rather than in billing. */
    expect([...DODO_ADDON_MEANINGS].sort())
      .toEqual(['adminSeat', 'aiAssistant', 'unlimitedContacts']);
    expect(DODO_LIVE_ADDONS.adminSeat).toEqual({
      monthly: 'adn_0NlKtw7AayNYI6YYwphQ5', yearly: 'adn_0NlKtw9lWLs0VRN9hWciX',
    });
    /* 🔴 THE IDS ARE UNCHANGED THOUGH THE PRICE MOVED. Dodo repriced Unlimited
       Contacts $40 → $30 monthly and $480 → $360 annual on the SAME two
       products, so this pin is exactly as strong as it was — and no price lives
       in this repo to drift with it. */
    expect(DODO_LIVE_ADDONS.unlimitedContacts).toEqual({
      monthly: 'adn_0NlKtwKAhJgz0jeaqDX2c', yearly: 'adn_0NlKtwMjMlsjzZ8z2Wt7P',
    });
    // And the AI Assistant product this ticket gives meaning to — same ids,
    // still live, still $20/mo. The PRICE did not move; what it buys did.
    expect(DODO_LIVE_ADDONS.aiAssistant).toEqual({
      monthly: 'adn_0NlKtuImtSn7PcdvjnSni', yearly: 'adn_0NlKtw3IOHfv1GGCevNol',
    });
  });

  it('🔴 the add-on buys the CAPABILITY and not the ALLOWANCE', () => {
    /* ⚠️ WHERE THIS ADD-ON MAY BE SOLD, AND WHY THE ANSWER IS NOT "ANY TIER".
       `getEffectiveFeatures` lifts `aiChat` on every tier, but the monthly
       token ceiling is the TIER's and no add-on raises it. On `free` that
       ceiling is ZERO, so a free tenant holding the add-on would pass the
       entitlement gate and then be refused by `checkQueryBudget` on its first
       question — the capability granted, the allowance absent.

       Not reachable today: a Dodo add-on attaches to a SUBSCRIPTION and a free
       tenant has none. But it is the reason the marketing card must stay sold
       on plus/pro/max only, and it is pinned here so that "sell it on free too"
       fails a test rather than a church. */
    expect(PLAN_LIMITS.free.queryTokensPerMonth).toBe(0);
    expect(PLAN_LIMITS.free.ingestTokensTotal).toBe(0);
    // The capability is granted regardless — the refusal is the ledger's job,
    // not the matrix's, and the two must not be confused for one another.
    expect(getEffectiveFeatures('free', owning({ aiAssistant: 1 })).aiChat).toBe(true);
    // And the tiers the card IS sold on can actually spend.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(PLAN_LIMITS[plan].queryTokensPerMonth, plan).toBeGreaterThan(0);
      expect(PLAN_LIMITS[plan].ingestTokensTotal, plan).toBeGreaterThan(0);
    }
  });

  it('🔴 free CANNOT buy the add-on, and the enforcement is Dodo, not a flag here', () => {
    /* HOW "sold on plus/pro/max only" IS ACTUALLY ENFORCED, pinned so that the
       answer is not "we remembered to write it on the card".
     *
     * 🔴 A DODO ADD-ON ATTACHES TO A SUBSCRIPTION, AND FREE HAS NONE. The
     * product catalogue is keyed on `PricedPlan` — plus | pro | max — and free
     * is deliberately absent from it: a free tenant is provisioned with
     * `plan: 'free'` and no Dodo subscription at all. There is nothing for the
     * add-on to hang on, so the webhook can never write `addons.aiAssistant`
     * for a free tenant. That is a structural refusal, in the payment
     * processor, which is where THE-133 deliberately put add-on availability so
     * that a bug in this repo cannot sell something.
     *
     * ⚠️ THE TOKEN CAP IS THE SECOND, INDEPENDENT REASON and the one that would
     * bite if the first ever failed: free budgets ZERO query tokens, so an
     * add-on that somehow arrived would grant the capability and buy no
     * allowance — the church pays and gets refused on its first question.
     *
     * If free is ever given a Dodo product, this test fails and says which of
     * the two guarantees moved. */
    expect(Object.keys(DODO_LIVE_CATALOGUE).sort()).toEqual(['max', 'plus', 'pro']);
    expect(DODO_LIVE_CATALOGUE, 'free gained a Dodo product — re-check the add-on ceiling')
      .not.toHaveProperty('free');
    expect(Object.keys(PLAN_PRICING).sort()).toEqual(['max', 'plus', 'pro']);
    expect(PLAN_LIMITS.free.queryTokensPerMonth, 'free can now spend on AI').toBe(0);

    // The three the card IS sold on each have a live product AND an allowance.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(DODO_LIVE_CATALOGUE, `${plan} lost its Dodo product`).toHaveProperty(plan);
      expect(PLAN_LIMITS[plan].queryTokensPerMonth, plan).toBeGreaterThan(0);
    }
  });

  it('owning the AI add-on moves no capacity cell', () => {
    // It is a capability, not capacity. A church that buys it gets no extra
    // contacts or admins — which is what its blurb must keep saying.
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
