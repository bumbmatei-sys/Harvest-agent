'use client';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import AuthPage from './components/AuthPage';
import MainApp from './components/MainApp';
import Onboarding from './components/Onboarding';
import AdminDashboard from './components/AdminDashboard';
import PWAInstallManager from './components/PWAInstallManager';

enum OperationType {
 CREATE = 'create',
 UPDATE = 'update',
 DELETE = 'delete',
 LIST = 'list',
 GET = 'get',
 WRITE = 'write',
}

interface FirestoreErrorInfo {
 error: string;
 operationType: OperationType;
 path: string | null;
 authInfo: {
 userId: string | undefined;
 email: string | null | undefined;
 emailVerified: boolean | undefined;
 isAnonymous: boolean | undefined;
 tenantId: string | null | undefined;
 providerInfo: {
 providerId: string;
 displayName: string | null;
 email: string | null;
 photoUrl: string | null;
 }[];
 }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
 const errInfo: FirestoreErrorInfo = {
 error: error instanceof Error ? error.message : String(error),
 authInfo: {
 userId: auth.currentUser?.uid,
 email: auth.currentUser?.email,
 emailVerified: auth.currentUser?.emailVerified,
 isAnonymous: auth.currentUser?.isAnonymous,
 tenantId: auth.currentUser?.tenantId,
 providerInfo: auth.currentUser?.providerData.map(provider => ({
 providerId: provider.providerId,
 displayName: provider.displayName,
 email: provider.email,
 photoUrl: provider.photoURL
 })) || []
 },
 operationType,
 path
 }
 console.error('Firestore Error: ', JSON.stringify(errInfo));
 throw new Error(JSON.stringify(errInfo));
}

const App: React.FC = () => {
 const [currentPage, setCurrentPage] = useState('auth');
 const [isAuthReady, setIsAuthReady] = useState(false);
 const [needsOnboarding, setNeedsOnboarding] = useState(false);
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
 <MainApp onNavigate={navigateTo} />
 <PWAInstallManager />
 </>
 );
 }

 if (currentPage === 'admin') {
 return (
 <>
 <AdminDashboard onNavigate={navigateTo} />
 <PWAInstallManager />
 </>
 );
 }

 return (
 <AuthPage onNavigate={navigateTo} />
 );
};

export default App;
