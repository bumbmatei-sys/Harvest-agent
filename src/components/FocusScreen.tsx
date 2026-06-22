"use client";
import React, { useEffect } from 'react';
import { ArrowLeft, PanelRight } from 'lucide-react';

interface FocusScreenProps {
  /** Called when the back arrow is tapped or Android hardware back is pressed. */
  onBack: () => void;
  /** Optional — shows the sidebar toggle button in the top-right corner. */
  onSidebarToggle?: () => void;
  children: React.ReactNode;
}

/**
 * Full-screen focus mode wrapper for integrated app screens (Notes, CRM, Canvas, etc.).
 * Uses fixed positioning (z-[200]) to overlay the entire viewport, hiding the nav bar and
 * header that sit beneath it. Shows a floating back arrow (top-left) and optional sidebar
 * toggle (top-right) over the content.
 */
const FocusScreen: React.FC<FocusScreenProps> = ({ onBack, onSidebarToggle, children }) => {
  // Handle Android hardware back button via the browser History API popstate event.
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => onBack();
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onBack]);

  return (
    <div className="fixed inset-0 z-[200] bg-black overflow-hidden">
      {/* Content fills the full screen edge-to-edge */}
      <div className="absolute inset-0">
        {children}
      </div>

      {/* Floating back button — top left */}
      <button
        onClick={onBack}
        aria-label="Go back"
        className="absolute top-4 left-4 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 active:opacity-60"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      >
        <ArrowLeft size={20} className="text-white" strokeWidth={2.5} />
      </button>

      {/* Floating sidebar toggle — top right (shown only when a handler is provided) */}
      {onSidebarToggle && (
        <button
          onClick={onSidebarToggle}
          aria-label="Toggle sidebar"
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <PanelRight size={20} className="text-white" strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

export default FocusScreen;
