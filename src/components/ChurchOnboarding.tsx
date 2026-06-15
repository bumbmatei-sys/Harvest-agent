"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { Church, Palette, CheckCircle2, ArrowRight, ArrowLeft, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { createTenant, isSubdomainAvailable } from '../utils/tenant.utils';
import { ImageUpload } from './ImageUpload';

interface ChurchOnboardingProps {
  onComplete: () => void;
}

const PLAN_NAMES: Record<TenantPlan, string> = {
  plus: 'Plus',
  pro: 'Pro',
  ultra: 'Ultra',
  enterprise: 'Enterprise',
};

const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ onComplete }) => {
  // Read plan from URL (?plan=pro) — skip plan selection if present
  const urlPlan = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('plan') as TenantPlan | null
    : null;
  const validUrlPlan = urlPlan && ['plus', 'pro', 'ultra', 'enterprise'].includes(urlPlan) ? urlPlan : null;

  // If plan comes from URL, skip step 0 (plan selection). Steps: 0=info, 1=branding, 2=done
  const [step, setStep] = useState(validUrlPlan ? 0 : 1);
  const [selectedPlan, setSelectedPlan] = useState<TenantPlan | null>(validUrlPlan);
  const [ministryName, setMinistryName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [description, setDescription] = useState('');
  const [logo, setLogo] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [subdomainStatus, setSubdomainStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step labels: if plan is pre-selected, skip "Plan" step
  const hasPlan = !!validUrlPlan;
  const progressSteps = hasPlan ? ['Ministry', 'Branding', 'Done'] : ['Plan', 'Ministry', 'Branding', 'Done'];
  // Step offsets: if plan pre-selected, step 0 = info (was step 1), step 1 = branding (was step 2), step 2 = done (was step 3)
  const stepOffset = hasPlan ? 1 : 0;

  // Auto-generate subdomain from ministry name
  useEffect(() => {
    if (ministryName && step === (hasPlan ? 0 : 1)) {
      const generated = ministryName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30);
      setSubdomain(generated);
    }
  }, [ministryName, step, hasPlan]);

  // Check subdomain availability with debounce
  useEffect(() => {
    if (!subdomain || subdomain.length < 3) {
      setSubdomainStatus('idle');
      return;
    }
    setSubdomainStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const available = await isSubdomainAvailable(subdomain);
        setSubdomainStatus(available ? 'available' : 'taken');
      } catch {
        setSubdomainStatus('idle');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [subdomain]);

  // Validation
  const isInfoStep = hasPlan ? step === 0 : step === 1;
  const isBrandingStep = hasPlan ? step === 1 : step === 2;
  const isDoneStep = hasPlan ? step === 2 : step === 3;

  const canProceedInfo = ministryName.trim().length >= 2 && subdomain.length >= 3 && subdomainStatus === 'available';

  const handleNext = () => {
    if (isInfoStep) {
      if (!canProceedInfo) {
        if (subdomainStatus === 'taken') setError('That subdomain is already taken. Try another.');
        else if (subdomainStatus === 'checking') setError('Please wait for the subdomain check to complete.');
        else if (subdomain.length < 3) setError('Subdomain must be at least 3 characters.');
        else if (ministryName.trim().length < 2) setError('Ministry name is required.');
        return;
      }
    }
    // If plan selection step and no plan selected
    if (!hasPlan && step === 0 && !selectedPlan) {
      setError('Please select a plan.');
      return;
    }
    setError('');
    setStep(step + 1);
  };

  const handleBack = () => {
    setError('');
    setStep(step - 1);
  };

  const handleFinish = async () => {
    const user = auth.currentUser;
    if (!user) { setError('You must be logged in.'); return; }
    if (!selectedPlan) { setError('Please select a plan.'); return; }

    setSaving(true);
    setError('');

    try {
      const tenantId = await createTenant({
        name: ministryName.trim(),
        subdomain: subdomain.toLowerCase().trim(),
        plan: selectedPlan,
        adminEmails: [user.email || ''],
        config: {
          description: description.trim() || undefined,
          logo: logo || undefined,
          primaryColor: primaryColor || undefined,
        },
      });

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const updateData: Record<string, any> = {
        tenantId,
        role: 'church_admin',
        onboardingCompleted: true,
      };

      if (userSnap.exists()) {
        await updateDoc(userRef, updateData);
      } else {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || ministryName,
          createdAt: new Date().toISOString(),
          ...updateData,
          termsAccepted: true,
        });
      }

      setStep(hasPlan ? 2 : 3); // done
    } catch (err: any) {
      console.error('Church onboarding failed:', err);
      setError(err.message || 'Failed to set up your ministry. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-8 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <Image
          src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/No_people_just_2k_202512231746.jpeg"
          alt="Harvest Background"
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background-dark/80 via-background-dark/60 to-background-dark/95 mix-blend-multiply" />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-primary/10 blur-[150px] rounded-full pointer-events-none mix-blend-overlay z-0" />

      <div className="max-w-2xl w-full z-10 relative">
        {/* Selected plan badge (when plan comes from URL) */}
        {hasPlan && selectedPlan && (
          <div className="text-center mb-4">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-sm font-bold text-primary">
              <Sparkles size={14} />
              {PLAN_NAMES[selectedPlan]} Plan Selected
            </span>
          </div>
        )}

        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {progressSteps.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < step ? 'bg-primary text-white' :
                  i === step ? 'bg-primary/20 border-2 border-primary text-primary' :
                  'bg-white/10 text-gray-400'
                }`}>
                  {i < step ? <CheckCircle2 size={16} /> : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${
                  i <= step ? 'text-primary' : 'text-gray-400'
                }`}>{label}</span>
              </div>
              {i < progressSteps.length - 1 && (
                <div className={`w-8 h-0.5 rounded ${
                  i < step ? 'bg-primary' : 'bg-white/10'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden">
          <div className="p-6 sm:p-10">
            {error && (
              <div className="mb-6 p-4 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm rounded flex items-start gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {/* Plan Selection (only when no plan from URL) */}
            {!hasPlan && step === 0 && (
              <div className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <Sparkles className="mx-auto text-primary mb-3" size={32} />
                  <h1 className="text-3xl font-black text-white">Choose Your Plan</h1>
                  <p className="text-white/70 text-sm mt-2">Select the plan that fits your ministry. You can upgrade anytime.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(['plus', 'pro', 'ultra', 'enterprise'] as TenantPlan[]).map((planId) => {
                    const info = {
                      plus: { price: '$100/mo', desc: 'Perfect for getting started', features: ['1 church', '2 admin accounts', '5 courses'], popular: false },
                      pro: { price: '$250/mo', desc: 'Most popular for growing ministries', features: ['5 admin accounts', 'Unlimited courses', 'Blog + AI Chat'], popular: true },
                      ultra: { price: '$500/mo', desc: 'Full branding & custom domain', features: ['Unlimited admins', 'Custom domain', 'Full rebranding'], popular: false },
                      enterprise: { price: 'Custom', desc: 'Multi-campus & dedicated support', features: ['Unlimited churches', 'Church map', 'Dedicated support'], popular: false },
                    }[planId];
                    return (
                      <button
                        key={planId}
                        onClick={() => setSelectedPlan(planId)}
                        className={`relative text-left p-5 rounded-2xl border-2 transition-all ${
                          selectedPlan === planId
                            ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                            : 'border-white/10 bg-white/5 hover:border-white/30'
                        }`}
                      >
                        {info.popular && (
                          <span className="absolute -top-2.5 left-4 bg-primary text-white text-xs font-bold px-3 py-0.5 rounded-full">Most Popular</span>
                        )}
                        <div className="flex items-baseline justify-between mb-2">
                          <h3 className="text-lg font-bold text-white">{PLAN_NAMES[planId]}</h3>
                          <span className="text-primary font-bold">{info.price}</span>
                        </div>
                        <p className="text-white/60 text-xs mb-3">{info.desc}</p>
                        <ul className="space-y-1">
                          {info.features.map((f) => (
                            <li key={f} className="text-white/80 text-xs flex items-center gap-1.5">
                              <CheckCircle2 size={12} className="text-primary shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                        {selectedPlan === planId && (
                          <div className="absolute top-3 right-3">
                            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                              <CheckCircle2 size={14} className="text-white" />
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ministry Info */}
            {isInfoStep && (
              <div className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <Church className="mx-auto text-primary mb-3" size={32} />
                  <h1 className="text-3xl font-black text-white">Your Ministry</h1>
                  <p className="text-white/70 text-sm mt-2">Tell us about your church or ministry.</p>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-bold text-white mb-1">Ministry Name</label>
                    <input
                      type="text"
                      value={ministryName}
                      onChange={(e) => setMinistryName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                      placeholder="Grace Community Church"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-white mb-1">Your Subdomain</label>
                    <div className="flex items-center gap-0">
                      <input
                        type="text"
                        value={subdomain}
                        onChange={(e) => {
                          setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                          setSubdomainStatus('idle'); // reset status on manual edit
                        }}
                        className={`flex-1 px-4 py-3 rounded-l-xl bg-white/5 border text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-mono text-sm ${
                          subdomainStatus === 'taken' ? 'border-red-500' :
                          subdomainStatus === 'available' ? 'border-green-500' :
                          'border-white/20'
                        }`}
                        placeholder="gracechurch"
                      />
                      <span className="px-3 py-3 bg-white/5 border border-l-0 border-white/20 rounded-r-xl text-sm text-white/60">
                        .theharvest.app
                      </span>
                    </div>
                    <div className="mt-1.5 h-5">
                      {subdomainStatus === 'checking' && (
                        <span className="text-xs text-white/60 flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> Checking availability...
                        </span>
                      )}
                      {subdomainStatus === 'available' && (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle2 size={12} /> {subdomain}.theharvest.app is available!
                        </span>
                      )}
                      {subdomainStatus === 'taken' && (
                        <span className="text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle size={12} /> This subdomain is already taken.
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-white mb-1">
                      Description <span className="text-white/50 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all resize-none"
                      rows={3}
                      placeholder="A brief description of your ministry..."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Branding */}
            {isBrandingStep && (
              <div className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <Palette className="mx-auto text-primary mb-3" size={32} />
                  <h1 className="text-3xl font-black text-white">Brand Your Space</h1>
                  <p className="text-white/70 text-sm mt-2">Customize how your ministry looks. This is optional — you can change it later.</p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-white mb-2">Ministry Logo</label>
                    <ImageUpload
                      value={logo}
                      onChange={setLogo}
                      placeholder="Upload your ministry logo"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-white mb-2">Brand Color</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="w-12 h-12 rounded-xl border-2 border-white/20 cursor-pointer bg-transparent"
                      />
                      <div>
                        <p className="text-white text-sm font-mono">{primaryColor}</p>
                        <p className="text-white/60 text-xs">Used for accents and highlights</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <p className="text-white/60 text-xs">
                      <strong className="text-white">Tip:</strong> Your logo and color will appear on your ministry&apos;s app page.
                      {(selectedPlan === 'ultra' || selectedPlan === 'enterprise') && (
                        <span className="text-primary"> With your plan, you also get full rebranding and custom domain support.</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Done */}
            {isDoneStep && (
              <div className="animate-fade-in-up text-center py-8">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={40} className="text-green-400" />
                </div>
                <h1 className="text-3xl font-black text-white mb-2">You&apos;re All Set!</h1>
                <p className="text-white/80 text-sm mb-2">
                  <span className="font-bold text-white">{ministryName}</span> is ready to go.
                </p>
                <p className="text-white/60 text-sm mb-8">
                  Your app will be live at{' '}
                  <span className="font-mono text-primary">{subdomain}.theharvest.app</span>
                </p>

                <button
                  onClick={onComplete}
                  className="inline-flex items-center gap-2 bg-primary text-white font-bold py-3 px-8 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30"
                >
                  Go to Admin Dashboard
                  <ArrowRight size={18} />
                </button>
              </div>
            )}
          </div>

          {/* Navigation buttons */}
          {!isDoneStep && (
            <div className="p-6 border-t border-white/10 flex justify-between">
              {step > (hasPlan ? 0 : 1) ? (
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 text-white/60 hover:text-white transition-colors font-medium"
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              ) : (
                <div />
              )}

              {isBrandingStep ? (
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  className="flex items-center gap-2 bg-primary text-white font-bold py-3 px-6 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      Launch Ministry
                      <Sparkles size={16} />
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={isInfoStep && !canProceedInfo && subdomainStatus !== 'checking'}
                  className="flex items-center gap-2 bg-primary text-white font-bold py-3 px-6 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Continue
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChurchOnboarding;
