'use client';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import AuthPage from './components/AuthPage';
import MainApp from './components/MainApp';
import Onboarding from './components/Onboarding';
import ErrorBoundary from './components/ErrorBoundary';
import AdminDashboard from './components/AdminDashboard';
import PWAInstallManager from './components/PWAInstallManager';
import { OperationType, handleFirestoreError } from './utils/firestore-errors';
import { TenantPlan } from './types/tenant.types';


const App: React.FC = () => {
 const [currentPage, setCurrentPage] = useState('auth');
 const [isAuthReady, setIsAuthReady] = useState(false);
 const [needsOnboarding, setNeedsOnboarding] = useState(false);
 const [tenantPlan, setTenantPlan] = useState<TenantPlan | undefined>(undefined);
 const currentPageRef = useRef(currentPage);

 useEffect(() => {
 currentPageRef.current = currentPage;
 }, [currentPage]);

 useEffect(() => {
 const unsubscribe = onAuthStateChanged(auth, async (user) => {
 if (user) {
 try {
   const userDoc = await getDoc(doc(db, 'users', user.uid));
   if (userDoc.exists() && userDoc.data().onboardingCompleted) {
     setNeedsOnboarding(false);
     // Fetch tenant plan if user belongs to a tenant
     // Check user doc first, then cookie (set by middleware from subdomain)
     const userTenantId = userDoc.data().tenantId || (() => {
       const cookies = document.cookie.split(';');
       const tc = cookies.find(c => c.trim().startsWith('tenantId='));
       return tc ? tc.split('=')[1].trim() : null;
     })();
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
     if (currentPageRef.current === 'auth') {
       setCurrentPage('home');
     }
   } else {
 setNeedsOnboarding(true);
 if (currentPageRef.current === 'auth') {
 setCurrentPage('onboarding');
 }
 }
 } catch (error) {
 try {
 handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
 } catch (e) {
 }
 setNeedsOnboarding(false);
 if (currentPageRef.current === 'auth') {
 setCurrentPage('home');
 }
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
 }, []);

 const navigateTo = (page: string) => {
 setCurrentPage(page);
 window.scrollTo(0, 0);
 };

 const renderLoading = () => (
 <div className="min-h-screen flex items-center justify-center bg-background-dark">
 <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
 </div>
 );

 if (!isAuthReady) {
 return renderLoading();
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

 return (
 <AuthPage onNavigate={navigateTo} />
 );
};

export default App;
