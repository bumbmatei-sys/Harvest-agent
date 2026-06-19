"use client";
import React, { useState, useEffect } from 'react';
import { authFetch } from '../../utils/auth-fetch';
import { getTenantId } from './useTenantId';

interface AiAssistantSectionProps {
  currentPlan?: string;
  email?: string;
}

const AiAssistantSection: React.FC<AiAssistantSectionProps> = ({ currentPlan, email }) => {
  const [subscribed, setSubscribed] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Load AI Assistant add-on status from tenant doc
  useEffect(() => {
    const loadAiAssistant = async () => {
      if (loaded) return;
      try {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const tid = userDoc.data().tenantId;
            if (tid) {
              const tenantDoc = await getDoc(doc(db, 'tenants', tid));
              if (tenantDoc.exists()) {
                const data = tenantDoc.data();
                const plan = data.plan;
                const isUltraOrEnterprise = plan === 'ultra' || plan === 'enterprise';
                if (data.addOnAiAssistant || isUltraOrEnterprise) {
                  setSubscribed(true);
                  if (data.addOnAiAssistantCode) setCode(data.addOnAiAssistantCode);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to load AI Assistant status:', e);
      }
      setLoaded(true);
    };
    loadAiAssistant();
  }, []);

  // Handle AI Assistant checkout
  const handleCheckout = async () => {
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
    setLoading(true);
    try {
      const resp = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({
          addOn: 'ai-assistant',
          tenantId: tid,
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
      setLoading(false);
    }
  };

  // Handle AI Assistant cancel
  const handleCancel = async () => {
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setCancelLoading(true);
    try {
      const resp = await authFetch('/api/stripe/cancel-addon', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid, addon: 'ai-assistant' }),
      });
      const data = await resp.json();
      if (data.success) {
        setSubscribed(false);
        alert('AI Assistant add-on will be cancelled at the end of the billing period.');
      } else {
        alert(data.error || 'Failed to cancel add-on');
      }
    } catch (e) {
      console.error('AI Assistant cancel error:', e);
      alert('Failed to cancel add-on. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <div className="mb-4">
      <h4 className="text-base font-bold text-gray-900 mb-1">Personal AI Assistant</h4>
      <p className="text-sm text-gray-600 mb-3">
        Your personal AI assistant that connects to 900+ apps, automates tasks, manages schedules, and streamlines your admin workflow. Accessible through the app interface or Telegram.
      </p>
      {!subscribed ? (
        <>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-2xl font-bold text-gray-900">$150 setup</span>
            <span className="text-gray-400">+</span>
            <span className="text-2xl font-bold text-gray-900">$100/mo</span>
          </div>
          <button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-2" />
                Starting checkout...
              </>
            ) : (
              'Add AI Assistant'
            )}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">Active</span>
            <span className="text-sm text-gray-600">$100/mo</span>
          </div>

          {/* Access Code + Telegram Deep Link */}
          {code && (
            <div className="mb-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700 mb-2 uppercase tracking-wide">Your Access Code</p>
              <div className="flex items-center gap-3 mb-3">
                <code className="text-2xl font-mono font-bold text-indigo-900 tracking-wider">{code}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(code!); alert('Copied!'); }}
                  className="px-3 py-1.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-200 transition-colors"
                >
                  Copy
                </button>
              </div>
              <a
                href={`https://t.me/theharvestapp_bot?start=${code}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#0088cc] text-white text-sm font-semibold rounded-xl hover:bg-[#006da3] transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" /></svg>
                Open in Telegram
              </a>
              <p className="text-xs text-indigo-500 mt-2 text-center">Tap the button above to activate your AI assistant automatically.</p>
            </div>
          )}

          {/* Cancel button only for add-on subscribers, not Ultra/Enterprise */}
          {!['ultra', 'enterprise'].includes(currentPlan || '') && (
            <button
              onClick={handleCancel}
              disabled={cancelLoading}
              className="w-full px-5 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {cancelLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin inline-block mr-2" />
                  Cancelling...
                </>
              ) : (
                'Cancel AI Assistant'
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
};

// Named export for use in parent badge display
export { AiAssistantSection };

export default AiAssistantSection;
