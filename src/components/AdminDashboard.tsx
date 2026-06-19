"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { LayoutDashboard, Church, FileText, Rss, BrainCircuit, Inbox, ArrowLeft, GraduationCap, ChevronLeft, ChevronRight, Building2, Settings, MoreHorizontal, Mail } from 'lucide-react';
import AdminBlog from './AdminBlog';
import AdminPosts from './AdminPosts';
import AdminInbox from './AdminInbox';
import AdminChurches from './AdminChurches';
import AdminCourses from './AdminCourses';
import AdminRAG from './AdminRAG';
import AdminTenants from './AdminTenants';
import AdminSettings from './AdminSettings';
import NewsletterEditor from './NewsletterEditor';
import NewsletterCampaigns from './NewsletterCampaigns';
import CanvasList from './CanvasList';
import CanvasEditor from './CanvasEditor';
import AnalyticsAndRoles, { Permission } from './AnalyticsAndRoles';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures } from '../utils/plan-features';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, getDoc, limit } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, isSuperAdmin as checkIsSuperAdmin } from '../utils/tenant-scope';



interface AdminDashboardProps {
  onNavigate: (page: string) => void;
  tenantPlan?: TenantPlan; // undefined = super admin (all features)
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate, tenantPlan }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingChurchesCount, setPendingChurchesCount] = useState(0);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [userRole, setUserRole] = useState<string>('user');
  const [userPermissions, setUserPermissions] = useState<Permission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [canvasName, setCanvasName] = useState<string>('');
  const [newsletterView, setNewsletterView] = useState<'list' | 'editor'>('list');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('Ministry');

  useEffect(() => {
    getTenantScope().then(async (id) => {
      setTenantId(id);
      if (id) {
        try {
          const tenantDoc = await getDoc(doc(db, 'tenants', id));
          if (tenantDoc.exists()) {
            const data = tenantDoc.data();
            setTenantName(data.name || data.config?.name || 'Ministry');
          }
        } catch (e) {
          console.error('Failed to load tenant name:', e);
        }
      }
    });
  }, []);

  useEffect(() => {
    const fetchUserPermissions = async () => {
      if (auth.currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserRole(data.role || 'user');
            setUserPermissions(data.permissions || null);
          }
        } catch (error) {
          try { handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
        }
      }
      setIsLoading(false);
    };
    fetchUserPermissions();
  }, []);

  useEffect(() => {
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    let cancelled = false;

    const loadCounts = async () => {
    const tenantId = await getTenantScope();
    if (cancelled) return;
    const q = tenantId
      ? query(collection(db, 'submissions'), where('tenantId', '==', tenantId), where('status', '==', 'pending'), limit(100))
      : query(collection(db, 'submissions'), where('status', '==', 'pending'), limit(100));
    unsub1 = onSnapshot(q, (snapshot) => {
      setUnreadCount(snapshot.docs.length);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.GET, `submissions`); } catch (e) { console.error(e); }
    });
    
    const qChurches = tenantId
      ? query(collection(db, 'churches'), where('tenantId', '==', tenantId), where('status', '==', 'pending'), limit(100))
      : query(collection(db, 'churches'), where('status', '==', 'pending'), limit(100));
    unsub2 = onSnapshot(qChurches, (snapshot) => {
      setPendingChurchesCount(snapshot.docs.length);
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
  const perms = userPermissions || {} as Permission;
  const features = tenantPlan ? getPlanFeatures(tenantPlan) : null;
  const isTenantAdmin = !!tenantPlan;
  const hasFullAccess = isSuperAdmin || isChurchAdmin || perms.fullAccess;

  const showInbox = hasFullAccess || perms.seeFormsInbox;

  // All available tabs (permission-filtered)
  const allTabs = [
    (hasFullAccess || perms.analytics) && { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    (hasFullAccess || perms.modifyChurches) && { id: 'churches', label: isTenantAdmin && features && features.maxChurches === 1 ? 'Church' : 'Church List', icon: Church },
    (isSuperAdmin || !isTenantAdmin || (features && features.blog)) && (hasFullAccess || perms.createCourses) && { id: 'courses', label: 'Courses', icon: GraduationCap },
    (isSuperAdmin || !isTenantAdmin || (features && features.blog)) && (hasFullAccess || perms.writeArticles) && { id: 'blog', label: 'Blog', icon: FileText },
    (hasFullAccess || perms.createPosts) && { id: 'posts', label: 'Posts', icon: Rss },
    (isSuperAdmin || !isTenantAdmin || (features && features.aiKnowledge)) && (hasFullAccess || perms.uploadRag) && { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
    // Newsletter tab — gated behind plan feature
    (isSuperAdmin || !isTenantAdmin || (features && features.newsletterAutomation)) &&
      (hasFullAccess || perms.createPosts) &&
      { id: 'newsletter', label: 'Newsletter', icon: Mail },
    isSuperAdmin && { id: 'tenants', label: 'Tenants', icon: Building2 },
  ].filter(Boolean) as { id: string; label: string; icon: any }[];

  // Mobile: first 4 tabs in nav bar, rest go to "More" sheet
  const primaryTabs = allTabs.slice(0, 4);
  const moreTabs = [
    ...allTabs.slice(4),
    ...(showInbox ? [{ id: 'inbox', label: 'Inbox', icon: Inbox }] : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // If the active tab is not in the allowed tabs, switch to the first allowed tab
  const allTabIds = allTabs.map(t => t.id).join(',');
  useEffect(() => {
    if (!isLoading && allTabs.length > 0 && !allTabs.find(t => t.id === activeTab) && activeTab !== 'inbox' && activeTab !== 'settings') {
      setActiveTab(allTabs[0].id);
    }
  }, [isLoading, allTabIds, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen bg-[#f8f9fa]"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }}></div></div>;
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#f8f9fa] font-sans overflow-hidden transition-colors duration-300">
      
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
                  onClick={() => { setActiveTab(tab.id); setShowMoreSheet(false); setNewsletterView('list'); }}
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
                  onClick={() => { setActiveTab(tab.id); setNewsletterView('list'); }}
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
      <div className="flex-1 flex flex-col h-screen relative bg-[#f8f9fa] overflow-hidden min-w-0">
        {/* Top Header */}
        <div className="bg-white px-4 py-3 flex items-center justify-between shadow-sm z-10 lg:hidden">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => onNavigate('home')}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-[#fdf8ed] text-[#d4a017] hover:bg-[#fcefc7] transition-colors relative"
            >
              <Image src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" alt="Harvest Logo" fill sizes="20px" priority className="object-contain p-1.5" />
            </button>
            <h1 className="text-lg font-bold text-gray-900">Harvest Admin</h1>
          </div>
        </div>

        {/* Top Header Desktop */}
        <div className="hidden lg:flex bg-white px-8 py-4 items-center justify-end gap-3 shadow-sm z-10 w-full">
          <button 
            onClick={() => setActiveTab('settings')}
            className="text-gray-500 hover:text-gray-900 transition-colors"
            style={activeTab === 'settings' ? { color: 'var(--brand-color, #d4a017)' } : undefined}
          >
            <Settings size={22} />
          </button>
          {showInbox && (
            <button 
              onClick={() => setActiveTab('inbox')}
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

        {/* Main Content Area */}
        <div className={`flex-1 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6 ${showMoreSheet ? 'overflow-hidden' : ''}`}>
          {activeTab === 'dashboard' ? (
            <AnalyticsAndRoles currentUserRole={isSuperAdmin ? 'super_admin' : userRole} currentUserPermissions={isChurchAdmin ? { fullAccess: true } as any : userPermissions} />
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
                  tenantId={tenantId || ''}
                  tenantName={tenantName}
                  onBack={() => setNewsletterView('list')}
                />
              ) : (
                <NewsletterCampaigns
                  tenantId={tenantId || ''}
                  onBack={() => setActiveTab('dashboard')}
                  onCreateNew={() => setNewsletterView('editor')}
                />
              )}
            </div>
          ) : activeTab === 'canvas' ? (
            canvasId ? (
              <CanvasEditor
                canvasId={canvasId}
                canvasName={canvasName}
                onBack={() => { setCanvasId(null); setCanvasName(''); }}
              />
            ) : (
              <div className="p-4 lg:p-0">
                <CanvasList
                  onOpenCanvas={(id, name) => { setCanvasId(id); setCanvasName(name); }}
                />
              </div>
            )
          ) : activeTab === 'tenants' ? (
            <div className="p-4 lg:p-0"><AdminTenants /></div>
          ) : activeTab === 'settings' ? (
            <AdminSettings
              onBack={() => setActiveTab('dashboard')}
              currentPlan={tenantPlan || undefined}
              tenantId={tenantId || undefined}
              email={auth.currentUser?.email || undefined}
              onChangePlan={async (plan) => {
                // Update plan in Firestore
                if (auth.currentUser) {
                  const { updateDoc } = await import('firebase/firestore');
                  await updateDoc(doc(db, 'users', auth.currentUser.uid), { plan });
                  window.location.reload(); // Refresh to apply new plan
                }
              }}
              onCancelPlan={async () => {
                // Mark tenant as suspended
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
                        onClick={() => {
                          setActiveTab(tab.id);
                          setShowMoreSheet(false);
                          setNewsletterView('list');
                        }}
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
              </div>
            </div>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
