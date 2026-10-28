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
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'ministry', currentUser: fx.user }) }));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ({ tenantId: 't', tenantName: 'Ministry', tenantPlan: 'ministry', isLoading: false }) }));
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

describe('community settings in member navigation', () => {
  it('anchors the real mobile navigation in the shared shell and reserves its space', async () => {
    fx.settings = defaultCommunitySettings(); fx.member = null; fx.user = null; fx.error = null;
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<MainApp onNavigate={() => {}} />));
    const nav = host.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]')!;
    expect(nav).toBeTruthy();
    // THE-555: one original shell owns fixed positioning, inset and translation.
    const navShell = nav.closest<HTMLElement>('.fixed')!;
    expect(navShell).toBeTruthy();
    expect(navShell.classList.contains('bottom-0')).toBe(true);
    expect(navShell.classList.contains('py-2')).toBe(true);
    expect(navShell.classList.contains('pb-[calc(8px+env(safe-area-inset-bottom))]')).toBe(true);
    expect(navShell.classList.contains('max-lg:translate-y-0')).toBe(true);
    expect(nav.closest('[class*="translate-y-"]')).toBe(navShell);
    const header = host.querySelector('[aria-label="Switch community"]')!.parentElement!.parentElement!;
    expect(header.classList.contains('sticky')).toBe(true);
    expect(header.classList.contains('top-0')).toBe(true);
    const feed = host.querySelector('[data-testid="news"]')!;
    const scroller = feed.closest('[class*="overflow-y-auto"]')!;
    expect(scroller.classList.contains('max-lg:pb-[calc(61px+env(safe-area-inset-bottom))]')).toBe(true);
    expect(feed.closest('[class*="max-lg:relative"]')).toBeTruthy();
    await act(async () => root.unmount());
  });
  it('keeps the shell usable when settings fail', async () => {
    fx.settings = defaultCommunitySettings(); fx.member = null; fx.user = null; fx.error = 'Could not load community settings.';
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<MainApp onNavigate={() => {}} />));
    expect(host.querySelector('[data-testid="news"]')).not.toBeNull();
    await act(async () => root.unmount()); fx.error = null;
  });
  it('hides disabled tabs and redirects an active tab and bottom tab to Home', async () => {
    fx.settings = defaultCommunitySettings(); fx.member = null; fx.user = null;
    const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => root.render(<MainApp onNavigate={() => {}} />));
    await act(async () => { (host.querySelector('[data-tab-id="prayer"]') as HTMLElement).click(); });
    expect(host.querySelector('[data-testid="prayer"]')).not.toBeNull();
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Bible')!.click(); });
    expect(host.querySelector('[data-testid="bible"]')).not.toBeNull();
    fx.settings = { ...fx.settings, modules: { ...fx.settings.modules, prayer: false, bible: false, map: false, messages: false } };
    await act(async () => root.render(<MainApp onNavigate={() => {}} />));
    expect(host.querySelector('[data-tab-id="prayer"]')).toBeNull(); expect(host.querySelector('[data-tab-id="messages"]')).toBeNull();
    expect(host.querySelector('[data-testid="prayer"]')).toBeNull(); expect(host.querySelector('[data-testid="bible"]')).toBeNull(); expect(host.querySelector('[data-testid="news"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Messages')).toBe(false);
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Bible')).toBe(false);
    await act(async () => root.unmount()); host.remove();
  });
  it('requires entry for members and bypasses it for an admin preview', async () => {
    fx.settings = defaultCommunitySettings(); fx.settings.rules = { enabled: true, items: ['Be kind'], version: 2 }; fx.member = { rulesAcceptedVersion: 1 }; fx.user = { uid: 'u' };
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<MainApp onNavigate={() => {}} />));
    expect(host.querySelector('[data-testid="entry"]')).not.toBeNull(); expect(host.querySelector('[data-testid="news"]')).toBeNull();
    await act(async () => root.render(<MainApp onNavigate={() => {}} isAdminPreview />));
    expect(host.querySelector('[data-testid="entry"]')).toBeNull(); expect(host.querySelector('[data-testid="news"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
