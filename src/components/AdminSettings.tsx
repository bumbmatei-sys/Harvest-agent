"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, Crown, Palette, Globe, CreditCard, Settings2, Bot, Plug, AlertTriangle, Share2, Check, ChevronRight } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';
import EnterpriseContactModal from './EnterpriseContactModal';
import AffiliateSection from './AffiliateSection';
import SettingsAccordion from './settings/SettingsAccordion';
import PlanUpgradeSection from './settings/PlanUpgradeSection';
import BrandingSection from './settings/BrandingSection';
import DomainSection from './settings/DomainSection';
import PaymentSection from './settings/PaymentSection';
import OnboardingSection from './settings/OnboardingSection';
import AiAssistantSection from './settings/AiAssistantSection';
import IntegrationsSection from './settings/IntegrationsSection';

interface AdminSettingsProps {
  onBack: () => void;
  currentPlan?: TenantPlan;
  onChangePlan: (plan: TenantPlan) => void;
  onCancelPlan: () => void;
  tenantId?: string;
  email?: string;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack, currentPlan, onChangePlan, onCancelPlan, tenantId, email }) => {
  const [enterpriseModalOpen, setEnterpriseModalOpen] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<string | null>(null);
  const [stripeAddon, setStripeAddon] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const currentPlanData = currentPlan ? PLANS_DISPLAY.find(p => p.id === currentPlan) : null;
  const currentFeatures = currentPlan ? getPlanFeatures(currentPlan) : null;
  const hasBranding = currentFeatures?.customBackground;
  const hasCustomDomain = currentFeatures?.customDomain;
  const [forceOpen, setForceOpen] = useState<string | null>(null);

  // Handle Stripe return URL params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripe = params.get('stripe');
    const stripeConnect = params.get('stripe_connect');
    const addon = params.get('addon');
    if (stripe === 'success') {
      setStripeStatus('success');
      if (addon === 'ai-assistant') {
        setStripeAddon('ai-assistant');
        setForceOpen('ai-assistant');
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripe === 'cancel') {
      setStripeStatus('cancel');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripeConnect) {
      setStripeStatus(stripeConnect);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleManageSubscription = async () => {
    const { auth, db } = await import('../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const { authFetch } = await import('../utils/auth-fetch');

    let tid = tenantId;
    if (!tid && auth.currentUser) {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (userDoc.exists()) tid = userDoc.data().tenantId || null;
    }
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

  const sections = [
    {
      id: 'plan',
      label: 'Subscription Plan',
      icon: <Crown size={20} className="text-[#d4a017]" />,
      content: <PlanUpgradeSection currentPlan={currentPlan} tenantId={tenantId} email={email} />,
    },
    {
      id: 'payment',
      label: 'Payment Settings',
      icon: <CreditCard size={20} className="text-purple-600" />,
      content: <PaymentSection />,
    },
    {
      id: 'branding',
      label: 'Branding & Appearance',
      icon: <Palette size={20} className="text-[#d4a017]" />,
      content: <BrandingSection currentFeatures={currentFeatures} />,
      hidden: !hasBranding,
    },
    {
      id: 'domain',
      label: 'Domain Settings',
      icon: <Globe size={20} className="text-blue-600" />,
      content: <DomainSection hasCustomDomain={!!hasCustomDomain} />,
    },
    {
      id: 'onboarding',
      label: 'Onboarding Questions',
      icon: <Settings2 size={20} className="text-green-600" />,
      content: <OnboardingSection />,
    },
    {
      id: 'ai-assistant',
      label: 'AI Assistant',
      icon: <Bot size={20} className="text-indigo-600" />,
      content: <AiAssistantSection currentPlan={currentPlan} email={email} />,
    },
    {
      id: 'integrations',
      label: 'Integrations',
      icon: <Plug size={20} className="text-blue-600" />,
      content: <IntegrationsSection />,
      hidden: !currentFeatures?.newsletterAutomation,
    },
    {
      id: 'affiliate',
      label: 'Affiliate Program',
      icon: <Share2 size={20} className="text-green-600" />,
      content: <AffiliateSection />,
    },
    {
      id: 'billing',
      label: 'Billing & Payments',
      icon: <CreditCard size={20} className="text-gray-600" />,
      content: (
        <div>
          <p className="text-sm text-gray-600 mb-4">Manage your subscription, update payment methods, and view invoices through Stripe.</p>
          <button
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {portalLoading ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Opening portal...</>
            ) : (
              <>Manage Subscription <ChevronRight size={16} /></>
            )}
          </button>
          <p className="text-xs text-gray-400 mt-3">Powered by Stripe</p>
        </div>
      ),
    },
    {
      id: 'cancel-plan',
      label: 'Cancel Subscription',
      icon: <AlertTriangle size={20} className="text-red-500" />,
      content: (
        <div>
          <p className="text-gray-600 text-sm mb-4">Cancel your subscription. Your ministry will remain active until the end of the current billing period.</p>
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="px-4 py-2 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors"
          >
            Cancel Subscription
          </button>
        </div>
      ),
      hidden: !currentPlan,
    },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Stripe status banners */}
      {stripeStatus === 'success' && stripeAddon === 'ai-assistant' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <Check size={20} className="text-green-600" />
            <div>
              <p className="text-sm font-semibold text-green-800">AI Assistant activated!</p>
              <p className="text-xs text-green-600">Your access code is ready. Tap below to connect your Telegram bot.</p>
            </div>
            <button onClick={() => { setStripeStatus(null); setStripeAddon(null); }} className="ml-auto text-green-600 hover:text-green-800">✕</button>
          </div>
          <a
            href="https://t.me/theharvestapp_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#0088cc] text-white text-sm font-semibold rounded-xl hover:bg-[#006da3] transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            Open in Telegram
          </a>
        </div>
      )}
      {stripeStatus === 'success' && !stripeAddon && (
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
      {currentPlan ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Current Plan</h3>
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
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{currentFeatures?.maxChurches === -1 ? '∞' : currentFeatures?.maxChurches}</p>
                <p className="text-xs text-gray-500">Churches</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{currentFeatures?.maxAdmins === -1 ? '∞' : currentFeatures?.maxAdmins}</p>
                <p className="text-xs text-gray-500">Admins</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{currentFeatures?.maxCourses === -1 ? '∞' : currentFeatures?.maxCourses}</p>
                <p className="text-xs text-gray-500">Courses</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{currentFeatures?.blog ? '✓' : '✗'}</p>
                <p className="text-xs text-gray-500">Blog</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{currentFeatures?.aiChat ? '✓' : '✗'}</p>
                <p className="text-xs text-gray-500">AI Chat</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-50">
              <span className="text-amber-500 text-lg">👑</span>
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">Super Admin</p>
              <p className="text-gray-500 text-sm">Platform-wide access — manage all tenants</p>
            </div>
          </div>
        </div>
      )}

      {/* Accordion Sections */}
      <SettingsAccordion sections={sections} defaultOpen="plan" forceOpen={forceOpen} />

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
              <button onClick={() => setShowCancelConfirm(false)} className="px-4 py-2 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
                Keep Plan
              </button>
              <button onClick={() => { handleManageSubscription(); setShowCancelConfirm(false); }} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors">
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <EnterpriseContactModal isOpen={enterpriseModalOpen} onClose={() => setEnterpriseModalOpen(false)} />
    </div>
  );
};

// Display constants (needed for current plan summary)
const PLANS_DISPLAY = [
  { id: 'plus' as TenantPlan, name: 'Individual', monthlyPrice: '$49/mo', icon: Crown, color: '#6366f1' },
  { id: 'pro' as TenantPlan, name: 'Community', monthlyPrice: '$99/mo', icon: Crown, color: '#d4a017' },
  { id: 'max' as TenantPlan, name: 'Church', monthlyPrice: '$199/mo', icon: Crown, color: '#8b5cf6' },
  { id: 'ultra' as TenantPlan, name: 'Ministry', monthlyPrice: '$349/mo', icon: Crown, color: '#b45309' },
  { id: 'enterprise' as TenantPlan, name: 'Enterprise', monthlyPrice: 'Custom', icon: Crown, color: '#0b1121' },
];

export default AdminSettings;
