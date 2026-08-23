'use client';

import { useEffect } from 'react';

import { capturePublicPageview } from '../lib/analytics/client';
import type { AnalyticsRoutePattern } from '../lib/analytics/routes';

interface PublicRouteAnalyticsProps {
  /**
   * The route pattern this page IS — `'/form/[formId]'`, not
   * `'/form/aB3xQ…'`.
   *
   * 🔴 Typed as the union of the registry's patterns, so a typo or an
   * unregistered route is a compile error rather than a row on a dashboard
   * nobody can explain. The page passes a LITERAL rather than reading
   * `location.pathname`, so what is sent is decided at the call site by the
   * file whose name it is, and matching cannot get it wrong.
   */
  route: AnalyticsRoutePattern;
}

/**
 * THE-206 — the pageview for a route that is not the SPA.
 *
 * ─── Why this exists at all ──────────────────────────────────────────────────
 *
 * `AnalyticsBridge` mounts inside `App.tsx`'s `BrowserRouter` and sees route
 * changes through `useLocation()`. The ten dedicated Next routes never render
 * `App.tsx`, so it never mounted on them and they sent nothing — which is the
 * whole of THE-206. They are also the PUBLIC surfaces: a church's blog, a form
 * a visitor fills in, an event page opened from a share link.
 *
 * Each is a server component, so this is the client half: a side-effect
 * component that renders nothing and fires exactly one `$pageview`. There is no
 * router to subscribe to and no route change to wait for — a Next page mounting
 * IS the navigation.
 *
 * ─── 🔴 It does NOT identify, and that is the point ──────────────────────────
 *
 * No `identifyUser`, no `onAuthStateChanged`, no Firebase import anywhere on
 * this path. Two reasons, and both are load-bearing:
 *
 *   • **Privacy.** These visitors are unauthenticated. There is nobody to
 *     identify, and `person_profiles: 'identified_only'` means an anonymous
 *     visitor gets a random device id and NO stored person profile. Reaching
 *     for auth here would be reaching for a person who is not there.
 *
 *   • **Weight.** `identity.ts` reaches Firebase through `tenant-scope.ts`.
 *     `/blog/[id]` currently ships 325 B of page JS and no Firestore SDK at
 *     all, and it is the most performance-sensitive page in the product. So
 *     `client.ts` imports `identity.ts` DYNAMICALLY, inside `identifyUser`,
 *     and this component never calls it — the blog reader downloads neither
 *     Firebase nor, without a project key, posthog-js.
 *
 * ⚠️ A visitor who signed in earlier in the same browser still carries their
 * `distinct_id` from persisted state, so their blog visit is attributed to
 * them. That is correct — it is the same person — and it is not something this
 * component does or could undo.
 */
export default function PublicRouteAnalytics({ route }: PublicRouteAnalyticsProps) {
  useEffect(() => {
    void capturePublicPageview(route);
  }, [route]);

  return null;
}
