import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE-36 — what PostHog is allowed to send from an app holding donor records.
 *
 * These tests exist because every one of the decisions they pin is a DEFAULT
 * that points the other way. Session replay is on by default in recent
 * posthog-js; autocapture is on by default and reads element text and input
 * `name` attributes; `identify()` will accept an email address as happily as a
 * uid. Nothing here is defensive coding against an unlikely mistake — each one
 * is the shipped default, refused.
 *
 * The targets are named by LABEL — `donorEmail`, `request`, `content` — never
 * by value shape. A test that hunts for an `@` passes the moment a phone number
 * leaks, and passes forever on a donor whose church types their number with
 * spaces in it.
 */

const { mockPostHog } = vi.hoisted(() => ({
  mockPostHog: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    group: vi.fn(),
    resetGroups: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock('posthog-js', () => ({ default: mockPostHog }));

const { mockGetTenantScope } = vi.hoisted(() => ({ mockGetTenantScope: vi.fn() }));
vi.mock('../../../utils/tenant-scope', () => ({
  getTenantScope: mockGetTenantScope,
  PLATFORM_TENANT_ID: 'harvest',
}));

import { SUPER_ADMIN_EMAILS } from '../../../utils/super-admins';
import {
  ALLOWED_EVENT_NAMES,
  ALLOWED_EVENT_PROPERTY_KEYS,
  ALLOWED_PERSON_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
  CONTACT_CHANNEL_LABELS,
  CONTACT_RECORD_LABELS,
  DONOR_IDENTITY_LABELS,
  FORBIDDEN_PROPERTY_LABELS,
  GIVING_LABELS,
  MESSAGE_LABELS,
  PRAYER_LABELS,
  TENANT_GROUP_TYPE,
  isForbiddenPropertyLabel,
} from '../events';
import { beforeSendEvent, buildPostHogOptions, isAnalyticsConfigured } from '../config';
import type { CaptureResult } from 'posthog-js';
import {
  __resetAnalyticsForTests,
  captureEvent,
  capturePageview,
  identifyUser,
  initAnalytics,
  isAnalyticsStarted,
  resetIdentity,
} from '../client';

/** A super-admin address, taken from the real frozen list rather than invented. */
const SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAILS[0];
/** The tenant a super admin would be looking at on `nations.theharvest.app`. */
const VIEWED_TENANT = 'nations';

const TEST_KEY = 'phc_test_project_key';

/** A CaptureResult as posthog-js would hand it to `before_send`. */
const captured = (fields: Partial<CaptureResult> & { event: string }): CaptureResult =>
  ({ uuid: '00000000-0000-4000-8000-000000000000', properties: {}, ...fields }) as CaptureResult;

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalyticsForTests();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = TEST_KEY;
  mockGetTenantScope.mockResolvedValue(VIEWED_TENANT);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('1 — session recording is disabled', () => {
  it('session recording is disabled', () => {
    // 🔴 The one that matters. /admin/crm renders donor names, giving totals,
    // emails and phone numbers; the member app renders prayer requests and
    // private messages. A replay of those screens is that data leaving.
    expect(buildPostHogOptions().disable_session_recording).toBe(true);
  });

  it('the recorder script cannot be fetched either, so enabling replay takes two edits', () => {
    // posthog-js loads rrweb as an external script on demand. Blocking that is
    // the second, independent lock: flipping disable_session_recording alone
    // still cannot start a recording.
    expect(buildPostHogOptions().disable_external_dependency_loading).toBe(true);
  });

  it('console log capture — which replays whatever was logged — is off', () => {
    expect(buildPostHogOptions().enable_recording_console_log).toBe(false);
  });
});

describe('2 — input masking is configured even though recording is off', () => {
  it('input masking is configured even though recording is off', () => {
    const options = buildPostHogOptions();
    const recording = options.session_recording!;

    // Belt and braces: the flag above is the guarantee; this is what stands if
    // someone flips it in a year without reading this file.
    expect(options.disable_session_recording).toBe(true);

    expect(recording.maskAllInputs).toBe(true);
    // '*' masks every text node on every surface — the CRM and the member app
    // included — without depending on a marker class a component could lose.
    expect(recording.maskTextSelector).toBe('*');
    // An input's `name`, `value`, `alt` and `title` are attributes, not text.
    expect(recording.maskAllElementAttributes).toBe(true);
  });
});

describe('3 — no captured event carries an email, phone, donor name, prayer request or message body', () => {
  /**
   * The property labels this codebase actually uses for the data that must
   * never leave. Enumerated, per field, from the real documents:
   *
   *   Contact           src/hooks/queries/useCRMQueries.ts
   *   CSV import        src/utils/csv-import.ts
   *   Donation webhook  src/lib/donation-webhook.ts
   *   PrayerRequest     src/components/PrayerWall.tsx
   *   Messages          src/components/UserMessages.tsx
   */
  const NAMED_TARGETS = [
    'donorName', 'donorEmail', 'donorPhone', 'donorUserId',
    'firstName', 'lastName', 'authorName', 'senderName', 'photoURL',
    'email', 'phone',
    'street', 'city', 'state', 'zip', 'country', 'notes', 'tags',
    'totalDonated', 'amount', 'amountDollars',
    'request', 'prayerRequest',
    'content', 'lastMessage', 'text', 'description',
  ];

  it('every label in the forbidden list is recognised, in each of its written forms', () => {
    for (const label of NAMED_TARGETS) {
      expect(isForbiddenPropertyLabel(label), `${label} is not recognised as forbidden`).toBe(true);
      expect(isForbiddenPropertyLabel(label.toLowerCase())).toBe(true);
    }
    // donor_email / donor-email / donorEmail are one label, not three.
    expect(isForbiddenPropertyLabel('donor_email')).toBe(true);
    expect(isForbiddenPropertyLabel('donor-email')).toBe(true);
  });

  it('the vocabulary Harvest may attach contains none of them', () => {
    // The whole vocabulary, read in full — this is short on purpose.
    //
    // ⚠️ THE-206 ADDED `route`, deliberately and by editing `events.ts`, which
    // is the mechanism this list exists to force. It carries the normalised
    // route PATTERN — `/form/[formId]`, never `/form/aB3xQ…` — because
    // `app_surface` alone cannot answer "how many people opened a form?" once
    // 'public' is one bucket holding a blog, a form and an event page. The
    // assertion below still does its real job: `route` is checked against the
    // forbidden labels like every other key.
    expect(ALLOWED_EVENT_PROPERTY_KEYS).toEqual([
      'app_surface', 'is_platform_admin', 'route', 'limit_kind',
    ]);
    expect(ALLOWED_PERSON_PROPERTY_KEYS).toEqual(['account_kind']);

    for (const key of [...ALLOWED_EVENT_PROPERTY_KEYS, ...ALLOWED_PERSON_PROPERTY_KEYS]) {
      expect(isForbiddenPropertyLabel(key), `${key} is a person-identifying label`).toBe(false);
    }
  });

  it('no captured event carries an email, phone, donor name, prayer request or message body', () => {
    // A hostile event: every named target at once, in the three bags an event
    // can carry them in.
    const hostile = captured({
      event: ANALYTICS_EVENTS.PAGEVIEW,
      properties: {
        app_surface: 'admin',
        donorName: 'Jane Okafor',
        donorEmail: 'jane@example.org',
        phone: '+44 7700 900123',
        request: 'Please pray for my mother',
        content: 'see you Sunday',
        totalDonated: 4200,
        nested: { lastName: 'Okafor', notes: 'gave at Easter', amount: 50 },
      },
      $set: { email: 'jane@example.org', firstName: 'Jane', account_kind: 'tenant_user' },
      $set_once: { lastMessage: 'thanks for the card', phone: '07700900123' },
    });

    const sent = beforeSendEvent(hostile)!;

    for (const bag of [sent.properties, sent.$set, sent.$set_once] as Record<string, unknown>[]) {
      for (const label of NAMED_TARGETS) {
        expect(bag, `${label} survived beforeSendEvent`).not.toHaveProperty(label);
      }
    }
    // …at any depth.
    const nested = (sent.properties as Record<string, Record<string, unknown>>).nested;
    expect(nested).not.toHaveProperty('lastName');
    expect(nested).not.toHaveProperty('notes');
    expect(nested).not.toHaveProperty('amount');

    // And the registered properties are untouched — this scrubs, it does not
    // empty the event.
    expect(sent.properties!.app_surface).toBe('admin');
    expect(sent.$set!.account_kind).toBe('tenant_user');
  });

  it('a URL query string never reaches a property — that is how PII arrives uninvited', async () => {
    const sent = beforeSendEvent(captured({
      event: ANALYTICS_EVENTS.PAGEVIEW,
      properties: {
        $current_url: 'https://grace.theharvest.app/admin/crm?email=jane%40example.org&token=abc',
        $referrer: 'https://mail.example.com/read?to=jane%40example.org',
        $pathname: '/admin/crm?email=jane%40example.org',
      },
    }))!;

    // The query string is gone — the original point of this test, unchanged.
    expect(sent.properties!.$current_url).not.toContain('jane%40example.org');
    expect(sent.properties!.$current_url).not.toContain('token=abc');
    expect(sent.properties!.$referrer).not.toContain('jane%40example.org');
    expect(sent.properties!.$pathname).not.toContain('jane%40example.org');

    // 🔴 THE-206 ADDED THE SECOND HALF: the PATH is normalised too. Until it,
    // every instrumented route was the SPA shell, whose paths carry nothing.
    // Instrumenting the public routes puts identifiers in the path
    // (`/form/aB3xQ…`, `/event/9f2c…`), and posthog-js builds `$current_url`
    // from `location.href` itself — so a `route` property alone would not have
    // stopped the live path being sent beside it.
    //
    // ⚠️ THE-227 changed what this path normalises TO, not whether it is
    // normalised. `crm` is an enumerated feature name, so it survives as itself
    // — matched against the closed list in `admin-sections.ts`, never passed
    // through. The id-bearing case below is the one that still collapses, and it
    // is asserted here rather than only in the public-route suite so this test
    // keeps proving the whole rule.
    expect(sent.properties!.$current_url).toBe('https://grace.theharvest.app/admin/crm');
    expect(sent.properties!.$pathname).toBe('/admin/crm');

    const withId = beforeSendEvent(captured({
      event: ANALYTICS_EVENTS.PAGEVIEW,
      properties: {
        $current_url: 'https://grace.theharvest.app/admin/crm/9f2c4471aa0e?email=jane%40example.org',
        $pathname: '/admin/crm/9f2c4471aa0e',
      },
    }))!;
    // 🔴 The contact's id, in the `[itemId]` position, is gone — and so is the
    // section beside it, because that whole path matches one pattern.
    expect(withId.properties!.$current_url)
      .toBe('https://grace.theharvest.app/admin/[section]/[itemId]');
    expect(withId.properties!.$pathname).toBe('/admin/[section]/[itemId]');

    // 🔴 And a section nobody registered does NOT survive as itself.
    const unknownSection = beforeSendEvent(captured({
      event: ANALYTICS_EVENTS.PAGEVIEW,
      properties: { $pathname: '/admin/prayer-wall' },
    }))!;
    expect(unknownSection.properties!.$pathname).toBe('/admin/[section]');
    // ⚠️ An external referrer keeps its HOST and loses its path. That is
    // over-redaction on purpose: this cannot tell our hosts from anyone else's
    // (churches provision custom domains), and posthog-js records the host
    // separately as `$referring_domain`, so attribution still works.
    expect(sent.properties!.$referrer).toBe('https://mail.example.com/[unrouted]');
  });

  it('a public route id never survives into $current_url — THE-206', async () => {
    const sent = beforeSendEvent(captured({
      event: ANALYTICS_EVENTS.PAGEVIEW,
      properties: {
        $current_url: 'https://nations.theharvest.app/checkin/9fZc3Rt8yUq1BwEo',
      },
    }))!;

    // A children's check-in session id, on a page a parent opens from a QR code.
    expect(sent.properties!.$current_url).toBe('https://nations.theharvest.app/checkin/[sessionId]');
  });

  it('the DOM-reading events are refused by name, not merely switched off', () => {
    // Each of these is a real leak route on this app's screens:
    //   $autocapture         element textContent + input name attributes
    //   $copy_autocapture    the text an admin copied — a donor's email
    //   $exception           error strings, which carry webhook donor metadata
    //   $web_vitals / $rageclick / $dead_click  URL- and DOM-derived payloads
    for (const event of ['$autocapture', '$copy_autocapture', '$exception', '$web_vitals', '$rageclick', '$dead_click', '$heatmaps_data']) {
      expect(beforeSendEvent(captured({ event })), `${event} was not dropped`).toBeNull();
      expect(ALLOWED_EVENT_NAMES).not.toContain(event);
    }
    // The vocabulary, in full.
    expect(ALLOWED_EVENT_NAMES).toEqual([
      '$pageview',
      'gift_recorded',
      'event_payment_confirmed',
      'course_published',
      'service_created',
      'rota_invitations_sent',
      'form_published',
      'signup_created',
      'campaign_created',
      'plan_limit_reached',
      '$identify',
      '$groupidentify',
      '$set',
    ]);
  });

  it('autocapture is off at the source as well', () => {
    const options = buildPostHogOptions();
    expect(options.autocapture).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.rageclick).toBe(false);
    // Sentry captures exceptions, through sentry-scrub.ts. A second vendor with
    // none of that scrubbing would undo it.
    expect(options.capture_exceptions).toBe(false);
  });

  it('an unregistered property is dropped at the capture boundary, before before_send', async () => {
    await captureEvent(ANALYTICS_EVENTS.PAGEVIEW, {
      app_surface: 'member',
      donorEmail: 'jane@example.org',
      contact: { phone: '07700900123' },
    });

    expect(mockPostHog.capture).toHaveBeenCalledWith('$pageview', { app_surface: 'member' });
  });

  it('every forbidden label is lower-case and comparable — the list itself is well-formed', () => {
    for (const label of FORBIDDEN_PROPERTY_LABELS) {
      expect(label, `${label} must be stored lower-case`).toBe(label.toLowerCase());
      expect(label).not.toMatch(/[_-]/);
    }
    for (const group of [DONOR_IDENTITY_LABELS, CONTACT_CHANNEL_LABELS, CONTACT_RECORD_LABELS, GIVING_LABELS, PRAYER_LABELS, MESSAGE_LABELS]) {
      expect(group.length).toBeGreaterThan(0);
    }
  });
});

describe('4 — a user is identified by uid, never by email', () => {
  it('a user is identified by uid, never by email', async () => {
    await identifyUser({ uid: 'uid-abc-123', email: 'jane@example.org' });

    expect(mockPostHog.identify).toHaveBeenCalledWith('uid-abc-123', { account_kind: 'tenant_user' });

    // The distinct_id is the profile's primary key in PostHog: searchable,
    // exported, and not deleted by reset(). Nothing passed to identify may
    // carry the address a donor would be recognised by.
    const [distinctId, personProperties] = mockPostHog.identify.mock.calls[0];
    expect(distinctId).toBe('uid-abc-123');
    expect(personProperties).not.toHaveProperty('email');
    expect(JSON.stringify(mockPostHog.identify.mock.calls)).not.toContain('jane@example.org');
  });

  it('person profiles are created for signed-in users only', () => {
    expect(buildPostHogOptions().person_profiles).toBe('identified_only');
  });
});

describe('5 — a super admin is not attributed to the tenant they are viewing', () => {
  it('a tenant user is grouped by their church', async () => {
    // The control case: without this passing, the test below proves nothing.
    await identifyUser({ uid: 'uid-member', email: 'member@grace.org' });
    expect(mockPostHog.group).toHaveBeenCalledWith(TENANT_GROUP_TYPE, VIEWED_TENANT);
  });

  it('a super admin is not attributed to the tenant they are viewing', async () => {
    // ⚠️ getTenantScope() answers `nations` here — correctly, as a DATA
    // boundary: on nations.theharvest.app a super admin reads nations' data.
    // Reused as an analytics group it becomes a reporting bug, inflating the
    // engagement of every church the platform owner opens.
    await identifyUser({ uid: 'uid-super', email: SUPER_ADMIN_EMAIL });

    expect(mockPostHog.group).not.toHaveBeenCalled();
    expect(mockPostHog.identify).toHaveBeenCalledWith('uid-super', { account_kind: 'platform_admin' });

    // The host's answer is never even requested, so there is no value for a
    // later change to pick up by accident.
    expect(mockGetTenantScope).not.toHaveBeenCalled();
  });

  it('a stale group from the previous user is cleared, not merely skipped', async () => {
    // A shared church office computer: the tenant admin signs out, the platform
    // owner signs in. Without resetGroups() the persisted group survives and
    // the super admin lands in that church's numbers anyway.
    await identifyUser({ uid: 'uid-super', email: SUPER_ADMIN_EMAIL });
    expect(mockPostHog.resetGroups).toHaveBeenCalledTimes(1);
  });

  it('a user whose tenant cannot be resolved is grouped under nobody', async () => {
    mockGetTenantScope.mockResolvedValue(null);
    await identifyUser({ uid: 'uid-orphan', email: 'orphan@example.org' });
    expect(mockPostHog.group).not.toHaveBeenCalled();
    expect(mockPostHog.resetGroups).toHaveBeenCalledTimes(1);
  });
});

describe('6 — identity is reset on sign-out', () => {
  it('identity is reset on sign-out', async () => {
    await identifyUser({ uid: 'uid-first', email: 'first@grace.org' });
    await resetIdentity();
    expect(mockPostHog.reset).toHaveBeenCalledTimes(1);
  });

  it('signing out of a session that never started analytics starts nothing', async () => {
    // resetIdentity() must not be the thing that boots PostHog — otherwise
    // landing on /auth and signing out would initialise it on a pre-auth path.
    await resetIdentity();
    expect(mockPostHog.init).not.toHaveBeenCalled();
    expect(mockPostHog.reset).not.toHaveBeenCalled();
    expect(isAnalyticsStarted()).toBe(false);
  });
});

describe('7 — nothing initialises when the key is absent, and nothing throws', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  it('nothing initialises when the key is absent, and nothing throws', async () => {
    expect(isAnalyticsConfigured()).toBe(false);

    await expect(initAnalytics()).resolves.toBeNull();
    await expect(captureEvent(ANALYTICS_EVENTS.PAGEVIEW, { app_surface: 'admin' })).resolves.toBeUndefined();
    await expect(capturePageview('/admin/crm', false)).resolves.toBeUndefined();
    await expect(identifyUser({ uid: 'uid-x', email: 'x@example.org' })).resolves.toBeNull();
    await expect(resetIdentity()).resolves.toBeUndefined();

    expect(mockPostHog.init).not.toHaveBeenCalled();
    expect(mockPostHog.capture).not.toHaveBeenCalled();
    expect(mockPostHog.identify).not.toHaveBeenCalled();
    expect(isAnalyticsStarted()).toBe(false);

    // Not even the Firestore read that resolves the tenant group: an app with
    // no project key must do no work on sign-in, not merely send nothing.
    expect(mockGetTenantScope).not.toHaveBeenCalled();
  });

  it('a blank or whitespace key counts as absent, not as a key', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = '   ';
    expect(isAnalyticsConfigured()).toBe(false);
    await expect(initAnalytics()).resolves.toBeNull();
    expect(mockPostHog.init).not.toHaveBeenCalled();
  });

  it('with a key, it initialises exactly once no matter how many callers ask', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = TEST_KEY;
    await Promise.all([initAnalytics(), initAnalytics(), captureEvent(ANALYTICS_EVENTS.PAGEVIEW, {})]);
    expect(mockPostHog.init).toHaveBeenCalledTimes(1);
    expect(mockPostHog.init).toHaveBeenCalledWith(TEST_KEY, expect.objectContaining({ disable_session_recording: true }));
  });
});

describe('region', () => {
  it('defaults to the EU cloud, and the founder can override it for a US project', () => {
    expect(buildPostHogOptions().api_host).toBe('https://eu.i.posthog.com');
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://us.i.posthog.com';
    expect(buildPostHogOptions().api_host).toBe('https://us.i.posthog.com');
  });

  it('a rejected request is reported with its real status code, and names both variables', () => {
    // The failure this guards is the quiet one: a key pointed at the wrong
    // region 401s every event, and an empty dashboard reads as "nobody used
    // the product". The status code has to be the SDK's actual field —
    // `statusCode`, not `status` — or this logs `undefined` forever.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    buildPostHogOptions().on_request_error!({ statusCode: 401 });

    const message = spy.mock.calls[0][0] as string;
    expect(message).toContain('401');
    expect(message).toContain('NEXT_PUBLIC_POSTHOG_KEY');
    expect(message).toContain('NEXT_PUBLIC_POSTHOG_HOST');
    spy.mockRestore();
  });
});
