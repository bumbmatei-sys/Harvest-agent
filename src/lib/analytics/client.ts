/**
 * THE-36 — the PostHog runtime. The only module that loads the SDK.
 *
 * ─── Why the import is dynamic ───────────────────────────────────────────────
 *
 * `import('posthog-js')` rather than a top-level import, so the SDK lands in its
 * own webpack chunk that is fetched only when a project key is configured.
 * Harvest is mobile-first and already ships Firebase, TipTap, Excalidraw and
 * Leaflet; adding ~50 kB gzipped to the initial parse of every route — on a
 * phone, for a feature that is off until the founder creates the project —
 * would be paid by every member of every church for nothing.
 *
 * ─── 🔴 Why `identity.ts` is imported DYNAMICALLY too (THE-206) ──────────────
 *
 * `identity.ts` reaches Firebase: it calls `getTenantScope()`, which imports
 * `../firebase` and `firebase/firestore`. THE-36 could import it statically
 * because the only caller was `AnalyticsBridge`, inside a SPA that already
 * ships Firebase.
 *
 * THE-206 makes this module reachable from the PUBLIC Next routes, and
 * `/blog/[id]` ships 325 B of page JS with no Firestore SDK on it at all — it
 * is a church's blog, the most performance-sensitive page in the product. A
 * static import here would have put the entire Firebase client into it for a
 * function those pages never call, because they never identify anybody.
 *
 * So the import moved inside `identifyUser`, which is the only thing that needs
 * it, and which already awaits a chunk load on the line above. The type import
 * is erased at compile time and costs nothing.
 *
 * ─── Degrading silently, on purpose ──────────────────────────────────────────
 *
 * With no `NEXT_PUBLIC_POSTHOG_KEY`, every function here returns without
 * loading anything. That is the deliberate exception to the Silent-Failure
 * Rule, and it is narrow: the absent key is not an error state to surface, it
 * is the state this PR ships in. What is NOT silent is a key that is present
 * and wrong — `on_request_error` in config.ts logs that loudly, because "events
 * are 401ing" and "nobody used the product" look identical on a dashboard.
 */

import type { PostHog } from 'posthog-js';

import { buildPostHogOptions, isAnalyticsConfigured, readPostHogKey } from './config';
import {
  ALLOWED_EVENT_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
  TENANT_GROUP_TYPE,
  type AnalyticsEventName,
  type PlanLimitKind,
} from './events';
// 🔴 TYPE-ONLY, and it must stay that way — see the header. The runtime import
// lives inside `identifyUser`.
import type { AnalyticsUser } from './identity';
import {
  normalizeAnalyticsPath,
  resolveAppSurface,
  type AnalyticsRoutePattern,
} from './routes';

/**
 * The in-flight (or settled) load. Held as a promise so a capture that arrives
 * before the SDK has finished downloading queues behind the same load instead
 * of starting a second one.
 */
let clientPromise: Promise<PostHog | null> | null = null;

/**
 * THE-360 — whether the person currently identified is platform staff, or
 * `null` when NOBODY has been identified in this session.
 *
 * ⚠️ THREE-VALUED, AND THE THIRD VALUE IS THE POINT. A product event fires from
 * a call site that knows what happened but not who is signed in, so this is
 * where that answer is kept between `identifyUser` and the next capture.
 * Defaulting it to `false` would have been the easy shape and it would LIE on
 * exactly the surface this ticket adds an event to: `signup_created` fires on
 * `/form/[formId]`, where nobody signed in and nobody was identified, and
 * `is_platform_admin: false` there asserts a fact about a person who does not
 * exist.
 *
 * `null` means the property is OMITTED instead — the same choice, for the same
 * reason, that `capturePublicPageview` makes in its own header: "an absent
 * property says that where `false` would lie".
 */
let identifiedIsPlatformAdmin: boolean | null = null;

/** Whether anything has been loaded. Read by tests and by `resetIdentity`. */
export function isAnalyticsStarted(): boolean {
  return clientPromise !== null;
}

/** Drop the loaded instance. Test seam only — never called by the app. */
export function __resetAnalyticsForTests(): void {
  clientPromise = null;
  identifiedIsPlatformAdmin = null;
}

/**
 * Load and initialise PostHog, once.
 *
 * Returns `null` — without importing the SDK — on the server, and whenever no
 * project key is configured.
 */
export function initAnalytics(): Promise<PostHog | null> {
  if (clientPromise) return clientPromise;
  if (typeof window === 'undefined' || !isAnalyticsConfigured()) {
    return Promise.resolve(null);
  }

  clientPromise = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(readPostHogKey(), buildPostHogOptions());
      return posthog;
    })
    .catch((error) => {
      // A blocked or failed chunk must never take the app down with it. The
      // app works without analytics; analytics does not work without the app.
      // eslint-disable-next-line no-console
      console.error('[analytics] PostHog failed to load', error);
      return null;
    });

  return clientPromise;
}

/**
 * Keep only the registered property keys.
 *
 * The closed vocabulary, enforced at the point we build an event rather than
 * only at `before_send`. Two layers because they fail differently: this one
 * catches a developer passing `{ contact }` in a new call site, `before_send`
 * catches anything the SDK itself attaches.
 */
function allowedProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (ALLOWED_EVENT_PROPERTY_KEYS.includes(key)) {
      out[key] = value;
      continue;
    }
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[analytics] dropped unregistered property "${key}" — add it to ALLOWED_EVENT_PROPERTY_KEYS in src/lib/analytics/events.ts`,
      );
    }
  }
  return out;
}

/**
 * Capture a registered event.
 *
 * Not exported for arbitrary use: `AnalyticsEventName` is a union of the names
 * in `events.ts`, so an unregistered event is a type error long before it is a
 * dropped payload.
 */
export async function captureEvent(
  event: AnalyticsEventName,
  properties: Record<string, unknown> = {},
): Promise<void> {
  // 🔴 THE-360 — NOTHING HERE MAY THROW, AND THIS try/catch IS WHY.
  //
  // Until THE-360 every capture was a `$pageview` fired from an effect, where a
  // rejected promise was a console warning and nothing else. This ticket puts
  // `captureEvent` on the line AFTER a gift is written to the money ledger. The
  // failure mode changed with it: `initAnalytics()` already catches a chunk
  // that will not load, but `client.capture()` itself was unguarded, and
  // because this function is `async` a throw from it becomes a REJECTED
  // PROMISE — which an awaiting call site in the CRM would have turned into a
  // visible "the gift could not be recorded" over a gift that was recorded.
  //
  // Analytics failing must not break a gift being recorded. The app works
  // without analytics; analytics does not work without the app. Every call site
  // fires this and does not await it, and this catch is what makes that safe
  // rather than merely usual.
  try {
    const client = await initAnalytics();
    const result: unknown = client?.capture(event, allowedProperties(properties));

    // ⚠️ AND A THENABLE RESULT NEEDS ITS OWN HANDLER, which the `catch` below
    // cannot give it. `capture()` is synchronous in posthog-js today and
    // returns a CaptureResult — but nothing here awaits it, so if a future
    // version (or a wrapper, or a test double) ever returns a promise, a
    // rejection from it would surface as an UNHANDLED REJECTION and never
    // reach the `catch`. In Node that is a process-level event; in a browser
    // it is a reported error on a page where a church has just recorded a gift.
    //
    // 🔴 ATTACHED, NOT AWAITED. Awaiting would put a network round trip between
    // the church pressing the button and the dialog closing, which is the one
    // thing this whole seam exists to prevent.
    //
    // This was found by MUTATION, not by reading: the test that claimed to
    // cover a rejecting capture passed with the `try` removed entirely, because
    // an un-awaited rejection was never the `catch`'s to catch.
    if (isThenable(result)) {
      result.then(undefined, (error: unknown) => swallow(event, error));
    }
  } catch (error) {
    swallow(event, error);
  }
}

/** A value with a `then`, without trusting it to be a real promise. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Note a failed capture and go no further.
 *
 * Loud in development, silent in production — the same split `before_send` and
 * `allowedProperties` already use. A dropped event is the safe outcome; a
 * developer who broke capture needs to learn it here rather than from an empty
 * dashboard three weeks later.
 */
function swallow(event: string, error: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[analytics] capture of "${event}" failed and was swallowed`, error);
  }
}

/**
 * Capture a pageview for an in-app (never pre-auth) route.
 *
 * ⚠️ THE-206 added `route`. `app_surface` is the route FAMILY ('admin' |
 * 'member' | 'public') and always was; on its own it cannot answer "how many
 * people opened a form?", which is the question the public routes exist to
 * answer. `route` is the normalised PATTERN — `/form/[formId]`, never
 * `/form/aB3xQ…` — resolved by the enumeration in `routes.ts`.
 */
export async function capturePageview(
  pathname: string,
  isPlatformAdmin: boolean,
): Promise<void> {
  await captureEvent(ANALYTICS_EVENTS.PAGEVIEW, {
    route: normalizeAnalyticsPath(pathname),
    app_surface: resolveAppSurface(pathname),
    is_platform_admin: isPlatformAdmin,
  });
}

/**
 * THE-206 — capture a pageview for a PUBLIC route: one of the ten dedicated
 * Next pages that never render `App.tsx`, seen by a visitor with no account.
 *
 * Takes the pattern itself rather than a pathname. The caller is the page whose
 * filename that pattern is, so it knows its own route exactly and there is
 * nothing to match; `AnalyticsRoutePattern` makes an unregistered one a compile
 * error.
 *
 * 🔴 Three differences from `capturePageview`, all deliberate:
 *
 *   • **No identify.** These visitors are anonymous, and this path must not
 *     reach `identity.ts` — that is what keeps Firebase out of the blog. A
 *     visitor who signed in earlier in the same browser still carries their
 *     persisted `distinct_id`; that is the same person, and correct.
 *
 *   • **No `is_platform_admin`.** Nobody was identified, so the honest answer
 *     is "unknown", and an absent property says that where `false` would lie.
 *     Exclude platform staff from a product metric with `is_platform_admin is
 *     not true`, and select these pages with `app_surface = 'public'`.
 *
 *   • **No stored person profile.** `person_profiles: 'identified_only'` means
 *     an anonymous visitor is a count, not a record — see `config.ts`.
 */
export async function capturePublicPageview(
  route: AnalyticsRoutePattern,
): Promise<void> {
  await captureEvent(ANALYTICS_EVENTS.PAGEVIEW, {
    route: normalizeAnalyticsPath(route),
    app_surface: resolveAppSurface(route),
  });
}

/**
 * THE-360 - capture a PRODUCT event: something a person DID, rather than a page
 * they looked at.
 *
 * --- Why there is one of these and not nine ---------------------------------
 *
 * Every product event carries the same three answers, and not one of them is
 * something the call site knows. `AdminCRM` knows a gift was recorded; it does
 * not know the route pattern, the surface family, or whether the admin who
 * pressed the button is platform staff. Asking nine call sites to assemble that
 * bag correctly is asking for nine chances to assemble it WRONG, and the way it
 * goes wrong is by reaching for something to hand -- the contact, the amount,
 * the title -- which is the entire failure this module exists to prevent.
 *
 * So a call site passes a NAME and, for one event, a KIND. It cannot pass a
 * property, because there is no parameter to pass one through.
 *
 * --- 🔴 The path is read here, and it is normalised before it is anything ----
 *
 * `window.location.pathname` is a RESOLVED path: on `/form/aB3xQ...` it is a
 * Firestore document id. It is handed straight to `normalizeAnalyticsPath`,
 * which matches it against the enumeration in `routes.ts` and answers the
 * PATTERN or {@link UNROUTED_PATTERN}. The resolved string is never stored,
 * never passed on and never becomes a property -- the rule `routes.ts` opens
 * with, applied at the one new place a path now enters analytics.
 *
 * --- Both shells, from one function -----------------------------------------
 *
 * `app_surface` is resolved from the matched route, so an event fired from the
 * member app is 'member' and the same event fired from the admin app is
 * 'admin', with no call site choosing and no user agent consulted. That is the
 * founder's "for mobile and desktop" answered as a SHELL question. The DEVICE
 * question is answered separately and already: posthog-js attaches
 * `$device_type` itself, and `scrubProperties` deliberately leaves `$`-prefixed
 * properties alone, so mobile-versus-desktop needs nothing from this file.
 */
export async function captureProductEvent(
  event: Exclude<AnalyticsEventName, typeof ANALYTICS_EVENTS.PAGEVIEW>,
  options: { limitKind?: PlanLimitKind } = {},
): Promise<void> {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;

  await captureEvent(event, {
    route: normalizeAnalyticsPath(pathname),
    app_surface: resolveAppSurface(pathname),
    // Omitted, not false, when nobody has been identified -- see the note on
    // `identifiedIsPlatformAdmin`.
    ...(identifiedIsPlatformAdmin === null
      ? {}
      : { is_platform_admin: identifiedIsPlatformAdmin }),
    ...(options.limitKind ? { limit_kind: options.limitKind } : {}),
  });
}

/**
 * THE-360 - fire a product event without waiting for it and without any way for
 * it to reach the caller.
 *
 * 🔴 THIS IS WHAT EVERY CALL SITE USES, and the reason is the money. The nine
 * moments this ticket instruments are the lines immediately after a gift is
 * written, a course is published, an invitation is sent. `captureEvent` already
 * swallows its own failures, so this adds no safety there -- what it adds is
 * that the ANALYTICS CALL CANNOT BE AWAITED BY ACCIDENT. A call site cannot
 * slow a gift down by a network round trip, cannot forget a `.catch`, and
 * cannot turn a recorded gift into a visible error, because there is no promise
 * handed back to mishandle.
 *
 * Returns `void` deliberately. An `async` function here would hand back a
 * promise that a future call site could `await`, which is the thing being
 * prevented.
 */
export function trackProductEvent(
  event: Exclude<AnalyticsEventName, typeof ANALYTICS_EVENTS.PAGEVIEW>,
  options: { limitKind?: PlanLimitKind } = {},
): void {
  void captureProductEvent(event, options);
}

/**
 * Identify the signed-in user and attach them to their church.
 *
 * Returns the resolved identity so the caller can stamp the same
 * `is_platform_admin` on subsequent pageviews without asking twice.
 */
export async function identifyUser(
  user: AnalyticsUser | null,
): Promise<{ isPlatformAdmin: boolean } | null> {
  // The SDK first, deliberately: resolving the tenant group reads Firestore,
  // and an app with no project key must do no work at all on sign-in — not a
  // read, not a cache fill, nothing.
  const client = await initAnalytics();
  if (!client) return null;

  // 🔴 Loaded here, not at module scope. `identity.ts` pulls in Firestore
  // through `tenant-scope.ts`, and the public routes that now import this
  // module must never download it — see the header.
  const { resolveAnalyticsIdentity } = await import('./identity');

  const identity = await resolveAnalyticsIdentity(user);
  if (!identity) return null;

  client.identify(identity.distinctId, identity.personProperties);

  if (identity.tenantGroupKey) {
    client.group(TENANT_GROUP_TYPE, identity.tenantGroupKey);
  } else {
    // 🔴 Not just "skip the group" — CLEAR it. A shared church office computer
    // signs a tenant admin in and out all day; without this, the platform
    // admin who signs in next inherits the previous person's group from
    // persisted state and lands in that church's numbers after all. Same bug
    // as the one this module exists to prevent, arriving through the back door.
    client.resetGroups();
  }

  // 🔴 THE-360 — remembered here so a product event fired later from a screen
  // that has no idea who is signed in still carries the same answer this
  // pageview does. Set AFTER the identify lands, never before.
  identifiedIsPlatformAdmin = identity.isPlatformAdmin;

  return { isPlatformAdmin: identity.isPlatformAdmin };
}

/**
 * Forget the current person. Called on sign-out.
 *
 * ⚠️ Without this, the next person to use a shared church computer inherits the
 * previous user's `distinct_id`, and their activity is filed under someone
 * else's profile — including, if that someone was a tenant admin, someone
 * else's church.
 *
 * `initAnalytics()` is deliberately NOT called here: signing out of a session
 * that never started analytics must not start it.
 */
export async function resetIdentity(): Promise<void> {
  // 🔴 THE-360 — cleared BEFORE the early return, not after it. The whole point
  // of this function is the shared church office computer, and a signed-out
  // session that never started analytics must still not leave the last person's
  // answer behind for whoever signs in next.
  identifiedIsPlatformAdmin = null;
  if (!clientPromise) return;
  const client = await clientPromise;
  client?.reset();
}
