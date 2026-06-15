"use client";
import React, { useState } from 'react';
import { ArrowLeft, Check, Crown, Zap, Building2, Star, ChevronRight, AlertTriangle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';

interface AdminSettingsProps {
  onBack: () => void;
  currentPlan: TenantPlan;
  onChangePlan: (plan: TenantPlan) => void;
  onCancelPlan: () => void;
}

const PLANS: { id: TenantPlan; name: string; price: string; icon: any; color: string; popular?: boolean }[] = [
  { id: 'plus', name: 'Plus', price: '$100/mo', icon: Zap, color: '#6366f1' },
  { id: 'pro', name: 'Pro', price: '$250/mo', icon: Crown, color: '#d4a017', popular: true },
  { id: 'ultra', name: 'Ultra', price: '$500/mo', icon: Star, color: '#8b5cf6' },
  { id: 'enterprise', name: 'Enterprise', price: 'Custom', icon: Building2, color: '#0b1121' },
];

const FEATURE_COMPARISON: { key: keyof PlanFeatures; label: string; format?: (v: any) => string }[] = [
  { key: 'blog', label: 'Blog & AI Chat' },
  { key: 'aiKnowledge', label: 'AI Knowledge Base' },
  { key: 'map', label: 'Church Map Directory' },
  { key: 'maxChurches', label: 'Churches', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
  { key: 'maxCourses', label: 'Courses', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
  { key: 'maxAdmins', label: 'Admin Accounts', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
  { key: 'customDomain', label: 'Custom Domain' },
];

// Placeholder payment history
const MOCK_PAYMENTS = [
  { id: 1, date: '2025-06-01', amount: '$100.00', plan: 'Plus', status: 'Paid', method: 'Visa •••• 4242' },
  { id: 2, date: '2025-05-01', amount: '$100.00', plan: 'Plus', status: 'Paid', method: 'Visa •••• 4242' },
  { id: 3, date: '2025-04-01', amount: '$100.00', plan: 'Plus', status: 'Paid', method: 'Visa •••• 4242' },
];

const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack, currentPlan, onChangePlan, onCancelPlan }) => {
  const [activeSection, setActiveSection] = useState<'main' | 'upgrade' | 'cancel'>('main');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const currentPlanData = PLANS.find(p => p.id === currentPlan);
  const currentFeatures = getPlanFeatures(currentPlan);

  const renderMain = () => (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Current Plan</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {currentPlanData && (
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${currentPlanData.color}15` }}>
                <currentPlanData.icon size={24} style={{ color: currentPlanData.color }} />
              </div>
            )}
            <div>
              <p className="text-xl font-bold text-gray-900">{currentPlanData?.name || 'Unknown'}</p>
              <p className="text-gray-500">{currentPlanData?.price || 'N/A'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveSection('upgrade')}
              className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors"
            >
              Upgrade Plan
            </button>
          </div>
        </div>

        {/* Quick feature summary */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{currentFeatures.maxChurches === -1 ? '∞' : currentFeatures.maxChurches}</p>
              <p className="text-xs text-gray-500">Churches</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{currentFeatures.maxAdmins === -1 ? '∞' : currentFeatures.maxAdmins}</p>
              <p className="text-xs text-gray-500">Admins</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{currentFeatures.maxCourses === -1 ? '∞' : currentFeatures.maxCourses}</p>
              <p className="text-xs text-gray-500">Courses</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{currentFeatures.blog ? '✓' : '✗'}</p>
              <p className="text-xs text-gray-500">Blog & AI</p>
            </div>
          </div>
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Payment History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Date</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Amount</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Plan</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Status</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Method</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_PAYMENTS.map((payment) => (
                <tr key={payment.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-3 px-2 text-gray-900">{payment.date}</td>
                  <td className="py-3 px-2 text-gray-900 font-medium">{payment.amount}</td>
                  <td className="py-3 px-2 text-gray-600">{payment.plan}</td>
                  <td className="py-3 px-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                      {payment.status}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-gray-500">{payment.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">* Payment processing via Stripe (coming soon)</p>
      </div>

      {/* Cancel Plan */}
      <div className="bg-white rounded-2xl border border-red-100 p-6">
        <h3 className="text-sm font-semibold text-red-500 uppercase tracking-wide mb-2">Danger Zone</h3>
        <p className="text-gray-600 text-sm mb-4">Cancel your subscription. Your ministry will remain active until the end of the current billing period.</p>
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="px-4 py-2 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors"
        >
          Cancel Subscription
        </button>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Cancel Subscription?</h3>
            </div>
            <p className="text-gray-600 text-sm mb-6">
              Your ministry will remain active until the end of the current billing period. After that, all data will be preserved but your ministry will be suspended.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Keep Plan
              </button>
              <button
                onClick={() => { onCancelPlan(); setShowCancelConfirm(false); }}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderUpgrade = () => (
    <div className="space-y-6">
      <button
        onClick={() => setActiveSection('main')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft size={18} />
        <span className="text-sm font-medium">Back to Settings</span>
      </button>

      <h2 className="text-2xl font-bold text-gray-900">Upgrade Your Plan</h2>
      <p className="text-gray-500">Choose the plan that best fits your ministry's needs.</p>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const features = getPlanFeatures(plan.id);
          const isCurrent = plan.id === currentPlan;
          const isDowngrade = PLANS.findIndex(p => p.id === plan.id) < PLANS.findIndex(p => p.id === currentPlan);

          return (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl border-2 p-5 transition-all ${
                isCurrent ? 'border-[#d4a017] shadow-lg' : 'border-gray-100 hover:border-gray-200'
              }`}
            >
              {plan.popular && !isCurrent && (
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
                <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: `${plan.color}15` }}>
                  <plan.icon size={24} style={{ color: plan.color }} />
                </div>
                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="text-2xl font-bold text-gray-900 mt-1">{plan.price}</p>
              </div>

              <div className="space-y-2 mb-5">
                {FEATURE_COMPARISON.map(({ key, label, format }) => {
                  const value = features[key];
                  const display = format ? format(value) : (value ? '✓' : '✗');
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{label}</span>
                      <span className={value ? 'text-green-600 font-medium' : 'text-gray-400'}>{display}</span>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => {
                  if (!isCurrent && !isDowngrade) {
                    onChangePlan(plan.id);
                    setActiveSection('main');
                  }
                }}
                disabled={isCurrent || isDowngrade}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-gray-100 text-gray-400 cursor-default'
                    : isDowngrade
                    ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                    : 'bg-[#d4a017] text-white hover:bg-[#b8941a]'
                }`}
              >
                {isCurrent ? 'Current Plan' : isDowngrade ? 'Downgrade' : `Upgrade to ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mt-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Full Feature Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-3 text-gray-500 font-medium">Feature</th>
                {PLANS.map(p => (
                  <th key={p.id} className="text-center py-3 px-3 text-gray-500 font-medium">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_COMPARISON.map(({ key, label, format }) => (
                <tr key={key} className="border-b border-gray-50">
                  <td className="py-3 px-3 text-gray-900 font-medium">{label}</td>
                  {PLANS.map(p => {
                    const features = getPlanFeatures(p.id);
                    const value = features[key];
                    const display = format ? format(value) : (value ? '✓' : '✗');
                    return (
                      <td key={p.id} className={`py-3 px-3 text-center ${value ? 'text-green-600' : 'text-gray-400'}`}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        {activeSection !== 'main' && (
          <button
            onClick={() => setActiveSection('main')}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
        )}
        <h1 className="text-2xl font-bold text-gray-900">
          {activeSection === 'main' ? 'Settings' : activeSection === 'upgrade' ? 'Upgrade Plan' : 'Cancel Plan'}
        </h1>
      </div>

      {activeSection === 'main' && renderMain()}
      {activeSection === 'upgrade' && renderUpgrade()}
    </div>
  );
};

export default AdminSettings;
