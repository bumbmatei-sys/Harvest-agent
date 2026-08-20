import { TenantAddons, TenantPlan } from '../types/tenant.types';

export interface PlanFeatures {
  /** Show blog tab in user app + blog management in admin */
  blog: boolean;
  /** Show AI chat in user app */
  aiChat: boolean;
  /** Show AI Knowledge Base in admin */
  aiKnowledge: boolean;
  /** Show church map in user app (pro and above) */
  map: boolean;
  // `churchDirectory` ("global multi-church discovery directory, Ministry only")
  // was removed: it was read nowhere in the app — no gate, route, query or
  // component consulted it (see docs/plan-features-flag-audit.md). It was not
  // redundant with `maxChurches` (that caps a tenant's OWN campuses; this named
  // a cross-tenant browsing capability), it just named a capability that was
  // never built. `ChurchMap` (the member-facing map) is gated by `map` instead,
  // and is not a discovery-across-tenants surface. Same precedent as
  // `customBackground`/`publicCalendar` above: don't re-add it as a plan flag
  // unless a church-directory feature ships with it.
  /** Max number of churches (0 = hidden, -1 = unlimited) */
  maxChurches: number;
  /**
   * Max number of contacts (-1 = unlimited).
   *
   * VALUES ONLY — nothing enforces this yet. No contact cap exists anywhere in
   * the app today; this cell is the published number so the plan matrix, the
   * public /api/plans catalog and the in-app comparison all read from one
   * place instead of a marketing page.
   *
   * It lives here rather than in PLAN_LIMITS (src/lib/planLimits.ts) because
   * PLAN_LIMITS holds METERED flows and stocks — token and segment budgets fed
   * by a per-tenant monthly usage doc. Contacts are a static entity count, the
   * same shape as maxCourses / maxAdmins / maxChurches, so it belongs with
   * them.
   *
   * When enforcement lands it mirrors the `maxCourses` shape below: gated
   * client-side only (bypassable by a direct Firestore write, since
   * firestore.rules does not enforce it — rules-level enforcement is a separate
   * hardening task), blocking new creation only; a tenant already over the
   * limit (e.g. after a downgrade) keeps their existing contacts.
   */
  maxContacts: number;
  /**
   * Max number of courses (-1 = unlimited).
   *
   * Enforced client-side only, mirroring `maxChurches`: AdminCourses gates the
   * "New course" button (fail closed on an unknown/loading plan — falls back
   * to 'plus'). This is bypassable by anyone crafting a Firestore write
   * directly, since firestore.rules does not enforce it — rules-level
   * enforcement is a separate hardening task, not done here. Blocks new
   * creation only; a tenant already over the limit (e.g. after a downgrade)
   * keeps their existing courses.
   */
  maxCourses: number;
  /** Max number of admin accounts (-1 = unlimited) */
  maxAdmins: number;
  /** Allow custom domain (Community / max+) */
  customDomain: boolean;
  /** Allow custom branding — logo, colors, ministry name (Community / max+) */
  customBranding: boolean;
  // `customBackground` ("custom auth-page background image") was removed: no
  // background uploader was ever built anywhere in the app, so the flag sold a
  // capability that does not exist. It was true on exactly the tiers where
  // customBranding is true (at the time, Community/max and the since-deleted
  // Ministry/ultra tier), so dropping it from the Branding-tab gate (see
  // hasBrandingAccess below) changed no tier's access. Don't re-add it as a
  // plan flag unless an uploader ships with it.
  //
  // `publicCalendar` was removed for the same reason, and on the same
  // precedent: no public event-calendar page exists anywhere in the app. It was
  // `true` on every tier, so nothing ever gated on it and removing it changed
  // no tier's access — it only stopped the matrix (and the public /api/plans
  // catalog) advertising a capability that was never built. Don't re-add it
  // unless a calendar ships with it.
  /** Newsletter (manual + Mailchimp) — Small Team / pro+ */
  newsletterAutomation: boolean;
  /** AI-generated newsletter from Instagram (Community / max+) */
  automatedNewsletter: boolean;
  /**
   * SMS: manual broadcasts + automated event-registration/check-in/pledge
   * triggers (see AdminSms TRIGGERS; scheduled broadcasts and other triggers
   * are not promised).
   *
   * `true` on EVERY tier, deliberately. SMS is no longer sold by plan: Harvest
   * does not offer platform SMS at all, so the only thing deciding whether a
   * tenant can send is whether they have connected their OWN Twilio
   * credentials. A plan cell gating a capability the plan does not supply
   * gates nothing.
   *
   * This also retires a live bug: plus/pro/max each carried a monthly Twilio
   * segment budget in PLAN_LIMITS while this cell was `false` — three tiers
   * metered for a feature they could not reach. Those budgets are now `null`
   * (unmetered); see src/lib/planLimits.ts.
   */
  smsAutomation: boolean;
  /** Number of AI assistants (0 = none, 1 = one, -1 = unlimited) */
  aiAssistant: number;
  /** Fundraising campaigns feature */
  fundraising: boolean;
  /** Event registration integration */
  eventRegistration: boolean;
  /** Docs / TipTap notes integration (Small Team / pro+) */
  docs: boolean;
  /** CRM for donors and members (Small Team / pro+) */
  crm: boolean;
  /** Accounting tools integration */
  accountingTools: boolean;
  /** Tax receipt generation */
  taxReceipt: boolean;
  /** Community groups — private channels + DMs (Community / max+) */
  communityGroups: boolean;
  /** Custom forms → CRM pipeline (Community / max+) */
  customForms: boolean;
  /** Check-in system with QR attendance (Small Team / pro+) */
  checkInSystem: boolean;
  /** Livestream + live giving (Small Team / pro+) */
  livestream: boolean;
  /** Sermon notes shared to livestream (viewer read-only panel) */
  sermonNotes: boolean;
  /** AI-generated SEO blog articles on schedule from Knowledge Base */
  automatedBlog: boolean;
  /** Annual giving statements (year-end tax summaries) — Ministry / max+ */
  givingStatements: boolean;
  /** Pledge campaigns — Ministry (max) and above */
  pledgeCampaigns: boolean;
  /**
   * Text-to-Give via inbound SMS keyword (`AdminSms.tsx`'s Text-to-Give panel,
   * served by `app/api/sms/incoming/route.ts`).
   *
   * `true` on EVERY tier, deliberately, and read by nothing — same shape and
   * same reasoning as `smsAutomation` above. The feature is fully built and
   * live, but access is decided per-tenant by whether they connected their OWN
   * Twilio credentials (see `src/lib/twilio.ts`), not by plan. Kept (not
   * deleted, unlike the removed `churchDirectory`) because it documents a real,
   * shipped capability rather than one that was never built — deleting it would
   * make the matrix a worse description of the product, not a more accurate
   * one. Don't gate anything on this cell; gate on the tenant's Twilio
   * connection instead.
   */
  textToGive: boolean;
  /** Installable Progressive Web App (mobile app) — all plans */
  pwaApp: boolean;
  // `donationRetention` ("percentage of a donation the ministry keeps") was
  // removed with the move to a flat 0% platform fee on every tier. It was a
  // hand-maintained complement of PLATFORM_FEE_MAP (`100 - fee * 100`), and
  // that duplication is what once let the app advertise "keeps 100%" while
  // actually charging 2.5%. With PLATFORM_FEE_MAP now { plus: 0, pro: 0,
  // max: 0 } the field is a constant 100 on every tier — it carries no
  // information and can only drift again. Read PLATFORM_FEE_MAP
  // (src/lib/stripe-connect.ts) directly; it is the rate actually charged.
}

// ─── Feature matrix ───────────────────────────────────────────────────────────
//
// IMPORTANT: this matrix must match the pricing table on theharvest.site.
// If you change any cell, update the marketing site copy too — or switch the
// marketing site to consume /api/plans so they can never drift again.
// The contract test in __tests__/plan-features.test.ts will fail CI if this
// matrix changes without an explicit update to that test.

const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  // Individual — $49/mo
  plus: {
    blog: true,
    // AI chat is available on Small Team (pro) and above; gated to match the pricing page.
    aiChat: false,
    aiKnowledge: false,
    map: false,
    maxChurches: 1,
    maxContacts: 150,
    maxCourses: 2,
    maxAdmins: 2,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: false,
    automatedNewsletter: false,
    // SMS is BYO-only on every tier — see the block comment above `smsAutomation`
    // in PlanFeatures. Platform SMS is not sold, so the plan no longer gates it.
    smsAutomation: true,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: false,
    docs: false,
    // CRM is on EVERY tier, Individual included. A $49 church has members to
    // keep track of, and shipping the cheapest plan without a roster left it no
    // way to see who they are.
    //
    // VISIBILITY ONLY, exactly as the note on `pro` below describes: no rule,
    // route or query keys off this cell. Firestore scopes `contacts` and
    // `contactActivities` on the `manageCRM` permission and `isTenantAdmin`, not
    // on plan; both /api/crm routes gate the same way and import nothing from
    // this module. So this widens what the tier ADVERTISES and which nav entry
    // renders — it does not widen who may read a contact.
    //
    // `maxContacts` (150 here) is what scopes it, and is enforced separately.
    crm: true,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: false,
    livestream: false,
    sermonNotes: false,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    textToGive: true,
    pwaApp: true,
  },
  // Small Team — $99/mo
  pro: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    maxChurches: 1,
    maxContacts: 500,
    maxCourses: 5,
    maxAdmins: 5,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: true,
    automatedNewsletter: false,
    smsAutomation: true,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: false,
    // Moved down from the top tier in an earlier repricing: Small Team carries
    // Notes/Docs, Check-In, Livestream and Sermon Notes. CRM moved further still
    // and is now on every tier, Individual included — see the note on `plus`
    // above; `pro` is no longer its floor. Visibility only — no rule, route or
    // query keys off these cells (CRM's Firestore rules scope on the `manageCRM`
    // permission, not on plan).
    docs: true,
    crm: true,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    textToGive: true,
    pwaApp: true,
  },
  // Ministry — $199/mo. The top tier.
  //
  // Absorbed the deleted `ultra` tier: accountingTools and aiAssistant: 1
  // folded in here. `maxChurches` deliberately did NOT inherit ultra's -1 —
  // every tier is capped at 1 campus and additional campuses become a paid
  // add-on. Ultra's third folded-in cell, `churchDirectory`, was later removed
  // entirely — see the comment on its old declaration site above `maxChurches`
  // in the PlanFeatures interface.
  max: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    maxChurches: 1,
    maxContacts: 2_000,
    maxCourses: 15,
    maxAdmins: 15,
    customDomain: true,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    smsAutomation: true,
    aiAssistant: 1,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    pledgeCampaigns: true,
    textToGive: true,
    pwaApp: true,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/**
 * The billing terms a church can buy a plan on. Order is cheapest-commitment
 * first, and it is the order every term picker renders in.
 *
 * ⚠️ CROSS-REPO VOCABULARY. Dodo's catalogue says `annual` where this app says
 * `yearly`; the reconciliation lives in src/lib/dodo/catalogue.ts and nowhere
 * else. Quarterly needs no reconciliation — Dodo bills it as
 * `payment_frequency_count: 3, interval: Month`, and "quarterly" is this app's
 * word for that.
 */
export const BILLING_TERMS = ['monthly', 'quarterly', 'yearly'] as const;

export type BillingTerm = (typeof BILLING_TERMS)[number];

/**
 * Months of service ONE charge on a term buys.
 *
 * This is what makes a saving computable at all: a term's real discount is its
 * price against `monthly × TERM_MONTHS[term]`, which is what the same service
 * would have cost bought a month at a time.
 */
export const TERM_MONTHS: Readonly<Record<BillingTerm, number>> = Object.freeze({
  monthly: 1,
  quarterly: 3,
  yearly: 12,
});

/**
 * Base plan pricing in USD — the STORED TABLE. Nine numbers, one per
 * (tier, term), and every plan price in this app is one of these nine.
 *
 * ─── Why this is a table and no longer a multiplier ──────────────────────────
 *
 * This used to be `ANNUAL_BILLED_MONTHS = 9` — "pay 9 months, get 12", which is
 * exactly 25% — with `yearlyUsd` derived from it. That abstraction is GONE and
 * must not come back, because the discounts it has to express no longer divide
 * into whole months: 30% off a year is ×8.4 months and 15% off a quarter is
 * ×2.55 months. There is no integer to name.
 *
 * The founder chose ROUNDED PRICES OVER EXACT PERCENTAGES, deliberately:
 * $405.45 on a pricing page reads like a spreadsheet error. So the prices are
 * the primitive and the percentages fall out of them, rather than the other way
 * round. The savings these nine numbers actually produce are:
 *
 *              Quarterly   Yearly
 *   Individual    15.4%     29.7%
 *   Small Team    16.0%     30.5%
 *   Ministry      16.4%     30.3%
 *
 * 🔴 DO NOT COMPUTE A BADGE FROM THIS TABLE. See `ADVERTISED_DISCOUNT_PCT`.
 *
 * ⚠️ CROSS-REPO: the marketing site (harvest-presentation-site) carries its own
 * copy of these nine numbers in src/components/Pricing.tsx, and a module-scope
 * contract there compares the TABLE — tier by tier, term by term — against the
 * numbers this file publishes. The two repos cannot share code, so changing a
 * price here means changing it there IN THE SAME BREATH or the site's build
 * fails and names the disagreement.
 */
export const PLAN_PRICING: Readonly<Record<TenantPlan, Readonly<Record<BillingTerm, number>>>> =
  Object.freeze({
    plus: Object.freeze({ monthly: 39,  quarterly: 99,  yearly: 329  }),
    pro:  Object.freeze({ monthly: 79,  quarterly: 199, yearly: 659  }),
    max:  Object.freeze({ monthly: 159, quarterly: 399, yearly: 1329 }),
  });

/** What Dodo charges for `plan` on `term`, in whole USD. The one read. */
export function planPriceUsd(plan: TenantPlan, term: BillingTerm): number {
  return PLAN_PRICING[plan][term];
}

/**
 * What a term works out to per month, exactly, unrounded. The arithmetic only —
 * nothing renders this. It is the reference the displayed figure is checked
 * against.
 */
export function planTermMonthlyExact(plan: TenantPlan, term: BillingTerm): number {
  return planPriceUsd(plan, term) / TERM_MONTHS[term];
}

/**
 * The per-month figure a card HEADLINES, as a number, CEILED AT THE CENT.
 *
 * ─── 🔴 WHY CEILING, AND WHY AT THE CENT (THE-196) ───────────────────────────
 *
 * This was `Math.round(price / months)` while it was a secondary line, and that
 * was defensible there: the charged total sat beside it in the same sentence,
 * so a dollar of rounding either way could not be mistaken for a bill.
 *
 * THE-196 makes it the headline — the biggest number on the card, the one a
 * church reads as "what this costs me". Rounding to nearest then becomes a
 * claim, and on two of the six discounted cells it is a claim that is too low:
 *
 *     Individual yearly    $329/12 = $27.4167  →  round = $27  → implies $324
 *     Small Team quarterly $199/3  = $66.3333  →  round = $66  → implies $198
 *
 * A church reading "$27/mo" reasonably expects $324 a year and is charged $329.
 * That is the whole of this ticket, and it is a pricing misrepresentation
 * rather than a rounding preference. (The brief named the Individual yearly
 * cell; Small Team quarterly understates too, by $1.)
 *
 * So the headline must never imply less than the charged total. Two roundings
 * satisfy that, and the choice between them is not aesthetic:
 *
 *   CEIL TO THE DOLLAR — $28, $55, $111 yearly. Clean, never understates, but
 *     $28 x 12 = $336 against a charged $329. The headline and the line
 *     directly beneath it would then disagree by $7, and a church that
 *     multiplies the one to check the other finds they do not reconcile. The
 *     fix for a card whose two numbers contradict each other cannot be a card
 *     whose two numbers contradict each other by a different amount.
 *
 *   CEIL TO THE CENT — $27.42, $54.92, $110.75. Never understates (the ceiling
 *     guarantees it) and reconciles: x12 lands within four cents of the charged
 *     total, which is the rounding itself and nothing else.
 *
 * The cent it is. `$27.42` is two characters uglier than `$28` and it is the
 * only figure on the card that is actually true.
 *
 * ⚠️ An exact division keeps its whole-dollar form — $99/3 is $33.00 and prints
 * as `$33`, not `$33.00`. See `formatPlanMonthlyHeadline`.
 *
 * The `toFixed(6)` before the ceiling is not decoration. `Math.ceil` on a
 * binary-float product turns an exact $33.00 into $33.01 the moment the
 * division lands a hair above the integer, which is precisely the direction
 * this function must not drift.
 */
export function ceilToCent(exact: number): number {
  const cents = Number((exact * 100).toFixed(6));
  return Math.ceil(cents) / 100;
}

export function planTermMonthlyDisplayed(plan: TenantPlan, term: BillingTerm): number {
  return ceilToCent(planTermMonthlyExact(plan, term));
}

/**
 * The headline string — `$27.42`, `$33`, `$159`. Carries no period suffix; the
 * card writes `/mo` beside it, the same split `formatPlanPrice` gets.
 */
export function formatPlanMonthlyHeadline(plan: TenantPlan, term: BillingTerm): string {
  const v = planTermMonthlyDisplayed(plan, term);
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 🔴 THE HONESTY GUARD. Runs at module scope, below.
 *
 * For every tier and every term, the headline figure multiplied back out by the
 * months in the term must not come to LESS than what Dodo actually charges.
 * Equal is fine, a few cents over is the ceiling doing its job, under is a
 * price the product advertises and does not honour.
 *
 * This is deliberately stated as the invariant rather than as the six expected
 * strings: a table of expected figures goes stale with the prices, and the
 * thing that must stay true is not "the Individual yearly headline is $27.42",
 * it is "no headline promises less than the bill".
 *
 * ⚠️ IT TAKES THE ROUNDING RULE AS AN ARGUMENT, and that is the whole point.
 * Checked against `ceilToCent` alone it could never fail — a ceiling cannot
 * round down, so the assertion would be true by construction and would guard
 * nothing. What can actually regress is the RULE: someone restores
 * `Math.round` here, or "tidies" the cents away to whole dollars. Passing the
 * rule in means the contract is a statement about the rule, and swapping in
 * the old `Math.round` makes it throw and names the tier it lied about. The
 * module-scope call below binds it to the rule the cards actually render.
 */
export function monthlyHeadlineContract(
  round: (exact: number) => number = ceilToCent,
  pricing: Readonly<Record<TenantPlan, Readonly<Record<BillingTerm, number>>>> = PLAN_PRICING,
): void {
  // Keys off the pricing table rather than PLAN_ORDER: this runs at module
  // scope and PLAN_ORDER is declared several hundred lines further down, so
  // naming it here is a temporal-dead-zone crash on import rather than a guard.
  for (const plan of Object.keys(pricing) as TenantPlan[]) {
    for (const term of BILLING_TERMS) {
      const charged = pricing[plan][term];
      const months = TERM_MONTHS[term];
      const displayed = round(charged / months);
      const implied = displayed * months;
      if (implied < charged - 1e-9) {
        throw new Error(
          `Plan pricing: the ${plan} ${term} headline of $${displayed}/mo implies ` +
            `$${implied.toFixed(2)} over ${months} months, but Dodo charges $${charged}. ` +
            `A headline may never promise less than the bill.`,
        );
      }
    }
  }
}

monthlyHeadlineContract();

/**
 * What `plan` on `term` actually saves against paying monthly, as an exact
 * percentage. Used by the honesty guard below, NOT by any badge.
 */
export function actualSavingPct(plan: TenantPlan, term: BillingTerm): number {
  const atMonthlyRate = planPriceUsd(plan, 'monthly') * TERM_MONTHS[term];
  if (atMonthlyRate === 0) return 0;
  return (1 - planPriceUsd(plan, term) / atMonthlyRate) * 100;
}

/** The two terms that carry a discount — every term except the monthly base. */
export const DISCOUNTED_TERMS = BILLING_TERMS.filter((t) => t !== 'monthly');

export type DiscountedTerm = Exclude<BillingTerm, 'monthly'>;

/**
 * The percentages the product ADVERTISES. Stored, deliberately.
 *
 * 🔴 NOT COMPUTED FROM `PLAN_PRICING`, and this is the whole point. Rounded
 * prices produce a different real saving on every tier — 15.4 / 16.0 / 16.4 on
 * quarterly — so a computed badge would read "16%" beside the Ministry card and
 * "15%" beside the Individual one, on a toggle that sits above all three at
 * once. One number for the toggle is the only honest presentation, and one
 * number cannot be derived from three.
 */
export const ADVERTISED_DISCOUNT_PCT: Readonly<Record<DiscountedTerm, number>> = Object.freeze({
  quarterly: 15,
  yearly: 30,
});

/**
 * How a term's advertised percentage may be WORDED — derived, never typed.
 *
 * ⚠️ THE HONESTY RULE: no copy may claim a saving larger than the smallest
 * actual one. A flat "save 30%" is a claim about every tier, so it is only true
 * when the WORST tier saves at least 30%.
 *
 *   quarterly  advertises 15, worst tier saves 15.4  → 'flat'  → "Save 15%"
 *   yearly     advertises 30, worst tier saves 29.7  → 'upTo'  → "Save up to 30%"
 *
 * 🔴 Yearly is the case this derivation exists for. The brief that set these
 * prices asserted 15% and 30% were both safe; 30 is not — Individual saves
 * 29.70%, three tenths of a point short — so a flat "save 30%" overstates what
 * the cheapest tier actually saves. "Up to" is true of every tier (the best is
 * 30.5%) and keeps 30 on the badge, which is what was actually wanted. Nothing
 * here decides the NUMBER; it decides only whether the number can be stated
 * bare, and it decides that from the prices so the copy cannot outlive them.
 */
export type DiscountClaimShape = 'flat' | 'upTo';

/** Every priced tier, read off the table itself. `PLAN_ORDER` is declared far
 *  below this block and referencing it here would be a temporal-dead-zone
 *  error at module load; the table's own keys are the same three tiers. */
const PRICED_PLANS = Object.keys(PLAN_PRICING) as TenantPlan[];

export function discountClaimShape(term: DiscountedTerm): DiscountClaimShape {
  const worst = Math.min(...PRICED_PLANS.map((plan) => actualSavingPct(plan, term)));
  return ADVERTISED_DISCOUNT_PCT[term] <= worst ? 'flat' : 'upTo';
}

/** The advertised saving for a term, in words. The one phrasing, app-wide. */
export function discountClaim(term: DiscountedTerm): string {
  const pct = ADVERTISED_DISCOUNT_PCT[term];
  return discountClaimShape(term) === 'flat' ? `Save ${pct}%` : `Save up to ${pct}%`;
}

/**
 * 🔴 MODULE-SCOPE HONESTY GUARD. An advertised percentage that exceeds what the
 * BEST tier saves is false under any wording — "up to 40%" when nothing reaches
 * 40% is not a hedge, it is a lie — so it fails the build rather than shipping.
 *
 * Deliberately checked here, at the table, and not in a test: the marketing
 * site runs the identical check at module scope during its prerender, and a
 * claim this app cannot make is a claim that site must not print either.
 */
for (const term of DISCOUNTED_TERMS) {
  const best = Math.max(...PRICED_PLANS.map((plan) => actualSavingPct(plan, term)));
  if (ADVERTISED_DISCOUNT_PCT[term] > best) {
    throw new Error(
      `plan-features: ${term} advertises ${ADVERTISED_DISCOUNT_PCT[term]}% off, but the best ` +
      `tier only saves ${best.toFixed(1)}%. No wording makes that true — lower the advertised ` +
      `percentage or reprice PLAN_PRICING.`,
    );
  }
}

// `PLAN_DONATION_RETENTION` was removed alongside the `donationRetention`
// matrix cell it mirrored. It existed to publish `100 - PLATFORM_FEE_MAP[plan]
// * 100` without importing the fee map into the client bundle. Every tier
// now charges a 0% platform fee, so the whole map was the constant 100 —
// nothing to publish, and one more copy of the fee to drift out of sync (which
// it previously did, advertising "keeps 100%" against a real 2.5% charge).
// PLATFORM_FEE_MAP (src/lib/stripe-connect.ts) is the single source for the fee.
// Surfaces that used to render retention now render the FEE — "Donation fee —
// 0%" — which is the number a customer actually cares about.

/** AI Assistant add-on pricing (available on all plans; included on Ministry). */
export const AI_ASSISTANT_ADDON_PRICING = {
  monthlyUsd: 200,
} as const;

/**
 * Master switch for the AI (Telegram) Assistant feature across the whole app.
 * Set to `false` to hide every user-facing surface (settings tab, standalone
 * page, plan-comparison row, /api/plans availability). Backend routes, Stripe
 * wiring and the `aiAssistant` plan flag are intentionally left intact so the
 * feature can be re-enabled by flipping this one boolean back to `true`.
 */
export const AI_TELEGRAM_ASSISTANT_ENABLED = false;

/**
 * Master switch for the affiliate programme across the whole app.
 * Set to `false` to hide every user-facing surface (admin nav entry and the
 * /admin/affiliate section, the standalone affiliate dashboard on
 * affiliate.theharvest.app, the affiliate auth copy, the "Affiliate Program"
 * permission row). Backend routes (/api/affiliate/*), the payout and
 * commission-window libs, the Stripe webhook's commission paths, the
 * `affiliate_commissions` collection and its rules are intentionally left
 * intact so the feature can be re-enabled by flipping this one boolean back to
 * `true`.
 *
 * Hidden because subscription billing is moving from Stripe to Dodo Payments (a
 * merchant of record), which changes the payout rail end to end — affiliate
 * transfers run through Stripe Connect today and that relationship does not
 * survive the move unchanged. A public programme promising 15% of subscription
 * revenue for 12 months, on a payout rail mid-migration, is how you end up owing
 * commission you cannot pay. Migrate billing first, then decide whether to bring
 * it back.
 *
 * NOT a kill switch for referral capture: `?ref=` attribution (ReferralTracker →
 * localStorage['affiliateReferrerId'] → `referrerId` in checkout metadata) runs
 * regardless of this flag, so a link shared before the programme was hidden
 * still attributes if that person signs up afterwards.
 */
export const AFFILIATE_PROGRAM_ENABLED = false;

/**
 * Master switch for Dodo Payments subscription billing.
 *
 * 🔴 TRUE. THE DODO CUTOVER IS ON. Signup goes through Dodo Checkout and the
 * Dodo webhook's `subscription.active` handler is what creates a tenant. This is
 * the highest-risk switch in the project — a broken signup is a broken business,
 * because there is no other way for a church to become a customer.
 *
 * Before this ships anywhere real, #291's acceptance checklist still applies: a
 * sandbox signup run end to end against Dodo, with the resulting SUBSCRIPTION
 * confirmed to carry the checkout metadata provisioning reads (`userId`,
 * `ministryName`, `newTenant`).
 *
 * Rolling back is the same one-line, reviewable change in reverse — set it to
 * `false` and both signup call sites return to Stripe with no other edit.
 *
 * ─── What it does, exactly ───────────────────────────────────────────────────
 *
 *  ON   `SIGNUP_CHECKOUT_ENDPOINT` resolves to `/api/dodo/checkout`, so both
 *       signup call sites (ChurchOnboarding's first attempt and OnboardingGate's
 *       restart) post there. `/api/dodo/checkout` serves the request. The Dodo
 *       webhook's `subscription.active` handler builds the tenant.
 *  OFF  Both call sites resolve to `/api/stripe/checkout` and the Stripe webhook
 *       is again the only thing that creates a tenant — the pre-#290 behaviour,
 *       whole. `/api/dodo/checkout` additionally refuses with 503, so a stale
 *       browser tab holding the previous bundle cannot keep the Dodo path open.
 *
 * ⚠️ THE DODO WEBHOOK DELIBERATELY DOES NOT READ THIS FLAG. It gates whether new
 * Dodo checkouts are CREATED, never whether an already-paid subscription is
 * honoured. A customer who was mid-checkout when the flag was turned off must
 * still get their church; refusing there would take their money and give them
 * nothing.
 *
 * ⚠️ TENANTS PROVISIONED WHILE THIS WAS ON KEEP WORKING WHEN IT GOES OFF. They
 * carry `dodo*` identifiers on `tenant_private` and no Stripe subscription;
 * nothing in the sign-in, roster, rules or admin-area path reads a Stripe id.
 * What degrades is billing MANAGEMENT for those tenants — see the pull request
 * body for the itemised list.
 *
 * Mirrors AI_TELEGRAM_ASSISTANT_ENABLED and AFFILIATE_PROGRAM_ENABLED above in
 * shape only: those two hide features, this one routes money. Donations are
 * unaffected in either direction — giving stays on Stripe Connect at a 0%
 * platform fee (src/lib/stripe-connect.ts) and is not part of this migration.
 */
export const DODO_BILLING_ENABLED = true;

// ─── Accessors ────────────────────────────────────────────────────────────────

/**
 * Get feature flags for a given plan.
 * Defaults to 'plus' if plan is unknown.
 */
export function getPlanFeatures(plan: TenantPlan): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.plus;
}

// ─── Add-ons layered on a plan (REP-5a) ──────────────────────────────────────

/**
 * The sentinel `PlanFeatures`' numeric cells use for "unlimited".
 *
 * Written down here because `getEffectiveFeatures` has to RECOGNISE it: adding
 * capacity to a cell that already means unlimited would turn -1 into a small
 * positive number and silently LOWER the cap. No tier currently carries it —
 * every cap in the matrix above is a real count — so this is a guard against a
 * future matrix change, not a live case. `contact-capacity.ts` and
 * `admin-seats.ts` each export the same value under the name `UNLIMITED` for
 * their own call sites.
 */
export const UNLIMITED_CAP = -1;

/** Contacts one "Contacts +500" pack adds. The pack's whole meaning, once. */
export const CONTACTS_PER_PACK = 500;

/** Owning nothing. The answer for every tenant that predates add-ons. */
export const NO_ADDONS: TenantAddons = Object.freeze({
  aiAssistant: 0,
  adminSeats: 0,
  contactPacks: 0,
  unlimitedContacts: false,
  campuses: 0,
});

/**
 * A plan's features with the tenant's add-ons layered on top.
 *
 * 🔴 `unlimitedContacts` IS A SEPARATE BOOLEAN AND STAYS ONE. It is not folded
 * into `maxContacts`, and that is a decision, not an omission:
 *
 *   • `Infinity` is not storable in Firestore, so it could never round-trip.
 *   • `-1` is storable and is already this matrix's unlimited sentinel — but it
 *     is a NUMBER, and the app compares these cells with `>=` and `<` in
 *     several places. One consumer that has not learned the sentinel evaluates
 *     `accountCount >= -1` as true forever and reports the church as AT ITS
 *     LIMIT — unlimited contacts becoming zero capacity, silently, for the most
 *     expensive add-on Harvest sells.
 *
 * So `maxContacts` here is always a real, finite, honest number — the tier's
 * allowance plus `CONTACTS_PER_PACK` per pack — and the unlimited fact travels
 * beside it. A cap check asks "unlimited, or under the number?" (see
 * `isAtContactLimit`). A consumer that has NOT been taught about the boolean
 * still reads a finite number that is at worst too small, never zero, and never
 * smaller than what the church actually paid for.
 */
export interface EffectiveFeatures extends PlanFeatures {
  /**
   * The Unlimited Contacts add-on. When true, `maxContacts` is a floor to be
   * ignored, not a limit to enforce.
   */
  unlimitedContacts: boolean;
}

/**
 * Coerce an untrusted `tenants/{id}.addons` value to a `TenantAddons`.
 *
 * Same shape and same reasoning as `toTenantPlan`: this field comes off a
 * Firestore document, it may be absent (every tenant created before REP-5a), and
 * it must fail closed to "owns nothing" rather than throw on a screen render.
 *
 * Counts are floored at 0 and rounded down. A negative quantity — a corrupt doc,
 * a hand edit — must never REDUCE a cap; that is the one direction an add-on may
 * never move a limit.
 */
export function readTenantAddons(raw: unknown): TenantAddons {
  if (!raw || typeof raw !== 'object') return NO_ADDONS;
  const value = raw as Partial<Record<keyof TenantAddons, unknown>>;
  const count = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return {
    aiAssistant: count(value.aiAssistant),
    adminSeats: count(value.adminSeats),
    contactPacks: count(value.contactPacks),
    unlimitedContacts: value.unlimitedContacts === true,
    campuses: count(value.campuses),
  };
}

/**
 * Add capacity to a cap without ever lowering it.
 *
 * An already-unlimited cell is returned untouched — see `UNLIMITED_CAP`. A
 * negative addition is clamped to zero, so the invariant "no add-on lowers any
 * cap" holds structurally rather than by every caller remembering it.
 */
function raiseCap(base: number, extra: number): number {
  if (base === UNLIMITED_CAP) return base;
  return base + Math.max(0, extra);
}

/**
 * A plan's features with `addons` layered on — the function cap checks should
 * ask once a tenant's add-on set is in hand.
 *
 * 🔴 SEPARATE FROM `getPlanFeatures` ON PURPOSE, and `getPlanFeatures` is
 * unchanged. That function has roughly forty callers reading a tier's PUBLISHED
 * allowance — the pricing matrix, /api/plans, the comparison table, every
 * per-component gate. Teaching it about add-ons would move all forty at once,
 * and the ones that are meant to show the published number (a plan-comparison
 * row cannot show one church's purchased capacity) would become wrong with no
 * way to tell which. Two functions, two questions: "what does this TIER
 * include" and "what does this TENANT have".
 *
 * PURE. No fetch, no clock, no module state — `addons` is passed in by whoever
 * already holds the tenant doc. It returns a NEW frozen object and never
 * touches `PLAN_FEATURES`; `plan-features.test.ts` pins that every tier reads
 * identically before and after this is called.
 *
 * Four cells move, and only these four:
 *   `maxContacts`  + `CONTACTS_PER_PACK` per pack (and see `unlimitedContacts`)
 *   `maxAdmins`    + one per admin seat
 *   `maxChurches`  + one per campus — the ONLY path past 1, which is the design
 *   `aiAssistant`  + one per AI Assistant add-on
 * Everything else is the tier's, untouched: an add-on buys capacity, never a
 * feature flag.
 */
export function getEffectiveFeatures(
  plan: TenantPlan,
  addons?: TenantAddons | null,
): EffectiveFeatures {
  const base = getPlanFeatures(plan);
  const owned = readTenantAddons(addons);
  return Object.freeze({
    ...base,
    maxContacts: raiseCap(base.maxContacts, owned.contactPacks * CONTACTS_PER_PACK),
    maxAdmins: raiseCap(base.maxAdmins, owned.adminSeats),
    maxChurches: raiseCap(base.maxChurches, owned.campuses),
    aiAssistant: raiseCap(base.aiAssistant, owned.aiAssistant),
    unlimitedContacts: owned.unlimitedContacts,
  });
}

/**
 * Coerce an untrusted plan value — a Firestore field, an API body, or a plan
 * that is still loading — to a TenantPlan, failing closed to 'plus'.
 *
 * This is the same fallback getPlanFeatures() has always applied at runtime via
 * `|| PLAN_FEATURES.plus`; callers just had no way to say so in the type system
 * and were passing a bare `string`. PLAN_FEATURES is the source of truth for
 * which ids are real, so adding a tier cannot leave this behind.
 */
export function toTenantPlan(plan: string | null | undefined): TenantPlan {
  return plan && Object.prototype.hasOwnProperty.call(PLAN_FEATURES, plan)
    ? (plan as TenantPlan)
    : 'plus';
}

/**
 * Human-readable display names for each plan tier.
 * Internal IDs (plus/pro/max) stay the same.
 *
 * `max` displays as 'Ministry', not the old 'Community'. That is not a rename
 * of the product: 'Ministry' was the deleted `ultra` tier's name, and `max`
 * inherited it when the two folded together. The top tier is still called what
 * it was always called.
 */
export const PLAN_DISPLAY_NAMES: Record<TenantPlan, string> = {
  plus: 'Individual',
  pro: 'Small Team',
  max: 'Ministry',
};

/**
 * The one-line blurb under a tier's name — who the plan is FOR, not what it
 * contains.
 *
 * These are the only strings on a plan card that are typed rather than derived.
 * Everything else a card prints comes out of `PLAN_FEATURES` above, because a
 * hand-written list of what a tier includes is how this product once advertised
 * "keeps 100%" against a real 2.5% fee. A blurb has nothing in the matrix to
 * derive from — "for solo evangelists" is an audience, not a capability — so it
 * is written down, once, HERE rather than in a component, so the in-app card and
 * anything else that ever wants it read the same sentence.
 *
 * ⚠️ CROSS-REPO, same shape as `ANNUAL_BILLED_MONTHS` above: the marketing site
 * (harvest-presentation-site) carries its OWN copy of these three sentences in
 * src/components/Pricing.tsx. The two repos cannot share code, so a reworded
 * tagline here does NOT reach theharvest.site and the two will drift. That
 * drift is cosmetic — a tagline is a description of an audience, not a claim
 * about what the plan does, so a stale one cannot mis-sell the way a stale
 * price or a stale feature list can — but it is real, and changing one of these
 * means changing it there too if the two are meant to read alike.
 */
export const PLAN_BLURBS: Record<TenantPlan, string> = {
  plus: 'For solo evangelists and missionaries.',
  pro:  'For small ministries growing as a team.',
  max:  'For established churches going deeper.',
};

/** Get the display name for a given plan. Defaults to 'Individual' if unknown. */
export function getPlanDisplayName(plan: TenantPlan): string {
  return PLAN_DISPLAY_NAMES[plan] || PLAN_DISPLAY_NAMES.plus;
}

/**
 * Check if a specific feature is enabled for a plan.
 *
 * `aiAssistant` used to be an 'included' | 'addon' string; it is now a count
 * (0 = none, 1 = one, -1 = unlimited), so the number branch below covers it and
 * every other PlanFeatures member is a boolean. The old string branch was
 * unreachable — TypeScript narrowed its operand to `never` — and is gone.
 * Use `getPlanFeatures(plan).aiAssistant` directly for the count.
 */
export function hasFeature(plan: TenantPlan, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(plan);
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

// ─── Feature gates & minimum plan (derived) ───────────────────────────────────

/** Plan tiers cheapest → most expensive. Upgrade order; do not reorder. */
export const PLAN_ORDER: readonly TenantPlan[] = ['plus', 'pro', 'max'] as const;

/**
 * The most expensive tier — the last entry in `PLAN_ORDER`.
 *
 * DERIVED, not hardcoded. This is the "no plan unlocks it, name the top tier"
 * fallback for upgrade copy; it used to be a literal `'ultra'`, which is
 * exactly the kind of reference that breaks silently the next time a tier is
 * added or removed. Reading the last index means a tier change can only ever
 * move it, never leave it pointing at a plan that no longer exists.
 */
export const TOP_PLAN: TenantPlan = PLAN_ORDER[PLAN_ORDER.length - 1];

/**
 * Gate keys used by `usePlanGate` and the upgrade screens. These are the
 * snake_case names threaded through UI call sites (e.g.
 * `<PlanUpgradeScreen featureKey="community_chat" />`); `FEATURE_MAP` translates
 * them to the camelCase `PlanFeatures` cells they actually gate on.
 */
export type FeatureKey =
  | 'fundraising'
  | 'event_registration'
  | 'docs'
  | 'crm'
  | 'accounting'
  | 'community_chat'
  | 'tax_receipts';

export const FEATURE_MAP: Record<FeatureKey, keyof PlanFeatures> = {
  fundraising: 'fundraising',
  event_registration: 'eventRegistration',
  docs: 'docs',
  crm: 'crm',
  accounting: 'accountingTools',
  community_chat: 'communityGroups',
  tax_receipts: 'taxReceipt',
};

/**
 * Cheapest plan that unlocks `feature`, or `null` if no plan does.
 *
 * DERIVED from `PLAN_FEATURES` — walk `PLAN_ORDER` and return the first tier
 * whose cell is truthy. This replaced two hand-maintained literal maps
 * (`FEATURE_MIN_PLAN` in usePlanGate.ts and `FEATURE_MIN_PLAN_NAME` in
 * PlanUpgradeScreen.tsx) that had silently drifted from the matrix: both listed
 * `crm` and `tax_receipts` as Ministry when Community (max) has had them for
 * some time, so upgrade screens told an Individual or Small Team admin to buy
 * the top plan when the tier below already unlocked the feature. Deriving makes
 * that class of drift structurally impossible — do not reintroduce a literal
 * map. (The repricing moved `crm` and `docs` down again, to Small Team; the
 * labels followed with no edit here, which is the point.)
 *
 * Truthiness matches `hasFeature`: numeric cells count as unlocked when non-zero.
 */
export function getFeatureMinPlan(feature: FeatureKey): TenantPlan | null {
  const key = FEATURE_MAP[feature];
  if (!key) return null;
  return getMinPlanForFeatureCell(key);
}

/**
 * Cheapest plan whose matrix cell `key` is truthy, or `null` if none is.
 *
 * Same derivation as `getFeatureMinPlan`, but keyed on the raw `PlanFeatures`
 * cell rather than a `FeatureKey` gate name. Not every cell has a `FeatureKey`
 * — those exist only for features fronted by `usePlanGate`/`PlanUpgradeScreen`
 * — so this is the way to derive a minimum-plan label for the rest (e.g.
 * `customDomain`, which is gated by a boolean prop, not a gate key). Use it
 * instead of writing a plan name into UI copy by hand: hardcoded names are
 * exactly what drifted in #242.
 */
export function getMinPlanForFeatureCell(key: keyof PlanFeatures): TenantPlan | null {
  return PLAN_ORDER.find((plan) => hasFeature(plan, key)) ?? null;
}

/**
 * Display name of the cheapest plan that unlocks `feature` (e.g. 'Ministry').
 * Falls back to the TOP tier's name if nothing unlocks it, so upgrade copy can
 * never render an empty plan name.
 *
 * The fallback goes through `TOP_PLAN` (derived from the last `PLAN_ORDER`
 * entry) rather than naming a tier literally. It used to read
 * `PLAN_DISPLAY_NAMES.ultra`, which stopped compiling the moment that tier was
 * deleted — the point of deriving it is that the next tier change cannot break
 * this the same way, or worse, break it silently.
 */
export function getFeatureMinPlanName(feature: FeatureKey): string {
  const plan = getFeatureMinPlan(feature);
  return PLAN_DISPLAY_NAMES[plan ?? TOP_PLAN];
}

/**
 * Every gate key → the display name of its minimum plan, derived once at module
 * load. The single source both `usePlanGate` and `PlanUpgradeScreen` read, so
 * the two surfaces can never disagree. Frozen: it is derived state, not config.
 */
export const FEATURE_MIN_PLAN: Readonly<Record<FeatureKey, string>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(FEATURE_MAP) as FeatureKey[]).map((k) => [k, getFeatureMinPlanName(k)])
  ) as Record<FeatureKey, string>
);

/**
 * Branding-family entitlement — does this plan's feature set unlock the admin
 * Branding tab/page? Extracted from AdminDashboard so the OR chain has exactly
 * one definition and can be asserted per tier in plan-features.test.ts.
 *
 * `customBackground` used to be a third term here. It was true on precisely the
 * tiers where `customBranding` is true — at the time Community/max and the
 * since-deleted Ministry/ultra — so removing it left every tier's Branding
 * access unchanged:
 *   Individual (plus) hidden · Small Team (pro) hidden · Ministry (max) shown.
 * Folding ultra into max did not change that either: max already had both
 * `customBranding` and `customDomain`.
 */
export function hasBrandingAccess(features: PlanFeatures): boolean {
  return features.customBranding || features.customDomain;
}

/**
 * The suffix each term's CHARGED figure carries — "$329/yr", not "$329/mo".
 *
 * 🔴 The suffix names the billing cycle, so the amount beside it is the amount
 * that leaves the church's account on that cycle. A quarterly plan is charged
 * $99 every three months and says so; the per-month arithmetic is a separate,
 * clearly-labelled line (`planTermMonthlyEquivalent`), never this one.
 */
export const TERM_PRICE_SUFFIX: Readonly<Record<BillingTerm, string>> = Object.freeze({
  monthly: 'mo',
  quarterly: 'qtr',
  yearly: 'yr',
});

/**
 * How a term is described in running prose — "billed quarterly".
 *
 * A total map rather than a ternary, deliberately. The confirmation banner on
 * signup asked `billing === 'yearly' ? 'billed annually' : 'billed monthly'`,
 * which was correct while there were two terms and silently WRONG the moment
 * there were three: a church that chose quarterly was shown "billed monthly" on
 * the last screen before it paid. A record over the union cannot fall into an
 * else-branch that way — a new term is a type error here, not a wrong sentence.
 */
export const TERM_BILLED_PHRASE: Readonly<Record<BillingTerm, string>> = Object.freeze({
  monthly: 'billed monthly',
  quarterly: 'billed quarterly',
  yearly: 'billed annually',
});

/** Format a plan's CHARGED price for a term, e.g. "$39/mo", "$99/qtr", "$329/yr". */
export function formatPlanPrice(plan: TenantPlan, term: BillingTerm): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  return `$${planPriceUsd(plan, term).toLocaleString()}/${TERM_PRICE_SUFFIX[term]}`;
}
