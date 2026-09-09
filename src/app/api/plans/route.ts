import { NextResponse } from 'next/server';
import {
  getPlanFeatures,
  PLAN_DISPLAY_NAMES,
  PLAN_PRICING,
  TERM_MONTHS,
  PLAN_ORDER,
  isPricedPlan,
} from '@/utils/plan-features';
import { NEWSLETTER_FEATURE_ENABLED } from '@/lib/newsletter-feature';
import { SMS_FEATURE_ENABLED } from '@/lib/sms-feature';
import { CUSTOM_DOMAIN_ENABLED } from '@/lib/custom-domain-feature';

export const dynamic = 'force-static';
export const revalidate = 3600; // CDN cache: re-generate at most once per hour

/**
 * GET /api/plans
 *
 * Returns the full plan catalog as JSON so the marketing site (theharvest.site)
 * can consume it at build time or via ISR, keeping feature copy in sync with
 * the app without manual copy-pasting.
 *
 * Usage (marketing site, e.g. Next.js):
 *   const res = await fetch('https://theharvest.app/api/plans');
 *   const { plans, addons } = await res.json();
 */
export async function GET() {
  const plans = PLAN_ORDER.map((id) => {
    const features = getPlanFeatures(id);
    return {
      id,
      name: PLAN_DISPLAY_NAMES[id],
      // One entry per billing term, plus what the same service would cost bought
      // a month at a time — the figure a saving is measured against. Both are
      // read from the price table; nothing here recomputes a discount, because
      // the discounts no longer divide into whole months (see PLAN_PRICING).
      //
      // 🔴 `null` FOR THE FOREVER FREE TIER, not a block of zeros. Free has no
      // price and no billing term, so there is no `monthlyUsd` to state and no
      // "original" for a saving to be measured against — `quarterlyOriginalUsd:
      // 0` would invite the consumer to render "$0, was $0, save 0%". `null` is
      // the one value a marketing card cannot mistake for a price, and the free
      // card must lead with the audience and the 500-member cap rather than a
      // figure. The three priced entries' shape is UNCHANGED.
      pricing: isPricedPlan(id)
        ? {
            monthlyUsd: PLAN_PRICING[id].monthly,
            quarterlyUsd: PLAN_PRICING[id].quarterly,
            yearlyUsd: PLAN_PRICING[id].yearly,
            quarterlyOriginalUsd: PLAN_PRICING[id].monthly * TERM_MONTHS.quarterly,
            yearlyOriginalUsd: PLAN_PRICING[id].monthly * TERM_MONTHS.yearly,
          }
        : null,
      // `donationRetentionPct` is intentionally absent. Every tier now charges
      // a 0% platform fee on donations, so the number it published was the
      // constant 100 — and it was a hand-maintained complement of the real fee
      // (PLATFORM_FEE_MAP), the duplication that once let "keeps 100%" ship
      // against a real 2.5% charge. See plan-features.ts.
      features: {
        blog: features.blog,
        // The church news feed (`/community_posts`). Published because the
        // marketing site's pricing card and comparison table both make a claim
        // about it, and free is the tier that answers it differently — a
        // consumer deriving a card from this catalog must be able to see that.
        newsFeed: features.newsFeed,
        aiChat: features.aiChat,
        aiKnowledge: features.aiKnowledge,
        map: features.map,
        maxChurches: features.maxChurches,
        maxContacts: features.maxContacts,
        maxCourses: features.maxCourses,
        maxAdmins: features.maxAdmins,
        // 🔴 THE-280 — custom domains are hidden while the feature cannot work,
        // so this catalogue stops publishing a per-tier value and no consumer
        // can render a plan row from one. Identical treatment to SMS below, and
        // for the reason that comment gives: this endpoint is what
        // theharvest.site builds its pricing copy from, so a value left here is
        // a claim the marketing site would keep making ON THE APP'S AUTHORITY —
        // which is exactly the "app hides it while the site sells it" split
        // THE-280 exists to close.
        //
        // 🔴 `features.customDomain` IS UNCHANGED IN THE MATRIX — the key is
        // omitted, not set to false. `false` would say "this tier does not
        // include a custom domain", a different and untrue claim; absent says
        // "this catalogue makes no claim about custom domains". Flip
        // CUSTOM_DOMAIN_ENABLED to publish the real per-tier values again.
        //
        // ⚠️ `customBranding` is NOT affected and must not be: separate cell,
        // and it ships.
        ...(CUSTOM_DOMAIN_ENABLED ? { customDomain: features.customDomain } : {}),
        // `customBackground` is intentionally absent: the app has no background
        // uploader, so advertising it here would sell a capability that does not
        // exist. Removed from the plan matrix too — see plan-features.ts.
        // 🔴 THE-335 — omitted while the newsletter is hidden, exactly as
        // `smsAutomation` is omitted below and for the same reason: the
        // marketing site renders a plan row from this catalogue, so publishing
        // the cell would let it advertise a capability the app refuses. Flip
        // NEWSLETTER_FEATURE_ENABLED to publish the real per-tier values again.
        ...(NEWSLETTER_FEATURE_ENABLED ? { newsletterAutomation: features.newsletterAutomation } : {}),
        // THE-245 — SMS is hidden while it is untested, so this catalogue stops
        // publishing a per-tier value for it and no consumer can render a plan
        // row from one. Same treatment as the AI Assistant below, and for the
        // same reason: this endpoint is what theharvest.site builds its pricing
        // copy from, so a value left here is a claim the marketing site would
        // keep making on the app's authority.
        //
        // 🔴 `features.smsAutomation` IS UNCHANGED IN THE MATRIX — the key is
        // omitted from the response, not set to false. A `false` would say "this
        // tier does not include SMS", which is a different and untrue claim;
        // absent says "this catalogue makes no claim about SMS". Flip
        // SMS_FEATURE_ENABLED to publish the real per-tier values again.
        ...(SMS_FEATURE_ENABLED ? { smsAutomation: features.smsAutomation } : {}),
        // The AI (Telegram) Assistant's `aiAssistant` count was DELETED with the
        // assistant itself (THE-253), so there is no row to publish. The RAG
        // `aiChat`/`aiKnowledge` capabilities above are a different thing and
        // stay — but note they are now false on every tier and are reached only
        // by holding the add-on, so this catalog answers the TIER question
        // correctly by publishing false.
      },
    };
  });

  return NextResponse.json(
    {
      plans,
      // 🔴 EMPTY, AND STILL PRESENT. The Telegram assistant's catalog entry is
      // gone with the product (THE-253) and no add-on replaces it here: what a
      // church can BUY is derived from the live Dodo add-on table by
      // /api/dodo/addons, never from this static catalog, and quoting a price
      // here is what let $200 outlive a $20 product. The key stays so a
      // consumer reading `data.addons` gets `{}` rather than `undefined`.
      addons: {},
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': 'https://theharvest.site',
      },
    }
  );
}
