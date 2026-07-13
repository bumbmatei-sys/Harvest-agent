"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Home, BookOpen, MessageCircle, Map as MapIcon, User, Play, ChevronLeft, ChevronRight, Newspaper, FileText, GraduationCap, MessageSquare, HandHeart, HeartHandshake } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { collection, query, where, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';

import Profile from './Profile';
import PartnerWithUsTab from './PartnerWithUsTab';
import BlogTab from './BlogTab';
import NewsTab from './NewsTab';
import PrayerWall from './PrayerWall';
import AllNews from './AllNews';
import CourseExperience from '../components/CoursePage';
import AIChat from './AIChat';
import UserMessages from './UserMessages';
import ErrorBoundary from './ErrorBoundary';
import BiblePage from './BiblePage';
import ReferralTracker from './ReferralTracker';
import { getPlanFeatures } from '../utils/plan-features';
import { hasPlatformOverride } from '../utils/tenant-scope';
import { useAppStore } from '../store/useAppStore';
import { useTenant } from '../contexts/TenantContext';
import LiveNowBanner from './LiveNowBanner';
import LivestreamView from './LivestreamView';
import { DesktopContainer } from './layout/DesktopLayout';

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';
const DEFAULT_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

// The server (RootLayout) stamps a white-label tenant's logo onto <body> so the
// first client render can use it instead of the Harvest DEFAULT_LOGO — otherwise
// the sidebar logo flashes Harvest until the async branding fetch resolves. Only
// present on white-label hosts; null on apex/platform.
const getServerTenantLogo = (): string | null =>
  typeof document !== 'undefined' ? document.body?.dataset?.tenantLogo || null : null;

// Icons for the former top-tabs, now also surfaced as desktop-only sidebar items (Phase 1.5).
const TOP_TAB_ICONS: Record<string, any> = {
  news: Newspaper,
  blog: FileText,
  courses: GraduationCap,
  messages: MessageSquare,
  prayer: HandHeart,
  partner: HeartHandshake,
};

const ChurchMap = dynamic(() => import('./ChurchMap'), { ssr: false });

interface MainAppProps {
  onNavigate: (page: string) => void;
}

const MainApp: React.FC<MainAppProps> = ({ onNavigate }) => {
  const { tenantPlan, currentUser } = useAppStore();
  const { tenantId, tenantName, branding, tenantPlan: ctxTenantPlan, isLoading: tenantLoading } = useTenant();
  // White-label tenants (any real tenant other than the platform) show their own
  // name + logo; the platform / super-admin view keeps the "Harvest" brand.
  const isWhiteLabel = !!tenantId && tenantId !== PLATFORM_TENANT_ID;
  const displayName = isWhiteLabel && tenantName ? tenantName : 'Harvest';
  // Prefer the client-loaded branding logo once available; before it resolves,
  // fall back to the server-stamped tenant logo (white-label hosts) so the first
  // paint is already tenant-branded, and only then to the Harvest DEFAULT_LOGO.
  const displayLogo = isWhiteLabel && branding?.logo
    ? branding.logo
    : (getServerTenantLogo() || DEFAULT_LOGO);
  // "Ask {ministry}" — the AI assistant is branded with the ministry's short name
  // on the desktop sidebar, the desktop top-bar title, and the AI page hero.
  // Mobile's bottom-tab keeps the short "Chat" label to avoid crowding the 64px
  // tab. Strips a leading "The"; falls back to "Ask Harvest".
  const askBrandName = (() => {
    const base = (isWhiteLabel && tenantName ? tenantName : 'Harvest').trim();
    const words = base.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words[0].toLowerCase() === 'the') return words[1];
    return words[0] || 'Harvest';
  })();
  const askLabel = `Ask ${askBrandName}`;
  const [activeBottomTab, setActiveBottomTab] = useState('home');
  const [activeTopTab, setActiveTopTab] = useState('news');
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [enableSwipe, setEnableSwipe] = useState(false); // tab-swipe gesture: mobile/touch only
  const lastScrollYRef = useRef(0);
  const [direction, setDirection] = useState(0);
  const [fullScreenView, setFullScreenView] = useState<{type: 'none' | 'all-news' | 'article' | 'course' | 'livestream', id?: string, data?: any}>({type: 'none'});

  // The platform tenant (apex/harvest) and super admins get all features.
  // White-label tenants are gated strictly by their plan.
  // Platform context (apex domain, super admin) => all features. On a tenant
  // subdomain everyone is gated by the tenant plan, including super admins.
  const platformOverride = hasPlatformOverride();
  const isMainSite = !isWhiteLabel || platformOverride;

  // Plan readiness. A white-label tenant's plan is loaded async from the tenant
  // doc (TenantContext). We must distinguish "plan still LOADING" from "plan
  // LOADED = no/low plan": `tenantLoading` is false once the tenant doc has been
  // read, EVEN when that read yields no plan — so this becomes ready on apex/no
  // plan too (never an infinite wait). Platform context has no plan to wait on.
  const isPlanReady = isMainSite || !tenantLoading;
  // The store `tenantPlan` is synced from the context plan by an effect in App.tsx,
  // so it can lag the authoritative context value by a render on first mount.
  // Fall back to the context plan so gating never depends solely on that lagging
  // sync — otherwise legit higher-tier features (Map, AI chat) flash hidden until
  // the store catches up. A resolved null/low plan stays correctly restricted.
  const resolvedPlan = tenantPlan ?? ctxTenantPlan ?? null;
  const features = isMainSite ? null : (resolvedPlan ? getPlanFeatures(resolvedPlan) : null);

  // 'loading' means we haven't fetched yet — hide tab until we know.
  // 'empty' means 0 published courses — hide tab.
  // 'present' means at least 1 course exists — show tab.
  const [coursesStatus, setCoursesStatus] = useState<'loading' | 'empty' | 'present'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tenantId = await getTenantScope();
        // Single-field filter only (status); tenant scoping applied in-memory to avoid a composite index.
        const q = tenantId
          ? query(collection(db, 'courses'), where('tenantId', '==', tenantId), limit(50))
          : query(collection(db, 'courses'), where('status', '==', 'published'), limit(50));
        const snap = await getDocs(q);
        const has = snap.docs.some(d => d.data().status === 'published');
        if (!cancelled) setCoursesStatus(has ? 'present' : 'empty');
      } catch {
        // On error, hide the tab to avoid showing a broken courses screen
        if (!cancelled) setCoursesStatus('empty');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // If courses disappear after being visible, navigate away from the tab
  useEffect(() => {
    if (coursesStatus === 'empty' && activeTopTab === 'courses') {
      setActiveTopTab('news');
    }
  }, [coursesStatus, activeTopTab]);

  const topTabs = [
    { id: 'news', label: 'News' },
    (isMainSite || (isPlanReady && features?.blog === true)) && { id: 'blog', label: 'Blog' },
    // Only include Courses tab once we know at least 1 course exists
    coursesStatus === 'present' && { id: 'courses', label: 'Courses' },
    { id: 'messages', label: 'Messages' },
    { id: 'prayer', label: 'Prayer' },        // all plans, all users
    { id: 'partner', label: 'Give' },
  ].filter(Boolean) as { id: string; label: string }[];

  const bottomTabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'bible', label: 'Bible', icon: BookOpen },
    (isMainSite || (isPlanReady && features?.aiChat === true)) && { id: 'chat', label: 'Chat', icon: MessageCircle },
    (isMainSite || (isPlanReady && features?.map === true)) && { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'profile', label: 'My Profile', icon: User },
  ].filter(Boolean) as { id: string; label: string; icon: any }[];
  // 'home' is always the unconditional first entry above — desktop's grouped
  // sidebar replaces it with the "Home" alias of the News top-tab (see below),
  // so only the rest are looked up by id for the desktop groups.
  const [, ...restBottomTabs] = bottomTabs;

  // Desktop sidebar groups (Phase 1.6) — FEED / COMMUNITY / SUPPORT US. Resolves
  // items from `topTabs` (News/Blog/Courses/Messages/Prayer/Partner) and
  // `restBottomTabs` (Bible/Chat/Map/Profile) by id, dropping any that are
  // conditionally absent (e.g. Courses with 0 published, Chat/Map by plan).
  // Mobile is unaffected — it renders `bottomTabs` flatly, unrelated to this.
  interface DesktopNavItem { id: string; label: string; icon: any; isActive: boolean; onClick: () => void; }

  const desktopTopTabItem = (id: string): DesktopNavItem | null => {
    const tab = topTabs.find(t => t.id === id);
    if (!tab) return null;
    // The News top-tab is the desktop sidebar's "Home" entry point (mobile's
    // "News" label inside the Home top-tabs is untouched).
    const isHome = tab.id === 'news';
    return {
      id: `desktop-${tab.id}`,
      label: isHome ? 'Home' : tab.label,
      icon: isHome ? Home : TOP_TAB_ICONS[tab.id],
      isActive: activeBottomTab === 'home' && activeTopTab === tab.id,
      onClick: () => { setActiveBottomTab('home'); handleTopTabClick(tab.id); },
    };
  };

  const desktopBottomTabItem = (id: string): DesktopNavItem | null => {
    const tab = restBottomTabs.find(t => t.id === id);
    if (!tab) return null;
    return {
      id: `desktop-${tab.id}`,
      // Chat is branded "Ask {ministry}" on desktop; mobile keeps "Chat".
      label: tab.id === 'chat' ? askLabel : tab.label,
      icon: tab.icon,
      isActive: activeBottomTab === tab.id,
      onClick: () => setActiveBottomTab(tab.id),
    };
  };

  const isDesktopNavItem = (item: DesktopNavItem | null): item is DesktopNavItem => item !== null;

  // "My Profile" is intentionally excluded here — on desktop it's reachable via
  // the top-right avatar (see the top bar below) instead of the grouped list.
  const desktopNavGroups: { label: string; items: DesktopNavItem[] }[] = [
    {
      label: 'FEED',
      items: [desktopTopTabItem('news'), desktopTopTabItem('blog'), desktopTopTabItem('courses'), desktopBottomTabItem('bible')].filter(isDesktopNavItem),
    },
    {
      label: 'COMMUNITY',
      items: [desktopTopTabItem('messages'), desktopTopTabItem('prayer'), desktopBottomTabItem('map')].filter(isDesktopNavItem),
    },
    {
      label: 'SUPPORT US',
      items: [desktopTopTabItem('partner'), desktopBottomTabItem('chat')].filter(isDesktopNavItem),
    },
  ];

  // Desktop top bar (Phase 1.6): page title + date for Home; view name elsewhere.
  const desktopTitle = activeBottomTab === 'home'
    ? (activeTopTab === 'news' ? 'Home' : (topTabs.find(t => t.id === activeTopTab)?.label ?? 'Home'))
    : (activeBottomTab === 'chat' ? askLabel : (bottomTabs.find(t => t.id === activeBottomTab)?.label ?? ''));
  const showDesktopDate = activeBottomTab === 'home' && activeTopTab === 'news';
  const desktopDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  useEffect(() => {
    setIsNavVisible(true);
  }, [activeBottomTab]);

  // Enable the horizontal tab-swipe gesture on mobile/touch layouts only; on
  // desktop (>=lg) a drag must never switch tabs.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setEnableSwipe(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Deep-link from a QR / Text-to-Give link (`/?giving=1`): jump straight to the
  // giving ("Partner with Us") flow, then strip the param so a refresh is clean.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('giving') === '1') {
      setActiveBottomTab('home');
      setActiveTopTab('partner');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const topTabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (topTabsRef.current) {
      const activeTabElement = topTabsRef.current.querySelector(`[data-tab-id="${activeTopTab}"]`);
      if (activeTabElement) {
        activeTabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeTopTab]);

  const handleTopTabClick = useCallback((tabId: string) => {
    const currentIndex = topTabs.findIndex(t => t.id === activeTopTab);
    const nextIndex = topTabs.findIndex(t => t.id === tabId);
    if (currentIndex !== nextIndex) {
      setDirection(nextIndex > currentIndex ? 1 : -1);
      setActiveTopTab(tabId);
    }
  }, [activeTopTab]);

  const handleDragEnd = useCallback((e: any, { offset, velocity }: any) => {
    const swipeDistance = offset.x;
    const swipeVelocity = velocity.x;

    const currentIndex = topTabs.findIndex(t => t.id === activeTopTab);

    if (swipeDistance < -50 || swipeVelocity < -500) {
      // Swipe left -> next tab
      if (currentIndex < topTabs.length - 1) {
        setDirection(1);
        setActiveTopTab(topTabs[currentIndex + 1].id);
      }
    } else if (swipeDistance > 50 || swipeVelocity > 500) {
      // Swipe right -> prev tab
      if (currentIndex > 0) {
        setDirection(-1);
        setActiveTopTab(topTabs[currentIndex - 1].id);
      }
    }
  }, [activeTopTab]);

  const tabVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? '100%' : '-100%',
      opacity: 0,
    }),
  };

  // Open a saved item from the Profile "Saved" section. Blog/lesson reuse the
  // same full-screen views the feed/course tabs open; a saved post drops the
  // user back on the News feed. (Verses render inline in the Saved list.)
  const openSavedBlog = useCallback(async (postId: string) => {
    try {
      const snap = await getDoc(doc(db, 'blog_posts', postId));
      if (snap.exists()) {
        setFullScreenView({ type: 'article', data: { id: snap.id, ...snap.data() } });
      }
    } catch (e) {
      console.error('Failed to open saved article', e);
    }
  }, []);

  const openSavedLesson = useCallback((courseId: string, lessonId: string) => {
    setFullScreenView({ type: 'course', data: { courseId, lessonId } });
  }, []);

  const openSavedPost = useCallback(() => {
    setActiveBottomTab('home');
    setActiveTopTab('news');
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (fullScreenView.type !== 'none') return;
    const currentScrollY = e.currentTarget.scrollTop;
    if (currentScrollY > lastScrollYRef.current && currentScrollY > 50) {
      setIsNavVisible(false);
    } else if (currentScrollY < lastScrollYRef.current) {
      setIsNavVisible(true);
    }
    lastScrollYRef.current = currentScrollY;
  }, [fullScreenView]);

  // Shared nav-button markup for the mobile bottom bar / desktop sidebar (Phase 1.5/1.6).
  // `visibility` controls which breakpoint(s) the button renders at:
  //   - 'both'    default; renders at every breakpoint (unused by current call sites)
  //   - 'mobile'  bottom bar only — every item in `bottomTabs` (Home/Bible/Chat/Map/Profile)
  //   - 'desktop' grouped sidebar only — items resolved into `desktopNavGroups` below
  const renderNavButton = (
    id: string,
    label: string,
    Icon: any,
    isActive: boolean,
    onClick: () => void,
    visibility: 'both' | 'mobile' | 'desktop' = 'both'
  ) => {
    const visibilityClassName =
      visibility === 'mobile' ? 'flex flex-col lg:hidden' :
      visibility === 'desktop' ? 'hidden lg:flex' :
      'flex flex-col';
    return (
      <button
        key={id}
        onClick={onClick}
        className={`${visibilityClassName} items-center justify-center gap-1 rounded-xl transition-all shrink-0 ${
          isSidebarCollapsed
            ? 'lg:w-11 lg:h-11 lg:p-0 w-16 h-12'
            : 'lg:flex-row lg:justify-start lg:gap-3 lg:w-full lg:h-11 lg:px-3 w-16 h-12'
        } ${
          isActive
            ? 'lg:bg-[color-mix(in_srgb,var(--brand-color)_16%,white)]'
            : 'text-gray-400 hover:text-gray-600 lg:text-warm-brown lg:hover:text-earth lg:hover:bg-stone-100'
        }`}
        style={isActive ? { color: 'var(--brand-color, #e6b325)' } : undefined}
        title={isSidebarCollapsed ? label : undefined}
      >
        <Icon
          strokeWidth={isActive ? 2.5 : 2}
          className="w-6 h-6 lg:w-5 lg:h-5 shrink-0"
          style={isActive ? { color: 'var(--brand-color, #e6b325)' } : undefined}
        />
        <span className={`text-[10px] lg:text-[13px] lg:font-medium lg:truncate ${isSidebarCollapsed ? 'lg:hidden block' : 'lg:block block'}`}>
          {label}
        </span>
      </button>
    );
  };

  const renderLoading = () => (
    <div className="flex items-center justify-center h-full w-full min-h-[50vh]">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #e6b325)', borderTopColor: 'transparent' }}></div>
    </div>
  );

  if (fullScreenView.type === 'all-news') {
    return (
      <AllNews
        onBack={() => setFullScreenView({type: 'none'})}
        onOpenMessages={() => { setFullScreenView({type: 'none'}); setActiveBottomTab('home'); setActiveTopTab('messages'); }}
      />
    );
  }

  if (fullScreenView.type === 'article' && fullScreenView.data) {
    return (
      <BlogTab initialPost={fullScreenView.data} onBack={() => setFullScreenView({type: 'none'})} isFullScreen={true} />
    );
  }

  if (fullScreenView.type === 'course' && fullScreenView.data) {
    return (
      <CourseExperience
        initialCourseId={fullScreenView.data.courseId}
        initialLessonId={fullScreenView.data.lessonId}
        onBack={() => setFullScreenView({type: 'none'})}
      />
    );
  }

  if (fullScreenView.type === 'livestream') {
    return (
      <LivestreamView
        tenantId={tenantId}
        onBack={() => setFullScreenView({ type: 'none' })}
        onDonate={() => { setFullScreenView({ type: 'none' }); setActiveBottomTab('home'); setActiveTopTab('partner'); }}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#f8f9fa] lg:bg-[var(--ds-page-bg)] font-sans overflow-hidden transition-colors duration-300">
      <ReferralTracker />
      
      {/* Side/Bottom Navigation */}
      <div className={`bg-white border-t lg:border-t-0 lg:border-r border-gray-100 lg:border-stone-200 flex justify-center lg:justify-start py-2 lg:py-5 px-2 lg:px-3 pb-safe lg:pb-0 fixed lg:relative bottom-0 lg:bottom-auto w-full ${isSidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[224px]'} lg:h-screen z-[100] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] lg:shadow-[2px_0_10px_rgba(0,0,0,0.02)] transition-all duration-300 ${!isNavVisible || activeBottomTab === 'map' ? 'max-lg:translate-y-full' : 'max-lg:translate-y-0'}`}>
        <div className={`flex lg:flex-col justify-around lg:justify-start items-center lg:items-stretch w-full lg:max-w-none lg:gap-2 ${isSidebarCollapsed ? 'lg:items-center' : ''}`}>
          {/* Desktop Logo */}
          <div className={`hidden lg:flex items-center mb-6 shrink-0 ${isSidebarCollapsed ? 'justify-center px-0 w-full' : 'gap-2.5 px-3'}`}>
            <img
              src={displayLogo}
              alt={displayName}
              className="w-9 h-9 object-contain shrink-0"
            />
            {!isSidebarCollapsed && (
              <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-earth truncate">
                {displayName}
                {/* The signature gold period belongs to the "Harvest." lockup only;
                    white-label tenants show their own name without it. */}
                {!isWhiteLabel && <span style={{ color: 'var(--brand-color, #C9963A)' }}>.</span>}
              </span>
            )}
          </div>

          {/* Mobile bottom bar — flat, ungrouped: Home, Bible, Chat, Map, Profile (unchanged) */}
          {bottomTabs.map((tab) =>
            renderNavButton(
              tab.id,
              tab.label,
              tab.icon,
              activeBottomTab === tab.id,
              () => setActiveBottomTab(tab.id),
              'mobile'
            )
          )}

          {/* Desktop sidebar — grouped under FEED / COMMUNITY / SUPPORT US (Phase 1.6) */}
          {desktopNavGroups.map((group, groupIndex) => (
            <div key={group.label} className={`hidden lg:flex lg:flex-col lg:w-full ${groupIndex > 0 ? 'lg:mt-5' : ''}`}>
              {isSidebarCollapsed ? (
                groupIndex > 0 && <div className="lg:mx-3 lg:mb-2 lg:border-t lg:border-gray-100" />
              ) : (
                <div className="lg:px-4 lg:mb-2 lg:text-[10px] lg:font-bold lg:tracking-[0.14em] lg:text-[color:var(--text-faint)] lg:uppercase">
                  {group.label}
                </div>
              )}{/* group */}
              <div className="lg:flex lg:flex-col lg:gap-1 lg:w-full lg:items-stretch">
                {group.items.map((item) =>
                  renderNavButton(item.id, item.label, item.icon, item.isActive, item.onClick, 'desktop')
                )}
              </div>
            </div>
          ))}

          {/* Collapse Button (Bottom) */}
          <div className="hidden lg:flex flex-1 items-end pb-5 mt-auto">
            <button
               onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
               className={`flex items-center gap-3 w-full h-11 rounded-xl transition-all px-3 shrink-0 text-warm-brown hover:text-earth hover:bg-stone-100 ${isSidebarCollapsed ? 'justify-center' : 'justify-start'}`}
               title={isSidebarCollapsed ? "Expand" : "Collapse"}
            >
               {isSidebarCollapsed ? <ChevronRight size={20} strokeWidth={2} /> : <ChevronLeft size={20} strokeWidth={2} />}
               {!isSidebarCollapsed && <span className="text-[13px] font-medium">Collapse</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-screen relative bg-[#f8f9fa] lg:bg-[var(--ds-page-bg)] overflow-hidden min-w-0">
        {/* Desktop top bar: page title + date (hard-left), profile avatar (hard-right) — Phase 1.6/1.7, lg:-only.
            Full-bleed padded row (not the centered content container) so the title hugs the content area's
            left edge and the avatar sits in the far top-right corner, per #104 feedback. */}
        <div className="hidden lg:block bg-white border-b border-stone-200 flex-shrink-0">
          <div className="flex items-center justify-between py-3 px-6 xl:px-8">
            <div>
              <h1 className="font-display text-lg font-normal tracking-[-0.01em] text-earth">{desktopTitle}</h1>
              {showDesktopDate && <p className="text-xs text-[color:var(--text-faint)] mt-0.5">{desktopDate}</p>}
            </div>
            <button
              onClick={() => setActiveBottomTab('profile')}
              className="flex items-center justify-center w-9 h-9 rounded-full overflow-hidden bg-stone-100 text-sm font-bold text-warm-brown shrink-0 hover:opacity-90 transition-opacity"
              title="My Profile"
            >
              {currentUser?.photoURL ? (
                <img src={currentUser.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span>{(currentUser?.displayName?.trim()?.[0] || 'U').toUpperCase()}</span>
              )}
            </button>
          </div>
        </div>

        {/* Top Navigation (only visible when Home is active; mobile only — desktop nav lives in the sidebar) */}
        {activeBottomTab === 'home' && (
          <div className="bg-white pt-3 pb-0 px-4 shadow-sm z-10 flex-shrink-0 transition-colors duration-300 lg:hidden">
            <DesktopContainer>
            <div ref={topTabsRef} className="flex overflow-x-auto gap-6 pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x scroll-smooth w-full">
              {topTabs.map((tab) => (
                <button
                  key={tab.id}
                  data-tab-id={tab.id}
                  onClick={() => handleTopTabClick(tab.id)}
                  className={`whitespace-nowrap pb-3 font-bold text-[13px] transition-colors relative snap-start ${
                    activeTopTab === tab.id ? '' : 'text-gray-500'
                  }`}
                  style={activeTopTab === tab.id ? { color: 'var(--brand-color, #e6b325)' } : undefined}
                >
                  {tab.label}
                  {activeTopTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: 'var(--brand-color, #e6b325)' }} />
                  )}
                </button>
              ))}
            </div>
            </DesktopContainer>
          </div>
        )}

        {/* Main Content Area */}
        <ErrorBoundary>
        <div className={`flex-1 overflow-x-hidden relative ${activeBottomTab === 'map' ? '' : (activeBottomTab === 'chat' || (activeBottomTab === 'home' && activeTopTab === 'messages')) ? 'overflow-hidden pb-[65px] lg:pb-0' : 'overflow-y-auto pb-24 lg:pb-0'}`} onScroll={handleScroll}>
          {activeBottomTab === 'home' ? (
            <DesktopContainer className="h-full">
            <div className="relative w-full h-full">
              <AnimatePresence initial={false} custom={direction} mode="popLayout">
                <motion.div
                  key={activeTopTab}
                  custom={direction}
                  variants={tabVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 }
                  }}
                  drag={enableSwipe ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={{ left: activeTopTab === topTabs[topTabs.length - 1].id ? 0 : 1, right: activeTopTab === topTabs[0].id ? 0 : 1 }}
                  onDragEnd={handleDragEnd}
                  className="absolute w-full h-full p-4 space-y-6 lg:space-y-4"
                >
                  {/* Content based on activeTopTab */}
                  {activeTopTab === 'news' && (
                    <>
                      {/* Live banner is mobile-only — on desktop the right rail's
                          "Live Now" card already surfaces the live stream, so the
                          full-width banner would be redundant. */}
                      <div className="lg:hidden">
                        <LiveNowBanner tenantId={tenantId} onOpen={() => setFullScreenView({ type: 'livestream' })} />
                      </div>
                      <NewsTab
                        tenantId={tenantId}
                        onOpenAllNews={() => setFullScreenView({type: 'all-news'})}
                        onOpenArticle={(post) => setFullScreenView({type: 'article', data: post})}
                        onOpenLivestream={() => setFullScreenView({ type: 'livestream' })}
                        onGoToPartner={() => setActiveTopTab('partner')}
                        onOpenMessages={() => setActiveTopTab('messages')}
                      />
                    </>
                  )}
                  {activeTopTab === 'partner' && (
                    <PartnerWithUsTab />
                  )}
                  {activeTopTab === 'blog' && (
                    <BlogTab onOpenArticle={(post) => setFullScreenView({type: 'article', data: post})} />
                  )}
                  {activeTopTab === 'courses' && (
                    <CourseExperience onOpenCourse={(courseId, lessonId) => setFullScreenView({type: 'course', data: {courseId, lessonId}})} />
                  )}
                  {activeTopTab === 'messages' && (
                    <div className="-m-4 lg:-mx-10 xl:-mx-12 h-full lg:h-[calc(100%+2rem)]">
                      <UserMessages embedded onBack={() => {}} />
                    </div>
                  )}
                  {activeTopTab === 'prayer' && (
                    <PrayerWall />
                  )}
                  {activeTopTab !== 'news' && activeTopTab !== 'partner' && activeTopTab !== 'blog' && activeTopTab !== 'courses' && activeTopTab !== 'messages' && activeTopTab !== 'prayer' && (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                      <p>{topTabs.find(t => t.id === activeTopTab)?.label} content coming soon.</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            </DesktopContainer>
          ) : activeBottomTab === 'profile' ? (
            <div className="w-full">
              <Profile
                onNavigate={onNavigate}
                onGoToPartner={() => { setActiveBottomTab('home'); setActiveTopTab('partner'); }}
                onGoToMap={() => setActiveBottomTab('map')}
                onOpenSavedBlog={openSavedBlog}
                onOpenSavedLesson={openSavedLesson}
                onOpenSavedPost={openSavedPost}
              />
            </div>
          ) : activeBottomTab === 'chat' ? (
             // Wider than the other bottom-tab views so the desktop chat can fit
             // its 280px history rail alongside a readable ~800px message column.
             <div className="w-full h-full">
              <AIChat onBack={() => setActiveBottomTab('home')} />
             </div>
          ) : activeBottomTab === 'map' ? (
             <div className="w-full h-full">
              <ChurchMap 
                onBack={() => setActiveBottomTab('home')} 
                onMapInteraction={(interacting) => setIsNavVisible(!interacting)} 
              />
             </div>
          ) : activeBottomTab === 'bible' ? (
             <div className="w-full h-full">
              <BiblePage />
             </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <p>{bottomTabs.find(t => t.id === activeBottomTab)?.label} section coming soon.</p>
            </div>
          )}
        </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};

export default MainApp;
