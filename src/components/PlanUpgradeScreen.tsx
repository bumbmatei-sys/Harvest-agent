"use client";
import React from 'react';
import { Lock } from 'lucide-react';
import {
  FEATURE_MIN_PLAN,
  PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
  formatPlanPrice,
  getMinPlanForFeatureCell,
  type PlanFeatures,
} from '../utils/plan-features';

// Both the tier ladder and the minimum-plan labels are derived from the feature
// matrix in plan-features.ts. This screen used to carry hand-written copies of
// each; the label copy had drifted (crm and tax_receipts said Ministry when
// Community already unlocks them), overselling the $479 plan on the exact screen
// where someone decides what to buy. Do not reintroduce literals here.
const PLANS = PLAN_ORDER.map((key) => ({
  key,
  name: PLAN_DISPLAY_NAMES[key],
  price: formatPlanPrice(key, 'monthly'),
}));

/** @deprecated Alias of `FEATURE_MIN_PLAN` in plan-features.ts — import that instead. */
export const FEATURE_MIN_PLAN_NAME: Readonly<Record<string, string>> = FEATURE_MIN_PLAN;

interface PlanUpgradeScreenProps {
  featureName: string;
  featureKey: string;
  onBack: () => void;
  onUpgrade?: () => void;
  /**
   * Who is reading this. 'admin' (the default, and every pre-existing call
   * site) is the original screen: the price ladder plus an Upgrade button.
   *
   * 'member' is the member app. A member cannot buy a plan — only their
   * church's owner can — so an "Upgrade" button would be a dead end and the
   * prices are not theirs to act on. The member variant keeps the same
   * explanation of WHICH plan carries the feature, and says plainly who has to
   * make the change.
   */
  audience?: 'admin' | 'member';
}

const PlanUpgradeScreen: React.FC<PlanUpgradeScreenProps> = ({
  featureName,
  featureKey,
  onBack,
  onUpgrade,
  audience = 'admin',
}) => {
  const isMember = audience === 'member';
  // `featureKey` is a `FeatureKey` gate name for the seven features fronted by
  // usePlanGate (FEATURE_MIN_PLAN), but THE-202 added upgrade screens for cells
  // that have NO gate key — blog, aiKnowledge, newsletterAutomation, maxCourses.
  // Looking those up in FEATURE_MIN_PLAN misses, and the old `|| 'Community'`
  // fallback then named a plan chosen by nothing: it told a free admin to buy
  // Community for the Blog, which Individual already carries. So: gate-key map
  // first, then the same DERIVATION over the raw matrix cell, and only then the
  // fallback. A wrong plan name on the screen where someone decides what to buy
  // is the #242 defect class, not a nit.
  const minPlanName =
    FEATURE_MIN_PLAN_NAME[featureKey] ||
    (() => {
      const cell = getMinPlanForFeatureCell(featureKey as keyof PlanFeatures);
      return cell ? PLAN_DISPLAY_NAMES[cell] : '';
    })() ||
    'Community';
  const minIdx = PLANS.findIndex(p => p.name === minPlanName);
  const requiredPlans = minIdx >= 0 ? PLANS.slice(minIdx) : PLANS;
  const minPlan = requiredPlans[0];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center" data-testid="plan-upgrade-screen">
      {/* --surface-gold / --brand-color rather than the cream+gold hexes this
          tile used to carry: the member app is themeable, and a fixed cream
          plate stays cream on the dark ramp. */}
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-surface-gold">
        <Lock size={28} className="text-gold" />
      </div>

      <h2 className="text-xl font-bold text-strong mb-2 font-display">{featureName}</h2>
      <p className="text-sm text-muted mb-6 max-w-xs leading-relaxed">
        {isMember ? (
          <>
            {featureName} is part of the <strong>{minPlanName}</strong> plan, and your
            church is on a plan that does not include it. Nothing here is lost —
            an admin at your church is the one who can change the plan.
          </>
        ) : (
          <>
            This feature requires the <strong>{minPlanName}</strong> plan or higher.
            Upgrade to unlock access.
          </>
        )}
      </p>

      {/* Plan options — prices are for whoever can actually buy, so the member
          variant omits the ladder entirely rather than quoting a member a price
          they cannot act on. */}
      {!isMember && (
      <div className="w-full max-w-sm space-y-2 mb-6">
        {requiredPlans.map(plan => (
          <div
            key={plan.key}
            className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
              plan.key === minPlan.key
                ? 'border-gold bg-[color-mix(in_srgb,var(--brand-color)_12%,var(--surface-raised))]'
                : 'border-line bg-surface-raised'
            }`}
          >
            <div className="text-left">
              <p className="font-semibold text-strong text-sm">{plan.name}</p>
              <p className="text-xs text-faint">Includes {featureName}</p>
            </div>
            <span
              className="font-bold text-sm"
              style={{ color: 'var(--brand-color, #d4a017)' }}
            >
              {plan.price}
            </span>
          </div>
        ))}
      </div>
      )}

      <div className="flex gap-3 w-full max-w-sm">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted hover:bg-surface-sunken transition-colors"
        >
          Go Back
        </button>
        {!isMember && (
        <button
          onClick={onUpgrade}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          Upgrade
        </button>
        )}
      </div>
    </div>
  );
};

export default PlanUpgradeScreen;
