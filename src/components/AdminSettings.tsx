"use client";
import React, { useState, useEffect } from 'react';
import { Crown, Settings2, Bot, Plug, AlertTriangle, Check, FileText, MessageSquare, SlidersHorizontal, ChevronRight } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures, AI_TELEGRAM_ASSISTANT_ENABLED } from '../utils/plan-features';
import { hasPlatformOverride } from '../utils/tenant-scope';
import SettingsAccordion from './settings/SettingsAccordion';
import OnboardingSection from './settings/OnboardingSection';
import GivingStatementsSection from './settings/GivingStatementsSection';
import SmsSection from './settings/SmsSection';
import AiAssistantSection from './settings/AiAssistantSection';
import IntegrationsSection from './settings/IntegrationsSection';

interface AdminSettingsProps {
  onBack: () => void;
  currentPlan?: TenantPlan;
  onChangePlan: (plan: TenantPlan) => void;
  onCancelPlan: () => void;
  tenantId?: string;
  email?: string;
  /** True only for the plan owner (tenant.ownerId) — gates plan-included AI Assistant. */
  isOwner?: boolean;
  /** Opens the bottom-bar / More-drawer customizer (lives in AdminDashboard). */
  onCustomizeNav?: () => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack, currentPlan, onChangePlan, onCancelPlan, tenantId, email, isOwner, onCustomizeNav }) => {
  const [stripeStatus, setStripeStatus] = useState<string | null>(null);
  const [stripeAddon, setStripeAddon] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Platform-context super admins (apex) see every settings section. On a tenant
  // subdomain these plan-gated sections are gated by the tenant's plan, even for
  // a super admin.
  const platformOverride = hasPlatformOverride();

  const currentPlanData = currentPlan ? PLANS_DISPLAY.find(p => p.id === currentPlan) : null;
  const currentFeatures = currentPlan ? getPlanFeatures(currentPlan) : null;
  // Compact, comma/dot-separated plan summary, e.g. "Unlimited courses · Blog · AI Chat".
  const planSummary = currentFeatures
    ? [
        `${currentFeatures.maxCourses === -1 ? 'Unlimited' : currentFeatures.maxCourses} courses`,
        currentFeatures.blog ? 'Blog' : null,
        currentFeatures.aiChat ? 'AI Chat' : null,
        currentFeatures.crm ? 'CRM' : null,
      ].filter(Boolean).join(' · ')
    : '';
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
      if (addon === 'ai-assistant' && AI_TELEGRAM_ASSISTANT_ENABLED) {
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
    }
  };

  // Sections kept in Settings after the nav overhaul. Plan, Payment, Branding,
  // Domain, and Billing now live in their own tabs/pages (Upgrade, Branding,
  // Fundraising). Icons are neutral gray (no rainbow), rendered at 18px.
  const sections = [
    {
      id: 'onboarding',
      label: 'Onboarding Questions',
      icon: <Settings2 size={18} />,
      content: <OnboardingSection />,
    },
    {
      id: 'giving-statements',
      label: 'Giving Statements',
      icon: <FileText size={18} />,
      content: <GivingStatementsSection />,
      hidden: !platformOverride && !currentFeatures?.givingStatements,
    },
    {
      id: 'sms',
      label: 'SMS (Twilio)',
      icon: <MessageSquare size={18} />,
      content: <SmsSection />,
      hidden: !platformOverride && !currentFeatures?.smsAutomation,
    },
    {
      id: 'ai-assistant',
      label: 'AI Assistant',
      icon: <Bot size={18} />,
      content: <AiAssistantSection currentPlan={currentPlan} email={email} isOwner={isOwner} />,
      hidden: !AI_TELEGRAM_ASSISTANT_ENABLED,
    },
    {
      id: 'integrations',
      label: 'Integrations',
      icon: <Plug size={18} />,
      content: <IntegrationsSection />,
      hidden: !platformOverride && !currentFeatures?.newsletterAutomation,
    },
    {
      id: 'cancel-plan',
      label: 'Cancel Subscription',
      icon: <AlertTriangle size={18} />,
      content: (
        <div>
          <p className="text-gray-600 text-sm mb-4">Cancel your subscription. Your ministry will remain active until the end of the current billing period.</p>
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
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
      {/* Stripe status banners */}
      {AI_TELEGRAM_ASSISTANT_ENABLED && stripeStatus === 'success' && stripeAddon === 'ai-assistant' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
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
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 mb-4">
          <Check size={20} className="text-green-600" />
          <div>
            <p className="text-sm font-semibold text-green-800">Payment successful!</p>
            <p className="text-xs text-green-600">Your plan has been updated. It may take a moment to reflect.</p>
          </div>
          <button onClick={() => setStripeStatus(null)} className="ml-auto text-green-600 hover:text-green-800">✕</button>
        </div>
      )}
      {stripeStatus === 'cancel' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3 mb-4">
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
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-3">
          <Crown size={18} style={{ color: 'var(--brand-color, #d4a017)' }} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{currentPlanData?.name || 'Current'} plan</p>
            <p className="text-xs text-gray-500">{planSummary}</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-3">
          <Crown size={18} style={{ color: 'var(--brand-color, #d4a017)' }} className="shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Super Admin</p>
            <p className="text-xs text-gray-500">Platform-wide access — manage all tenants</p>
          </div>
        </div>
      )}

      {/* Accordion Sections */}
      <SettingsAccordion sections={sections} forceOpen={forceOpen} />

      {/* Customize Navigation — opens the bottom-bar / More-drawer reorder tool */}
      {onCustomizeNav && (
        <button
          onClick={onCustomizeNav}
          className="mt-4 w-full flex items-center gap-3 px-4 py-3.5 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-left"
        >
          <SlidersHorizontal size={18} className="text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">Customize Navigation</p>
            <p className="text-xs text-gray-400">Rearrange your bottom bar &amp; More drawer</p>
          </div>
          <ChevronRight size={16} className="text-gray-400" />
        </button>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 font-display">Cancel Subscription?</h3>
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

    </div>
  );
};

// Display constants (needed for current plan summary)
const PLANS_DISPLAY = [
  { id: 'plus'  as TenantPlan, name: 'Individual', monthlyPrice: '$59/mo',  icon: Crown, color: '#6366f1' },
  { id: 'pro'   as TenantPlan, name: 'Small Team', monthlyPrice: '$119/mo', icon: Crown, color: '#d4a017' },
  { id: 'max'   as TenantPlan, name: 'Community',  monthlyPrice: '$299/mo', icon: Crown, color: '#8b5cf6' },
  { id: 'ultra' as TenantPlan, name: 'Ministry',   monthlyPrice: '$479/mo', icon: Crown, color: '#b45309' },
];

export default AdminSettings;
