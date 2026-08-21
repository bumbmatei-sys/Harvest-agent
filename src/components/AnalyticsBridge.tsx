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

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthUser({ uid: user.uid, email: user.email });
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
      await capturePageview(pathname, isPlatformAdminRef.current);
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser, pathname]);

  return null;
}
