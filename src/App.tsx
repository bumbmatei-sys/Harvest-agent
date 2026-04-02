'use client';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import StatsSection from './components/StatsSection';
import FeaturesSection from './components/FeaturesSection';
import FutureSection from './components/FutureSection';
import CTASection from './components/CTASection';
import DonationSection from './components/DonationSection';
import Footer from './components/Footer';

// Lazy load heavy components
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const ContactSupport = lazy(() => import('./components/ContactSupport'));
const TermsOfUse = lazy(() => import('./components/TermsOfUse'));
const FAQ = lazy(() => import('./components/FAQ'));
const AuthPage = lazy(() => import('./components/AuthPage'));
const MainApp = lazy(() => import('./components/MainApp'));
const Onboarding = lazy(() => import('./components/Onboarding'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

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
  const [currentPage, setCurrentPage] = useState('landing');
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
            if (currentPageRef.current === 'landing' || currentPageRef.current === 'auth') {
              setCurrentPage('home');
            }
          } else {
            setNeedsOnboarding(true);
            if (currentPageRef.current === 'landing' || currentPageRef.current === 'auth') {
              setCurrentPage('onboarding');
            }
          }
        } catch (error) {
          console.error("Error fetching user doc:", error);
          try {
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          } catch (e) {
            // Ignore the thrown error so we can continue the auth flow
          }
          setNeedsOnboarding(false);
          if (currentPageRef.current === 'landing' || currentPageRef.current === 'auth') {
            setCurrentPage('home');
          }
        }
      } else {
        // Only redirect to landing if we are on a protected page
        if (currentPageRef.current !== 'landing' && currentPageRef.current !== 'auth' && currentPageRef.current !== 'privacy-policy' && currentPageRef.current !== 'terms-of-use' && currentPageRef.current !== 'contact-support' && currentPageRef.current !== 'faq') {
          setCurrentPage('landing');
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
      <Suspense fallback={renderLoading()}>
        <Onboarding onComplete={() => navigateTo('home')} />
      </Suspense>
    );
  }

  if (currentPage === 'home') {
    return (
      <Suspense fallback={renderLoading()}>
        <MainApp onNavigate={navigateTo} />
      </Suspense>
    );
  }

  if (currentPage === 'auth') {
    return (
      <Suspense fallback={renderLoading()}>
        <AuthPage onBack={() => navigateTo('landing')} onNavigate={navigateTo} />
      </Suspense>
    );
  }

  if (currentPage === 'admin') {
    return (
      <Suspense fallback={renderLoading()}>
        <AdminDashboard onNavigate={navigateTo} />
      </Suspense>
    );
  }

  if (currentPage === 'privacy-policy') {
    return (
        <div className="min-h-screen flex flex-col font-sans">
             <Navbar isHome={false} onNavigate={navigateTo} />
             <main className="flex-grow">
                <Suspense fallback={renderLoading()}>
                  <PrivacyPolicy onBack={() => navigateTo('landing')} />
                </Suspense>
             </main>
             <Footer onNavigate={navigateTo} />
        </div>
    );
  }

  if (currentPage === 'terms-of-use') {
    return (
        <div className="min-h-screen flex flex-col font-sans">
             <Navbar isHome={false} onNavigate={navigateTo} />
             <main className="flex-grow">
                <Suspense fallback={renderLoading()}>
                  <TermsOfUse onBack={() => navigateTo('landing')} />
                </Suspense>
             </main>
             <Footer onNavigate={navigateTo} />
        </div>
    );
  }

  if (currentPage === 'contact-support') {
    return (
        <div className="min-h-screen flex flex-col font-sans">
             <Navbar isHome={false} onNavigate={navigateTo} />
             <main className="flex-grow">
                <Suspense fallback={renderLoading()}>
                  <ContactSupport onBack={() => navigateTo('landing')} />
                </Suspense>
             </main>
             <Footer onNavigate={navigateTo} />
        </div>
    );
  }

  if (currentPage === 'faq') {
    return (
        <div className="min-h-screen flex flex-col font-sans">
             <Navbar isHome={false} onNavigate={navigateTo} />
             <main className="flex-grow">
                <Suspense fallback={renderLoading()}>
                  <FAQ onBack={() => navigateTo('landing')} />
                </Suspense>
             </main>
             <Footer onNavigate={navigateTo} />
        </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Navbar isHome={true} onNavigate={navigateTo} />
      <main>
        <Hero onNavigate={navigateTo} />
        <StatsSection />
        <FeaturesSection onNavigate={navigateTo} />
        <FutureSection />
        <CTASection onNavigate={navigateTo} />
        <DonationSection />
      </main>
      <Footer onNavigate={navigateTo} />
    </div>
  );
};

export default App;
