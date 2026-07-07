"use client";
import React, { useState, useEffect } from 'react';
import { authFetch } from '../../utils/auth-fetch';

interface UserData {
  uid: string;
  hasAIAssistant?: boolean;
  aiAssistantConnected?: boolean;
  telegramUsername?: string | null;
  tenantId?: string;
  /** 'plan' when the assistant is included with the Ministry (ultra) plan. */
  aiAssistantSource?: string | null;
  /** Subscription id of a separately purchased add-on. */
  aiAssistantSubscriptionItemId?: string | null;
}

interface AiAssistantSectionProps {
  currentPlan?: string;
  email?: string;
  /** True only for the plan owner (tenant.ownerId) — see AdminDashboard. */
  isOwner?: boolean;
}

const BOT_USERNAME = 'theharvestapp_bot';

const AiAssistantSection: React.FC<AiAssistantSectionProps> = ({ currentPlan, email, isOwner }) => {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({
            uid: user.uid,
            hasAIAssistant: data.hasAIAssistant ?? false,
            aiAssistantConnected: data.aiAssistantConnected ?? false,
            telegramUsername: data.telegramUsername ?? null,
            tenantId: data.tenantId,
            aiAssistantSource: data.aiAssistantSource ?? null,
            aiAssistantSubscriptionItemId: data.aiAssistantSubscriptionItemId ?? null,
          });
        }
      } catch (e) {
        console.error('Failed to load AI Assistant status:', e);
      }
      setLoaded(true);
    };
    loadUserData();
  }, []);

  const handleCheckout = async () => {
    if (!userData) return;
    setCheckoutLoading(true);
    try {
      const resp = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({
          addOn: 'ai-assistant',
          tenantId: userData.tenantId,
          userId: userData.uid,
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
      console.error('AI Assistant checkout error:', e);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Opens the buyer's OWN Stripe billing portal (invoices + cancel). The
  // subscription cancellation itself happens on Stripe's side; the webhook
  // revokes the entitlement when it lands.
  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const resp = await authFetch('/api/ai-assistant/portal', { method: 'POST' });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (e) {
      console.error('AI Assistant portal error:', e);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!userData) return;
    setDisconnectLoading(true);
    try {
      const resp = await authFetch('/api/ai-assistant/disconnect', {
        method: 'POST',
        body: JSON.stringify({ uid: userData.uid }),
      });
      const data = await resp.json();
      if (data.success) {
        setUserData(prev => prev ? { ...prev, aiAssistantConnected: false, telegramUsername: null } : prev);
      } else {
        alert(data.error || 'Failed to disconnect');
      }
    } catch (e) {
      console.error('Disconnect error:', e);
      alert('Failed to disconnect. Please try again.');
    } finally {
      setDisconnectLoading(false);
    }
  };

  if (!loaded) {
    return (
      <div className="mb-4">
        <h4 className="font-display text-sm font-semibold text-gray-900 mb-1">AI Assistant</h4>
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  // Ministry (ultra) plan includes 1 assistant for the plan owner — no separate
  // subscription, no buy/cancel here (cancelling the plan cancels it).
  const isPlanIncluded = currentPlan === 'ultra' && !!isOwner;
  // Separately purchased add-on — managed (incl. cancel) in the buyer's own
  // Stripe portal via Manage billing.
  const hasPurchased = !!userData?.aiAssistantSubscriptionItemId && userData?.aiAssistantSource !== 'plan';
  const hasAssistant = (userData?.hasAIAssistant ?? false) || isPlanIncluded;
  const isConnected = userData?.aiAssistantConnected ?? false;
  const telegramUsername = userData?.telegramUsername;

  return (
    <div className="mb-4">
      <h4 className="font-display text-sm font-semibold text-gray-900 mb-1">AI Assistant</h4>
      <p className="text-sm text-gray-600 mb-3">
        Your personal AI assistant on Telegram — available 24/7 for sermon prep, member care, and ministry guidance.
      </p>

      {hasAssistant && (
        // A still-active purchased subscription wins over the plan-included
        // label: an owner who bought before upgrading keeps billing controls
        // until the webhook cancels the purchase and converts the entitlement.
        !hasPurchased && isPlanIncluded ? (
          <div className="flex items-center gap-3 mb-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
            <div className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
            <p className="text-sm font-medium text-amber-800">Included with your Ministry plan.</p>
          </div>
        ) : hasPurchased ? (
          <div className="flex items-center justify-between gap-3 mb-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <p className="text-sm text-gray-700">AI Assistant — active, <span className="font-semibold">$200/mo</span></p>
            <button
              onClick={handleManageBilling}
              disabled={portalLoading}
              className="px-3 py-1.5 border border-gray-200 bg-white text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {portalLoading ? 'Opening...' : 'Manage billing'}
            </button>
          </div>
        ) : null
      )}

      {!hasAssistant ? (
        <div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-base font-semibold text-gray-900">$200</span>
            <span className="text-sm text-gray-500">/mo per admin</span>
          </div>
          <button
            onClick={handleCheckout}
            disabled={checkoutLoading}
            className="w-full px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            {checkoutLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-2" />
                Starting checkout...
              </>
            ) : (
              'Get Your Personal AI Assistant — $200/mo'
            )}
          </button>
        </div>
      ) : isConnected ? (
        <div>
          <div className="flex items-center gap-3 mb-4 p-3 bg-green-50 rounded-xl border border-green-100">
            <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Connected</p>
              {telegramUsername && (
                <p className="text-xs text-green-600">@{telegramUsername}</p>
              )}
            </div>
          </div>
          <a
            href={`https://t.me/${BOT_USERNAME}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-4 py-2 mb-2 bg-[#0088cc] text-white text-sm font-medium rounded-lg hover:bg-[#006da3] transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
            Open Telegram
          </a>
          <button
            onClick={handleDisconnect}
            disabled={disconnectLoading}
            className="w-full px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {disconnectLoading ? 'Disconnecting...' : 'Disconnect Telegram'}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
            <div className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
            <p className="text-sm text-amber-700">Not connected to Telegram yet</p>
          </div>
          <a
            href={`https://t.me/${BOT_USERNAME}?start=${userData?.uid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
            Connect Telegram Bot
          </a>
          <p className="text-xs text-gray-400 mt-2 text-center">Opens Telegram and activates your assistant automatically</p>
        </div>
      )}
    </div>
  );
};

export { AiAssistantSection };
export default AiAssistantSection;
