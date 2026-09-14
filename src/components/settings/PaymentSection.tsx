"use client";
import React, { useState, useEffect } from 'react';
import { Check, AlertTriangle, ChevronRight } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';
import { getTenantId } from './useTenantId';
import { STRIPE_CONNECT_ENABLED, STRIPE_CONNECT_HIDDEN_MESSAGE } from '../../lib/stripe-connect-feature';

/**
 * The panel itself — every branch exactly as it shipped. Mounted only while
 * Stripe Connect is visible; see the export at the foot of this file.
 */
const StripeConnectPanel: React.FC = () => {
  const [stripeConnectStatus, setStripeConnectStatus] = useState<string | null>(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
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

  /**
   * Open the church's OWN Stripe dashboard (THE-137).
   *
   * 🔴 The destination is the SERVER's to decide, which is why this cannot be a
   * plain link. Churches connect as Standard accounts (THE-145 PR 2) and sign in
   * at dashboard.stripe.com themselves, but every account connected before that
   * is still Express — and an Express holder has no Stripe password, so for them
   * that same URL is a login wall they can never pass. Only the server knows
   * which it is: the account id lives on a doc no client can read. So it hands
   * back a `url` and this navigates to it, identically for both.
   *
   * For an Express account that url is a single-use login link, minted per
   * click; nothing about it is cached here or anywhere else.
   */
  const handleOpenStripeDashboard = async () => {
    const tid = await getTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setDashboardLoading(true);
    try {
      const resp = await authFetch('/api/stripe/connect/login-link', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Never connected, or connected but onboarding never finished. A login
      // link cannot exist yet, so send them where it can be earned instead of
      // showing an error with no way forward.
      if (data.onboardingRequired) {
        await handleStripeConnect();
        return;
      }
      alert(data.error || 'Failed to open your Stripe dashboard');
    } catch (e) {
      console.error('Stripe dashboard error:', e);
      alert('Failed to open your Stripe dashboard. Please try again.');
    } finally {
      setDashboardLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-body">
        Connect your Stripe account to receive payments from your congregation for donations, tithes, and more.
      </p>

      {/* Stripe Connect */}
      <div className="bg-surface-raised rounded-2xl border border-line-subtle p-6">
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wide mb-4">Stripe Connect</h3>
        {stripeConnectStatus === 'active' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                <Check size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-green-800">Active</p>
                <p className="text-xs text-muted">Your Stripe account is connected and ready to accept payments.</p>
              </div>
              <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Active
              </span>
            </div>
            <button
              onClick={handleOpenStripeDashboard}
              disabled={dashboardLoading || stripeConnectLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-earth text-cream rounded-xl text-sm font-semibold hover:bg-warm-dark dark:bg-cream dark:text-earth dark:hover:bg-stone-200 transition-colors disabled:opacity-50"
            >
              {dashboardLoading ? 'Opening Stripe…' : 'Manage Stripe Dashboard'}
              <ChevronRight size={16} />
            </button>
          </div>
        ) : stripeConnectStatus === 'pending' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-yellow-800">Pending</p>
                <p className="text-xs text-muted">Your Stripe account setup is incomplete. Please finish onboarding.</p>
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
                <p className="text-xs text-muted">Your Stripe account has restrictions. Please update your information.</p>
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
            <p className="text-sm text-body">
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
            <p className="text-xs text-faint">Powered by Stripe Connect</p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 🔴 THE-256 — Stripe Connect, behind the master switch.
 *
 * A WRAPPER rather than an early `return` inside the panel, so the panel's hooks
 * are never conditionally called: while Connect is hidden `StripeConnectPanel`
 * is not mounted at all, which means its `useEffect` never runs and no
 * `tenants/{id}` read is issued to paint a status nobody is being shown. (The
 * four routes refuse with 503 anyway — this is the second layer, not the only
 * one.)
 *
 * 🔴 ONE COMPONENT STILL, AND ONE ANSWER TO "ARE WE CONNECTED". The four status
 * branches above — active, pending, restricted, not connected — are untouched
 * and come back whole with the switch. Nothing here forks the panel, copies its
 * status badge or re-derives the state a second way; that second answer is the
 * bug THE-225 already fixed once, and THE-246 pinned by mounting one component
 * from two screens.
 *
 * ⚠️ GATED ONCE, FOR BOTH SCREENS. `AdminDonations` (THE-246's new home) and
 * `AdminFundraising` are the only two mounts, so this one wrapper covers every
 * surface. `AdminSettings` mounts it nowhere — its Payments row is a POINTER at
 * Donations — and that pointer still leads somewhere: the church's own payment
 * links live on the same screen and are untouched by this ticket.
 *
 * ⚠️ THE MESSAGE AND NOTHING ELSE. `STRIPE_CONNECT_HIDDEN_MESSAGE` is the
 * founder's wording — no explanation, no apology, and deliberately no pointer to
 * the manual links, which are already one card below this on the Donations
 * screen. The "Connect your Stripe account to receive payments…" invitation
 * above is NOT rendered here: it invites an action that cannot be taken, which
 * is the half-working money surface this ticket exists to remove.
 *
 * ⚠️ COLOUR AND SIZE. It reuses the panel's own card chrome verbatim —
 * `bg-surface-raised` / `border-line-subtle` / `text-muted` / `text-body`, every
 * one a semantic token that all four palettes redefine, and not one literal
 * colour. It invents no width: this file has never declared one (its measure
 * comes from whichever screen mounts it, via `form-layout.ts`), and the hidden
 * state adds none. It shrinks no touch target either — it renders no control at
 * all, and the four branches' buttons are byte-for-byte as they were.
 */
const PaymentSection: React.FC = () =>
  STRIPE_CONNECT_ENABLED ? <StripeConnectPanel /> : (
    <div className="space-y-6" data-testid="stripe-connect-hidden">
      <div className="bg-surface-raised rounded-2xl border border-line-subtle p-6">
        {/* THE-362 — the heading, not just the message. THE-350 rewrote the
            sentence below this line and left the processor's NAME standing over
            it, so the founder ("Hide everything that talks about stripe. In
            donations, everywhere.") was still reading it on the one screen that
            ticket was about. The testid is unchanged: it names the STATE, which
            is still "Connect is hidden", and nothing renders it to a church. */}
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wide mb-4">Card giving</h3>
        <p className="text-sm text-body">{STRIPE_CONNECT_HIDDEN_MESSAGE}</p>
      </div>
    </div>
  );

export default PaymentSection;
