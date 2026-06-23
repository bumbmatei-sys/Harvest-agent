"use client";
import React, { useEffect } from 'react';
import { ChevronLeft, PanelLeft } from 'lucide-react';

interface FocusScreenProps {
  /** Called when the back arrow is tapped or Android hardware back is pressed. */
  onBack: () => void;
  /** Optional — shows the sidebar toggle button next to the back button. */
  onSidebarToggle?: () => void;
  children: React.ReactNode;
}

/**
 * Full-screen focus mode wrapper for integrated app screens (Notes, CRM, Canvas, etc.).
 * Uses fixed positioning (z-[200]) to overlay the entire viewport, hiding the nav bar and
 * header that sit beneath it. Shows a gold back chevron (top-left) and optional sidebar
 * toggle (top-left, beside back) over the content.
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

      {/* Back button — top left, gold chevron, no background circle */}
      <button
        onClick={onBack}
        aria-label="Go back"
        className="absolute top-4 left-4 z-10 flex items-center justify-center p-1 transition-opacity hover:opacity-70 active:opacity-50"
      >
        <ChevronLeft size={24} color="#B8962E" strokeWidth={2.5} />
      </button>

      {/* Sidebar toggle — top left beside back button (shown only when a handler is provided) */}
      {onSidebarToggle && (
        <button
          onClick={onSidebarToggle}
          aria-label="Toggle sidebar"
          className="absolute top-4 left-14 z-10 flex items-center justify-center p-1 transition-opacity hover:opacity-70 active:opacity-50"
        >
          <PanelLeft size={20} color="#B8962E" strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

export default FocusScreen;
