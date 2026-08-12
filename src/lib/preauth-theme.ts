/**
 * THE-85 — which screens are pre-auth, named once.
 *
 * 🔴 DECISION, not a bug fix. Every screen a prospective customer can reach
 * before they have a working account renders in LIGHT MODE, always; dark mode
 * exists only behind auth. The dark styles on these screens are being REMOVED,
 * not repaired — theming them properly would mean finding and theming every
 * pre-auth surface, now and forever. Forcing light deletes the problem class:
 * there is no half-dark state left to get wrong, and no future pre-auth screen
 * can inherit the bug.
 *
 * ⚠️ The forcing happens at the THEME-APPLICATION layer (here + theme-runtime +
 * the pre-paint script), never in component styles. The tokens must still
 * resolve — they must just always resolve to their light values. Hardcoding
 * light colours into the components is precisely what caused THE-85: a surface
 * with no dark value, rather than a surface deliberately unthemed.
 *
 * This module is deliberately plain — no 'use client', no browser API — because
 * three very different callers import it:
 *   • src/app/layout.tsx (SERVER) interpolates PREAUTH_PATHS straight into the
 *     pre-paint <script>, so the list cannot drift out of sync the way
 *     THEME_STORAGE_KEY did (that one is a duplicated literal pinned by a test).
 *   • src/lib/theme-runtime.ts (CLIENT) re-applies on SPA route changes, which
 *     the pre-paint script never sees — it runs once per document load.
 *   • the tests.
 */

/**
 * The funnel paths, i.e. every route whose screen belongs to signup rather than
 * to the product: sign in, create account and forgot-password (all three are
 * views of /auth), the member onboarding steps, and the church-onboarding steps.
 *
 * These are the paths that are knowable BEFORE FIRST PAINT, from the URL alone.
 * The rest of the funnel — the post-checkout return screen, "Complete your
 * payment", first-run setup, the tenant-not-found error page — renders at "/"
 * and is only identifiable after an async Firestore read, so those screens
 * declare themselves via `useForcedLightTheme` instead. See theme-runtime.ts.
 */
export const PREAUTH_PATHS = ['/auth', '/onboarding', '/church-onboarding'] as const;

/**
 * Canonical form of a pathname for comparison against PREAUTH_PATHS.
 *
 * ⚠️ The pre-paint script in layout.tsx re-implements this in three statements,
 * because it is a raw string that cannot import. Keep the two trivial enough to
 * mirror exactly — `preauth-light.test.ts` runs the real extracted script
 * against the same path table as this function and fails if they ever disagree,
 * so a divergence surfaces as a failing test rather than as a dark flash.
 */
export function normalizePath(pathname: string): string {
  const withoutQuery = (pathname || '/').split(/[?#]/)[0];
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return (trimmed === '' ? '/' : trimmed).toLowerCase();
}

/** True when this path's screen is part of the signup funnel. */
export function isPreAuthPath(pathname: string): boolean {
  return (PREAUTH_PATHS as readonly string[]).includes(normalizePath(pathname));
}
