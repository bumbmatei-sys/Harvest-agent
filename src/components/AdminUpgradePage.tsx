"use client";
import React, { useEffect, useState } from 'react';
import { Check, ChevronRight, Crown } from 'lucide-react';
import { TenantPlan, PricedPlan } from '../types/tenant.types';
import {
  PLAN_DISPLAY_NAMES,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  TERM_MONTHS,
  planPriceUsd,
  formatPlanMonthlyHeadline,
  formatPlanPrice,
  isPricedPlan,
  type BillingTerm,
} from '../utils/plan-features';
import { authFetch } from '../utils/auth-fetch';
import { fetchBillingProcessor, needsFirstSubscription, runDodoPlanChange, startFirstSubscription, subscriptionProcessorAttribution, type PlanChangeProcessor } from '../utils/plan-change';
import { getTenantId } from './settings/useTenantId';
import { useTenantOptional } from '../contexts/TenantContext';
import { BillingTermToggle } from './settings/BillingTermToggle';

interface AdminUpgradePageProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
  onBack: () => void;
}

// Curated 4–5 key highlights per plan (kept short, no rainbow icons).
//
// `PricedPlan`, not `TenantPlan`: this map feeds the checkout card grid below,
// which offers only tiers that can be bought. Typing it on the full union would
// force a `free` entry that nothing renders — a dead cell that later reads as
// the free tier's advertised feature list and drifts from the matrix unnoticed.
const PLAN_HIGHLIGHTS: Record<PricedPlan, string[]> = {
  plus: ['Blog & Posts', 'Fundraising campaigns', 'Mobile app (PWA)', '150 contacts', '2 admins'],
  pro: ['Everything in Individual', 'AI Chat & Knowledge', 'CRM & Check-In', '500 contacts', '5 admins'],
  max: ['Everything in Small Team', 'Custom domain & branding', 'Accounting & Giving Statements', '2,000 contacts', '15 admins'],
};

const AdminUpgradePage: React.FC<AdminUpgradePageProps> = ({ currentPlan, tenantId, email }) => {
  const [billingPeriod, setBillingPeriod] = useState<BillingTerm>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  // Which processor owns this tenant's subscription. Unlike PlanUpgradeSection
  // (whose parent, BillingAndPayments, already reads it off
  // /api/billing/invoices and passes it down), nothing above this page holds
  // the processor — so it is resolved here at mount through the SAME
  // fetchBillingProcessor() this page already calls on every plan click; no new
  // endpoint, no new prop chain. `undefined` = fetch not resolved yet, `null` =
  // could not be determined (not an owner, network failure); in both cases the
  // attribution below renders nothing rather than naming a processor on a
  // guess.
  const [processor, setProcessor] = useState<PlanChangeProcessor | undefined>(undefined);
  /**
   * THE-259 — how a completed plan change reaches the tier on screen.
   *
   * `useTenantOptional`, not `useTenant`: this page renders in tests and tools
   * outside a `TenantProvider`, and the degraded behaviour there is "no
   * refresh", never a wrong tier. Under the provider — every real admin — it is
   * always present.
   */
  const tenant = useTenantOptional();

  useEffect(() => {
    let cancelled = false;
    fetchBillingProcessor().then((proc) => { if (!cancelled) setProcessor(proc); });
    return () => { cancelled = true; };
  }, []);

  const resolveTenantId = async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    return getTenantId();
  };

  // 🔴 THE-212. True for a tenant on a tier with no price — Forever Free today.
  // It owns no subscription with any processor, so every "manage"/"cancel"
  // affordance on this page is inert for it and the plan cards ARE its action.
  // One derivation, read by the click routing and by all three portal controls.
  const isFirstSubscriptionTenant = needsFirstSubscription(currentPlan);

  /**
   * One entry point per plan card, same shape as PlanUpgradeSection: a Dodo
   * tenant changes plan in place (preview → confirm → the plan_changed webhook
   * moves the tier), a Stripe tenant keeps checkout for upgrades and the
   * portal for downgrades. The processor is resolved lazily on click; the
   * server refuses a mis-routed request either way.
   */
  const handlePlanSelect = async (planId: TenantPlan, isDowngrade: boolean) => {
    setCheckoutLoading(planId);
    try {
      // ── 🔴 THE FREE TENANT'S FIRST SUBSCRIPTION (THE-212). ────────────────
      // Checked before the processor, and that order is the fix — see the note
      // above `needsFirstSubscription`. A free tenant has no subscription, so
      // `/api/billing/invoices` reports its Stripe default and this page sent
      // the tenant to `/api/stripe/checkout` and a Stripe price id. The tier is
      // the question, not the processor.
      if (isFirstSubscriptionTenant && isPricedPlan(planId)) {
        const result = await startFirstSubscription({ plan: planId, billing: billingPeriod });
        if (!result.ok && result.message) alert(result.message);
        return;
      }
      const proc = processor !== undefined ? processor : await fetchBillingProcessor();
      if (proc === 'dodo') {
        const tid = await resolveTenantId();
        if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
        // 🔴 NO `billing` (THE-226). `billingPeriod` is this page's price
        // toggle — what the owner is LOOKING at, never what they pay — and
        // sending it is what made a plan change read as a term switch.
        // `runDodoPlanChange` reads the tenant's real term from the server.
        const result = await runDodoPlanChange({ tenantId: tid, plan: planId });
        if (result.ok) {
          alert(result.message);
          // 🔴 THE-259 — ARM THE RE-READ, DO NOT RELOAD. This used to be
          // `window.location.reload()`: a full page load to learn one field,
          // and one that carried no checkout marker on the reloaded URL, so the
          // bounded window did not arm on the other side either. `ok` means
          // Dodo ACCEPTED the change, not that the webhook has written `plan`,
          // so what is needed is the window that outlives that race — not a
          // reload, and not a client-side write of the tier we asked for.
          tenant?.armPlanRefresh();
        } else if (result.message) {
          alert(result.message);
        }
        return;
      }
      if (isDowngrade) {
        await handleManageSubscription();
        return;
      }
      await handleCheckout(planId);
    } finally {
      setCheckoutLoading(null);
    }
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
        <div className="bg-surface-raised rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted">You&apos;re on</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                  <Crown size={13} style={{ color: 'var(--brand-color, #d4a017)' }} />
                  {currentName}
                </span>
                <span className="text-xs text-faint">{formatPlanPrice(currentPlan, 'monthly')}</span>
              </div>
            </div>
            {/* 🔴 NOT FOR A FREE TENANT (THE-212). This opens the hosted
                customer portal — cancel, replace a card, read an invoice — and
                a Forever Free tenant has none of those with any processor. The
                route answers "No Stripe subscription found. Please subscribe
                first.", so the control's only outcome was an error on the page
                whose whole purpose is to sell this tenant a plan. The cards
                below are its action; nothing replaces this link here because
                they are already the next thing on the screen. */}
            {!isFirstSubscriptionTenant && (
              <button
                data-testid="upgrade-page-manage-action"
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="flex items-center gap-1 text-sm font-medium text-body hover:text-strong transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {portalLoading ? 'Opening…' : <>Manage subscription <ChevronRight size={15} /></>}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-surface-raised rounded-xl border border-line p-4 flex items-center gap-3">
          <Crown size={18} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <div>
            <p className="text-sm font-semibold text-strong">Super Admin</p>
            <p className="text-xs text-muted">Platform-wide access — every plan feature is enabled.</p>
          </div>
        </div>
      )}

      {/* Billing period toggle — three terms, shared with PlanUpgradeSection so
          the in-app surfaces cannot offer different terms or different badges. */}
      <BillingTermToggle value={billingPeriod} onChange={setBillingPeriod} />

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 🔴 PRICED tiers only. Every card here carries a checkout button, and
            the Forever Free tier has no price and no Dodo product to check out
            with. The index arithmetic above still uses PLAN_ORDER, because
            `currentPlan` CAN be 'free' and "is this a downgrade" must be
            answered against every tier a tenant can actually be on. This grid
            renders exactly the three cards it rendered before. */}
        {PRICED_PLAN_ORDER.map((planId) => {
          const name = PLAN_DISPLAY_NAMES[planId];
          const isCurrent = planId === currentPlan;
          const isDowngrade = currentIdx >= 0 && PLAN_ORDER.indexOf(planId) < currentIdx;
          const isRecommended = !isCurrent && !isDowngrade && planId === recommendedId;
          // The CHARGED figure for the selected term, read from the table.
          const termPrice = planPriceUsd(planId, billingPeriod);

          return (
            <div
              key={planId}
              className={`bg-surface-raised rounded-xl border p-5 flex flex-col ${
                isRecommended ? 'border-amber-300 ring-1 ring-amber-200' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-strong">{name}</h3>
                {isCurrent && (
                  <span className="px-2 py-0.5 rounded-full bg-surface-sunken text-muted text-[11px] font-semibold">
                    Current Plan
                  </span>
                )}
                {isRecommended && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold">
                    Recommended
                  </span>
                )}
              </div>

              {/* 🔴 THE-196: per-month headline, charged total beneath — the
                  same hierarchy as the settings plan cards, deliberately. These
                  are two routes to the same decision and a church may see both
                  in one session. */}
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-2xl font-bold text-strong">
                  {formatPlanMonthlyHeadline(planId, billingPeriod)}
                </span>
                <span className="text-xs text-faint">/mo</span>
              </div>
              {/* The charged amount. 12.5px and `text-muted` (7.02:1) for the
                  reason given at length on the settings card: this is the
                  number that leaves the account and it is no longer the big
                  one, so it must not also be the faint one. */}
              {billingPeriod !== 'monthly' ? (
                <p data-testid="upgrade-card-term-note" className="text-[12.5px] font-medium text-muted mb-4">
                  {`billed as $${termPrice.toLocaleString()} every ${TERM_MONTHS[billingPeriod]} months`}
                </p>
              ) : (
                <div className="mb-4" />
              )}

              <ul className="space-y-2 mb-5 flex-1">
                {PLAN_HIGHLIGHTS[planId].map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check size={14} className="text-faint mt-0.5 shrink-0" />
                    <span className="text-xs text-muted">{feature}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="w-full py-2 rounded-lg text-sm font-medium text-center bg-surface-sunken text-faint">
                  Current Plan
                </div>
              ) : (
                <button
                  onClick={() => handlePlanSelect(planId, isDowngrade)}
                  disabled={checkoutLoading === planId}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                    isRecommended
                      ? 'text-white hover:opacity-90'
                      : 'border border-line text-body hover:bg-surface-sunken'
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

      {/* Billing & Invoices — a free tenant has no payment method and no
          invoice to open a portal for, so the whole region is absent for it
          rather than offering a button that can only error (THE-212). */}
      {!isFirstSubscriptionTenant && (
      <div className="border-t border-line pt-6">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Billing &amp; Invoices</h4>
        <p className="text-sm text-muted mb-3">
          Manage payment methods and view past invoices through our payment processor.
        </p>
        <button
          onClick={handleManageSubscription}
          disabled={portalLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-line text-sm font-medium text-body hover:bg-surface-sunken transition-colors disabled:opacity-50"
        >
          {portalLoading ? (
            <><span className="w-4 h-4 border-2 border-line-strong border-t-gray-600 rounded-full animate-spin" /> Opening portal…</>
          ) : (
            <>Open Billing Portal <ChevronRight size={15} /></>
          )}
        </button>
        {subscriptionProcessorAttribution(processor) && (
          <p className="text-xs text-faint mt-2">{subscriptionProcessorAttribution(processor)}</p>
        )}
      </div>
      )}

      {/* Cancel subscription — never offered to a tenant that has none. */}
      {currentPlan && !isFirstSubscriptionTenant && (
        <div className="text-center pt-2">
          <button
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="text-xs text-faint underline hover:text-muted transition-colors disabled:opacity-50"
          >
            Cancel subscription
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminUpgradePage;
