"use client";
import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from '../firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import CountrySelect from './CountrySelect';
import { getTenantScope } from '../utils/tenant-scope';
import { CheckCircle2, ArrowRight, ArrowLeft, MapPin } from 'lucide-react';

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
}

interface StepDef {
  kind: 'default_name' | 'default_location' | 'default_phone' | 'default_faith' | 'custom' | 'done';
  question?: OnboardingQuestion;
  faithLabel?: string;
}

const DEFAULT_STEPS: StepDef[] = [
  { kind: 'default_name' },
  { kind: 'default_location' },
  { kind: 'default_phone' },
  { kind: 'default_faith', faithLabel: 'Have you accepted Jesus?' },
  { kind: 'done' },
];

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

  const steps = useMemo<StepDef[]>(() => {
    if (!questionsLoaded || customQuestions.length === 0) return DEFAULT_STEPS;
    const result: StepDef[] = [];
    let locationAdded = false;
    for (const q of customQuestions) {
      if (q.id === 'default_name') {
        result.push({ kind: 'default_name' });
      } else if (q.id === 'default_country' || q.id === 'default_city') {
        if (!locationAdded) { result.push({ kind: 'default_location' }); locationAdded = true; }
      } else if (q.id === 'default_phone') {
        result.push({ kind: 'default_phone' });
      } else if (q.id === 'default_accepted_jesus') {
        result.push({ kind: 'default_faith', faithLabel: q.label || 'Have you accepted Jesus?' });
      } else {
        result.push({ kind: 'custom', question: q });
      }
    }
    result.push({ kind: 'done' });
    return result;
  }, [customQuestions, questionsLoaded]);

  const currentStep = steps[stepIndex] ?? { kind: 'done' as const };
  const isDone = currentStep.kind === 'done';
  const questionStepCount = steps.filter(s => s.kind !== 'done').length;

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
    if (customQuestions.length > 0 && Object.values(customAnswers).some(v => v?.trim())) {
      updateData.onboardingAnswers = customAnswers;
    }
    await updateDoc(doc(db, 'users', user.uid), updateData);
    sessionStorage.setItem('pwa_prompt_ready', 'true');
    window.dispatchEvent(new Event('onboardingComplete'));
  };

  const goNext = async () => {
    const err = validate(currentStep);
    if (err) { setError(err); return; }
    setError('');

    const nextIdx = stepIndex + 1;
    const nextStep = steps[nextIdx];

    if (nextStep?.kind === 'done') {
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
      case 'done': return { title: '', sub: '' };
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
  const progressPct = Math.min(100, Math.round(((stepIndex + 1) / Math.max(steps.length, 1)) * 100));

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
              <span>Step {stepIndex + 1} of {questionStepCount}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
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
                    className="inline-flex items-center gap-2 bg-primary text-white font-bold py-3 px-8 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30">
                    Let&apos;s go <ArrowRight size={18} />
                  </button>
                </div>
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

          {!isDone && (
            <div className="px-8 pb-8 sm:px-10 sm:pb-10 pt-0 flex items-center justify-between">
              {stepIndex > 0 ? (
                <button onClick={goBack}
                  className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-medium transition-colors">
                  <ArrowLeft size={16} /> Back
                </button>
              ) : <div />}
              <button onClick={goNext} disabled={loading}
                className="flex items-center gap-2 bg-primary text-white font-bold py-3 px-6 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30 disabled:opacity-50">
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
