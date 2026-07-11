"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, messaging, VAPID_KEY } from '../firebase';
import { doc, updateDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import CountrySelect from './CountrySelect';
import { useTenant } from '../contexts/TenantContext';
import { getTenantScope } from '../utils/tenant-scope';
import { CheckCircle2, ArrowRight, ArrowLeft, MapPin, Share, Download, Bell, User, Phone } from 'lucide-react';
import type { TenantPlan } from '../types/tenant.types';

const GOLD = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/* ── Shared brand chrome (cream editorial ground, Fraunces display) ─────────── */

/** Cream editorial ground that frames the onboarding flow. */
const OnbShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-14 sm:py-20"
    style={{ background: 'var(--cream, #FAF8F5)' }}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={{ top: '-18%', width: 760, height: 540, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
    />
    <div className="absolute left-8 top-8 hidden items-center gap-2 sm:flex" style={{ color: 'var(--text-faint, #A89A87)' }}>
      <span className="h-px w-6" style={{ background: 'var(--stone-300, #D6CCBE)' }} />
      <span className="text-xs font-medium">The digital foundation for ministries</span>
    </div>
    <div className="relative z-[1] w-full" style={{ maxWidth: 452 }}>{children}</div>
  </div>
);

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.19em', color: GOLD }}>{children}</div>
);

const Display: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 28 }) => (
  <h1 className="font-display" style={{ fontWeight: 300, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--text-heading, #2D2519)', margin: 0 }}>
    {children}
  </h1>
);

/** Text field with a leading line-icon and a brand-coloured focus ring. */
const ObInput: React.FC<{ icon?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>> = ({ icon, ...props }) => {
  const [focus, setFocus] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg bg-white transition-all"
      style={{ height: 48, padding: '0 14px', border: `1px solid ${focus ? GOLD : 'var(--stone-200, #E8E2D9)'}`, boxShadow: focus ? `0 0 0 3px color-mix(in srgb, ${GOLD} 16%, transparent)` : 'none' }}
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

const fieldLabel = 'mb-1.5 block text-xs font-semibold';
const cardClass = 'rounded-brand-xl border border-stone-200 bg-white shadow-[var(--ds-sh-md)]';
// Soft brand-tinted disc background for step icons (tenant-aware).
const goldDisc = { background: 'color-mix(in srgb, var(--brand-color, #C9963A) 13%, white)', color: GOLD } as React.CSSProperties;

interface OnboardingQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'textarea';
  options?: string[];
  required: boolean;
  order: number;
}

interface OnboardingProps {
  onComplete: () => void;
  /** Plan the user is signing up for (passed from the router; not required here). */
  signupPlan?: TenantPlan;
}

interface StepDef {
  kind:
    | 'default_name'
    | 'default_location'
    | 'default_phone'
    | 'default_faith'
    | 'custom'
    | 'pwaInstall'
    | 'notifications'
    | 'done';
  question?: OnboardingQuestion;
  faithLabel?: string;
}

/** System steps appear after all admin-configured questions, before entering the app. */
const isSystemKind = (k: StepDef['kind']) =>
  k === 'pwaInstall' || k === 'notifications' || k === 'done';

const DEFAULT_QUESTION_STEPS: StepDef[] = [
  { kind: 'default_name' },
  { kind: 'default_location' },
  { kind: 'default_phone' },
  { kind: 'default_faith', faithLabel: 'Have you accepted Jesus?' },
];

// ─── System Step: Install the App ─────────────────────────────────────────────

const InstructionRow: React.FC<{ num: number; children: React.ReactNode }> = ({ num, children }) => (
  <div className="flex items-center gap-3 rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-sunken, #F3EEE7)' }}>
    <span
      className="flex h-6.5 w-6.5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ width: 26, height: 26, backgroundColor: GOLD }}
    >
      {num}
    </span>
    <span className="flex-1 pt-0.5 text-sm leading-snug" style={{ color: 'var(--text-body, #4A4038)' }}>{children}</span>
  </div>
);

const PwaInstallStep: React.FC<{
  deferredPrompt: React.MutableRefObject<any>;
  onDone: () => void;
}> = ({ deferredPrompt, onDone }) => {
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  const isMobile = isIOS || isAndroid;
  const [installing, setInstalling] = useState(false);
  // `beforeinstallprompt` fires on Chromium browsers — Android AND desktop
  // Chrome/Edge — so a native one-tap install is offered on desktop too, not
  // only on mobile. Mirror the parent-cached prompt into state (and keep our
  // own listener) so we react whether it fired before or after this step mounts.
  const [nativeReady, setNativeReady] = useState<boolean>(!!deferredPrompt.current);

  const finish = () => {
    try { localStorage.setItem('pwa_installed', 'true'); } catch { /* ignore */ }
    onDone();
  };

  useEffect(() => {
    if (deferredPrompt.current) setNativeReady(true);
    const handler = (e: any) => { e.preventDefault(); deferredPrompt.current = e; setNativeReady(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNativeInstall = async () => {
    const dp = deferredPrompt.current;
    if (!dp) return; // fallback instructions are rendered instead
    setInstalling(true);
    try {
      dp.prompt();
      await dp.userChoice;
    } catch { /* ignore */ }
    deferredPrompt.current = null;
    setInstalling(false);
    finish();
  };

  // A native install prompt is available (Android or desktop Chrome/Edge).
  const showNativeInstall = nativeReady;

  // Mobile (iOS / Android without a native prompt) → add-to-home-screen steps.
  const manualInstructions = (
    <div className="mb-6 space-y-2.5">
      <InstructionRow num={1}>
        Tap the <strong className="font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>Share</strong> button at the bottom of
        your browser <Share size={15} className="inline-block align-text-bottom" style={{ color: GOLD }} />
      </InstructionRow>
      <InstructionRow num={2}>
        Scroll down and tap <strong className="font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>Add to Home Screen</strong>
      </InstructionRow>
      <InstructionRow num={3}>
        Tap <strong className="font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>Add</strong> — you&apos;re done!
      </InstructionRow>
    </div>
  );

  // Desktop without a native prompt (e.g. Safari / Firefox) → point at the
  // browser's own install affordance rather than mobile Share steps.
  const desktopInstructions = (
    <div className="mb-6 space-y-2.5">
      <InstructionRow num={1}>
        Open the <strong className="font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>install icon</strong> in your browser&apos;s address bar (or the browser menu)
      </InstructionRow>
      <InstructionRow num={2}>
        Choose <strong className="font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>Install Harvest</strong> (or <strong className="font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>Add to Dock</strong>)
      </InstructionRow>
      <InstructionRow num={3}>
        Confirm — Harvest opens like a native app
      </InstructionRow>
    </div>
  );

  return (
    <div className="py-1">
      <Eyebrow>Almost there</Eyebrow>
      <div className="mt-4 mb-5 flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-brand-lg" style={goldDisc}>
          {isIOS ? <Share size={32} /> : <Download size={32} />}
        </div>
      </div>
      <h1 className="mb-1.5 text-center font-display" style={{ fontWeight: 300, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Install the app</h1>
      <p className="mb-6 text-center text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
        {showNativeInstall
          ? 'Add Harvest to your device for one-tap access — it works like a native app, offline included.'
          : isMobile
            ? 'Add Harvest to your home screen for one-tap access — it works like a native app, offline included.'
            : 'Install Harvest as a desktop app for one-tap access — it works like a native app, offline included.'}
      </p>

      {showNativeInstall ? (
        <button
          onClick={handleNativeInstall}
          disabled={installing}
          className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg font-semibold text-white transition-all disabled:opacity-50"
          style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}
        >
          <Download size={18} /> {installing ? 'Installing…' : 'Install app'}
        </button>
      ) : (
        <>
          {isMobile ? manualInstructions : desktopInstructions}
          <button
            onClick={finish}
            className="mb-3 flex h-12 w-full items-center justify-center rounded-lg font-semibold text-white transition-all"
            style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}
          >
            I&apos;ve added it
          </button>
        </>
      )}

      <button
        onClick={finish}
        className="w-full py-1 text-center text-sm font-semibold transition-colors hover:opacity-70"
        style={{ color: 'var(--text-body, #4A4038)' }}
      >
        Skip for now
      </button>
    </div>
  );
};

// ─── System Step: Enable Notifications ────────────────────────────────────────

const NotificationsStep: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [requesting, setRequesting] = useState(false);

  const finish = () => {
    try { localStorage.setItem('notifications_prompted', 'true'); } catch { /* ignore */ }
    onDone();
  };

  const handleEnable = async () => {
    setRequesting(true);
    try {
      if (typeof Notification !== 'undefined') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          // Best-effort: register the FCM token so push actually reaches this device.
          try {
            const msg = await messaging;
            const user = auth.currentUser;
            if (msg && user) {
              const token = await getToken(msg, { vapidKey: VAPID_KEY });
              if (token) {
                // fcmTokens only — users.tenantId is locked to self-edits by
                // firestore.rules (server-authority; bundling it here used to
                // make the whole write fail whenever the scope differed).
                await updateDoc(doc(db, 'users', user.uid), {
                  fcmTokens: arrayUnion(token),
                });
              }
            }
          } catch (e) {
            console.error('Failed to register notification token:', e);
          }
        }
      }
    } catch (e) {
      console.error('Notification permission request failed:', e);
    } finally {
      setRequesting(false);
      finish();
    }
  };

  return (
    <div className="py-1">
      <Eyebrow>One last thing</Eyebrow>
      <div className="mt-4 mb-5 flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-brand-lg" style={goldDisc}>
          <Bell size={34} />
        </div>
      </div>
      <h1 className="mb-1.5 text-center font-display" style={{ fontWeight: 300, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Stay connected</h1>
      <p className="mb-6 text-center text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
        Turn on notifications for messages, prayer updates and announcements from your ministry.
      </p>

      <button
        onClick={handleEnable}
        disabled={requesting}
        className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg font-semibold text-white transition-all disabled:opacity-50"
        style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}
      >
        <Bell size={18} /> {requesting ? 'Enabling…' : 'Enable notifications'}
      </button>
      <button
        onClick={finish}
        className="w-full py-1 text-center text-sm font-semibold transition-colors hover:opacity-70"
        style={{ color: 'var(--text-body, #4A4038)' }}
      >
        Maybe later
      </button>
    </div>
  );
};

// ─── Main Onboarding ──────────────────────────────────────────────────────────

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptedJesus, setAcceptedJesus] = useState('');
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState('');
  const [customQuestions, setCustomQuestions] = useState<OnboardingQuestion[]>([]);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const deferredPrompt = useRef<any>(null);

  // Logo: tenant logo (plan-gated) with the Harvest mark as fallback — same
  // treatment as AuthPage so the auth → onboarding transition feels continuous.
  const { branding, tenantPlan } = useTenant();
  const hasCustomBranding = tenantPlan === 'max' || tenantPlan === 'ultra';
  const logoSrc = hasCustomBranding && branding.logo ? branding.logo : HARVEST_LOGO;

  // Branded field styling for textarea / select (icon inputs use <ObInput/>).
  const brandFieldClass =
    'w-full rounded-lg bg-white px-3.5 py-3 outline-none transition-all placeholder:text-[#A89A87]';
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${GOLD} 16%, transparent)`; },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = 'var(--stone-200, #E8E2D9)'; e.currentTarget.style.boxShadow = 'none'; },
  };
  const fieldStyle: React.CSSProperties = { border: '1px solid var(--stone-200, #E8E2D9)', color: 'var(--text-heading, #2D2519)', fontSize: 15 };

  const steps = useMemo<StepDef[]>(() => {
    // 1) Build the admin-configured question steps.
    let questionSteps: StepDef[];
    if (!questionsLoaded || customQuestions.length === 0) {
      questionSteps = DEFAULT_QUESTION_STEPS;
    } else {
      questionSteps = [];
      let locationAdded = false;
      for (const q of customQuestions) {
        if (q.id === 'default_name') {
          questionSteps.push({ kind: 'default_name' });
        } else if (q.id === 'default_country' || q.id === 'default_city') {
          if (!locationAdded) { questionSteps.push({ kind: 'default_location' }); locationAdded = true; }
        } else if (q.id === 'default_phone') {
          questionSteps.push({ kind: 'default_phone' });
        } else if (q.id === 'default_accepted_jesus') {
          questionSteps.push({ kind: 'default_faith', faithLabel: q.label || 'Have you accepted Jesus?' });
        } else {
          questionSteps.push({ kind: 'custom', question: q });
        }
      }
    }

    // 2) Append the system steps (install + notifications) unless already handled.
    const result: StepDef[] = [...questionSteps];
    if (typeof window !== 'undefined') {
      if (
        !localStorage.getItem('pwa_installed') &&
        !window.matchMedia('(display-mode: standalone)').matches
      ) {
        result.push({ kind: 'pwaInstall' });
      }
      if (
        !localStorage.getItem('notifications_prompted') &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        result.push({ kind: 'notifications' });
      }
    }
    result.push({ kind: 'done' });
    return result;
  }, [customQuestions, questionsLoaded]);

  const currentStep = steps[stepIndex] ?? { kind: 'done' as const };
  const isDone = currentStep.kind === 'done';
  const isSystemStep = currentStep.kind === 'pwaInstall' || currentStep.kind === 'notifications';
  const questionStepCount = steps.filter(s => !isSystemKind(s.kind)).length;

  useEffect(() => {
    if (auth.currentUser?.displayName) setName(auth.currentUser.displayName);

    const loadCustomQuestions = async () => {
      try {
        const tenantId = await getTenantScope();
        if (tenantId) {
          const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
          if (tenantDoc.exists()) {
            const config = tenantDoc.data().config || {};
            if (config.onboardingQuestions && Array.isArray(config.onboardingQuestions)) {
              const questions = config.onboardingQuestions
                .filter((q: any) => q?.id && q?.label)
                .sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) as OnboardingQuestion[];
              setCustomQuestions(questions);
              const initial: Record<string, string> = {};
              questions.forEach((q: OnboardingQuestion) => { initial[q.id] = ''; });
              setCustomAnswers(initial);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load onboarding questions:', err);
      } finally {
        setQuestionsLoaded(true);
      }
    };
    loadCustomQuestions();

    if (navigator.geolocation) {
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude } = pos.coords;
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
            const data = await resp.json();
            if (data?.address) {
              if (data.address.country) setCountry(data.address.country);
              const c = data.address.city || data.address.town || data.address.village || data.address.county || '';
              if (c) setCity(c);
            }
          } catch {}
          setGpsLoading(false);
        },
        () => setGpsLoading(false)
      );
    }
  }, []);

  // Cache the Android install prompt so the PWA step can trigger it on demand.
  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); deferredPrompt.current = e; };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleUseGPS = () => {
    if (!navigator.geolocation) { setError('Geolocation not supported.'); return; }
    setGpsLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await resp.json();
          if (data?.address) {
            if (data.address.country) setCountry(data.address.country);
            const c = data.address.city || data.address.town || data.address.village || data.address.county || '';
            if (c) setCity(c);
          }
        } catch { setError('Could not fetch location.'); }
        setGpsLoading(false);
      },
      () => { setError('Location permission denied.'); setGpsLoading(false); }
    );
  };

  const validate = (s: StepDef): string | null => {
    switch (s.kind) {
      case 'default_name': return name.trim() ? null : 'Please enter your name.';
      case 'default_location': return country ? null : 'Please select your country.';
      case 'default_phone': return phone.trim() ? null : 'Please enter your phone number.';
      case 'default_faith': return acceptedJesus ? null : 'Please answer this question.';
      case 'custom':
        if (s.question?.required && !customAnswers[s.question.id]?.trim())
          return `Please answer: ${s.question.label}`;
        return null;
      default: return null;
    }
  };

  const saveToFirestore = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('No user logged in');
    const updateData: Record<string, any> = {
      displayName: name,
      country,
      city,
      phone,
      acceptedJesus: acceptedJesus === 'yes',
      onboardingCompleted: true,
    };
    // Only persist real custom answers — the default_* ids are stored as
    // top-level fields (displayName/country/city/phone/acceptedJesus), so
    // writing them here too would just pollute onboardingAnswers with blanks.
    const customOnly = Object.fromEntries(
      Object.entries(customAnswers).filter(([k, v]) => !k.startsWith('default_') && !!v?.trim())
    );
    if (Object.keys(customOnly).length > 0) {
      updateData.onboardingAnswers = customOnly;
    }
    await updateDoc(doc(db, 'users', user.uid), updateData);
  };

  // Advance handler used by the self-managed system steps.
  const advanceStep = () => {
    setError('');
    setDir(1);
    setStepIndex(i => i + 1);
  };

  const goNext = async () => {
    // Don't let the user advance until the tenant's question set is finalized,
    // otherwise a fast Enter on the default steps could be invalidated when the
    // (possibly reordered/custom) questions load and the steps array recomputes.
    if (!questionsLoaded) return;
    const err = validate(currentStep);
    if (err) { setError(err); return; }
    setError('');

    const nextIdx = stepIndex + 1;
    const nextStep = steps[nextIdx];

    // Persist answers once, at the transition from the last question step to the
    // first system step (pwaInstall / notifications / done). This means the user
    // can close the browser mid-install without losing their answers.
    if (nextStep && isSystemKind(nextStep.kind)) {
      setLoading(true);
      try {
        await saveToFirestore();
      } catch (e: any) {
        setError(e.message || 'Failed to save. Please try again.');
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    setDir(1);
    setStepIndex(nextIdx);
  };

  const goBack = () => {
    if (stepIndex === 0) return;
    setError('');
    setDir(-1);
    setStepIndex(i => i - 1);
  };

  const getHeading = (s: StepDef): { title: string; sub: string } => {
    switch (s.kind) {
      case 'default_name': return { title: "What should we call you?", sub: "We'll use this to personalize your experience across the app." };
      case 'default_location': return { title: 'Where are you based?', sub: "We'll surface posts, groups and events happening near you." };
      case 'default_phone': return { title: 'Your phone number', sub: 'So your ministry can reach you when it matters most.' };
      case 'default_faith': return { title: s.faithLabel || 'Have you accepted Jesus?', sub: "There's no wrong answer — it just helps us walk with you." };
      case 'custom': return { title: s.question?.label || '', sub: '' };
      default: return { title: '', sub: '' };
    }
  };

  const renderField = (s: StepDef) => {
    switch (s.kind) {
      case 'default_name':
        return (
          <ObInput
            type="text" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
            placeholder="Your full name" autoFocus
            icon={<User size={16} />}
          />
        );
      case 'default_location':
        return (
          <div className="space-y-4">
            <button type="button" onClick={handleUseGPS} disabled={gpsLoading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border bg-white text-sm font-semibold transition-colors hover:bg-stone-100 disabled:opacity-50"
              style={{ borderColor: 'var(--stone-300, #D6CCBE)', color: 'var(--text-heading, #2D2519)' }}>
              <MapPin size={15} />
              {gpsLoading ? 'Detecting your location…' : 'Use my current location'}
            </button>
            <div className="relative z-50">
              <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>Country</label>
              <CountrySelect value={country} onChange={setCountry} className="w-full" />
            </div>
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>City</label>
              <ObInput type="text" value={city} onChange={e => setCity(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
                placeholder="Your city" icon={<MapPin size={16} />} />
            </div>
          </div>
        );
      case 'default_phone':
        return (
          <ObInput type="tel" value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
            placeholder="+1 234 567 8900" autoFocus
            icon={<Phone size={16} />}
          />
        );
      case 'default_faith':
        return (
          <div className="flex gap-3.5">
            <label className="flex-1 cursor-pointer">
              <input type="radio" name="acceptedJesus" value="yes" checked={acceptedJesus === 'yes'} onChange={e => setAcceptedJesus(e.target.value)} className="peer sr-only" />
              <div className="w-full rounded-brand-lg border-2 border-stone-300 bg-white px-4 py-6 text-center font-display text-[22px] font-light transition-all peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] peer-checked:border-[var(--brand-color)] peer-checked:text-[var(--brand-color)]" style={{ letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Yes</div>
            </label>
            <label className="flex-1 cursor-pointer">
              <input type="radio" name="acceptedJesus" value="no" checked={acceptedJesus === 'no'} onChange={e => setAcceptedJesus(e.target.value)} className="peer sr-only" />
              <div className="w-full rounded-brand-lg border-2 border-stone-300 bg-white px-4 py-6 text-center font-display text-[22px] font-light transition-all peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] peer-checked:border-[var(--brand-color)] peer-checked:text-[var(--brand-color)]" style={{ letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Not yet</div>
            </label>
          </div>
        );
      case 'custom':
        if (!s.question) return null;
        return renderCustomQuestion(s.question);
      default:
        return null;
    }
  };

  const renderCustomQuestion = (question: OnboardingQuestion) => {
    const value = customAnswers[question.id] || '';
    switch (question.type) {
      case 'text':
        return (
          <ObInput type="text" value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
            placeholder={question.label} autoFocus />
        );
      case 'textarea':
        return (
          <textarea value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            className={`${brandFieldClass} resize-none`}
            style={fieldStyle}
            {...focusHandlers}
            placeholder={question.label} rows={3} />
        );
      case 'select':
        return (
          <select value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            className={`${brandFieldClass} appearance-none`}
            style={fieldStyle}
            {...focusHandlers}>
            <option value="">Select…</option>
            {(question.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      case 'radio':
        return (
          <div className="flex flex-wrap gap-3">
            {(question.options || []).map(opt => (
              <label key={opt} className="min-w-[100px] flex-1 cursor-pointer">
                <input type="radio" name={`custom_${question.id}`} value={opt} checked={value === opt}
                  onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))} className="peer sr-only" />
                <div className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-center text-sm font-semibold transition-all peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] peer-checked:border-[var(--brand-color)] peer-checked:text-[var(--brand-color)]" style={{ color: 'var(--text-heading, #2D2519)' }}>
                  {opt}
                </div>
              </label>
            ))}
          </div>
        );
      default: return null;
    }
  };

  const heading = getHeading(currentStep);
  // Keep the bar in step with the "Step X of N" counter (which counts only
  // question steps); system steps are the home stretch, so show a full bar.
  const progressPct = isSystemStep
    ? 100
    : Math.min(100, Math.round(((stepIndex + 1) / Math.max(questionStepCount, 1)) * 100));

  return (
    <OnbShell>
      {/* Logo */}
      <div className="mb-6 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="Harvest logo" className="h-12 w-auto object-contain" />
      </div>

      {/* Progress */}
      {!isDone && (
        <div className="mb-4">
          <div className="mb-1.5 flex justify-between text-xs font-medium" style={{ color: 'var(--text-muted, #8B7355)' }}>
            <span>{isSystemStep ? 'Final steps' : `Step ${stepIndex + 1} of ${questionStepCount}`}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--stone-200, #E8E2D9)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: GOLD }}
              initial={false}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* Card. overflowX:clip contains the horizontal slide without clipping the
          country dropdown (the card itself never sets overflow, so the dropdown
          renders freely). */}
      <div className={`${cardClass} px-6 py-8 sm:px-9`}>
        <div style={{ overflowX: 'clip' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {isDone ? (
                <div className="py-4 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 20, delay: 0.05 }}
                    className="mx-auto mb-6 flex h-[76px] w-[76px] items-center justify-center rounded-full"
                    style={goldDisc}
                  >
                    <CheckCircle2 size={38} />
                  </motion.div>
                  <h1 className="mb-2 font-display" style={{ fontWeight: 300, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
                    You&apos;re all set{name ? `, ${name.split(' ')[0]}` : ''}.
                  </h1>
                  <p className="mb-8 text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
                    Welcome to Harvest. From conversion to devotion — everything&apos;s ready for you.
                  </p>
                  <button onClick={onComplete}
                    className="inline-flex items-center gap-2 rounded-lg px-8 py-3 font-semibold text-white transition-all"
                    style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}>
                    Enter the app <ArrowRight size={18} />
                  </button>
                </div>
              ) : currentStep.kind === 'pwaInstall' ? (
                <PwaInstallStep deferredPrompt={deferredPrompt} onDone={advanceStep} />
              ) : currentStep.kind === 'notifications' ? (
                <NotificationsStep onDone={advanceStep} />
              ) : (
                <>
                  <Eyebrow>{`Step ${stepIndex + 1} of ${questionStepCount}`}</Eyebrow>
                  <div className="mb-1.5 mt-3">
                    <h1 className="font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', lineHeight: 1.12, color: 'var(--text-heading, #2D2519)' }}>{heading.title}</h1>
                  </div>
                  {heading.sub && <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>{heading.sub}</p>}
                  {error && (
                    <div className="mt-4 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#FBEEEA', borderColor: '#EBD0C7', color: '#B0432B' }}>
                      {error}
                    </div>
                  )}
                  <div className="mt-6">{renderField(currentStep)}</div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {!isDone && !isSystemStep && (
          <div className="mt-7 flex items-center justify-between">
            {stepIndex > 0 ? (
              <button onClick={goBack}
                className="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--text-body, #4A4038)' }}>
                <ArrowLeft size={16} /> Back
              </button>
            ) : <div />}
            <button onClick={goNext} disabled={loading || !questionsLoaded}
              className="flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-all disabled:opacity-50"
              style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}>
              {loading ? 'Saving…' : stepIndex === questionStepCount - 1 ? 'Finish' : 'Continue'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </OnbShell>
  );
};

export default Onboarding;
