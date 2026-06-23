"use client";
import React, { useCallback, useContext, useEffect, useMemo, useRef, createContext } from 'react';
import { ChevronLeft, PanelLeft } from 'lucide-react';

/**
 * Optional override hook: a child rendered inside FocusScreen may
 * register a back interceptor via React context. When the back
 * button is pressed we run the interceptor first; if it returns
 * true we treat the press as consumed (the child handled its own
 * internal navigation), otherwise we fall back to the default
 * onBack prop. The Android hardware back button goes through the
 * same path, so inner components get correct back behaviour for
 * free — including when they're layered behind sub-views.
 */
interface FocusScreenBackContextValue {
  registerBack: (cb: (() => boolean) | null) => void;
}
export const FocusScreenBackContext = createContext<FocusScreenBackContextValue>({
  registerBack: () => {},
});

interface FocusScreenProps {
  /** Called when the back arrow is tapped or Android hardware back is pressed. */
  onBack: () => void;
  /** Optional — shows the sidebar toggle button next to the back button. */
  onSidebarToggle?: () => void;
  children: React.ReactNode;
}

/**
 * Full-screen focus mode wrapper for integrated app screens (Events,
 * CRM, Canvas, Docs, etc.).  Replaces the previous floating-button
 * design with a slim white top bar that contains the gold back
 * chevron (+ optional sidebar toggle) so the controls live in
 * normal document flow and can never overlap content below them.
 *
 * Children rendered inside this wrapper can opt in to back-button
 * interception by calling
 *
 *   const { registerBack } = useContext(FocusScreenBackContext);
 *   registerBack(() => { if (internalView) { closeInternal(); return true; } return false; });
 *
 * — returning true from the interceptor consumes the back press
 * (e.g. closing an opened detail panel) without exiting the
 * FocusScreen entirely.
 */
const FocusScreen: React.FC<FocusScreenProps> = ({ onBack, onSidebarToggle, children }) => {
  // Ref holds the latest interceptor without forcing re-renders.
  const overrideRef = useRef<(() => boolean) | null>(null);
  const registerBack = useCallback((cb: (() => boolean) | null) => {
    overrideRef.current = cb;
  }, []);

  const handleBack = useCallback(() => {
    if (overrideRef.current && overrideRef.current()) return;
    onBack();
  }, [onBack]);

  // Android hardware back button via the browser History API popstate event.
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => handleBack();
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [handleBack]);

  const contextValue = useMemo(() => ({ registerBack }), [registerBack]);

  return (
    <FocusScreenBackContext.Provider value={contextValue}>
      <div className="fixed inset-0 z-[200] bg-[#f8f9fa] flex flex-col">
        {/* Top bar: gold chevron back + optional sidebar toggle */}
        <div className="flex items-center gap-2 px-3 py-3 flex-shrink-0 bg-white border-b border-gray-100">
          <button
            onClick={handleBack}
            aria-label="Go back"
            className="flex items-center justify-center p-1 transition-opacity hover:opacity-70 active:opacity-50"
          >
            <ChevronLeft size={24} color="#B8962E" strokeWidth={2.5} />
          </button>

          {onSidebarToggle && (
            <button
              onClick={onSidebarToggle}
              aria-label="Toggle sidebar"
              className="flex items-center justify-center p-1 transition-opacity hover:opacity-70 active:opacity-50"
            >
              <PanelLeft size={20} color="#B8962E" strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Content fills the remaining screen height */}
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </FocusScreenBackContext.Provider>
  );
};

export default FocusScreen;