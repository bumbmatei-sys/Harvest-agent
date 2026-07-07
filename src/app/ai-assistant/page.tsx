"use client";
import React, { useState, useEffect } from 'react';

type PageState = 'loading' | 'signing-in' | 'connected' | 'not-connected' | 'check-email' | 'expired' | 'error';

const BOT_USERNAME = 'theharvestapp_bot';

export default function AiAssistantPage() {
  const [state, setState] = useState<PageState>('loading');
  const [uid, setUid] = useState<string | null>(null);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const sessionId = params.get('session_id');
      window.history.replaceState({}, '', '/ai-assistant');

      // Arrived from Stripe checkout — webhook will email the magic link
      if (sessionId && !token) {
        setState('check-email');
        return;
      }

      try {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');

        let user = auth.currentUser;

        if (token) {
          setState('signing-in');
          try {
            const { signInWithCustomToken } = await import('firebase/auth');
            const cred = await signInWithCustomToken(auth, token);
            user = cred.user;
          } catch (err: any) {
            if (
              err?.code === 'auth/invalid-custom-token' ||
              err?.code === 'auth/custom-token-mismatch'
            ) {
              setState('expired');
              return;
            }
            throw err;
          }
        }

        if (!user) {
          setState('expired');
          return;
        }

        setUid(user.uid);

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
          setState('not-connected');
          return;
        }

        const data = userDoc.data()!;
        if (!data.hasAIAssistant) {
          setState('expired');
          return;
        }

        if (data.aiAssistantConnected) {
          setTelegramUsername(data.telegramUsername || null);
          setState('connected');
        } else {
          setState('not-connected');
        }
      } catch (err: any) {
        console.error('AI Assistant page error:', err);
        setErrorMsg(err?.message || 'Something went wrong');
        setState('error');
      }
    };
    init();
  }, []);

  const handleResendLink = async () => {
    if (!email) return;
    setResendLoading(true);
    try {
      const resp = await fetch('/api/ai-assistant/resend-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      if (data.success) {
        setResendSent(true);
      } else {
        alert(data.error || 'Failed to resend link');
      }
    } catch {
      alert('Failed to resend link. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!uid) return;
    setDisconnectLoading(true);
    try {
      const { auth } = await import('../../firebase');
      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch('/api/ai-assistant/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ uid }),
      });
      const data = await resp.json();
      if (data.success) {
        setTelegramUsername(null);
        setState('not-connected');
      } else {
        alert(data.error || 'Failed to disconnect');
      }
    } catch {
      alert('Failed to disconnect. Please try again.');
    } finally {
      setDisconnectLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="font-display text-xl font-bold text-gray-900">Harvest AI Assistant</h1>
          <p className="text-sm text-gray-500 mt-1">Your personal ministry assistant on Telegram</p>
        </div>

        {(state === 'loading' || state === 'signing-in') && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">{state === 'signing-in' ? 'Signing you in...' : 'Loading...'}</p>
          </div>
        )}

        {state === 'check-email' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-display font-semibold text-gray-900 mb-2">Payment successful!</h3>
            <p className="text-sm text-gray-500">Check your email for a link to activate your AI assistant. The email may take a minute to arrive.</p>
          </div>
        )}

        {state === 'connected' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6 p-3 bg-green-50 rounded-xl">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <div>
                <p className="text-sm font-semibold text-green-800">Connected</p>
                {telegramUsername && <p className="text-xs text-green-600">@{telegramUsername}</p>}
              </div>
            </div>
            <a
              href={`https://t.me/${BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 mb-3 bg-[#0088cc] text-white text-sm font-semibold rounded-xl hover:bg-[#006da3] transition-colors"
            >
              Open Telegram
            </a>
            <button
              onClick={handleDisconnect}
              disabled={disconnectLoading}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              {disconnectLoading ? 'Disconnecting...' : 'Disconnect'}
            </button>
            <div className="mt-4 pt-4 border-t border-gray-100 text-center">
              <a href="https://billing.stripe.com/p/login" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-500 hover:text-amber-600">
                Manage Subscription &rarr;
              </a>
            </div>
          </div>
        )}

        {state === 'not-connected' && uid && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6 p-3 bg-amber-50 rounded-xl">
              <div className="w-2 h-2 bg-amber-400 rounded-full" />
              <p className="text-sm text-amber-700">Not connected to Telegram yet</p>
            </div>
            <a
              href={`https://t.me/${BOT_USERNAME}?start=${uid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 transition-colors"
            >
              Connect Telegram Bot
            </a>
            <p className="text-xs text-gray-400 mt-2 text-center">Opens Telegram and activates your assistant automatically</p>
            <div className="mt-4 pt-4 border-t border-gray-100 text-center">
              <a href="https://billing.stripe.com/p/login" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-500 hover:text-amber-600">
                Manage Subscription &rarr;
              </a>
            </div>
          </div>
        )}

        {state === 'expired' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="p-3 bg-red-50 rounded-xl mb-4">
              <p className="text-sm text-red-700 font-medium">Link expired</p>
            </div>
            <p className="text-sm text-gray-600 mb-4">Your access link has expired (valid for 1 hour). Enter your email to receive a new one.</p>
            {resendSent ? (
              <div className="p-3 bg-green-50 rounded-xl text-sm text-green-700 text-center">
                Check your email for a new link!
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
                <button
                  onClick={handleResendLink}
                  disabled={resendLoading || !email}
                  className="w-full py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {resendLoading ? 'Sending...' : 'Resend Link'}
                </button>
              </>
            )}
          </div>
        )}

        {state === 'error' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <p className="text-sm text-red-600 mb-2">Something went wrong</p>
            <p className="text-xs text-gray-400">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
