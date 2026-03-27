"use client";
import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Church, FileText, Rss, BrainCircuit, Inbox, ArrowLeft, BookOpen } from 'lucide-react';
import AdminBlog from './AdminBlog';
import AdminPosts from './AdminPosts';
import AdminInbox from './AdminInbox';
import AdminChurches from './AdminChurches';
import AdminCourses from './AdminCourses';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

interface AdminDashboardProps {
  onNavigate: (page: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingChurchesCount, setPendingChurchesCount] = useState(0);

  useEffect(() => {
    const q = query(collection(db, 'submissions'), where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUnreadCount(snapshot.docs.length);
    }, (error) => {
      console.error("Error fetching pending submissions:", error);
    });
    
    const qChurches = query(collection(db, 'churches'), where('status', '==', 'pending'));
    const unsubscribeChurches = onSnapshot(qChurches, (snapshot) => {
      setPendingChurchesCount(snapshot.docs.length);
    }, (error) => {
      console.error("Error fetching pending churches:", error);
    });
    
    return () => {
      unsubscribe();
      unsubscribeChurches();
    };
  }, []);

  const bottomTabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'churches', label: 'Church List', icon: Church },
    { id: 'courses', label: 'Courses', icon: BookOpen },
    { id: 'blog', label: 'Blog', icon: FileText },
    { id: 'posts', label: 'Posts', icon: Rss },
    { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fa] dark:bg-[#1a1d27] font-sans overflow-hidden transition-colors duration-300">
      {/* Top Header */}
      <div className="bg-white dark:bg-[#252a36] px-4 py-3 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate('home')}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#fdf8ed] dark:bg-[#2a2415] text-[#d4a017] hover:bg-[#fcefc7] dark:hover:bg-[#3a301c] transition-colors"
          >
            <img src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" alt="Harvest Logo" className="w-5 h-5 object-contain" />
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Harvest Admin</h1>
        </div>
        <button 
          onClick={() => setActiveTab('inbox')}
          className={`text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors relative ${activeTab === 'inbox' ? 'text-[#d4a017] dark:text-[#d4a017]' : ''}`}
        >
          <Inbox size={24} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white dark:border-[#252a36] text-[8px] font-bold text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {activeTab === 'blog' ? (
          <AdminBlog />
        ) : activeTab === 'posts' ? (
          <AdminPosts />
        ) : activeTab === 'inbox' ? (
          <AdminInbox />
        ) : activeTab === 'churches' ? (
          <AdminChurches />
        ) : activeTab === 'courses' ? (
          <AdminCourses />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <p className="text-lg font-medium">{bottomTabs.find(t => t.id === activeTab)?.label || 'Inbox'} coming soon.</p>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="bg-white dark:bg-[#1a1d27] border-t border-gray-100 dark:border-gray-800 flex justify-around items-center py-2 px-2 pb-safe fixed bottom-0 w-full z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] transition-all duration-300">
        {bottomTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all relative ${
                isActive ? 'text-[#e6b325]' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Icon 
                size={24} 
                strokeWidth={isActive ? 2.5 : 2} 
                className={isActive ? 'fill-[#e6b325]/20' : ''} 
              />
              {tab.id === 'churches' && pendingChurchesCount > 0 && (
                <span className="absolute top-1 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-[#1a1d27]"></span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AdminDashboard;
