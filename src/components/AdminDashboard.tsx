"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, Church, FileText, Rss, BrainCircuit, Inbox, GraduationCap, ChevronLeft, ChevronRight, Building2, Settings, MoreHorizontal, Mail, SlidersHorizontal, Heart, Users, MessageSquare, Receipt, CalendarCheck, ShieldCheck, ClipboardList, QrCode, Radio, ExternalLink, Link2 } from 'lucide-react';
import AdminBlog from './AdminBlog';
import AdminPosts from './AdminPosts';
import AdminInbox from './AdminInbox';
import AdminChurches from './AdminChurches';
import AdminCourses from './AdminCourses';
import AdminRAG from './AdminRAG';
import AdminTenants from './AdminTenants';
import AdminSettings from './AdminSettings';
import AffiliateSection from './AffiliateSection';
import NewsletterEditor from './NewsletterEditor';
import NewsletterCampaigns from './NewsletterCampaigns';
import CanvasList from './CanvasList';
import CanvasEditor from './CanvasEditor';
import AnalyticsAndRoles, { Permission } from './AnalyticsAndRoles';
import AdminNavCustomizer from './AdminNavCustomizer';
import FocusScreen from './FocusScreen';
import AdminFundraising from './AdminFundraising';
import AdminCRM from './AdminCRM';
import AdminDocs from './AdminDocs';
import AdminCommunity from './AdminCommunity';
import AdminAccounting from './AdminAccounting';
import AdminForms from './AdminForms';
import AdminCheckin from './AdminCheckin';
import AdminLivestream from './AdminLivestream';
import AdminSms from './AdminSms';
import AdminEvents from './AdminEvents';
import PlanUpgradeScreen from './PlanUpgradeScreen';
import { AdminScreenHeader, AdminHeaderContext, AdminHeaderOverride } from './AdminScreenHeader';
import { getPlanFeatures } from '../utils/plan-features';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { isSuperAdmin as checkIsSuperAdmin, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useAppStore } from '../store/useAppStore';
import { useCurrentUser } from '../hooks/queries/useUserQueries';
import { useTenant as useTenantDoc } from '../hooks/queries/useTenantQueries';

// URL slug ↔ internal tab id. Most ids map 1:1; only these two differ so the
// URLs read nicely (/admin/ai-knowledge, /admin/roles).
const SLUG_TO_TAB: Record<string, string> = { 'ai-knowledge': 'ai', 'roles': 'admin_roles' };
const TAB_TO_SLUG: Record<string, string> = { 'ai': 'ai-knowledge', 'admin_roles': 'roles' };

interface AdminDashboardProps {
  onNavigate: (page: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const { tenantPlan, currentTenantId, isAuthReady } = useAppStore();
  const navigate = useNavigate();
  const { section, itemId } = useParams();
  const activeTab = section ? (SLUG_TO_TAB[section] || section) : 'dashboard';

  // Tenant and user data from React Query
  const tenantId = currentTenantId;
  const { data: tenantData } = useTenantDoc(tenantId);
  const tenantName = tenantData?.name ?? tenantData?.config?.name ?? 'Ministry';
  const { data: userData, isLoading: userLoading } = useCurrentUser(auth.currentUser?.uid);

  const userRole = userData?.role ?? 'user';
  const userPermissions: Permission | null = (userData?.permissions as Permission) ?? null;

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingChurchesCount, setPendingChurchesCount] = useState(0);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [canvasName, setCanvasName] = useState<string>('');
  const [newsletterView, setNewsletterView] = useState<'list' | 'editor'>('list');
  // Nav customizer state
  const [showNavCustomizer, setShowNavCustomizer] = useState(false);
  // Ordered IDs for the bottom bar; null means use default (first 4 from allTabs)
  const [customPrimaryIds, setCustomPrimaryIds] = useState<string[] | null>(null);
  // Independent ordered IDs for the More drawer; null means default (allTabs order)
  const [customMoreIds, setCustomMoreIds] = useState<string[] | null>(null);
  // Primary action published by the active screen into the shared header.
  const [headerAction, setHeaderAction] = useState<React.ReactNode>(null);
  // Full header override published by a sub-view (e.g. an open chat thread).
  const [headerOverride, setHeaderOverride] = useState<AdminHeaderOverride | null>(null);
  const headerApi = React.useMemo(() => ({ setHeaderAction, setHeaderOverride }), []);

  // Restore saved nav configuration from user data
  const navInitialized = useRef(false);
  useEffect(() => {
    if (!navInitialized.current && userData) {
      navInitialized.current = true;
      if (userData.adminNavConfig?.primaryTabIds?.length) {
        setCustomPrimaryIds(userData.adminNavConfig.primaryTabIds);
      }
      if (userData.adminNavConfig?.moreTabIds?.length) {
        setCustomMoreIds(userData.adminNavConfig.moreTabIds);
      }
    }
  }, [userData]);

  /** Navigate to a tab by internal id (resets transient sub-views). */
  const go = useCallback((id: string) => {
    setShowMoreSheet(false);
    setNewsletterView('list');
    navigate(id === 'dashboard' ? '/admin' : `/admin/${TAB_TO_SLUG[id] || id}`);
  }, [navigate]);

  /** Back arrow: go where the user came from, or fall back to the dashboard. */
  const smartBack = useCallback(() => {
    const idx = (typeof window !== 'undefined' && (window.history.state as any)?.idx) || 0;
    if (idx > 0) navigate(-1);
    else navigate('/admin', { replace: true });
  }, [navigate]);

  /** Clear the :itemId deep-link param once a screen has consumed it. */
  const clearItemId = useCallback(() => {
    navigate(`/admin/${TAB_TO_SLUG[activeTab] || activeTab}`, { replace: true });
  }, [navigate, activeTab]);


  useEffect(() => {
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    let cancelled = false;

    const loadCounts = async () => {
    const tenantId = await getTenantScope();
    if (cancelled) return;
    // Single-field filter only (status); tenant scoping applied in-memory to avoid a composite index.
    const q = query(collection(db, 'submissions'), where('status', '==', 'pending'), limit(300));
    unsub1 = onSnapshot(q, (snapshot) => {
      const docs = tenantId ? snapshot.docs.filter(d => d.data().tenantId === tenantId) : snapshot.docs;
      setUnreadCount(docs.length);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.GET, `submissions`); } catch (e) { console.error(e); }
    });

    const qChurches = query(collection(db, 'churches'), where('status', '==', 'pending'), limit(300));
    unsub2 = onSnapshot(qChurches, (snapshot) => {
      const docs = tenantId ? snapshot.docs.filter(d => d.data().tenantId === tenantId) : snapshot.docs;
      setPendingChurchesCount(docs.length);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.GET, `churches`); } catch (e) { console.error(e); }
    });
    };

    loadCounts();

    return () => {
      cancelled = true;
      if (unsub1) unsub1();
      if (unsub2) unsub2();
    };
  }, []);

  const isSuperAdmin = userRole === 'super_admin' || checkIsSuperAdmin();
  const isChurchAdmin = userRole === 'church_admin';
  const perms = userPermissions ?? {} as Permission;
  const features = tenantPlan ? getPlanFeatures(tenantPlan) : null;
  const isTenantAdmin = !!tenantPlan;
  const hasFullAccess = isSuperAdmin || isChurchAdmin || perms.fullAccess;
  const isLoading = !isAuthReady || userLoading;

  const showInbox = hasFullAccess || perms.seeFormsInbox;

  // All available tabs (permission-filtered)
  const allTabs = [
    // Dashboard is always visible — placeholder/welcome screen (analytics moved to CRM)
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    (hasFullAccess || perms.modifyChurches) && { id: 'churches', label: isTenantAdmin && features && features.maxChurches === 1 ? 'Church' : 'Church List', icon: Church },
    (isSuperAdmin || !isTenantAdmin || (features && features.blog)) && (hasFullAccess || perms.createCourses) && { id: 'courses', label: 'Courses', icon: GraduationCap },
    (isSuperAdmin || !isTenantAdmin || (features && features.blog)) && (hasFullAccess || perms.writeArticles) && { id: 'blog', label: 'Blog', icon: FileText },
    (hasFullAccess || perms.createPosts) && { id: 'posts', label: 'Posts', icon: Rss },
    (isSuperAdmin || !isTenantAdmin || (features && features.aiKnowledge)) && (hasFullAccess || perms.uploadRag) && { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
    // Newsletter tab — gated behind plan feature
    (isSuperAdmin || !isTenantAdmin || (features && features.newsletterAutomation)) &&
      (hasFullAccess || perms.createPosts) &&
      { id: 'newsletter', label: 'Newsletter', icon: Mail },
    // Fundraising campaigns
    (isSuperAdmin || !isTenantAdmin || (features && features.fundraising)) &&
      hasFullAccess &&
      { id: 'fundraising', label: 'Fundraising', icon: Heart },
    // Event registration (Pretix)
    (isSuperAdmin || !isTenantAdmin || (features && features.eventRegistration)) &&
      hasFullAccess &&
      { id: 'events', label: 'Events', icon: CalendarCheck },
    // Docs (TipTap)
    (isSuperAdmin || !isTenantAdmin || (features && features.docs)) &&
      hasFullAccess &&
      { id: 'docs', label: 'Notes', icon: FileText },
    // CRM (includes user registration analytics as a sub-tab)
    (isSuperAdmin || !isTenantAdmin || (features && features.crm)) &&
      hasFullAccess &&
      { id: 'crm', label: 'CRM', icon: Users },
    // Accounting (Crater)
    (isSuperAdmin || !isTenantAdmin || (features && features.accountingTools)) &&
      hasFullAccess &&
      { id: 'accounting', label: 'Accounting', icon: Receipt },
    // Custom Forms → CRM pipeline
    (isSuperAdmin || !isTenantAdmin || (features && features.customForms)) &&
      hasFullAccess &&
      { id: 'forms', label: 'Forms', icon: ClipboardList },
    // Check-In System (QR attendance)
    (isSuperAdmin || !isTenantAdmin || (features && features.checkInSystem)) &&
      hasFullAccess &&
      { id: 'checkin', label: 'Check-In', icon: QrCode },
    // Livestream (YouTube + live giving)
    (isSuperAdmin || !isTenantAdmin || (features && features.livestream)) &&
      hasFullAccess &&
      { id: 'livestream', label: 'Livestream', icon: Radio },
    // SMS Automation (Twilio)
    (isSuperAdmin || !isTenantAdmin || (features && features.smsAutomation)) &&
      hasFullAccess &&
      { id: 'sms', label: 'SMS', icon: MessageSquare },
    // Community (Rocket.Chat)
    (isSuperAdmin || !isTenantAdmin || (features && features.communityGroups)) &&
      hasFullAccess &&
      { id: 'community', label: 'Community', icon: MessageSquare },
    isSuperAdmin && { id: 'tenants', label: 'Tenants', icon: Building2 },
    // Admin Roles — placed last so it falls into the mobile "More" drawer by default
    (isSuperAdmin || hasFullAccess || perms.manageAdmins) && { id: 'admin_roles', label: 'Admin Roles', icon: ShieldCheck },
    // Affiliate — standalone section (near the bottom, above Settings)
    (isSuperAdmin || hasFullAccess) && { id: 'affiliate', label: 'Affiliate', icon: Link2 },
  ].filter(Boolean) as { id: string; label: string; icon: any }[];

  // Mobile: 4 tabs in the bottom bar. If the admin has saved a custom order,
  // use it (filtered to still-permitted tabs). Otherwise default to first 4.
  // The More drawer keeps its OWN independent saved order (customMoreIds).
  let primaryTabs;
  let drawerTabs; // reorderable drawer tabs (excludes the fixed Inbox/Settings)
  if (customPrimaryIds && customPrimaryIds.length > 0) {
    const orderedBar = customPrimaryIds
      .map((id) => allTabs.find((t) => t.id === id))
      .filter(Boolean)
      .slice(0, 4) as typeof allTabs;
    const barSet = new Set(orderedBar.map((t) => t.id));
    primaryTabs = orderedBar;
    drawerTabs = allTabs.filter((t) => !barSet.has(t.id));
  } else {
    primaryTabs = allTabs.slice(0, 4);
    drawerTabs = allTabs.slice(4);
  }

  // Apply the saved More-drawer order on top of the permitted drawer tabs.
  if (customMoreIds && customMoreIds.length > 0) {
    const drawerSet = new Set(drawerTabs.map((t) => t.id));
    const ordered = customMoreIds
      .filter((id) => drawerSet.has(id))
      .map((id) => drawerTabs.find((t) => t.id === id)!)
      .filter(Boolean);
    const orderedSet = new Set(ordered.map((t) => t.id));
    // Append any newly-permitted tabs not yet in the saved order.
    drawerTabs = [...ordered, ...drawerTabs.filter((t) => !orderedSet.has(t.id))];
  }

  const moreTabs = [
    ...drawerTabs,
    ...(showInbox ? [{ id: 'inbox', label: 'Inbox', icon: Inbox }] : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // If the active tab is not in the allowed tabs, switch to the first allowed tab
  const allTabIds = allTabs.map(t => t.id).join(',');
  useEffect(() => {
    const known = new Set([...allTabs.map(t => t.id), 'inbox', 'settings', 'canvas']);
    if (!isLoading && allTabs.length > 0 && !known.has(activeTab)) {
      go(allTabs[0].id);
    }
  }, [isLoading, allTabIds, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Header title for the active screen (Dashboard, CRM, Community Chat, …).
  const TITLE_OVERRIDES: Record<string, string> = {
    dashboard: 'Dashboard',
    community: 'Community Chat',
    ai: 'AI Knowledge',
    inbox: 'Inbox',
    settings: 'Settings',
    canvas: canvasName || 'Canvas',
  };
  const headerTitle = TITLE_OVERRIDES[activeTab]
    || allTabs.find(t => t.id === activeTab)?.label
    || 'Dashboard';

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen bg-[#f8f9fa]"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }}></div></div>;
  }

  return (
    <AdminHeaderContext.Provider value={headerApi}>
    <div className="flex flex-col lg:flex-row h-[100dvh] bg-[#f8f9fa] font-sans overflow-hidden transition-colors duration-300">

      {/* Side/Bottom Navigation */}
      <div className={`bg-white border-t lg:border-t-0 lg:border-r border-gray-100 flex justify-center lg:justify-start py-2 lg:py-6 px-2 lg:px-4 pb-safe lg:pb-0 fixed lg:relative bottom-0 lg:bottom-auto w-full ${isSidebarCollapsed ? 'lg:w-[88px]' : 'lg:w-64'} lg:h-screen z-[100] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] lg:shadow-[2px_0_10px_rgba(0,0,0,0.02)] transition-all duration-300`}>
        <div className={`flex lg:flex-col justify-around lg:justify-start items-center lg:items-stretch w-full lg:max-w-none lg:gap-2 ${isSidebarCollapsed ? 'lg:items-center' : ''}`}>
          {/* Desktop Logo */}
          <button
            onClick={() => onNavigate('home')}
            className={`hidden lg:flex items-center mb-8 shrink-0 text-left hover:opacity-80 transition-opacity ${isSidebarCollapsed ? 'justify-center px-0 w-full' : 'gap-3 px-4'}`}
          >
            <img
              src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png"
              alt="Admin"
              className="w-10 h-10 object-contain shrink-0"
            />
            {!isSidebarCollapsed && <span className="text-xl font-bold text-gray-900 truncate">Admin</span>}
          </button>

          {/* Mobile: primary tabs + More button */}
          <div className="flex lg:hidden justify-around items-center w-full">
            {primaryTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => go(tab.id)}
                  className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all relative ${
                    isActive ? '' : 'text-gray-400'
                  }`}
                  style={isActive ? { color: 'var(--brand-color, #d4a017)' } : undefined}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                  {tab.id === 'churches' && pendingChurchesCount > 0 && (
                    <span className="absolute top-1 right-2 bg-red-500 rounded-full border-2 border-white w-3 h-3"></span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => setShowMoreSheet(!showMoreSheet)}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all ${
                showMoreSheet ? '' : 'text-gray-400'
              }`}
              style={showMoreSheet ? { color: 'var(--brand-color, #d4a017)' } : undefined}
            >
              <MoreHorizontal size={22} strokeWidth={2} />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </div>

          {/* Desktop: all tabs in sidebar */}
          <div className="hidden lg:flex lg:flex-col lg:items-stretch lg:gap-2 lg:w-full">
            {allTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => go(tab.id)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-all relative shrink-0 ${
                    isSidebarCollapsed
                      ? 'lg:w-14 lg:h-14 lg:p-0'
                      : 'lg:flex-row lg:justify-start lg:gap-4 lg:w-full lg:h-14 lg:px-4'
                  } ${
                    isActive ? 'lg:bg-[#fefce8]' : 'text-gray-400 hover:text-gray-600 lg:hover:bg-gray-50'
                  }`}
                  style={isActive ? { color: 'var(--brand-color, #d4a017)' } : undefined}
                  title={isSidebarCollapsed ? tab.label : undefined}
                >
                  <Icon
                    size={24}
                    strokeWidth={isActive ? 2.5 : 2}
                    className="shrink-0"
                    style={isActive ? { color: 'var(--brand-color, #d4a017)' } : undefined}
                  />
                  <span className={`text-[10px] lg:text-sm lg:font-medium lg:truncate ${isSidebarCollapsed ? 'lg:hidden' : 'lg:block'}`}>
                    {tab.label}
                  </span>

                  {tab.id === 'churches' && pendingChurchesCount > 0 && (
                    <span className={`absolute bg-red-500 rounded-full border-2 border-white ${isSidebarCollapsed ? 'top-1 lg:right-2' : 'top-1 right-2 lg:top-1/2 lg:-translate-y-1/2 lg:right-4'} w-3 h-3`}></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Collapse Button (Bottom) */}
          <div className="hidden lg:flex flex-1 items-end pb-6 mt-auto">
            <button
               onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
               className={`flex items-center gap-4 w-full h-14 rounded-xl transition-all px-4 shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-50 ${isSidebarCollapsed ? 'justify-center' : 'justify-start'}`}
               title={isSidebarCollapsed ? "Expand" : "Collapse"}
            >
               {isSidebarCollapsed ? <ChevronRight size={24} strokeWidth={2} /> : <ChevronLeft size={24} strokeWidth={2} />}
               {!isSidebarCollapsed && <span className="text-sm font-medium">Collapse</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-[100dvh] relative bg-[#f8f9fa] overflow-hidden min-w-0">
        {/* Desktop utility header — quick access to Settings & Inbox (no logo/title) */}
        <div className="hidden lg:flex bg-white px-8 py-2 items-center justify-end gap-3 border-b border-gray-100 z-10 w-full">
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink size={15} /> View App
          </button>
          <button
            onClick={() => go('settings')}
            className="text-gray-500 hover:text-gray-900 transition-colors"
            style={activeTab === 'settings' ? { color: 'var(--brand-color, #d4a017)' } : undefined}
          >
            <Settings size={22} />
          </button>
          {showInbox && (
            <button
              onClick={() => go('inbox')}
              className="text-gray-500 hover:text-gray-900 transition-colors relative"
              style={activeTab === 'inbox' ? { color: 'var(--brand-color, #d4a017)' } : undefined}
            >
              <Inbox size={24} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Unified screen header — back + title + screen action. No back on Dashboard.
            A sub-view (e.g. an open chat thread) can fully override it. */}
        <AdminScreenHeader
          title={headerOverride?.title ?? headerTitle}
          titleIcon={headerOverride?.titleIcon}
          onBack={headerOverride ? headerOverride.onBack : (activeTab === 'dashboard' ? undefined : smartBack)}
          action={headerOverride ? headerOverride.action : headerAction}
        />

        {/* Main Content Area */}
        <div className={`flex-1 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6 ${showMoreSheet ? 'overflow-hidden' : ''}`}>
          {activeTab === 'dashboard' ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-gray-400">
              <LayoutDashboard size={48} strokeWidth={1.5} className="mb-4 opacity-20" />
              <p className="text-sm text-gray-400">Select a tool from the navigation to get started.</p>
            </div>
          ) : activeTab === 'admin_roles' ? (
            <div className="p-4 lg:p-0">
              <AnalyticsAndRoles
                currentUserRole={isSuperAdmin ? 'super_admin' : userRole}
                currentUserPermissions={isChurchAdmin ? { fullAccess: true } as any : userPermissions}
                mode="roles"
              />
            </div>
          ) : activeTab === 'blog' ? (
            <div className="p-4 lg:p-0"><AdminBlog /></div>
          ) : activeTab === 'posts' ? (
            <div className="p-4 lg:p-0"><AdminPosts userRole={isSuperAdmin ? 'super_admin' : userRole} userPermissions={userPermissions} /></div>
          ) : activeTab === 'inbox' ? (
            <div className="p-4 lg:p-0"><AdminInbox /></div>
          ) : activeTab === 'churches' ? (
            <div className="p-4 lg:p-0"><AdminChurches /></div>
          ) : activeTab === 'courses' ? (
            <div className="p-4 lg:p-0"><AdminCourses /></div>
          ) : activeTab === 'ai' ? (
            <div className="p-4 lg:p-0"><AdminRAG /></div>
          ) : activeTab === 'newsletter' ? (
            <div className="p-4 lg:p-0">
              {newsletterView === 'editor' ? (
                <NewsletterEditor
                  tenantId={tenantId || PLATFORM_TENANT_ID}
                  tenantName={tenantName}
                  onBack={() => setNewsletterView('list')}
                  canAutoGenerate={isSuperAdmin || !!(features?.automatedNewsletter)}
                />
              ) : (
                <NewsletterCampaigns
                  tenantId={tenantId || PLATFORM_TENANT_ID}
                  onBack={() => go('dashboard')}
                  onCreateNew={() => setNewsletterView('editor')}
                />
              )}
            </div>
          ) : activeTab === 'canvas' ? (
            !canvasId ? (
              <div className="p-4 lg:p-0">
                <CanvasList
                  onOpenCanvas={(id, name) => { setCanvasId(id); setCanvasName(name); }}
                />
              </div>
            ) : null
          ) : activeTab === 'fundraising' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.fundraising))
              ? <div className="p-4 lg:p-0"><AdminFundraising initialCampaignId={itemId} onItemConsumed={clearItemId} /></div>
              : <PlanUpgradeScreen featureName="Fundraising" featureKey="fundraising" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'docs' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.docs))
              ? <div className="p-4 lg:p-0"><AdminDocs initialDocId={itemId} onItemConsumed={clearItemId} /></div>
              : <PlanUpgradeScreen featureName="Notes" featureKey="docs" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'events' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.eventRegistration))
              ? <div className="p-4 lg:p-0"><AdminEvents /></div>
              : <PlanUpgradeScreen featureName="Events" featureKey="event_registration" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'crm' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.crm))
              ? <div className="p-4 lg:p-0"><AdminCRM currentUserRole={isSuperAdmin ? 'super_admin' : userRole} currentUserPermissions={isChurchAdmin ? { fullAccess: true } as any : userPermissions} initialContactId={itemId} onItemConsumed={clearItemId} /></div>
              : <PlanUpgradeScreen featureName="CRM" featureKey="crm" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'accounting' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.accountingTools))
              ? <div className="p-4 lg:p-0"><AdminAccounting /></div>
              : <PlanUpgradeScreen featureName="Accounting" featureKey="accounting" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'forms' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.customForms))
              ? <div className="p-4 lg:p-0"><AdminForms /></div>
              : <PlanUpgradeScreen featureName="Forms" featureKey="customForms" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'checkin' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.checkInSystem))
              ? <div className="p-4 lg:p-0"><AdminCheckin /></div>
              : <PlanUpgradeScreen featureName="Check-In" featureKey="checkInSystem" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'livestream' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.livestream))
              ? <div className="p-4 lg:p-0"><AdminLivestream /></div>
              : <PlanUpgradeScreen featureName="Livestream" featureKey="livestream" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'sms' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.smsAutomation))
              ? <div className="p-4 lg:p-0"><AdminSms /></div>
              : <PlanUpgradeScreen featureName="SMS" featureKey="smsAutomation" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'community' ? (
            (isSuperAdmin || !isTenantAdmin || (features && features.communityGroups))
              ? <div className="p-4 lg:p-0 h-full"><AdminCommunity onOpenAttachment={(type, id) => {
                  if (type === 'doc') navigate(`/admin/docs/${id}`);
                  else if (type === 'contact') navigate(`/admin/crm/${id}`);
                  else if (type === 'campaign') navigate(`/admin/fundraising/${id}`);
                }} /></div>
              : <PlanUpgradeScreen featureName="Community Groups" featureKey="community_chat" onBack={() => go('dashboard')} onUpgrade={() => go('settings')} />
          ) : activeTab === 'tenants' ? (
            <div className="p-4 lg:p-0"><AdminTenants /></div>
          ) : activeTab === 'affiliate' ? (
            <div className="p-4 lg:p-0"><AffiliateSection /></div>
          ) : activeTab === 'settings' ? (
            <AdminSettings
              onBack={() => go('dashboard')}
              currentPlan={tenantPlan ?? undefined}
              tenantId={tenantId ?? undefined}
              email={auth.currentUser?.email ?? undefined}
              onChangePlan={async (plan) => {
                if (auth.currentUser) {
                  const { updateDoc } = await import('firebase/firestore');
                  await updateDoc(doc(db, 'users', auth.currentUser.uid), { plan });
                  window.location.reload();
                }
              }}
              onCancelPlan={async () => {
                if (auth.currentUser) {
                  const { updateDoc } = await import('firebase/firestore');
                  await updateDoc(doc(db, 'users', auth.currentUser.uid), { planStatus: 'cancelled' });
                  alert('Your subscription has been cancelled. It will remain active until the end of the billing period.');
                }
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <p className="text-lg font-medium">{allTabs.find(t => t.id === activeTab)?.label || 'Inbox'} coming soon.</p>
            </div>
          )}
        </div>

        {/* More Sheet (mobile only) */}
        {showMoreSheet && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-[101] lg:hidden"
              onClick={() => setShowMoreSheet(false)}
            />
            <div
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-[102] lg:hidden shadow-[0_-8px_30px_rgba(0,0,0,0.12)] max-h-[70vh] overflow-y-auto"
              style={{ animation: 'slideUp 0.25s ease-out' }}
            >
              <div className="w-9 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
              <div className="px-4 pb-4">
                <h3 className="text-sm font-bold text-gray-900 mb-3">More Tools</h3>
                <div className="grid grid-cols-4 gap-3">
                  {moreTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => go(tab.id)}
                        className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-gray-50 transition-colors relative"
                      >
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                          isActive ? 'bg-[#fefce8]' : 'bg-gray-100'
                        }`}>
                          <Icon size={20} style={isActive ? { color: 'var(--brand-color, #d4a017)' } : { color: '#666' }} />
                        </div>
                        <span className="text-[10px] font-semibold text-gray-700">{tab.label}</span>
                        {tab.id === 'inbox' && unreadCount > 0 && (
                          <span className="absolute top-1 right-2 w-4 h-4 bg-red-500 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Customize Navigation — admin-only shortcut at the bottom of the sheet */}
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setShowMoreSheet(false);
                      setShowNavCustomizer(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-gray-100 flex-shrink-0">
                      <SlidersHorizontal size={20} color="#666" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-800">Customize Navigation</p>
                      <p className="text-xs text-gray-400">Rearrange bottom bar &amp; More drawer</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
          </>
        )}

        {/* Nav customizer full-screen modal */}
        {showNavCustomizer && (
          <AdminNavCustomizer
            allTabs={allTabs}
            currentPrimaryIds={customPrimaryIds ?? primaryTabs.map((t) => t.id)}
            currentDrawerIds={drawerTabs.map((t) => t.id)}
            onSave={(primaryIds, drawerIds) => {
              setCustomPrimaryIds(primaryIds);
              setCustomMoreIds(drawerIds);
              setShowNavCustomizer(false);
            }}
            onCancel={() => setShowNavCustomizer(false)}
          />
        )}
      </div>

      {/* Canvas focus mode — covers the entire viewport over the nav & header */}
      {activeTab === 'canvas' && canvasId && (
        <FocusScreen
          onBack={() => { setCanvasId(null); setCanvasName(''); }}
        >
          <CanvasEditor
            canvasId={canvasId}
            canvasName={canvasName}
            onBack={() => { setCanvasId(null); setCanvasName(''); }}
          />
        </FocusScreen>
      )}
    </div>
    </AdminHeaderContext.Provider>
  );
};

export default AdminDashboard;
