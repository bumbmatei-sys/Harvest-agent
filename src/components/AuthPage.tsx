"use client";
import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { isNonTenantSubdomain, isAffiliateHost } from '../utils/non-tenant-subdomains';
import { useTenant } from '../contexts/TenantContext';
import { Eye, EyeOff, Mail, Lock, ArrowLeft, X } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';

const HARVEST_GOLD = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

// Hairline stone border used across the auth fields at rest (brand border-light).
const FIELD_BORDER = 'var(--stone-200, #E8E2D9)';

/** Multi-colour Google "G" mark. */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
);

/* ── Shared brand chrome (cream editorial ground, Fraunces display) ─────────── */

/** Cream editorial ground that frames every auth/onboarding screen. */
const AuthShell: React.FC<{ children: React.ReactNode; signature?: boolean }> = ({ children, signature }) => (
  <div
    className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-16 sm:py-20"
    style={{ background: 'var(--cream, #FAF8F5)' }}
  >
    {/* soft gold halo */}
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={{ top: '-18%', width: 760, height: 540, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
    />
    {/* top-left brand tagline (desktop) */}
    <div className="absolute left-8 top-8 hidden items-center gap-2 sm:flex" style={{ color: 'var(--text-faint, #A89A87)' }}>
      <span className="h-px w-6" style={{ background: 'var(--stone-300, #D6CCBE)' }} />
      <span className="text-xs font-medium">The digital foundation for ministries</span>
    </div>
    <div className="relative z-[1] flex w-full flex-col items-center">
      {children}
      {signature && (
        <p className="mt-7 font-display italic" style={{ fontWeight: 300, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-body, #4A4038)' }}>
          From conversion to devotion.
        </p>
      )}
    </div>
  </div>
);

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <div className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.19em', color: color || HARVEST_GOLD }}>
    {children}
  </div>
);

const Display: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 30 }) => (
  <h1 className="font-display" style={{ fontWeight: 300, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--text-heading, #2D2519)', margin: 0 }}>
    {children}
  </h1>
);

/** Text field with a leading line-icon and a brand-coloured focus ring. */
const IconInput: React.FC<
  { icon?: React.ReactNode; brandColor: string; invalid?: boolean } & React.InputHTMLAttributes<HTMLInputElement>
> = ({ icon, brandColor, invalid, ...props }) => {
  const [focus, setFocus] = useState(false);
  const border = invalid ? 'var(--brand-danger, #C4553B)' : focus ? brandColor : FIELD_BORDER;
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg bg-white transition-all"
      style={{ height: 48, padding: '0 14px', border: `1px solid ${border}`, boxShadow: focus ? `0 0 0 3px color-mix(in srgb, ${brandColor} 16%, transparent)` : 'none' }}
    >
      {icon && <span className="flex shrink-0" style={{ color: 'var(--text-muted, #8B7355)' }}>{icon}</span>}
      <input
        {...props}
        onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#A89A87]"
        style={{ fontSize: 15, color: 'var(--text-heading, #2D2519)' }}
      />
    </div>
  );
};

/** Password field: leading lock icon + trailing show/hide toggle. */
const PasswordInput: React.FC<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  show: boolean;
  onToggle: () => void;
  brandColor: string;
  required?: boolean;
}> = ({ value, onChange, placeholder, show, onToggle, brandColor, required }) => {
  const [focus, setFocus] = useState(false);
  const border = focus ? brandColor : FIELD_BORDER;
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg bg-white transition-all"
      style={{ height: 48, padding: '0 14px', border: `1px solid ${border}`, boxShadow: focus ? `0 0 0 3px color-mix(in srgb, ${brandColor} 16%, transparent)` : 'none' }}
    >
      <span className="flex shrink-0" style={{ color: 'var(--text-muted, #8B7355)' }}><Lock size={16} /></span>
      <input
        type={show ? 'text' : 'password'}
        required={required}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#A89A87]"
        style={{ fontSize: 15, color: 'var(--text-heading, #2D2519)' }}
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="flex shrink-0 transition-colors"
        style={{ color: 'var(--text-muted, #8B7355)' }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
};

/** Pill toggle used for the newsletter opt-in. */
const ToggleSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; color: string }> = ({ checked, onChange, color }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="relative shrink-0 rounded-full transition-colors"
    style={{ width: 42, height: 24, padding: 2, background: checked ? color : 'var(--stone-300, #D6CCBE)' }}
  >
    <span
      className="block rounded-full bg-white transition-transform"
      style={{ width: 20, height: 20, transform: checked ? 'translateX(18px)' : 'translateX(0)', boxShadow: '0 1px 2px rgba(45,37,25,0.2)' }}
    />
  </button>
);

const fieldLabel = 'mb-1.5 block text-xs font-semibold';

interface AuthPageProps {
  onNavigate: (page: string) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  // Affiliate product surface (affiliate.theharvest.app). The subdomain IS the
  // signal — no ?signup param needed — so it drives both the affiliate copy and
  // the default view below. The SPA is client-only (App is imported with
  // ssr:false), so reading window.location during render is safe here, and the
  // hostname is stable for the session.
  const isAffiliate = typeof window !== 'undefined' && isAffiliateHost(window.location.hostname);

  const [isLogin, setIsLogin] = useState(() => {
    // Signup intent may be in the URL (?signup=…) OR preserved by App.tsx in
    // sessionStorage['harvest_signup'] after the /auth redirect drops the query.
    // On the affiliate host the subdomain implies signup intent, so default to
    // the sign-up view there too (returning affiliates use the "Sign in" toggle).
    try {
      const fromUrl = new URLSearchParams(window.location.search).has('signup');
      const fromStore = !!sessionStorage.getItem('harvest_signup');
      return !(fromUrl || fromStore || isAffiliate);
    } catch { return !isAffiliate; }
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
  // Cloudflare Turnstile — bot gate on email/password sign-in AND sign-up.
  // Bumping turnstileKey remounts the widget, forcing a fresh single-use token.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);

  // Branding: logo + brand colour only gate on plan; the page is always white.
  const brandColor = hasCustomBranding && branding.primaryColor ? branding.primaryColor : HARVEST_GOLD;
  const logoSrc = hasCustomBranding && branding.logo ? branding.logo : HARVEST_LOGO;
  const appName = isChurchSignup
    ? 'Ministry'
    : isAffiliate
      ? 'Harvest affiliate'
      : (isSubdomain && tenantName ? tenantName : 'Harvest');

  useEffect(() => {
    // Derive tenantId from hostname (not spoofable) — cookie is fallback for custom domains
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    // Non-tenant subdomains (www/app/admin/affiliate) are platform aliases, not
    // tenants — skip them here so the auth screen never derives a bogus tenantId.
    if (parts.length >= 3 && (hostname.endsWith('.theharvest.app') || hostname.endsWith('.vercel.app')) && !isNonTenantSubdomain(parts[0])) {
      setTenantId(parts[0]);
    } else {
      // Custom domain (or non-tenant subdomain) — use cookie (set server-side by middleware via resolve-domain)
      const cookies = document.cookie.split(';');
      const tenantCookie = cookies.find(c => c.trim().startsWith('tenantId='));
      if (tenantCookie) {
        setTenantId(tenantCookie.split('=')[1].trim());
      }
    }
    // Check if arriving from presentation site "Start Ministry" button. On the
    // affiliate host the subdomain implies affiliate intent (single-role, hard
    // boundary), so a stray ?signup=church never flips this screen into the
    // church flow there — a hostname can't be lost the way a param can.
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === 'church' && !isAffiliateHost(hostname)) {
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

      // Pre-flight bot check — must pass before either Firebase Auth call fires.
      try {
        const verifyRes = await fetch('/api/auth/verify-turnstile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: turnstileToken }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData?.success) {
          throw new Error('verification-failed');
        }
      } catch {
        setError('Verification failed. Please try again.');
        setLoading(false);
        setTurnstileToken(null);
        setTurnstileKey((k) => k + 1);
        return;
      }

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
      // Turnstile tokens are single-use — always remount for a fresh solve so a
      // legitimate retry (e.g. after a mistyped password) doesn't reuse a spent
      // token. Also covers the login/signup mode-toggle case for free.
      setTurnstileToken(null);
      setTurnstileKey((k) => k + 1);
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

  // Editorial eyebrow / title / sub for the current view.
  let eyebrowText: string;
  let titleText: string;
  let subText: string;
  if (showForgotPassword) {
    eyebrowText = 'Reset access';
    titleText = 'Forgot your password?';
    subText = "Enter your email and we'll send you a link to set a new one.";
  } else if (isChurchSignup) {
    eyebrowText = 'Start your ministry';
    titleText = 'Create your account';
    subText = "First, your login. You'll name your ministry and set up your app in the next steps.";
  } else if (isAffiliate) {
    // Affiliate host owns both states so the copy stays business-framed
    // (commission for referring ministries) — never the ministry/faith framing.
    if (isLogin) {
      eyebrowText = 'Welcome back';
      titleText = `Sign in to ${appName}`;
      subText = 'Pick up where you left off — track your referrals and commission.';
    } else {
      eyebrowText = 'Affiliate program';
      titleText = 'Welcome to Harvest affiliate';
      subText = 'Earn recurring commission for every ministry you refer to Harvest — get your account and referral link in one step.';
    }
  } else if (isLogin) {
    eyebrowText = 'Welcome back';
    titleText = `Sign in to ${appName}`;
    subText = 'One home for the whole ministry — pick up right where you left off.';
  } else {
    eyebrowText = 'Join your community';
    titleText = 'Create your account';
    subText = 'Your data. Your brand. One account for everything your ministry publishes.';
  }

  return (
    <>
      <AuthShell signature>
        <div className="w-full" style={{ maxWidth: 452 }}>
          {/* Logo mark */}
          <div className="mb-5 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt={`${appName} logo`} className="h-12 w-auto object-contain" />
          </div>

          {/* Card */}
          <div className="rounded-brand-xl border border-stone-200 bg-white px-6 py-8 shadow-[var(--ds-sh-md)] sm:px-9 sm:py-9">
            <Eyebrow color={brandColor}>{eyebrowText}</Eyebrow>
            <div className="mt-3"><Display size={30}>{titleText}</Display></div>
            <p className="mt-2.5 text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>{subText}</p>

            {/* Messages */}
            {error && (
              <div className="mt-5 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#FBEEEA', borderColor: '#EBD0C7', color: '#B0432B' }}>
                {error}
              </div>
            )}
            {success && (
              <div className="mt-5 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#EEF3E7', borderColor: '#D3E0C1', color: '#4E6A34' }}>
                {success}
              </div>
            )}

            {showForgotPassword ? (
              /* ── Forgot password sub-view ── */
              <form onSubmit={handleForgotPassword} className="mt-6 flex flex-col gap-4">
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>Email</label>
                  <IconInput
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@ministry.org"
                    icon={<Mail size={16} />}
                    brandColor={brandColor}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: brandColor, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${brandColor} 42%, transparent)` }}
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForgotPassword(false); setError(''); setSuccess(''); }}
                  className="flex items-center justify-center gap-1.5 text-sm font-semibold hover:underline"
                  style={{ color: brandColor }}
                >
                  <ArrowLeft size={15} /> Back to sign in
                </button>
              </form>
            ) : (
              /* ── Main auth view ── */
              <div className="mt-6">
                {/* Google */}
                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border bg-white text-sm font-semibold transition-colors hover:bg-stone-100 disabled:opacity-50"
                  style={{ borderColor: 'var(--stone-300, #D6CCBE)', color: 'var(--text-heading, #2D2519)' }}
                >
                  <GoogleIcon /> {isLogin ? 'Continue with Google' : 'Sign up with Google'}
                </button>

                {/* Divider */}
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1" style={{ backgroundColor: FIELD_BORDER }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted, #8B7355)' }}>or</span>
                  <div className="h-px flex-1" style={{ backgroundColor: FIELD_BORDER }} />
                </div>

                <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
                  {/* Email */}
                  <div>
                    <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>Email</label>
                    <IconInput
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@ministry.org"
                      icon={<Mail size={16} />}
                      brandColor={brandColor}
                    />
                  </div>

                  {/* Password with show/hide toggle */}
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <label className="text-xs font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>Password</label>
                      {isLogin && (
                        <button
                          type="button"
                          onClick={() => { setShowForgotPassword(true); setForgotEmail(email); setError(''); setSuccess(''); }}
                          className="text-xs font-semibold hover:underline"
                          style={{ color: brandColor }}
                        >
                          Forgot?
                        </button>
                      )}
                    </div>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isLogin ? 'Your password' : 'Create a password'}
                      show={showPassword}
                      onToggle={() => setShowPassword((s) => !s)}
                      brandColor={brandColor}
                      required
                    />
                  </div>

                  {!isLogin && (
                    <div>
                      <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>Confirm password</label>
                      <IconInput
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        icon={<Lock size={16} />}
                        brandColor={brandColor}
                      />
                    </div>
                  )}

                  {!isLogin && (
                    <p className="-mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted, #8B7355)' }}>
                      At least 10 characters, one capital letter, and one symbol.
                    </p>
                  )}

                  {!isLogin && (
                    <div className="flex items-start gap-3">
                      <ToggleSwitch checked={newsletter} onChange={setNewsletter} color={brandColor} />
                      <span className="text-xs leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
                        Send me the Harvest newsletter — product updates and ministry stories. No noise.
                      </span>
                    </div>
                  )}

                  {/* Bot gate — renders for both Sign In and Sign Up. Submit stays
                      disabled until solved; key remount forces a fresh single-use token. */}
                  <div className="flex justify-center pt-1">
                    <Turnstile
                      key={turnstileKey}
                      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY as string}
                      onSuccess={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken(null)}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !turnstileToken}
                    className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-lg font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: brandColor, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${brandColor} 42%, transparent)` }}
                  >
                    {loading ? 'Please wait…' : (isLogin ? 'Sign in' : 'Create account')}
                  </button>
                </form>

                {/* Toggle login / signup */}
                <p className="mt-5 text-center text-[13px]" style={{ color: 'var(--text-body, #4A4038)' }}>
                  {isLogin ? 'New to Harvest?' : 'Already have an account?'}{' '}
                  <button
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setError('');
                      setSuccess('');
                      // Reset the bot gate on mode switch so a token solved for one
                      // view never carries over to the other (a submit's finally block
                      // handles the post-attempt case; this handles a direct toggle).
                      setTurnstileToken(null);
                      setTurnstileKey((k) => k + 1);
                    }}
                    className="font-semibold hover:underline"
                    style={{ color: brandColor }}
                  >
                    {isLogin ? 'Create an account' : 'Sign in'}
                  </button>
                </p>
              </div>
            )}
          </div>

          {/* Terms */}
          <p className="mt-5 text-center text-xs leading-relaxed" style={{ color: 'var(--text-muted, #8B7355)' }}>
            By continuing you accept the{' '}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLegalModalContent('terms'); }}
              className="underline"
              style={{ color: brandColor }}
            >
              Terms of Use
            </button>
            {' '}and{' '}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLegalModalContent('privacy'); }}
              className="underline"
              style={{ color: brandColor }}
            >
              Privacy Policy
            </button>
            .
          </p>
        </div>
      </AuthShell>

      {legalModalContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-brand-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-100 p-6">
              <h3 className="font-display text-2xl font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
                {legalModalContent === 'terms' ? 'Terms of Use' : 'Privacy Policy'}
              </h3>
              <button onClick={() => setLegalModalContent(null)} className="transition-colors" style={{ color: 'var(--text-muted, #8B7355)' }} aria-label="Close">
                <X size={22} />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto p-6" style={{ color: 'var(--text-body, #4A4038)' }}>
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
            <div className="flex justify-end border-t border-stone-200 bg-stone-100 p-6">
              <button
                onClick={() => setLegalModalContent(null)}
                className="rounded-lg px-6 py-2.5 font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: brandColor }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AuthPage;
