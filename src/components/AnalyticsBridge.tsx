'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../firebase';
import { isPreAuthPath } from '../lib/preauth-theme';
import { capturePageview, identifyUser, resetIdentity } from '../lib/analytics/client';
import type { AnalyticsUser } from '../lib/analytics/identity';

/**
 * THE-36 — where PostHog starts. A side-effect component, rendering nothing,
 * in the same shape as `ReferralTracker`.
 *
 * ─── ⚠️ Why it is HERE and not in layout.tsx ─────────────────────────────────
 *
 * `src/app/layout.tsx` carries the pre-paint theme script: a raw string that
 * runs before any bundle loads, cannot import, and whose whole correctness
 * argument is that there is "exactly one moment where <html> goes from
 * unstamped to fully stamped". Four PRs went into getting it right and a test
 * extracts and executes the real script. Nothing about analytics needs to run
 * before first paint, so nothing about analytics goes near it — layout.tsx is
 * untouched by this PR, byte for byte, and a test pins that.
 *
 * This mounts inside `App.tsx`'s BrowserRouter instead, which is where the
 * route actually changes: the SPA serves every non-API path from one document,
 * so a document-level script would see exactly one navigation and then go
 * quiet.
 *
 * ─── 🔴 Pre-auth surfaces gain nothing ───────────────────────────────────────
 *
 * `/auth`, `/onboarding` and `/church-onboarding` are excluded outright — no
 * init, no identify, no pageview. Two reasons, and the second is the one that
 * matters:
 *
 *   • THE-85 made these screens deliberately minimal, and they are the only
 *     screens a prospective customer sees before paying.
 *   • They are the surfaces built out of email and password inputs. Not
 *     starting a third-party SDK on them at all is a stronger guarantee than
 *     starting one and configuring it not to look.
 *
 * PREAUTH_PATHS is imported, not restated, so this list cannot drift from the
 * one the pre-paint script and `theme-runtime.ts` already share.
 *
 * ⚠️ The single exception is sign-out, below, and it is safe by construction:
 * `resetIdentity()` acts only if analytics was already running, which can only
 * have happened on a surface that was not pre-auth.
 */
export default function AnalyticsBridge() {
  const { pathname } = useLocation();

  // `undefined` = Firebase has not answered yet. Distinguished from `null`
  // (answered: signed out) because capturing a pageview before auth resolves
  // would file a signed-in user's first screen under an anonymous id — and,
  // for a church admin, under no tenant group at all.
  const [authUser, setAuthUser] = useState<AnalyticsUser | null | undefined>(undefined);

  const identifiedUidRef = useRef<string | null>(null);
  const isPlatformAdminRef = useRef(false);

  /**
   * The `(uid, pathname)` pair the last $pageview was actually sent for.
   *
   * ⚠️ The SECOND lock on double-counting, and it guards a different failure from
   * the stable-identity fix above: that one stops the effect re-running for an
   * unchanged user, this one stops a re-run that does happen from sending a
   * duplicate — React 18's development double-invoke, a remount, or any future
   * dependency added to the effect.
   *
   * 🔴 SET AFTER THE AWAIT, NOT BEFORE. Claiming the pair up front would let a
   * run that is then cancelled (the identify below is async) block the run that
   * superseded it, and the screen would be counted ZERO times rather than twice.
   * Under-counting is the failure this whole file exists to fix, so the guard is
   * placed where it can only ever suppress a send that already happened.
   *
   * The pair, not the path alone: signing out and back in at the same screen is
   * two different people looking at it, and both count. Only the LAST pair is
   * held, so `/admin` → `/admin/crm` → `/admin` is three pageviews, correctly.
   */
  const lastCapturedRef = useRef<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        // 🔴 THE SAME PERSON MUST BE THE SAME VALUE (THE-220). Firebase re-fires
        // this listener for the same account — an ID-token refresh, a
        // `getIdToken()`, a second tab settling — and a fresh object literal each
        // time makes `authUser` a NEW dependency of the capture effect below, so
        // the effect re-runs and files a SECOND $pageview for a screen nobody
        // navigated to. That is not hypothetical: the live project holds two
        // `/admin` pageviews five seconds apart in one session
        // (2026-08-23T23:13:34Z and :39Z), which is this.
        //
        // Returning `prev` unchanged when the identity has not changed keeps the
        // reference stable, so a token refresh is invisible to React. `email` is
        // compared too — it is the other field the effect consumes, so a real
        // change to it must still propagate.
        setAuthUser((prev) =>
          prev && prev.uid === user.uid && prev.email === user.email
            ? prev
            : { uid: user.uid, email: user.email },
        );
        return;
      }
      // Signed out. Forget the person before the next one arrives — a church
      // office computer is shared, and PostHog's distinct_id survives a page
      // load otherwise.
      identifiedUidRef.current = null;
      isPlatformAdminRef.current = false;
      void resetIdentity();
      setAuthUser(null);
    });
  }, []);

  useEffect(() => {
    if (authUser === undefined) return;
    if (isPreAuthPath(pathname)) return;

    let cancelled = false;

    void (async () => {
      // Identify once per user, not once per navigation: resolving the tenant
      // group reads Firestore (cached per uid by getTenantScope), and PostHog
      // captures a $set on every re-identify.
      if (authUser && identifiedUidRef.current !== authUser.uid) {
        const result = await identifyUser(authUser);
        if (cancelled) return;
        identifiedUidRef.current = authUser.uid;
        isPlatformAdminRef.current = result?.isPlatformAdmin ?? false;
      }
      const captureKey = `${authUser?.uid ?? ''}\u0000${pathname}`;
      if (lastCapturedRef.current === captureKey) return;
      lastCapturedRef.current = captureKey;
      await capturePageview(pathname, isPlatformAdminRef.current);
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser, pathname]);

  return null;
}
