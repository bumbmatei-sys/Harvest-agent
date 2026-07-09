"use client";
import React, { useCallback, useContext, useEffect, useMemo, useRef, createContext } from 'react';
import { ChevronLeft, PanelLeft } from 'lucide-react';

interface FocusScreenBackContextValue {
  registerBack: (cb: (() => boolean) | null) => void;
}
export const FocusScreenBackContext = createContext<FocusScreenBackContextValue>({
  registerBack: () => {},
});

interface FocusScreenProps {
  onBack: () => void;
  onSidebarToggle?: () => void;
  headerCenter?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

const FocusScreen: React.FC<FocusScreenProps> = ({ onBack, onSidebarToggle, headerCenter, headerRight, children }) => {
  const overrideRef = useRef<(() => boolean) | null>(null);
  const registerBack = useCallback((cb: (() => boolean) | null) => {
    overrideRef.current = cb;
  }, []);

  const handleBack = useCallback(() => {
    if (overrideRef.current && overrideRef.current()) return;
    onBack();
  }, [onBack]);

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
      <div className="fixed inset-0 z-[200] bg-cream flex flex-col">
        <div className="flex items-center gap-2 px-3 py-3 flex-shrink-0 bg-white border-b border-stone-200">
          <button
            onClick={handleBack}
            aria-label="Go back"
            className="flex items-center justify-center p-1 transition-opacity hover:opacity-70 active:opacity-50"
          >
            <ChevronLeft size={24} color="var(--brand-color, #B8962E)" strokeWidth={2.5} />
          </button>

          {onSidebarToggle && (
            <button
              onClick={onSidebarToggle}
              aria-label="Toggle sidebar"
              className="flex items-center justify-center p-1 transition-opacity hover:opacity-70 active:opacity-50"
            >
              <PanelLeft size={20} color="var(--brand-color, #B8962E)" strokeWidth={2} />
            </button>
          )}

          <div className="flex-1 flex items-center justify-center">
            {headerCenter}
          </div>

          {headerRight && (
            <div className="flex-shrink-0 flex items-center pr-1">
              {headerRight}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </FocusScreenBackContext.Provider>
  );
};

export default FocusScreen;
