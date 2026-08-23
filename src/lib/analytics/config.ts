/**
 * THE-36 — PostHog configuration, and the last line of defence before anything
 * leaves the browser.
 *
 * This module is deliberately PURE: it imports nothing from `posthog-js`, reads
 * no browser API at module scope and starts nothing. It is the shape of the
 * install, expressed as data, so the privacy decisions can be asserted by a
 * test without booting an SDK. `client.ts` is the only module that loads
 * PostHog itself.
 *
 * ─── The decisions, and why ──────────────────────────────────────────────────
 *
 * 🔴 SESSION REPLAY IS OFF. `disable_session_recording: true`. Harvest's
 *    `/admin/crm` renders donor names, giving totals, email addresses and phone
 *    numbers; the member app renders prayer requests and private messages. A
 *    replay of those screens is that data leaving for a third party, and no
 *    amount of masking makes shipping it the default acceptable. This is not a
 *    preference the PostHog project can override: posthog-js gates the recorder
 *    on `enabled_server_side && enabled_client_side && !isDisabled`
 *    (session-recording.ts), and this flag falsifies the last two — so turning
 *    replay on in the PostHog UI does not start it here.
 *
 * 🔴 MASKING IS CONFIGURED ANYWAY. Belt and braces: if someone flips the flag
 *    above in a year, the recorder must not leak on its first frame. So
 *    `maskAllInputs: true` and `maskTextSelector: '*'` are set now, while
 *    nothing is recording. `'*'` masks EVERY text node on EVERY surface, which
 *    covers the CRM and the member app without depending on a marker class
 *    somebody could delete from a component. `maskAllElementAttributes` closes
 *    the second half of the same hole — an input's `name`, `value`, `alt` and
 *    `title` are attributes, not text.
 *
 * 🔴 AUTOCAPTURE IS OFF. `autocapture: false`. Autocapture decides what to send
 *    by reading the DOM: element `textContent` and input `name` attributes. On
 *    a contact form that is PII, and on `/admin/crm` the element text IS the
 *    donor record. Events are instrumented explicitly instead — see
 *    `events.ts`, which is the whole list. The related DOM-reading captures go
 *    with it: heatmaps, dead clicks, rageclicks and `$copy_autocapture` (which
 *    captures the text the user copied — on the CRM, a donor's email address).
 *
 * ⚠️ EXCEPTIONS ARE NOT CAPTURED HERE. Sentry already does that, through
 *    `sentry-scrub.ts`, which exists because donor metadata reaches error
 *    messages by way of `console.error` in the webhook routes. Sending the same
 *    strings to a second vendor with none of that scrubbing would undo it.
 *
 * ⚠️ ANONYMOUS VISITORS GET NO PROFILE, and THE-206 is when that started to
 *    matter. `person_profiles: 'identified_only'` was set by THE-36 while every
 *    instrumented surface was behind a login, so it never had an anonymous
 *    visitor to apply to. The public routes are unauthenticated by definition,
 *    and this setting is what makes them a COUNT rather than a growing pile of
 *    profiles for people who never signed up: posthog-js marks such events
 *    `$process_person_profile: false`, so no person record is created or
 *    updated. What the visitor does get is a random device id in first-party
 *    storage — not a name, not an email, and nothing this app ever reads.
 *
 * ─── Region ──────────────────────────────────────────────────────────────────
 *
 * The host defaults to PostHog's EU cloud. See `docs/analytics-posthog.md` —
 * the region is fixed at project creation and cannot be migrated, so it is a
 * founder decision, and this default is the recommendation, not the answer.
 */

import type { CaptureResult, PostHogConfig, Properties, RequestResponse } from 'posthog-js';

import {
  ALLOWED_EVENT_NAMES,
  isForbiddenPropertyLabel,
} from './events';
import { normalizeUrlPath } from './routes';

/* ── environment ───────────────────────────────────────────────────────────── */

/**
 * PostHog's EU cloud ingestion host. The default because Harvest's customers
 * are churches in the EU and the data subjects are their members.
 */
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com';

/** PostHog's US cloud ingestion host — set explicitly if the project is US. */
export const POSTHOG_US_HOST = 'https://us.i.posthog.com';

/**
 * The project key.
 *
 * 🔴 This is the PUBLIC project key (`phc_…`), which ships in the client bundle
 * by design — the same category of value as the Sentry DSN one directory up. A
 * personal API key (`phx_…`) is a SECRET, grants write access to the whole
 * PostHog account, and must never be committed or put in a `NEXT_PUBLIC_*`
 * variable.
 *
 * Read through a function so a test can move it. Next inlines
 * `process.env.NEXT_PUBLIC_*` textually at build time, including inside a
 * function body, so this reads correctly in the browser too.
 */
export function readPostHogKey(): string {
  return (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim();
}

/** The ingestion host, defaulting to EU. */
export function readPostHogHost(): string {
  return (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '').trim() || POSTHOG_EU_HOST;
}

/**
 * Whether analytics may start at all.
 *
 * With no key this is false everywhere, and every entry point in `client.ts`
 * returns without loading the SDK — nothing initialises, nothing is fetched,
 * nothing throws. That is the intended state of this PR until the founder
 * creates the project.
 */
export function isAnalyticsConfigured(): boolean {
  return readPostHogKey().length > 0;
}

/* ── the scrubber ──────────────────────────────────────────────────────────── */

/** Depth cap on the recursive walk — a cycle-proof bound, not a tuning knob. */
const MAX_SCRUB_DEPTH = 6;

/**
 * A URL with its query string and fragment removed, and its path reduced to a
 * route pattern.
 *
 * Query strings are where PII reaches analytics without anyone deciding to send
 * it: a link mailed to a member arrives as `?email=…`, a share link carries a
 * token. PostHog attaches `$current_url`, `$referrer` and a growing family of
 * `$session_entry_*` properties to every event, so the rule is applied by VALUE
 * SHAPE (anything that looks like a URL) rather than by an enumerated key list
 * that would fall behind the next SDK release.
 *
 * 🔴 THE-206 added the second half. Until it, only the query string was a
 * problem, because every instrumented route was the SPA shell and its paths
 * (`/`, `/admin/crm`) carry nothing. Instrumenting the public routes puts
 * identifiers in the PATH — `/form/aB3xQ…`, `/event/9f2c…`, `/checkin/…` —
 * and `$current_url` would have carried them whether we sent a `route`
 * property or not, because the SDK builds it from `location.href` itself.
 *
 * ⚠️ So the path is normalised HERE as well as at the capture site: this is the
 * only place that sees the SDK's own properties. `/form/aB3xQ…` becomes
 * `/form/[formId]`; an unrecognised path becomes `/[unrouted]`. The host is
 * kept — it is a church's subdomain, the same slug already used as the group
 * key, not a person.
 *
 * Campaign attribution is unaffected: posthog-js reads `utm_*` and click ids
 * from `location.search` directly, into their own properties, not out of this
 * string.
 */
function stripUrlNoise(value: string): string {
  const cut = value.search(/[?#]/);
  return normalizeUrlPath(cut === -1 ? value : value.slice(0, cut));
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/');
}

/**
 * Remove every forbidden label from a property bag, at any depth, and strip the
 * query string from anything URL-shaped.
 *
 * Removal is by KEY NAME, the same mechanism `sentry-scrub.ts` uses and for the
 * same reason: a value-shaped test ("does this look like an email?") passes
 * whatever it fails to recognise, and a donor's phone number formatted the way
 * their church types it is exactly the thing it will not recognise.
 */
export function scrubProperties(input: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return undefined;

  if (typeof input === 'string') {
    return looksLikeUrl(input) ? stripUrlNoise(input) : input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => scrubProperties(item, depth + 1));
  }

  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      // PostHog's own `$`-prefixed properties are its plumbing ($session_id,
      // $lib, $geoip_*). They are not document fields, and dropping one breaks
      // ingestion — so the label check applies to OUR namespace only. Their
      // values still go through the URL strip below.
      if (!key.startsWith('$') && isForbiddenPropertyLabel(key)) continue;
      out[key] = scrubProperties(value, depth + 1);
    }
    return out;
  }

  return input;
}

/**
 * The `before_send` hook: the single choke point every event passes through.
 *
 * Two jobs, in order:
 *   1. Drop any event whose name is not in the vocabulary. This is what makes
 *      the list in `events.ts` a guarantee rather than a convention — an
 *      autocapture, a `$copy_autocapture`, an `$exception`, a `$web_vitals`
 *      never leaves, even if a future SDK default turns it back on.
 *   2. Scrub `properties`, `$set` and `$set_once`. `$set`/`$set_once` are the
 *      person-profile bags and are just as capable of carrying an email as the
 *      event body — they are the shape `identify()` sends.
 */
export function beforeSendEvent(result: CaptureResult | null): CaptureResult | null {
  if (!result) return null;

  if (!ALLOWED_EVENT_NAMES.includes(result.event)) {
    if (process.env.NODE_ENV !== 'production') {
      // Loud in development, silent in production. A dropped event is the safe
      // outcome, but a developer who added one without registering it needs to
      // learn that here rather than from an empty dashboard three weeks later.
      // eslint-disable-next-line no-console
      console.warn(
        `[analytics] dropped unregistered event "${result.event}" — add it to ANALYTICS_EVENTS in src/lib/analytics/events.ts`,
      );
    }
    return null;
  }

  const scrubbed: CaptureResult = { ...result };
  if (scrubbed.properties) scrubbed.properties = scrubProperties(scrubbed.properties) as Properties;
  if (scrubbed.$set) scrubbed.$set = scrubProperties(scrubbed.$set) as Properties;
  if (scrubbed.$set_once) scrubbed.$set_once = scrubProperties(scrubbed.$set_once) as Properties;
  return scrubbed;
}

/* ── the options object ────────────────────────────────────────────────────── */

/**
 * Every option passed to `posthog.init()`, as a plain object so the test suite
 * can read the decisions without starting anything.
 *
 * Typed as `Partial<PostHogConfig>` rather than a loose record on purpose: a
 * mistyped option name is silently ignored by `init()`, and the option most
 * worth mistyping is `disable_session_recording`. The compiler is the thing
 * that catches that, not review.
 *
 * ⚠️ `persistence` is left at PostHog's default (`localStorage+cookie`), which
 * IS a cookie. Whether that needs consent from an EU church's members is a
 * legal question, not a technical one, and this PR does not answer it or build
 * a banner — see `docs/analytics-posthog.md` for what the two other settings
 * (`memory`, `cookieless_mode`) would change and what a consent-gated setup
 * would require.
 */
export function buildPostHogOptions(): Partial<PostHogConfig> {
  return {
    api_host: readPostHogHost(),

    /* ── replay ────────────────────────────────────────────────────────────── */
    disable_session_recording: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      maskAllElementAttributes: true,
      // The rrweb marker classes, named explicitly rather than left implicit,
      // so a component that wants belt-and-braces has something to reach for.
      maskTextClass: 'ph-mask',
      blockClass: 'ph-no-capture',
      ignoreClass: 'ph-ignore-input',
      collectFonts: false,
    },
    enable_recording_console_log: false,

    /* ── autocapture and its DOM-reading relatives ─────────────────────────── */
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    capture_exceptions: false,
    capture_performance: false,

    /* ── pageviews ─────────────────────────────────────────────────────────── */
    // Manual: the SDK's automatic version fires on every history change,
    // including the pre-auth funnel that AnalyticsBridge exists to exclude.
    capture_pageview: false,
    capture_pageleave: false,

    /* ── product surfaces we do not use ────────────────────────────────────── */
    disable_surveys: true,
    disable_web_experiments: true,
    // No external script may be fetched — recorder.js, surveys.js, toolbar.js.
    // The second lock on replay: even with the flag above flipped, the recorder
    // cannot be downloaded. Two deliberate edits, not one.
    disable_external_dependency_loading: true,

    /* ── person data ───────────────────────────────────────────────────────── */
    // Only signed-in users get a person profile; an anonymous visitor is a
    // count, not a record.
    person_profiles: 'identified_only',
    // Strips advertising ids and the named params below out of captured URLs.
    mask_personal_data_properties: true,
    custom_personal_data_properties: ['email', 'phone', 'name', 'token', 'uid', 'contact'],
    respect_dnt: true,

    /* ── the choke point ───────────────────────────────────────────────────── */
    before_send: beforeSendEvent,

    /**
     * A wrong region is a silent failure: events 401 and the dashboard simply
     * stays empty, which reads as "nobody used the product". Surface it.
     */
    on_request_error: (response: RequestResponse) => {
      // eslint-disable-next-line no-console
      console.error(
        `[analytics] PostHog rejected a request (status ${response?.statusCode ?? 'unknown'}). ` +
          `Check NEXT_PUBLIC_POSTHOG_KEY and that NEXT_PUBLIC_POSTHOG_HOST (${readPostHogHost()}) matches the project's region.`,
      );
    },
  };
}
