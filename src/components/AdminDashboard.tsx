"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { LayoutDashboard, Church, FileText, Rss, BrainCircuit, Inbox, ArrowLeft, BookOpen } from 'lucide-react';
import AdminBlog from './AdminBlog';
import AdminPosts from './AdminPosts';
import AdminInbox from './AdminInbox';
import AdminChurches from './AdminChurches';
import AdminCourses from './AdminCourses';
import AdminRAG from './AdminRAG';
import AnalyticsAndRoles, { Permission } from './AnalyticsAndRoles';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface AdminDashboardProps {
  onNavigate: (page: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingChurchesCount, setPendingChurchesCount] = useState(0);
  const [userRole, setUserRole] = useState<string>('user');
  const [userPermissions, setUserPermissions] = useState<Permission | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
          handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`);
        }
      }
      setIsLoading(false);
    };
    fetchUserPermissions();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'submissions'), where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUnreadCount(snapshot.docs.length);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `submissions`);
    });
    
    const qChurches = query(collection(db, 'churches'), where('status', '==', 'pending'));
    const unsubscribeChurches = onSnapshot(qChurches, (snapshot) => {
      setPendingChurchesCount(snapshot.docs.length);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `churches`);
    });
    
    return () => {
      unsubscribe();
      unsubscribeChurches();
    };
  }, []);

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen bg-[#f8f9fa]"><div className="w-8 h-8 border-4 border-[#d4a017] border-t-transparent rounded-full animate-spin"></div></div>;
  }

  const isSuperAdmin = userRole === 'super_admin' || auth.currentUser?.email === 'bumbmatei@gmail.com';
  const perms = userPermissions || {} as Permission;

  const bottomTabs = [
    (isSuperAdmin || perms.fullAccess || perms.analytics) && { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    (isSuperAdmin || perms.fullAccess || perms.modifyChurches) && { id: 'churches', label: 'Church List', icon: Church },
    (isSuperAdmin || perms.fullAccess || perms.createCourses) && { id: 'courses', label: 'Courses', icon: BookOpen },
    (isSuperAdmin || perms.fullAccess || perms.writeArticles) && { id: 'blog', label: 'Blog', icon: FileText },
    (isSuperAdmin || perms.fullAccess || perms.createPosts) && { id: 'posts', label: 'Posts', icon: Rss },
    (isSuperAdmin || perms.fullAccess || perms.uploadRag) && { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
  ].filter(Boolean) as { id: string; label: string; icon: any }[];

  // If the active tab is not in the allowed tabs, switch to the first allowed tab
  if (bottomTabs.length > 0 && !bottomTabs.find(t => t.id === activeTab) && activeTab !== 'inbox') {
    setActiveTab(bottomTabs[0].id);
  }

  const showInbox = isSuperAdmin || perms.fullAccess || perms.seeFormsInbox;

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fa] font-sans overflow-hidden transition-colors duration-300">
      {/* Top Header */}
      <div className="bg-white px-4 py-3 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate('home')}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#fdf8ed] text-[#d4a017] hover:bg-[#fcefc7] transition-colors relative"
          >
            <Image src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" alt="Harvest Logo" fill sizes="20px" priority className="object-contain p-1.5" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">Harvest Admin</h1>
        </div>
        {showInbox && (
          <button 
            onClick={() => setActiveTab('inbox')}
            className={`text-gray-500 hover:text-gray-900 transition-colors relative ${activeTab === 'inbox' ? 'text-[#d4a017]' : ''}`}
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
      <div className="flex-1 overflow-y-auto pb-24">
        {activeTab === 'dashboard' ? (
          <AnalyticsAndRoles currentUserRole={isSuperAdmin ? 'super_admin' : userRole} currentUserPermissions={userPermissions} />
        ) : activeTab === 'blog' ? (
          <div className="p-4"><AdminBlog /></div>
        ) : activeTab === 'posts' ? (
          <div className="p-4"><AdminPosts /></div>
        ) : activeTab === 'inbox' ? (
          <div className="p-4"><AdminInbox /></div>
        ) : activeTab === 'churches' ? (
          <div className="p-4"><AdminChurches /></div>
        ) : activeTab === 'courses' ? (
          <div className="p-4"><AdminCourses /></div>
        ) : activeTab === 'ai' ? (
          <div className="p-4"><AdminRAG /></div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <p className="text-lg font-medium">{bottomTabs.find(t => t.id === activeTab)?.label || 'Inbox'} coming soon.</p>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="bg-white border-t border-gray-100 flex justify-around items-center py-2 px-2 pb-safe fixed bottom-0 w-full z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] transition-all duration-300">
        {bottomTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all relative ${
                isActive ? 'text-[#e6b325]' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon 
                size={24} 
                strokeWidth={isActive ? 2.5 : 2} 
                className={isActive ? 'fill-[#e6b325]/20' : ''} 
              />
              {tab.id === 'churches' && pendingChurchesCount > 0 && (
                <span className="absolute top-1 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AdminDashboard;