import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_TELEGRAM_ASSISTANT_ENABLED,
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
 * Telegram flag stays false, and no price moves. */

const PLANS: TenantPlan[] = ['free', 'plus', 'pro', 'max'];

const srcOf = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ── 1 ─────────────────────────────────────────────────────────────────────── */
describe('aiChat is unchanged on every tier', () => {
  it('is false, false, true, true across free / Individual / Small Team / Ministry', () => {
    // 🔴 THE NON-NEGOTIABLE OF THIS TICKET. The founder's report was about the
    // add-on, not the capability, and the capability is correct as it stands.
    expect(PLANS.map((p) => getPlanFeatures(p).aiChat)).toEqual([false, false, true, true]);
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
describe('the assistant is available from Small Team up without any add-on', () => {
  it('the founder was right: Small Team gets it having bought nothing', () => {
    /* 🔴 THE OBSERVATION THAT OPENED THE TICKET, PINNED AS CORRECT RATHER THAN
       FIXED. `NO_ADDONS` is the empty add-on set — every count zero — and the
       assistant is on regardless. Nothing was mis-sold to this founder; the
       add-on was simply never what turned it on. */
    expect(NO_ADDONS.aiAssistant).toBe(0);
    expect(getEffectiveFeatures('pro', NO_ADDONS).aiChat).toBe(true);
    expect(getEffectiveFeatures('max', NO_ADDONS).aiChat).toBe(true);
  });

  it('and buying the add-on turns it on for nobody it was not already on for', () => {
    /* 🔴 THE WHOLE CASE FOR WITHDRAWAL, IN ONE ASSERTION. On EVERY tier, holding
       any quantity of the add-on leaves `aiChat` exactly where the tier put it.
       On Small Team and Ministry the purchase is redundant; on free and
       Individual it does not switch the assistant on, so it is not the "sell it
       to the tiers that lack it" product either. That option is a BUILD — an
       add-on that flips a feature flag — and THE-224 did not build it. */
    for (const plan of PLANS) {
      const included = getPlanFeatures(plan).aiChat;
      for (const quantity of [1, 2, 25]) {
        const bought = getEffectiveFeatures(plan, { ...NO_ADDONS, aiAssistant: quantity });
        expect(bought.aiChat, `${plan}: ${quantity} add-on(s) moved aiChat`).toBe(included);
      }
    }
  });

  it('what the add-on DOES move is a count nothing reads', () => {
    // It is not inert — `raiseCap` really does raise it. It is unread, which is
    // a different and worse thing: the money changes hands and no gate notices.
    expect(getEffectiveFeatures('plus', { ...NO_ADDONS, aiAssistant: 3 }).aiAssistant).toBe(
      getPlanFeatures('plus').aiAssistant + 3,
    );
    // And the count itself is the retired Telegram product's, behind a false flag.
    expect(AI_TELEGRAM_ASSISTANT_ENABLED).toBe(false);
    expect(PLANS.map((p) => getPlanFeatures(p).aiAssistant)).toEqual([0, 0, 0, 1]);
  });

  it('an add-on raises a capacity and never a feature flag', () => {
    /* The structural reason option C would be a build rather than a copy fix.
       `getEffectiveFeatures` overrides exactly four caps plus `unlimitedContacts`;
       every boolean comes through untouched from the tier. Asserted over the
       whole feature object so a fifth override cannot be added silently. */
    for (const plan of PLANS) {
      const base = getPlanFeatures(plan);
      const loaded = getEffectiveFeatures(plan, {
        aiAssistant: 2, adminSeats: 2, contactPacks: 2, campuses: 2, unlimitedContacts: false,
      });
      const cells = base as unknown as Record<string, unknown>;
      const after = loaded as unknown as Record<string, unknown>;
      const moved = Object.keys(cells).filter((k) => cells[k] !== after[k]);
      expect(moved.sort()).toEqual(['aiAssistant', 'maxAdmins', 'maxChurches', 'maxContacts']);
      for (const key of moved) {
        expect(typeof cells[key], `${key} is not a count`).toBe('number');
      }
    }
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────── */
describe('nothing enforces a per-seat AI limit', () => {
  it('no module compares usage against the `aiAssistant` count', () => {
    /* 🔴 THE DELIVERABLE, ASSERTED RATHER THAN ASSERTED-ABOUT. The two modules
       that meter AI use are the RAG usage ledger and the chat route. Neither
       imports the feature matrix at all, so neither can be reading a seat — the
       absence is structural, not a matter of which comparison was written. */
    for (const rel of ['../../lib/rag-usage.ts', '../../app/api/gemini/route.ts']) {
      const src = srcOf(rel);
      expect(src, `${rel} reads the aiAssistant cell`).not.toMatch(/\baiAssistant\b/);
      expect(src, `${rel} reads the feature matrix`).not.toMatch(/getPlanFeatures|getEffectiveFeatures/);
    }
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

  it('the `aiAssistant` wiring is left intact for a retired product, and stays hidden', () => {
    // The comment at the flag says the wiring is deliberately kept so the
    // Telegram assistant can come back. That is fine — what is not fine is
    // selling against it. The flag stays false; THE-224 did not flip it.
    const features = srcOf('../plan-features.ts');
    expect(features).toMatch(/export const AI_TELEGRAM_ASSISTANT_ENABLED = false;/);
    expect(AI_TELEGRAM_ASSISTANT_ENABLED).toBe(false);
  });
});
