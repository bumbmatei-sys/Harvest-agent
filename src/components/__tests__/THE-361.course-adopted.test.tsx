import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-361 — one event, added to a file that IS the privacy decision.
 *
 * ─── What this suite guards ─────────────────────────────────────────────────
 *
 * THE-360 took `ANALYTICS_EVENTS` from one name to ten and PROPOSED
 * `course_adopted` as an eleventh. It was dropped on a report that no adopt
 * action could be found — a wrong premise, not a decision: `AdminCourses` has
 * posted to `/api/courses/adopt` since #228, and `CoursePreview` adopts through
 * the same handler. The founder has since asked for it, so this ticket adds it.
 *
 * The danger is not that the event is missing. It is that an event fired beside
 * an adoption arrives carrying the thing it was fired next to — the course id,
 * the title, the author. So most of what is below asserts what CANNOT be sent
 * and what CANNOT fire, not what can.
 *
 * ─── ⚠️ Every content grep here runs over PARSER-STRIPPED source ────────────
 *
 * `AdminCourses.tsx` is MOSTLY PROSE around the adopt path: THE-342's read
 * honesty, THE-345's ghost adoptions and #228's server-only pointer are all
 * argued in docblocks that spell `adopt`, `adopted` and `adoption` dozens of
 * times. A sweep for one of those over raw source reports a comment as code.
 * The stripper is IMPORTED from the shared fixture (#496), never copied — a
 * copied probe is how guards in this series ended up unable to fail.
 *
 * 🔴 AND THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS. #496 found two of its own
 * guards self-matching: the literal they swept for was written in the sweeping
 * file, so the sweep found itself and passed. Anything this file greps for as
 * an ABSENCE is built with `join` at run time.
 *
 * ─── The observable is a real capture, not a spy on the seam ────────────────
 *
 * The behavioural sections below mount the real screen against a mocked
 * `posthog-js` and let the REAL analytics client run end to end. Spying on
 * `trackProductEvent` would prove the call site calls something; letting the
 * capture happen proves what actually reaches the network boundary — which is
 * the only place "no course id" can honestly be asserted.
 */

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { acceptedRulesDigests } from '../../__tests__/__fixtures__/firestore-rules-pin';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── the SDK, mocked at the boundary the real client loads ────────────────── */

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

/* ── the screen's own world, mirroring AdminCourses.test.tsx ──────────────── */

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-uid' } } }));

const scope = vi.hoisted(() => ({
  read: 'tenant-1' as string | null,
  write: 'tenant-1' as string | null,
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
  PLATFORM_TENANT_ID: 'harvest',
}));

vi.mock('../AdminCourseEditor', () => ({ default: () => <div data-testid="course-editor" /> }));

const tenantCtx = vi.hoisted(() => ({ tenantPlan: undefined as string | undefined }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));

vi.mock('react-player/youtube', () => ({
  default: ({ url }: { url: string }) => <div data-testid="react-player" data-url={url} />,
}));

let mockCourses: Array<{ id: string; title: string; author: string; status: string }> = [];
let mockLibrary: Array<{ id: string; title: string; status: string }> = [];
let mockLibraryAuthors: Array<{ id: string; name: string; bio?: string }> = [];
let mockAdopted: Array<{ id: string; libraryCourseId: string }> = [];

const calls = vi.hoisted(() => ({
  paths: [] as string[],
  writes: [] as Array<Record<string, unknown>>,
  fetches: [] as Array<Record<string, unknown>>,
}));

const mockAuthFetch = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: (url: string, options: { method?: string; body?: string }) => {
    calls.fetches.push({ url, method: options?.method, body: JSON.parse(options?.body || '{}') });
    return mockAuthFetch();
  },
}));

function rowsFor(p: string): Array<{ id: string }> {
  if (p === 'courses') return mockCourses;
  if (p === 'libraryCourses') return mockLibrary;
  if (p === 'libraryAuthors') return mockLibraryAuthors;
  if (p.includes('adoptedCourses')) return mockAdopted;
  return [];
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: { __path?: string; args?: unknown[] }, ...args: unknown[]) =>
    ({ __path: col?.__path, args: [...(col?.args ?? []), ...args] }),
  where: (field: string, op?: string, value?: unknown) => ({ __where: { field, op, value } }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: unknown) => ({ __orderBy: field }),
  documentId: () => '__name__',
  getCountFromServer: async (q: { __path?: string }) =>
    ({ data: () => ({ count: rowsFor(q?.__path ?? '').length }) }),
  getDocs: async (q: { __path?: string; args?: Array<{ __where?: { field: string; value: string[] } }> }) => {
    const p = q?.__path ?? '';
    calls.paths.push(p);
    const inClause = (q?.args ?? []).find((a) => a?.__where?.field === '__name__');
    const ids: string[] | null = inClause ? inClause.__where!.value : null;
    const rows = rowsFor(p).filter((r) => (ids ? ids.includes(r.id) : true));
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) };
  },
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  deleteDoc: async (ref: { __path?: string }) => { calls.writes.push({ op: 'delete', path: ref?.__path }); },
  setDoc: async (ref: { __path?: string }, data: unknown) => {
    calls.writes.push({ op: 'set', path: ref?.__path, data });
  },
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (q: { __path?: string }, onNext: (snap: unknown) => void) => {
    const p = q?.__path ?? '';
    calls.paths.push(p);
    const rows = rowsFor(p);
    onNext({ docs: rows.map((c) => ({ id: c.id, data: () => c })) });
    return () => {};
  },
}));

import AdminCourses from '../AdminCourses';
import {
  ALLOWED_EVENT_NAMES,
  ALLOWED_EVENT_PROPERTY_KEYS,
  ALLOWED_PERSON_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
} from '../../lib/analytics/events';
import { beforeSendEvent, buildPostHogOptions } from '../../lib/analytics/config';
import { __resetAnalyticsForTests, trackProductEvent } from '../../lib/analytics/client';

const ROOT = path.resolve(__dirname, '../../..');
const TEST_KEY = 'phc_test_project_key';

const SCREEN = 'src/components/AdminCourses.tsx';
const PREVIEW = 'src/components/course/CoursePreview.tsx';
const EVENTS = 'src/lib/analytics/events.ts';

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const codeOf = (rel: string): string => stripComments(read(rel));
const sha = (rel: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/* ── driving the screen ───────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root;

/**
 * Let every queued microtask and one macrotask turn run.
 *
 * ⚠️ The capture is DELIBERATELY not awaited by the screen, so it settles after
 * the click does. This is what makes it observable without making the screen
 * wait for it — which is the property section 9 exists to keep.
 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminCourses />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await settle();
}

const buttonsBy = (match: (b: HTMLButtonElement) => boolean): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button')).filter(match);

function libraryTab(): HTMLButtonElement {
  const b = buttonsBy((x) => (x.textContent || '').trim().startsWith('Library ('))[0];
  if (!b) throw new Error('No Library tab found');
  return b;
}

const adoptButtons = (): HTMLButtonElement[] =>
  buttonsBy((b) => (b.textContent || '').trim() === 'Adopt');

function previewTrigger(title: string): HTMLButtonElement {
  const b = buttonsBy((x) => x.getAttribute('title') === `Preview ${title}`)[0];
  if (!b) throw new Error(`No preview trigger for ${title}`);
  return b;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await settle();
}

const makeLibrary = (n: number, status = 'published') =>
  Array.from({ length: n }, (_, i) => ({ id: `lib-${i}`, title: `Library Course ${i}`, status }));

const makeCourses = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `course-${i}`, title: `Course ${i}`, author: 'Author', status: 'draft',
  }));

/** Every capture of the new event, with its properties. */
const adoptionCaptures = (): Array<Record<string, unknown>> =>
  mockPostHog.capture.mock.calls
    .filter(([event]) => event === ANALYTICS_EVENTS.COURSE_ADOPTED)
    .map(([, props]) => (props ?? {}) as Record<string, unknown>);

/** Open the Library tab with one adoptable course and nothing adopted. */
async function libraryWithOneCourse(): Promise<void> {
  tenantCtx.tenantPlan = 'pro';
  mockLibrary = makeLibrary(1);
  await mount();
  await click(libraryTab());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.clearAllMocks();
  mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  __resetAnalyticsForTests();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = TEST_KEY;
  tenantCtx.tenantPlan = undefined;
  mockCourses = [];
  mockLibrary = [];
  mockLibraryAuthors = [];
  mockAdopted = [];
  calls.paths = [];
  calls.writes = [];
  calls.fetches = [];
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  window.history.replaceState({}, '', '/admin/courses');
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
  mockPostHog.capture.mockReset();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — course_adopted is in the vocabulary
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · course_adopted is in the vocabulary', () => {
  it('the name is registered, and it is the name the constant carries', () => {
    expect(ANALYTICS_EVENTS.COURSE_ADOPTED).toBe('course_adopted');
    expect(ALLOWED_EVENT_NAMES).toContain('course_adopted');
  });

  it('it survives before_send, where an unregistered neighbour does not', () => {
    // 🔴 The pair is the point: being in the list is what lets it through, and
    // the list is still a list. `course_unadopted` is the event this ticket
    // considered and did NOT add, so it is the honest negative control.
    expect(beforeSendEvent({ event: 'course_adopted', properties: {} } as never)).not.toBeNull();
    const absent = ['course', 'unadopted'].join('_');
    expect(beforeSendEvent({ event: absent, properties: {} } as never)).toBeNull();
    expect(ALLOWED_EVENT_NAMES).not.toContain(absent);
  });

  it('the vocabulary is exactly these fourteen names', () => {
    // 🔴 SPELLED OUT rather than read back from the export it constrains. A
    // twelfth product event arrives through this list or does not arrive.
    expect([...ALLOWED_EVENT_NAMES]).toEqual([
      '$pageview',
      'gift_recorded',
      'event_payment_confirmed',
      'course_published',
      'course_adopted',
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

  it('it was added by editing events.ts, and it names an ACTION', () => {
    const src = codeOf(EVENTS);
    expect(src, 'the name is not a literal in the vocabulary itself')
      .toContain(`COURSE_ADOPTED: 'course_adopted'`);
    // Nothing was added for reading, viewing or opening: pageviews answer that.
    for (const verb of ['view', 'read', 'open', 'seen', 'visit', 'click', 'scroll']) {
      expect('course_adopted', `reads like a ${verb} event`).not.toContain(verb);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — it fires exactly once on a successful adopt
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · it fires exactly once on a successful adopt', () => {
  it('one adoption, one capture, and the POST really happened', async () => {
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    expect(calls.fetches).toHaveLength(1);
    expect(calls.fetches[0].url).toBe('/api/courses/adopt');
    expect(calls.fetches[0].method).toBe('POST');
    expect(adoptionCaptures()).toHaveLength(1);
  });

  it('it is the only event the adoption sends', async () => {
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    // No pageview, no second product event: this screen fires one thing.
    expect(mockPostHog.capture.mock.calls.map(([event]) => event)).toEqual(['course_adopted']);
  });

  it('it carries the route PATTERN and the admin surface, both for free', async () => {
    // ✅ `app_surface` and `route` come from the existing plumbing — the call
    // site passes neither and could not.
    //
    // `/admin/courses` IS a pattern, not a resolved path: THE-227 generates one
    // row per KNOWN admin section from `ADMIN_SECTION_SLUGS`, so the second
    // segment is a compile-time literal this app wrote, in the same category as
    // `app_surface: 'admin'`. The id-bearing shape is the row below it in that
    // table, and the next test proves that one is still redacted.
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    const [props] = adoptionCaptures();
    expect(props.route).toBe('/admin/courses');
    expect(props.app_surface).toBe('admin');
  });

  it('and an id in the path is still redacted on this very event', async () => {
    window.history.replaceState({}, '', '/admin/courses/9f2c4d7e1a');
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    const [props] = adoptionCaptures();
    expect(props.route).toBe('/admin/[section]/[itemId]');
    expect(JSON.stringify(props), 'the resolved segment became a property')
      .not.toContain('9f2c4d7e1a');
  });

  it('it writes nothing to Firestore — adoption is still the route\'s job', async () => {
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);
    expect(calls.writes.filter((w) => w.op === 'set')).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — it does NOT fire on a failed adopt
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · it does not fire on a failed adopt', () => {
  it('a PLAN CAP refused by the route fires nothing', async () => {
    // The client cap is presentation; the route is the authority and returns
    // 403. A capture here would report an activation that did not happen.
    mockAuthFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Your plan includes up to 5 courses (including adopted library courses). Upgrade to add more.' }),
    } as never);
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    expect(container.textContent).toMatch(/plan includes up to 5 courses/i);
    expect(adoptionCaptures()).toHaveLength(0);
  });

  it('a PLAN CAP refused by the client never reaches the route either', async () => {
    // The other half of the same cap. `atLimit` returns before the request, so
    // there is no response to be right or wrong about.
    tenantCtx.tenantPlan = 'plus';
    mockCourses = makeCourses(2);
    mockLibrary = makeLibrary(3);
    await mount();
    await click(libraryTab());

    const buttons = adoptButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.disabled).toBe(true);

    await click(buttons[0]);
    expect(calls.fetches).toHaveLength(0);
    expect(adoptionCaptures()).toHaveLength(0);
  });

  it('an UNPUBLISHED course refused by the route fires nothing', async () => {
    // 🔴 The route independently refuses an unpublished course — a check no
    // Firestore rule can make. The client filter is presentation, so this is
    // the refusal that decides, and nothing may fire on it.
    mockAuthFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'That course is not published.' }),
    } as never);
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    expect(container.textContent).toMatch(/not published/i);
    expect(adoptionCaptures()).toHaveLength(0);
  });

  it('an unpublished course is not even offered, so the refusal is belt and braces', async () => {
    tenantCtx.tenantPlan = 'pro';
    mockLibrary = [
      { id: 'lib-pub', title: 'Published One', status: 'published' },
      { id: 'lib-draft', title: 'Draft One', status: 'draft' },
    ];
    await mount();
    await click(libraryTab());
    expect(adoptButtons()).toHaveLength(1);
    expect(adoptionCaptures()).toHaveLength(0);
  });

  it('a NETWORK failure fires nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockAuthFetch.mockRejectedValue(new Error('network down'));
      await libraryWithOneCourse();
      await click(adoptButtons()[0]);

      expect(container.textContent).toMatch(/failed to adopt/i);
      expect(adoptionCaptures()).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
  });

  it('no tenant could be resolved, so nothing was posted and nothing fired', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      scope.read = null;
      scope.write = null;
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = makeLibrary(1);
      await mount();
      await click(libraryTab());
      await click(adoptButtons()[0]);

      expect(calls.fetches).toHaveLength(0);
      expect(adoptionCaptures()).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
  });

  it('the fire point sits AFTER the response check, in source order', () => {
    // 🔴 The structural half of the same claim, and the one that fails if the
    // capture is moved above `if (!res.ok)`. Needles assembled so this file
    // cannot satisfy its own sweep.
    const src = codeOf(SCREEN);
    const seam = ['track', 'ProductEvent'].join('');
    const check = ['if (!res', '.ok) {'].join('');

    const fire = src.indexOf(`${seam}(`);
    expect(fire, 'the screen does not fire the event at all').toBeGreaterThan(-1);
    expect(src.indexOf(check), 'the response check is gone').toBeGreaterThan(-1);
    expect(src.indexOf(check), 'the capture fires before the response was checked')
      .toBeLessThan(fire);
    // And it is inside the `try`, so a thrown request lands in the catch above
    // it rather than past it.
    expect(src.indexOf('const res = await authFetch'), 'the request moved after the capture')
      .toBeLessThan(fire);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — it does not fire twice when the course is already adopted
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · it does not fire twice when the course is already adopted', () => {
  it('an adopted course offers no adopt control anywhere, so nothing can fire', async () => {
    tenantCtx.tenantPlan = 'pro';
    mockLibrary = makeLibrary(1);
    mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
    await mount();
    await click(libraryTab());

    expect(container.textContent).toContain('Adopted');
    expect(adoptButtons()).toHaveLength(0);

    // The preview is the other surface, and it is gated the same way.
    await click(previewTrigger('Library Course 0'));
    expect(adoptButtons()).toHaveLength(0);
    expect(adoptionCaptures()).toHaveLength(0);
  });

  it('and the early return is BEFORE the fire point, which is what makes that durable', () => {
    // The interface not offering the control is the first line; the handler's
    // own early return is the one that holds if a caller ever reaches it
    // anyway. Source order is the only honest way to assert it — the guarded
    // path cannot be driven through the UI precisely because the UI is gated.
    const src = codeOf(SCREEN);
    const guard = ['adoptedIds', '.has(libraryCourse.id)) return;'].join('');
    const seam = ['track', 'ProductEvent'].join('');

    const handler = src.indexOf('const handleAdopt = async');
    expect(handler, 'handleAdopt is gone').toBeGreaterThan(-1);

    const guardAt = src.indexOf(guard, handler);
    const fireAt = src.indexOf(`${seam}(`, handler);
    expect(guardAt, 'the already-adopted early return is gone').toBeGreaterThan(-1);
    expect(fireAt, 'the capture is not inside handleAdopt').toBeGreaterThan(-1);
    expect(guardAt, 'the capture now fires before the already-adopted guard')
      .toBeLessThan(fireAt);
  });

  it('there is exactly ONE fire point in the screen', () => {
    // Two would be two chances to drift apart, and un-adopt and the override
    // handler must have none — neither is an adoption.
    const src = codeOf(SCREEN);
    const seam = ['track', 'ProductEvent'].join('');
    expect(src.split(`${seam}(`).length - 1).toBe(1);
  });

  it('un-adopting fires nothing', async () => {
    // 🔵 Reported, not built: an un-adopt event. Adoption is the activation
    // signal; dropping a course is noise until there is enough of it to be a
    // pattern. This asserts the absence rather than assuming it.
    tenantCtx.tenantPlan = 'pro';
    mockLibrary = makeLibrary(1);
    mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
    await mount();
    await click(libraryTab());

    const remove = buttonsBy((b) =>
      (b.textContent || '').includes('Remove from your courses')
      || (b.getAttribute('title') || '').includes('Remove from your courses'))[0];
    expect(remove).toBeDefined();
    await click(remove);

    expect(calls.fetches[0].method).toBe('DELETE');
    expect(mockPostHog.capture).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — it fires from the preview path too
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · it fires from the preview path too', () => {
  it('adopting from the read-only preview fires exactly once', async () => {
    await libraryWithOneCourse();
    await click(previewTrigger('Library Course 0'));

    // The preview is a full in-shell screen, so the browse list is gone.
    expect(container.textContent).toContain('Library preview');
    await click(adoptButtons()[0]);

    expect(calls.fetches).toHaveLength(1);
    expect(calls.fetches[0].body).toEqual({ tenantId: 'tenant-1', libraryCourseId: 'lib-0' });
    expect(adoptionCaptures()).toHaveLength(1);
  });

  it('because the preview adopts through the SAME handler', () => {
    // ✅ One instrumentation point covers both paths. `CoursePreview` has no
    // analytics import of its own and needs none.
    const src = codeOf(SCREEN);
    expect(src).toContain('onAdopt={handleAdopt}');

    const preview = codeOf(PREVIEW);
    expect(preview, 'the preview posts to the route itself').not.toContain('courses/adopt');
    expect(preview, 'the preview grew an analytics call of its own')
      .not.toContain(['track', 'ProductEvent'].join(''));
    expect(preview).toContain('onAdopt(course)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — it carries NO course id, title or author
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · it carries no course id, title or author', () => {
  it('the captured properties are the registered keys and nothing else', async () => {
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    const [props] = adoptionCaptures();
    expect(Object.keys(props).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(props)) {
      expect(ALLOWED_EVENT_PROPERTY_KEYS, `"${key}" is not registered`).toContain(key);
      // Every value is a literal from a table this app defines.
      expect(typeof value === 'string' || typeof value === 'boolean').toBe(true);
    }
  });

  it('the id, the title and the author appear in NO property, at any depth', async () => {
    tenantCtx.tenantPlan = 'pro';
    mockLibrary = [{
      id: 'lib-secret-9f2c4d7e', title: 'Rooted In Grace', status: 'published',
      authorIds: ['author-7'],
    } as never];
    mockLibraryAuthors = [{ id: 'author-7', name: 'Pastor Adeyemi' }];
    await mount();
    await click(libraryTab());
    await click(adoptButtons()[0]);

    const [props] = adoptionCaptures();
    const serialised = JSON.stringify(props);
    for (const leak of ['lib-secret-9f2c4d7e', 'Rooted In Grace', 'author-7', 'Pastor Adeyemi']) {
      expect(serialised, `the capture carries "${leak}"`).not.toContain(leak);
    }
  });

  it('the call site passes the constant and nothing else', () => {
    const src = codeOf(SCREEN);
    const seam = ['track', 'ProductEvent'].join('');
    const args = [...src.matchAll(new RegExp(`${seam}\\(([^;]*?)\\);`, 'gs'))].map((m) => m[1].trim());
    expect(args).toEqual(['ANALYTICS_EVENTS.COURSE_ADOPTED']);
    // The CONSTANT, never the raw string — a raw string bypasses the union that
    // makes an unregistered name a compile error.
    expect(src, 'the screen hardcodes the event name')
      .not.toContain(`'${['course', 'adopted'].join('_')}'`);
  });

  it('and the seam it fires through has no parameter a record could travel in', () => {
    const client = codeOf('src/lib/analytics/client.ts');
    expect(client).toContain('options: { limitKind?: PlanLimitKind } = {}');
    expect(client).not.toContain(['props', 'erties?: Record'].join(''));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — ALLOWED_EVENT_PROPERTY_KEYS is still 4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('7 · the property list did not grow', () => {
  it('it is exactly these four keys, and the person list is still one', () => {
    // 🔴 THE-206 added `route`, THE-360 added `limit_kind`, THE-361 adds NOTHING.
    // The product question is "are churches adopting at all", answered by the
    // count, so this ticket had no property to want.
    expect([...ALLOWED_EVENT_PROPERTY_KEYS]).toEqual([
      'app_surface',
      'is_platform_admin',
      'route',
      'limit_kind',
    ]);
    expect(ALLOWED_EVENT_PROPERTY_KEYS).toHaveLength(4);
    expect([...ALLOWED_PERSON_PROPERTY_KEYS]).toEqual(['account_kind']);
  });

  it('no course-shaped key was registered', () => {
    for (const key of [['course', 'id'].join('_'), 'title', ['course', 'title'].join('_'), 'author']) {
      expect(ALLOWED_EVENT_PROPERTY_KEYS, `"${key}" is registered`).not.toContain(key);
    }
  });

  it('a course id offered to before_send is stripped even under a registered key', () => {
    const scrubbed = beforeSendEvent({
      event: 'course_adopted',
      properties: { route: '/admin/[section]', contactId: 'lib-9f2c' },
    } as never);
    expect(Object.keys(scrubbed!.properties!)).not.toContain('contactId');
    expect(scrubbed!.properties!.route).toBe('/admin/[section]');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — adoption succeeds when analytics throws
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 · adoption succeeds when analytics is dead', () => {
  it('a THROWING capture leaves the adoption intact, and the handler observably ran', async () => {
    // 🔴 ASSERTED, NOT ASSUMED. `swallow` warns outside production, so a
    // swallowed failure leaves a trace; asserting only that nothing threw would
    // pass with the guard removed, which is how #504 found two dead tests.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockPostHog.capture.mockImplementation(() => { throw new Error('posthog exploded'); });
      await libraryWithOneCourse();
      await click(adoptButtons()[0]);

      expect(calls.fetches).toHaveLength(1);
      expect(container.textContent).not.toMatch(/failed to adopt/i);
      expect(buttonsBy((b) => (b.textContent || '').trim().startsWith('Adopting')),
        'the spinner never cleared').toHaveLength(0);
      expect(adoptButtons().some((b) => b.disabled), 'the adopt control is still disabled')
        .toBe(false);

      const handled = warn.mock.calls.some(([message]) =>
        typeof message === 'string'
        && message.includes('course_adopted')
        && message.includes('swallowed'));
      expect(handled, 'the throwing capture was never handled').toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('a REJECTING capture is handled too, and leaves no unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    const onRejection = (e: { reason?: unknown }) => { seen.push(e?.reason); };
    window.addEventListener('unhandledrejection', onRejection as EventListener);
    try {
      mockPostHog.capture.mockImplementation(
        () => Promise.reject(new Error('network down')) as unknown as void);
      await libraryWithOneCourse();
      await click(adoptButtons()[0]);

      expect(calls.fetches).toHaveLength(1);
      expect(container.textContent).not.toMatch(/failed to adopt/i);
      const handled = warn.mock.calls.some(([message]) =>
        typeof message === 'string'
        && message.includes('course_adopted')
        && message.includes('swallowed'));
      expect(handled, 'a rejecting capture was left with no handler attached').toBe(true);
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('unhandledrejection', onRejection as EventListener);
      warn.mockRestore();
    }
  });

  it('an SDK that will not initialise at all leaves the adoption intact', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockPostHog.init.mockImplementation(() => { throw new Error('init exploded'); });
      await libraryWithOneCourse();
      await click(adoptButtons()[0]);

      expect(calls.fetches).toHaveLength(1);
      expect(container.textContent).not.toMatch(/failed to adopt/i);
    } finally {
      mockPostHog.init.mockReset();
      warn.mockRestore();
    }
  });

  it('with analytics switched off entirely the adoption still completes', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    __resetAnalyticsForTests();
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    expect(calls.fetches).toHaveLength(1);
    expect(mockPostHog.init).not.toHaveBeenCalled();
    expect(mockPostHog.capture).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/failed to adopt/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — the capture is not awaited
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('9 · the capture is not awaited', () => {
  it('a capture that NEVER SETTLES does not hold the adoption open', async () => {
    // #504's defect, in its observable form: an awaited capture puts a network
    // round trip between the church pressing Adopt and the screen finishing.
    // With a capture that never resolves, an awaiting call site never reaches
    // its `finally` — so the spinner would still be up and the button disabled.
    mockPostHog.capture.mockImplementation(() => new Promise(() => {}) as unknown as void);
    await libraryWithOneCourse();
    await click(adoptButtons()[0]);

    expect(calls.fetches).toHaveLength(1);
    // The BUTTON, not the page: this screen's own prose explains what "Adopting
    // one" does, so a sweep of `textContent` matches copy rather than state.
    expect(buttonsBy((b) => (b.textContent || '').trim().startsWith('Adopting')),
      'the adoption is still spinning, so something awaited the capture')
      .toHaveLength(0);
    expect(adoptButtons().some((b) => b.disabled), 'the adoption is still waiting on analytics')
      .toBe(false);
    expect(container.textContent).not.toMatch(/failed to adopt/i);
  });

  it('the seam hands back nothing to await', () => {
    // There is no promise to mishandle, which is the property rather than a
    // habit call sites are trusted to keep.
    mockPostHog.capture.mockImplementation(() => { throw new Error('posthog exploded'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(trackProductEvent(ANALYTICS_EVENTS.COURSE_ADOPTED)).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('and the call site awaits nothing analytics-shaped', () => {
    const src = codeOf(SCREEN);
    const seam = ['track', 'ProductEvent'].join('');
    expect(src, 'the screen awaits the analytics call').not.toContain(`await ${seam}`);
    // 🔴 And it does not reach past the non-awaitable seam for the awaitable
    // one underneath it, which is the same defect wearing another name.
    for (const lower of [['capture', 'Event'].join(''), ['capture', 'ProductEvent'].join('')]) {
      expect(src, `the screen calls ${lower} directly`).not.toContain(lower);
    }
    expect(src, 'the screen does not use the non-awaitable seam').toContain(`${seam}(`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 — autocapture off, capture_pageview off, identity list of three
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('10 · the settings this ticket must not have moved', () => {
  it('autocapture and every DOM-reading relative are still off', () => {
    const options = buildPostHogOptions();
    expect(options.autocapture).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.rageclick).toBe(false);
    expect(options.disable_session_recording).toBe(true);
  });

  it('capture_pageview is still off, so the pre-auth funnel stays excluded', () => {
    expect(buildPostHogOptions().capture_pageview).toBe(false);
    expect(buildPostHogOptions().capture_pageleave).toBe(false);
  });

  it('the identity events are still a LIST of three, not a $ prefix', () => {
    // A prefix rule would admit `$copy_autocapture`, which sends the text a
    // user copied — on /admin/crm that is a donor's email address.
    const dollarNames = ALLOWED_EVENT_NAMES.filter((n) => n.startsWith('$'));
    expect(dollarNames).toEqual(['$pageview', '$identify', '$groupidentify', '$set']);
    for (const event of ['$autocapture', '$copy_autocapture', '$exception', '$web_vitals']) {
      expect(beforeSendEvent({ event, properties: {} } as never), `${event} leaked`).toBeNull();
    }
    const src = codeOf('src/lib/analytics/events.ts');
    expect(src).not.toContain(['starts', 'With'].join('') + "('$')");
  });

  it('a resolved path is still never a property', () => {
    // Patterns only; an unrecognised shape over-redacts rather than passing
    // through. Asserted on this ticket's own event.
    for (const [live, pattern] of [
      ['/admin/courses/9f2c4d7e', '/admin/[section]/[itemId]'],
      ['/nothing/like/this', '/[unrouted]'],
    ] as const) {
      const scrubbed = beforeSendEvent({
        event: 'course_adopted',
        properties: { route: pattern, $current_url: `https://nations.theharvest.app${live}` },
      } as never);
      expect(scrubbed!.properties!.route).toBe(pattern);
      expect(JSON.stringify(scrubbed!.properties)).not.toContain(live.split('/').filter(Boolean).pop()!);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 — admin-sections.ts still has ZERO imports; routes.ts reaches nothing
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('11 · the blog bundle is still Firestore-free', () => {
  it('admin-sections.ts imports nothing at all', () => {
    // 🔴 routes.ts reads this file, /blog/[id] imports routes.ts through
    // client.ts, and /blog/[id] ships no Firestore SDK. An import added here is
    // an import added to every blog reader's download.
    const src = codeOf('src/lib/admin-sections.ts');
    expect(src).not.toContain(['im', 'port'].join(''));
    expect(src).not.toContain(['requ', 'ire'].join(''));
  });

  it('routes.ts imports only the section table, and reaches Firebase nowhere', () => {
    const src = codeOf('src/lib/analytics/routes.ts');
    const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers).toEqual(['../admin-sections']);
    expect(src, 'a lazy Firestore import is still Firestore')
      .not.toContain(['im', 'port'].join('') + '(');

    const table = codeOf('src/lib/admin-sections.ts');
    for (const needle of [['fire', 'base'].join(''), ['fire', 'store'].join(''), 'tenant-scope']) {
      expect(table, `admin-sections.ts mentions ${needle}`).not.toContain(needle);
    }
  });

  it('and this ticket added nothing to either of them', () => {
    // The event is named in events.ts and fired from a screen. Neither of these
    // two files has any business knowing about it.
    for (const rel of ['src/lib/admin-sections.ts', 'src/lib/analytics/routes.ts']) {
      expect(codeOf(rel), `${rel} names the new event`)
        .not.toContain(['course', 'adopted'].join('_'));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 — THE-345's counting is unchanged
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("12 · THE-345's ghost-adoption work is undisturbed", () => {
  it('countedAdoptions, danglingAdoptions and the fail-closed cap are byte-for-byte', () => {
    const src = codeOf(SCREEN);
    expect(src).toContain(
      'const countedAdoptions = adoptionsResolved ? resolvedAdopted.length : adopted.length;');
    expect(src).toContain(
      'const danglingAdoptions = adoptionsResolved ? adopted.length - resolvedAdopted.length : 0;');
    expect(src).toContain('const adoptionsResolved = adoptedResolvedKey === adoptedIdKey;');
    // 🔴 The cap still fails CLOSED on an unknown count.
    expect(src).toContain('const atLimit = ownCount === null\n    ? true\n    : isAtCourseLimit(ownCount, countedAdoptions, maxCourses);');
  });

  it("THE-342's by-id resolution and the truncation notices are still there", () => {
    const src = codeOf(SCREEN);
    expect(src).toContain('readDocsByIds');
    expect(src).toContain('truncationNotice');
    expect(src).toContain('const ownListTruncated = ownCount !== null && courses.length < ownCount;');
  });

  it('a ghost adoption still does not consume a plan slot', async () => {
    // The behaviour, not only the expression: one pointer at a library course
    // that no longer exists, and the church is not at its 2-course limit.
    tenantCtx.tenantPlan = 'plus';
    mockCourses = makeCourses(1);
    mockLibrary = makeLibrary(1);
    mockAdopted = [{ id: 'lib-gone', libraryCourseId: 'lib-gone' }];
    await mount();

    const newCourse = buttonsBy((b) => (b.textContent || '').trim().startsWith('New course'))[0];
    expect(newCourse.disabled, 'a ghost adoption is consuming a plan slot again').toBe(false);
    expect(adoptionCaptures()).toHaveLength(0);
  });

  it('the fire point is nowhere near any of it', () => {
    // It lives inside `handleAdopt`, after the response check — not in the
    // counting block, not in an effect, not in a render expression.
    const src = codeOf(SCREEN);
    const seam = ['track', 'ProductEvent'].join('');
    const fire = src.indexOf(`${seam}(`);
    expect(src.indexOf('const countedAdoptions'), 'the capture moved into the counting block')
      .toBeLessThan(fire);
    expect(src.indexOf('const handleUnadopt'), 'the capture is outside handleAdopt')
      .toBeGreaterThan(fire);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 — adoptedCourses is still server-only
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('13 · adoptedCourses is still server-only', () => {
  it('the deployed rule still refuses every client write', () => {
    const rules = read('firestore.rules');
    const block = rules.slice(rules.indexOf('match /adoptedCourses/'));
    expect(block.slice(0, 400)).toContain('allow write: if false');
  });

  it('and the screen attempts none — every mutation goes through the route', () => {
    const src = codeOf(SCREEN);
    expect(src, 'the screen writes the adoption pointer itself').not.toContain('setDoc(');
    expect(src).toContain("authFetch('/api/courses/adopt'");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 — this suite's own hygiene
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('14 · this suite pins no line number, no date and no branch diff', () => {
  const SELF = 'src/components/__tests__/THE-361.course-adopted.test.tsx';

  it('every location here is a path and a token, never a line number', () => {
    // THE-331 pinned AdminCommunity at a line and a deletion elsewhere moved it.
    const src = codeOf(SELF);
    expect(src.match(/\.tsx?:\d+/g)).toBeNull();
  });

  it('no fixture date and no clock', () => {
    const src = codeOf(SELF);
    expect(src).not.toContain(['use', 'Fake', 'Timers'].join(''));
    expect(src).not.toContain(['set', 'System', 'Time'].join(''));
    expect(src.match(/\b20\d{2}-\d{2}-\d{2}\b/g), 'a date literal').toBeNull();
    // ⚠️ ASSEMBLED. Spelled whole, this needle would appear in this very line
    // and the assertion would fail on itself.
    expect(src).not.toContain(['new', ' Date', '('].join(''));
    expect(src).not.toContain(['Date', '.now('].join(''));
  });

  it('no branch-diff guard: nothing here shells out to git', () => {
    // A depth-1 clone has no base revision, and THE-315's sweep scans TRACKED
    // files only — a run before `git add` turned THE-347's CI red.
    const src = codeOf(SELF);
    for (const needle of [
      ['git', ' '].join(''),
      ['exec', 'Sync'].join(''),
      ['spawn', 'Sync'].join(''),
      ['child', '_process'].join(''),
    ]) {
      expect(src, `this suite reaches for "${needle}"`).not.toContain(needle);
    }
  });

  it('no emoji and no colour in anything this ticket wrote as code', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const rel of [EVENTS, SCREEN, SELF]) {
      const src = codeOf(rel);
      expect(emoji.test(src), `${rel} carries an emoji in code`).toBe(false);
    }
    // The vocabulary renders nothing, so it hardcodes no colour either.
    expect(codeOf(EVENTS).match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('every file this suite names exists on disk', () => {
    for (const rel of [SELF, SCREEN, PREVIEW, EVENTS, 'src/lib/analytics/client.ts',
      'src/lib/analytics/routes.ts', 'src/lib/admin-sections.ts']) {
      expect(() => read(rel), `${rel} is gone`).not.toThrow();
    }
  });

  it('the stripper did not eat the screen it reads', () => {
    // Section 0's premise, borrowed from THE-345: line count is preserved
    // exactly, so a stripper that swallowed a region shows up as a shortfall.
    const raw = read(SCREEN);
    expect(stripComments(raw).split('\n')).toHaveLength(raw.split('\n').length);
    // And the file really is full of the word these guards grep around, so
    // stripping is load-bearing rather than a formality.
    const inProse = (raw.match(/adopt/gi) ?? []).length - (codeOf(SCREEN).match(/adopt/gi) ?? []).length;
    expect(inProse, 'AdminCourses.tsx no longer discusses adoption in prose').toBeGreaterThan(10);
  });

  it('LF only, in every file this ticket writes', () => {
    for (const rel of [SELF, SCREEN, EVENTS]) {
      expect(read(rel), `${rel} carries a CRLF`).not.toContain('\r\n');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 15 — the files this ticket must not have touched
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('15 · firestore.rules, the indexes, functions/ and layout.tsx are untouched', () => {
  it.each([
    ['firestore.indexes.json', '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0'],
    ['src/app/layout.tsx', 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f'],
  ])('%s is byte-identical', (file, digest) => {
    expect(sha(file), `${file} changed`).toBe(digest);
  });

  it('firestore.rules is at a digest some ticket recorded', () => {
    // 🔴 The accepted values are read from the shared register, NEVER copied
    // here. THE-325 caught THE-360's first draft spelling the live digest as a
    // literal, because every copy is another edit a legitimate rules change
    // would have to make. THE-361 records no rules digest of its own: this
    // ticket does not touch the file.
    expect(acceptedRulesDigests().map(([digest]) => digest)).toContain(sha('firestore.rules'));
  });

  it('functions/ is byte-identical, whole', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (e.name === 'node_modules' || e.name === 'lib') continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel); else files.push(rel);
      }
    };
    walk('functions');

    const h = createHash('sha256');
    for (const f of files) {
      h.update(f);
      h.update(readFileSync(path.join(ROOT, f)));
    }
    expect(files).toHaveLength(5);
    expect(h.digest('hex')).toBe(
      '4016dc6b342dcbbf44b94994d35d01781c015035205616d4798c142199a1b5bf',
    );
  });

  it('no dependency, token or component was added', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // posthog-js was already installed; this ticket adds nothing to either list.
    expect(pkg.dependencies['posthog-js']).toBeDefined();
    // 🔴 THE-274 pins the lockfile to an exact length, so an added dependency
    // is caught there too. What is asserted here is that the screen grew no new
    // component and no new design token: its only new imports are the two
    // analytics ones.
    const src = codeOf(SCREEN);
    const analyticsImports = src.split('\n')
      .filter((l) => l.trim().startsWith(['im', 'port'].join('')) && l.includes('analytics'));
    expect(analyticsImports).toHaveLength(2);
  });
});
