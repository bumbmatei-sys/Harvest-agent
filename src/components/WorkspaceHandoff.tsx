'use client';
import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle2, Loader2, ArrowRight, AlertCircle, Mail } from 'lucide-react';
import { db } from '../firebase';
import { useForcedLightTheme } from '../lib/theme-runtime';
import { getTenantIdFromHost } from '../utils/tenant-scope';

const BRAND = 'var(--brand-color, #B8962E)';
const SUCCESS = 'var(--brand-success, #6E8E52)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/**
 * ⚠️ UNVERIFIED — the one string in this file not derived from the repo. Nothing
 * in the codebase or docs names a support address (only `noreply@theharvest.app`
 * and test fixtures exist), so this is a convention, not a confirmed mailbox.
 * It is a constant precisely so correcting it is a one-line change. If this
 * address is not monitored, a church whose provisioning stalls emails a void —
 * which is the exact failure this screen exists to prevent.
 */
const SUPPORT_EMAIL = 'support@theharvest.app';

/** How often we re-check that the workspace really exists. */
const POLL_INTERVAL_MS = 2000;

/**
 * When to stop waiting and offer a human instead.
 *
 * Tenant creation is asynchronous — the payment webhook does it. The measured
 * gap on the first successful production signup was ~70s (checkout 19:49:14,
 * tenant created 19:50:25), so this is ~2.5x that. Past it we stop promising a
 * destination we cannot see and hand the church to support.
 */
const STALLED_AFTER_MS = 180000;

interface WorkspaceHandoffProps {
  /** The tenant id the workspace lives at — this is also its subdomain label. */
  tenantId: string;
  /**
   * Ministry name already known to the caller (the signup marker on the user
   * doc), shown until the tenant document itself resolves and supplies the
   * authoritative name.
   */
  fallbackMinistryName?: string;
}

/** Soft gold halo, matching the other transitional screens in this funnel. */
const Halo = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute left-1/2 -translate-x-1/2"
    style={{ top: '-16%', width: 720, height: 480, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
  />
);

/**
 * The screen between paying and arriving at the new workspace.
 *
 * 🔴 WHY THIS EXISTS. A church pays on `theharvest.app` and their workspace
 * lives on `<tenant>.theharvest.app`. Firebase Auth persistence is ORIGIN-SCOPED
 * — the session sits in IndexedDB on the apex origin and the subdomain is a
 * different origin, so it genuinely cannot see it. That is not a bug and is not
 * fixed here: the session is not lost, it simply does not cross. What was
 * missing is the sentence explaining it. Without this screen the first thing a
 * church saw after being charged was an unexplained login prompt, which reads as
 * "did my payment go through?" — and the cheapest answer a worried customer has
 * is a chargeback.
 *
 * ⚠️ Do NOT "fix" the cause by widening cookie or storage scope to share a
 * session across origins. The apex also serves the admin app; loosening that
 * boundary would be a real security regression, not a convenience.
 *
 * ⚠️ NO PAYMENT ACTION MAY EVER APPEAR HERE. Everyone on this screen has already
 * been charged. A "try payment again" affordance on a page reached after a
 * successful charge is a double-charge waiting to happen — when provisioning
 * stalls the only escape offered is a human (see the stalled branch below).
 * `workspace-handoff.test.tsx` asserts that absence structurally.
 *
 * ⚠️ Nothing here names a plan, a price, a trial length or a renewal date. The
 * trial is configured as 14 days in Dodo and described as 7 in the app's copy;
 * until that is reconciled, restating either number would make this a third
 * place to be wrong about it — on the one screen where the customer is actively
 * thinking about what they were charged.
 */
const WorkspaceHandoff: React.FC<WorkspaceHandoffProps> = ({ tenantId, fallbackMinistryName }) => {
  // This screen has no path of its own — it renders at "/" like the rest of the
  // gate's funnel screens, so the URL cannot classify it and it declares itself.
  // `useForcedLightTheme` is a counter, so the gate asserting the same force
  // around this subtree is harmless and this stays correct mounted alone.
  useForcedLightTheme(true);

  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [ministryName, setMinistryName] = useState('');

  /**
   * 🔴 THE READINESS GUARD. Until the tenant document actually exists, the
   * subdomain does not resolve — `TenantContext` would render "Organization Not
   * Found" — so the action that sends them there is NOT rendered. A church that
   * pays, is told "you're ready", clicks through and hits an error page is worse
   * off than one that waited a few seconds with an explanation.
   *
   * A plain document get by id: `tenants/{id}` is world-readable (`allow read:
   * if true`) and this is a get, not a query, so it needs no new API route and
   * no Firestore index. It also runs on the ORIGIN THE USER IS STILL SIGNED IN
   * ON, which is why no additional credential is involved.
   */
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waited = 0;

    const probe = async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (cancelled) return;
        if (snap.exists()) {
          const name = snap.data()?.name;
          if (typeof name === 'string' && name) setMinistryName(name);
          setReady(true);
          return;
        }
      } catch {
        // A transient read failure is not evidence the workspace is missing —
        // keep waiting rather than declaring a paid account broken.
      }
      if (cancelled) return;
      waited += POLL_INTERVAL_MS;
      if (waited >= STALLED_AFTER_MS) { setStalled(true); return; }
      timer = setTimeout(probe, POLL_INTERVAL_MS);
    };

    probe();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [tenantId]);

  const address = `${tenantId}.theharvest.app`;
  const displayName = ministryName || fallbackMinistryName || 'Your ministry';

  /**
   * 🔴 Is the destination actually a DIFFERENT origin from the one we are
   * rendering on?
   *
   * It is not always. `App.tsx`'s auth callback (lines 266–299) hard-redirects
   * apex → subdomain as soon as the user doc has `onboardingCompleted: true`,
   * which the payment webhook sets when it provisions — so a reload at "/"
   * after provisioning but before first-run setup finishes lands the owner on
   * `<generated>.theharvest.app`, and the gate renders first-run setup THERE.
   * Keeping the generated subdomain is a valid finish (`FirstRunSetup.tsx:66`
   * short-circuits the availability check when `subdomain === tenantId`, and
   * line 80 lets that satisfy `canFinish`), so `onFinished` can hand back the
   * very id the user is already hosted on.
   *
   * On that path the cross-origin copy below is FALSE: there is no second
   * sign-in, because they signed in on this origin to get here. Telling someone
   * something untrue about their account at the moment they are thinking about
   * a charge is the exact failure this screen exists to prevent — so the claim
   * is made only when it is true.
   *
   * ⚠️ Resolved with the SHARED host resolver, never by parsing
   * `window.location.hostname` here. Four resolvers already have to agree about
   * what a tenant subdomain is; a fifth inline parse is how they drift apart.
   * `getTenantIdFromHost()` returns null on the apex, so the apex case falls out
   * as cross-origin without a special case. Safe during render: the whole app is
   * mounted `ssr: false` (`src/app/[[...slug]]/page.tsx:8`), and App.tsx:150
   * already calls it this way.
   */
  const crossOrigin = tenantId !== getTenantIdFromHost();

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-14 text-center"
      style={{ background: 'var(--cream, #FAF8F5)' }}
    >
      <Halo />
      <div className="relative z-[1] flex w-full flex-col items-center" style={{ maxWidth: 460 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HARVEST_LOGO} alt="Harvest" className="mb-6 h-12 w-auto object-contain" />

        {/* (1) The sentence they are actually looking for. First, unambiguous,
            and deliberately NOT gated on readiness — the charge already
            succeeded whether or not the workspace has finished building. */}
        <div
          className="mb-3.5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] font-bold"
          style={{
            background: 'color-mix(in srgb, var(--brand-success, #6E8E52) 12%, white)',
            border: '1px solid color-mix(in srgb, var(--brand-success, #6E8E52) 38%, transparent)',
            color: SUCCESS,
          }}
        >
          <CheckCircle2 size={14} /> Payment received
        </div>
        <h1
          className="font-display"
          style={{ fontWeight: 300, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}
        >
          Your payment went through.
        </h1>

        {/* (2) What was created, by name, so they can see it is the right thing. */}
        <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
          We&rsquo;ve set up <strong style={{ color: 'var(--text-heading, #2D2519)' }}>{displayName}</strong>.
        </p>

        {/* (3) Where it lives. */}
        <div className="mt-6 w-full rounded-brand-lg border border-line bg-surface-raised px-5 py-4 shadow-[var(--ds-sh-sm)]">
          <div
            className="mb-1.5 text-[11px] font-semibold uppercase"
            style={{ letterSpacing: '0.14em', color: 'var(--text-muted, #8B7355)' }}
          >
            Your workspace address
          </div>
          <div className="break-all font-mono text-sm" style={{ color: 'var(--text-heading, #2D2519)' }}>
            {address}
          </div>
        </div>

        {/* (4) Why they will be asked to sign in again — stated as expected,
            not as a failure. This is the whole reason the screen exists, and it
            is claimed ONLY when the destination really is another origin. */}
        {crossOrigin ? (
          <p className="mt-5 max-w-[42ch] text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
            Your ministry has its own web address, so you&rsquo;ll sign in once more when you get
            there. That&rsquo;s expected — sign-ins don&rsquo;t carry across addresses. Your account is
            already created and nothing was lost.
          </p>
        ) : (
          <p className="mt-5 max-w-[42ch] text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
            You&rsquo;re already signed in at this address, so there&rsquo;s nothing more to do —
            your workspace is ready when you are.
          </p>
        )}

        {/* (5) A single action — and only once the workspace genuinely resolves. */}
        <div className="mt-8 flex w-full flex-col items-center">
          {ready ? (
            /* Cross-origin gets the absolute URL; same-origin gets an in-origin
               route to /admin, because a link to `https://<current host>/admin`
               would be a self-link dressed up as a departure.
               ⚠️ Deliberately a real navigation and NOT react-router's
               `navigate()`, which is how the app moves within an origin
               everywhere else: this screen is rendered by OnboardingGate AHEAD
               of <Routes> (that precedence is load-bearing — see the gate), so
               a client-side navigation would change the URL while the gate kept
               rendering this screen, stranding the user here. Reloading lets the
               gate re-resolve to 'ready' and hand them the app. */
            <a
              href={crossOrigin ? `https://${address}/admin` : '/admin'}
              className="inline-flex items-center gap-2 rounded-lg font-semibold text-white no-underline"
              style={{
                background: BRAND, padding: '13px 30px', fontSize: 15,
                boxShadow: `0 10px 30px -8px color-mix(in srgb, ${BRAND} 42%, transparent)`,
              }}
            >
              {crossOrigin ? <>Continue to {address}</> : <>Go to your dashboard</>} <ArrowRight size={16} />
            </a>
          ) : stalled ? (
            /* Genuinely stuck. The ONLY escape offered is a human: everyone here
               has already paid, so an action that could charge again is the one
               thing this branch must never contain. */
            <div role="status" className="flex flex-col items-center">
              <div className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
                <AlertCircle size={16} style={{ color: BRAND }} /> This is taking longer than usual.
              </div>
              <p className="mt-2 max-w-[40ch] text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
                Your payment is safe and your account exists — there is nothing to pay again.
                Send us a note and we&rsquo;ll finish setting it up by hand.
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Workspace setup — ${address}`)}`}
                className="mt-5 inline-flex items-center gap-2 rounded-lg font-semibold no-underline"
                style={{
                  padding: '12px 26px', fontSize: 15, color: BRAND,
                  border: '1px solid var(--border-gold, rgba(201,150,58,0.40))',
                  background: 'color-mix(in srgb, var(--brand-color, #C9963A) 8%, white)',
                }}
              >
                <Mail size={16} /> Contact support
              </a>
            </div>
          ) : (
            <div role="status" aria-live="polite" className="flex flex-col items-center">
              <div className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
                <Loader2 size={16} className="animate-spin" style={{ color: BRAND }} /> Preparing your workspace…
              </div>
              <p className="mt-2 max-w-[40ch] text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
                We&rsquo;re finishing the last step at your new address. This usually takes under a
                minute — the button will appear here as soon as it&rsquo;s ready.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkspaceHandoff;
