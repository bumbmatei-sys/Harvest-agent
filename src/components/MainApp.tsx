"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Home, BookOpen, MessageCircle, Map as MapIcon, User, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

import Profile from './Profile';
import PartnerWithUsTab from './PartnerWithUsTab';
import BlogTab from './BlogTab';
import NewsTab from './NewsTab';
import AllNews from './AllNews';
import CourseExperience from '../components/CoursePage';
import AIChat from './AIChat';
import ErrorBoundary from './ErrorBoundary';
import NotificationPrompt from './NotificationPrompt';
import BiblePage from './BiblePage';
import ReferralTracker from './ReferralTracker';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures } from '../utils/plan-features';

const ChurchMap = dynamic(() => import('./ChurchMap'), { ssr: false });

interface MainAppProps {
  onNavigate: (page: string) => void;
  tenantPlan?: TenantPlan;
}

const MainApp: React.FC<MainAppProps> = ({ onNavigate, tenantPlan }) => {
  const [activeBottomTab, setActiveBottomTab] = useState('home');
  const [activeTopTab, setActiveTopTab] = useState('news');
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const lastScrollYRef = useRef(0);
  const [direction, setDirection] = useState(0);
  const [fullScreenView, setFullScreenView] = useState<{type: 'none' | 'all-news' | 'article' | 'course', id?: string, data?: any}>({type: 'none'});

  // Main site users (no tenantPlan) get all features — Chat behind paywall, Map included.
  // Tenant users are gated by their plan.
  const isMainSite = !tenantPlan;
  const features = tenantPlan ? getPlanFeatures(tenantPlan) : null;

  const topTabs = [
    { id: 'news', label: 'News' },
    (isMainSite || features?.blog !== false) && { id: 'blog', label: 'Blog' },
    { id: 'courses', label: 'Courses' },
    { id: 'partner', label: 'Partner with Us' },
  ].filter(Boolean) as { id: string; label: string }[];

  const bottomTabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'bible', label: 'Bible', icon: BookOpen },
    (isMainSite || features?.aiChat !== false) && { id: 'chat', label: 'Chat', icon: MessageCircle },
    (isMainSite || features?.map === true) && { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'profile', label: 'My Profile', icon: User },
  ].filter(Boolean) as { id: string; label: string; icon: any }[];

  useEffect(() => {
    setIsNavVisible(true);
  }, [activeBottomTab]);

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

  const renderLoading = () => (
    <div className="flex items-center justify-center h-full w-full min-h-[50vh]">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #e6b325)', borderTopColor: 'transparent' }}></div>
    </div>
  );

  if (fullScreenView.type === 'all-news') {
    return (
      <AllNews onBack={() => setFullScreenView({type: 'none'})} />
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

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#f8f9fa] font-sans overflow-hidden transition-colors duration-300">
      <ReferralTracker />
      
      {/* Side/Bottom Navigation */}
      <div className={`bg-white border-t lg:border-t-0 lg:border-r border-gray-100 flex justify-center lg:justify-start py-2 lg:py-6 px-2 lg:px-4 pb-safe lg:pb-0 fixed lg:relative bottom-0 lg:bottom-auto w-full ${isSidebarCollapsed ? 'lg:w-[88px]' : 'lg:w-64'} lg:h-screen z-[100] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] lg:shadow-[2px_0_10px_rgba(0,0,0,0.02)] transition-all duration-300 ${!isNavVisible || activeBottomTab === 'map' ? 'max-lg:translate-y-full' : 'max-lg:translate-y-0'}`}>
        <div className={`flex lg:flex-col justify-around lg:justify-start items-center lg:items-stretch w-full lg:max-w-none lg:gap-2 ${isSidebarCollapsed ? 'lg:items-center' : ''}`}>
          {/* Desktop Logo */}
          <div className={`hidden lg:flex items-center mb-8 shrink-0 ${isSidebarCollapsed ? 'justify-center px-0 w-full' : 'gap-3 px-4'}`}>
            <img 
              src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" 
              alt="Harvest" 
              className="w-10 h-10 object-contain shrink-0" 
            />
            {!isSidebarCollapsed && <span className="text-xl font-bold text-gray-900 truncate">Harvest</span>}
          </div>

          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeBottomTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveBottomTab(tab.id)}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-all shrink-0 ${
                  isSidebarCollapsed 
                    ? 'lg:w-14 lg:h-14 lg:p-0 w-16 h-12' 
                    : 'lg:flex-row lg:justify-start lg:gap-4 lg:w-full lg:h-14 lg:px-4 w-16 h-12'
                } ${
                  isActive ? 'lg:bg-[#fefce8]' : 'text-gray-400 hover:text-gray-600 lg:hover:bg-gray-50'
                }`}
                style={isActive ? { color: 'var(--brand-color, #e6b325)' } : undefined}
                title={isSidebarCollapsed ? tab.label : undefined}
              >
                <Icon 
                  size={24} 
                  strokeWidth={isActive ? 2.5 : 2} 
                  className={isActive ? 'shrink-0' : 'shrink-0'} 
                  style={isActive ? { color: 'var(--brand-color, #e6b325)' } : undefined}
                />
                <span className={`text-[10px] lg:text-sm lg:font-medium lg:truncate ${isSidebarCollapsed ? 'lg:hidden block' : 'lg:block block'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
          
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
        {/* Top Navigation (only visible when Home is active) */}
        {activeBottomTab === 'home' && (
          <div className="bg-white pt-3 pb-0 px-4 shadow-sm z-10 flex-shrink-0 transition-colors duration-300">
            <div ref={topTabsRef} className="flex overflow-x-auto gap-6 pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x scroll-smooth lg:max-w-5xl lg:mx-auto w-full">
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
          </div>
        )}

        {/* Main Content Area */}
        <ErrorBoundary>
        <div className={`flex-1 overflow-x-hidden relative ${activeBottomTab === 'map' ? '' : activeBottomTab === 'chat' ? 'overflow-y-auto pb-[65px] lg:pb-0' : 'overflow-y-auto pb-24 lg:pb-0'}`} onScroll={handleScroll}>
          {activeBottomTab === 'home' ? (
            <div className="relative w-full h-full lg:max-w-5xl lg:mx-auto">
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
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={{ left: activeTopTab === topTabs[topTabs.length - 1].id ? 0 : 1, right: activeTopTab === topTabs[0].id ? 0 : 1 }}
                  onDragEnd={handleDragEnd}
                  className="absolute w-full h-full p-4 space-y-6"
                >
                  {/* Content based on activeTopTab */}
                  {activeTopTab === 'news' && (
                    <NewsTab 
                      onOpenAllNews={() => setFullScreenView({type: 'all-news'})} 
                      onOpenArticle={(post) => setFullScreenView({type: 'article', data: post})} 
                    />
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
                  {activeTopTab !== 'news' && activeTopTab !== 'partner' && activeTopTab !== 'blog' && activeTopTab !== 'courses' && (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                      <p>{topTabs.find(t => t.id === activeTopTab)?.label} content coming soon.</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : activeBottomTab === 'profile' ? (
            <div className="w-full lg:max-w-5xl lg:mx-auto">
              <Profile 
                onNavigate={onNavigate} 
                onGoToCourses={() => { setActiveBottomTab('home'); setActiveTopTab('courses'); }} 
                onGoToPartner={() => { setActiveBottomTab('home'); setActiveTopTab('partner'); }}
                onGoToMap={() => setActiveBottomTab('map')}
              />
            </div>
          ) : activeBottomTab === 'chat' ? (
             <div className="w-full lg:max-w-5xl lg:mx-auto h-full">
              <AIChat onBack={() => setActiveBottomTab('home')} tenantPlan={tenantPlan} />
             </div>
          ) : activeBottomTab === 'map' ? (
             <div className="w-full lg:max-w-5xl lg:mx-auto h-full">
              <ChurchMap 
                onBack={() => setActiveBottomTab('home')} 
                onMapInteraction={(interacting) => setIsNavVisible(!interacting)} 
              />
             </div>
          ) : activeBottomTab === 'bible' ? (
             <div className="w-full lg:max-w-5xl lg:mx-auto h-full">
              <BiblePage />
             </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 lg:max-w-5xl lg:mx-auto">
              <p>{bottomTabs.find(t => t.id === activeBottomTab)?.label} section coming soon.</p>
            </div>
          )}
        </div>
        </ErrorBoundary>
      </div>
      <NotificationPrompt />
    </div>
  );
};

export default MainApp;
