"use client";
import React, { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Church, ArrowRight, Sparkles, Loader2, AlertCircle, Globe, CheckCircle2 } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { PLAN_DISPLAY_NAMES, PRICED_PLAN_ORDER } from '../utils/plan-features';
import { SIGNUP_CHECKOUT_ENDPOINT, WALLET_FALLBACK_LINE, resolveSignupBillingPeriod } from '../utils/signup-checkout';
import { TERM_BILLED_PHRASE } from '../utils/plan-features';
import { isSubdomainAvailable } from '../utils/tenant.utils';

const BRAND = 'var(--brand-color, #B8962E)';
const SUCCESS = 'var(--brand-success, #6E8E52)';
const DANGER = 'var(--brand-danger, #C4553B)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/* ── Shared brand chrome (cream editorial ground, Fraunces display) ─────────── */

const MinShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-14 sm:py-20"
    style={{ background: 'var(--cream, #FAF8F5)' }}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={{ top: '-18%', width: 760, height: 540, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
    />
    <div className="absolute left-8 top-8 hidden items-center gap-2 sm:flex" style={{ color: 'var(--text-faint, #A89A87)' }}>
      <span className="h-px w-6" style={{ background: 'var(--stone-300, #D6CCBE)' }} />
      <span className="text-xs font-medium">The digital foundation for ministries</span>
    </div>
    <div className="relative z-[1] w-full" style={{ maxWidth: 452 }}>{children}</div>
  </div>
);

interface ChurchOnboardingProps {
  onComplete: () => void;
  signupPlan?: TenantPlan;
}

/**
 * Minimal pre-payment signup: the user's login already exists (from AuthPage),
 * so all we collect here is the ministry name + the chosen plan, then send them
 * straight to the processor's hosted Checkout. NO tenant is created client-side
 * — the PROCESSOR'S WEBHOOK builds the tenant once payment lands
 * (build-on-payment onboarding). Which processor that is follows
 * `DODO_BILLING_ENABLED`: with it true, `/api/dodo/checkout` and the Dodo
 * webhook; with it false, `/api/stripe/checkout` and the Stripe webhook, exactly
 * as before. Subdomain, domain, logo, colour and description are claimed in the
 * first-run "Finish setup" screen after payment.
 *
 * The plan is chosen upstream (marketing site → ?plan=…&signup=church) and is
 * shown here read-only — there is intentionally NO in-app plan picker.
 *
 * 🔴 THE-214 — TWO LANES, ONE SCREEN. Everything above describes the PAID lane
 * and still holds for it, unchanged. The Forever Free lane collects a SUBDOMAIN
 * instead of a ministry name and provisions the tenant in place, because it has
 * no payment to send anyone to and therefore no reason to defer the address to
 * a post-payment screen. The two lanes are separated by `isFree` and share this
 * screen's chrome; nothing in the paid lane is conditional on the free one.
 */
const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ signupPlan }) => {
  const urlPlan = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('plan') as TenantPlan | null
    : null;
  // `?plan=` is URL-controlled — validate so a deleted tier can never be
  // selected, and fail closed to 'plus'.
  //
  // 🔴 AGAINST `PRICED_PLAN_ORDER`, NOT `PLAN_ORDER`. This screen is the church
  // signup funnel and every plan it can select ends in a Dodo checkout. The
  // Forever Free tier is in `PLAN_ORDER` and has no product, so validating
  // against that list would let `?plan=free` through to a checkout that cannot
  // be built — the same hole the two Dodo routes had (see the note on
  // `readPlan` in /api/dodo/checkout). A free tenant is provisioned by the free
  // signup path (THE-203), never through here.
  const selectedPlan: TenantPlan =
    signupPlan || (urlPlan && (PRICED_PLAN_ORDER as readonly string[]).includes(urlPlan) ? urlPlan : 'plus');

  // The period is chosen upstream on the pricing page (where the prices are
  // shown), validated here, displayed read-only. THE-135: by the time this
  // screen renders, the /auth redirect has usually dropped the query string —
  // so the period is read the way the plan is read: URL first, then the
  // sessionStorage lane App.tsx captured it into. Both sources are untrusted
  // and fail closed to 'monthly' — a link with no period (or a mangled one)
  // buys exactly what signup sold before annual.
  const selectedBilling = resolveSignupBillingPeriod(
    typeof window !== 'undefined' ? window.location.search : '',
  );

  /**
   * 🔴 THE-214 — THE FREE LANE ASKS FOR AN ADDRESS, NOT A CHURCH NAME.
   *
   * Forever Free is sold to a single evangelist. There is no church, so "Name
   * your ministry" asks for something that does not exist, and the address the
   * evangelist actually cares about was then collected a whole screen later, in
   * first-run setup, on the far side of a bounce through the member app. This
   * lane collapses that: the ONE thing a free signup must decide is decided
   * here, and `/api/tenants/provision-free` builds the tenant at it directly, so
   * there is nothing left for a first-run screen to ask.
   *
   * ⚠️ The tenant still gets a `name` — the label chosen here, verbatim. It is
   * NOT left blank: `tenant.name` drives the admin header, the white-label PWA
   * manifest and every public page (calendar, form, campaign, post), and a blank
   * one would show an empty heading on all of them. Using the address the user
   * chose is the only value here that was chosen by them rather than invented.
   *
   * ⚠️ The paid lane below is untouched, deliberately and to the element: it
   * still asks for a ministry name, still shows the term, and still ends at the
   * processor's checkout. A church that pays sees exactly what it saw before.
   */
  const isFree = selectedPlan === 'free';

  const [ministryName, setMinistryName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [subStatus, setSubStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [focus, setFocus] = useState(false);

  /**
   * Live availability, the same check and the same debounce `FirstRunSetup`
   * runs — this screen has taken over that screen's job for the free tier, so
   * it has to answer the same question at the same moment.
   *
   * ⚠️ A failed lookup reads as AVAILABLE, exactly as first-run treats it. The
   * server settles the name for real (`generateUniqueSubdomain` re-checks and
   * suffixes a collision rather than refusing), so a transient read error must
   * not lock someone out of their own signup — the worst it can cost is a
   * suffix on an address the check could not confirm.
   */
  useEffect(() => {
    if (!isFree) return;
    if (subdomain.length < 3) { setSubStatus('idle'); return; }
    setSubStatus('checking');
    const timer = setTimeout(async () => {
      try {
        setSubStatus((await isSubdomainAvailable(subdomain)) ? 'available' : 'taken');
      } catch {
        setSubStatus('available');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [isFree, subdomain]);

  const canSubmit = isFree
    ? subdomain.length >= 3 && subStatus === 'available'
    : ministryName.trim().length >= 2;

  const handleContinue = async () => {
    const user = auth.currentUser;
    if (!user) { setError('You must be logged in.'); return; }
    if (!canSubmit) {
      setError(isFree ? 'Choose a web address to continue.' : 'Ministry name is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // 1) Lightweight marker so the app knows a signup is in flight (gates the
      //    "Complete your payment" / "Setting up…" screens). No tenant, no role,
      //    no plan, no claims are written here — the webhook owns all of that.
      // `signupPlan` + `signupBilling` + `signupMinistryName` let the first-run
      // gate re-start checkout if the user closes the Stripe tab before paying.
      // The period travels WITH the plan: a church that chose annual and
      // abandoned the tab must not be silently restarted on monthly.
      //
      // 🔴 THE-92: `signupInProgress` is written HERE, before checkout is
      // attempted, and that is deliberate — it is what makes an abandoned
      // signup RECOVERABLE rather than what strands it. It is the only thing
      // that routes the church back to the resumable screen: App.tsx reads it
      // to leave a tenant-less mid-signup user alone instead of bouncing them
      // into the generic funnel, and OnboardingGate reads it to render
      // "Complete your payment" with a restart button that re-buys the SAME
      // plan and term off this marker. Writing it later (say, only once the
      // checkout POST has returned a URL) would leave a church that abandoned
      // before that point with no marker at all, and the generic member
      // onboarding funnel is where they would land — losing the plan, the
      // term and the ministry name they had already chosen.
      //
      // Only the processors clear it (`signupInProgress: false`, one release
      // per processor: Dodo provisioning and the Stripe webhook). There is
      // deliberately NO client-side release — a church that has paid but
      // whose webhook is still in flight must never be shown a re-checkout
      // button, which is a double charge.
      //
      // 🔴 THE-214, THE FREE HALF OF THE SAME MARKER. It is written for a free
      // signup too, and must be: it is the recovery thread above, and a free
      // signup can still be interrupted between this write and the tenant
      // landing (a dropped request, a closed tab). What differs is what rides
      // on it.
      //
      //   `signupBilling` is OMITTED. Free has no billing term — nothing about
      //     this signup is ever billed — and stamping one would put a term on a
      //     tier that has no price to attach it to. `resolveSignupBillingPeriod`
      //     fails closed to 'monthly', so writing it unconditionally is not a
      //     harmless default: it is the word "monthly" recorded against an
      //     account that pays nothing, and `OnboardingGate` reads this marker
      //     back to restart a checkout.
      //   `signupSubdomain` is ADDED, so a restart re-provisions at the SAME
      //     address the evangelist chose rather than silently landing them on a
      //     different one — the free equivalent of the term travelling with the
      //     plan on the paid lane.
      //
      // ⚠️ Still no client-side release of `signupInProgress` on either lane.
      // On the free lane the server clears it inside `provisionFreeTenant`, in
      // the same request that creates the tenant, which is why no webhook is
      // needed and why a free signup is never left flagged.
      const marker = isFree
        ? {
            signupInProgress: true,
            signupPlan: selectedPlan,
            signupMinistryName: subdomain,
            signupSubdomain: subdomain,
          }
        : {
            signupInProgress: true,
            signupPlan: selectedPlan,
            signupBilling: selectedBilling,
            signupMinistryName: ministryName.trim(),
          };
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await updateDoc(userRef, marker);
      } else {
        // 🔴 THE-73: NO `termsAccepted` here. This screen displays no terms,
        // no link and no checkbox, so it has no evidence of consent to record
        // — it can only assume. AuthPage is the consent point: it shows the
        // sentence and links the canonical Terms/Privacy documents beside the
        // submit button, and it records `termsAccepted` on all four of its
        // paths (Google new/existing, email signup/login). Asserting consent
        // from here would be a second writer of a consent record whose screen
        // never presented anything — under audit that is a claim that did not
        // happen, which is worse than no record at all. Nothing existing is
        // deleted or overwritten: this doc is only created when none exists,
        // and a doc that already carries the field keeps it untouched (the
        // updateDoc branch above writes the marker fields only).
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || (isFree ? subdomain : ministryName.trim()),
          role: 'user',
          createdAt: new Date().toISOString(),
          ...marker,
        });
      }

      // 2) Pull any affiliate referrer captured earlier (kept across the flow).
      let referrerId: string | undefined;
      try {
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) {
          const parsed = JSON.parse(stored);
          referrerId = parsed.id || undefined;
        }
      } catch { /* no referrer */ }

      // 3) Straight to the processor's Checkout — the webhook creates the tenant
      //    on success. Which processor is `SIGNUP_CHECKOUT_ENDPOINT`'s decision,
      //    driven by DODO_BILLING_ENABLED; the request body is identical either
      //    way, including the `referrerId` that carries affiliate attribution
      //    into subscription metadata.
      const token = await user.getIdToken();

      // ── 🔴 THE FREE FORK (THE-203). ───────────────────────────────────────
      //
      // Forever Free has no Dodo product, so it has no checkout to send anyone
      // to. `/api/dodo/checkout` validates against PRICED_PLAN_ORDER and would
      // answer `400 Invalid plan/billing: free/monthly` — which is the RIGHT
      // answer from that route and the wrong end of the funnel to discover it.
      //
      // The free route builds the tenant in its own request and clears
      // `signupInProgress` itself, because no webhook is coming to do it. So
      // there is no redirect and no waiting screen: on success the church
      // exists, and a reload lands on first-run setup.
      //
      // `selectedBilling` is deliberately NOT sent. Free has no billing term,
      // and passing one would put a term on a tier that is never billed.
      // `referrerId` is not sent either: an affiliate commission is 15% of what
      // a church pays, and this church pays nothing. The stored referrer is
      // left untouched in localStorage, so it still attaches if they upgrade.
      if (isFree) {
        const freeResp = await fetch('/api/tenants/provision-free', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          // The address IS the name: one field was collected, and the tenant
          // needs both. `subdomain` is what the server builds the address from;
          // `ministryName` is what it stores as the tenant's display name, so
          // no surface that reads `tenant.name` is left with a blank.
          body: JSON.stringify({ ministryName: subdomain, subdomain }),
        });
        const freeData = await freeResp.json();
        if (!freeResp.ok || !freeData.tenantId) {
          setError(freeData.error || 'Could not create your ministry. Please try again.');
          setSubmitting(false);
        }
        // 🔴 THE-214: NO `window.location.href = '/'` ON SUCCESS, and that
        // removal is the second defect this ticket names.
        //
        // That line was the trip through the member app the founder called
        // unclean. Landing on "/" re-enters the SPA with the gate still
        // resolving, so `OnboardingGate` renders `children` — the whole
        // signed-in member app — for as long as the user-doc read takes, and
        // only then swaps it for a funnel screen. Nothing was accomplished by
        // the round trip: this component is already inside the gate.
        //
        // On success there is nothing to navigate to at all. The marker write
        // above already unmounted this screen (the gate paints "Creating your
        // ministry…" while `signupInProgress` is set and no tenant exists yet),
        // and the moment provisioning lands the gate sees the tenant id arrive
        // on the same listener and paints the account-created confirmation
        // itself. The gate owns every screen in this funnel; this one included.
        return;
      }

      const resp = await fetch(SIGNUP_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          billing: selectedBilling,
          ministryName: ministryName.trim(),
          ...(referrerId ? { referrerId } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to start checkout. Please try again.');
        setSubmitting(false);
      }
    } catch (err: any) {
      console.error('Church signup failed:', err);
      setError(err?.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <MinShell>
      {/* Logo */}
      <div className="mb-5 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HARVEST_LOGO} alt="Harvest logo" className="h-12 w-auto object-contain" />
      </div>

      {/* Chosen plan + billing term — read-only (no in-app picker for either;
          both are chosen upstream, and the term must be visible before the
          church commits to being charged for it) */}
      <div className="mb-4 flex justify-center">
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-bold"
          style={{
            background: 'color-mix(in srgb, var(--brand-color, #C9963A) 12%, white)',
            border: '1px solid var(--border-gold, rgba(201,150,58,0.40))',
            color: BRAND,
          }}
        >
          <Sparkles size={14} /> {PLAN_DISPLAY_NAMES[selectedPlan]} plan
          {/* THE-214: the term is shown because the church is about to be
              charged for it. Free is never charged, so there is no term to
              state — and `resolveSignupBillingPeriod` would have printed
              "billed monthly" beside a plan that bills nothing. */}
          {!isFree && (
            <>
              <span aria-hidden style={{ opacity: 0.55 }}>·</span>
              {TERM_BILLED_PHRASE[selectedBilling]}
            </>
          )}
        </span>
      </div>

      {/* Card */}
      <div className="rounded-brand-xl border border-line bg-surface-raised px-6 py-8 shadow-[var(--ds-sh-md)] sm:px-9">
        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#FBEEEA', borderColor: '#EBD0C7', color: '#B0432B' }}>
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mb-7 flex justify-center">
          <div className="flex h-[62px] w-[62px] items-center justify-center rounded-brand-lg" style={{ background: 'color-mix(in srgb, var(--brand-color, #C9963A) 13%, white)', color: BRAND }}>
            {isFree ? <Globe size={30} /> : <Church size={30} />}
          </div>
        </div>

        <div className="mb-1.5 text-center text-xs font-semibold uppercase" style={{ letterSpacing: '0.19em', color: BRAND }}>Almost there</div>
        <h1 className="text-center font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
          {isFree ? 'Choose your web address' : 'Name your ministry'}
        </h1>
        <p className="mx-auto mt-2.5 max-w-[38ch] text-center text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
          {isFree
            ? 'This is where your app will live. It is the only thing we need \u2014 you can change everything else later in Settings.'
            : 'You\u2019ll customise your subdomain, logo and colours right after payment.'}
        </p>

        {isFree ? (
          /* THE-214 — the free lane's one field. Same sanitising as first-run
             setup (lowercase, [a-z0-9-] only) so the string typed here is the
             string that becomes the address, and the same live availability
             line, because this screen now answers the question that screen
             used to. */
          <div className="mt-7">
            <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
              Your web address
            </label>
            <div className="flex items-stretch">
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit && !submitting) handleContinue(); }}
                onFocus={() => setFocus(true)}
                onBlur={() => setFocus(false)}
                className="min-w-0 flex-1 rounded-l-lg px-4 font-mono text-sm outline-none transition-colors"
                style={{
                  height: 48,
                  border: `1px solid ${subStatus === 'taken' ? DANGER : subStatus === 'available' ? SUCCESS : (focus ? BRAND : 'var(--stone-200, #E8E2D9)')}`,
                  borderRight: 'none',
                  color: 'var(--text-heading, #2D2519)',
                  background: 'var(--surface-raised, white)',
                }}
                placeholder="yourname"
                autoFocus
              />
              <span
                className="flex items-center whitespace-nowrap rounded-r-lg px-4 text-sm"
                style={{ border: '1px solid var(--stone-300, #D6CCBE)', background: 'var(--surface-sunken, #F3EEE7)', color: 'var(--text-body, #4A4038)' }}
              >
                .theharvest.app
              </span>
            </div>
            <div className="mt-2 h-5 text-xs">
              {subStatus === 'checking' && (
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted, #8B7355)' }}><Loader2 size={12} className="animate-spin" /> Checking availability…</span>
              )}
              {subStatus === 'available' && (
                <span className="inline-flex items-center gap-1.5" style={{ color: SUCCESS }}><CheckCircle2 size={13} /> {subdomain}.theharvest.app is available</span>
              )}
              {subStatus === 'taken' && (
                <span className="inline-flex items-center gap-1.5" style={{ color: DANGER }}><AlertCircle size={13} /> That address is taken — try another.</span>
              )}
            </div>
          </div>
        ) : (
        <div className="mt-7">
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
            Ministry name
          </label>
          <div
            className="flex items-center gap-2.5 rounded-lg bg-surface-raised transition-all"
            style={{ height: 48, padding: '0 14px', border: `1px solid ${focus ? BRAND : 'var(--stone-200, #E8E2D9)'}`, boxShadow: focus ? `0 0 0 3px color-mix(in srgb, ${BRAND} 16%, transparent)` : 'none' }}
          >
            <span className="flex shrink-0" style={{ color: 'var(--text-muted, #8B7355)' }}><Church size={16} /></span>
            <input
              type="text"
              value={ministryName}
              onChange={(e) => setMinistryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit && !submitting) handleContinue(); }}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
              style={{ fontSize: 15, color: 'var(--text-heading, #2D2519)' }}
              placeholder="Grace Community Church"
              autoFocus
            />
          </div>
        </div>
        )}

        {/* Action */}
        <div className="mt-7 flex justify-end">
          <button
            onClick={handleContinue}
            disabled={submitting || !canSubmit}
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-all"
            style={{
              background: BRAND,
              boxShadow: `0 10px 30px -8px color-mix(in srgb, ${BRAND} 42%, transparent)`,
              cursor: (submitting || !canSubmit) ? 'not-allowed' : 'pointer',
              opacity: (submitting || !canSubmit) ? 0.5 : 1,
            }}
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" /> {isFree ? 'Creating your account…' : 'Redirecting to payment…'}</>
            ) : (
              <>{isFree ? 'Create my account' : 'Continue to payment'} <ArrowRight size={16} /></>
            )}
          </button>
        </div>

        {/* The wallet fallback is card advice, and the free lane takes no card.
            Printing it would put the word "payment" on the one screen this
            ticket exists to keep it off — the same reasoning OnboardingGate
            already applies to its own free branch. */}
        {!isFree && (
          <p className="mt-4 text-center text-xs leading-relaxed" style={{ color: 'var(--text-muted, #8B7355)' }}>
            {WALLET_FALLBACK_LINE}
          </p>
        )}
      </div>
    </MinShell>
  );
};

export default ChurchOnboarding;
