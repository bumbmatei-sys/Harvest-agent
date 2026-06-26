'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
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
import { useClaimsFreshness } from './hooks/useClaimsFreshness';
import { isSuperAdminEmail } from './utils/super-admins';
import { useAppStore } from './store/useAppStore';

/** Paths that represent the auth / onboarding funnel (used to decide redirects). */
const FUNNEL_PATHS = ['/auth', '/onboarding', '/church-onboarding'];
const ADMIN_ROLES = ['admin', 'church_admin', 'super_admin'];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

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

const renderLoading = () => (
  <div className="min-h-screen flex items-center justify-center bg-background-dark">
    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

/** Inner App component that uses the TenantContext + React Router. */
const AppInner: React.FC = () => {
  useClaimsFreshness(); // Force-refresh token when claims change

  const navigate = useNavigate();
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);
  useEffect(() => { pathnameRef.current = location.pathname; }, [location.pathname]);

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userRole, setUserRole] = useState<string>('user');
  const { tenantId, isAdminDomain, error: tenantError, isLoading: tenantLoading, setTenantPlan: ctxSetTenantPlan } = useTenant();

  const {
    setCurrentUser,
    setIsAuthReady: storeSetIsAuthReady,
    setTenantPlan,
    setIsSuperAdmin,
    setCurrentTenant,
    tenantPlan,
  } = useAppStore();

  // Sync tenantId from TenantContext into the Zustand store
  useEffect(() => {
    setCurrentTenant(null, tenantId);
  }, [tenantId, setCurrentTenant]);

  // Check if user arrived from presentation site "Start Ministry" button
  const signupParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('signup') : null;
  const isChurchSignup = signupParam === 'church';
  const signupPlan = signupParam && ['plus', 'pro', 'max', 'ultra'].includes(signupParam)
    ? signupParam as TenantPlan : undefined;

  // ARCHITECTURE: Main site (theharvest.app) is free — no plan subscriptions.
  // Redirect ?signup= flows to nations.theharvest.app (tenant admin).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hostname = window.location.hostname;
    const isMainSite = hostname === 'theharvest.app' || hostname === 'www.theharvest.app';
    if (isMainSite && signupParam && !isAdminDomain) {
      const url = new URL(window.location.href);
      window.location.href = `https://nations.theharvest.app${url.pathname}${url.search}`;
    }
  }, [signupParam, isAdminDomain]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const path = pathnameRef.current;

          // Initialize store with authenticated user
          setCurrentUser(user);
          setIsSuperAdmin(isSuperAdminEmail(user.email));

          if (userDoc.exists()) {
            const data = userDoc.data();
            const role = data.role || 'user';
            setUserRole(role);
            const onboardingDone = data.onboardingCompleted;

            if (onboardingDone) {
              // Read plan from user doc first (avoids tenant fetch permission issues).
              // Only set plan on tenant subdomains — main site users get all features.
              if (isAdminDomain) {
                const userPlan = data.plan as TenantPlan | undefined;
                if (userPlan) {
                  setTenantPlan(userPlan);
                  ctxSetTenantPlan(userPlan);
                }
              }

              // PWA / refresh persistence: only redirect away from the auth funnel.
              // A deep link (e.g. /admin/crm) on refresh is left intact so the user
              // stays on the page they were on.
              const homeBase = isAdminDomain ? '/admin' : '/';
              if (FUNNEL_PATHS.includes(path)) {
                navigate(homeBase, { replace: true });
              } else if (path === '/' && isAdminDomain) {
                navigate('/admin', { replace: true });
              }
              // else: keep the current deep-linked path
            } else if (isChurchSignup || signupPlan || role === 'church_admin') {
              navigate('/church-onboarding', { replace: true });
            } else {
              navigate('/onboarding', { replace: true });
            }
          } else {
            // No user doc yet → onboarding funnel
            navigate(isChurchSignup || signupPlan ? '/church-onboarding' : '/onboarding', { replace: true });
          }
        } catch (error) {
          try {
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          } catch (e) { /* handled */ }
          // On error fall back to user home (don't trap on the auth screen)
          if (FUNNEL_PATHS.includes(pathnameRef.current)) navigate('/', { replace: true });
        }
      } else {
        // Signed out — clear store and send to auth, dropping any deep link.
        setCurrentUser(null);
        setTenantPlan(null);
        setIsSuperAdmin(false);
        setUserRole('user');
        navigate('/auth', { replace: true });
      }
      setIsAuthReady(true);
      storeSetIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [isChurchSignup, signupPlan, isAdminDomain, ctxSetTenantPlan, navigate, setCurrentUser, setIsSuperAdmin, setTenantPlan, storeSetIsAuthReady]);

  // Map legacy string-based navigation (onNavigate('admin'|'home'|...)) to routes
  // so child components keep their existing API while routing is URL-driven.
  const handleNavigate = useCallback((page: string) => {
    if (page === 'admin') navigate('/admin');
    else if (page === 'home') navigate('/');
    else if (page === 'auth') navigate('/auth');
    else navigate(`/${page}`);
    window.scrollTo(0, 0);
  }, [navigate]);

  const isAdmin =
    ADMIN_ROLES.includes(userRole) ||
    isAdminDomain ||
    isSuperAdminEmail(auth.currentUser?.email);

  // Show loading while tenant validation is in progress
  if (!isAuthReady || (tenantLoading && tenantId)) {
    return renderLoading();
  }

  // Show tenant-not-found error if tenant validation failed
  // Skip this error when user is arriving via ?signup param (no tenant exists yet)
  if (tenantError && tenantId && !signupParam) {
    return <TenantNotFound tenantId={tenantId} message={tenantError} />;
  }

  /** Guard: admin routes require an admin role (or admin subdomain / super admin). */
  const RequireAdmin: React.FC<{ children: React.ReactElement }> = ({ children }) =>
    isAdmin ? children : <Navigate to="/" replace />;

  const adminElement = (
    <RequireAdmin>
      <ErrorBoundary>
        <AdminDashboard onNavigate={handleNavigate} />
      </ErrorBoundary>
    </RequireAdmin>
  );

  return (
    <>
      <Routes>
        <Route path="/auth" element={<AuthPage onNavigate={handleNavigate} />} />
        <Route
          path="/onboarding"
          element={<Onboarding onComplete={() => navigate('/', { replace: true })} signupPlan={signupPlan} />}
        />
        <Route
          path="/church-onboarding"
          element={<ChurchOnboarding onComplete={() => navigate('/admin', { replace: true })} signupPlan={signupPlan} />}
        />
        <Route path="/admin" element={adminElement} />
        <Route path="/admin/:section" element={adminElement} />
        <Route path="/admin/:section/:itemId" element={adminElement} />
        <Route
          path="/"
          element={
            <ErrorBoundary>
              <MainApp onNavigate={handleNavigate} />
            </ErrorBoundary>
          }
        />
        {/* Unknown routes fall back to user home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PWAInstallManager />
    </>
  );
};

/** Outer App: wraps everything in BrowserRouter + TenantProvider + QueryClientProvider. */
const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TenantProvider>
          <AppInner />
        </TenantProvider>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};

export default App;
