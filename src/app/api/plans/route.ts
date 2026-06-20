import { NextResponse } from 'next/server';
import {
  getPlanFeatures,
  PLAN_DISPLAY_NAMES,
  PLAN_PRICING,
  PLAN_DONATION_RETENTION,
  AI_ASSISTANT_ADDON_PRICING,
} from '@/utils/plan-features';
import { TenantPlan } from '@/types/tenant.types';

export const dynamic = 'force-static';
export const revalidate = 3600; // CDN cache: re-generate at most once per hour

const PLAN_ORDER: TenantPlan[] = ['plus', 'pro', 'max', 'ultra', 'enterprise'];

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
    const pricing = PLAN_PRICING[id];
    return {
      id,
      name: PLAN_DISPLAY_NAMES[id],
      pricing: {
        monthlyUsd: pricing.monthlyUsd,
        yearlyUsd: pricing.yearlyUsd,
        yearlyOriginalUsd: pricing.monthlyUsd != null ? pricing.monthlyUsd * 12 : null,
      },
      donationRetentionPct: PLAN_DONATION_RETENTION[id],
      features: {
        blog: features.blog,
        aiChat: features.aiChat,
        aiKnowledge: features.aiKnowledge,
        map: features.map,
        maxChurches: features.maxChurches,
        maxCourses: features.maxCourses,
        maxAdmins: features.maxAdmins,
        customDomain: features.customDomain,
        customBackground: features.customBackground,
        newsletterAutomation: features.newsletterAutomation,
        smsAutomation: features.smsAutomation,
        aiAssistant: features.aiAssistant,
      },
    };
  });

  return NextResponse.json(
    {
      plans,
      addons: {
        aiAssistant: {
          setupFeeUsd: AI_ASSISTANT_ADDON_PRICING.setupFeeUsd,
          monthlyUsd: AI_ASSISTANT_ADDON_PRICING.monthlyUsd,
          description: 'Connects to 900+ apps, automates tasks, manages schedules.',
          includedOn: PLAN_ORDER.filter(
            (id) => getPlanFeatures(id).aiAssistant === 'included'
          ),
        },
      },
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': 'https://theharvest.site',
      },
    }
  );
}
