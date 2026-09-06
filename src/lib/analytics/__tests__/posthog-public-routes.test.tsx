import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-206 — every route the app serves, and what each one sends.
 *
 * THE-36 installed PostHog and said so plainly: "the bridge covers the SPA
 * shell only". `AnalyticsBridge` mounts inside `App.tsx`'s `BrowserRouter`, and
 * the ten dedicated Next routes never render `App.tsx` — so `/blog/[id]`,
 * `/form/[formId]`, `/event/[eventId]` and the rest sent nothing at all. Those
 * are the PUBLIC surfaces, which is where a growth question actually lives.
 *
 * ─── What this suite is for ──────────────────────────────────────────────────
 *
 * Two jobs, and the second is the larger one:
 *
 *   1. Prove every route now emits a `$pageview`, one named assertion per
 *      route, and prove the ENUMERATION is complete — that a route added
 *      tomorrow cannot quietly stay uninstrumented.
 *
 *   2. Prove that widening coverage relaxed NOTHING. Every privacy decision
 *      THE-36 made is re-asserted here against the same shipped defaults, on
 *      the theory that a PR whose whole purpose is "send more" is exactly the
 *      PR that quietly sends more than it meant to.
 *
 * ⚠️ Targets are named by LABEL — `donorEmail`, `request`, `content` — never by
 * value shape, exactly as in `posthog-privacy.test.ts`. A test that hunts for
 * an `@` passes the moment a phone number leaks.
 *
 * ⚠️ File pins here are HASH pins read with `readFileSync`. There is no
 * `git show` anywhere in this suite: CI's clone depth must not be something a
 * test depends on.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── mocks ─────────────────────────────────────────────────────────────────── */

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

/**
 * `usePathname` needs an App Router tree, which a unit test does not have.
 * Mocked as a settable value so the soft-navigation case below is testable at
 * all — it is the case that has no `<Link>` to exercise it today.
 */
const { navState } = vi.hoisted(() => ({ navState: { pathname: '/' } }));
vi.mock('next/navigation', () => ({ usePathname: () => navState.pathname }));

const { authState } = vi.hoisted(() => ({
  authState: { callback: null as null | ((user: unknown) => void) },
}));
vi.mock('../../../firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    authState.callback = callback;
    return () => {};
  },
}));

import { SUPER_ADMIN_EMAILS } from '../../../utils/super-admins';
import { PREAUTH_PATHS } from '../../preauth-theme';
import { ADMIN_SECTION_SLUGS } from '../../admin-sections';
import {
  ALLOWED_EVENT_NAMES,
  ALLOWED_EVENT_PROPERTY_KEYS,
  ALLOWED_PERSON_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
  FORBIDDEN_PROPERTY_LABELS,
  TENANT_GROUP_TYPE,
} from '../events';
import { beforeSendEvent, buildPostHogOptions, scrubProperties } from '../config';
import {
  ANALYTICS_ROUTES,
  PRE_AUTH_PATTERNS,
  UNROUTED_PATTERN,
  matchAnalyticsRoute,
  normalizeAnalyticsPath,
  normalizeUrlPath,
  resolveAppSurface,
  type AnalyticsRoutePattern,
} from '../routes';
import {
  __resetAnalyticsForTests,
  capturePageview,
  capturePublicPageview,
  identifyUser,
  initAnalytics,
} from '../client';
import PublicRouteAnalytics from '../../../components/PublicRouteAnalytics';
import AnalyticsBridge from '../../../components/AnalyticsBridge';
import type { CaptureResult } from 'posthog-js';

const ROOT = path.resolve(__dirname, '../../../..');

/**
 * A file's code with its comments removed.
 *
 * ⚠️ The fences below assert what a module REACHES FOR, and a doc comment that
 * explains why it does not reach for Firebase contains the word "Firebase".
 * Reading the raw text would make the explanation fail the rule it explains.
 */
const codeOf = (relativePath: string): string =>
  readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
const TEST_KEY = 'phc_test_project_key';
const SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAILS[0];
const VIEWED_TENANT = 'nations';

const captured = (fields: Partial<CaptureResult> & { event: string }): CaptureResult =>
  ({ uuid: '00000000-0000-4000-8000-000000000000', properties: {}, ...fields }) as CaptureResult;

/**
 * A REALISTIC resolved path for each pattern — what the browser address bar
 * actually holds. Firestore ids are what these routes are opened with; the
 * blog resolves `.doc(id)`, not a slug.
 */
const RESOLVED_PATH: Record<string, string> = {
  '/': '/',
  '/admin': '/admin',
  // 🔴 THE-227 — the pattern's resolved path is now a section that is NOT in the
  // vocabulary, because that is the only kind of path this row still catches. A
  // registered section resolves to a row of its own (below), so using `/admin/crm`
  // here would be asserting the opposite of what this PR built. `prayer-wall` is
  // the plausible version of the failure: a section somebody adds to the nav
  // tomorrow and forgets to register.
  '/admin/[section]': '/admin/prayer-wall',
  // 🔴 Still `/admin/docs/…`, and still expected to normalise BOTH segments. The
  // section is known, but no row is generated for `/admin/<section>/[itemId]` —
  // the second segment is a document id and naming the section beside it is not
  // worth reopening the question.
  '/admin/[section]/[itemId]': '/admin/docs/kR91mVzQ7dLpAe30',
  // Every named section: the path IS the pattern, which is the point of THE-227.
  ...Object.fromEntries(ADMIN_SECTION_SLUGS.map((slug) => [`/admin/${slug}`, `/admin/${slug}`])),
  '/blog/[id]': '/blog/7bQxs2LmNfA4dR8v',
  '/calendar': '/calendar',
  '/campaign/[campaignId]': '/campaign/Xk4pL9wQ2mNv6sT1',
  '/checkin/[sessionId]': '/checkin/9fZc3Rt8yUq1BwEo',
  '/courses/[id]': '/courses/Mn2Vb7Kd4Sx9Lp0R',
  '/event/[eventId]': '/event/Qw8eR3tY6uI9oP2a',
  '/form/[formId]': '/form/aB3xQ7nJ5kL2mZ8w',
  '/giving': '/giving',
  '/pledge/[campaignId]': '/pledge/Hj6Nb2Vc9Xz4Kq7M',
  '/post/[postId]': '/post/Tg5Yh8Uj3Ik6Ol1P',
  // THE-324 — 43 characters of base64url, the shape `TOKEN_RE` accepts. It is a
  // CAPABILITY rather than a document id, which is why section 9's assertion
  // that the resolved path never leaves as a property matters more here than
  // anywhere else in this table.
  '/rota/[token]': '/rota/Zk3Nq7Xb2Wd9Rt5Yu8Ip4Ol1Mc6Hv0Ge3Ja7Sf2Q',
};

/** The page file that must render `<PublicRouteAnalytics>` for each Next route. */
const PAGE_FILE: Record<string, string> = {
  '/blog/[id]': 'src/app/blog/[id]/page.tsx',
  '/calendar': 'src/app/calendar/page.tsx',
  '/campaign/[campaignId]': 'src/app/campaign/[campaignId]/page.tsx',
  '/checkin/[sessionId]': 'src/app/checkin/[sessionId]/page.tsx',
  '/courses/[id]': 'src/app/courses/[id]/page.tsx',
  '/event/[eventId]': 'src/app/event/[eventId]/page.tsx',
  '/form/[formId]': 'src/app/form/[formId]/page.tsx',
  '/giving': 'src/app/giving/page.tsx',
  '/pledge/[campaignId]': 'src/app/pledge/[campaignId]/page.tsx',
  '/post/[postId]': 'src/app/post/[postId]/page.tsx',
  '/rota/[token]': 'src/app/rota/[token]/page.tsx',
};

const NEXT_ROUTES = ANALYTICS_ROUTES.filter((r) => r.entry === 'next-page');
const SPA_ROUTES = ANALYTICS_ROUTES.filter((r) => r.entry === 'spa');

/* ── React harness ─────────────────────────────────────────────────────────── */

/** Every `$pageview` the SDK was actually asked to send. */
const pageviews = () =>
  mockPostHog.capture.mock.calls.filter(([event]) => event === ANALYTICS_EVENTS.PAGEVIEW);

let container: HTMLDivElement;
let root: Root | null = null;

/**
 * Drain everything in flight, and — when given a condition — stop as soon as it
 * holds.
 *
 * ⚠️ Macrotask turns, not a fixed count of microtasks, and bounded by TIME
 * rather than by tick count. Capturing a pageview awaits a dynamic
 * `import('posthog-js')` (and, on the sign-in path, `import('./identity')`);
 * the first such import in a file resolves a real module graph while every
 * later one is cached. A fixed tick count made the result depend on test order
 * and on how loaded the machine was — it passed alone and failed in the full
 * suite.
 *
 * 🔴 With no condition this drains the WHOLE budget. That is what the "sends
 * nothing" tests need: absence cannot be polled for, so they must wait out
 * everything that could still arrive rather than declare victory early.
 */
const DRAIN_TURNS = 120;

const flush = async (done?: () => boolean) => {
  await act(async () => {
    for (let i = 0; i < DRAIN_TURNS; i += 1) {
      if (done?.()) return;
      await new Promise((resolve) => { setTimeout(resolve, 2); });
    }
  });
};

/** Wait for at least `count` pageviews, or give up and let the assertion fail. */
const flushForPageviews = (count = 1) => flush(() => pageviews().length >= count);

function render(element: React.ReactElement) {
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
}

/**
 * Mount the public-route component the way a dedicated Next page does.
 *
 * `expectPageview` says which wait to use, not what to assert — a test that
 * expects nothing must drain the full budget before it may say so.
 */
async function mountPublicRoute(route: AnalyticsRoutePattern, expectPageview = true) {
  navState.pathname = RESOLVED_PATH[route];
  render(React.createElement(PublicRouteAnalytics, { route }));
  await (expectPageview ? flushForPageviews() : flush());
}

/** Mount the SPA bridge at a path, then answer Firebase's auth listener. */
async function mountSpaRoute(
  pathname: string,
  user: { uid: string; email: string } | null,
  expectPageview = true,
) {
  render(
    React.createElement(MemoryRouter, { initialEntries: [pathname] },
      React.createElement(AnalyticsBridge)),
  );
  await act(async () => {
    authState.callback?.(user);
  });
  await (expectPageview ? flushForPageviews() : flush());
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalyticsForTests();
  authState.callback = null;
  process.env.NEXT_PUBLIC_POSTHOG_KEY = TEST_KEY;
  mockGetTenantScope.mockResolvedValue(VIEWED_TENANT);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('1 — every route in the stated list emits a pageview', () => {
  it.each(NEXT_ROUTES.map((r) => [r.pattern] as const))(
    'every route in the stated list emits a pageview: %s',
    async (pattern) => {
      await mountPublicRoute(pattern as AnalyticsRoutePattern);

      expect(pageviews(), `${pattern} sent no $pageview`).toHaveLength(1);
      expect(pageviews()[0][1]).toMatchObject({ route: pattern, app_surface: 'public' });
    },
  );

  it.each(SPA_ROUTES.map((r) => [r.pattern] as const))(
    'every route in the stated list emits a pageview: %s',
    async (pattern) => {
      await mountSpaRoute(RESOLVED_PATH[pattern], { uid: 'uid-1', email: 'admin@grace.org' });

      expect(pageviews(), `${pattern} sent no $pageview`).toHaveLength(1);
      expect(pageviews()[0][1]).toMatchObject({ route: pattern });
    },
  );

  it('the nine dedicated Next routes are the ones THE-36 reported as uninstrumented', () => {
    // 🔴 The gap this PR closes, named. THE-36's own scope note listed exactly
    // these nine.
    //
    // ⚠️ WAS TEN. `/ai-assistant` — the Telegram assistant's standalone landing
    // page, and the one route THE-36 had not mentioned at all — was DELETED
    // with the assistant in THE-253. The route is gone, so there is no page to
    // instrument; the enumeration below is still read back off the filesystem,
    // so a route that reappeared uninstrumented would still fail here.
    expect(NEXT_ROUTES.map((r) => r.pattern)).toEqual([
      '/blog/[id]',
      '/calendar',
      '/campaign/[campaignId]',
      '/checkin/[sessionId]',
      '/courses/[id]',
      '/event/[eventId]',
      '/form/[formId]',
      '/giving',
      '/pledge/[campaignId]',
      '/post/[postId]',
      // THE-324 — the rota accept page. APPENDED, never substituted: the ten
      // above are still exactly the routes THE-36 reported, and this is an
      // ELEVENTH public Next route that did not exist when it was written. It
      // is here rather than exempted for the reason the case below spells out —
      // the enumeration is read back off the filesystem, so a new page that was
      // not registered fails, and registering it means naming it here.
      '/rota/[token]',
    ]);
  });

  it('the enumeration covers every page file in src/app — a new route cannot hide', () => {
    // 🔴 THE ENUMERATION IS THE DELIVERABLE. Walking the real tree is what makes
    // it stay true: add `src/app/give/[id]/page.tsx` without registering it and
    // this fails, rather than the route silently sending nothing for a year —
    // which is precisely how THE-206 came to exist.
    const found: string[] = [];
    const walk = (dir: string, segments: string[]) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'api') continue; // server handlers: no document, no SDK
          walk(full, [...segments, entry]);
        } else if (entry === 'page.tsx') {
          found.push(`/${segments.join('/')}` || '/');
        }
      }
    };
    walk(path.join(ROOT, 'src/app'), []);

    // The optional catch-all IS the SPA shell; its routes are React Router's.
    const catchAll = '/[[...slug]]';
    expect(found).toContain(catchAll);

    expect(found.filter((r) => r !== catchAll).sort()).toEqual(
      NEXT_ROUTES.map((r) => r.pattern).sort(),
    );
  });

  it('the SPA routes match the ones App.tsx actually declares', () => {
    const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    const declared = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

    // React Router spells parameters `:section`; the registry spells them the
    // Next way, `[section]`. Same routes, one spelling, so a dashboard has one
    // row per page rather than two.
    const asPattern = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '[$1]');
    const instrumentable = declared
      .map(asPattern)
      .filter((p) => p !== '*' && !PRE_AUTH_PATTERNS.includes(p));

    // Every route App.tsx declares is registered.
    const registered = SPA_ROUTES.map((r) => r.pattern);
    expect(instrumentable.sort()).toEqual(
      registered.filter((p) => instrumentable.includes(p)).sort(),
    );

    // ⚠️ THE-227 — and the registry is now allowed to hold MORE than App.tsx
    // declares, in exactly one way: a named admin section. React Router serves
    // all of them from the single `/admin/:section` declaration, so there is no
    // `<Route>` to match them against; what there IS, is the closed vocabulary
    // in `admin-sections.ts`. Anything else extra is drift and fails here.
    const extra = registered.filter((p) => !instrumentable.includes(p));
    expect(extra.sort()).toEqual(ADMIN_SECTION_SLUGS.map((s) => `/admin/${s}`).sort());
  });

  it.each(Object.entries(PAGE_FILE))(
    'the page file for %s renders the pageview component',
    (pattern, file) => {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      expect(source, `${file} does not import PublicRouteAnalytics`).toMatch(
        /import PublicRouteAnalytics from/,
      );
      expect(source, `${file} does not render route="${pattern}"`).toContain(
        `<PublicRouteAnalytics route="${pattern}" />`,
      );
    },
  );

  it('a soft navigation within one route family is counted twice, not once', async () => {
    // ⚠️ Every public page is reached by a hard `<a href>` today, so this cannot
    // happen yet. It is pinned because `route` is one string for a whole family:
    // add a `<Link>` from one blog post to another and an effect keyed on
    // `route` alone would keep the component mounted and never fire again — the
    // second post uncounted, quietly, which is the bug THE-206 exists to fix.
    navState.pathname = '/blog/7bQxs2LmNfA4dR8v';
    render(React.createElement(PublicRouteAnalytics, { route: '/blog/[id]' }));
    await flushForPageviews(1);
    expect(pageviews()).toHaveLength(1);

    navState.pathname = '/blog/Mn2Vb7Kd4Sx9Lp0R';
    act(() => {
      root!.render(React.createElement(PublicRouteAnalytics, { route: '/blog/[id]' }));
    });
    await flushForPageviews(2);

    expect(pageviews()).toHaveLength(2);
    // 🔴 Both carry the PATTERN. The pathname is what changed, never what is sent.
    expect(pageviews().map(([, p]) => (p as { route: string }).route))
      .toEqual(['/blog/[id]', '/blog/[id]']);
  });

  it('every rendered branch of the form page is counted, not only the happy one', () => {
    // `/form/[formId]` answers a closed form with a notice instead of the form.
    // The visitor still opened the URL and still got a page, so it still counts.
    const source = readFileSync(path.join(ROOT, PAGE_FILE['/form/[formId]']), 'utf8');
    const rendered = (source.match(/<PublicRouteAnalytics route="\/form\/\[formId\]" \/>/g) ?? []);
    expect(rendered).toHaveLength(2);
  });
});

describe('2 — pre-auth still sends nothing', () => {
  it.each([...PREAUTH_PATHS])('pre-auth still sends nothing: %s', async (preAuthPath) => {
    await mountSpaRoute(preAuthPath, { uid: 'uid-1', email: 'someone@grace.org' }, false);

    // Not "initialised but told not to look" — not initialised. These are the
    // screens built out of email and password inputs (THE-85).
    expect(pageviews()).toHaveLength(0);
    expect(mockPostHog.identify).not.toHaveBeenCalled();
  });

  it('the pre-auth list is still imported from one place, not restated', () => {
    expect([...PREAUTH_PATHS]).toEqual(['/auth', '/onboarding', '/church-onboarding']);
    // routes.ts names them so the map is complete; the GATE is still PREAUTH_PATHS.
    expect([...PRE_AUTH_PATTERNS]).toEqual([...PREAUTH_PATHS]);

    const bridge = readFileSync(path.join(ROOT, 'src/components/AnalyticsBridge.tsx'), 'utf8');
    expect(bridge).toMatch(/from '\.\.\/lib\/preauth-theme'/);
  });

  it('no pre-auth screen gained a page file that could bypass the bridge', () => {
    // A dedicated Next route for `/auth` would sidestep the gate entirely.
    for (const preAuthPath of PREAUTH_PATHS) {
      expect(Object.keys(PAGE_FILE)).not.toContain(preAuthPath);
      expect(ANALYTICS_ROUTES.map((r) => r.pattern)).not.toContain(preAuthPath);
    }
  });

  it('widening coverage did not widen it to a pre-auth path by way of the registry', async () => {
    // `resolveAppSurface` answers for any string. If a pre-auth path ever
    // resolved to a registered route, the gate would be the only thing left.
    for (const preAuthPath of PREAUTH_PATHS) {
      expect(matchAnalyticsRoute(preAuthPath)).toBeNull();
      expect(normalizeAnalyticsPath(preAuthPath)).toBe(UNROUTED_PATTERN);
    }
  });
});

describe('3 — nothing initialises when the key is absent, and nothing throws', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  it('nothing initialises when the key is absent, and nothing throws', async () => {
    await expect(initAnalytics()).resolves.toBeNull();
    expect(mockPostHog.init).not.toHaveBeenCalled();
  });

  it.each(NEXT_ROUTES.map((r) => [r.pattern] as const))(
    'a public route with no key sends nothing and throws nothing: %s',
    async (pattern) => {
      await expect(mountPublicRoute(pattern as AnalyticsRoutePattern, false)).resolves.not.toThrow();
      expect(mockPostHog.init).not.toHaveBeenCalled();
      expect(mockPostHog.capture).not.toHaveBeenCalled();
    },
  );

  it('a blank key still counts as absent on a public route', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = '   ';
    await mountPublicRoute('/blog/[id]', false);
    expect(mockPostHog.init).not.toHaveBeenCalled();
  });
});

describe('4 — session recording is still disabled, and the recorder still cannot be fetched', () => {
  it('session recording is still disabled, and the recorder still cannot be fetched', () => {
    const options = buildPostHogOptions();
    // 🔴 TWO locks, and widening coverage relaxed neither. The flag falsifies
    // posthog-js's client-side gate; the second stops recorder.js being
    // downloaded at all, so flipping the flag alone still records nothing.
    expect(options.disable_session_recording).toBe(true);
    expect(options.disable_external_dependency_loading).toBe(true);
  });

  it('masking is still configured underneath both locks', () => {
    const recording = buildPostHogOptions().session_recording;
    expect(recording?.maskAllInputs).toBe(true);
    expect(recording?.maskTextSelector).toBe('*');
    expect(recording?.maskAllElementAttributes).toBe(true);
    expect(buildPostHogOptions().enable_recording_console_log).toBe(false);
  });

  it('no public page reaches for the recorder or the toolbar', () => {
    for (const file of Object.values(PAGE_FILE)) {
      expect(codeOf(file), `${file} loads posthog directly`)
        .not.toMatch(/posthog-js|session_recording/i);
    }
  });
});

describe('5 — autocapture, heatmaps, rageclicks and copy-autocapture are all still off', () => {
  it('autocapture, heatmaps, rageclicks and copy-autocapture are all still off', () => {
    const options = buildPostHogOptions();
    expect(options.autocapture).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.rageclick).toBe(false);
  });

  it.each([
    ['$autocapture'],
    ['$copy_autocapture'],
    ['$rageclick'],
    ['$dead_click'],
    ['$heatmap'],
    ['$web_vitals'],
    ['$exception'],
  ])('%s is refused by name, not merely switched off', (event) => {
    // 🔴 `$copy_autocapture` carries the text an admin copied — on the CRM, a
    // donor's email. A future SDK default that turns one of these back on still
    // cannot get past `before_send`.
    expect(beforeSendEvent(captured({ event }))).toBeNull();
  });

  it('a public page is not a new place for autocapture to be switched on', () => {
    const component = codeOf('src/components/PublicRouteAnalytics.tsx');
    expect(component).not.toMatch(/autocapture|posthog\.init|session_recording/i);
  });
});

describe('6 — the event vocabulary is still closed', () => {
  it('the event vocabulary is still closed', () => {
    expect([...ALLOWED_EVENT_NAMES]).toEqual([
      '$pageview', '$identify', '$groupidentify', '$set',
    ]);
    // THE-206 adds `route` and nothing else. Widening coverage is not a licence
    // to widen the vocabulary.
    expect([...ALLOWED_EVENT_PROPERTY_KEYS]).toEqual([
      'app_surface', 'is_platform_admin', 'route',
    ]);
    expect([...ALLOWED_PERSON_PROPERTY_KEYS]).toEqual(['account_kind']);
  });

  it('an event outside the vocabulary does not escape before_send', () => {
    expect(beforeSendEvent(captured({ event: 'public_form_opened' }))).toBeNull();
    expect(beforeSendEvent(captured({ event: '$pageleave' }))).toBeNull();
  });

  it('a property outside the vocabulary does not escape the capture boundary', async () => {
    await capturePublicPageview('/form/[formId]');
    const [, properties] = pageviews()[0];
    expect(Object.keys(properties as object).sort()).toEqual(['app_surface', 'route']);
  });

  it('the public route capture carries no is_platform_admin it could not know', async () => {
    // Nobody was identified, so "unknown" is the honest answer and an absent
    // property says it. `false` would have been a claim.
    await capturePublicPageview('/blog/[id]');
    expect(pageviews()[0][1]).not.toHaveProperty('is_platform_admin');
  });

  it('the SPA capture still carries exactly its three registered properties', async () => {
    await capturePageview('/admin/crm', false);
    expect(Object.keys(pageviews()[0][1] as object).sort()).toEqual([
      'app_surface', 'is_platform_admin', 'route',
    ]);
  });
});

describe('7 — no captured property contains an email, phone, donor name, prayer request or message body', () => {
  it('no captured property contains an email, phone, donor name, prayer request or message body', () => {
    // Targets named by LABEL, from the real field lists in events.ts.
    const loaded = Object.fromEntries(FORBIDDEN_PROPERTY_LABELS.map((label) => [label, 'x']));
    const result = beforeSendEvent(captured({
      event: ANALYTICS_EVENTS.PAGEVIEW,
      properties: { ...loaded, route: '/form/[formId]', app_surface: 'public' },
    }));

    for (const label of FORBIDDEN_PROPERTY_LABELS) {
      expect(result?.properties, `${label} survived before_send`).not.toHaveProperty(label);
    }
    expect(result?.properties).toMatchObject({ route: '/form/[formId]', app_surface: 'public' });
  });

  it('the person-profile bags are scrubbed on the same labels', () => {
    const result = beforeSendEvent(captured({
      event: '$identify',
      $set: { donorEmail: 'x', account_kind: 'tenant_user' },
      $set_once: { prayerRequest: 'x' },
    }));
    expect(result?.$set).not.toHaveProperty('donorEmail');
    expect(result?.$set).toMatchObject({ account_kind: 'tenant_user' });
    expect(result?.$set_once).not.toHaveProperty('prayerRequest');
  });

  it.each(NEXT_ROUTES.map((r) => [r.pattern] as const))(
    'the pageview for %s carries no forbidden label',
    async (pattern) => {
      await mountPublicRoute(pattern as AnalyticsRoutePattern);
      const keys = Object.keys(pageviews()[0][1] as object).map((k) =>
        k.toLowerCase().replace(/[_-]/g, ''),
      );
      for (const key of keys) expect(FORBIDDEN_PROPERTY_LABELS).not.toContain(key);
    },
  );

  it('a query string on a public URL still never reaches a property', () => {
    // A form link mailed to a member arrives as `?email=…`; the AI-assistant
    // page is opened with `?token=…`.
    const scrubbed = scrubProperties({
      $current_url: 'https://nations.theharvest.app/form/aB3xQ?email=jo@grace.org',
    }) as Record<string, string>;
    expect(scrubbed.$current_url).toBe('https://nations.theharvest.app/form/[formId]');
  });
});

describe('8 — an anonymous visitor on a public route gets no stored person profile', () => {
  it('an anonymous visitor on a public route gets no stored person profile', async () => {
    await mountPublicRoute('/blog/[id]');

    // 🔴 `identified_only` is what makes an anonymous visitor a COUNT rather
    // than a record: posthog-js marks such events `$process_person_profile:
    // false`, so no profile is created or updated.
    expect(buildPostHogOptions().person_profiles).toBe('identified_only');
    expect(mockPostHog.identify).not.toHaveBeenCalled();
    expect(pageviews()).toHaveLength(1);
  });

  it.each(NEXT_ROUTES.map((r) => [r.pattern] as const))(
    'no public route identifies anybody: %s',
    async (pattern) => {
      await mountPublicRoute(pattern as AnalyticsRoutePattern);
      expect(mockPostHog.identify).not.toHaveBeenCalled();
      expect(mockPostHog.group).not.toHaveBeenCalled();
    },
  );

  it('the public path does not reach Firebase, so it cannot learn who the visitor is', () => {
    // Also the bundle guarantee: `/blog/[id]` must not download Firestore.
    const component = codeOf('src/components/PublicRouteAnalytics.tsx');
    expect(component).not.toMatch(/firebase|onAuthStateChanged|identifyUser/i);

    const client = codeOf('src/lib/analytics/client.ts');
    // identity.ts imports tenant-scope.ts, which imports firebase/firestore. It
    // may only be reached through a dynamic import, inside identifyUser.
    expect(client).toMatch(/import type \{ AnalyticsUser \} from '\.\/identity'/);
    expect(client).toMatch(/await import\('\.\/identity'\)/);
    expect(client).not.toMatch(/^import \{[^}]*resolveAnalyticsIdentity/m);
  });

  it('personal-data masking on captured URLs is still on', () => {
    const options = buildPostHogOptions();
    expect(options.mask_personal_data_properties).toBe(true);
    expect(options.respect_dnt).toBe(true);
  });
});

describe('9 — every route is instrumented, and paths are normalised to route patterns where practical', () => {
  it.each(ANALYTICS_ROUTES.map((r) => [r.pattern] as const))(
    'a resolved path normalises to its pattern: %s',
    (pattern) => {
      expect(normalizeAnalyticsPath(RESOLVED_PATH[pattern])).toBe(pattern);
    },
  );

  it('no route sends a resolved path — the list of exceptions is empty', () => {
    // 🔴 The founder asked to be told which routes send a live path. None do.
    // Every pattern below differs from the path that produced it, or has no
    // parameter to lose.
    const sendingResolvedPath = ANALYTICS_ROUTES.filter((route) => {
      const sent = normalizeAnalyticsPath(RESOLVED_PATH[route.pattern]);
      const hasParameter = route.pattern.includes('[');
      return hasParameter && sent === RESOLVED_PATH[route.pattern];
    });
    expect(sendingResolvedPath.map((r) => r.pattern)).toEqual([]);
  });

  it('normalising is idempotent, so the two call sites agree', () => {
    // Public pages pass a literal pattern; the SPA bridge passes a live
    // pathname. Both go through the same function and must land in one bucket.
    for (const route of ANALYTICS_ROUTES) {
      expect(normalizeAnalyticsPath(route.pattern)).toBe(route.pattern);
    }
  });

  it('$current_url is normalised too, because the SDK builds it itself', () => {
    // The `route` property alone would not have been enough: posthog-js
    // attaches `$current_url` from `location.href` whether we ask or not.
    expect(normalizeUrlPath('https://nations.theharvest.app/event/Qw8eR3tY6uI9oP2a'))
      .toBe('https://nations.theharvest.app/event/[eventId]');
    // The host survives — it is a church's slug, already the group key.
    expect(normalizeUrlPath('https://nations.theharvest.app/checkin/9fZc3Rt8yUq1BwEo'))
      .toMatch(/^https:\/\/nations\.theharvest\.app\//);
  });

  it('an unrecognised path becomes a sentinel rather than being passed through', () => {
    // Over-redaction is the intended failure mode: a route nobody registered
    // must not be able to carry its segments out by default.
    expect(normalizeAnalyticsPath('/give/kR91mVzQ7dLpAe30')).toBe(UNROUTED_PATTERN);
    expect(normalizeUrlPath('https://mail.example/read/kR91mVzQ'))
      .toBe(`https://mail.example${UNROUTED_PATTERN}`);
  });

  it('the pattern type is a real union, so a misspelled route cannot compile', () => {
    // ⚠️ `AnalyticsRoutePattern` is read from the `as const satisfies` table, NOT
    // from the exported `ANALYTICS_ROUTES` — whose explicit `readonly
    // AnalyticsRoute[]` annotation widens `pattern` back to `string`. That
    // widening is invisible: everything compiles, every test passes, and the
    // only symptom is that `route="/blgo/[id]"` stops being caught. Vitest
    // transpiles without typechecking, so the guard has to live in the source;
    // this asserts the guard is still there for `npm run typecheck` to enforce.
    const routes = readFileSync(path.join(ROOT, 'src/lib/analytics/routes.ts'), 'utf8');
    expect(routes).toMatch(/\] as const satisfies readonly AnalyticsRoute\[\];/);
    expect(routes).toMatch(/AnalyticsRoutePattern = \(typeof ROUTE_TABLE\)\[number\]\['pattern'\]/);
    expect(routes).toMatch(/type Narrow<T extends string> = string extends T \? never : T;/);
  });

  it('matching is by enumeration, never by value shape', () => {
    const routes = codeOf('src/lib/analytics/routes.ts');
    // A rule like "a segment that looks like an id" passes whatever it fails to
    // recognise — the same mistake events.ts refuses for property labels.
    expect(routes).not.toMatch(/\[0-9a-f\]\{|\\d\{|looksLikeId|isUuid/i);
  });

  it('case and trailing slashes land in one bucket, not three', () => {
    expect(normalizeAnalyticsPath('/Blog/7bQxs2LmNfA4dR8v')).toBe('/blog/[id]');
    expect(normalizeAnalyticsPath('/form/aB3xQ7nJ5kL2mZ8w/')).toBe('/form/[formId]');
  });

  it('a literal segment still beats a parameter at the same position', () => {
    expect(resolveAppSurface('/calendar')).toBe('public');
    expect(resolveAppSurface('/admin/crm')).toBe('admin');
    expect(resolveAppSurface('/')).toBe('member');
  });
});

describe('10 — identity is still uid, and a super admin is still not attributed to a tenant', () => {
  it('identity is still uid, and a super admin is still not attributed to a tenant', async () => {
    await identifyUser({ uid: 'uid-super', email: SUPER_ADMIN_EMAIL });

    // 🔴 The uid, never the email — the email is READ to answer "platform
    // admin?" and never sent.
    expect(mockPostHog.identify).toHaveBeenCalledWith('uid-super', {
      account_kind: 'platform_admin',
    });
    // ⚠️ The group is CLEARED, not merely skipped: on a shared church computer
    // a stale group from the previous user would file them under that church.
    expect(mockPostHog.group).not.toHaveBeenCalled();
    expect(mockPostHog.resetGroups).toHaveBeenCalledTimes(1);
  });

  it('a tenant user is still grouped by their church', async () => {
    await identifyUser({ uid: 'uid-1', email: 'admin@grace.org' });
    expect(mockPostHog.identify).toHaveBeenCalledWith('uid-1', { account_kind: 'tenant_user' });
    expect(mockPostHog.group).toHaveBeenCalledWith(TENANT_GROUP_TYPE, VIEWED_TENANT);
  });

  it('no identify call anywhere carries an email address', async () => {
    await identifyUser({ uid: 'uid-1', email: 'admin@grace.org' });
    const serialised = JSON.stringify(mockPostHog.identify.mock.calls);
    expect(serialised).not.toContain('admin@grace.org');
  });

  it('a public route cannot become a second, unguarded identify path', () => {
    const component = codeOf('src/components/PublicRouteAnalytics.tsx');
    expect(component).toMatch(/capturePublicPageview/);
    expect(component).not.toMatch(/identify|resolveAnalyticsIdentity|getTenantScope/);
    // It reads the pathname only to know that one changed; it never sends it.
    expect(component).toMatch(/usePathname/);
    expect(component).not.toMatch(/capturePublicPageview\(pathname/);
  });
});

describe('11 — layout.tsx is unchanged', () => {
  /**
   * 🔴 Byte for byte. It carries the pre-paint theme script, whose keys are
   * duplicated as literals and pinned by a test of their own; four PRs went into
   * the ordering. THE-36 kept out of it, and THE-206 instruments ten more routes
   * without going near it — each dedicated Next page mounts its own component.
   *
   * The digest is the one `posthog-untouched.test.ts` already records, repeated
   * here rather than imported so this suite fails on its own terms.
   */
  const LAYOUT_SHA = 'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5';

  it('layout.tsx is unchanged', () => {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(ROOT, 'src/app/layout.tsx')))
      .digest('hex');
    expect(actual, 'src/app/layout.tsx changed — public routes must not be instrumented from the root layout').toBe(LAYOUT_SHA);
  });

  it('nothing analytics-shaped was added to the layout', () => {
    const layout = readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/posthog/i);
    expect(layout).not.toMatch(/AnalyticsBridge|PublicRouteAnalytics/);
  });

  it('firestore.rules and functions/ were not touched to widen coverage', () => {
    // Named here because `firestore.rules` auto-deploys to production on merge.
    const rules = createHash('sha256')
      .update(readFileSync(path.join(ROOT, 'firestore.rules')))
      .digest('hex');
    // ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
    // inside `match /tenants/{tenantId}` beside `events`: `allow read: if
    // belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
    // tenantId)`. Purely additive — no existing rule's text moved and it names no new
    // helper, so every other claim this pin carries is unchanged.
    // Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
    expect(rules).toBe('4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075');
  });
});
