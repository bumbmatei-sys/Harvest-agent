"use client";
import React from 'react';
import { Lock } from 'lucide-react';

const PLANS = [
  { key: 'plus',  name: 'Individual', price: '$59/mo'  },
  { key: 'pro',   name: 'Small Team', price: '$119/mo' },
  { key: 'max',   name: 'Community',  price: '$239/mo' },
  { key: 'ultra', name: 'Ministry',   price: '$479/mo' },
];

export const FEATURE_MIN_PLAN_NAME: Record<string, string> = {
  fundraising:        'Individual',
  event_registration: 'Community',
  docs:               'Community',
  crm:                'Ministry',
  accounting:         'Ministry',
  community_chat:     'Ministry',
  tax_receipts:       'Ministry',
};

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

      <h2 className="text-xl font-bold text-gray-900 mb-2">{featureName}</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs leading-relaxed">
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
                : 'border-gray-100 bg-white'
            }`}
          >
            <div className="text-left">
              <p className="font-semibold text-gray-900 text-sm">{plan.name}</p>
              <p className="text-xs text-gray-400">Includes {featureName}</p>
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
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
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
