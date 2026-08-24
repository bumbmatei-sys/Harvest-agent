'use client';
import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, getIdToken } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Loader2, CreditCard, Sparkles } from 'lucide-react';
import { auth, db } from '../firebase';
import { isSuperAdminEmail } from '../utils/super-admins';
import { checkRosterAdmin } from '../utils/tenant.utils';
import { TenantPlan } from '../types/tenant.types';
import { SIGNUP_CHECKOUT_ENDPOINT, WALLET_FALLBACK_LINE, isReturningFromCheckout, readSignupBillingPeriod, type SignupBillingPeriod } from '../utils/signup-checkout';
import {
  PAYMENT_CONFIRMATION_EVENT,
  completePaymentConfirmation,
  hasSeenPaymentConfirmation,
  readPendingPaymentConfirmation,
} from '../utils/paid-arrival';
import { getTenantIdFromHost } from '../utils/tenant-scope';
import { useForcedLightTheme } from '../lib/theme-runtime';
import FirstRunSetup from './FirstRunSetup';
import WorkspaceHandoff, { CONFIRMS_ACCOUNT, CONFIRMS_PAYMENT } from './WorkspaceHandoff';
import { isTenantAdminRole } from '../lib/roles';

const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';
const BRAND = 'var(--brand-color, #B8962E)';

type GateStatus = 'loading' | 'ready' | 'paying' | 'needs-payment' | 'first-run';

/** Soft gold halo shared by the transitional screens. */
const Halo = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute left-1/2 -translate-x-1/2"
    style={{ top: '-16%', width: 720, height: 480, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
  />
);

/** Full-screen centred message (loading / setting-up) on the cream ground. */
const CenteredScreen: React.FC<{ title: string; subtitle?: string; spin?: boolean }> = ({ title, subtitle, spin = true }) => (
  <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center" style={{ background: 'var(--cream, #FAF8F5)' }}>
    <Halo />
    <div className="relative z-[1] flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={HARVEST_LOGO} alt="Harvest" className="mb-6 h-12 w-auto object-contain" />
      {spin && <Loader2 size={32} className="mb-5 animate-spin" style={{ color: BRAND }} />}
      <h1 className="font-display" style={{ fontWeight: 300, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>{title}</h1>
      {subtitle && <p className="mt-2.5 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>{subtitle}</p>}
    </div>
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
  // The billing term the church chose, read back off the same marker as the
  // plan. Restarting an abandoned ANNUAL checkout on monthly would charge the
  // wrong price for the term they picked — the two travel together, always.
  const [signupBilling, setSignupBilling] = useState<SignupBillingPeriod>('monthly');
  const [signupMinistryName, setSignupMinistryName] = useState<string>('');
  /**
   * THE-214: the address a free signup chose on the signup screen, carried on
   * the same marker as the plan so a restart re-provisions at the SAME address
   * rather than quietly moving the evangelist to a different one.
   */
  const [signupSubdomain, setSignupSubdomain] = useState<string>('');
  /**
   * The tenant's own plan, off the user doc — the DURABLE answer to "was this
   * signup free?", written by whichever path provisioned the account. Read
   * alongside the `signupPlan` intent marker because the two fail in opposite
   * directions: the marker exists before the tenant does, and the plan outlives
   * the marker. Both absent means "unknown", which is treated as paid.
   */
  const [accountPlan, setAccountPlan] = useState<TenantPlan | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // The tenant id first-run setup finished on, i.e. the workspace this user is
  // being handed off to. Non-null means the handoff screen is showing.
  const [handoffTenantId, setHandoffTenantId] = useState<string | null>(null);
  /**
   * THE-214: "this mount watched a free signup go out with no tenant." Set when
   * the user doc shows a free signup in flight, consumed the moment a tenant id
   * lands on the same listener. A ref rather than state because it must be read
   * inside the snapshot callback that also sets it — a state value there would
   * be a render behind and would miss the very transition it exists to catch.
   */
  const freeSignupInFlight = useRef(false);

  // Is the user returning from the payment processor right now? BOTH spellings
  // count (?stripe=success and ?dodo=success): a customer who was mid-checkout
  // when DODO_BILLING_ENABLED was flipped comes back carrying the other
  // processor's marker, and failing to recognise it would show someone who has
  // just paid the "Complete your payment" button — an invitation to pay twice.
  const onCheckoutSuccess = typeof window !== 'undefined'
    && isReturningFromCheckout(window.location.search);

  /**
   * 🔴 THE-138. The tenant whose subdomain hop App.tsx is holding back because
   * this arrival has just paid — i.e. the confirmation is owed HERE, on the
   * origin that took the payment, while the payer's session still exists.
   *
   * Initialised from sessionStorage so a refresh mid-screen re-paints the
   * confirmation instead of racing the callback into performing the hop; kept in
   * sync by the event because the decision is made inside an async auth callback
   * long after this component mounted. Both sources are scoped to a genuine
   * checkout return by `readPendingPaymentConfirmation`.
   */
  const [confirmingTenantId, setConfirmingTenantId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readPendingPaymentConfirmation(window.location.search)
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHeld = () => setConfirmingTenantId(readPendingPaymentConfirmation(window.location.search));
    window.addEventListener(PAYMENT_CONFIRMATION_EVENT, onHeld);
    return () => window.removeEventListener(PAYMENT_CONFIRMATION_EVENT, onHeld);
  }, []);

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
        // Validated on read-back, not just on write: the marker is a Firestore
        // doc the user can write to, and an unrecognised period must fall
        // closed to 'monthly' rather than travel into a checkout body.
        setSignupBilling(readSignupBillingPeriod(data?.signupBilling));
        setSignupMinistryName((data?.signupMinistryName as string) || '');
        setSignupSubdomain((data?.signupSubdomain as string) || '');
        setAccountPlan((data?.plan as TenantPlan) || null);

        /**
         * 🔴 THE-214 — WATCHING A FREE SIGNUP COMPLETE, so the evangelist is
         * told their account exists before being sent to another origin.
         *
         * A paying church gets its confirmation from the paid-arrival lane
         * (`?dodo=success` in the URL, held by App.tsx) and then first-run
         * setup, whose completion paints the handoff. A free signup has NEITHER
         * — no processor comes back with a success URL, and there is no
         * first-run step left once the address is chosen at signup — so without
         * this it would go straight from the signup form into a login prompt on
         * a subdomain, which is the "sign in again with no explanation" the
         * cross-origin copy exists to prevent.
         *
         * ⚠️ THIS IS NOT A SECOND WRITER OF THE PAID ARRIVAL MARKER, and that
         * is the point. It writes no storage key, dispatches no event, reads no
         * query parameter and shares no vocabulary with `paid-arrival.ts`. It
         * is a TRANSITION this component's own listener already observes —
         * "signup in flight with no tenant" becoming "tenant" — remembered in a
         * ref for the lifetime of this mount. The paid lane's marker, event and
         * `?payment_confirmed=` hint are untouched and still have exactly one
         * writer each.
         *
         * ⚠️ Gated on the signup being FREE. The same transition happens on the
         * paid lane the moment a webhook provisions, and firing there would put
         * this screen in front of first-run setup — reordering the paid funnel,
         * which nothing here may do. `signupPlan` is read from the snapshot in
         * hand rather than from state, which has not re-rendered yet.
         */
        const freeSignup = (data?.signupPlan as TenantPlan) === 'free'
          || (data?.plan as TenantPlan) === 'free';
        if (inProgress && !tId && freeSignup) freeSignupInFlight.current = true;
        if (tId && freeSignupInFlight.current) {
          freeSignupInFlight.current = false;
          setHandoffTenantId(tId);
        }

        if (tId) {
          setTenantId(tId);
          stopTenant();
          tenantUnsub = onSnapshot(doc(db, 'tenants', tId), (tSnap) => {
            const t = tSnap.exists() ? tSnap.data() : null;
            // Only a brand-new tenant (explicit false) gates first-run, and only
            // for its admin. Legacy tenants (no field) and members pass through.
            if (!t || t.setupCompleted !== false) { setStatus('ready'); return; }
            if (isTenantAdminRole(role)) { setStatus('first-run'); return; }
            // Roster fallback: the adminEmails roster moved off the public
            // tenant doc to the server-only tenant_private doc, so ask the API.
            checkRosterAdmin(tId)
              .then((isRoster) => setStatus(isRoster ? 'first-run' : 'ready'))
              .catch(() => setStatus('ready'));
          }, () => setStatus('ready'));
        } else {
          stopTenant();
          setTenantId(null);
          // A signup is in flight but no tenant exists yet. ALWAYS start in
          // 'paying' (poll) — even without the ?…=success marker — so a user who paid
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
  }, [onCheckoutSuccess]);

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
        // Returned via a processor success marker → they definitely paid; keep
        // waiting with a softer message. Otherwise the signup looks abandoned →
        // let them pay.
        if (onCheckoutSuccess) setPollTimedOut(true);
        else setStatus('needs-payment');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status, onCheckoutSuccess]);

  /**
   * 🔴 THE-138 part 2 — would the post-first-run handoff below merely REPEAT a
   * confirmation this church has already been given?
   *
   * The church saw "Your payment went through." on the apex, clicked through,
   * hopped, signed in, finished first-run setup — and #298's handoff then said
   * it again. The destination could not tell, because the acknowledgement lived
   * in apex sessionStorage. It now crosses on the hop and is captured into THIS
   * origin's storage on arrival, so `hasSeenPaymentConfirmation()` can finally
   * answer here.
   *
   * 🔴 BOTH CONDITIONS ARE LOAD-BEARING, and the second is the strand guard.
   * Suppressing on "already confirmed" alone would delete the screen for a
   * church that RENAMED its subdomain during first-run: that church is about to
   * be sent to a THIRD origin and really will sign in again, and the sentence
   * warning them is owed at that moment — the apex confirmation named the
   * generated address, not the one they just chose. So the repeat is only
   * suppressed when the handoff would be its SAME-ORIGIN variant, i.e. when the
   * only thing left on the screen is the congratulation they already read.
   *
   * ⚠️ Everything else keeps the screen, deliberately. A church whose webhook
   * landed late, whose tab was closed, or that navigated to the subdomain
   * directly arrives with no acknowledgement and is shown the confirmation
   * exactly as #298 intended. A duplicate is annoying; a missing confirmation
   * after a charge is a chargeback.
   *
   * ⚠️ Resolved with the SHARED host resolver, never an inline hostname parse —
   * `WorkspaceHandoff` decides its own variant the same way, and these two
   * answers MUST agree or the screen is suppressed in the very case whose copy
   * it still needs to deliver.
   */
  const handoffRepeatsGivenConfirmation =
    handoffTenantId !== null
    && handoffTenantId === getTenantIdFromHost()
    && hasSeenPaymentConfirmation();

  // THE-85: the funnel screens this gate renders have NO path of their own —
  // the processor returns the payer to "/?…=success", and a refresh lands on a
  // bare "/". They are only identifiable once the user doc resolves, so the URL
  // cannot classify them and the gate declares them instead.
  //
  // ⚠️ Deliberately NOT `status !== 'ready'`. In 'loading' WITHOUT a checkout
  // marker this gate renders `children`, i.e. the whole signed-in app — forcing
  // light there would flash every dark-mode user light on every single load.
  // Only the states below actually paint a funnel screen.
  const rendersFunnelScreen =
    (handoffTenantId !== null && !handoffRepeatsGivenConfirmation) ||
    confirmingTenantId !== null ||
    status === 'paying' ||
    status === 'needs-payment' ||
    status === 'first-run' ||
    (status === 'loading' && onCheckoutSuccess);
  useForcedLightTheme(rendersFunnelScreen);

  /**
   * 🔴 A FREE SIGNUP IS NEVER RESUMED THROUGH A CHECKOUT. (THE-203)
   *
   * `signupPlan` is read from the user's own Firestore doc, so it can be
   * 'free'. Sending that to SIGNUP_CHECKOUT_ENDPOINT is answered `400 Invalid
   * plan/billing: free/monthly` — free is absent from PRICED_PLAN_ORDER by
   * design — and the button below would spin, fail silently, and leave the
   * evangelist on a payment screen for a plan that costs nothing and cannot be
   * paid for. That is precisely the "permanently flagged mid-signup" trap.
   *
   * The free route is idempotent (it answers with the existing tenant if one
   * turned up in the meantime), so pressing this twice cannot build two
   * churches.
   */
  const isFreeSignup = signupPlan === 'free' || accountPlan === 'free';

  /**
   * THE-214: which sentence the confirmation screen is allowed to say.
   *
   * Derived from the SAME signal as everything else free on this screen, so a
   * tenant cannot be free enough to skip the wallet line and paid enough to be
   * congratulated on a payment. It fails closed to the payment claim — see
   * `CONFIRMS_PAYMENT` — because a church that paid and is told nothing is a
   * chargeback, while a free tenant told nothing is merely quiet.
   */
  const confirms = isFreeSignup ? CONFIRMS_ACCOUNT : CONFIRMS_PAYMENT;

  const restartFreeProvisioning = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setRestarting(true);
    try {
      const token = await user.getIdToken();
      const resp = await fetch('/api/tenants/provision-free', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        // THE-214: the address travels with the plan, exactly as the term does
        // on the paid lane. Restarting without it would hand the evangelist a
        // different address from the one they chose and were shown.
        body: JSON.stringify({
          ministryName: signupMinistryName || '',
          subdomain: signupSubdomain || '',
        }),
      });
      const data = await resp.json();
      // The onSnapshot listener above flips this screen to first-run as soon as
      // the user doc gains its tenantId, so there is nothing to navigate to.
      if (!resp.ok || !data.tenantId) setRestarting(false);
    } catch {
      setRestarting(false);
    }
  };

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
      const resp = await fetch(SIGNUP_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: signupPlan || 'plus',
          billing: signupBilling,
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

  // 🔴 Checked FIRST, ahead of `status`, and deliberately so. Finishing first-run
  // setup renames the tenant: the old tenant doc is deleted and the user doc is
  // re-pointed at the new id. Both of this gate's onSnapshot listeners fire on
  // that — the tenant listener sees its document vanish (`!t`) and the user
  // listener sees a tenant whose `setupCompleted` is now true — and BOTH resolve
  // to `status: 'ready'`. Reading `status` first would therefore replace the
  // handoff screen with the app a beat after it appeared, dumping the payer back
  // into the origin they were being sent away from. Precedence here makes the
  // handoff terminal without having to tear the listeners down.
  // THE-138 part 2: …unless it would only repeat a confirmation this church has
  // already been given on the origin that took the payment (see above). Falling
  // through then is the whole point — `status` has resolved to 'ready' by the
  // rename (or resolves a beat later off the same listener that flipped
  // `setupCompleted`), so the church lands in the admin app it was heading for
  // instead of reading the same congratulation a second time. No navigation is
  // performed here: the screen this replaces offered an IN-ORIGIN /admin link,
  // and the church is already on /admin.
  if (handoffTenantId && !handoffRepeatsGivenConfirmation) {
    return <WorkspaceHandoff tenantId={handoffTenantId} fallbackMinistryName={signupMinistryName} confirms={confirms} />;
  }

  /**
   * 🔴 THE-138: the payment confirmation, BEFORE the origin hop.
   *
   * Checked ahead of `status` for the same reason the handoff above is: by the
   * time we get here the webhook has already provisioned, so the listeners have
   * resolved to 'first-run' (a brand-new tenant with an admin) and reading
   * `status` first would put white-labelling in front of the sentence the payer
   * is looking for — on the last screen before their session stops existing.
   *
   * It renders the SAME component as the post-first-run handoff, deliberately:
   * this is the cross-origin case #298 already wrote the copy for, and it is now
   * the honest one — the church really will sign in again at its new address.
   * `WorkspaceHandoff` decides that from the live host, so nothing here has to
   * tell it which variant to be.
   */
  if (confirmingTenantId) {
    return (
      <WorkspaceHandoff
        tenantId={confirmingTenantId}
        fallbackMinistryName={signupMinistryName}
        /* Always the payment claim, and not via `confirms` above: this render
           is reachable only through `readPendingPaymentConfirmation`, which
           refuses unless the URL says the user is back from a checkout. A
           signup that reached a checkout is a signup that was charged. */
        confirms={CONFIRMS_PAYMENT}
        onContinue={completePaymentConfirmation}
        /* THE-138 part 2: this is the render whose acknowledgement has to
           outlive the origin hop, so its action carries the hint that stops the
           destination saying all of this again. */
        suppressRepeatAtDestination
      />
    );
  }

  if (status === 'ready') return <>{children}</>;

  if (status === 'loading') {
    // Avoid flashing the normal funnel for a paying user mid-resolve.
    return onCheckoutSuccess
      ? <CenteredScreen title="Setting up your account…" subtitle="This only takes a moment." />
      : <>{children}</>;
  }

  if (status === 'paying') {
    // 🔴 THE-214. `pollTimedOut` is only ever set when the URL carries a
    // processor success marker (see the poll effect), so its copy is reachable
    // by a payer alone and stays as it was. The waiting copy is NOT: a free
    // signup sits here for the length of one server request, and "Confirming
    // your payment" was the second place it was told about a payment it never
    // made.
    if (pollTimedOut) {
      return <CenteredScreen spin={false} title="Payment received — finishing setup" subtitle="Almost there. Refresh in a moment if this screen doesn't update on its own." />;
    }
    return isFreeSignup
      ? <CenteredScreen title="Creating your ministry…" subtitle="This only takes a moment." />
      : <CenteredScreen title="Setting up your account…" subtitle="Confirming your payment and creating your ministry. This usually takes a few seconds." />;
  }

  if (status === 'first-run' && tenantId) {
    return (
      <FirstRunSetup
        tenantId={tenantId}
        onFinished={(finalTenantId) => {
          // Hand the new owner off to their own subdomain admin — via a screen,
          // not a redirect. This used to be a bare
          // `window.location.href = https://<id>.theharvest.app/admin`, which
          // teleported someone who had just been charged straight into a login
          // prompt on an origin that (correctly) cannot see their session. The
          // second sign-in is unavoidable and stays; what changes is that it is
          // now explained, and that the customer is told their payment
          // succeeded before being asked for anything.
          setHandoffTenantId(finalTenantId);
        }}
      />
    );
  }

  // needs-payment: closed the Stripe tab before paying.
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center" style={{ background: 'var(--cream, #FAF8F5)' }}>
      <Halo />
      <div className="relative z-[1] flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HARVEST_LOGO} alt="Harvest" className="mb-6 h-12 w-auto object-contain" />
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-brand-lg" style={{ background: 'color-mix(in srgb, var(--brand-color, #C9963A) 13%, white)', color: BRAND }}>
          {isFreeSignup ? <Sparkles size={28} /> : <CreditCard size={28} />}
        </div>
        <h1 className="font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
          {isFreeSignup ? 'Finish setting up' : 'Complete your payment'}
        </h1>
        <p className="mt-2.5 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
          {isFreeSignup
            ? 'Your ministry isn\u2019t active yet. There is nothing to pay \u2014 press the button and we\u2019ll finish creating it.'
            : 'Your ministry isn\u2019t active yet. Finish checkout to create your account and get started.'}
        </p>
        <button
          onClick={isFreeSignup ? restartFreeProvisioning : restartCheckout}
          disabled={restarting}
          className="mt-7 inline-flex items-center gap-2 rounded-lg font-semibold text-white"
          style={{
            background: BRAND, padding: '12px 28px', border: 'none',
            boxShadow: `0 10px 30px -8px color-mix(in srgb, ${BRAND} 42%, transparent)`,
            cursor: restarting ? 'wait' : 'pointer', opacity: restarting ? 0.7 : 1, fontSize: '15px',
          }}
        >
          {restarting
            ? <><Loader2 size={18} className="animate-spin" /> {isFreeSignup ? 'Creating\u2026' : 'Redirecting\u2026'}</>
            : <>{isFreeSignup ? 'Create my ministry' : 'Continue to payment'}</>}
        </button>
        {/* The wallet fallback is card advice. It has no meaning for a tier
            that takes no card, and printing it would put the word "payment"
            back on a screen this ticket exists to keep it off. */}
        {!isFreeSignup && (
          <p className="mt-4 max-w-sm text-xs leading-relaxed" style={{ color: 'var(--text-muted, #8B7355)' }}>
            {WALLET_FALLBACK_LINE}
          </p>
        )}
      </div>
    </div>
  );
};

export default OnboardingGate;
