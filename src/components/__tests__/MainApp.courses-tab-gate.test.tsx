import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';

/**
 * THE-140, second half — the Courses TAB, not just the list inside it.
 *
 * The tab is conditional: MainApp renders it only when it believes the church
 * has at least one course. That belief came from its OWN read of /courses,
 * which knew nothing about tenants/{t}/adoptedCourses. A church whose only
 * content was an adopted library course therefore lost the tab entirely — so
 * fixing the list alone would have changed nothing a member could see: a
 * correct list behind a tab that is never rendered.
 *
 * Firestore is mocked at the driver level so the gate runs the real
 * utils/member-courses path, including the adoptedCourses read it used to skip.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

const data = vi.hoisted(() => ({
  courses: [] as any[],
  libraryCourses: [] as any[],
  adopted: [] as any[],
}));

function rowsFor(path: string): any[] {
  if (path === 'courses') return data.courses;
  if (path === 'libraryCourses') return data.libraryCourses;
  if (path.includes('adoptedCourses')) return data.adopted;
  return [];
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: () => ({}),
  limit: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async (ref: any) => {
    const rows = rowsFor(ref?.__path ?? '');
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
  },
}));

// The tab STRIP is what these tests read. Every screen the strip can open is
// stubbed — none of them is under test, and each drags in its own Firestore
// listeners, media queries and network calls.
const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../PartnerWithUsTab', () => stub('partner'));
vi.mock('../BlogTab', () => stub('blog'));
vi.mock('../NewsTab', () => stub('news'));
vi.mock('../PrayerWall', () => stub('prayer'));
vi.mock('../AllNews', () => stub('all-news'));
vi.mock('../../components/CoursePage', () => stub('courses'));
vi.mock('../AIChat', () => stub('chat'));
vi.mock('../UserMessages', () => stub('messages'));
vi.mock('../BiblePage', () => stub('bible'));
vi.mock('../ReferralTracker', () => stub('referral'));
vi.mock('../LiveNowBanner', () => stub('live-banner'));
vi.mock('../LivestreamView', () => stub('livestream'));
vi.mock('../ChurchMap', () => stub('map'));
vi.mock('../ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../layout/DesktopLayout', () => ({
  DesktopContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="dynamic" /> }));

vi.mock('framer-motion', () => {
  const passthrough = new Proxy(
    {},
    { get: () => ({ children, ...rest }: any) => <div {...{ className: rest.className }}>{children}</div> },
  );
  return { motion: passthrough, AnimatePresence: ({ children }: any) => <>{children}</> };
});

const store = vi.hoisted(() => ({ tenantPlan: 'plus' as string | null, currentUser: null as any }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store }));

const tenant = vi.hoisted(() => ({
  tenantId: 'tenant-1',
  tenantName: 'Grace Chapel',
  branding: null as any,
  tenantPlan: 'plus' as string | null,
  isLoading: false,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** The Courses entry in the mobile top-tab strip, or null when it is absent. */
function coursesTab(): Element | null {
  return container.querySelector('[data-tab-id="courses"]');
}

const libraryCourse = (over: Record<string, unknown> = {}) => ({
  id: 'lib-1', title: 'Foundations of Prayer', status: 'published',
  featured: false, description: '', category: 'Discipleship', thumbnail: '',
  authorIds: [], levels: [], createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

const adoptionRecord = (over: Record<string, unknown> = {}) => ({
  id: 'lib-1', libraryCourseId: 'lib-1',
  adoptedAt: '2026-01-03T00:00:00.000Z', adoptedBy: 'admin-uid', ...over,
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  data.courses = [];
  data.libraryCourses = [];
  data.adopted = [];
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('THE-140 — the Courses tab gate counts adopted courses', () => {
  it('a tenant with only an adopted course still shows the Courses tab', async () => {
    data.courses = [];
    data.libraryCourses = [libraryCourse()];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(coursesTab()).not.toBeNull();
  });

  it('a tenant with no courses of either kind still hides the tab', async () => {
    await mount();

    expect(coursesTab()).toBeNull();
    // The other top tabs are unaffected — the strip rendered, it simply has no
    // Courses entry.
    expect(container.querySelector('[data-tab-id="prayer"]')).not.toBeNull();
  });

  it("a tenant with only its own published course still shows the tab", async () => {
    data.courses = [{
      id: 'own-1', title: 'Membership Class', status: 'published', tenantId: 'tenant-1',
      featured: false, description: '', category: 'Faith', thumbnail: '',
      authorIds: [], levels: [], createdAt: '2026-01-02T00:00:00.000Z',
    }];

    await mount();

    expect(coursesTab()).not.toBeNull();
  });

  it('an adoption pointing at an unpublished library course does not show the tab', async () => {
    // The gate must agree with the list: the list drops it (course-adoption's
    // isPubliclyVisible), so a tab here would open onto "No Courses Available".
    data.libraryCourses = [libraryCourse({ status: 'draft' })];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(coursesTab()).toBeNull();
  });
});
