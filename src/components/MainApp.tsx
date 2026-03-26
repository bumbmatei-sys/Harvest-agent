"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Home, BookOpen, MessageCircle, Map as MapIcon, User, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Profile from './Profile';
import PartnerWithUsTab from './PartnerWithUsTab';
import BlogTab from './BlogTab';
import NewsTab from './NewsTab';
import AllNews from './AllNews';
import SavedContentTab from './SavedContentTab';
import dynamic from 'next/dynamic';

const ChurchMap = dynamic(() => import('./ChurchMap'), { ssr: false });

interface MainAppProps {
  onNavigate: (page: string) => void;
}

const MainApp: React.FC<MainAppProps> = ({ onNavigate }) => {
  const [activeBottomTab, setActiveBottomTab] = useState('home');
  const [activeTopTab, setActiveTopTab] = useState('news');
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [direction, setDirection] = useState(0);
  const [fullScreenView, setFullScreenView] = useState<{type: 'none' | 'all-news' | 'article', id?: string, data?: any}>({type: 'none'});

  useEffect(() => {
    setIsNavVisible(true);
  }, [activeBottomTab]);

  const topTabs = [
    { id: 'news', label: 'News' },
    { id: 'blog', label: 'Blog' },
    { id: 'courses', label: 'Courses' },
    { id: 'continue-learning', label: 'Continue Learning' },
    { id: 'saved', label: 'Saved Content' },
    { id: 'partner', label: 'Partner with Us' },
  ];

  const topTabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (topTabsRef.current) {
      const activeTabElement = topTabsRef.current.querySelector(`[data-tab-id="${activeTopTab}"]`);
      if (activeTabElement) {
        activeTabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeTopTab]);

  const handleTopTabClick = (tabId: string) => {
    const currentIndex = topTabs.findIndex(t => t.id === activeTopTab);
    const nextIndex = topTabs.findIndex(t => t.id === tabId);
    if (currentIndex !== nextIndex) {
      setDirection(nextIndex > currentIndex ? 1 : -1);
      setActiveTopTab(tabId);
    }
  };

  const handleDragEnd = (e: any, { offset, velocity }: any) => {
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
  };

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

  const bottomTabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'bible', label: 'Bible', icon: BookOpen },
    { id: 'chat', label: 'Chat', icon: MessageCircle },
    { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'profile', label: 'My Profile', icon: User },
  ];

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (fullScreenView.type !== 'none') return;
    const currentScrollY = e.currentTarget.scrollTop;
    if (currentScrollY > lastScrollY && currentScrollY > 50) {
      setIsNavVisible(false);
    } else if (currentScrollY < lastScrollY) {
      setIsNavVisible(true);
    }
    setLastScrollY(currentScrollY);
  };

  if (fullScreenView.type === 'all-news') {
    return <AllNews onBack={() => setFullScreenView({type: 'none'})} />;
  }

  if (fullScreenView.type === 'article' && fullScreenView.data) {
    return <BlogTab initialPost={fullScreenView.data} onBack={() => setFullScreenView({type: 'none'})} isFullScreen={true} />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fa] dark:bg-[#1a1d27] font-sans overflow-hidden transition-colors duration-300">
      {/* Top Navigation (only visible when Home is active) */}
      {activeBottomTab === 'home' && (
        <div className="bg-white dark:bg-[#1a1d27] pt-3 pb-0 px-4 shadow-sm z-10 flex-shrink-0 transition-colors duration-300">
          <div ref={topTabsRef} className="flex overflow-x-auto gap-6 pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x scroll-smooth">
            {topTabs.map((tab) => (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                onClick={() => handleTopTabClick(tab.id)}
                className={`whitespace-nowrap pb-3 font-bold text-[13px] transition-colors relative snap-start ${
                  activeTopTab === tab.id ? 'text-[#e6b325]' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {tab.label}
                {activeTopTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#e6b325]" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 overflow-x-hidden relative ${activeBottomTab === 'map' ? '' : 'overflow-y-auto pb-24'}`} onScroll={handleScroll}>
        {activeBottomTab === 'home' ? (
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
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={1}
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
                {activeTopTab === 'saved' && (
                  <SavedContentTab onOpenArticle={(post) => setFullScreenView({type: 'article', data: post})} />
                )}
                {activeTopTab !== 'news' && activeTopTab !== 'partner' && activeTopTab !== 'blog' && activeTopTab !== 'saved' && (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500">
                    <p>{topTabs.find(t => t.id === activeTopTab)?.label} content coming soon.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        ) : activeBottomTab === 'profile' ? (
          <Profile 
            onNavigate={onNavigate} 
            onGoToCourses={() => { setActiveBottomTab('home'); setActiveTopTab('courses'); }} 
            onGoToPartner={() => { setActiveBottomTab('home'); setActiveTopTab('partner'); }}
          />
        ) : activeBottomTab === 'map' ? (
          <ChurchMap 
            onBack={() => setActiveBottomTab('home')} 
            onMapInteraction={(interacting) => setIsNavVisible(!interacting)} 
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <p>{bottomTabs.find(t => t.id === activeBottomTab)?.label} section coming soon.</p>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className={`bg-white dark:bg-[#1a1d27] border-t border-gray-100 dark:border-gray-800 flex justify-around items-center py-2 px-2 pb-safe fixed bottom-0 w-full z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] transition-all duration-300 ${isNavVisible && activeBottomTab !== 'map' ? 'translate-y-0' : 'translate-y-full'}`}>
        {bottomTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeBottomTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveBottomTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all ${
                isActive ? 'text-[#e6b325]' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Icon 
                size={24} 
                strokeWidth={isActive ? 2.5 : 2} 
                className={isActive ? 'fill-[#e6b325]/20' : ''} 
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MainApp;