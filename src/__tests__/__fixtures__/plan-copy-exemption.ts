import { createHash } from 'node:crypto';
import { R6_PLAN_FEATURES, R6_PLAN_UPGRADE_SECTION } from './plan-copy-exemption-r6';

/**
 * The one recorded, narrow exemption to the PlanUpgradeSection / plan-features
 * byte-identity pins (PR #540, settings popup, round 3).
 *
 * It is NOT a skip. Every guard that used to hold PlanUpgradeSection.tsx
 * byte-identical still compares the file's digest; it now accepts exactly two
 * values, the one it always pinned and the one recorded here. Any other edit,
 * anywhere in the file, produces a third digest and fails.
 *
 * The `hunks` are the proof that the new digest differs from the old one by
 * these lines and nothing else: `reverseHunks(current)` must hash back to
 * `originalDigest` (checked in pr-540.plan-copy-exemption.test.ts).
 *
 * Append-only: never replace `originalDigest`, add a new entry beside it.
 */
export const R3_APPROVAL = 'Matei approved 2026-10-21: display-copy + compact prop only';

export interface Hunk { readonly before: string; readonly after: string }

/**
 * A later approved edit, recorded on top of the one before it. `hunks` undo it, so
 * `reverseHunks(file, successor.hunks)` must hash back to the digest it followed.
 */
export interface Successor {
  readonly approval: string;
  readonly digest: string;
  readonly hunks: ReadonlyArray<Hunk>;
}

export interface RecordedExemption {
  readonly file: string;
  readonly approval: string;
  readonly originalDigest: string;
  readonly exemptDigest: string;
  readonly hunks: ReadonlyArray<Hunk>;
  /** Appended, in order, after `exemptDigest`. Never edit an earlier entry. */
  readonly successors?: ReadonlyArray<Successor>;
}

/**
 * PR #540 round 4. Matei approved the scheduler on the Ministry plan: an
 * entitlement cell (`socialScheduler` true on `max`) and the plan card line it derives.
 * No price, checkout or plan id moved.
 */
export const R4_APPROVAL = 'Matei approved 2026-10-21: "Include the scheduler in the Ministry plan"';

/**
 * Round 5 is NOT a PR #540 edit and is recorded here only because this chain is the
 * one place that proves what `plan-features.ts` is: the quarterly billing term was
 * withdrawn. The user instructed it directly ("delete the quarterly plan, keep monthly
 * and yearly"), so `BILLING_TERMS`, `TERM_MONTHS`, `PLAN_PRICING`,
 * `ADVERTISED_DISCOUNT_PCT`, `TERM_PRICE_SUFFIX` and `TERM_BILLED_PHRASE` each lose
 * their quarterly member and the prose around them is rewritten. It touches PRICES, which
 * rounds 3 and 4 deliberately did not, so it is its own named round rather than a
 * stretch of an earlier approval. `PlanUpgradeSection.tsx` is not part of it.
 */
export const R5_APPROVAL = 'user instructed 2026-10-23: delete the quarterly plan, keep monthly and yearly';

/**
 * Round 6 is the two-plan repricing, approved by the founder on 2026-10-27: Church at
 * $30/mo and $300/yr, Ministry at $90/mo and $900/yr, replacing plus / pro / max. It
 * rewrites both files wholesale (the plan matrix, the prices, the plan copy and the card
 * list), so its hunks live in plan-copy-exemption-r6.ts. Nothing about how a plan is
 * charged for, changed or written moved: `plan` is still written only by the webhook.
 */
export const R6_APPROVAL = 'Matei approved 2026-10-27: reprice to two plans, Church $30/mo $300/yr and Ministry $90/mo $900/yr';

export const PLAN_UPGRADE_SECTION: RecordedExemption = {
  file: 'src/components/settings/PlanUpgradeSection.tsx',
  approval: R3_APPROVAL,
  originalDigest: '667a71285e506773f0d137654584f9c7ded1eedcb8de8998908b9b1aa2a9c935',
  exemptDigest: 'eb4cc06ac22f5984341089499c86010cf23df6d2462b390ff337a5c450288377',
  hunks: [
    {
      before: "import { Check } from 'lucide-react';\n",
      after: "import { Check } from 'lucide-react';\nimport { Button } from '@/components/ui/button';\n",
    },
    {
      before: '  hideUpgrade?: boolean;\n',
      after: '  hideUpgrade?: boolean;\n  /** Settings popup only: one plan card per row and a theme-token Manage button. */\n  compact?: boolean;\n',
    },
    {
      before: "{ key: 'maxChurches', count: ['church', 'churches'] },",
      after: "{ key: 'maxChurches', count: ['campus', 'campuses'] },",
    },
    {
      before: 'email, hideUpgrade, processor }) => {',
      after: 'email, hideUpgrade, processor, compact }) => {',
    },
    {
      before: "        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}\n",
      after:
        '        style={compact\n' +
        "          ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', overflow: 'visible' }\n" +
        "          : { scrollbarWidth: 'none', msOverflowStyle: 'none' }}\n",
    },
    {
      before: '          <button\n            data-testid="billing-manage-action"',
      after:
        '          {compact ? (\n' +
        '            <Button\n' +
        '              data-testid="billing-manage-action"\n' +
        '              variant="outline"\n' +
        '              onClick={handleManageSubscription}\n' +
        '              disabled={portalLoading}\n' +
        '              className="min-h-[44px] sm:min-h-0"\n' +
        '            >\n' +
        "              {portalLoading ? 'Opening portal...' : 'Manage Subscription'}\n" +
        '            </Button>\n' +
        '          ) : (\n' +
        '          <button\n' +
        '            data-testid="billing-manage-action"',
    },
    {
      before: "              'Manage Subscription'\n            )}\n          </button>\n",
      after: "              'Manage Subscription'\n            )}\n          </button>\n          )}\n",
    },
  ],
  successors: [
    {
      approval: R4_APPROVAL,
      digest: '2301202d994407ae7a00e0b41e92e9245bae3590db29fe7ca292c7adb78e115c',
      hunks: [
        {
          before: "  { key: 'communityGroups', label: 'Community Groups' },\n];\n",
          after:
            "  { key: 'communityGroups', label: 'Community Groups' },\n" +
            "  { key: 'socialScheduler', label: 'Social Scheduler' },\n];\n",
        },
      ],
    },
    { approval: R6_APPROVAL, digest: R6_PLAN_UPGRADE_SECTION.digest, hunks: R6_PLAN_UPGRADE_SECTION.hunks },
  ],
};

export const PLAN_FEATURES: RecordedExemption = {
  file: 'src/utils/plan-features.ts',
  approval: R3_APPROVAL,
  originalDigest: 'ea729463e52a02a69ada40f1796b919c5872077e379fbe03ca6c269a811fd38e',
  exemptDigest: 'b5396ad175399ba2a736bb9a23df4c2399802337c18684737c44dab7009e4c3f',
  hunks: [
    {
      before: "  max:  'For established churches going deeper.',",
      after:
        '  // TODO: harvest-presentation-site (src/components/Pricing.tsx) still says "churches"; change it to "campuses" there too.\n' +
        "  max:  'For established campuses going deeper.',",
    },
  ],
  successors: [
    {
      approval: R4_APPROVAL,
      digest: '8ca381290333e0d02908a6289e15e3b6f6efe4e68a866a40f835f038891ad7d6',
      hunks: [
        {
          before:
            '   * 🔴 FALSE ON EVERY TIER. No plan includes it. The only path to `true` is\n' +
            '   * holding the social scheduler add-on, which `getEffectiveFeatures` lifts\n',
          after:
            '   * 🔴 TRUE ON MINISTRY ONLY (Matei approved 2026-10-21: "Include the\n' +
            '   * scheduler in the Ministry plan"). Every other tier reaches `true` only by\n' +
            '   * holding the social scheduler add-on, which `getEffectiveFeatures` lifts\n',
        },
        {
          before:
            '    // 🔴 FALSE ON EVERY TIER. Social scheduling is an add-on. See PlanFeatures.\n' +
            '    socialScheduler: false,\n',
          after:
            '    // Included in Ministry (Matei approved 2026-10-21). Other tiers hold it via the add-on.\n' +
            '    socialScheduler: true,\n',
        },
      ],
    },
    {
      approval: R5_APPROVAL,
      digest: '691314fe71658a90b2a6f92a7d091c8c02507ce5193c743552cae921012fc4ef',
      hunks: [
        {
          before: " * `yearly`; the reconciliation lives in src/lib/dodo/catalogue.ts and nowhere\n * else. Quarterly needs no reconciliation — Dodo bills it as\n * `payment_frequency_count: 3, interval: Month`, and \"quarterly\" is this app's\n * word for that.\n */\nexport const BILLING_TERMS = ['monthly', 'quarterly', 'yearly'] as const;\n\n",
          after: " * `yearly`; the reconciliation lives in src/lib/dodo/catalogue.ts and nowhere\n * else.\n *\n * Two terms. A quarterly term was sold from 2026-08-20 and withdrawn on\n * 2026-10-23, its three Dodo products archived; it had no live subscriber when\n * it went. The word is deliberately absent from this list, so the checkout\n * routes and `readSignupBillingPeriod` refuse it rather than sell it.\n */\nexport const BILLING_TERMS = ['monthly', 'yearly'] as const;\n\n",
        },
        {
          before: "  monthly: 1,\n  quarterly: 3,\n  yearly: 12,\n",
          after: "  monthly: 1,\n  yearly: 12,\n",
        },
        {
          before: "/**\n * Base plan pricing in USD — the STORED TABLE. Nine numbers, one per\n * (tier, term), and every plan price in this app is one of these nine.\n *\n",
          after: "/**\n * Base plan pricing in USD — the STORED TABLE. Six numbers, one per\n * (tier, term), and every plan price in this app is one of these six.\n *\n",
        },
        {
          before: " * exactly 25% — with `yearlyUsd` derived from it. That abstraction is GONE and\n * must not come back, because the discounts it has to express no longer divide\n * into whole months: 20% off a year is ×9.6 months and 10% off a quarter is\n * ×2.7 months. There is no integer to name. (The stored years are rounder still\n * — $190 is ×9.5 months, not ×9.6 — which is the next paragraph's point.)\n *\n",
          after: " * exactly 25% — with `yearlyUsd` derived from it. That abstraction is GONE and\n * must not come back, because the discount it has to express no longer divides\n * into whole months: 20% off a year is ×9.6 months. There is no integer to\n * name. (The stored years are rounder still — $190 is ×9.5 months, not ×9.6 —\n * which is the next paragraph's point.)\n *\n",
        },
        {
          before: " * the primitive and the percentages fall out of them, rather than the other way\n * round. The savings these nine numbers actually produce are:\n *\n *              Quarterly   Yearly\n *   Individual    10.0%     20.8%\n *   Small Team    10.0%     20.8%\n *   Ministry      10.0%     21.7%\n *\n * ⚠️ THE QUARTERLY COLUMN IS FLAT; THE YEARLY COLUMN IS NOT, and THE-343 is\n * what separated them again. The quarters are still exactly nine tenths of\n * three months ($54/$60, $108/$120, $216/$240), so every tier saves 10.0% on a\n * quarter to the cent. The years no longer share a ratio: Individual and Small\n * Team are 190/240ths of twelve and Ministry is 752/960ths, which is 21.7%\n * against their 20.8%. (THE-372 put Ministry back to $80 and kept THE-343's\n * ratios exactly — 2.7x monthly a quarter, 9.4x a year — so this table's\n * percentages did not move.)\n *\n * ⚠️ THE-248 HAD MADE BOTH COLUMNS FLAT, and that was a property of those\n * prices rather than a rule. Nothing here may assume either shape: the tiers\n * were 18.3 / 17.5 / 17.1 apart two reprices ago, flat after THE-248, and\n * spread again on the yearly column now that Ministry alone was repriced.\n *\n * 🔴 DO NOT COMPUTE A BADGE FROM THIS TABLE. See `ADVERTISED_DISCOUNT_PCT` —\n * the yearly column is why that is still true even now the columns are flat.\n *\n * ⚠️ CROSS-REPO: the marketing site (harvest-presentation-site) carries its own\n * copy of these nine numbers in src/components/Pricing.tsx, and a module-scope\n * contract there compares the TABLE — tier by tier, term by term — against the\n",
          after: " * the primitive and the percentages fall out of them, rather than the other way\n * round. The savings these six numbers actually produce on the yearly term are:\n *\n *   Individual 20.8%   Small Team 20.8%   Ministry 21.7%\n *\n * ⚠️ THE YEARLY COLUMN IS NOT FLAT. Individual and Small Team are 190/240ths of\n * twelve months and Ministry is 752/960ths, which is 21.7% against their 20.8%.\n * Nothing here may assume the tiers share a ratio: they were 18.3 / 17.5 / 17.1\n * apart two reprices ago, flat after THE-248, and spread again once Ministry\n * alone was repriced (THE-343, kept by THE-372).\n *\n * (The withdrawn quarterly column was flat: exactly nine tenths of three months\n * on every tier — $54 against $60, $108 against $120, $216 against $240 — so\n * each saved 10.0% to the cent. That flatness is gone with the term; do not\n * read it back into the yearly column.)\n *\n * 🔴 DO NOT COMPUTE A BADGE FROM THIS TABLE. See `ADVERTISED_DISCOUNT_PCT` —\n * the yearly column is why: the founder advertises a round 20%, the prices\n * deliver 20.8%.\n *\n * ⚠️ CROSS-REPO: the marketing site (harvest-presentation-site) carries its own\n * copy of these six numbers in src/components/Pricing.tsx, and a module-scope\n * contract there compares the TABLE — tier by tier, term by term — against the\n",
        },
        {
          before: "  Object.freeze({\n    plus: Object.freeze({ monthly: 20, quarterly: 54,  yearly: 190 }),\n    pro:  Object.freeze({ monthly: 40, quarterly: 108, yearly: 380 }),\n    max:  Object.freeze({ monthly: 80, quarterly: 216, yearly: 752 }),\n  });\n",
          after: "  Object.freeze({\n    plus: Object.freeze({ monthly: 20, yearly: 190 }),\n    pro:  Object.freeze({ monthly: 40, yearly: 380 }),\n    max:  Object.freeze({ monthly: 80, yearly: 752 }),\n  });\n",
        },
        {
          before: " * church reads as \"what this costs me\". Rounding to nearest then becomes a\n * claim, and on two of the six discounted cells it is a claim that is too low:\n *\n *     Individual yearly    $329/12 = $27.4167  →  round = $27  → implies $324\n *     Small Team quarterly $199/3  = $66.3333  →  round = $66  → implies $198\n *\n",
          after: " * church reads as \"what this costs me\". Rounding to nearest then becomes a\n * claim, and on one of the discounted cells it was a claim that was too low:\n *\n *     Individual yearly    $329/12 = $27.4167  →  round = $27  → implies $324\n *\n",
        },
        {
          before: " * That is the whole of this ticket, and it is a pricing misrepresentation\n * rather than a rounding preference. (The brief named the Individual yearly\n * cell; Small Team quarterly understates too, by $1.)\n *\n * ⚠️ THOSE TWO CELLS ARE HISTORY — THE RULE IS NOT, AND THE-343 IS WHY THAT\n * DISTINCTION EARNS ITS KEEP. Under today's prices the three quarters divide\n * exactly ($54/3, $108/3, $216/3 are $18, $36, $72) and all three years round\n * UP ($190/12 → $16, $380/12 → $32, $752/12 → $63). So NO cell understates\n",
          after: " * That is the whole of this ticket, and it is a pricing misrepresentation\n * rather than a rounding preference. (A Small Team quarterly cell, $199/3,\n * understated too, by $1; the quarterly term has since been withdrawn.)\n *\n * ⚠️ THAT CELL IS HISTORY — THE RULE IS NOT, AND THE-343 IS WHY THAT\n * DISTINCTION EARNS ITS KEEP. Under today's prices all three years round\n * UP ($190/12 → $16, $380/12 → $32, $752/12 → $63). So NO cell understates\n",
        },
        {
          before: " * ⚠️ An exact division keeps its whole-dollar form — $108/3 is $36.00 and\n * prints as `$36`, not `$36.00`. See `formatPlanMonthlyHeadline`. All three\n * quarters divide exactly under THE-248, so this branch is now the common case\n * rather than the rare one.\n *\n",
          after: " * ⚠️ An exact division keeps its whole-dollar form — $108/3 is $36.00 and\n * prints as `$36`, not `$36.00`. See `formatPlanMonthlyHeadline`. The monthly\n * term divides exactly by definition, so this branch is the common case.\n *\n",
        },
        {
          before: "\n/** The two terms that carry a discount — every term except the monthly base. */\nexport const DISCOUNTED_TERMS = BILLING_TERMS.filter((t) => t !== 'monthly');\n",
          after: "\n/** The terms that carry a discount — every term except the monthly base. */\nexport const DISCOUNTED_TERMS = BILLING_TERMS.filter((t) => t !== 'monthly');\n",
        },
        {
          before: " * The original reason was SPREAD: rounded prices produced a different real\n * saving on every tier — 15.4 / 16.0 / 16.4 on quarterly — so a computed badge\n * would have read \"16%\" beside the Ministry card and \"15%\" beside the\n * Individual one, on a toggle that sits above all three at once.\n *\n * ⚠️ THE-248 REMOVED THE SPREAD AND NOT THE REASON. All three tiers now save\n * 10.0% on a quarter and 20.8% on a year, so \"one number cannot be derived from\n * three\" no longer bites — but the YEARLY column still does, from the other\n * side. The founder advertises a ROUND 20%; the prices deliver 20.8%. A\n * computed badge would print \"Save 20.8%\" (or round to \"21%\") beside a page\n",
          after: " * The original reason was SPREAD: rounded prices produced a different real\n * saving on every tier, so a computed badge would have read a different number\n * beside each card, on a toggle that sits above all three at once.\n *\n * ⚠️ THE-248 REMOVED THE SPREAD AND NOT THE REASON. All three tiers saved 20.8%\n * on a year, so \"one number cannot be derived from three\" no longer bit — but\n * the YEARLY column still did, from the other side. The founder advertises a\n * ROUND 20%; the prices deliver 20.8%. A\n * computed badge would print \"Save 20.8%\" (or round to \"21%\") beside a page\n",
        },
        {
          before: " * outlive the prices. Do not \"simplify\" this to a computation because today's\n * quarterly happens to agree with one.\n */\nexport const ADVERTISED_DISCOUNT_PCT: Readonly<Record<DiscountedTerm, number>> = Object.freeze({\n  quarterly: 10,\n  yearly: 20,\n",
          after: " * outlive the prices. Do not \"simplify\" this to a computation because today's\n * yearly happens to agree with one.\n */\nexport const ADVERTISED_DISCOUNT_PCT: Readonly<Record<DiscountedTerm, number>> = Object.freeze({\n  yearly: 20,\n",
        },
        {
          before: " *\n *   quarterly  advertises 10, worst tier saves 10.0  → 'flat'  → \"Save 10%\"\n *   yearly     advertises 20, worst tier saves 20.8  → 'flat'  → \"Save 20%\"\n *\n * The WORST tier is what both lines turn on, so Ministry's better yearly saving\n * does not move either of them: 20.8 is still the smallest yearly figure.\n *\n * 🔴 QUARTERLY IS NOW THE CASE THIS DERIVATION TURNS ON, and it turns on\n * EQUALITY rather than clearance. Every tier's quarter is exactly 10.0% off, so\n * the claim does not clear the worst saving — it MEETS it, to the cent. `<=` is\n * therefore load-bearing in a way it never was before: with `<`, a claim the\n * prices honour exactly would print \"up to 10%\", hedging against nothing.\n *\n",
          after: " *\n *   yearly     advertises 20, worst tier saves 20.8  → 'flat'  → \"Save 20%\"\n *\n * The WORST tier is what the line turns on, so Ministry's better yearly saving\n * does not move it: 20.8 is still the smallest yearly figure.\n *\n * 🔴 `<=` IS LOAD-BEARING. A claim the prices honour exactly MEETS the worst\n * saving rather than clearing it (the withdrawn quarterly term was exactly\n * 10.0% off on every tier), and with `<` that claim would print \"up to 10%\",\n * hedging against nothing.\n *\n",
        },
        {
          before: " * 🔴 The suffix names the billing cycle, so the amount beside it is the amount\n * that leaves the church's account on that cycle. A quarterly plan is charged\n * $99 every three months and says so; the per-month arithmetic is a separate,\n * clearly-labelled line (`planTermMonthlyEquivalent`), never this one.\n",
          after: " * 🔴 The suffix names the billing cycle, so the amount beside it is the amount\n * that leaves the church's account on that cycle. A yearly plan is charged\n * $329 once a year and says so; the per-month arithmetic is a separate,\n * clearly-labelled line (`planTermMonthlyEquivalent`), never this one.\n",
        },
        {
          before: "  monthly: 'mo',\n  quarterly: 'qtr',\n  yearly: 'yr',\n",
          after: "  monthly: 'mo',\n  yearly: 'yr',\n",
        },
        {
          before: "/**\n * How a term is described in running prose — \"billed quarterly\".\n *\n",
          after: "/**\n * How a term is described in running prose — \"billed annually\".\n *\n",
        },
        {
          before: " * which was correct while there were two terms and silently WRONG the moment\n * there were three: a church that chose quarterly was shown \"billed monthly\" on\n * the last screen before it paid. A record over the union cannot fall into an\n * else-branch that way — a new term is a type error here, not a wrong sentence.\n",
          after: " * which was correct while there were two terms and silently WRONG the moment\n * there were three: a church that chose the third term was shown \"billed\n * monthly\" on the last screen before it paid. A record over the union cannot fall into an\n * else-branch that way — a new term is a type error here, not a wrong sentence.\n",
        },
        {
          before: "  monthly: 'billed monthly',\n  quarterly: 'billed quarterly',\n  yearly: 'billed annually',\n",
          after: "  monthly: 'billed monthly',\n  yearly: 'billed annually',\n",
        },
        {
          before: "/**\n * Format a plan's CHARGED price for a term, e.g. \"$39/mo\", \"$99/qtr\", \"$329/yr\".\n *\n",
          after: "/**\n * Format a plan's CHARGED price for a term, e.g. \"$39/mo\", \"$329/yr\".\n *\n",
        },
        {
          before: " * billing term, so a `/mo` suffix on it would be a claim about a billing cycle\n * that does not exist — and `$0/qtr` on a quarterly toggle reads as a product\n * you are billed nothing for quarterly, which is a different (and wrong) thing.\n * The `!pricing` 'Custom' branch is kept for the Enterprise/unknown case it\n",
          after: " * billing term, so a `/mo` suffix on it would be a claim about a billing cycle\n * that does not exist — and `$0/yr` on a yearly toggle reads as a product\n * you are billed nothing for annually, which is a different (and wrong) thing.\n * The `!pricing` 'Custom' branch is kept for the Enterprise/unknown case it\n",
        },
      ],
    },
    { approval: R6_APPROVAL, digest: R6_PLAN_FEATURES.digest, hunks: R6_PLAN_FEATURES.hunks },
  ],
};

/** The digests a guard may accept for the file: what it always pinned, and each recorded edit in order. */
export const acceptedDigests = (e: RecordedExemption): readonly string[] =>
  [e.originalDigest, e.exemptDigest, ...(e.successors ?? []).map((x) => x.digest)];

/** The digest the file is expected to be at now: the last recorded edit. */
export const currentDigest = (e: RecordedExemption): string => acceptedDigests(e)[acceptedDigests(e).length - 1];

export const sha256Text = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Undo the recorded hunks. Returns null when a hunk's `after` text is not present
 * exactly once, which means the file no longer contains the recorded edit.
 */
export function reverseHunks(text: string, hunks: ReadonlyArray<Hunk>): string | null {
  let out = text;
  for (const { before, after } of hunks) {
    const parts = out.split(after);
    if (parts.length !== 2) return null;
    out = parts[0] + before + parts[1];
  }
  return out;
}

/**
 * Walk the recorded chain backwards: undo the latest successor, check the result is the digest that
 * successor followed, repeat, then undo the round-3 hunks and return the bytes. Null when any link
 * does not hold, which means the file holds an edit nobody recorded.
 */
export function undoRecordedChain(text: string, e: RecordedExemption): string | null {
  let out = text;
  const successors = e.successors ?? [];
  for (let i = successors.length - 1; i >= 0; i--) {
    if (sha256Text(out) !== successors[i].digest) return null;
    const undone = reverseHunks(out, successors[i].hunks);
    if (undone === null) return null;
    out = undone;
  }
  if (sha256Text(out) !== e.exemptDigest) return null;
  return reverseHunks(out, e.hunks);
}
