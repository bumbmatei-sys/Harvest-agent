"use client";
import React, { useState, useRef, useCallback } from 'react';
import { Zap, Crown, Star, Building2 } from 'lucide-react';
import { TenantPlan } from '../../types/tenant.types';
import {
  getPlanFeatures,
  getPlanDisplayName,
  PLAN_DISPLAY_NAMES,
  PLAN_PRICING,
  PLAN_DONATION_RETENTION,
  AI_ASSISTANT_ADDON_PRICING,
  formatPlanPrice,
  PlanFeatures,
} from '../../utils/plan-features';
import { authFetch } from '../../utils/auth-fetch';
import { getTenantId } from './useTenantId';

interface PlanUpgradeSectionProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
}

// Plan tiers in ascending order — used to determine upgrade vs downgrade.
const PLAN_ORDER: TenantPlan[] = ['plus', 'pro', 'max', 'ultra'];

const PLANS: { id: TenantPlan; name: string; monthlyPrice: string; yearlyPrice: string; yearlyPromo: string; yearlyOriginal: string; icon: any; color: string; popular?: boolean; comingSoon: string[] }[] = [
  { id: 'plus', name: 'Individual', monthlyPrice: '$59/mo', yearlyPrice: '$590/yr', yearlyPromo: '$590', yearlyOriginal: '$708', icon: Zap, color: '#6366f1', comingSoon: [] },
  { id: 'pro', name: 'Small Team', monthlyPrice: '$119/mo', yearlyPrice: '$1,190/yr', yearlyPromo: '$1,190', yearlyOriginal: '$1,428', icon: Crown, color: '#d4a017', comingSoon: [] },
  { id: 'max', name: 'Community', monthlyPrice: '$239/mo', yearlyPrice: '$2,390/yr', yearlyPromo: '$2,390', yearlyOriginal: '$2,868', icon: Star, color: '#8b5cf6', popular: true, comingSoon: ['Automated Devotional'] },
  { id: 'ultra', name: 'Ministry', monthlyPrice: '$479/mo', yearlyPrice: '$4,790/yr', yearlyPromo: '$4,790', yearlyOriginal: '$5,748', icon: Building2, color: '#b45309', comingSoon: ['Automated Blog Articles'] },
];

// Keyed lookup so we can resolve plan metadata by id (icon/color/popular).
const PLAN_META = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<
  TenantPlan,
  (typeof PLANS)[number]
>;

const FEATURE_COMPARISON: { key: keyof PlanFeatures; label: string; format?: (v: any) => string }[] = [
  { key: 'blog', label: 'Blog' },
  { key: 'aiChat', label: 'AI Chat' },
  { key: 'aiKnowledge', label: 'AI Knowledge Base' },
  { key: 'map', label: 'Church Map' },
  { key: 'newsletterAutomation', label: 'Newsletter' },
  { key: 'maxCourses', label: 'Courses', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
  { key: 'maxAdmins', label: 'Admin Accounts', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
  { key: 'customDomain', label: 'Custom Branding' },
  { key: 'aiAssistant', label: 'AI Assistant', format: (v) => v === -1 ? 'Unlimited' : v === 0 ? '—' : `${v}` },
  { key: 'maxChurches', label: 'Churches', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
  { key: 'fundraising', label: 'Fundraising' },
  { key: 'eventRegistration', label: 'Event Registration' },
  { key: 'docs', label: 'Notes' },
  { key: 'crm', label: 'CRM (Donors & Members)' },
  { key: 'accountingTools', label: 'Accounting Tools' },
  { key: 'communityGroups', label: 'Community Groups' },
  { key: 'taxReceipt', label: 'Tax Receipts' },
];

const SOON_FEATURES: { label: string; plans: TenantPlan[] }[] = [
  { label: 'Automated Devotional', plans: ['max', 'ultra'] },
  { label: 'Automated Blog Articles', plans: ['ultra'] },
];

const PlanUpgradeSection: React.FC<PlanUpgradeSectionProps> = ({ currentPlan, tenantId, email }) => {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [activePlanIndex, setActivePlanIndex] = useState(0);
  const planScrollRef = useRef<HTMLDivElement>(null);

  const handlePlanScroll = useCallback(() => {
    const container = planScrollRef.current;
    if (!container) return;
    const scrollLeft = container.scrollLeft;
    const cardWidth = 300;
    const index = Math.round(scrollLeft / cardWidth);
    setActivePlanIndex(Math.min(index, PLANS.length - 1));
  }, []);

  const resolveTenantId = async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    return getTenantId();
  };

  const handleStripeCheckout = async (planId: string) => {
    const tid = await resolveTenantId();
    if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
    setCheckoutLoading(planId);
    try {
      let referrerId: string | undefined;
      try {
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) {
          const parsed = JSON.parse(stored);
          referrerId = parsed.id || stored;
        }
      } catch { /* ignore */ }

      const resp = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan: planId,
          billing: billingPeriod,
          tenantId: tid,
          tenantName: tid,
          email: email || undefined,
          ...(referrerId ? { referrerId } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to start checkout');
      }
    } catch (e) {
      console.error('Checkout error:', e);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    const tid = await resolveTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setPortalLoading(true);
    try {
      const resp = await authFetch('/api/stripe/portal', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (e) {
      console.error('Portal error:', e);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Upgrade Your Plan</h2>
      <p className="text-gray-500">Choose the plan that best fits your ministry&apos;s needs.</p>

      {/* Billing Period Toggle */}
      <div className="flex items-center justify-center gap-3 bg-gray-50 rounded-2xl p-2 max-w-xs mx-auto">
        <button
          onClick={() => setBillingPeriod('monthly')}
          className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
            billingPeriod === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingPeriod('yearly')}
          className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all relative ${
            billingPeriod === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Yearly
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-full">
            -2mo
          </span>
        </button>
      </div>

      {billingPeriod === 'yearly' && (
        <p className="text-center text-sm text-green-600 font-medium">
          🎉 First year promotion: 2 months free! Pay for 10 months, get 12.
        </p>
      )}

      {/* Plan Cards Carousel */}
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
      <div
        ref={planScrollRef}
        onScroll={handlePlanScroll}
        className="flex overflow-x-auto gap-4 pb-4 snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {PLAN_ORDER.map((planId) => {
          const meta = PLAN_META[planId];
          const plan = meta;
          const features = getPlanFeatures(planId);
          const name = PLAN_DISPLAY_NAMES[planId];
          const monthlyPrice = formatPlanPrice(planId, 'monthly');
          const displayPrice = formatPlanPrice(planId, billingPeriod);
          const yearlyOriginalUsd = `$${(PLAN_PRICING[planId].monthlyUsd * 12).toLocaleString()}/yr`;
          const donationPct = PLAN_DONATION_RETENTION[planId];
          const isCurrent = planId === currentPlan;
          const isDowngrade = PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(currentPlan ?? 'plus');

          return (
            <div
              key={planId}
              className={`relative bg-white rounded-2xl border-2 p-5 transition-all min-w-[280px] max-w-[320px] flex-shrink-0 snap-center ${
                isCurrent ? 'border-[#d4a017] shadow-lg' : 'border-gray-100 hover:border-gray-200'
              }`}
            >
              {meta.popular && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#d4a017] text-white text-xs font-bold rounded-full">
                  Popular
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full">
                  Current
                </div>
              )}

              <div className="text-center mb-4">
                <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: `${meta.color}15` }}>
                  <meta.icon size={24} style={{ color: meta.color }} />
                </div>
                <h3 className="text-lg font-bold text-gray-900">{name}</h3>
                {billingPeriod === 'yearly' && yearlyOriginalUsd && (
                  <p className="text-sm text-gray-400 line-through">{yearlyOriginalUsd}</p>
                )}
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {billingPeriod === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice}
                </p>
                {billingPeriod === 'yearly' && (
                  <p className="text-xs text-green-600 font-medium mt-1">Save 2 months</p>
                )}
              </div>

              <div className="space-y-2 mb-5">
                {FEATURE_COMPARISON.map(({ key, label, format }) => {
                  const value = features[key];
                  const isPositive = key === 'maxChurches'
                    ? (value as number) !== 1
                    : key === 'aiAssistant'
                    ? true
                    : Boolean(value);
                  const display = format
                    ? format(value)
                    : (value ? '✓' : '✗');
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{label}</span>
                      <span className={isPositive ? 'text-green-600 font-medium' : 'text-gray-400'}>{display}</span>
                    </div>
                  );
                })}

                {plan.comingSoon.length > 0 && (
                  <div className="pt-2 mt-1 border-t border-amber-100">
                    <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1.5">Coming Soon</p>
                    {plan.comingSoon.map((item) => (
                      <div key={item} className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">{item}</span>
                        <span className="text-amber-500 text-xs font-semibold">Soon</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
                  <span className="text-gray-900 font-semibold">Donation retention</span>
                  <span className="text-green-600 font-bold">{plan.id === 'plus' ? '90%' : plan.id === 'pro' ? '95%' : '100%'} to you</span>
                </div>
              </div>

              <button
                onClick={() => {
                  if (!isCurrent && !isDowngrade) {
                    handleStripeCheckout(plan.id);
                  } else if (!isCurrent && isDowngrade) {
                    handleManageSubscription();
                  }
                }}
                disabled={isCurrent || checkoutLoading === planId}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-gray-100 text-gray-400 cursor-default'
                    : isDowngrade
                    ? 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    : checkoutLoading === planId
                    ? 'bg-[#d4a017]/70 text-white cursor-wait'
                    : 'bg-[#d4a017] text-white hover:bg-[#b8941a]'
                }`}
              >
                {checkoutLoading === planId ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecting...
                  </span>
                ) : isCurrent ? 'Current Plan' : isDowngrade ? `Downgrade to ${plan.name}` : `Upgrade to ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Carousel Dot Indicators */}
      <div className="flex justify-center gap-2 py-2">
        {PLAN_ORDER.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              const container = planScrollRef.current;
              if (container) container.scrollTo({ left: index * 300, behavior: 'smooth' });
              setActivePlanIndex(index);
            }}
            className={`transition-all rounded-full ${
              activePlanIndex === index ? 'w-6 h-2 bg-[#d4a017]' : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
            }`}
            aria-label={`Go to plan ${index + 1}`}
          />
        ))}
      </div>

      {/* Full Feature Comparison Table */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mt-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Full Feature Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-3 text-gray-500 font-medium">Feature</th>
                {PLAN_ORDER.map(planId => (
                  <th key={planId} className="text-center py-3 px-3 text-gray-500 font-medium">
                    {PLAN_DISPLAY_NAMES[planId]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_COMPARISON.map(({ key, label, format }) => (
                <tr key={key} className="border-b border-gray-50">
                  <td className="py-3 px-3 text-gray-900 font-medium">{label}</td>
                  {PLAN_ORDER.map(planId => {
                    const features = getPlanFeatures(planId);
                    const value = features[key];
                    const isPositive = key === 'maxChurches'
                      ? (value as number) !== 1
                      : key === 'aiAssistant'
                      ? true
                      : Boolean(value);
                    const display = format ? format(value) : (value ? '✓' : '✗');
                    return (
                      <td key={planId} className={`py-3 px-3 text-center ${isPositive ? 'text-green-600' : 'text-gray-400'}`}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Coming soon section header */}
              <tr>
                <td colSpan={5} className="pt-5 pb-2 px-3">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-amber-500">Coming Soon</span>
                </td>
              </tr>
              {SOON_FEATURES.map(({ label, plans: planIds }) => (
                <tr key={label} className="border-b border-gray-50">
                  <td className="py-3 px-3 text-gray-900 font-medium">{label}</td>
                  {PLANS.map(p => (
                    <td key={p.id} className={`py-3 px-3 text-center ${planIds.includes(p.id) ? 'text-amber-500' : 'text-gray-400'}`}>
                      {planIds.includes(p.id) ? <span className="text-xs font-semibold">Soon</span> : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          * AI Assistant: ${AI_ASSISTANT_ADDON_PRICING.setupFeeUsd} one-time setup + ${AI_ASSISTANT_ADDON_PRICING.monthlyUsd}/mo on all plans. Included at no extra cost on Ministry.
        </p>
      </div>

      {/* Billing & Payments */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          onClick={handleManageSubscription}
          disabled={portalLoading}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {portalLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Opening portal...
            </>
          ) : (
            'Manage Subscription'
          )}
        </button>
        <p className="text-xs text-gray-400">Powered by Stripe</p>
      </div>

    </div>
  );
};

export default PlanUpgradeSection;
