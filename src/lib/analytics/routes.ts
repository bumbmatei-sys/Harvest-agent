/**
 * THE-206 — every route this app serves, enumerated, and the only place a
 * pathname is turned into something an analytics event may carry.
 *
 * ─── 🔴 Why this file is a LIST and not a regex ──────────────────────────────
 *
 * THE-36 shipped PostHog against the SPA shell only. `AnalyticsBridge` mounts
 * inside `App.tsx`'s `BrowserRouter`, and the nine dedicated Next routes —
 * `/blog/:id`, `/form/:formId`, `/event/:eventId` and the rest — never render
 * `App.tsx` at all, so they never mounted it and never sent a thing. Those are
 * also the PUBLIC surfaces: a church's blog, a form a visitor fills in, an
 * event page opened from a share link. They are the pages a growth question is
 * actually about.
 *
 * Widening coverage to them raises the question THE-36 did not have to answer:
 * **a public URL carries an identifier**. `/form/aB3xQ…` and
 * `/event/9f2c…` are Firestore document ids, and PostHog attaches
 * `$current_url` to every event whether we ask it to or not.
 *
 * So the rule is: **a resolved path never becomes a property.** Every path is
 * matched against the enumerated patterns below and replaced by the PATTERN —
 * `/form/[formId]`, not `/form/aB3xQ…`. Counts are identical, because one
 * pattern is exactly the set of pages it matches.
 *
 * ⚠️ Matching is by ENUMERATION, never by value shape. A rule like "a segment
 * that looks like an id" is the same mistake `events.ts` refuses for property
 * labels: it passes whatever it fails to recognise, and the thing it will fail
 * to recognise is the segment nobody thought of. A path that matches nothing
 * here becomes {@link UNROUTED_PATTERN} rather than being passed through —
 * over-redaction is the intended failure mode.
 *
 * ─── Purity ─────────────────────────────────────────────────────────────────
 *
 * 🔴 This module imports NOTHING. That is load-bearing, not tidiness.
 * `client.ts` imports it, and `client.ts` is now imported by the public pages —
 * including `/blog/[id]`, the most performance-sensitive page in the product.
 * `identity.ts` reaches Firebase through `tenant-scope.ts`; if anything on that
 * path became reachable from here, every blog reader would download the
 * Firestore SDK. See the dynamic import in `client.ts`.
 */

/* ── the surfaces ──────────────────────────────────────────────────────────── */

/**
 * The route family an event happened on.
 *
 * `'public'` is THE-206's addition: a surface served OUTSIDE the signed-in SPA,
 * reachable without an account. It is a third value on an existing property,
 * not a new property — `ALLOWED_EVENT_PROPERTY_KEYS` is unchanged in width by
 * this distinction.
 */
export type AppSurface = 'admin' | 'member' | 'public';

/** How a route reaches the browser. */
export type RouteEntry =
  /** Its own file in `src/app`. Never renders `App.tsx`. */
  | 'next-page'
  /** Served by the `[[...slug]]` catch-all, routed by React Router. */
  | 'spa';

export interface AnalyticsRoute {
  /** The path pattern, in Next's own `[param]` spelling. What we send. */
  readonly pattern: string;
  readonly entry: RouteEntry;
  readonly surface: AppSurface;
  /**
   * True when the route is reachable with no account at all. Recorded so the
   * enumeration answers "which pages does an anonymous visitor see?" without a
   * reader having to infer it from the surface.
   */
  readonly public: boolean;
}

/**
 * 🔴 The pattern sent when a path matches nothing below.
 *
 * The SPA's `<Route path="*">` sends unknown paths to `/`, so a real user
 * reaches this only for the instant before that redirect. It exists so the
 * guarantee is absolute: there is no path, present or future, that reaches an
 * analytics property with a live segment in it.
 */
export const UNROUTED_PATTERN = '/[unrouted]';

/* ── the enumeration ───────────────────────────────────────────────────────── */

/**
 * Every route that renders a page, and nothing that does not.
 *
 * ⚠️ Deliberately absent, because a browser never renders them as a page and
 * an in-browser SDK therefore cannot fire on them:
 *
 *   • `src/app/api/**` — 117 route handlers, server-side, no document.
 *   • `src/app/calendar/ical/route.ts` — serves a downloaded `.ics` file.
 *   • `src/app/manifest.webmanifest/route.ts` — fetched by the PWA installer.
 *
 * ⚠️ `/auth`, `/onboarding` and `/church-onboarding` are absent for a different
 * and stronger reason: THE-36 excluded them on purpose and THE-206 does not
 * widen coverage to them. They are the screens built out of email and password
 * inputs. `PREAUTH_PATHS` remains the gate in `AnalyticsBridge`; they are named
 * here only in {@link PRE_AUTH_PATTERNS} so a reader can see the whole map.
 */
export const ANALYTICS_ROUTES: readonly AnalyticsRoute[] = Object.freeze([
  /* ── the SPA shell (THE-36 already covered these) ───────────────────────── */
  { pattern: '/', entry: 'spa', surface: 'member', public: false },
  { pattern: '/admin', entry: 'spa', surface: 'admin', public: false },
  { pattern: '/admin/[section]', entry: 'spa', surface: 'admin', public: false },
  { pattern: '/admin/[section]/[itemId]', entry: 'spa', surface: 'admin', public: false },

  /* ── the dedicated Next routes (THE-206 adds these) ─────────────────────── */
  { pattern: '/ai-assistant', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/blog/[id]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/calendar', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/campaign/[campaignId]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/checkin/[sessionId]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/courses/[id]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/event/[eventId]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/form/[formId]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/pledge/[campaignId]', entry: 'next-page', surface: 'public', public: true },
  { pattern: '/post/[postId]', entry: 'next-page', surface: 'public', public: true },
] as const);

/**
 * The pre-auth screens, named so the enumeration is complete and a reader can
 * see that their absence above is a decision rather than an oversight.
 *
 * 🔴 Nothing may instrument these. The list itself is not restated — it is
 * `PREAUTH_PATHS` from `preauth-theme.ts`, asserted equal in the test suite.
 */
export const PRE_AUTH_PATTERNS: readonly string[] = Object.freeze([
  '/auth',
  '/onboarding',
  '/church-onboarding',
]);

/** Every pattern a `$pageview` may carry. */
export type AnalyticsRoutePattern = (typeof ANALYTICS_ROUTES)[number]['pattern'];

/* ── matching ──────────────────────────────────────────────────────────────── */

/** `'/admin/crm/x'` → `['admin', 'crm', 'x']`. Empty for `'/'`. */
function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

/** A pattern segment written as `[param]` matches any single real segment. */
function isParameterSegment(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

const ROUTE_SEGMENTS: ReadonlyArray<readonly [AnalyticsRoute, string[]]> = ANALYTICS_ROUTES.map(
  (route) => [route, segmentsOf(route.pattern)] as const,
);

/**
 * The route a resolved pathname belongs to, or `null` when it belongs to none.
 *
 * Literal segments beat parameter segments at the same position, so
 * `/calendar` cannot be swallowed by some future `/[slug]`. Case is folded
 * because `/Admin/CRM` is the same page as `/admin/crm` and must not be a
 * second row on a dashboard.
 */
export function matchAnalyticsRoute(pathname: string): AnalyticsRoute | null {
  const actual = segmentsOf(pathname.toLowerCase());

  let best: AnalyticsRoute | null = null;
  let bestLiterals = -1;

  for (const [route, pattern] of ROUTE_SEGMENTS) {
    if (pattern.length !== actual.length) continue;

    let literals = 0;
    let matched = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (isParameterSegment(pattern[i])) continue;
      if (pattern[i].toLowerCase() !== actual[i]) {
        matched = false;
        break;
      }
      literals += 1;
    }

    if (matched && literals > bestLiterals) {
      best = route;
      bestLiterals = literals;
    }
  }

  return best;
}

/**
 * 🔴 The one function that decides what path string leaves the browser.
 *
 * `/form/aB3xQ…` → `/form/[formId]`. `/admin/crm/9f2c…` → `/admin/[section]/[itemId]`.
 * Anything unrecognised → {@link UNROUTED_PATTERN}.
 *
 * Idempotent: a pattern passed back in comes out unchanged, so a caller that
 * already knows its route (the public pages do — they pass a literal) and a
 * caller that only knows `location.pathname` (the SPA bridge) agree.
 */
export function normalizeAnalyticsPath(pathname: string): string {
  return matchAnalyticsRoute(pathname)?.pattern ?? UNROUTED_PATTERN;
}

/**
 * The route family an event happened on.
 *
 * Unrecognised paths are `'member'`: the SPA's catch-all sends them to `/`,
 * which is the member home, so that is where the visit actually ends up.
 */
export function resolveAppSurface(pathname: string): AppSurface {
  return matchAnalyticsRoute(pathname)?.surface ?? 'member';
}

/* ── URL rewriting, for PostHog's own properties ───────────────────────────── */

/**
 * Rewrite the path inside a URL-shaped string to its route pattern, keeping
 * everything else.
 *
 * ⚠️ This exists because `route` and `app_surface` are not the only places a
 * path reaches PostHog. The SDK attaches `$current_url`, `$referrer` and a
 * growing family of `$session_entry_*` properties by itself, each a full URL
 * with the live path in it. `config.ts` already strips their query strings for
 * exactly this reason; THE-206 extends the same walk to the path, because a
 * public route's path is now an identifier too.
 *
 * The HOST is deliberately kept. It is a church's subdomain — the same tenant
 * slug already used as the group key — not a person.
 *
 * ⚠️ An EXTERNAL referrer is normalised too, so `https://mail.example/read/abc`
 * becomes `https://mail.example/[unrouted]`. That is over-redaction, and it is
 * the intended failure mode: this function cannot tell our hosts from anyone
 * else's (churches provision custom domains — see `/api/domains/provision`), and
 * the paths it would be trusting are the ones we have least control over. Nothing
 * useful is lost — posthog-js records the referrer's host separately as
 * `$referring_domain`, which this does not touch, so "where did they come from"
 * is still answered.
 */
export function normalizeUrlPath(value: string): string {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd === -1) {
    // A bare path, e.g. `$pathname`.
    return value.startsWith('/') ? normalizeAnalyticsPath(value) : value;
  }

  const afterScheme = schemeEnd + 3;
  const pathStart = value.indexOf('/', afterScheme);
  if (pathStart === -1) return value; // origin only, no path to rewrite

  return value.slice(0, pathStart) + normalizeAnalyticsPath(value.slice(pathStart));
}
