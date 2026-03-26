'use client';
import React, { useState, useEffect, useRef } from 'react';
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
import PrivacyPolicy from './components/PrivacyPolicy';
import ContactSupport from './components/ContactSupport';
import TermsOfUse from './components/TermsOfUse';
import FAQ from './components/FAQ';
import AuthPage from './components/AuthPage';
import MainApp from './components/MainApp';
import Onboarding from './components/Onboarding';
import AdminDashboard from './components/AdminDashboard';

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

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-background-dark"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
  }

  if (currentPage === 'onboarding') {
    return <Onboarding onComplete={() => navigateTo('home')} />;
  }

  if (currentPage === 'home') {
    return <MainApp onNavigate={navigateTo} />;
  }

  if (currentPage === 'auth') {
    return <AuthPage onBack={() => navigateTo('landing')} onNavigate={navigateTo} />;
  }

  if (currentPage === 'admin') {
    return <AdminDashboard onNavigate={navigateTo} />;
  }

  if (currentPage === 'privacy-policy') {
    return (
        <div className="min-h-screen flex flex-col font-sans">
             <Navbar isHome={false} onNavigate={navigateTo} />
             <main className="flex-grow">
                <PrivacyPolicy onBack={() => navigateTo('landing')} />
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
                <TermsOfUse onBack={() => navigateTo('landing')} />
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
                <ContactSupport onBack={() => navigateTo('landing')} />
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
                <FAQ onBack={() => navigateTo('landing')} />
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
