import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NO_ADDONS,
  PLAN_ORDER,
  getEffectiveFeatures,
  getPlanFeatures,
  hasFeature,
} from '../plan-features';
import { PLAN_LIMITS } from '../../lib/planLimits';
import type { TenantPlan } from '../../types/tenant.types';

/* ─── THE-224 — the $20 "AI Assistant" add-on gated nothing ───────────────────
 *
 * A founder on Small Team annual found the in-app AI assistant working without
 * having bought the add-on. That is CORRECT behaviour, and this file pins it as
 * correct: `aiChat` is false / false / true / true across free / Individual /
 * Small Team / Ministry, so the assistant is included from Small Team up.
 *
 * 🔴 WHAT THAT EXPOSED, AND WHAT THIS FILE IS REALLY FOR: NOTHING ENFORCES A
 * SEAT. Two different things shared the name "AI Assistant":
 *
 *   `aiChat`       — boolean. The member-facing RAG assistant. A plan capability.
 *   `aiAssistant`  — a COUNT, of the RETIRED Telegram assistant. Every read of
 *                    it sits behind `AI_TELEGRAM_ASSISTANT_ENABLED`, which is
 *                    false, and NO code path compares any usage against it.
 *
 * The marketing site sold a $20/mo add-on described as the in-app member
 * assistant — which is `aiChat`, already included — and the live Dodo product
 * calls it "One additional AI Assistant seat". There is no seat. The add-on
 * raised a count nothing reads.
 *
 * ⚠️ THIS FILE ASSERTS THE ABSENCE, WHICH IS THE DELIVERABLE. If someone later
 * makes the add-on mean something — seats, or a top-up on the monthly query
 * token cap — these tests are what will fail and say so, and the add-on becomes
 * real. Until then it grants nothing and the site does not sell it (THE-224
 * withdrew the card in harvest-presentation-site).
 *
 * 🔴 NOTHING HERE CHANGES BEHAVIOUR. `aiChat` is untouched on every tier, the
 * Telegram flag stays false, and no price moves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SUPERSEDED IN PART BY THE-253 — READ THIS BEFORE TRUSTING THE PROSE ABOVE.
 *
 * THE-253 built the thing this file said had not been built. The AI Assistant
 * add-on now lifts `aiChat` AND `aiKnowledge` in `getEffectiveFeatures`, so
 * buying it grants the RAG capability instead of an unread count. Three
 * assertions below are INVERTED from what THE-224 shipped, each marked at its
 * own site, and that inversion is what the header above asked for: "if someone
 * later makes the add-on mean something, these tests are what will fail and say
 * so, and the add-on becomes real."
 *
 * WHAT STILL STANDS, unchanged and still pinned here:
 *   · There is still NO SEAT. Nothing meters per add-on quantity; the add-on
 *     is a capability, not an allowance. This is the file's real deliverable
 *     and it is untouched.
 *   · The two usage limits still bind, and neither is purchasable.
 *
 * ⚠️ AND THREE MORE INVERTED BY THE SECOND HALF OF THE-253, which deleted the
 * Telegram assistant outright and took the chat off every plan:
 *   · `aiChat` was false/false/true/true; it is false on all four now. The
 *     founder's observation — Small Team had the assistant having bought
 *     nothing — was TRUE WHEN MADE and is now false BY DESIGN: that inclusion
 *     is exactly what was sold separately.
 *   · The `aiAssistant` COUNT is gone from `PlanFeatures` entirely, so "what
 *     the add-on moves is a count nothing reads" has no subject left.
 *   · `AI_TELEGRAM_ASSISTANT_ENABLED` is gone: not false, absent.
 *
 * The new entitlement's own tests live in `the-253-ai-chat-addon.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════ */

const PLANS: TenantPlan[] = ['free', 'plus', 'pro', 'max'];

const srcOf = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ── 1 ─────────────────────────────────────────────────────────────────────── */
describe('aiChat is on no tier at all', () => {
  it('is false across free / Individual / Small Team / Ministry', () => {
    /* WAS `[false, false, true, true]`, under the heading "aiChat is unchanged
       on every tier" and called THE-224's non-negotiable: the founder's report
       was about the add-on, not the capability, and the capability was correct
       as it stood.
       🔴 THE-253 INVERTS IT ON FOUNDER DIRECTION — "NO PLAN HAS ANY AI RAG
       CHAT ... if we sell it as an add-on". The two `true`s were the reason the
       $20 card charged Small Team and Ministry for what they already had. */
    expect(PLANS.map((p) => getPlanFeatures(p).aiChat)).toEqual([false, false, false, false]);
    expect(PLAN_ORDER).toEqual(PLANS);
  });

  it('reads the same through `hasFeature` and through the effective-features path', () => {
    // Three doors onto one cell. A change that moved `aiChat` while leaving the
    // matrix alone — a gate reading the wrong function, an add-on layering over
    // it — would show up as a disagreement between these.
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan).aiChat;
      expect(hasFeature(plan, 'aiChat')).toBe(base);
      expect(getEffectiveFeatures(plan, NO_ADDONS).aiChat).toBe(base);
      expect(getEffectiveFeatures(plan, null).aiChat).toBe(base);
    }
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────── */
describe('the assistant is available to NO tier without the add-on', () => {
  it('the founder\u2019s observation was true when made, and is now the thing that was fixed', () => {
    /* WAS 'the founder was right: Small Team gets it having bought nothing',
       pinning `aiChat` true on pro and max against the empty add-on set — the
       observation that opened THE-224, pinned as CORRECT rather than fixed.
       🔴 IT IS NOW THE DEFECT. Selling the chat as an add-on while two tiers
       included it free is the false claim; THE-253 removed the inclusion, so
       the same call with the same empty set answers false everywhere. */
    expect(NO_ADDONS.aiAssistant).toBe(0);
    expect(getEffectiveFeatures('pro', NO_ADDONS).aiChat).toBe(false);
    expect(getEffectiveFeatures('max', NO_ADDONS).aiChat).toBe(false);
  });

  it('🔴 SUPERSEDED BY THE-253 — buying the add-on now DOES turn it on', () => {
    /* ⚠️ THIS ASSERTION IS INVERTED FROM WHAT THE-224 SHIPPED, and the header of
       this file is what asked for that: "if someone later makes the add-on mean
       something, these tests are what will fail and say so, and the add-on
       becomes real". THE-253 built it. The add-on that raised an unread count
       now lifts the capability itself.

       What THE-224 asserted here, kept as the thing that CHANGED: on every
       tier, holding any quantity left `aiChat` exactly where the tier put it —
       so the purchase was redundant on Small Team and Ministry and inert on
       free and Individual. Both halves are now false, and deliberately. */
    for (const plan of PLANS) {
      for (const quantity of [1, 2, 25]) {
        const bought = getEffectiveFeatures(plan, { ...NO_ADDONS, aiAssistant: quantity });
        expect(bought.aiChat, `${plan}: ${quantity} add-on(s) left aiChat off`).toBe(true);
        // Both halves of the RAG capability, for the reason given at
        // `getEffectiveFeatures`: a chat with no fillable knowledge base can
        // only ever answer "I don't have that".
        expect(bought.aiKnowledge, `${plan}: ${quantity} add-on(s) left aiKnowledge off`).toBe(true);
      }
    }
  });

  it('and owning NOTHING still leaves every tier exactly where it was', () => {
    /* 🔴 THE HALF OF THE-224 THAT STANDS. The founder's observation was that
       Small Team had the assistant having bought nothing, and that is still
       correct and still pinned: THE-253 changed what OWNING the add-on does,
       and changed no tier. */
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      expect(getEffectiveFeatures(plan, NO_ADDONS).aiChat).toBe(base.aiChat);
      expect(getEffectiveFeatures(plan, NO_ADDONS).aiKnowledge).toBe(base.aiKnowledge);
    }
    expect(PLANS.map((p) => getPlanFeatures(p).aiChat)).toEqual([false, false, false, false]);
  });

  it('the count the add-on used to move does not exist any more', () => {
    /* WAS 'what the add-on DOES move is a count nothing reads', which asserted
       `raiseCap` really raised `features.aiAssistant` by the owned quantity and
       pinned the per-tier counts at [0, 0, 0, 1] behind a false Telegram flag.
       Its point was that the add-on was not inert but UNREAD — worse, because
       money changed hands and no gate noticed.
       🔴 THE-253 REMOVED THE CELL RATHER THAN THE COMPLAINT. There is no count
       to raise and no flag to be false; what the purchase moves is asserted
       directly above, as the capability. */
    expect('aiAssistant' in getPlanFeatures('max')).toBe(false);
    for (const plan of PLANS) {
      expect('aiAssistant' in getEffectiveFeatures(plan, { ...NO_ADDONS, aiAssistant: 3 })).toBe(false);
    }
    // 🔴 THE ADD-ON QUANTITY IS A DIFFERENT FIELD AND IS STILL LIVE. It is what
    // the Dodo webhook writes and what lifts the capability; only the PLAN cell
    // that shared its name is gone.
    expect(NO_ADDONS).toHaveProperty('aiAssistant');
  });

  it('an add-on now moves two feature flags as well as three capacities', () => {
    /* ⚠️ THE-224 ASSERTED THE OPPOSITE HERE — "an add-on raises a capacity and
       never a feature flag" — and called that the structural reason the sale
       could not be made real by a copy fix. It was correct, and it was the
       defect: the rule is what made the $20/mo purchase inert. THE-253 moved
       exactly two booleans and no others.

       The guard survives its inversion: still asserted over the WHOLE feature
       object, so an unexpected moved cell cannot appear silently. It was six
       cells, then five — `aiAssistant` was deleted with the Telegram assistant —
       and is now THREE: THE-370 retired the contact-pack and campus add-ons, so
       `maxContacts` and `maxChurches` no longer move for anyone. `maxAdmins` is
       the one capacity cell an add-on still raises. */
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      const loaded = getEffectiveFeatures(plan, {
        aiAssistant: 2, adminSeats: 2, unlimitedContacts: false,
      });
      const cells = base as unknown as Record<string, unknown>;
      const after = loaded as unknown as Record<string, unknown>;
      const moved = Object.keys(cells).filter((k) => cells[k] !== after[k]);
      // Only the cells the tier did not already carry show up as MOVED. When
      // THE-224 wrote this, Small Team and Ministry already had both booleans
      // on and a lift that changed nothing was not a move; now no tier does.
      // No tier carries either boolean now, so both always move — the `if`s
      // are kept so this reads the matrix rather than assuming it.
      const expected = ['maxAdmins'];
      if (!base.aiChat) expected.push('aiChat');
      if (!base.aiKnowledge) expected.push('aiKnowledge');
      expect(moved.sort()).toEqual(expected.sort());
      for (const key of moved) {
        const kind = key === 'aiChat' || key === 'aiKnowledge' ? 'boolean' : 'number';
        expect(typeof cells[key], `${key} is not a ${kind}`).toBe(kind);
      }
    }
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────── */
describe('nothing enforces a per-seat AI limit', () => {
  it('no module compares usage against the `aiAssistant` count', () => {
    /* 🔴 THE DELIVERABLE, AND IT SURVIVES THE-253 INTACT. The two modules that
       meter AI use are the RAG usage ledger and the chat route, and neither
       reads the `aiAssistant` COUNT — so there is still no seat, and nothing
       meters per seat. THE-253 made the add-on grant a CAPABILITY (a boolean,
       checked once before the call) and not an allowance; "how many did you
       buy" remains a question nothing asks.

       ⚠️ THE SECOND HALF OF THIS ASSERTION HAD TO CHANGE. It used to require
       that neither module touch the feature matrix AT ALL, which was true when
       the chat was a plan capability nobody had to check at request time. The
       chat is now an add-on, so the route MUST ask whether this tenant holds it
       — see the entitlement gate in the route — and asking is the fix, not a
       regression. What is still forbidden is the ledger learning about plans,
       and the route reading the TIER instead of the TENANT. */
    for (const rel of ['../../lib/rag-usage.ts', '../../app/api/gemini/route.ts']) {
      const src = srcOf(rel);
      expect(src, `${rel} reads the aiAssistant cell`).not.toMatch(/\baiAssistant\b/);
    }
    // The ledger still knows nothing about the matrix: the cap it enforces is
    // the tier's, flat, and no add-on raises it.
    expect(srcOf('../../lib/rag-usage.ts'), 'the usage ledger reads the feature matrix')
      .not.toMatch(/getPlanFeatures|getEffectiveFeatures|tenantFeatures/);
    // 🔴 And the route asks the TENANT question. `getPlanFeatures(` here would
    // refuse exactly the churches that bought the add-on.
    const route = srcOf('../../app/api/gemini/route.ts');
    expect(route, 'the chat route does not check entitlement at all').toMatch(/tenantFeaturesById\(/);
    expect(route, 'the chat route gates on the bare tier matrix').not.toMatch(/getPlanFeatures\s*\(/);
  });

  it('the budget that binds is per TENANT and per MONTH, not per seat', () => {
    /* `queryTokensPerMonth` is the real ceiling. It is keyed on tenantId, it
       comes from the tier alone, and no add-on raises it — which is what makes
       "a token top-up" a genuine product to build and not a copy change. */
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual([...PLANS].sort());
    expect(PLANS.map((p) => PLAN_LIMITS[p].queryTokensPerMonth))
      .toEqual([0, 2_000_000, 10_000_000, 50_000_000]);

    const usage = srcOf('../../lib/rag-usage.ts');
    expect(usage).toMatch(/checkQueryBudget\(tenantId: string/);
    expect(usage).toMatch(/queryTokensPerMonth: cap/);
    // No add-on layering anywhere in the ledger: the cap is the tier's, flat.
    expect(usage).not.toMatch(/NO_ADDONS|readTenantAddons|raiseCap/);
  });

  it('the per-user throttle is a flat constant, identical on every plan', () => {
    /* ⚠️ THE ONE THING THAT IS PER USER, AND IT IS STILL NOT A SEAT. The chat
       route throttles each authenticated uid — ten answers, three redirects,
       then a cooldown — and that IS per person. But the numbers are module
       constants: they are not read from the plan, not raised by an add-on, and
       identical for every user of every tenant. Nobody can buy a bigger one, so
       nothing is being sold when a "seat" is sold.

       This is drift from the ticket, which described the monthly token cap as
       the only budget that binds. There are two. Neither is purchasable. */
    const route = srcOf('../../app/api/gemini/route.ts');
    expect(route).toMatch(/const FREE_MESSAGES = 10;/);
    expect(route).toMatch(/const REDIRECT_MESSAGES = 3;/);
    expect(route).toMatch(/const COOLDOWN_HOURS = 3;/);
    // Keyed on the uid, and the state lives in a collection with no plan in it.
    expect(route).toMatch(/collection\('chat_usage'\)\.doc\(user\.uid\)/);
    // The constants are never recomputed from anything.
    expect(route).not.toMatch(/FREE_MESSAGES\s*=[^;]*(plan|features|addon)/i);
  });

  it('no Telegram assistant remains — flag, section, count and pricing constant', () => {
    /* WAS 'the `aiAssistant` wiring is left intact for a retired product, and
       stays hidden': it asserted the literal
       `export const AI_TELEGRAM_ASSISTANT_ENABLED = false;` was present in the
       source, on the reasoning that keeping the wiring was fine so long as
       nothing sold against it.
       🔴 THE-253 DELETED IT ON FOUNDER DIRECTION. "Hidden" outlived its use:
       the flag had been false since THE-224, every surface behind it was dead,
       and the $200 price it guarded was ten times the live product's. Absence,
       not falsity, is now the assertion — and it is checked against the FILES
       rather than by importing what no longer exports. */
    // The DECLARATIONS, not any mention: the file explains at each old site
    // what was removed and why, and a test that banned the words outright would
    // force those notes out — the one direction this codebase must not move.
    const features = srcOf('../plan-features.ts');
    expect(features).not.toMatch(/export\s+const\s+AI_TELEGRAM_ASSISTANT_ENABLED/);
    expect(features).not.toMatch(/export\s+const\s+AI_ASSISTANT_ADDON_PRICING/);
    // The plan CELL, gone from the interface and from all four tiers.
    for (const plan of PLANS) {
      expect('aiAssistant' in getPlanFeatures(plan), `${plan} still has the count`).toBe(false);
    }
    // The settings section, the standalone page and the Telegram-only routes.
    for (const rel of [
      '../../components/settings/AiAssistantSection.tsx',
      '../../app/ai-assistant/page.tsx',
      '../../app/api/ai-assistant/route.ts',
      '../../app/api/stripe/standalone-checkout/route.ts',
    ]) {
      expect(
        existsSync(fileURLToPath(new URL(rel, import.meta.url))),
        `${rel} still exists`,
      ).toBe(false);
    }
    // And the retired Stripe prices it billed on — the declarations, for the
    // same reason as above: billing.ts records what it dropped and why.
    expect(srcOf('../../lib/billing.ts'))
      .not.toMatch(/export\s+const\s+AI_ASSISTANT_(MONTHLY|SETUP)/);
  });
});
