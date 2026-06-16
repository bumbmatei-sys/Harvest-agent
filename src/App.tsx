'use client';
import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import AuthPage from './components/AuthPage';
import MainApp from './components/MainApp';
import Onboarding from './components/Onboarding';
import ChurchOnboarding from './components/ChurchOnboarding';
import ErrorBoundary from './components/ErrorBoundary';
import AdminDashboard from './components/AdminDashboard';
import PWAInstallManager from './components/PWAInstallManager';
import { OperationType, handleFirestoreError } from './utils/firestore-errors';
import { TenantPlan } from './types/tenant.types';
import { TenantProvider, useTenant } from './contexts/TenantContext';

type Page = 'auth' | 'onboarding' | 'church-onboarding' | 'home' | 'admin';

/** Read a cookie by name (client-side) */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split(';').find(c => c.trim().startsWith(`${name}=`));
  return match ? match.split('=')[1].trim() : null;
}

/** Error page shown when a tenant subdomain doesn't resolve to a valid tenant */
const TenantNotFound: React.FC<{ tenantId: string; message: string }> = ({ tenantId, message }) => (
  <div className="min-h-screen flex items-center justify-center bg-background-dark">
    <div className="max-w-md mx-auto text-center p-8">
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Organization Not Found</h1>
      <p className="text-gray-400 mb-6">{message}</p>
      <p className="text-sm text-gray-500 mb-6">
        Subdomain: <code className="bg-gray-800 px-2 py-1 rounded">{tenantId}.theharvest.app</code>
      </p>
      <a
        href="https://theharvest.app"
        className="inline-block px-6 py-3 bg-[#e6b325] text-white rounded-lg font-medium hover:bg-[#d4a017] transition-colors"
      >
        Go to Harvest Home
      </a>
    </div>
  </div>
);

/** Inner App component that uses the TenantContext */
const AppInner: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('auth');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [tenantPlan, setTenantPlan] = useState<TenantPlan | undefined>(undefined);
  const currentPageRef = useRef(currentPage);
  const { tenantId, isAdminDomain, error: tenantError, isLoading: tenantLoading, setTenantPlan: ctxSetTenantPlan } = useTenant();

  // Check if user arrived from presentation site "Start Ministry" button
  const isChurchSignup = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('signup') === 'church';

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // If on admin subdomain, go straight to admin (still needs auth)
  useEffect(() => {
    if (isAdminDomain && isAuthReady) {
      setCurrentPage('admin');
    }
  }, [isAdminDomain, isAuthReady]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));

          if (userDoc.exists()) {
            const data = userDoc.data();
            const role = data.role || 'user';
            const onboardingDone = data.onboardingCompleted;
            const userTenantId = data.tenantId || tenantId;

            if (onboardingDone) {
              // Onboarding complete — go to the right dashboard
              // Read plan from user doc first (avoids tenant fetch permission issues)
              const userPlan = data.plan as TenantPlan | undefined;
              if (userPlan) {
                setTenantPlan(userPlan);
                ctxSetTenantPlan(userPlan);
              }

              if (currentPageRef.current === 'auth' || currentPageRef.current === 'onboarding' || currentPageRef.current === 'church-onboarding') {
                // Admin subdomain → always admin dashboard
                if (isAdminDomain) {
                  setCurrentPage('admin');
                } else {
                  // Church admins go to admin dashboard, regular users go to home
                  setCurrentPage(role === 'church_admin' || role === 'super_admin' ? 'admin' : 'home');
                }
              }
            } else if (isChurchSignup || role === 'church_admin') {
              // Church admin path: needs church onboarding
              setCurrentPage('church-onboarding');
            } else {
              // Regular user: needs standard onboarding
              setCurrentPage('onboarding');
            }
          } else {
            // No user doc yet
            if (isChurchSignup) {
              setCurrentPage('church-onboarding');
            } else {
              setCurrentPage('onboarding');
            }
          }
        } catch (error) {
          try {
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          } catch (e) { /* handled */ }
          setCurrentPage('home');
        }
      } else {
        setTenantPlan(undefined);
        if (currentPageRef.current !== 'auth') {
          setCurrentPage('auth');
        }
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [isChurchSignup, isAdminDomain, tenantId, ctxSetTenantPlan]);

  const navigateTo = (page: string) => {
    setCurrentPage(page as Page);
    window.scrollTo(0, 0);
  };

  const renderLoading = () => (
    <div className="min-h-screen flex items-center justify-center bg-background-dark">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Show loading while tenant validation is in progress
  if (!isAuthReady || (tenantLoading && tenantId)) {
    return renderLoading();
  }

  // Show tenant-not-found error if tenant validation failed
  if (tenantError && tenantId) {
    return <TenantNotFound tenantId={tenantId} message={tenantError} />;
  }

  if (currentPage === 'church-onboarding') {
    return (
      <>
        <ChurchOnboarding onComplete={() => navigateTo('admin')} />
        <PWAInstallManager />
      </>
    );
  }

  if (currentPage === 'onboarding') {
    return (
      <>
        <Onboarding onComplete={() => navigateTo('home')} />
        <PWAInstallManager />
      </>
    );
  }

  if (currentPage === 'home') {
    return (
      <>
        <MainApp onNavigate={navigateTo} tenantPlan={tenantPlan} />
        <PWAInstallManager />
      </>
    );
  }

  if (currentPage === 'admin') {
    return (
      <>
        <ErrorBoundary>
          <AdminDashboard onNavigate={navigateTo} tenantPlan={tenantPlan} />
        </ErrorBoundary>
        <PWAInstallManager />
      </>
    );
  }

  return <AuthPage onNavigate={navigateTo} />;
};

/** Outer App: wraps everything in TenantProvider */
const App: React.FC = () => {
  return (
    <TenantProvider>
      <AppInner />
    </TenantProvider>
  );
};

export default App;
