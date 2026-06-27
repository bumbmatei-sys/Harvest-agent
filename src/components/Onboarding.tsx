"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, messaging, VAPID_KEY } from '../firebase';
import { doc, updateDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import CountrySelect from './CountrySelect';
import { getTenantScope } from '../utils/tenant-scope';
import { CheckCircle2, ArrowRight, ArrowLeft, MapPin, Share, Download, Bell } from 'lucide-react';
import type { TenantPlan } from '../types/tenant.types';

const GOLD = '#B8962E';

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
  <div className="flex items-start gap-3 bg-white/5 rounded-xl px-3.5 py-3">
    <span
      className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
      style={{ backgroundColor: GOLD }}
    >
      {num}
    </span>
    <span className="text-sm text-gray-200 leading-snug pt-0.5">{children}</span>
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

  const finish = () => {
    try { localStorage.setItem('pwa_installed', 'true'); } catch { /* ignore */ }
    onDone();
  };

  // Desktop (neither iOS nor Android): skip this step silently.
  useEffect(() => {
    if (!isMobile) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isMobile) return null;

  const handleAndroidInstall = async () => {
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

  // Android with a native install prompt available → one-tap install.
  const showNativeInstall = isAndroid && !!deferredPrompt.current;

  const manualInstructions = (
    <div className="space-y-2.5 mb-6">
      <InstructionRow num={1}>
        Tap the <strong className="font-semibold text-white">Share</strong> button at the bottom of
        your browser <Share size={15} className="inline-block align-text-bottom" style={{ color: GOLD }} />
      </InstructionRow>
      <InstructionRow num={2}>
        Scroll down and tap <strong className="font-semibold text-white">Add to Home Screen</strong>
      </InstructionRow>
      <InstructionRow num={3}>
        Tap <strong className="font-semibold text-white">Add</strong> — you&apos;re done! 🎉
      </InstructionRow>
    </div>
  );

  return (
    <div className="py-2">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: `${GOLD}22` }}
      >
        {isIOS ? <Share size={28} style={{ color: GOLD }} /> : <Download size={28} style={{ color: GOLD }} />}
      </div>
      <h1 className="text-2xl font-black text-white text-center mb-1.5">Install the App</h1>
      <p className="text-gray-300 text-sm text-center mb-6">
        {showNativeInstall
          ? 'Get the full experience on your home screen'
          : 'Access Harvest instantly from your home screen'}
      </p>

      {showNativeInstall ? (
        <button
          onClick={handleAndroidInstall}
          disabled={installing}
          className="w-full flex items-center justify-center gap-2 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg disabled:opacity-50 mb-3"
          style={{ backgroundColor: GOLD, boxShadow: `0 10px 15px -3px ${GOLD}4D` }}
        >
          <Download size={18} /> {installing ? 'Installing…' : 'Install App'}
        </button>
      ) : (
        <>
          {manualInstructions}
          <button
            onClick={finish}
            className="w-full text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg mb-3"
            style={{ backgroundColor: GOLD, boxShadow: `0 10px 15px -3px ${GOLD}4D` }}
          >
            I&apos;ve added it
          </button>
        </>
      )}

      <button
        onClick={finish}
        className="w-full text-center text-sm text-gray-400 hover:text-white transition-colors py-1"
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
                const tenantId = await getTenantScope();
                await updateDoc(doc(db, 'users', user.uid), {
                  fcmTokens: arrayUnion(token),
                  tenantId: tenantId || null,
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
    <div className="py-2">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: `${GOLD}22` }}
      >
        <Bell size={28} style={{ color: GOLD }} />
      </div>
      <h1 className="text-2xl font-black text-white text-center mb-1.5">Stay Connected</h1>
      <p className="text-gray-300 text-sm text-center mb-6">
        Enable notifications to receive messages, prayer updates, and announcements from your
        ministry.
      </p>

      <button
        onClick={handleEnable}
        disabled={requesting}
        className="w-full flex items-center justify-center gap-2 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg disabled:opacity-50 mb-3"
        style={{ backgroundColor: GOLD, boxShadow: `0 10px 15px -3px ${GOLD}4D` }}
      >
        <Bell size={18} /> {requesting ? 'Enabling…' : 'Enable Notifications'}
      </button>
      <button
        onClick={finish}
        className="w-full text-center text-sm text-gray-400 hover:text-white transition-colors py-1"
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
      case 'default_name': return { title: "What's your name?", sub: "We'll use this to personalize your experience." };
      case 'default_location': return { title: 'Where are you based?', sub: "We'll show you posts and events near you." };
      case 'default_phone': return { title: 'Your phone number', sub: 'So your church can reach you when it matters.' };
      case 'default_faith': return { title: s.faithLabel || 'Have you accepted Jesus?', sub: '' };
      case 'custom': return { title: s.question?.label || '', sub: '' };
      default: return { title: '', sub: '' };
    }
  };

  const renderField = (s: StepDef) => {
    switch (s.kind) {
      case 'default_name':
        return (
          <input
            type="text" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
            className="w-full px-4 py-4 rounded-xl bg-white/5 border border-white/20 text-white text-lg placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
            placeholder="Your full name" autoFocus
          />
        );
      case 'default_location':
        return (
          <div className="space-y-3">
            <button type="button" onClick={handleUseGPS} disabled={gpsLoading}
              className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors disabled:opacity-50">
              <MapPin size={15} />
              {gpsLoading ? 'Detecting location…' : 'Use my current location'}
            </button>
            <div className="relative z-50">
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Country</label>
              <CountrySelect value={country} onChange={setCountry} className="w-full"
                buttonClassName="!bg-white/5 !border-white/20 !text-white focus:!ring-2 focus:!ring-primary focus:!border-primary !py-3 !rounded-xl" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">City</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                placeholder="Your city" />
            </div>
          </div>
        );
      case 'default_phone':
        return (
          <input type="tel" value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
            className="w-full px-4 py-4 rounded-xl bg-white/5 border border-white/20 text-white text-lg placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
            placeholder="+1 234 567 8900" autoFocus
          />
        );
      case 'default_faith':
        return (
          <div className="flex gap-4">
            <label className="flex-1 cursor-pointer">
              <input type="radio" name="acceptedJesus" value="yes" checked={acceptedJesus === 'yes'} onChange={e => setAcceptedJesus(e.target.value)} className="peer sr-only" />
              <div className="w-full px-4 py-5 rounded-xl bg-white/5 border-2 border-white/20 text-center text-white peer-checked:bg-primary/20 peer-checked:border-primary peer-checked:text-primary transition-all font-bold text-lg">Yes</div>
            </label>
            <label className="flex-1 cursor-pointer">
              <input type="radio" name="acceptedJesus" value="no" checked={acceptedJesus === 'no'} onChange={e => setAcceptedJesus(e.target.value)} className="peer sr-only" />
              <div className="w-full px-4 py-5 rounded-xl bg-white/5 border-2 border-white/20 text-center text-white peer-checked:bg-white/15 peer-checked:border-white/40 transition-all font-bold text-lg">Not yet</div>
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
          <input type="text" value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && !loading && goNext()}
            className="w-full px-4 py-4 rounded-xl bg-white/5 border border-white/20 text-white text-lg placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
            placeholder={question.label} autoFocus />
        );
      case 'textarea':
        return (
          <textarea value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all resize-none"
            placeholder={question.label} rows={3} />
        );
      case 'select':
        return (
          <select value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all appearance-none">
            <option value="" className="bg-gray-800">Select…</option>
            {(question.options || []).map(opt => <option key={opt} value={opt} className="bg-gray-800">{opt}</option>)}
          </select>
        );
      case 'radio':
        return (
          <div className="flex gap-3 flex-wrap">
            {(question.options || []).map(opt => (
              <label key={opt} className="flex-1 cursor-pointer min-w-[100px]">
                <input type="radio" name={`custom_${question.id}`} value={opt} checked={value === opt}
                  onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))} className="peer sr-only" />
                <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-center text-white peer-checked:bg-primary/20 peer-checked:border-primary peer-checked:text-primary transition-all font-semibold text-sm">
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
    <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/No_people_just_2k_202512231746.jpeg"
          alt="Harvest Background" fill sizes="100vw" priority className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-background-dark/80 via-background-dark/60 to-background-dark/95 mix-blend-multiply" />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      <div className="max-w-md w-full z-10 relative">
        {!isDone && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>{isSystemStep ? 'Final steps' : `Step ${stepIndex + 1} of ${questionStepCount}`}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
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

        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="p-8 sm:p-10"
            >
              {isDone ? (
                <div className="text-center py-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 20, delay: 0.05 }}
                    className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"
                  >
                    <CheckCircle2 size={40} className="text-green-400" />
                  </motion.div>
                  <h1 className="text-2xl font-black text-white mb-2">
                    You&apos;re all set{name ? `, ${name.split(' ')[0]}` : ''}!
                  </h1>
                  <p className="text-gray-300 text-sm mb-8">
                    Welcome to Harvest. Everything&apos;s ready for you.
                  </p>
                  <button onClick={onComplete}
                    className="inline-flex items-center gap-2 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg"
                    style={{ backgroundColor: GOLD, boxShadow: `0 10px 15px -3px ${GOLD}4D` }}>
                    Let&apos;s go <ArrowRight size={18} />
                  </button>
                </div>
              ) : currentStep.kind === 'pwaInstall' ? (
                <PwaInstallStep deferredPrompt={deferredPrompt} onDone={advanceStep} />
              ) : currentStep.kind === 'notifications' ? (
                <NotificationsStep onDone={advanceStep} />
              ) : (
                <>
                  <div className="mb-6">
                    <h1 className="text-2xl font-black text-white mb-1">{heading.title}</h1>
                    {heading.sub && <p className="text-gray-300 text-sm">{heading.sub}</p>}
                  </div>
                  {error && (
                    <div className="mb-4 p-3 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm rounded">
                      {error}
                    </div>
                  )}
                  {renderField(currentStep)}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {!isDone && !isSystemStep && (
            <div className="px-8 pb-8 sm:px-10 sm:pb-10 pt-0 flex items-center justify-between">
              {stepIndex > 0 ? (
                <button onClick={goBack}
                  className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-medium transition-colors">
                  <ArrowLeft size={16} /> Back
                </button>
              ) : <div />}
              <button onClick={goNext} disabled={loading || !questionsLoaded}
                className="flex items-center gap-2 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg disabled:opacity-50"
                style={{ backgroundColor: GOLD, boxShadow: `0 10px 15px -3px ${GOLD}4D` }}>
                {loading ? 'Saving…' : stepIndex === questionStepCount - 1 ? 'Finish' : 'Continue'}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
