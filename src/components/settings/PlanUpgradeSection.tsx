"use client";
import React, { useState, useRef, useCallback } from 'react';
import { Zap, Crown, Building2, Check } from 'lucide-react';
import { TenantPlan } from '../../types/tenant.types';
import {
  getPlanFeatures,
  getPlanDisplayName,
  PLAN_DISPLAY_NAMES,
  PLAN_ORDER,
  PLAN_PRICING,
  AI_TELEGRAM_ASSISTANT_ENABLED,
  UNLIMITED_CAP,
  formatPlanPrice,
  annualMonthlyEquivalent,
  ANNUAL_BILLED_MONTHS,
  ANNUAL_FREE_MONTHS,
  PlanFeatures,
} from '../../utils/plan-features';
import { authFetch } from '../../utils/auth-fetch';
import { fetchBillingProcessor, runDodoPlanChange, subscriptionProcessorAttribution, PlanChangeProcessor } from '../../utils/plan-change';
import { getTenantId } from './useTenantId';

interface PlanUpgradeSectionProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
  /**
   * Hide the plan cards (there's nothing to upgrade to on the top tier). The
   * "Manage Subscription" / cancel action stays available.
   */
  hideUpgrade?: boolean;
  /**
   * Which processor owns this tenant's subscription, when the parent already
   * knows (BillingAndPayments reads it off /api/billing/invoices). Undefined
   * means "not known yet" and it is resolved lazily on the first plan click;
   * the server guards both routes regardless, so this only picks the flow.
   */
  processor?: PlanChangeProcessor;
}

// Presentation only — icon, colour, "Popular" badge. Prices are NOT listed here:
// this table used to carry `monthlyPrice`/`yearlyPrice` literals ('$59/mo',
// '$2,990/yr') that the card actually rendered while `formatPlanPrice` sat
// imported and unused two lines above it, so a repricing in PLAN_PRICING left
// the in-app comparison showing the old numbers. The card now renders
// formatPlanPrice(planId, billingPeriod). Do not reintroduce price literals.
const PLANS: { id: TenantPlan; name: string; icon: any; color: string; popular?: boolean; comingSoon: string[] }[] = [
  { id: 'plus', name: 'Individual', icon: Zap, color: '#6366f1', comingSoon: [] },
  { id: 'pro', name: 'Small Team', icon: Crown, color: '#d4a017', popular: true, comingSoon: [] },
  { id: 'max', name: 'Ministry', icon: Building2, color: '#b45309', comingSoon: [] },
];

// Keyed lookup so we can resolve plan metadata by id (icon/color/popular).
const PLAN_META = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<
  TenantPlan,
  (typeof PLANS)[number]
>;

/**
 * One matrix cell, and the name to print for it.
 *
 * 🔴 THE ONLY COPY IN THIS FILE IS A NAME PER CELL — never a tier's contents.
 * Every card walks this one list and prints the cells that ITS OWN
 * `getPlanFeatures(planId)` row unlocks, so flipping a cell in the matrix moves
 * the card with no edit here. That is the entire point. A hand-written "what
 * Individual includes" list is how this product once advertised "keeps 100%"
 * against a real 2.5% fee and how a `$59/mo` figure outlived a reprice; a third
 * standing copy of the tier contents is exactly what must not reappear.
 *
 * `count` marks a NUMERIC cell: [singular, plural] nouns printed against the
 * tier's own number ("150 contacts", "1 church"). Everything else is a boolean
 * cell, printed as `label` when the tier has it and left out when it does not.
 *
 * The platform donation fee is deliberately NOT here. It was the one row the
 * deleted comparison table hardcoded (`staticValue: '0%'`), because
 * PLATFORM_FEE_MAP (src/lib/stripe-connect.ts) is server-only and
 * `getPlanFeatures` does not carry the fee at all — so on a card that derives
 * every line it has nowhere to come from. That is a gap in the feature matrix,
 * not a string to retype here.
 */
type CardFeature = {
  key: keyof PlanFeatures;
  /** Boolean cell — the line printed when the tier has it. */
  label?: string;
  /** Numeric cell — [singular, plural] noun printed against the tier's count. */
  count?: readonly [string, string];
};

/**
 * Everything a card can say, in the order it says it: capacity first — the
 * numbers a church sizes itself against — then capabilities.
 *
 * These are the same cells the deleted comparison table named, plus
 * `maxContacts`. That one is new to this surface and is here deliberately: CRM
 * is on every tier now, and the contact cap is what scopes the claim.
 * Advertising the roster without the number it stops at is the overselling this
 * file has been burned by twice. It derives like every other line.
 */
const CARD_FEATURES: CardFeature[] = [
  { key: 'maxContacts', count: ['contact', 'contacts'] },
  { key: 'maxAdmins', count: ['admin account', 'admin accounts'] },
  { key: 'maxCourses', count: ['course', 'courses'] },
  { key: 'maxChurches', count: ['church', 'churches'] },
  { key: 'aiAssistant', count: ['AI Assistant', 'AI Assistants'] },
  { key: 'blog', label: 'Blog' },
  { key: 'pwaApp', label: 'Mobile App (PWA)' },
  { key: 'aiChat', label: 'AI Chat' },
  { key: 'aiKnowledge', label: 'AI Knowledge Base' },
  { key: 'map', label: 'Church Map' },
  { key: 'newsletterAutomation', label: 'Newsletter' },
  { key: 'customBranding', label: 'Custom Branding' },
  { key: 'customDomain', label: 'Custom Domain' },
  { key: 'fundraising', label: 'Fundraising' },
  { key: 'eventRegistration', label: 'Event Registration' },
  { key: 'docs', label: 'Notes' },
  { key: 'crm', label: 'CRM (Donors & Members)' },
  { key: 'accountingTools', label: 'Accounting Tools' },
  { key: 'taxReceipt', label: 'Tax Receipts' },
  { key: 'givingStatements', label: 'Giving Statements' },
  { key: 'customForms', label: 'Custom Forms → CRM' },
  { key: 'checkInSystem', label: 'Check-In (QR)' },
  { key: 'livestream', label: 'Livestream + Live Giving' },
  { key: 'smsAutomation', label: 'SMS Automation' },
  { key: 'sermonNotes', label: 'Sermon Notes → Livestream' },
  { key: 'automatedBlog', label: 'Automated Blog Articles' },
  { key: 'communityGroups', label: 'Community Groups' },
];

// While the AI Telegram Assistant is hidden, drop its line from every card.
// Flip AI_TELEGRAM_ASSISTANT_ENABLED to bring it back.
const VISIBLE_CARD_FEATURES = AI_TELEGRAM_ASSISTANT_ENABLED
  ? CARD_FEATURES
  : CARD_FEATURES.filter((f) => f.key !== 'aiAssistant');

/**
 * The line this tier's card prints for one cell, or `null` when the tier does
 * not include it and the card leaves it out entirely.
 *
 * "Includes" is `hasFeature`'s definition rather than a second one: booleans by
 * their value, numbers by being non-zero. `features` arrives already resolved so
 * a card reads the matrix ONCE rather than once per line.
 */
function cardLine(feature: CardFeature, features: PlanFeatures): string | null {
  const value = features[feature.key];
  if (feature.count) {
    const [one, many] = feature.count;
    const n = value as number;
    if (n === 0) return null;
    if (n === UNLIMITED_CAP) return `Unlimited ${many}`;
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
  }
  return value ? feature.label! : null;
}

const PlanUpgradeSection: React.FC<PlanUpgradeSectionProps> = ({ currentPlan, tenantId, email, hideUpgrade, processor }) => {
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

  /**
   * One entry point per plan card. Dodo tenants get the in-place
   * preview-then-confirm change (up AND down — Dodo's hosted portal has no plan
   * controls, so sending a downgrade there would dead-end); Stripe tenants keep
   * exactly the flow they had: checkout for an upgrade, the portal for a
   * downgrade. The server refuses a mis-routed request either way.
   */
  const handlePlanSelect = async (planId: TenantPlan, isDowngrade: boolean) => {
    setCheckoutLoading(planId);
    try {
      const proc = processor !== undefined ? processor : await fetchBillingProcessor();
      if (proc === 'dodo') {
        const tid = await resolveTenantId();
        if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
        const result = await runDodoPlanChange({ tenantId: tid, plan: planId, billing: billingPeriod });
        if (result.ok) {
          alert(result.message);
          window.location.reload();
        } else if (result.message) {
          alert(result.message);
        }
        return;
      }
      if (isDowngrade) {
        await handleManageSubscription();
        return;
      }
      await handleStripeCheckout(planId);
    } finally {
      setCheckoutLoading(null);
    }
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
      {!hideUpgrade ? (
      <>
      <h2 className="font-display text-2xl font-bold text-strong">Upgrade Your Plan</h2>
      <p className="text-muted">Choose the plan that best fits your ministry&apos;s needs.</p>

      {/* Billing Period Toggle */}
      <div className="flex items-center justify-center gap-3 bg-surface-tint rounded-2xl p-2 max-w-xs mx-auto">
        <button
          onClick={() => setBillingPeriod('monthly')}
          className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
            billingPeriod === 'monthly' ? 'bg-surface-raised text-strong shadow-sm' : 'text-muted hover:text-body'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingPeriod('yearly')}
          className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all relative ${
            billingPeriod === 'yearly' ? 'bg-surface-raised text-strong shadow-sm' : 'text-muted hover:text-body'
          }`}
        >
          Yearly
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-full">
            -{ANNUAL_FREE_MONTHS}mo
          </span>
        </button>
      </div>

      {billingPeriod === 'yearly' && (
        <p className="text-center text-sm text-green-600 font-medium">
          🎉 {ANNUAL_FREE_MONTHS} months free! Pay for {ANNUAL_BILLED_MONTHS} months, get 12.
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
          const displayPrice = formatPlanPrice(planId, billingPeriod);
          // Annual bills monthly × ANNUAL_BILLED_MONTHS, same math as the marketing site's
          // Pricing.tsx — derived from the shared constant so the two never show different
          // numbers. The rounding lives in annualMonthlyEquivalent(), not here.
          const yearlyMonthlyEquivalent = annualMonthlyEquivalent(planId);
          const isCurrent = planId === currentPlan;
          const isDowngrade = PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(currentPlan ?? 'plus');

          return (
            <div
              key={planId}
              data-testid="plan-card"
              data-plan={planId}
              className={`relative bg-surface-raised rounded-2xl border-2 p-5 transition-all min-w-[280px] max-w-[320px] flex-shrink-0 snap-center flex flex-col ${
                isCurrent ? 'border-gold shadow-lg' : 'border-line-subtle hover:border-line'
              }`}
            >
              {meta.popular && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gold text-white text-xs font-bold rounded-full">
                  Popular
                </div>
              )}
              {isCurrent && (
                <div
                  data-testid="plan-card-current"
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full"
                >
                  Current
                </div>
              )}

              <div className="text-center mb-4">
                <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: `${meta.color}15` }}>
                  <meta.icon size={24} style={{ color: meta.color }} />
                </div>
                <h3 className="font-display text-lg font-bold text-strong">{name}</h3>
                {billingPeriod === 'yearly' && (
                  <p className="text-sm text-faint">${yearlyMonthlyEquivalent}/mo billed annually</p>
                )}
                <p data-testid="plan-card-price" className="text-2xl font-bold text-strong mt-1">
                  {displayPrice}
                </p>
                {billingPeriod === 'yearly' && (
                  <p className="text-xs text-green-600 font-medium mt-1">Save {ANNUAL_FREE_MONTHS} months</p>
                )}
              </div>

              {/* What this tier includes. Every line is derived from `features`
                  above — the card names no feature the matrix did not hand it,
                  and omits what the tier does not have rather than printing a
                  row of ✗ against it. */}
              <div className="mb-5 flex-1">
                <ul data-testid="plan-card-features" data-plan={planId} className="space-y-2">
                  {VISIBLE_CARD_FEATURES.map((feature) => {
                    const line = cardLine(feature, features);
                    if (!line) return null;
                    return (
                      <li
                        key={feature.key}
                        data-feature={feature.key}
                        className="flex items-start gap-2 text-sm"
                      >
                        <Check size={16} aria-hidden="true" className="text-green-600 shrink-0 mt-0.5" />
                        <span className="text-body">{line}</span>
                      </li>
                    );
                  })}
                </ul>

                {plan.comingSoon.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-amber-100">
                    <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1.5">Coming Soon</p>
                    {plan.comingSoon.map((item) => (
                      <div key={item} className="flex items-center justify-between text-sm">
                        <span className="text-muted">{item}</span>
                        <span className="text-amber-500 text-xs font-semibold">Soon</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  if (!isCurrent) handlePlanSelect(plan.id, isDowngrade);
                }}
                disabled={isCurrent || checkoutLoading === planId}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-surface-sunken text-faint cursor-default'
                    : isDowngrade
                    ? 'border border-line text-body hover:bg-surface-tint'
                    : checkoutLoading === planId
                    ? 'bg-[color-mix(in_srgb,var(--brand-color)_70%,transparent)] text-white cursor-wait'
                    : 'bg-gold text-white hover:bg-gold'
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
              activePlanIndex === index ? 'w-6 h-2 bg-gold' : 'w-2 h-2 bg-line-strong hover:bg-warm-brown'
            }`}
            aria-label={`Go to plan ${index + 1}`}
          />
        ))}
      </div>

      {/* The "Full Feature Comparison" table stood here and is deliberately
          gone. It was a 27-row ✓/✗ matrix rendering the same `getPlanFeatures`
          cells the three cards above already carry — a second rendering of the
          same facts, on the screen where a church is choosing a plan rather than
          auditing one. The cards are the comparison now. */}
      </>
      ) : (
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold text-strong">Billing</h2>
          <p className="text-muted mt-1">You&apos;re on the Ministry plan — the highest tier. Manage or cancel your subscription below.</p>
        </div>
      )}

      {/* Billing & Payments */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          onClick={handleManageSubscription}
          disabled={portalLoading}
          className="flex items-center gap-2 px-5 py-2.5 bg-earth text-cream rounded-xl text-sm font-semibold hover:bg-warm-dark dark:bg-cream dark:text-earth dark:hover:bg-stone-200 transition-colors disabled:opacity-50"
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
        {subscriptionProcessorAttribution(processor) && (
          <p className="text-xs text-faint">{subscriptionProcessorAttribution(processor)}</p>
        )}
      </div>

    </div>
  );
};

export default PlanUpgradeSection;
