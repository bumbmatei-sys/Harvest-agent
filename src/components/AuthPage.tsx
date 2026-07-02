"use client";
import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { useTenant } from '../contexts/TenantContext';
import { Eye, EyeOff } from 'lucide-react';

const HARVEST_GOLD = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/** Multi-colour Google "G" mark. */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
);

interface AuthPageProps {
  onNavigate: (page: string) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  const [isLogin, setIsLogin] = useState(() => {
    // Signup intent may be in the URL (?signup=…) OR preserved by App.tsx in
    // sessionStorage['harvest_signup'] after the /auth redirect drops the query.
    try {
      const fromUrl = new URLSearchParams(window.location.search).has('signup');
      const fromStore = !!sessionStorage.getItem('harvest_signup');
      return !(fromUrl || fromStore);
    } catch { return true; }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newsletter, setNewsletter] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isChurchSignup, setIsChurchSignup] = useState(false);
  const { branding, tenantId: ctxTenantId, tenantName, tenantPlan } = useTenant();
  const isSubdomain = !!ctxTenantId;
  const hasCustomBranding = tenantPlan === 'max' || tenantPlan === 'ultra';

  const [legalModalContent, setLegalModalContent] = useState<'terms' | 'privacy' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Branding: logo + brand colour only gate on plan; the page is always white.
  const brandColor = hasCustomBranding && branding.primaryColor ? branding.primaryColor : HARVEST_GOLD;
  const logoSrc = hasCustomBranding && branding.logo ? branding.logo : HARVEST_LOGO;
  const appName = isChurchSignup ? 'Ministry' : (isSubdomain && tenantName ? tenantName : 'Harvest');

  useEffect(() => {
    // Derive tenantId from hostname (not spoofable) — cookie is fallback for custom domains
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    if (parts.length >= 3 && (hostname.endsWith('.theharvest.app') || hostname.endsWith('.vercel.app'))) {
      setTenantId(parts[0]);
    } else {
      // Custom domain — use cookie (set server-side by middleware via resolve-domain)
      const cookies = document.cookie.split(';');
      const tenantCookie = cookies.find(c => c.trim().startsWith('tenantId='));
      if (tenantCookie) {
        setTenantId(tenantCookie.split('=')[1].trim());
      }
    }
    // Check if arriving from presentation site "Start Ministry" button
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === 'church') {
      setIsChurchSignup(true);
    }
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError('');

      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      // Store user in Firestore
      const userRef = doc(db, 'users', result.user.uid);
      let userSnap;
      try {
        userSnap = await getDoc(userRef);
      } catch (err) {
        try { handleFirestoreError(err, OperationType.GET, `users/${result.user.uid}`); } catch (e) { console.error(e); }
        return;
      }

      if (!userSnap.exists()) {
        try {
          const userData: any = {
            uid: result.user.uid,
            email: result.user.email,
            createdAt: new Date().toISOString(),
            role: 'user',
            tenantId: tenantId || null,
            newsletter: newsletter,
            termsAccepted: true,
          };
          if (result.user.displayName) userData.displayName = result.user.displayName;
          if (result.user.photoURL) userData.photoURL = result.user.photoURL;

          await setDoc(userRef, userData);
        } catch (err) {
          try { handleFirestoreError(err, OperationType.WRITE, `users/${result.user.uid}`); } catch (e) { console.error(e); }
          return;
        }
      } else {
        // Update termsAccepted and newsletter for existing users
        try {
          await updateDoc(userRef, {
            termsAccepted: true,
            newsletter: newsletter,
          });
        } catch (err) {
          try { handleFirestoreError(err, OperationType.UPDATE, `users/${result.user.uid}`); } catch (e) { console.error(e); }
          return;
        }
      }

      // Set custom claims on server, then force-refresh token to pick them up
      try {
        const token = await result.user.getIdToken();
        await fetch('/api/auth/set-claims', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: result.user.uid }),
        });
        // Force token refresh so subsequent Firestore/API calls have the new claims
        await result.user.getIdToken(true);
      } catch (claimsErr) {
        console.error('Failed to refresh custom claims:', claimsErr);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled.');
      } else {
        setError(err.message || 'Failed to sign in with Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        // Update termsAccepted and newsletter for existing users
        try {
          const userRef = doc(db, 'users', userCredential.user.uid);
          await updateDoc(userRef, {
            termsAccepted: true,
            newsletter: newsletter,
          });
        } catch (err) {
          try { handleFirestoreError(err, OperationType.UPDATE, `users/${userCredential.user.uid}`); } catch (e) { console.error(e); }
          return;
        }

        // Set custom claims on server, then force-refresh token
        try {
          const token = await userCredential.user.getIdToken();
          await fetch('/api/auth/set-claims', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: userCredential.user.uid }),
          });
          await userCredential.user.getIdToken(true);
        } catch (claimsErr) {
          console.error('Failed to refresh custom claims:', claimsErr);
        }
      } else {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          setLoading(false);
          return;
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{10,}$/;
        if (!passwordRegex.test(password)) {
          setError('Password must be at least 10 characters long, contain at least 1 capital letter, and 1 symbol.');
          setLoading(false);
          return;
        }

        const result = await createUserWithEmailAndPassword(auth, email, password);

        // Store user in Firestore
        try {
          await setDoc(doc(db, 'users', result.user.uid), {
            uid: result.user.uid,
            email: result.user.email,
            displayName: email.split('@')[0],
            createdAt: new Date().toISOString(),
            role: 'user',
            tenantId: tenantId || null,
            newsletter: newsletter,
            termsAccepted: true,
          });
        } catch (err) {
          try { handleFirestoreError(err, OperationType.WRITE, `users/${result.user.uid}`); } catch (e) { console.error(e); }
          return;
        }

        setSuccess('Account created successfully!');

        // Set custom claims for Firestore security rules, then force-refresh token
        try {
          const token = await result.user.getIdToken();
          await fetch('/api/auth/set-claims', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: result.user.uid }),
          });
          await result.user.getIdToken(true);
        } catch (claimsErr) {
          console.error('Failed to set custom claims:', claimsErr);
        }
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/operation-not-allowed') {
        setError('Email/Password sign-in is not enabled. Please enable it in the Firebase Console.');
      } else {
        setError(err.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      await sendPasswordResetEmail(auth, forgotEmail);
      setSuccess('Password reset email sent! Check your inbox.');
      setShowForgotPassword(false);
      setForgotEmail('');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found') {
        setError('No account found with that email address.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(err.message || 'Failed to send reset email.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Shared input styling: white bg, light border, dark text, brand-coloured focus ring.
  const inputClass =
    'w-full px-4 py-3 rounded-xl bg-white text-[#111111] placeholder-[#AAAAAA] border outline-none transition-colors';
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = brandColor; },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#E2E2E2'; },
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-sm mx-auto px-6 min-h-screen flex flex-col justify-center">
        {/* Logo */}
        <div className="flex justify-center mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt={`${appName} logo`} className="h-20 w-auto object-contain" />
        </div>

        {/* App name + tagline */}
        <h1 className="text-center font-semibold" style={{ fontSize: 22, color: '#111111' }}>
          {appName}
        </h1>
        <p className="text-center mt-1" style={{ fontSize: 13, color: '#888888' }}>
          {isChurchSignup
            ? "Create your account to set up your church's app"
            : (isLogin ? 'Sign in to continue' : 'Create your account')}
        </p>

        {/* Messages */}
        {error && (
          <div className="mt-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-6 p-3 bg-green-50 border border-green-100 text-green-700 text-sm rounded-xl">
            {success}
          </div>
        )}

        {showForgotPassword ? (
          /* ── Forgot password sub-view ── */
          <form onSubmit={handleForgotPassword} className="mt-7 space-y-4">
            <p className="text-sm" style={{ color: '#666666' }}>
              Enter your email address and we&apos;ll send you a link to reset your password.
            </p>
            <input
              type="email"
              required
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              className={inputClass}
              style={{ borderColor: '#E2E2E2' }}
              {...focusHandlers}
              placeholder="you@example.com"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-semibold py-3 px-4 rounded-xl transition-all disabled:opacity-50"
              style={{ backgroundColor: brandColor }}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setShowForgotPassword(false); setError(''); setSuccess(''); }}
                className="text-sm font-semibold hover:underline"
                style={{ color: brandColor }}
              >
                Back to sign in
              </button>
            </div>
          </form>
        ) : (
          /* ── Main auth view ── */
          <div className="mt-7">
            {/* Google */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white rounded-xl shadow-sm border py-3 px-4 font-semibold transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ borderColor: '#E2E2E2', color: '#111111' }}
            >
              <GoogleIcon /> Sign in with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-3">
              <div className="h-px flex-1" style={{ backgroundColor: '#EEEEEE' }} />
              <span className="text-xs" style={{ color: '#999999' }}>or</span>
              <div className="h-px flex-1" style={{ backgroundColor: '#EEEEEE' }} />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-3">
              {/* Email */}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                style={{ borderColor: '#E2E2E2' }}
                {...focusHandlers}
                placeholder="you@example.com"
              />

              {/* Password with show/hide toggle */}
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-11`}
                  style={{ borderColor: '#E2E2E2' }}
                  {...focusHandlers}
                  placeholder="Password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999999] hover:text-[#555555] transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {!isLogin && (
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  style={{ borderColor: '#E2E2E2' }}
                  {...focusHandlers}
                  placeholder="Confirm password"
                />
              )}

              {!isLogin && (
                <p className="text-xs" style={{ color: '#999999' }}>
                  Must be at least 10 characters, 1 capital letter, and 1 symbol.
                </p>
              )}

              {!isLogin && (
                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={newsletter}
                    onChange={(e) => setNewsletter(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-gray-300 cursor-pointer"
                    style={{ accentColor: brandColor }}
                  />
                  <span className="text-xs" style={{ color: '#666666' }}>
                    Sign up for the Harvest newsletter to receive updates and news.
                  </span>
                </label>
              )}

              {isLogin && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => { setShowForgotPassword(true); setForgotEmail(email); setError(''); setSuccess(''); }}
                    className="text-sm font-medium hover:underline"
                    style={{ color: brandColor }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-semibold py-3 px-4 rounded-xl transition-all disabled:opacity-50 !mt-4"
                style={{ backgroundColor: brandColor }}
              >
                {loading ? 'Please wait…' : (isLogin ? 'Sign In' : 'Sign Up')}
              </button>
            </form>

            {/* Toggle login / signup */}
            <p className="text-center text-sm mt-4" style={{ color: '#666666' }}>
              {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                onClick={() => { setIsLogin(!isLogin); setError(''); setSuccess(''); }}
                className="font-semibold hover:underline"
                style={{ color: brandColor }}
              >
                {isLogin ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>
        )}

        {/* Terms */}
        <p className="text-center text-xs mt-8 mb-2" style={{ color: '#999999' }}>
          By registering you accept the{' '}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLegalModalContent('terms'); }}
            className="hover:underline"
            style={{ color: brandColor }}
          >
            Terms of Use
          </button>
          {' '}and{' '}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLegalModalContent('privacy'); }}
            className="hover:underline"
            style={{ color: brandColor }}
          >
            Privacy Policy
          </button>
          .
        </p>
      </div>

      {legalModalContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-2xl font-bold text-gray-900">
                {legalModalContent === 'terms' ? 'Terms of Use' : 'Privacy Policy'}
              </h3>
              <button onClick={() => setLegalModalContent(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 overflow-y-auto text-gray-600 space-y-4">
              {legalModalContent === 'terms' ? (
                <>
                  <p><strong>1. Acceptance of Terms</strong><br/>By accessing and using the Harvest App, you accept and agree to be bound by the terms and provision of this agreement.</p>
                  <p><strong>2. Description of Service</strong><br/>Harvest provides users with access to a rich collection of resources, including various communications tools, forums, shopping services, and personalized content.</p>
                  <p><strong>3. User Conduct</strong><br/>You agree to use the service only for lawful purposes and in a way that does not infringe the rights of, restrict or inhibit anyone else&apos;s use and enjoyment of the website.</p>
                  <p><strong>4. Intellectual Property</strong><br/>All content included on this site, such as text, graphics, logos, button icons, images, audio clips, digital downloads, data compilations, and software, is the property of Harvest or its content suppliers.</p>
                </>
              ) : (
                <>
                  <p><strong>1. Information We Collect</strong><br/>We collect information to provide better services to all our users. We collect information in the following ways: information you give us, and information we get from your use of our services.</p>
                  <p><strong>2. How We Use Information</strong><br/>We use the information we collect from all our services to provide, maintain, protect and improve them, to develop new ones, and to protect Harvest and our users.</p>
                  <p><strong>3. Information We Share</strong><br/>We do not share personal information with companies, organizations and individuals outside of Harvest unless one of the following circumstances applies: with your consent, for external processing, or for legal reasons.</p>
                  <p><strong>4. Data Security</strong><br/>We work hard to protect Harvest and our users from unauthorized access to or unauthorized alteration, disclosure or destruction of information we hold.</p>
                </>
              )}
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                onClick={() => setLegalModalContent(null)}
                className="px-6 py-2 text-white font-bold rounded-xl transition-colors"
                style={{ backgroundColor: brandColor }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPage;
