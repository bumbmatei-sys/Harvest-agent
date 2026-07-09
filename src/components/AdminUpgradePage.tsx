"use client";
import React, { useState } from 'react';
import { Check, ChevronRight, Crown } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import {
  PLAN_DISPLAY_NAMES,
  PLAN_PRICING,
  formatPlanPrice,
} from '../utils/plan-features';
import { authFetch } from '../utils/auth-fetch';
import { getTenantId } from './settings/useTenantId';

interface AdminUpgradePageProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
  onBack: () => void;
}

// Plan tiers in ascending order — used to determine upgrade vs downgrade.
const PLAN_ORDER: TenantPlan[] = ['plus', 'pro', 'max', 'ultra'];

// Curated 4–5 key highlights per plan (kept short, no rainbow icons).
const PLAN_HIGHLIGHTS: Record<TenantPlan, string[]> = {
  plus: ['Blog & Posts', 'Fundraising campaigns', 'Mobile app (PWA)', '2 courses', '1 admin'],
  pro: ['Everything in Individual', 'AI Chat & Knowledge', 'Newsletter', '5 courses', '5 admins'],
  max: ['Everything in Small Team', 'Custom branding', 'Events & Notes', 'Automated newsletter', 'Unlimited courses'],
  ultra: ['Everything in Community', 'CRM & Accounting', 'Custom domain', 'Livestream & SMS', 'Check-In & Giving Statements'],
};

const AdminUpgradePage: React.FC<AdminUpgradePageProps> = ({ currentPlan, tenantId, email }) => {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const resolveTenantId = async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    return getTenantId();
  };

  const handleCheckout = async (planId: string) => {
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

  const currentIdx = currentPlan ? PLAN_ORDER.indexOf(currentPlan) : -1;
  // Recommended = the plan one tier above current (Community for new/super-admin).
  // null when already on the top tier — never recommend a downgrade.
  const recommendedId: TenantPlan | null =
    currentIdx >= 0
      ? (currentIdx < PLAN_ORDER.length - 1 ? PLAN_ORDER[currentIdx + 1] : null)
      : 'max';
  const currentName = currentPlan ? PLAN_DISPLAY_NAMES[currentPlan] : null;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6 pb-12">
      {/* Current plan card */}
      {currentPlan ? (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-warm-brown">You&apos;re on</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                  <Crown size={13} style={{ color: 'var(--brand-color, #d4a017)' }} />
                  {currentName}
                </span>
                <span className="text-xs text-[color:var(--text-faint)]">{formatPlanPrice(currentPlan, 'monthly')}</span>
              </div>
            </div>
            <button
              onClick={handleManageSubscription}
              disabled={portalLoading}
              className="flex items-center gap-1 text-sm font-medium text-[color:var(--text-body)] hover:text-earth transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {portalLoading ? 'Opening…' : <>Manage subscription <ChevronRight size={15} /></>}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center gap-3">
          <Crown size={18} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <div>
            <p className="text-sm font-semibold text-earth">Super Admin</p>
            <p className="text-xs text-warm-brown">Platform-wide access — every plan feature is enabled.</p>
          </div>
        </div>
      )}

      {/* Billing period toggle */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 bg-stone-100 rounded-lg p-1">
          <button
            onClick={() => setBillingPeriod('monthly')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              billingPeriod === 'monthly' ? 'bg-white text-earth shadow-sm' : 'text-warm-brown hover:text-[color:var(--text-body)]'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingPeriod('yearly')}
            className={`relative px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              billingPeriod === 'yearly' ? 'bg-white text-earth shadow-sm' : 'text-warm-brown hover:text-[color:var(--text-body)]'
            }`}
          >
            Yearly
            <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-full">
              2mo free
            </span>
          </button>
        </div>
        {billingPeriod === 'yearly' && (
          <p className="text-xs text-green-600 font-medium">Pay for 10 months, get 12 — first year.</p>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLAN_ORDER.map((planId) => {
          const name = PLAN_DISPLAY_NAMES[planId];
          const isCurrent = planId === currentPlan;
          const isDowngrade = currentIdx >= 0 && PLAN_ORDER.indexOf(planId) < currentIdx;
          const isRecommended = !isCurrent && !isDowngrade && planId === recommendedId;
          const monthly = PLAN_PRICING[planId].monthlyUsd;
          const yearly = PLAN_PRICING[planId].yearlyUsd;

          return (
            <div
              key={planId}
              className={`bg-white rounded-xl border p-5 flex flex-col ${
                isRecommended ? 'border-amber-300 ring-1 ring-amber-200' : 'border-stone-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-earth">{name}</h3>
                {isCurrent && (
                  <span className="px-2 py-0.5 rounded-full bg-stone-100 text-warm-brown text-[11px] font-semibold">
                    Current Plan
                  </span>
                )}
                {isRecommended && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold">
                    Recommended
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-2xl font-bold text-earth">
                  ${billingPeriod === 'monthly' ? monthly.toLocaleString() : yearly.toLocaleString()}
                </span>
                <span className="text-xs text-[color:var(--text-faint)]">/{billingPeriod === 'monthly' ? 'mo' : 'yr'}</span>
              </div>

              <ul className="space-y-2 mb-5 flex-1">
                {PLAN_HIGHLIGHTS[planId].map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check size={14} className="text-[color:var(--text-faint)] mt-0.5 shrink-0" />
                    <span className="text-xs text-warm-brown">{feature}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="w-full py-2 rounded-lg text-sm font-medium text-center bg-stone-100 text-[color:var(--text-faint)]">
                  Current Plan
                </div>
              ) : (
                <button
                  onClick={() => (isDowngrade ? handleManageSubscription() : handleCheckout(planId))}
                  disabled={checkoutLoading === planId}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                    isRecommended
                      ? 'text-white hover:opacity-90'
                      : 'border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100'
                  }`}
                  style={isRecommended ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}
                >
                  {checkoutLoading === planId
                    ? 'Redirecting…'
                    : isDowngrade
                    ? `Switch to ${name}`
                    : `Upgrade to ${name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Billing & Invoices */}
      <div className="border-t border-stone-200 pt-6">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-brown mb-3">Billing &amp; Invoices</h4>
        <p className="text-sm text-warm-brown mb-3">
          Manage payment methods and view past invoices through Stripe.
        </p>
        <button
          onClick={handleManageSubscription}
          disabled={portalLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-200 text-sm font-medium text-[color:var(--text-body)] hover:bg-stone-100 transition-colors disabled:opacity-50"
        >
          {portalLoading ? (
            <><span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" /> Opening portal…</>
          ) : (
            <>Open Billing Portal <ChevronRight size={15} /></>
          )}
        </button>
        <p className="text-xs text-[color:var(--text-faint)] mt-2">Powered by Stripe</p>
      </div>

      {/* Cancel subscription */}
      {currentPlan && (
        <div className="text-center pt-2">
          <button
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="text-xs text-[color:var(--text-faint)] underline hover:text-warm-brown transition-colors disabled:opacity-50"
          >
            Cancel subscription
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminUpgradePage;
