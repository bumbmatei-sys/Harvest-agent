import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-347 - a Firestore Timestamp reached React and `/admin/blog` went down.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The crash, and the exact expression that caused it ──────────────────────
 *
 * The founder, on a phone: "Minified React error #31 - object with keys
 * {seconds...". #31 is "Objects are not valid as a React child", and
 * `{seconds, nanoseconds}` is a Firestore Timestamp. The expression was
 * `{formatDate(post.createdAt)}`, rendered from BOTH the phone card list and
 * the desktop table, and `formatDate` was this:
 *
 *     const formatDate = (dateString: string) => {
 *       try {
 *         const date = new Date(dateString);
 *         return new Intl.DateTimeFormat('en-US', {...}).format(date);
 *       } catch (e) {
 *         return dateString;        // <- THE DEFECT
 *       }
 *     };
 *
 * `new Date(timestampObject)` is an Invalid Date, and
 * `Intl.DateTimeFormat.format(InvalidDate)` THROWS RangeError rather than
 * returning the string "Invalid Date". So the catch fired, and it returned
 * `dateString` - THE INPUT, which was never a string. The Timestamp object went
 * straight into JSX and the error boundary took the whole screen.
 *
 * THE BUG IS THE CATCH, NOT THE PARSE. A default value that hides an error
 * converts a loud failure into a quiet lie; here the lie was loud enough to
 * take the screen with it. Section 1 mounts the real screen with a real
 * Timestamp and is the whole ticket: it FAILS on the code as it was.
 *
 * ── Why this is a mount test and not a unit test on the formatter ───────────
 *
 * The formatter's contract is asserted separately, in
 * `THE-347.date-formatter-guards.test.ts`. What that CANNOT show is that the
 * screen survives - the crash is React refusing a child, which only happens
 * when something actually renders. happy-dom has no layout engine, but this is
 * a RENDER claim and not a layout one, so a mount is the right tool and no
 * measurement is made anywhere in this file.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS PR. THE-331 pinned
 * `AdminCommunity.tsx:491`, a deletion shifted it to `:311`, and the suite
 * measured whatever landed there instead of failing.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A FIXED DATE, DELIBERATELY FAR FROM TODAY. #468 pinned a fixture near the
 * day it was written and turned `main` red for everyone once the day passed;
 * THE-324 left one four days out that would have failed SILENTLY. This is
 * 2024-03-09T16:00:00Z - eighteen months behind this ticket - so it can never
 * drift into "today", and `vi.useFakeTimers({ toFake: ['Date'] })` below pins
 * the clock as well. `toFake` is load-bearing: without it the timers this
 * screen's animations and Firestore mocks rely on are faked too, and nothing
 * ever resolves.
 */
const FIXED_SECONDS = 1710000000;
const FIXED_ISO = '2024-03-09T16:00:00.000Z';
/** Where the clock stands while these tests run. Later than every fixture. */
const NOW = new Date('2025-01-15T12:00:00.000Z');

/** A real Firestore Timestamp: a `{seconds, nanoseconds}` carrier with toMillis. */
const timestamp = (seconds: number) => ({
  seconds,
  nanoseconds: 0,
  toMillis: () => seconds * 1000,
});

/** The wire shape - a Timestamp that has been through JSON and lost its methods. */
const plainTimestamp = (seconds: number) => ({ seconds, nanoseconds: 0 });

const snapshotDocs = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));
const platformOverride = vi.hoisted(() => ({ current: false }));
const automationPayload = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'user-1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  deleteDoc: async () => {},
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    next({ docs: snapshotDocs.current.map((d) => ({ id: d.id as string, data: () => d })) });
    return () => {};
  },
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'grace',
  hasPlatformOverride: () => platformOverride.current,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: null }) }));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async () => ({ ok: true, json: async () => automationPayload.current }),
}));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', DELETE: 'delete' },
  handleFirestoreError: () => {},
}));
/**
 * The EDITOR is stubbed and nothing else is. AdminBlog itself, its formatter,
 * AdminUI's card/badge primitives and `sortByTime` are all REAL - stubbing any
 * of those would leave the claim asserted against the stub, which is how
 * thirteen guards in this series passed a planted defect.
 */
vi.mock('../AdminBlogPostEditor', () => ({ default: () => null }));

import AdminBlog from '../AdminBlog';
import { UNPARSEABLE_DATE } from '../../utils/firestore-date';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => { vi.useRealTimers(); });

beforeEach(() => {
  snapshotDocs.current = [];
  platformOverride.current = false;
  automationPayload.current = {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Mount the real screen. Returns the thrown error rather than throwing. */
async function mount(): Promise<Error | null> {
  let thrown: Error | null = null;
  try {
    await act(async () => { root.render(<AdminBlog />); });
  } catch (e) {
    thrown = e as Error;
  }
  return thrown;
}

const text = () => host.textContent ?? '';

/** A post document, with whatever `createdAt` the caller wants to store. */
const post = (createdAt: unknown, over: Record<string, unknown> = {}) => ({
  id: 'p1',
  title: 'A sermon on Advent',
  category: 'Faith',
  status: 'draft',
  authorId: 'system',
  content: '<p>hi</p>',
  createdAt,
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE CRASH - a Firestore Timestamp on createdAt
// ═════════════════════════════════════════════════════════════════════════════

describe('/admin/blog renders with a post whose createdAt is a Firestore Timestamp', () => {
  it('mounts without React refusing an object as a child', async () => {
    snapshotDocs.current = [post(timestamp(FIXED_SECONDS))];

    const thrown = await mount();

    expect(
      thrown && thrown.message,
      'the screen threw while rendering a post whose createdAt is a Timestamp - ' +
        'this is React error #31, the crash the founder photographed',
    ).toBeFalsy();
    expect(text(), 'the post never rendered at all').toContain('A sermon on Advent');
  });

  it('renders the Timestamp as a formatted date and never as the object', async () => {
    snapshotDocs.current = [post(timestamp(FIXED_SECONDS))];
    await mount();

    expect(text(), 'the Timestamp was not formatted into a readable date')
      .toContain('Mar 9, 2024');
    expect(text(), 'the raw object leaked into the DOM').not.toContain('[object Object]');
    expect(text(), 'the object\'s keys leaked into the DOM').not.toContain('nanoseconds');
  });

  it('survives the wire shape too - a Timestamp with no toMillis method', async () => {
    // A Timestamp that has been through a JSON round trip keeps `seconds` and
    // loses `toMillis`. It is still an object, and React still refuses it.
    snapshotDocs.current = [post(plainTimestamp(FIXED_SECONDS))];

    const thrown = await mount();

    expect(thrown && thrown.message, 'a plain {seconds, nanoseconds} object crashed the screen')
      .toBeFalsy();
    expect(text()).toContain('Mar 9, 2024');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · NO REGRESSION - a string still renders exactly as it did
// ═════════════════════════════════════════════════════════════════════════════

describe('/admin/blog renders with a post whose createdAt is a string', () => {
  it('formats an ISO string to the same day-precision date as before', async () => {
    snapshotDocs.current = [post(FIXED_ISO)];

    const thrown = await mount();

    expect(thrown, 'the string case regressed').toBeNull();
    expect(text(), 'the ISO string stopped formatting').toContain('Mar 9, 2024');
    expect(text()).toContain('A sermon on Advent');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE THIRD CASE NOBODY TESTS - missing, null, and junk
// ═════════════════════════════════════════════════════════════════════════════

describe('/admin/blog renders with createdAt missing or null', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['missing entirely', {}],
    ['null', { createdAt: null }],
    ['undefined', { createdAt: undefined }],
    ['an empty string', { createdAt: '' }],
    ['an unparseable string', { createdAt: 'not a date at all' }],
    ['an empty object', { createdAt: {} }],
  ];

  for (const [label, over] of cases) {
    it(`mounts and shows a visible placeholder when createdAt is ${label}`, async () => {
      const doc: Record<string, unknown> = {
        id: 'p1', title: 'A sermon on Advent', category: 'Faith',
        status: 'draft', authorId: 'system', content: '', ...over,
      };
      snapshotDocs.current = [doc];

      const thrown = await mount();

      expect(thrown && thrown.message, `createdAt ${label} crashed the screen`).toBeFalsy();
      expect(text(), 'the row did not render').toContain('A sermon on Advent');
      expect(
        text(),
        `createdAt ${label} rendered nothing visible - a reader cannot tell a ` +
          'missing date from a broken one, which is the same silent failure one layer along',
      ).toContain(UNPARSEABLE_DATE);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 · A FAILED PARSE SURFACES VISIBLY, NEVER AS THE RAW VALUE
// ═════════════════════════════════════════════════════════════════════════════

describe('a failed parse surfaces visibly, never as the raw value', () => {
  it('shows the placeholder and none of the value it could not read', async () => {
    snapshotDocs.current = [post({ seconds: 'banana', nanoseconds: 'split' })];

    const thrown = await mount();

    expect(thrown, 'an unreadable date object crashed the screen').toBeNull();
    expect(text(), 'the failure is invisible').toContain(UNPARSEABLE_DATE);
    expect(text(), 'the raw value leaked into the DOM').not.toContain('banana');
    expect(text(), 'the raw value leaked into the DOM').not.toContain('[object Object]');
  });

  it('the placeholder is a visible character, not an empty string', () => {
    expect(UNPARSEABLE_DATE.trim().length, 'the placeholder renders as nothing')
      .toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · NO REGRESSION - the list still sorts newest first
// ═════════════════════════════════════════════════════════════════════════════

describe('the post list still sorts newest first', () => {
  /** Titles in the order they appear in the rendered DOM. */
  const renderedOrder = (titles: string[]) => {
    const body = text();
    return [...titles].sort((a, b) => body.indexOf(a) - body.indexOf(b));
  };

  it('orders newest first when every createdAt is a string', async () => {
    snapshotDocs.current = [
      { ...post('2024-01-01T00:00:00.000Z'), id: 'a', title: 'Oldest post' },
      { ...post('2024-06-01T00:00:00.000Z'), id: 'b', title: 'Newest post' },
      { ...post('2024-03-01T00:00:00.000Z'), id: 'c', title: 'Middle post' },
    ];
    await mount();

    expect(renderedOrder(['Oldest post', 'Newest post', 'Middle post']))
      .toEqual(['Newest post', 'Middle post', 'Oldest post']);
  });

  it('orders newest first when createdAt is MIXED - Timestamps and strings together', async () => {
    // This is the sort `sortByTime`/`tsMillis` already handled, and it must keep
    // handling it: the collection genuinely holds both representations today.
    snapshotDocs.current = [
      { ...post('2024-01-01T00:00:00.000Z'), id: 'a', title: 'Oldest post' },
      { ...post(timestamp(Date.parse('2024-06-01T00:00:00.000Z') / 1000)), id: 'b', title: 'Newest post' },
      { ...post(plainTimestamp(Date.parse('2024-03-01T00:00:00.000Z') / 1000)), id: 'c', title: 'Middle post' },
    ];
    await mount();

    expect(
      renderedOrder(['Oldest post', 'Newest post', 'Middle post']),
      'a mixed-representation list stopped sorting newest first',
    ).toEqual(['Newest post', 'Middle post', 'Oldest post']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 · NO REGRESSION - the automation panel still renders
// ═════════════════════════════════════════════════════════════════════════════

describe('the automation panel still renders', () => {
  /** Open the panel through the real Automate control, not by setting state. */
  async function openAutomation() {
    const button = [...host.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes('Automate'),
    );
    expect(button, 'the Automate control is missing').toBeTruthy();
    await act(async () => { button!.click(); });
  }

  beforeEach(() => {
    platformOverride.current = true;
    automationPayload.current = {
      enabled: true, frequency: 'weekly', dayOfWeek: 1, hour: 8,
      timezone: 'Europe/Bucharest', topicHint: 'discipleship',
      totalGenerated: 4, nextScheduledAt: '2025-02-01T08:00:00.000Z',
      consecutiveFailures: 0, lastFailureMessage: null, automationDisabledReason: null,
    };
    snapshotDocs.current = [post(timestamp(FIXED_SECONDS))];
  });

  it('shows the hour select, the timezone, the topic hint, the stats and both buttons', async () => {
    await mount();
    await openAutomation();

    const body = text();
    // The hour select, found by the SHAPE of its own options rather than by
    // document order - this screen also renders a category filter <select>, and
    // `querySelector('select')` returned that one.
    const select = [...host.querySelectorAll('select')].find((el) =>
      [...el.querySelectorAll('option')].every((o) => /^\d{2}:00$/.test((o.textContent ?? '').trim())),
    );
    expect(select, 'the hour select is gone').toBeTruthy();
    expect(select!.querySelectorAll('option'), 'the hour select lost its 24 hours').toHaveLength(24);
    expect(select!.value, 'the saved hour did not load').toBe('8');

    expect(body, 'the detected timezone is not shown').toContain('Europe/Bucharest');

    const topic = [...host.querySelectorAll('input')].find(
      (i) => (i as HTMLInputElement).value === 'discipleship',
    );
    expect(topic, 'the topic hint input lost its saved value').toBeTruthy();

    expect(body, 'the generated-articles stat is gone').toContain('4 articles generated');

    const labels = [...host.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.some((l) => l.includes('Generate Now')), 'the Generate Now button is gone').toBe(true);
    expect(labels.some((l) => l.includes('Save Settings')), 'the Save Settings button is gone').toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 · NO REGRESSION - nextScheduledAt is still guarded and still a string
// ═════════════════════════════════════════════════════════════════════════════

describe('nextScheduledAt is still guarded and still renders a string', () => {
  beforeEach(() => {
    platformOverride.current = true;
    snapshotDocs.current = [post(FIXED_ISO)];
  });

  async function openPanel() {
    await mount();
    const button = [...host.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes('Automate'),
    );
    await act(async () => { button!.click(); });
  }

  it('renders the next date when it parses', async () => {
    automationPayload.current = {
      totalGenerated: 2, nextScheduledAt: '2025-02-01T08:00:00.000Z', timezone: 'UTC',
    };
    await openPanel();
    expect(text(), 'a parseable nextScheduledAt stopped rendering').toContain('Next:');
  });

  it('renders NOTHING for an unparseable next date, and does not crash', async () => {
    automationPayload.current = {
      totalGenerated: 2, nextScheduledAt: 'not a date', timezone: 'UTC',
    };
    await openPanel();
    expect(text(), 'the isNaN guard on nextScheduledAt stopped working').not.toContain('Next:');
    expect(text(), 'the stats row itself disappeared').toContain('2 articles generated');
  });

  it('renders nothing, and does not crash, when nextScheduledAt is a Timestamp object', async () => {
    automationPayload.current = {
      totalGenerated: 2, nextScheduledAt: plainTimestamp(FIXED_SECONDS), timezone: 'UTC',
    };
    const thrown = await mount().then(async (t) => {
      if (t) return t;
      const button = [...host.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').includes('Automate'),
      );
      await act(async () => { button!.click(); });
      return null;
    });
    expect(thrown, 'a Timestamp on nextScheduledAt crashed the panel').toBeNull();
    expect(text(), 'the object leaked out of the nextScheduledAt guard')
      .not.toContain('[object Object]');
  });
});
