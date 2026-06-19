"use client";
import React, { useState, useEffect } from 'react';
import { Check, AlertTriangle, ChevronRight } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';
import { getTenantId } from './useTenantId';

const PaymentSection: React.FC = () => {
  const [stripeConnectStatus, setStripeConnectStatus] = useState<string | null>(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);
  const [paymentLoaded, setPaymentLoaded] = useState(false);

  // Load Stripe Connect status from tenant doc
  useEffect(() => {
    const loadPayment = async () => {
      if (paymentLoaded) return;
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
    loadPayment();
  }, []);

  // Handle Stripe Connect
  const handleStripeConnect = async () => {
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setStripeConnectLoading(true);
    try {
      const resp = await authFetch('/api/stripe/connect', {
        method: 'POST',
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

  return (
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
};

export default PaymentSection;
