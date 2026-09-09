import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-227 — PostHog could not tell CRM from Accounting.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The instrumentation worked. Six hours after the founder walked every feature
 * the live project held 63 `/admin/[section]` events and 12 `/admin` — and not
 * one of the 63 said WHICH section. For a product whose value is the admin,
 * "someone opened an admin screen" answers nothing.
 *
 * ─── 🔴 What this suite is really guarding ───────────────────────────────────
 *
 * The fix reads, at a glance, like the one thing `routes.ts` exists to refuse:
 * a path segment becoming a property. It is not, and the difference is the
 * whole ticket:
 *
 *   • `/form/aB3xQ…` — a Firestore document id. Minted per document, unbounded,
 *     and the identifier of a thing a person filled in. Collapsed to
 *     `/form/[formId]`, still, always.
 *   • `/admin/crm` — a FEATURE NAME from a closed vocabulary this app defines in
 *     its own nav. The same category of word as `app_surface: 'admin'`, which
 *     every one of these events already carries.
 *
 * So a section is not EXEMPTED from matching; it is matched against a closed
 * list. `2` below is the test that keeps that true, and it is the one to read
 * first: a section nobody registered — added to the nav tomorrow, or mistyped
 * in an address bar — still collapses to `/admin/[section]`.
 *
 * ⚠️ Targets are named by LABEL throughout, never by value shape, exactly as
 * `posthog-privacy.test.ts` requires. A test that hunts for an `@` passes the
 * moment a phone number leaks.
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

vi.mock('../../../utils/tenant-scope', () => ({
  getTenantScope: vi.fn().mockResolvedValue('nations'),
  PLATFORM_TENANT_ID: 'harvest',
}));

import {
  ADMIN_SECTION_SLUGS,
  ADMIN_SECTION_TABS,
  SLUG_TO_TAB,
  TAB_TO_SLUG,
  isAdminSectionSlug,
} from '../../admin-sections';
import {
  ANALYTICS_ROUTES,
  UNROUTED_PATTERN,
  normalizeAnalyticsPath,
  normalizeUrlPath,
  resolveAppSurface,
} from '../routes';
import {
  ALLOWED_EVENT_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
  FORBIDDEN_PROPERTY_LABELS,
  isForbiddenPropertyLabel,
} from '../events';
import { beforeSendEvent, buildPostHogOptions } from '../config';
import { __resetAnalyticsForTests, capturePageview } from '../client';
import type { CaptureResult } from 'posthog-js';
import { rulesDigestFailure } from '../../../__tests__/__fixtures__/firestore-rules-pin';

const ROOT = path.resolve(__dirname, '../../../..');
const TEST_KEY = 'phc_test_project_key';
const HOST = 'https://grace.theharvest.app';

const source = (relativePath: string): string =>
  readFileSync(path.join(ROOT, relativePath), 'utf8');

const digest = (relativePath: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, relativePath))).digest('hex');

const captured = (properties: Record<string, unknown>): CaptureResult =>
  ({
    uuid: '00000000-0000-4000-8000-000000000000',
    event: ANALYTICS_EVENTS.PAGEVIEW,
    properties,
  }) as CaptureResult;

/** The properties of the last `$pageview` the SDK was actually asked to send. */
const lastPageview = (): Record<string, unknown> => {
  const calls = mockPostHog.capture.mock.calls.filter(
    ([event]) => event === ANALYTICS_EVENTS.PAGEVIEW,
  );
  expect(calls, 'no $pageview was captured').not.toHaveLength(0);
  return calls[calls.length - 1][1] as Record<string, unknown>;
};

/**
 * A section that is NOT in the vocabulary, in the two shapes that actually
 * happen: a feature somebody adds to the nav and forgets to register, and a
 * typo in an address bar.
 */
const UNREGISTERED_SECTIONS = ['prayer-wall', 'crmm', 'giving', 'volunteers'];

/** A Firestore document id, the length and alphabet the real ones have. */
const DOC_ID = 'kR91mVzQ7dLpAe30';

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalyticsForTests();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = TEST_KEY;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('1 — a known admin section is sent by name', () => {
  it.each(ADMIN_SECTION_SLUGS.map((slug) => [slug] as const))(
    'a known admin section is sent by name: /admin/%s',
    async (slug) => {
      // 🔴 The point of the ticket, one assertion per section. Through the real
      // capture path, so the closed property allowlist in `client.ts` and the
      // `before_send` choke point in `config.ts` both had their say.
      await capturePageview(`/admin/${slug}`, false);

      const sent = beforeSendEvent(captured(lastPageview()))!;
      expect(sent, `/admin/${slug} was dropped by before_send`).not.toBeNull();
      expect(sent.properties!.route).toBe(`/admin/${slug}`);
      expect(sent.properties!.app_surface).toBe('admin');
    },
  );

  it('the sections are distinguishable from each other, which is the whole ask', () => {
    // Before this PR every one of these produced the same string, so a founder
    // asking "which features do churches use" got one bar.
    const sent = ADMIN_SECTION_SLUGS.map((slug) => normalizeAnalyticsPath(`/admin/${slug}`));
    expect(new Set(sent).size, 'two sections collapsed into one bucket').toBe(sent.length);
    expect(sent).toContain('/admin/crm');
    expect(sent).toContain('/admin/accounting');
    expect(sent).toContain('/admin/newsletter');
    expect(sent).toContain('/admin/courses');
    expect(sent).toContain('/admin/blog');
  });

  it('the case a URL was typed in does not become a second row', () => {
    expect(normalizeAnalyticsPath('/Admin/CRM')).toBe('/admin/crm');
    expect(normalizeAnalyticsPath('/admin/Accounting/')).toBe('/admin/accounting');
  });

  it('a section whose slug differs from its tab id is sent as the slug', () => {
    // `ai` is the one pair that differs. What reaches PostHog is what is in the
    // address bar, so the dashboard row and the URL are the same string.
    expect(TAB_TO_SLUG['ai']).toBe('ai-knowledge');
    expect(normalizeAnalyticsPath('/admin/ai-knowledge')).toBe('/admin/ai-knowledge');
  });
});

describe('2 — an unknown section normalises to /admin/[section]', () => {
  it.each(UNREGISTERED_SECTIONS.map((s) => [s] as const))(
    'an unknown section normalises to /admin/[section]: %s',
    (section) => {
      // 🔴 THE GUARD. A section added to the nav tomorrow, or a typo, must not
      // become a property by default — the list is closed, and over-redaction is
      // the intended failure mode.
      expect(isAdminSectionSlug(section)).toBe(false);
      expect(normalizeAnalyticsPath(`/admin/${section}`)).toBe('/admin/[section]');
      expect(normalizeUrlPath(`${HOST}/admin/${section}`)).toBe(`${HOST}/admin/[section]`);
    },
  );

  it('an unknown section is normalised on the real capture path too', async () => {
    await capturePageview('/admin/prayer-wall', false);
    const sent = beforeSendEvent(captured(lastPageview()))!;
    expect(sent.properties!.route).toBe('/admin/[section]');
    expect(JSON.stringify(sent.properties)).not.toContain('prayer-wall');
  });

  it('the lookup has no prototype, so an inherited key cannot pass as a section', () => {
    // `{}['constructor']` is truthy. A section table read with a segment out of
    // the address bar must not answer `/admin/constructor` with a function.
    expect(isAdminSectionSlug('constructor')).toBe(false);
    expect(isAdminSectionSlug('toString')).toBe(false);
    expect(normalizeAnalyticsPath('/admin/constructor')).toBe('/admin/[section]');
  });

  it('the parameter row still exists, which is what makes the fallback possible', () => {
    const patterns = ANALYTICS_ROUTES.map((r) => r.pattern);
    expect(patterns).toContain('/admin/[section]');
    expect(patterns).toContain('/admin/[section]/[itemId]');
  });

  it('a path outside /admin is untouched by any of this', () => {
    expect(normalizeAnalyticsPath(`/form/${DOC_ID}`)).toBe('/form/[formId]');
    expect(normalizeAnalyticsPath(`/event/${DOC_ID}`)).toBe('/event/[eventId]');
    expect(normalizeAnalyticsPath(`/post/${DOC_ID}`)).toBe('/post/[postId]');
    expect(normalizeAnalyticsPath(`/give/${DOC_ID}`)).toBe(UNROUTED_PATTERN);
  });
});

describe('3 — the item id segment is still a pattern', () => {
  it.each(ADMIN_SECTION_SLUGS.map((slug) => [slug] as const))(
    'the item id segment is still a pattern: /admin/%s/[itemId]',
    (slug) => {
      // 🔴 The second segment IS a Firestore document id — a contact, a doc, a
      // campaign. No row is generated for `/admin/<section>/[itemId]`, so the
      // whole path collapses, section name and all. Naming the section beside a
      // live id is the trade this ticket explicitly refused.
      const sent = normalizeAnalyticsPath(`/admin/${slug}/${DOC_ID}`);
      expect(sent).toBe('/admin/[section]/[itemId]');
      expect(sent).not.toContain(DOC_ID);
    },
  );

  it('an id reaches nothing, in the URL properties either', () => {
    expect(normalizeUrlPath(`${HOST}/admin/crm/${DOC_ID}`))
      .toBe(`${HOST}/admin/[section]/[itemId]`);
    expect(normalizeUrlPath(`/admin/docs/${DOC_ID}`)).toBe('/admin/[section]/[itemId]');
  });

  it('a captured deep link carries no document id anywhere in its properties', async () => {
    await capturePageview(`/admin/crm/${DOC_ID}`, false);
    const sent = beforeSendEvent(captured({
      ...lastPageview(),
      $current_url: `${HOST}/admin/crm/${DOC_ID}?token=abc`,
      $pathname: `/admin/crm/${DOC_ID}`,
    }))!;
    expect(JSON.stringify(sent), 'a document id left the browser').not.toContain(DOC_ID);
  });
});

describe('4 — the section list is derived from the nav, not hand-written', () => {
  const ADMIN_DASHBOARD = 'src/components/AdminDashboard.tsx';

  /** Every `{ id: 'x', label: … }` in the nav definition. */
  const navIds = (): string[] => {
    const ids = [...source(ADMIN_DASHBOARD).matchAll(/\{ id: '([a-z-]+)', label:/g)]
      .map((m) => m[1]);
    expect(ids.length, 'the nav definition could not be read at all').toBeGreaterThan(15);
    return [...new Set(ids)];
  };

  /**
   * The sections that are reachable WITHOUT a nav row — read from the redirect
   * guard's own `known` set, which is the thing that decides whether a typed
   * `/admin/x` renders or bounces.
   */
  const knownWithoutNavRow = (): string[] => {
    const line = source(ADMIN_DASHBOARD).match(/const known = new Set\(\[(.*?)\]\);/s);
    expect(line, 'the redirect guard could not be read').not.toBeNull();
    return [...line![1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  };

  it('the section list is derived from the nav, not hand-written', () => {
    // 🔴 BOTH DIRECTIONS, and the first is the one that matters: a tab added to
    // `AdminDashboard` with no row in `admin-sections.ts` fails here rather than
    // silently landing in the `/admin/[section]` bucket the ticket is about.
    for (const id of navIds()) {
      expect(ADMIN_SECTION_TABS, `the nav has a "${id}" tab with no section row`).toContain(id);
    }
    // And the reverse: a row nobody serves is drift too, and would put a section
    // name in the vocabulary that no screen backs.
    const dashboard = source(ADMIN_DASHBOARD);
    for (const tab of ADMIN_SECTION_TABS) {
      expect(dashboard, `"${tab}" is registered but AdminDashboard never mentions it`)
        .toContain(`'${tab}'`);
    }
  });

  it('a section reachable without a nav row is registered too', () => {
    // `canvas` and `upgrade` have no nav entry but do not redirect away, so they
    // are real sections a session sits on — the billing funnel in particular.
    for (const id of knownWithoutNavRow()) {
      expect(ADMIN_SECTION_TABS, `"${id}" is reachable but unregistered`).toContain(id);
    }
    expect(ADMIN_SECTION_TABS).toContain('canvas');
    expect(ADMIN_SECTION_TABS).toContain('upgrade');
  });

  it('the nav READS the table rather than keeping its own copy of it', () => {
    // Not just mirrored by this test — actually consumed. The URL round-trip
    // (`go()` → `/admin/<slug>`, `useParams().section` → `activeTab`) runs
    // through these maps, so a section whose slug is wrong here navigates wrong.
    const dashboard = source(ADMIN_DASHBOARD);
    expect(dashboard).toMatch(
      /import \{ SLUG_TO_TAB, TAB_TO_SLUG \} from '\.\.\/lib\/admin-sections'/,
    );
    expect(dashboard, 'AdminDashboard grew a second copy of the slug map')
      .not.toMatch(/const (SLUG_TO_TAB|TAB_TO_SLUG)[^=]*=/);
  });

  it('the two halves of the slug map are inverses, because one table makes both', () => {
    for (const tab of ADMIN_SECTION_TABS) {
      expect(SLUG_TO_TAB[TAB_TO_SLUG[tab]]).toBe(tab);
    }
    expect(ADMIN_SECTION_SLUGS.length).toBe(ADMIN_SECTION_TABS.length);
    expect(new Set(ADMIN_SECTION_SLUGS).size).toBe(ADMIN_SECTION_SLUGS.length);
  });

  it('every registered route for a section is generated from that table', () => {
    const sectionRoutes = ANALYTICS_ROUTES
      .filter((r) => r.pattern.startsWith('/admin/') && !r.pattern.includes('['))
      .map((r) => r.pattern);
    expect(sectionRoutes.sort())
      .toEqual(ADMIN_SECTION_SLUGS.map((s) => `/admin/${s}`).sort());
    for (const route of ANALYTICS_ROUTES.filter((r) => r.pattern.startsWith('/admin'))) {
      expect(route.surface).toBe('admin');
      expect(route.public).toBe(false);
    }
    expect(resolveAppSurface('/admin/crm')).toBe('admin');
  });

  it('the section table reaches nothing, so routes.ts still reaches nothing', () => {
    // 🔴 `routes.ts` is imported by `/blog/[id]`, the most performance-sensitive
    // page in the product. Its one import may not become a doorway to Firebase.
    const table = source('src/lib/admin-sections.ts');
    expect(table).not.toMatch(/^\s*import\s/m);
    expect(table).not.toMatch(/require\(|await import\(/);

    const routes = source('src/lib/analytics/routes.ts');
    const imports = [...routes.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports).toEqual([
      "import { ADMIN_SECTION_SLUGS, type AdminSectionSlug } from '../admin-sections';",
    ]);
  });
});

describe('5 — the resolved-path exception list is still empty', () => {
  /** A realistic resolved path for every registered pattern. */
  const resolved = (pattern: string): string =>
    pattern
      .replace('/admin/[section]/[itemId]', `/admin/docs/${DOC_ID}`)
      .replace('/admin/[section]', '/admin/prayer-wall')
      .replace(/\/\[[A-Za-z]+\]/g, `/${DOC_ID}`);

  it('the resolved-path exception list is still empty', () => {
    // 🔴 The founder asked to be told which routes send a live path. None do,
    // and THE-227 does not change that: a section is MATCHED against a closed
    // list, not exempted from matching, so there is still no exception list to
    // grow. A pattern that survived its own resolved path unchanged, while
    // having a parameter to lose, would appear below.
    const sendingResolvedPath = ANALYTICS_ROUTES.filter((route) => {
      const path = resolved(route.pattern);
      return route.pattern.includes('[') && normalizeAnalyticsPath(path) === path;
    });
    expect(sendingResolvedPath.map((r) => r.pattern)).toEqual([]);
  });

  it('nothing in routes.ts exempts a path from matching', () => {
    const routes = source('src/lib/analytics/routes.ts');
    // Matching is by enumeration, never by value shape — the same rule
    // `events.ts` holds for property labels.
    expect(routes).not.toMatch(/\[0-9a-f\]\{|\\d\{|looksLikeId|isUuid/i);
    // And the matcher itself is untouched: a literal segment already beat a
    // parameter at the same position, which is the entire mechanism here.
    expect(routes).toMatch(/if \(matched && literals > bestLiterals\)/);
  });

  it('normalising is still idempotent, so the two call sites agree', () => {
    for (const route of ANALYTICS_ROUTES) {
      expect(normalizeAnalyticsPath(route.pattern)).toBe(route.pattern);
    }
  });
});

describe('6 — AnalyticsRoutePattern is still a literal union, not string', () => {
  it('AnalyticsRoutePattern is still a literal union, not string', () => {
    // ⚠️ Vitest transpiles without typechecking, so the guard has to live in the
    // source and this asserts it is still there for `npm run typecheck`.
    // Widening is invisible: everything compiles, every test passes, and the
    // only symptom is that a misspelled route stops being caught.
    const routes = source('src/lib/analytics/routes.ts');
    expect(routes).toMatch(/\] as const satisfies readonly AnalyticsRoute\[\];/);
    expect(routes).toMatch(/AnalyticsRoutePattern = \(typeof ROUTE_TABLE\)\[number\]\['pattern'\]/);
    expect(routes).toMatch(/type Narrow<T extends string> = string extends T \? never : T;/);
    expect(routes).toMatch(/const PATTERN_UNION_IS_NARROW: Narrow<AnalyticsRoutePattern> = '\/';/);
  });

  it('the generated section rows contribute literals, not a template of string', () => {
    // 🔴 The rows are GENERATED, so the `as const` that keeps a row's pattern a
    // literal is written once and guards twenty-four of them. Drop it and the
    // whole union collapses to `string` — `npm run typecheck` fails on the
    // `Narrow` guard, and again on the `@ts-expect-error`, which stops having an
    // error to expect. Neither is visible to vitest, which transpiles without
    // typechecking, so this asserts both are still in the source.
    const routes = source('src/lib/analytics/routes.ts');
    expect(routes).toMatch(/\}\) as const satisfies AnalyticsRoute,/);
    expect(routes).toMatch(/@ts-expect-error[\s\S]{0,120}?AnalyticsRoutePattern = '\/admin\/prayer-wall'/);

    // The same discipline one module down: the slug union is read from the
    // `as const` table, not from an annotated export that would widen it.
    const table = source('src/lib/admin-sections.ts');
    expect(table).toMatch(/\] as const satisfies readonly \(readonly \[string, string\]\)\[\];/);
    expect(table).toMatch(/AdminSectionSlug = \(typeof ADMIN_SECTION_TABLE\)\[number\]\[1\]/);
  });
});

describe('7 — $current_url, $referrer and $pathname are normalised the same way as route', () => {
  it('$current_url, $referrer and $pathname are normalised the same way as route', async () => {
    // 🔴 Normalisation is applied TWICE — at the capture site for `route`, and
    // in `before_send` for the properties posthog-js builds itself from
    // `location.href`. If the two ever disagree, a normalised route ships
    // beside a raw URL and the raw one is the one that matters.
    await capturePageview('/admin/crm', false);
    const route = lastPageview().route;

    const sent = beforeSendEvent(captured({
      ...lastPageview(),
      $current_url: `${HOST}/admin/crm?email=jane%40example.org&token=abc`,
      $referrer: `${HOST}/admin/accounting`,
      $pathname: '/admin/crm',
    }))!;

    expect(sent.properties!.$current_url).toBe(`${HOST}${route}`);
    expect(sent.properties!.$pathname).toBe(route);
    expect(sent.properties!.$referrer).toBe(`${HOST}/admin/accounting`);
    // The original point of that hook, unchanged: the query string is gone.
    expect(JSON.stringify(sent.properties)).not.toContain('jane%40example.org');
    expect(JSON.stringify(sent.properties)).not.toContain('token=abc');
  });

  it.each(ADMIN_SECTION_SLUGS.map((slug) => [slug] as const))(
    'route and $pathname agree for /admin/%s',
    async (slug) => {
      await capturePageview(`/admin/${slug}`, false);
      const sent = beforeSendEvent(captured({
        ...lastPageview(),
        $pathname: `/admin/${slug}`,
        $current_url: `${HOST}/admin/${slug}`,
      }))!;
      expect(sent.properties!.$pathname).toBe(sent.properties!.route);
      expect(sent.properties!.$current_url).toBe(`${HOST}${sent.properties!.route}`);
    },
  );

  it('an unknown section disagrees with nothing either — both collapse', () => {
    const sent = beforeSendEvent(captured({
      route: normalizeAnalyticsPath('/admin/prayer-wall'),
      $pathname: '/admin/prayer-wall',
      $current_url: `${HOST}/admin/prayer-wall`,
    }))!;
    expect(sent.properties!.route).toBe('/admin/[section]');
    expect(sent.properties!.$pathname).toBe('/admin/[section]');
    expect(sent.properties!.$current_url).toBe(`${HOST}/admin/[section]`);
  });

  it('an external referrer still loses its path and keeps its host', () => {
    const sent = beforeSendEvent(captured({
      $referrer: 'https://mail.example.com/read/9f2c4471',
    }))!;
    expect(sent.properties!.$referrer).toBe(`https://mail.example.com${UNROUTED_PATTERN}`);
  });
});

describe('8 — session recording, autocapture and the closed vocabulary are unchanged', () => {
  it('session recording, autocapture and the closed vocabulary are unchanged', () => {
    const options = buildPostHogOptions();

    // 🔴 Two locks on replay, both still shut.
    expect(options.disable_session_recording).toBe(true);
    expect(options.disable_external_dependency_loading).toBe(true);

    // 🔴 Autocapture and every DOM-reading relative of it.
    expect(options.autocapture).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.rageclick).toBe(false);

    // 🔴 The closed vocabulary, unchanged in WIDTH by this ticket. A section
    // name is a new VALUE of `route`, not a new property — the same way
    // THE-206's 'public' was a third value of `app_surface`.
    expect(ALLOWED_EVENT_PROPERTY_KEYS).toEqual(['app_surface', 'is_platform_admin', 'route']);
    expect(options.before_send).toBe(beforeSendEvent);
  });

  it('an unregistered event is still dropped, section or no section', () => {
    for (const event of ['$autocapture', '$copy_autocapture', '$exception', '$web_vitals']) {
      const result = { ...captured({ route: '/admin/crm' }), event } as CaptureResult;
      expect(beforeSendEvent(result), `"${event}" was not dropped`).toBeNull();
    }
  });

  it('a section pageview carries the three registered keys and nothing else', async () => {
    await capturePageview('/admin/accounting', true);
    expect(Object.keys(lastPageview()).sort())
      .toEqual([...ALLOWED_EVENT_PROPERTY_KEYS].sort());
  });
});

describe('9 — no captured property carries an email, phone, donor name, prayer request or message body', () => {
  it('no captured property carries an email, phone, donor name, prayer request or message body', () => {
    // Named by LABEL, never by value shape — a test that hunts for an `@` passes
    // the moment a phone number leaks.
    const sent = beforeSendEvent(captured({
      route: '/admin/crm',
      app_surface: 'admin',
      donorName: 'Jane Roe',
      donorEmail: 'jane@example.org',
      phone: '07700 900461',
      request: 'please pray for my mother',
      content: 'a private message',
      totalDonated: 4200,
      contact: { firstName: 'Jane', notes: 'lapsed' },
    }))!;

    for (const label of Object.keys(sent.properties!)) {
      expect(isForbiddenPropertyLabel(label), `"${label}" survived before_send`).toBe(false);
    }
    expect(Object.keys(sent.properties!).sort()).toEqual(['app_surface', 'route']);
  });

  it('no section name is itself one of the labels that must never be sent', () => {
    // 🔴 STOP condition 5, as an assertion. A section is a feature name; if one
    // ever collided with a donor-record field this vocabulary would be shipping
    // that word as a value.
    for (const slug of ADMIN_SECTION_SLUGS) {
      expect(FORBIDDEN_PROPERTY_LABELS, `"${slug}" is a forbidden label`).not.toContain(slug);
      expect(isForbiddenPropertyLabel(slug)).toBe(false);
    }
  });

  it('every section name is a compile-time literal, never something a user chose', () => {
    // 🔴 The reason a section may be sent at all. Each one is written in the
    // app's own source; none is a tenant slug, a document id or a name somebody
    // typed. Asserted against the nav file rather than by inspecting the value,
    // because the guarantee is about WHERE the string comes from.
    const dashboard = source('src/components/AdminDashboard.tsx');
    for (const tab of ADMIN_SECTION_TABS) {
      expect(dashboard, `"${tab}" is not a literal in the nav`).toContain(`'${tab}'`);
    }
    // And the rule is written down where the next person adds a row.
    expect(source('src/lib/admin-sections.ts'))
      .toMatch(/Nothing user-chosen and nothing tenant-specific may ever be added/);
  });

  it('a tenant is still a group, and its slug never rides in a path', () => {
    // A church's subdomain survives in `$current_url` — it is the group key
    // already, not a person — but nothing tenant-specific enters the PATH.
    expect(normalizeUrlPath('https://nations.theharvest.app/admin/crm'))
      .toBe('https://nations.theharvest.app/admin/crm');
    expect(normalizeAnalyticsPath('/admin/tenants/nations'))
      .toBe('/admin/[section]/[itemId]');
  });
});

describe('10 — layout.tsx is unchanged', () => {
  it('layout.tsx is unchanged', () => {
    // 🔴 Byte for byte. It carries the pre-paint theme script that four PRs went
    // into getting right, and analytics has never had a reason to go near it.
    //
    // ⚠️ A HASH, not a `git show`: CI's clone depth is not this suite's business
    // and a shell-out at assertion time would make it one.
    expect(digest('src/app/layout.tsx'))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('and neither is anything else this ticket was told not to touch', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
    expect(digest('functions/src/index.ts'))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
  });
});
