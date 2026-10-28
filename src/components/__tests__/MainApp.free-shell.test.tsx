import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import MainApp from '../MainApp';
import { defaultCommunitySettings } from '../../lib/community/settings';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fx = vi.hoisted(() => ({ settings: null as any, member: null as any, user: null as any, error: null as string | null }));
vi.mock('../../lib/community/use-community', () => ({
  useCommunitySettings: () => ({ settings: fx.settings, loading: false, error: fx.error }),
  useCommunityMember: () => ({ member: fx.member, loading: false, error: null, save: vi.fn() }),
}));
vi.mock('../../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: async () => ({ exists: () => false }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'free', currentUser: fx.user }) }));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ({ tenantId: null, tenantName: null, tenantPlan: null, isLoading: false }) }));
vi.mock('../../utils/tenant-scope', () => ({ hasPlatformOverride: () => false }));
vi.mock('../../utils/member-courses', () => ({ hasMemberVisibleCourses: async () => true }));
vi.mock('../../hooks/useMemberPhoto', () => ({ useMemberPhoto: () => ({}), memberInitial: () => 'M' }));
vi.mock('../community/CommunityEntryDialog', () => ({ CommunityEntryDialog: () => <div data-testid="entry" /> }));
const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile')); vi.mock('../PartnerWithUsTab', () => stub('give'));
vi.mock('../BlogTab', () => stub('blog')); vi.mock('../NewsTab', () => stub('news'));
vi.mock('../PrayerWall', () => stub('prayer')); vi.mock('../AllNews', () => stub('all-news'));
vi.mock('../CoursePage', () => stub('courses')); vi.mock('../AIChat', () => stub('chat'));
vi.mock('../UserMessages', () => stub('messages')); vi.mock('../BiblePage', () => stub('bible'));
vi.mock('../ReferralTracker', () => stub('referral')); vi.mock('../LiveNowBanner', () => stub('live'));
vi.mock('../LivestreamView', () => stub('livestream'));
vi.mock('../ErrorBoundary', () => ({ default: ({ children }: any) => children }));
vi.mock('../layout/DesktopLayout', () => ({ DesktopContainer: ({ children }: any) => children }));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="map" /> }));
vi.mock('framer-motion', () => ({ motion: new Proxy({}, { get: () => ({ children, className }: any) => <div className={className}>{children}</div> }), AnimatePresence: ({ children }: any) => children }));


vi.mock('../community/DiscoveryData', () => ({ DiscoverData: () => <div>Discovery</div>, CommunitiesData: () => <div>Your communities</div> }));
vi.mock('../signup-pages/SignupPagesScreen', () => ({ SignupPagesScreen: () => <div>Sign-up pages screen</div> }));
describe('#557 MainApp Free shell', () => {
  it('renders the real desktop and mobile navigation, beginning on Discover', async () => {
    fx.settings = defaultCommunitySettings(); fx.user = { uid: 'u', email: 'owner@example.com' };
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<MainApp onNavigate={() => {}} accountTenantId="free-id" />));
    for (const name of ['Desktop navigation', 'Mobile navigation']) {
      const nav = host.querySelector(`nav[aria-label="${name}"]`)!;
      expect(Array.from(nav.querySelectorAll('button')).map(b => b.getAttribute('aria-label') || b.textContent)).toEqual(['Discover', 'Communities', 'Sign-ups']);
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('Discover');
    }
    await act(async () => root.unmount());
  });
});
