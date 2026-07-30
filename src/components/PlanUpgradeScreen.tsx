"use client";
import React from 'react';
import { Lock } from 'lucide-react';
import {
  FEATURE_MIN_PLAN,
  PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
  formatPlanPrice,
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
}

const PlanUpgradeScreen: React.FC<PlanUpgradeScreenProps> = ({
  featureName,
  featureKey,
  onBack,
  onUpgrade,
}) => {
  const minPlanName = FEATURE_MIN_PLAN_NAME[featureKey] || 'Community';
  const minIdx = PLANS.findIndex(p => p.name === minPlanName);
  const requiredPlans = minIdx >= 0 ? PLANS.slice(minIdx) : PLANS;
  const minPlan = requiredPlans[0];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ backgroundColor: '#fcefc7' }}
      >
        <Lock size={28} style={{ color: '#d4a017' }} />
      </div>

      <h2 className="text-xl font-bold text-strong mb-2 font-display">{featureName}</h2>
      <p className="text-sm text-muted mb-6 max-w-xs leading-relaxed">
        This feature requires the <strong>{minPlanName}</strong> plan or higher.
        Upgrade to unlock access.
      </p>

      {/* Plan options */}
      <div className="w-full max-w-sm space-y-2 mb-6">
        {requiredPlans.map(plan => (
          <div
            key={plan.key}
            className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
              plan.key === minPlan.key
                ? 'border-gold bg-[color-mix(in_srgb,var(--brand-color)_12%,white)]'
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

      <div className="flex gap-3 w-full max-w-sm">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted hover:bg-surface-sunken transition-colors"
        >
          Go Back
        </button>
        <button
          onClick={onUpgrade}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          Upgrade
        </button>
      </div>
    </div>
  );
};

export default PlanUpgradeScreen;
