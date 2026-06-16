"use client";
import React, { useState } from 'react';
import { ArrowLeft, Check, Crown, Zap, Building2, Star, ChevronRight, ChevronDown, AlertTriangle, Globe, CreditCard, Palette, Settings2 } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';
import { ImageUpload } from './ImageUpload';

interface AdminSettingsProps {
  onBack: () => void;
  currentPlan: TenantPlan;
  onChangePlan: (plan: TenantPlan) => void;
  onCancelPlan: () => void;
  tenantId?: string;
  email?: string;
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

// Stripe billing — no more mock payments

const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack, currentPlan, onChangePlan, onCancelPlan, tenantId, email }) => {
  const [activeSection, setActiveSection] = useState<'main' | 'upgrade' | 'cancel' | 'branding' | 'domain' | 'onboarding' | 'payment'>('main');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [brandingLogo, setBrandingLogo] = useState('');
  const [brandingColor, setBrandingColor] = useState('#D4AF37');
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [brandingBackgroundImage, setBrandingBackgroundImage] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [stripeConnectStatus, setStripeConnectStatus] = useState<string | null>(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);
  const [paymentLoaded, setPaymentLoaded] = useState(false);
  const [onboardingQuestions, setOnboardingQuestions] = useState<{ id: string; label: string; type: 'text' | 'select' | 'radio' | 'textarea'; options?: string[]; required: boolean; order: number }[]>([]);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingSaved, setOnboardingSaved] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<{ id: string; label: string; type: 'text' | 'select' | 'radio' | 'textarea'; options?: string[]; required: boolean; order: number } | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);

  const getTenantId = async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    try {
      const { auth, db } = await import('../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) return userDoc.data().tenantId || null;
      }
    } catch (e) { console.error('Failed to get tenantId:', e); }
    return null;
  };

  const handleStripeCheckout = async (planId: string) => {
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
    setCheckoutLoading(planId);
    try {
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planId,
          billing: billingPeriod,
          tenantId: tid,
          tenantName: subdomain,
          email: email || undefined,
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
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setPortalLoading(true);
    try {
      const resp = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
              if (config.backgroundImage) setBrandingBackgroundImage(config.backgroundImage);
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

  // Load Stripe Connect status from tenant doc
  const loadPayment = async () => {
    if (paymentLoaded) return;
    try {
      const { auth, db } = await import('../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tid = userDoc.data().tenantId;
          if (tid) {
            const tenantDoc = await getDoc(doc(db, 'tenants', tid));
            if (tenantDoc.exists()) {
              const data = tenantDoc.data();
              if (data.stripeConnectStatus) setStripeConnectStatus(data.stripeConnectStatus);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load payment settings:', e);
    }
    setPaymentLoaded(true);
  };

  // Handle Stripe Connect
  const handleStripeConnect = async () => {
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setStripeConnectLoading(true);
    try {
      const resp = await fetch('/api/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to connect Stripe');
      }
    } catch (e) {
      console.error('Stripe Connect error:', e);
      alert('Failed to connect Stripe. Please try again.');
    } finally {
      setStripeConnectLoading(false);
    }
  };

  // Load onboarding questions from tenant doc
  const loadOnboardingQuestions = async () => {
    if (onboardingLoaded) return;
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
              if (config.onboardingQuestions && Array.isArray(config.onboardingQuestions)) {
                setOnboardingQuestions(config.onboardingQuestions.sort((a: any, b: any) => a.order - b.order));
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load onboarding questions:', e);
    }
    setOnboardingLoaded(true);
  };

  const [stripeStatus, setStripeStatus] = useState<string | null>(null);

  // Check for Stripe return params on mount
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripe = params.get('stripe');
    const stripeConnect = params.get('stripe_connect');
    if (stripe === 'success') {
      setStripeStatus('success');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripe === 'cancel') {
      setStripeStatus('cancel');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripeConnect) {
      setStripeConnectStatus(stripeConnect);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Lazy-load section data when accordion expands
  React.useEffect(() => {
    if (expandedSection === 'branding') loadBranding();
    if (expandedSection === 'domain') loadDomain();
    if (expandedSection === 'payment') loadPayment();
    if (expandedSection === 'onboarding') loadOnboardingQuestions();
  }, [expandedSection]);

  // Accordion toggle helper
  const toggleSection = (id: string) => {
    setExpandedSection(prev => prev === id ? null : id);
  };

  const renderUpgrade = () => (
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
                  if (!isCurrent && !isDowngrade && plan.id !== 'enterprise') {
                    handleStripeCheckout(plan.id);
                  } else if (!isCurrent && isDowngrade) {
                    onChangePlan(plan.id);
                    setActiveSection('main');
                  }
                }}
                disabled={isCurrent || checkoutLoading === plan.id}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-gray-100 text-gray-400 cursor-default'
                    : isDowngrade
                    ? 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    : checkoutLoading === plan.id
                    ? 'bg-[#d4a017]/70 text-white cursor-wait'
                    : 'bg-[#d4a017] text-white hover:bg-[#b8941a]'
                }`}
              >
                {checkoutLoading === plan.id ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecting...
                  </span>
                ) : isCurrent ? 'Current Plan' : isDowngrade ? `Downgrade to ${plan.name}` : plan.id === 'enterprise' ? 'Contact Sales' : `Upgrade to ${plan.name}`}
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

      {/* Background Image (Ultra/Enterprise only) */}
      {currentFeatures.customBackground && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Background Image</h3>
          <p className="text-gray-600 text-sm mb-4">Set a custom background image for your auth/login page.</p>
          <ImageUpload
            value={brandingBackgroundImage}
            onChange={setBrandingBackgroundImage}
            placeholder="Or paste background image URL here"
          />
        </div>
      )}

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
                      'config.backgroundImage': brandingBackgroundImage || null,
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
        Manage your ministry&apos;s web address. Your subdomain is <strong>{subdomain}.theharvest.app</strong>.
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

  const renderOnboarding = () => {
    const questionTypeOptions: { value: 'text' | 'select' | 'radio' | 'textarea'; label: string }[] = [
      { value: 'text', label: 'Text Input' },
      { value: 'textarea', label: 'Text Area' },
      { value: 'select', label: 'Dropdown' },
      { value: 'radio', label: 'Radio Buttons' },
    ];

    const addQuestion = () => {
      const newQ = {
        id: `custom_${Date.now()}`,
        label: '',
        type: 'text' as const,
        options: [],
        required: false,
        order: onboardingQuestions.length,
      };
      setEditingQuestion(newQ);
      setShowQuestionModal(true);
    };

    const editQuestion = (q: typeof onboardingQuestions[0]) => {
      setEditingQuestion({ ...q });
      setShowQuestionModal(true);
    };

    const deleteQuestion = (id: string) => {
      setOnboardingQuestions(prev => prev.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i })));
    };

    const moveQuestion = (index: number, direction: 'up' | 'down') => {
      const newQuestions = [...onboardingQuestions];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newQuestions.length) return;
      [newQuestions[index], newQuestions[targetIndex]] = [newQuestions[targetIndex], newQuestions[index]];
      setOnboardingQuestions(newQuestions.map((q, i) => ({ ...q, order: i })));
    };

    const saveQuestion = () => {
      if (!editingQuestion || !editingQuestion.label.trim()) return;
      const exists = onboardingQuestions.find(q => q.id === editingQuestion.id);
      if (exists) {
        setOnboardingQuestions(prev => prev.map(q => q.id === editingQuestion.id ? editingQuestion : q));
      } else {
        setOnboardingQuestions(prev => [...prev, editingQuestion]);
      }
      setShowQuestionModal(false);
      setEditingQuestion(null);
    };

    const saveAllQuestions = async () => {
      setOnboardingSaving(true);
      setOnboardingSaved(false);
      try {
        const { auth, db } = await import('../firebase');
        const { doc, getDoc, updateDoc } = await import('firebase/firestore');
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const tenantId = userDoc.data().tenantId;
            if (tenantId) {
              await updateDoc(doc(db, 'tenants', tenantId), {
                'config.onboardingQuestions': onboardingQuestions,
                updatedAt: new Date().toISOString(),
              });
              setOnboardingSaved(true);
              setTimeout(() => setOnboardingSaved(false), 3000);
            }
          }
        }
      } catch (e) {
        console.error('Failed to save onboarding questions:', e);
        alert('Failed to save onboarding questions. Please try again.');
      } finally {
        setOnboardingSaving(false);
      }
    };

    return (
      <div className="space-y-6">
        <p className="text-gray-600">
          Manage custom onboarding questions. The default fields (Name, Country, City, Phone, Accepted Jesus) are always shown. Custom questions appear after them.
        </p>

        {/* Add Question Button */}
        <button
          onClick={addQuestion}
          className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors"
        >
          + Add Question
        </button>

        {/* Questions List */}
        {onboardingQuestions.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <p className="text-gray-400 text-sm">No custom questions yet. Click &quot;Add Question&quot; to create one.</p>
          </div>
        )}

        {onboardingQuestions.map((q, index) => (
          <div key={q.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-4">
            <div className="flex flex-col gap-1 pt-1">
              <button onClick={() => moveQuestion(index, 'up')} disabled={index === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs">▲</button>
              <button onClick={() => moveQuestion(index, 'down')} disabled={index === onboardingQuestions.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs">▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-gray-900">{q.label || '(Untitled)'}</span>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{q.type}</span>
                {q.required && <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">Required</span>}
              </div>
              {(q.type === 'select' || q.type === 'radio') && q.options && q.options.length > 0 && (
                <p className="text-xs text-gray-400">Options: {q.options.join(', ')}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => editQuestion(q)} className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">Edit</button>
              <button onClick={() => deleteQuestion(q.id)} className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">Delete</button>
            </div>
          </div>
        ))}

        {/* Save Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={saveAllQuestions}
            disabled={onboardingSaving}
            className="px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
          >
            {onboardingSaving ? 'Saving...' : 'Save Questions'}
          </button>
          {onboardingSaved && (
            <span className="text-sm text-green-600 font-medium">✓ Questions saved successfully</span>
          )}
        </div>

        {/* Question Editor Modal */}
        {showQuestionModal && editingQuestion && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4">
              <h3 className="text-lg font-bold text-gray-900">
                {onboardingQuestions.find(q => q.id === editingQuestion.id) ? 'Edit Question' : 'Add Question'}
              </h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={editingQuestion.label}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, label: e.target.value })}
                  placeholder="e.g. What is your favorite verse?"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={editingQuestion.type}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, type: e.target.value as any })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017]"
                >
                  {questionTypeOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {(editingQuestion.type === 'select' || editingQuestion.type === 'radio') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Options (comma-separated)</label>
                  <input
                    type="text"
                    value={(editingQuestion.options || []).join(', ')}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="e.g. Option A, Option B, Option C"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017]"
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">Required</label>
                <button
                  onClick={() => setEditingQuestion({ ...editingQuestion, required: !editingQuestion.required })}
                  className={`w-10 h-6 rounded-full relative transition-colors ${editingQuestion.required ? 'bg-[#d4a017]' : 'bg-gray-200'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${editingQuestion.required ? 'left-5' : 'left-1'}`} />
                </button>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => { setShowQuestionModal(false); setEditingQuestion(null); }}
                  className="px-4 py-2 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveQuestion}
                  disabled={!editingQuestion.label.trim()}
                  className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPayment = () => (
    <div className="space-y-6">
      <p className="text-gray-600">
        Connect your Stripe account to receive payments from your congregation for donations, tithes, and more.
      </p>

      {/* Stripe Connect */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Stripe Connect</h3>
        {stripeConnectStatus === 'active' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                <Check size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-green-800">Active</p>
                <p className="text-xs text-gray-500">Your Stripe account is connected and ready to accept payments.</p>
              </div>
              <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Active
              </span>
            </div>
            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors"
            >
              Manage Stripe Dashboard
              <ChevronRight size={16} />
            </a>
          </div>
        ) : stripeConnectStatus === 'pending' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-yellow-800">Pending</p>
                <p className="text-xs text-gray-500">Your Stripe account setup is incomplete. Please finish onboarding.</p>
              </div>
              <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                Pending
              </span>
            </div>
            <button
              onClick={handleStripeConnect}
              disabled={stripeConnectLoading}
              className="px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {stripeConnectLoading ? 'Connecting...' : 'Complete Onboarding'}
            </button>
          </div>
        ) : stripeConnectStatus === 'restricted' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-800">Restricted</p>
                <p className="text-xs text-gray-500">Your Stripe account has restrictions. Please update your information.</p>
              </div>
              <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                Restricted
              </span>
            </div>
            <button
              onClick={handleStripeConnect}
              disabled={stripeConnectLoading}
              className="px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {stripeConnectLoading ? 'Connecting...' : 'Update Stripe Account'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              You haven&apos;t connected a Stripe account yet. Connect now to start receiving payments.
            </p>
            <button
              onClick={handleStripeConnect}
              disabled={stripeConnectLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {stripeConnectLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect Stripe Account
                  <ChevronRight size={16} />
                </>
              )}
            </button>
            <p className="text-xs text-gray-400">Powered by Stripe Connect</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Stripe status banners */}
      {stripeStatus === 'success' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3 mb-4">
          <Check size={20} className="text-green-600" />
          <div>
            <p className="text-sm font-semibold text-green-800">Payment successful!</p>
            <p className="text-xs text-green-600">Your plan has been updated. It may take a moment to reflect.</p>
          </div>
          <button onClick={() => setStripeStatus(null)} className="ml-auto text-green-600 hover:text-green-800">✕</button>
        </div>
      )}
      {stripeStatus === 'cancel' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center gap-3 mb-4">
          <AlertTriangle size={20} className="text-yellow-600" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">Checkout cancelled</p>
            <p className="text-xs text-yellow-600">No charges were made. You can try again anytime.</p>
          </div>
          <button onClick={() => setStripeStatus(null)} className="ml-auto text-yellow-600 hover:text-yellow-800">✕</button>
        </div>
      )}

      {/* Current Plan Summary */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
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
        </div>
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
              <p className="text-xs text-gray-500">Blog &amp; AI</p>
            </div>
          </div>
        </div>
      </div>

      {/* Accordion Sections */}
      <div className="space-y-3 mb-4">
        {/* Subscription Plan */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => toggleSection('plan')}
            className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Crown size={20} className="text-[#d4a017]" />
              <span className="text-sm font-semibold text-gray-900">Subscription Plan</span>
            </div>
            <ChevronDown
              size={18}
              className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'plan' ? 'rotate-180' : ''}`}
            />
          </button>
          {expandedSection === 'plan' && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-4">
              {renderUpgrade()}
            </div>
          )}
        </div>

        {/* Payment Settings */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => toggleSection('payment')}
            className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <CreditCard size={20} className="text-purple-600" />
              <span className="text-sm font-semibold text-gray-900">Payment Settings</span>
            </div>
            <ChevronDown
              size={18}
              className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'payment' ? 'rotate-180' : ''}`}
            />
          </button>
          {expandedSection === 'payment' && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-4">
              {renderPayment()}
            </div>
          )}
        </div>

        {/* Branding & Appearance (Ultra/Enterprise only) */}
        {hasBranding && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => toggleSection('branding')}
              className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Palette size={20} className="text-[#d4a017]" />
                <span className="text-sm font-semibold text-gray-900">Branding &amp; Appearance</span>
              </div>
              <ChevronDown
                size={18}
                className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'branding' ? 'rotate-180' : ''}`}
              />
            </button>
            {expandedSection === 'branding' && (
              <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                {renderBranding()}
              </div>
            )}
          </div>
        )}

        {/* Domain Settings */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => toggleSection('domain')}
            className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Globe size={20} className="text-blue-600" />
              <span className="text-sm font-semibold text-gray-900">Domain Settings</span>
            </div>
            <ChevronDown
              size={18}
              className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'domain' ? 'rotate-180' : ''}`}
            />
          </button>
          {expandedSection === 'domain' && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-4">
              {renderDomain()}
            </div>
          )}
        </div>

        {/* Onboarding Questions */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => toggleSection('onboarding')}
            className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Settings2 size={20} className="text-green-600" />
              <span className="text-sm font-semibold text-gray-900">Onboarding Questions</span>
            </div>
            <ChevronDown
              size={18}
              className={`text-gray-400 transition-transform duration-300 ${expandedSection === 'onboarding' ? 'rotate-180' : ''}`}
            />
          </button>
          {expandedSection === 'onboarding' && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-4">
              {renderOnboarding()}
            </div>
          )}
        </div>
      </div>

      {/* Billing Management */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Billing &amp; Payments</h3>
        <p className="text-sm text-gray-600 mb-4">Manage your subscription, update payment methods, and view invoices through Stripe.</p>
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
            <>
              Manage Subscription
              <ChevronRight size={16} />
            </>
          )}
        </button>
        <p className="text-xs text-gray-400 mt-3">Powered by Stripe</p>
      </div>

      {/* Cancel Plan */}
      <div className="bg-white rounded-2xl border border-red-100 p-6 mb-4">
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
};

export default AdminSettings;
