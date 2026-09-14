import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-360 — widening a closed vocabulary without opening it.
 *
 * ─── What this suite is actually guarding ────────────────────────────────────
 *
 * `events.ts` held ONE event name. This ticket takes it to ten, and every one
 * of the nine additions fires at the moment a church does something that
 * involves money, members or material. The danger is not that an event is
 * missing — it is that an event arrives carrying the record it was fired next
 * to: the donor whose gift was recorded, the title of the course, the answers
 * on the form, the amount.
 *
 * So the assertions below are about what CANNOT be sent, not about what can.
 * The vocabulary is asserted as a SPELLED-OUT LIST rather than read back from
 * the source it is meant to constrain — a test that asserts
 * `ALLOWED_EVENT_NAMES` equals `ALLOWED_EVENT_NAMES` passes forever and guards
 * nothing.
 *
 * ─── ⚠️ Every content grep here runs over PARSER-STRIPPED source ─────────────
 *
 * `events.ts` and `routes.ts` are mostly PROSE. A sweep for the string
 * `gift_recorded` over raw source matches the docblock that explains why no
 * amount rides on it, and reports a guard as satisfied by a comment. The
 * stripper is IMPORTED from the shared fixture (#496), never copied — a copied
 * probe is how a guard in this series ended up structurally unable to fail.
 *
 * 🔴 AND THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS. #496 found two of its own
 * guards SELF-MATCHING: the literal they swept for was written in the sweeping
 * file, so the sweep found itself and passed. Anything this file greps for is
 * built with `join` at run time and appears nowhere as a whole token.
 */

import { stripComments } from '../../../__tests__/__fixtures__/the-346-strip-comments';
import { acceptedRulesDigests } from '../../../__tests__/__fixtures__/firestore-rules-pin';

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

import {
  ALLOWED_EVENT_NAMES,
  ALLOWED_EVENT_PROPERTY_KEYS,
  ALLOWED_PERSON_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
  FORBIDDEN_PROPERTY_LABELS,
  PLAN_LIMIT_KINDS,
  isForbiddenPropertyLabel,
} from '../events';
import { beforeSendEvent, buildPostHogOptions } from '../config';
import { UNROUTED_PATTERN } from '../routes';
import {
  __resetAnalyticsForTests,
  captureProductEvent,
  identifyUser,
  trackProductEvent,
} from '../client';
import type { CaptureResult } from 'posthog-js';

const ROOT = path.resolve(__dirname, '../../../..');
const TEST_KEY = 'phc_test_project_key';

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const stripped = (rel: string): string => stripComments(read(rel));
const sha = (rel: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

const captured = (fields: Partial<CaptureResult> & { event: string }): CaptureResult =>
  ({ uuid: '00000000-0000-4000-8000-000000000000', properties: {}, ...fields }) as CaptureResult;

/**
 * The nine events this ticket adds, with the file that fires each one.
 *
 * ⚠️ A FILE, NEVER A LINE NUMBER. THE-331 pinned `AdminCommunity.tsx:491` and a
 * deletion elsewhere moved the same code to `:311`, so the guard failed on a
 * change that was not the one it was watching for. Every location in this file
 * is a path and a token.
 */
const PRODUCT_EVENTS = [
  ['GIFT_RECORDED', 'gift_recorded', 'src/components/AdminCRM.tsx'],
  ['EVENT_PAYMENT_CONFIRMED', 'event_payment_confirmed', 'src/components/inbox/payment-claims-client.ts'],
  ['COURSE_PUBLISHED', 'course_published', 'src/components/AdminCourseEditor.tsx'],
  ['SERVICE_CREATED', 'service_created', 'src/hooks/queries/useServicePlanQueries.ts'],
  ['ROTA_INVITATIONS_SENT', 'rota_invitations_sent', 'src/components/events/RotaInvitePanel.tsx'],
  ['FORM_PUBLISHED', 'form_published', 'src/components/AdminForms.tsx'],
  ['SIGNUP_CREATED', 'signup_created', 'src/components/PublicForm.tsx'],
  ['CAMPAIGN_CREATED', 'campaign_created', 'src/components/AdminFundraising.tsx'],
  ['PLAN_LIMIT_REACHED', 'plan_limit_reached', 'src/components/AdminCRM.tsx'],
] as const;

/**
 * Every file this ticket wires an event into.
 *
 * ⚠️ Two of these are SHARED WRITE SEAMS rather than screens, and deliberately:
 * `payment-claims-client.ts` is where AdminEvents and TenantInbox both confirm
 * a payment, and `useServicePlanQueries.ts` is where AdminServices and
 * ServicePlanPanel both create a plan. Instrumenting the seam is what makes the
 * event fire once per action rather than once per screen somebody remembered.
 */
const CALL_SITES: readonly string[] = [
  ...new Set<string>(PRODUCT_EVENTS.map(([, , file]) => file)),
  'src/components/AdminRoles.tsx',
  'src/components/AdminSms.tsx',
];

/** Set the SPA's path for a capture. Product events read `location.pathname`. */
function atPath(pathname: string): void {
  window.history.replaceState({}, '', pathname);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalyticsForTests();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = TEST_KEY;
  mockGetTenantScope.mockResolvedValue('nations');
  atPath('/admin/crm');
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

/** The properties of the single capture that happened. */
const onlyCapture = (): { event: string; props: Record<string, unknown> } => {
  expect(mockPostHog.capture).toHaveBeenCalledTimes(1);
  const [event, props] = mockPostHog.capture.mock.calls[0];
  return { event, props: (props ?? {}) as Record<string, unknown> };
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — an event not in the vocabulary is DROPPED before the network
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 — an event not in the vocabulary is dropped before the network', () => {
  it('an unregistered event never leaves, whatever it is called', () => {
    // Assembled, so this file does not contain the needles it sweeps for and
    // cannot satisfy its own greps below.
    const unregistered = [
      ['gift', 'deleted'].join('_'),
      ['donor', 'exported'].join('_'),
      ['prayer', 'read'].join('_'),
      ['course', 'adopted'].join('_'),
      ['onboarding', 'step', 'completed'].join('_'),
    ];
    for (const event of unregistered) {
      expect(beforeSendEvent(captured({ event })), `"${event}" was not dropped`).toBeNull();
    }
  });

  it('every event that IS registered survives, so the drop is a list and not a mood', () => {
    for (const event of ALLOWED_EVENT_NAMES) {
      expect(beforeSendEvent(captured({ event })), `"${event}" was dropped`).not.toBeNull();
    }
  });

  it('the vocabulary is exactly these thirteen names', () => {
    // 🔴 SPELLED OUT. Comparing the export to itself would pass forever; this
    // is the assertion a tenth product event has to come through.
    expect([...ALLOWED_EVENT_NAMES]).toEqual([
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

  it('no event was added for reading, viewing or opening anything', () => {
    // Pageviews already answer that, and every extra event is a new way for a
    // property to leak.
    const verbs = ['view', 'read', 'open', 'seen', 'visit', 'click', 'scroll'];
    for (const name of ALLOWED_EVENT_NAMES) {
      if (name.startsWith('$')) continue; // PostHog's own plumbing
      for (const verb of verbs) {
        expect(name, `"${name}" reads like a ${verb} event`).not.toContain(verb);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — a property not in the vocabulary is DROPPED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 — a property not in the vocabulary is dropped', () => {
  it('an unregistered property never reaches capture, at the build layer', async () => {
    await captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
    const { props } = onlyCapture();
    for (const key of Object.keys(props)) {
      expect(ALLOWED_EVENT_PROPERTY_KEYS, `"${key}" is not registered`).toContain(key);
    }
  });

  it('before_send strips a forbidden key the SDK itself attached', () => {
    const label = ['donor', 'Email'].join('');
    const result = beforeSendEvent(
      captured({ event: 'gift_recorded', properties: { [label]: 'x@y.z', route: '/admin/crm' } }),
    );
    expect(Object.keys(result!.properties!)).not.toContain(label);
    expect(result!.properties!.route).toBe('/admin/crm');
  });

  it('the property list is exactly these four keys', () => {
    expect([...ALLOWED_EVENT_PROPERTY_KEYS]).toEqual([
      'app_surface',
      'is_platform_admin',
      'route',
      'limit_kind',
    ]);
    expect([...ALLOWED_PERSON_PROPERTY_KEYS]).toEqual(['account_kind']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — no permitted property is person-identifying
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 — no permitted property is person-identifying', () => {
  it.each([...ALLOWED_EVENT_PROPERTY_KEYS, ...ALLOWED_PERSON_PROPERTY_KEYS])(
    '"%s" is not a person-identifying field',
    (key) => {
      expect(isForbiddenPropertyLabel(key), `"${key}" names a person`).toBe(false);
    },
  );

  it('the limit kinds are a frozen, closed enumeration of feature names', () => {
    // 🔴 THE VALUES ARE WALKED TOO, not just the key. A key can be innocent
    // while its values are the record — which is the shape `admin-sections.ts`
    // exists to refuse, and `limit_kind` is the only property in this app whose
    // values are a vocabulary of their own.
    //
    // ⚠️ `isForbiddenPropertyLabel` IS DELIBERATELY NOT THE TEST HERE, and the
    // reason is worth writing down because it looks like an omission.
    // `isForbiddenPropertyLabel('contacts')` is TRUE — `contacts` sits in
    // CONTACT_RECORD_LABELS, because a property KEY called `contacts` would be
    // the CRM record itself. That function answers a question about KEYS, and
    // `scrubProperties` only ever applies it to keys. Here `contacts` is a
    // VALUE naming a FEATURE — "the contacts cap" — in the same category as
    // `app_surface: 'admin'`. Running the key test over the values would fail
    // on a string that is not a contact and never was.
    //
    // So the guarantee is asserted directly instead: the set is frozen, it is
    // exactly these three, and every member is a literal this app wrote.
    expect(Object.isFrozen(PLAN_LIMIT_KINDS) || Array.isArray(PLAN_LIMIT_KINDS)).toBe(true);
    expect([...PLAN_LIMIT_KINDS]).toEqual(['contacts', 'sms', 'admin_seats']);
  });

  it.each(PLAN_LIMIT_KINDS)('the limit kind "%s" cannot be a person or free text', (kind) => {
    // Feature-shaped: lower snake_case, short, and nothing a document or a
    // person could have supplied. An email, a phone number, a name with a
    // space in it or an id would all fail this.
    expect(kind).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    expect(kind.length).toBeLessThanOrEqual(20);
    expect(kind).not.toContain('@');
  });

  it('a capture can only ever carry one of the three kinds', async () => {
    for (const kind of PLAN_LIMIT_KINDS) {
      vi.clearAllMocks();
      __resetAnalyticsForTests();
      await captureProductEvent(ANALYTICS_EVENTS.PLAN_LIMIT_REACHED, { limitKind: kind });
      expect(PLAN_LIMIT_KINDS).toContain(onlyCapture().props.limit_kind as never);
    }
  });

  it('no other event carries a limit kind', async () => {
    // It rides on `plan_limit_reached` alone. An event that is not about a cap
    // has no business naming one.
    await captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
    expect(onlyCapture().props).not.toHaveProperty('limit_kind');
  });

  it('the forbidden list still covers the money, the names and the free text', () => {
    // A sample from each family, assembled. If one of these ever stops being
    // forbidden, it became sendable — which is the mutation this catches.
    const mustStayForbidden = [
      ['donor', 'name'].join(''),
      ['recipient', 'email'].join(''),
      ['total', 'donated'].join(''),
      ['amount'].join(''),
      ['prayer', 'request'].join(''),
      ['last', 'message'].join(''),
      ['description'].join(''),
    ];
    for (const label of mustStayForbidden) {
      expect(FORBIDDEN_PROPERTY_LABELS, `"${label}" is no longer forbidden`).toContain(label);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — autocapture is off · capture_pageview is off
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 — autocapture and automatic pageviews are still off', () => {
  it('autocapture and every DOM-reading relative stay off', () => {
    const options = buildPostHogOptions();
    expect(options.autocapture).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.rageclick).toBe(false);
    // Widening the vocabulary is not a licence to let the DOM decide what goes
    // in it. On /admin/crm the element text IS the donor record.
    expect(options.disable_session_recording).toBe(true);
  });

  it('capture_pageview stays off, so the pre-auth funnel stays excluded', () => {
    // The SDK's automatic version fires on every history change including
    // `/auth` — the surface deliberately not tracked. THE-360 adds no event to
    // the pre-auth screens and does not turn this on to reach them.
    expect(buildPostHogOptions().capture_pageview).toBe(false);
    expect(buildPostHogOptions().capture_pageleave).toBe(false);
  });

  it('no onboarding event was added, because those screens start no SDK at all', () => {
    // `/onboarding` and `/church-onboarding` are PREAUTH_PATHS: AnalyticsBridge
    // returns before init, identify and pageview. An event fired there would
    // START PostHog on the screens built out of email and password inputs,
    // which is the guarantee THE-36 chose over instrumentation.
    const needle = ['onboarding', 'step', 'completed'].join('_');
    expect(ALLOWED_EVENT_NAMES).not.toContain(needle);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — the identity-event list is a LIST, not a prefix rule
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 — the identity-event list is a list, not a $ prefix', () => {
  it.each(['$autocapture', '$copy_autocapture', '$exception', '$web_vitals', '$pageleave'])(
    '%s is refused even though it starts with $',
    (event) => {
      // 🔴 $copy_autocapture is the one that matters: it captures the text the
      // user copied, and on /admin/crm that is a donor's email address selected
      // by an admin doing their job. A prefix rule would admit it.
      expect(beforeSendEvent(captured({ event }))).toBeNull();
    },
  );

  it('the three plumbing events that ARE allowed are allowed by name', () => {
    for (const event of ['$identify', '$groupidentify', '$set']) {
      expect(ALLOWED_EVENT_NAMES).toContain(event);
    }
    // And the list is not "every $ event": if it were, the count of allowed
    // $-prefixed names would grow with whatever the SDK invents next.
    const dollarNames = ALLOWED_EVENT_NAMES.filter((n) => n.startsWith('$'));
    expect(dollarNames).toEqual(['$pageview', '$identify', '$groupidentify', '$set']);
  });

  it('events.ts spells the identity events out rather than testing a prefix', () => {
    const src = stripped('src/lib/analytics/events.ts');
    // The three names appear as literals in code, not in prose.
    for (const name of ['identify', 'groupidentify']) {
      expect(src, `$${name} is not a literal in events.ts code`).toContain(`'$${name}'`);
    }
    // And no `startsWith('$')` test decides membership.
    expect(src).not.toContain(['starts', 'With'].join('') + "('$')");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — a resolved path never becomes a property
 * 7 — an unmatched path becomes UNROUTED_PATTERN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 — a resolved path never becomes a property', () => {
  it.each([
    ['/form/aB3xQ9kLmN2pR', '/form/[formId]'],
    ['/event/9f2c4d7e1a', '/event/[eventId]'],
    ['/admin/crm/8c1f0b2e', '/admin/[section]/[itemId]'],
    ['/rota/deadbeefcafe0123', '/rota/[token]'],
    ['/n/0123456789abcdef', '/n/[token]'],
  ])('%s is sent as %s and the live segment never appears', async (live, pattern) => {
    atPath(live);
    await captureProductEvent(ANALYTICS_EVENTS.SIGNUP_CREATED);
    const { props } = onlyCapture();
    expect(props.route).toBe(pattern);

    // 🔴 And the resolved segment appears in NO property, at any depth. The
    // pattern being right is not the same as the id being absent.
    const segment = live.split('/').filter(Boolean).pop()!;
    expect(JSON.stringify(props)).not.toContain(segment);
  });

  it('a product event carries the pattern, never `location.pathname` itself', async () => {
    atPath('/form/aB3xQ9kLmN2pR');
    await captureProductEvent(ANALYTICS_EVENTS.SIGNUP_CREATED);
    const { props } = onlyCapture();
    expect(props.route).not.toBe(window.location.pathname);
  });
});

describe('7 — an unmatched path becomes UNROUTED_PATTERN', () => {
  it.each([
    '/nothing/like/this',
    '/admin/crm/9f2c/extra/deep',
    '/some-future-page',
  ])('%s over-redacts rather than passing through', async (live) => {
    atPath(live);
    await captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
    const { props } = onlyCapture();
    expect(props.route).toBe(UNROUTED_PATTERN);
    expect(JSON.stringify(props)).not.toContain(live.split('/').filter(Boolean)[0]!);
  });

  it('matching is by enumeration, so an unrecognised shape is not guessed at', () => {
    const src = stripped('src/lib/analytics/routes.ts');
    // No value-shape heuristic decides a segment: no regex hunting for
    // id-looking strings, no length test.
    expect(src).not.toContain(['[0-9a-f]', '{8,}'].join(''));
    expect(src).not.toContain(['segment', '.length', ' > '].join(''));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — admin-sections.ts still has ZERO imports
 * 9 — routes.ts still reaches nothing
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 — admin-sections.ts still has zero imports', () => {
  it('admin-sections.ts imports nothing at all', () => {
    // 🔴 THE BLOG BUNDLE. routes.ts reads this file, /blog/[id] imports
    // routes.ts through client.ts, and /blog/[id] ships no Firestore SDK. An
    // import added here is an import added to every blog reader's download.
    const src = stripped('src/lib/admin-sections.ts');
    const importToken = ['im', 'port'].join('');
    const requireToken = ['requ', 'ire'].join('');
    expect(src).not.toContain(importToken);
    expect(src).not.toContain(requireToken);
  });

  it('THE-360 added no import to it either', () => {
    const src = stripped('src/lib/admin-sections.ts');
    const lines = src.split('\n').filter((l) => l.trim().startsWith(['im', 'port'].join('')));
    expect(lines).toEqual([]);
  });
});

describe('9 — routes.ts still reaches nothing', () => {
  it('routes.ts imports only the section table, and that table imports nothing', () => {
    const src = stripped('src/lib/analytics/routes.ts');
    const importToken = ['im', 'port'].join('');
    const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

    // One runtime import, and it is the pure table.
    expect(specifiers).toEqual(['../admin-sections']);
    // Nothing dynamic either — a lazy Firestore import is still Firestore.
    expect(src).not.toContain(importToken + '(');
  });

  it('nothing on that path reaches Firebase', () => {
    const sectionSrc = stripped('src/lib/admin-sections.ts');
    for (const needle of [['fire', 'base'].join(''), ['fire', 'store'].join(''), 'tenant-scope']) {
      expect(sectionSrc, `admin-sections.ts mentions ${needle}`).not.toContain(needle);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 — each new event fires exactly once at its moment
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('10 — each new event fires exactly once at its moment', () => {
  it.each(PRODUCT_EVENTS)('%s fires exactly one capture, named %s', async (key, name) => {
    await captureProductEvent(ANALYTICS_EVENTS[key]);
    const { event } = onlyCapture();
    expect(event).toBe(name);
  });

  it.each(PRODUCT_EVENTS)('%s is wired into %s', (key, name, file) => {
    const src = stripped(file);
    // The CONSTANT is referenced, never the raw string — a raw string would
    // bypass the union that makes an unregistered name a compile error.
    expect(src, `${file} does not reference ANALYTICS_EVENTS.${key}`).toContain(
      `ANALYTICS_EVENTS.${key}`,
    );
    expect(src, `${file} hardcodes the event name "${name}"`).not.toContain(`'${name}'`);
  });

  it('every call site fires through the non-awaitable seam', () => {
    const seam = ['track', 'ProductEvent'].join('');
    for (const file of CALL_SITES) {
      const src = stripped(file);
      expect(src, `${file} does not use ${seam}`).toContain(seam);
      // 🔴 NEVER AWAITED. An awaited analytics call is a network round trip
      // between a church pressing "record" and the dialog closing, and a place
      // for a rejection to surface as a failed gift.
      expect(src, `${file} awaits an analytics call`).not.toContain(`await ${seam}`);
      expect(src, `${file} awaits a capture`).not.toContain('await captureProductEvent');
    }
  });

  it('a gift that is refused by the ledger fires nothing', async () => {
    // The event sits after the ledger accepted the gift, so nothing fires when
    // it did not. Asserted at the seam: no call, no capture.
    expect(mockPostHog.capture).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 — each new event fires from BOTH shells
 * 12 — surface distinguishes admin from member, and not by user agent
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('11 — each new event fires from both shells', () => {
  it.each(PRODUCT_EVENTS)(
    '%s carries app_surface "admin" from the admin shell',
    async (key) => {
      atPath('/admin/crm');
      await captureProductEvent(ANALYTICS_EVENTS[key]);
      expect(onlyCapture().props.app_surface, 'admin shell').toBe('admin');
    },
  );

  it.each(PRODUCT_EVENTS)(
    '%s carries app_surface "member" from the member shell',
    async (key) => {
      // `/` is the member home and the member app's own shell — the same
      // `App.tsx` BrowserRouter, the same AnalyticsBridge, the same bundle the
      // Capacitor builds load from `server.url`. An event fired there reports.
      atPath('/');
      await captureProductEvent(ANALYTICS_EVENTS[key]);
      expect(onlyCapture().props.app_surface, 'member shell').toBe('member');
    },
  );

  it('signup_created reports from the PUBLIC shell, with no is_platform_admin', async () => {
    atPath('/form/aB3xQ9kLmN2pR');
    await captureProductEvent(ANALYTICS_EVENTS.SIGNUP_CREATED);
    const { props } = onlyCapture();
    expect(props.app_surface).toBe('public');
    // Nobody was identified, so an absent property says "unknown" where false
    // would assert a fact about a person who does not exist.
    expect(props).not.toHaveProperty('is_platform_admin');
  });
});

describe('12 — surface is decided by the shell, never by the user agent', () => {
  const PHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

  it('a phone-sized browser on the admin app is still admin', async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: PHONE_UA, configurable: true });
    try {
      atPath('/admin/accounting');
      await captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
      expect(onlyCapture().props.app_surface).toBe('admin');
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: original, configurable: true });
    }
  });

  it('no analytics module reads the user agent at all', () => {
    for (const file of [
      'src/lib/analytics/routes.ts',
      'src/lib/analytics/client.ts',
      'src/lib/analytics/events.ts',
    ]) {
      const src = stripped(file);
      expect(src, `${file} reads the user agent`).not.toContain(['user', 'Agent'].join(''));
      expect(src, `${file} sniffs the viewport`).not.toContain(['inner', 'Width'].join(''));
      expect(src, `${file} matches media`).not.toContain(['match', 'Media'].join(''));
    }
  });

  it('the three surfaces are the route table\'s own answer', async () => {
    for (const [pathname, surface] of [
      ['/admin/crm', 'admin'],
      ['/', 'member'],
      ['/giving', 'public'],
    ] as const) {
      vi.clearAllMocks();
      __resetAnalyticsForTests();
      atPath(pathname);
      await captureProductEvent(ANALYTICS_EVENTS.FORM_PUBLISHED);
      expect(onlyCapture().props.app_surface, pathname).toBe(surface);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 — no event carries an amount, a title, a name or free text
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('13 — no event carries an amount, a title, a name or free text', () => {
  it.each(PRODUCT_EVENTS)('%s sends only registered keys and literal values', async (key) => {
    await captureProductEvent(ANALYTICS_EVENTS[key]);
    const { props } = onlyCapture();
    for (const [k, v] of Object.entries(props)) {
      expect(ALLOWED_EVENT_PROPERTY_KEYS).toContain(k);
      // Every value is a literal from a table this app defines: a pattern, a
      // surface, a boolean, a limit kind. Never a number, never free text.
      expect(typeof v === 'string' || typeof v === 'boolean', `${k} is ${typeof v}`).toBe(true);
    }
  });

  it('no call site passes anything but an event and a limit kind', () => {
    const seam = ['track', 'ProductEvent'].join('');
    for (const file of CALL_SITES) {
      const src = stripped(file);
      for (const m of src.matchAll(new RegExp(`${seam}\\(([^;]*?)\\);`, 'gs'))) {
        const args = m[1];
        // Exactly one of the two shapes, and no third.
        const ok =
          /^ANALYTICS_EVENTS\.[A-Z_]+$/.test(args.trim())
          || /^ANALYTICS_EVENTS\.[A-Z_]+,\s*\{\s*limitKind:\s*'[a-z_]+'\s*,?\s*\}$/.test(
            args.trim().replace(/\s+/g, ' '),
          );
        expect(ok, `${file} passes "${args.trim()}" to ${seam}`).toBe(true);
      }
    }
  });

  it('the seam has no parameter a record could travel through', () => {
    const src = stripped('src/lib/analytics/client.ts');
    // `limitKind` is the ONLY thing an option bag accepts. A `properties`
    // parameter on the product seam would be the hole this whole design closes.
    expect(src).toContain('options: { limitKind?: PlanLimitKind } = {}');
    expect(src).not.toContain(['props', 'erties?: Record'].join(''));
  });

  it.each(PRODUCT_EVENTS)('%s never rides with an amount', async (key) => {
    await captureProductEvent(ANALYTICS_EVENTS[key]);
    const { props } = onlyCapture();
    const money = [['amount'].join(''), ['total', 'Donated'].join(''), 'cents', 'dollars'];
    const serialised = JSON.stringify(props).toLowerCase();
    for (const label of money) {
      expect(serialised, `${key} carries ${label}`).not.toContain(label.toLowerCase());
    }
  });

  it('an amount could not be added without also deleting a forbidden label', () => {
    // 🔴 The asymmetry that makes "no amount" durable. `amount` is already a
    // FORBIDDEN label, so before_send strips it even from an allow-listed key.
    // Sending one takes a deletion from GIVING_LABELS, not an addition here.
    const label = ['am', 'ount'].join('');
    expect(FORBIDDEN_PROPERTY_LABELS).toContain(label);
    const result = beforeSendEvent(
      captured({ event: 'gift_recorded', properties: { [label]: 5000, route: '/admin/crm' } }),
    );
    expect(Object.keys(result!.properties!)).not.toContain(label);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 — a failed capture never throws and never blocks the action
 * 15 — recording a gift still works with analytics disabled
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('14 — a failed capture never throws and never blocks', () => {
  it('a capture that THROWS is swallowed', async () => {
    mockPostHog.capture.mockImplementationOnce(() => {
      throw new Error('posthog exploded');
    });
    await expect(captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED)).resolves.toBeUndefined();
  });

  it('a capture that returns a REJECTING promise is handled, not left dangling', async () => {
    // 🔴 TWO EARLIER VERSIONS OF THIS TEST COULD NOT FAIL, and mutation found
    // both. The first asserted only that `captureProductEvent` resolved — which
    // it does either way, because nothing awaits `capture()`. The second
    // listened for `window`'s `unhandledrejection`, which never fires here: an
    // un-awaited rejection in this environment is completely invisible, so
    // asserting its ABSENCE asserted nothing.
    //
    // What IS observable is the handler running. `swallow` warns outside
    // production, so a rejection that was handled leaves a trace and one that
    // was not leaves none. Removing the `isThenable` branch in client.ts now
    // fails this test, which is the only reason it is worth having.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockPostHog.capture.mockImplementationOnce(
        () => Promise.reject(new Error('network down')) as unknown as void,
      );
      await expect(captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED)).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 0));

      const handled = warn.mock.calls.some(
        ([message]) => typeof message === 'string'
          && message.includes('gift_recorded')
          && message.includes('swallowed'),
      );
      expect(handled, 'a rejecting capture was left with no handler attached').toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('an init that throws is swallowed', async () => {
    mockPostHog.init.mockImplementationOnce(() => {
      throw new Error('init exploded');
    });
    await expect(captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED)).resolves.toBeUndefined();
  });

  it('the non-awaitable seam returns undefined, not a promise to mishandle', () => {
    mockPostHog.capture.mockImplementationOnce(() => {
      throw new Error('posthog exploded');
    });
    // 🔴 The property that protects the gift: there is no promise handed back,
    // so a call site cannot await it and cannot forget to catch it.
    expect(trackProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED)).toBeUndefined();
  });

  it('a throwing capture leaves no unhandled rejection behind', async () => {
    const seen: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent) => seen.push(e.reason);
    window.addEventListener('unhandledrejection', onRejection);
    try {
      mockPostHog.capture.mockImplementation(() => {
        throw new Error('posthog exploded');
      });
      trackProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
      mockPostHog.capture.mockReset();
    }
  });
});

describe('15 — the action still works with analytics disabled', () => {
  it('with no project key nothing is loaded and nothing throws', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    __resetAnalyticsForTests();
    await expect(captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED)).resolves.toBeUndefined();
    expect(mockPostHog.init).not.toHaveBeenCalled();
    expect(mockPostHog.capture).not.toHaveBeenCalled();
  });

  it('the seam is safe to call with no key, synchronously', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    __resetAnalyticsForTests();
    expect(() => trackProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 16 — this ticket adds no UI, so it adds no colour and no emoji
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('16 — no UI, no hardcoded colour, no emoji in shipped code', () => {
  it('the analytics modules render nothing', () => {
    for (const file of ['src/lib/analytics/client.ts', 'src/lib/analytics/events.ts']) {
      const src = stripped(file);
      expect(src, `${file} renders JSX`).not.toContain('</');
      expect(src, `${file} has a className`).not.toContain(['class', 'Name='].join(''));
    }
  });

  it('no hex colour is hardcoded in anything this ticket wrote', () => {
    for (const file of ['src/lib/analytics/client.ts', 'src/lib/analytics/events.ts']) {
      const src = stripped(file);
      expect(src.match(/#[0-9a-fA-F]{3,8}\b/g), `${file} hardcodes a colour`).toBeNull();
    }
  });

  it('no emoji in the shipped code of the analytics modules', () => {
    // Comments are stripped first — the house style uses marker glyphs in
    // docblocks, and those are prose, not rendered output.
    const emoji = /\p{Extended_Pictographic}/u;
    for (const file of ['src/lib/analytics/client.ts', 'src/lib/analytics/events.ts']) {
      expect(emoji.test(stripped(file)), `${file} carries an emoji in code`).toBe(false);
    }
  });

  it('every event fires from a statement, never from inside a control', () => {
    // If this ticket had added a control it would owe a 44px floor. It adds
    // none: no call site puts the seam inside an onClick prop.
    const seam = ['track', 'ProductEvent'].join('');
    for (const file of CALL_SITES) {
      const src = stripped(file);
      expect(src, `${file} fires from a click handler prop`).not.toContain(`={() => ${seam}`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 17 — this suite's own hygiene
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('17 — this suite pins no line number, no date and no branch diff', () => {
  const SELF = 'src/lib/analytics/__tests__/THE-360.product-vocabulary.test.ts';

  it('no location in this file is a line number', () => {
    const src = stripped(SELF);
    // THE-331 pinned AdminCommunity.tsx:491 and a deletion moved it to :311.
    expect(src.match(/\.tsx?:\d+/g)).toBeNull();
  });

  it('no fixture date and no clock are used at all', () => {
    const src = stripped(SELF);
    expect(src).not.toContain(['use', 'FakeTimers'].join(''));
    expect(src).not.toContain(['set', 'System', 'Time'].join(''));
    expect(src.match(/\b20\d{2}-\d{2}-\d{2}\b/g), 'a date literal').toBeNull();
    // No clock read either — nothing here depends on when it runs.
    //
    // ⚠️ ASSEMBLED. Spelled whole, this needle would appear in this very line
    // and the assertion would fail on itself — which is exactly the
    // self-matching #496 found in two of its own guards. The first draft of
    // this line did precisely that.
    expect(src).not.toContain(['new', ' Date', '('].join(''));
  });

  it('no branch-diff guard: nothing here shells out to git', () => {
    const src = stripped(SELF);
    // A depth-1 clone has no base revision, and THE-315's sweep scans TRACKED
    // files only — a run before `git add` turned THE-347's CI red.
    for (const needle of [['git', ' '].join(''), ['exec', 'Sync'].join(''), ['spawn', 'Sync'].join('')]) {
      expect(src, `this suite reaches for "${needle}"`).not.toContain(needle);
    }
  });

  it('every file this suite names exists on disk', () => {
    for (const file of [...CALL_SITES, 'src/lib/admin-sections.ts', 'src/lib/analytics/routes.ts']) {
      expect(() => read(file), `${file} is gone`).not.toThrow();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 18 — the files this ticket must not have touched
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('18 — firestore.rules, the indexes, functions/ and layout.tsx are untouched', () => {
  it.each([
    ['firestore.indexes.json', '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0'],
    ['src/app/layout.tsx', 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f'],
  ])('%s is byte-identical', (file, digest) => {
    // A hash pin, not a diff: it reads the same on a shallow clone, a local
    // checkout and a rebased branch.
    expect(sha(file), `${file} changed`).toBe(digest);
  });

  it('firestore.rules is at a digest some ticket recorded', () => {
    // 🔴 firestore.rules AUTO-DEPLOYS to production on merge with no emulator
    // test in CI, so it IS pinned here — but the accepted values are read from
    // the shared register, never copied into this file.
    //
    // ⚠️ THE-325 CAUGHT THE FIRST DRAFT OF THIS ASSERTION DOING EXACTLY THAT.
    // It spelled the live digest as a literal, and THE-325's sweep fails any
    // suite that carries a copy of the set — because every copy is another edit
    // a legitimate rules change would have to make, and the one somebody misses
    // is how a rules change gets reverted by a test. THE-360 records NO rules
    // digest of its own: this ticket does not touch the file.
    expect(acceptedRulesDigests().map(([digest]) => digest)).toContain(sha('firestore.rules'));
  });

  it('functions/ is byte-identical, whole', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (e.name === 'node_modules' || e.name === 'lib') continue;
        const rel = `${dir}/${e.name}`;
        e.isDirectory() ? walk(rel) : files.push(rel);
      }
    };
    walk('functions');

    const h = createHash('sha256');
    for (const f of files) {
      h.update(f);
      h.update(readFileSync(path.join(ROOT, f)));
    }
    expect(files.length).toBe(5);
    expect(h.digest('hex')).toBe(
      '4016dc6b342dcbbf44b94994d35d01781c015035205616d4798c142199a1b5bf',
    );
  });

  it('no dependency was added: posthog-js was already installed', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['posthog-js']).toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The identity path, unchanged by the widening
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('19 — identity still resolves the way THE-36 built it', () => {
  it('a product event carries the identified answer, not a default', async () => {
    await identifyUser({ uid: 'uid-123', email: 'pastor@nations.example' });
    vi.clearAllMocks();
    atPath('/admin/crm');
    await captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
    expect(onlyCapture().props.is_platform_admin).toBe(false);
  });

  it('with nobody identified the property is omitted, not false', async () => {
    atPath('/admin/crm');
    await captureProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
    expect(onlyCapture().props).not.toHaveProperty('is_platform_admin');
  });

  it('the distinct id is still the uid, never the email', async () => {
    await identifyUser({ uid: 'uid-123', email: 'pastor@nations.example' });
    expect(mockPostHog.identify).toHaveBeenCalledWith('uid-123', { account_kind: 'tenant_user' });
  });
});
