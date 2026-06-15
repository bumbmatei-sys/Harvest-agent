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

type Page = 'auth' | 'onboarding' | 'church-onboarding' | 'home' | 'admin';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('auth');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [tenantPlan, setTenantPlan] = useState<TenantPlan | undefined>(undefined);
  const currentPageRef = useRef(currentPage);

  // Check if user arrived from presentation site "Start Ministry" button
  const isChurchSignup = typeof window !== 'undefined' && 
    new URLSearchParams(window.location.search).get('signup') === 'church';

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          
          if (userDoc.exists()) {
            const data = userDoc.data();
            const role = data.role || 'user';
            const onboardingDone = data.onboardingCompleted;
            const userTenantId = data.tenantId || (() => {
              const cookies = document.cookie.split(';');
              const tc = cookies.find(c => c.trim().startsWith('tenantId='));
              return tc ? tc.split('=')[1].trim() : null;
            })();

            if (onboardingDone) {
              // Onboarding complete — go to the right dashboard
              if (userTenantId) {
                try {
                  const tenantDoc = await getDoc(doc(db, 'tenants', userTenantId));
                  if (tenantDoc.exists()) {
                    setTenantPlan(tenantDoc.data().plan as TenantPlan);
                  }
                } catch (e) {
                  console.error('Failed to fetch tenant:', e);
                }
              } else {
                setTenantPlan(undefined);
              }

              if (currentPageRef.current === 'auth' || currentPageRef.current === 'onboarding' || currentPageRef.current === 'church-onboarding') {
                // Church admins go to admin dashboard, regular users go to home
                setCurrentPage(role === 'church_admin' || role === 'super_admin' ? 'admin' : 'home');
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
  }, [isChurchSignup]);

  const navigateTo = (page: string) => {
    setCurrentPage(page as Page);
    window.scrollTo(0, 0);
  };

  const renderLoading = () => (
    <div className="min-h-screen flex items-center justify-center bg-background-dark">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAuthReady) {
    return renderLoading();
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

export default App;
