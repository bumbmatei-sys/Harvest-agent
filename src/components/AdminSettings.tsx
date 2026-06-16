"use client";
import React, { useState } from 'react';
import { ArrowLeft, Check, Crown, Zap, Building2, Star, ChevronRight, AlertTriangle, Globe } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';

interface AdminSettingsProps {
  onBack: () => void;
  currentPlan: TenantPlan;
  onChangePlan: (plan: TenantPlan) => void;
  onCancelPlan: () => void;
}

const PLANS: { id: TenantPlan; name: string; monthlyPrice: string; yearlyPrice: string; yearlyPromo: string; yearlyOriginal: string; icon: any; color: string; popular?: boolean }[] = [
  { id: 'plus', name: 'Plus', monthlyPrice: '$100/mo', yearlyPrice: '$1,000/yr', yearlyPromo: '$1,000', yearlyOriginal: '$1,200', icon: Zap, color: '#6366f1' },
  { id: 'pro', name: 'Pro', monthlyPrice: '$250/mo', yearlyPrice: '$2,500/yr', yearlyPromo: '$2,500', yearlyOriginal: '$3,000', icon: Crown, color: '#d4a017', popular: true },
  { id: 'ultra', name: 'Ultra', monthlyPrice: '$500/mo', yearlyPrice: '$5,000/yr', yearlyPromo: '$5,000', yearlyOriginal: '$6,000', icon: Star, color: '#8b5cf6' },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 'Custom', yearlyPrice: 'Custom', yearlyPromo: 'Custom', yearlyOriginal: '', icon: Building2, color: '#0b1121' },
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
  const [activeSection, setActiveSection] = useState<'main' | 'upgrade' | 'cancel' | 'branding' | 'domain'>('main');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [brandingLogo, setBrandingLogo] = useState('');
  const [brandingColor, setBrandingColor] = useState('#D4AF37');
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);
  const [domainLoaded, setDomainLoaded] = useState(false);

  const currentPlanData = PLANS.find(p => p.id === currentPlan);
  const currentFeatures = getPlanFeatures(currentPlan);
  const hasBranding = currentFeatures.customDomain; // Ultra+ get branding
  const hasCustomDomain = currentFeatures.customDomain; // Ultra+ get custom domain

  // Load current branding from tenant doc
  const loadBranding = async () => {
    if (brandingLoaded) return;
    try {
      const { auth, db } = await import('../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
            if (tenantDoc.exists()) {
              const config = tenantDoc.data().config || {};
              if (config.logo) setBrandingLogo(config.logo);
              if (config.primaryColor) setBrandingColor(config.primaryColor);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load branding:', e);
    }
    setBrandingLoaded(true);
  };

  // Load current domain settings from tenant doc
  const loadDomain = async () => {
    if (domainLoaded) return;
    try {
      const { auth, db } = await import('../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            setSubdomain(tenantId);
            const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
            if (tenantDoc.exists()) {
              const config = tenantDoc.data().config || {};
              if (config.customDomain) setCustomDomain(config.customDomain);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load domain settings:', e);
    }
    setDomainLoaded(true);
  };

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
              <p className="text-gray-500">{currentPlanData?.monthlyPrice || 'N/A'}</p>
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

      {/* Branding (Ultra/Enterprise only) */}
      {hasBranding && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Branding</h3>
          <p className="text-gray-600 text-sm mb-4">Customize your ministry's appearance — logo and brand color.</p>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-100">
              {brandingLogo ? (
                <img src={brandingLogo} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-gray-300 text-xs">No logo</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-gray-200" style={{ backgroundColor: brandingColor }} />
              <span className="text-sm text-gray-600 font-mono">{brandingColor}</span>
            </div>
            <button
              onClick={() => { setActiveSection('branding'); loadBranding(); }}
              className="ml-auto px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              Edit Branding
            </button>
          </div>
        </div>
      )}

      {/* Domain & Subdomain */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Domain</h3>
        <p className="text-gray-600 text-sm mb-4">Manage your ministry's web address and custom domain.</p>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
            <Globe size={24} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{subdomain || 'Loading...'}.theharvest.app</p>
            <p className="text-xs text-gray-500">
              {hasCustomDomain && customDomain ? `Custom: ${customDomain}` : hasCustomDomain ? 'Custom domain available' : 'Subdomain only'}
            </p>
          </div>
          <button
            onClick={() => { setActiveSection('domain'); loadDomain(); }}
            className="ml-auto px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            Manage Domain
          </button>
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
                {billingPeriod === 'yearly' && plan.yearlyOriginal && (
                  <p className="text-sm text-gray-400 line-through">{plan.yearlyOriginal}/yr</p>
                )}
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {billingPeriod === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice}
                </p>
                {billingPeriod === 'yearly' && plan.id !== 'enterprise' && (
                  <p className="text-xs text-green-600 font-medium mt-1">Save 2 months</p>
                )}
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
                  if (!isCurrent) {
                    onChangePlan(plan.id);
                    setActiveSection('main');
                  }
                }}
                disabled={isCurrent}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-gray-100 text-gray-400 cursor-default'
                    : isDowngrade
                    ? 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    : 'bg-[#d4a017] text-white hover:bg-[#b8941a]'
                }`}
              >
                {isCurrent ? 'Current Plan' : isDowngrade ? `Downgrade to ${plan.name}` : `Upgrade to ${plan.name}`}
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

  const renderBranding = () => (
    <div className="space-y-6">
      <p className="text-gray-600">Update your ministry&apos;s logo and brand color. Changes apply across your entire app.</p>

      {/* Logo Upload */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Logo</h3>
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-xl bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-100">
            {brandingLogo ? (
              <img src={brandingLogo} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-gray-300 text-sm">No logo</span>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
            <input
              type="url"
              value={brandingLogo}
              onChange={(e) => setBrandingLogo(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Paste a URL to your logo image (PNG, SVG, or JPG)</p>
          </div>
        </div>
      </div>

      {/* Brand Color */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Brand Color</h3>
        <div className="flex items-center gap-6">
          <div className="relative">
            <input
              type="color"
              value={brandingColor}
              onChange={(e) => setBrandingColor(e.target.value)}
              className="w-16 h-16 rounded-xl cursor-pointer border-2 border-gray-200 p-1"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Primary Color</label>
            <input
              type="text"
              value={brandingColor}
              onChange={(e) => setBrandingColor(e.target.value)}
              placeholder="#D4AF37"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Used for buttons, accents, and highlights throughout your app</p>
          </div>
        </div>

        {/* Color Preview */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-700 mb-3">Preview</p>
          <div className="flex items-center gap-3">
            <button
              className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold"
              style={{ backgroundColor: brandingColor }}
            >
              Sample Button
            </button>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: brandingColor }} />
              <span className="text-sm text-gray-600">Active indicator</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={async () => {
            setBrandingSaving(true);
            setBrandingSaved(false);
            try {
              const { auth, db } = await import('../firebase');
              const { doc, getDoc, updateDoc } = await import('firebase/firestore');
              if (auth.currentUser) {
                const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
                if (userDoc.exists()) {
                  const tenantId = userDoc.data().tenantId;
                  if (tenantId) {
                    await updateDoc(doc(db, 'tenants', tenantId), {
                      'config.logo': brandingLogo || null,
                      'config.primaryColor': brandingColor,
                      updatedAt: new Date().toISOString(),
                    });
                    setBrandingSaved(true);
                    setTimeout(() => setBrandingSaved(false), 3000);
                  }
                }
              }
            } catch (e) {
              console.error('Failed to save branding:', e);
              alert('Failed to save branding. Please try again.');
            } finally {
              setBrandingSaving(false);
            }
          }}
          disabled={brandingSaving}
          className="px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
        >
          {brandingSaving ? 'Saving...' : 'Save Branding'}
        </button>
        {brandingSaved && (
          <span className="text-sm text-green-600 font-medium">✓ Branding saved successfully</span>
        )}
      </div>
    </div>
  );

  const renderDomain = () => (
    <div className="space-y-6">
      <p className="text-gray-600">
        Manage your ministry's web address. Your subdomain is <strong>{subdomain}.theharvest.app</strong>.
      </p>

      {/* Subdomain (read-only) */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Subdomain</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center">
              <input
                type="text"
                value={subdomain}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 rounded-l-xl text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
              />
              <span className="px-4 py-2.5 border border-l-0 border-gray-200 rounded-r-xl text-sm text-gray-500 bg-gray-100">.theharvest.app</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              To change your subdomain, please contact support. Subdomain changes require migration and may affect your existing links.
            </p>
          </div>
        </div>
      </div>

      {/* Custom Domain (Ultra/Enterprise only) */}
      {hasCustomDomain ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Custom Domain</h3>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
              <Globe size={24} className="text-purple-600" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Custom Domain</label>
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="e.g. ministry.yourchurch.org"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                Enter your custom domain. You&apos;ll need to add a CNAME record pointing to <span className="font-mono">theharvest.app</span>.
              </p>
            </div>
          </div>

          {/* DNS Instructions */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-3">DNS Configuration</p>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-600 mb-2">Add the following CNAME record to your DNS provider:</p>
              <div className="font-mono text-sm bg-white rounded-lg p-3 border border-gray-200">
                <div className="flex justify-between">
                  <span className="text-gray-500">Type:</span>
                  <span className="text-gray-900">CNAME</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Name:</span>
                  <span className="text-gray-900">{customDomain || 'your-domain.com'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Value:</span>
                  <span className="text-gray-900">theharvest.app</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Custom Domain</h3>
          <p className="text-gray-600 text-sm mb-4">
            Custom domains are available on <strong>Ultra</strong> and <strong>Enterprise</strong> plans.
            Upgrade to use your own domain name.
          </p>
          <button
            onClick={() => setActiveSection('upgrade')}
            className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors"
          >
            Upgrade to Unlock
          </button>
        </div>
      )}

      {/* Save Button (only for custom domain) */}
      {hasCustomDomain && (
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setDomainSaving(true);
              setDomainSaved(false);
              try {
                const { auth, db } = await import('../firebase');
                const { doc, getDoc, updateDoc, setDoc, deleteDoc } = await import('firebase/firestore');
                if (auth.currentUser) {
                  const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
                  if (userDoc.exists()) {
                    const tenantId = userDoc.data().tenantId;
                    if (tenantId) {
                      // Normalize domain: lowercase, strip protocol, trailing slashes, www prefix
                      const normalizedDomain = customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

                      // Get old domain to clean up domains collection
                      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
                      const oldDomain = tenantDoc.exists() ? tenantDoc.data().config?.customDomain : null;

                      await updateDoc(doc(db, 'tenants', tenantId), {
                        'config.customDomain': normalizedDomain || null,
                        updatedAt: new Date().toISOString(),
                      });

                      // Write to domains collection for fast API lookup
                      if (normalizedDomain) {
                        await setDoc(doc(db, 'domains', normalizedDomain), { tenantId });
                      }

                      // Delete old domain entry if domain changed
                      if (oldDomain && oldDomain !== normalizedDomain) {
                        await deleteDoc(doc(db, 'domains', oldDomain)).catch(() => {});
                      }

                      setDomainSaved(true);
                      setTimeout(() => setDomainSaved(false), 3000);
                    }
                  }
                }
              } catch (e) {
                console.error('Failed to save domain settings:', e);
                alert('Failed to save domain settings. Please try again.');
              } finally {
                setDomainSaving(false);
              }
            }}
            disabled={domainSaving}
            className="px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
          >
            {domainSaving ? 'Saving...' : 'Save Domain Settings'}
          </button>
          {domainSaved && (
            <span className="text-sm text-green-600 font-medium">✓ Domain settings saved successfully</span>
          )}
        </div>
      )}
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
          {activeSection === 'main' ? 'Settings' : activeSection === 'upgrade' ? 'Upgrade Plan' : activeSection === 'branding' ? 'Branding' : activeSection === 'domain' ? 'Domain & Subdomain' : 'Cancel Plan'}
        </h1>
      </div>

      {activeSection === 'main' && renderMain()}
      {activeSection === 'upgrade' && renderUpgrade()}
      {activeSection === 'branding' && renderBranding()}
      {activeSection === 'domain' && renderDomain()}
    </div>
  );
};

export default AdminSettings;
