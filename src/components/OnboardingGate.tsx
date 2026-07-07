'use client';
import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, getIdToken } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Loader2, CreditCard } from 'lucide-react';
import { auth, db } from '../firebase';
import { isSuperAdminEmail } from '../utils/super-admins';
import { TenantPlan } from '../types/tenant.types';
import FirstRunSetup from './FirstRunSetup';

const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';
const BRAND = 'var(--brand-color, #B8962E)';
const ADMIN_ROLES = ['admin', 'church_admin', 'super_admin'];

type GateStatus = 'loading' | 'ready' | 'paying' | 'needs-payment' | 'first-run';

/** Full-screen centred message (loading / setting-up). */
const CenteredScreen: React.FC<{ title: string; subtitle?: string; spin?: boolean }> = ({ title, subtitle, spin = true }) => (
  <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={HARVEST_LOGO} alt="Harvest" className="h-16 w-auto object-contain mb-6" />
    {spin && <Loader2 size={32} className="animate-spin mb-4" style={{ color: BRAND }} />}
    <h1 className="text-xl font-semibold text-gray-900 font-display">{title}</h1>
    {subtitle && <p className="text-sm text-gray-500 mt-2 max-w-sm">{subtitle}</p>}
  </div>
);

/**
 * Access gate for the build-on-payment flow. A user who hasn't paid never
 * reaches the working app; a paid user is walked through first-run setup, then in.
 * Super admins (and everyone not mid-signup) pass straight through to `children`.
 */
const OnboardingGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<GateStatus>('loading');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [signupPlan, setSignupPlan] = useState<TenantPlan | null>(null);
  const [signupMinistryName, setSignupMinistryName] = useState<string>('');
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Is the user returning from Stripe right now?
  const onStripeSuccess = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('stripe') === 'success';

  useEffect(() => {
    let userUnsub: (() => void) | null = null;
    let tenantUnsub: (() => void) | null = null;
    const stopUser = () => { if (userUnsub) { userUnsub(); userUnsub = null; } };
    const stopTenant = () => { if (tenantUnsub) { tenantUnsub(); tenantUnsub = null; } };

    const authUnsub = onAuthStateChanged(auth, (user) => {
      stopUser(); stopTenant();
      if (!user) { setStatus('ready'); setTenantId(null); return; }
      if (isSuperAdminEmail(user.email)) { setStatus('ready'); return; }

      userUnsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const tId = (data?.tenantId as string) || null;
        const role = (data?.role as string) || 'user';
        const inProgress = data?.signupInProgress === true;
        setSignupPlan((data?.signupPlan as TenantPlan) || null);
        setSignupMinistryName((data?.signupMinistryName as string) || '');

        if (tId) {
          setTenantId(tId);
          stopTenant();
          tenantUnsub = onSnapshot(doc(db, 'tenants', tId), (tSnap) => {
            const t = tSnap.exists() ? tSnap.data() : null;
            const email = (user.email || '').toLowerCase();
            const isAdminUser = ADMIN_ROLES.includes(role)
              || (Array.isArray(t?.adminEmails) && t!.adminEmails.some((e: string) => (e || '').toLowerCase() === email));
            // Only a brand-new tenant (explicit false) gates first-run, and only
            // for its admin. Legacy tenants (no field) and members pass through.
            if (t && t.setupCompleted === false && isAdminUser) setStatus('first-run');
            else setStatus('ready');
          }, () => setStatus('ready'));
        } else {
          stopTenant();
          setTenantId(null);
          // A signup is in flight but no tenant exists yet. ALWAYS start in
          // 'paying' (poll) — even without ?stripe=success — so a user who paid
          // but refreshed/returned without the param is never shown a re-checkout
          // button (which would double-charge). The webhook flips us to first-run
          // when the tenant lands; only a genuinely abandoned signup falls through
          // to 'needs-payment' after the poll times out (see the poll effect).
          if (inProgress) setStatus('paying');
          else setStatus('ready');
        }
      }, () => setStatus('ready'));
    });

    return () => { authUnsub(); stopUser(); stopTenant(); };
  }, [onStripeSuccess]);

  // 'paying': the webhook is asynchronous. onSnapshot flips us to first-run the
  // moment tenantId lands; meanwhile force-refresh the token so claims propagate,
  // and after ~30s soften the message.
  useEffect(() => {
    if (status !== 'paying') { setPollTimedOut(false); return; }
    let elapsed = 0;
    const interval = setInterval(async () => {
      elapsed += 2000;
      try { if (auth.currentUser) await getIdToken(auth.currentUser, true); } catch { /* ignore */ }
      if (elapsed >= 30000) {
        clearInterval(interval);
        // Returned via Stripe success → they definitely paid; keep waiting with a
        // softer message. Otherwise the signup looks abandoned → let them pay.
        if (onStripeSuccess) setPollTimedOut(true);
        else setStatus('needs-payment');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status, onStripeSuccess]);

  const restartCheckout = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setRestarting(true);
    try {
      let referrerId: string | undefined;
      try {
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) referrerId = JSON.parse(stored).id || undefined;
      } catch { /* none */ }
      const token = await user.getIdToken();
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: signupPlan || 'plus',
          billing: 'monthly',
          ministryName: signupMinistryName || '',
          ...(referrerId ? { referrerId } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) window.location.href = data.url;
      else setRestarting(false);
    } catch {
      setRestarting(false);
    }
  };

  if (status === 'ready') return <>{children}</>;

  if (status === 'loading') {
    // Avoid flashing the normal funnel for a paying user mid-resolve.
    return onStripeSuccess
      ? <CenteredScreen title="Setting up your account…" subtitle="This only takes a moment." />
      : <>{children}</>;
  }

  if (status === 'paying') {
    return pollTimedOut
      ? <CenteredScreen spin={false} title="Payment received — finishing setup" subtitle="Almost there. Refresh in a moment if this screen doesn't update on its own." />
      : <CenteredScreen title="Setting up your account…" subtitle="Confirming your payment and creating your ministry. This usually takes a few seconds." />;
  }

  if (status === 'first-run' && tenantId) {
    return (
      <FirstRunSetup
        tenantId={tenantId}
        onFinished={(finalTenantId) => {
          // Hand the new owner off to their own subdomain admin. (Auth is per-origin,
          // so they'll sign in once on the subdomain — expected until we add a
          // seamless cross-subdomain handoff.)
          window.location.href = `https://${finalTenantId}.theharvest.app/admin`;
        }}
      />
    );
  }

  // needs-payment: closed the Stripe tab before paying.
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={HARVEST_LOGO} alt="Harvest" className="h-16 w-auto object-contain mb-6" />
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)' }}>
        <CreditCard size={26} style={{ color: BRAND }} />
      </div>
      <h1 className="text-xl font-semibold text-gray-900 font-display">Complete your payment</h1>
      <p className="text-sm text-gray-500 mt-2 max-w-sm">
        Your ministry isn&apos;t active yet. Finish checkout to create your account and get started.
      </p>
      <button
        onClick={restartCheckout}
        disabled={restarting}
        style={{
          marginTop: '24px', display: 'inline-flex', alignItems: 'center', gap: '8px', background: BRAND,
          color: '#fff', fontWeight: 600, padding: '12px 28px', borderRadius: '12px', border: 'none',
          cursor: restarting ? 'wait' : 'pointer', opacity: restarting ? 0.7 : 1, fontSize: '15px',
        }}
      >
        {restarting ? <><Loader2 size={18} className="animate-spin" /> Redirecting…</> : <>Continue to Payment</>}
      </button>
    </div>
  );
};

export default OnboardingGate;
