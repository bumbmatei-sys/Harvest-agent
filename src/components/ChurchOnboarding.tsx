"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { Church, Globe, Palette, CheckCircle2, ArrowRight, ArrowLeft, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { createTenant, isSubdomainAvailable } from '../utils/tenant.utils';
import { ImageUpload } from './ImageUpload';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

interface ChurchOnboardingProps {
  onComplete: () => void;
}

const PLANS: { id: TenantPlan; name: string; price: string; desc: string; features: string[]; popular?: boolean }[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$100/mo',
    desc: 'Perfect for getting started',
    features: ['1 church', '2 admin accounts', '5 courses', 'Custom subdomain'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$250/mo',
    desc: 'Most popular for growing ministries',
    features: ['1 church', '5 admin accounts', 'Unlimited courses', 'Blog + AI Chat', 'AI Knowledge Base'],
    popular: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '$500/mo',
    desc: 'Full branding & custom domain',
    features: ['1 church', 'Unlimited admins', 'Unlimited courses', 'Blog + AI Chat + Knowledge', 'Custom domain', 'Full rebranding'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    desc: 'Multi-campus & dedicated support',
    features: ['Unlimited churches', 'Unlimited admins', 'Everything in Ultra', 'Church map directory', 'Dedicated support'],
  },
];

const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0); // 0=plan, 1=info, 2=branding, 3=done
  const [selectedPlan, setSelectedPlan] = useState<TenantPlan | null>(null);
  const [ministryName, setMinistryName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [description, setDescription] = useState('');
  const [logo, setLogo] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [subdomainStatus, setSubdomainStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate subdomain from ministry name
  useEffect(() => {
    if (ministryName && step === 1) {
      const generated = ministryName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30);
      setSubdomain(generated);
    }
  }, [ministryName, step]);

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

  const canProceedStep0 = !!selectedPlan;
  const canProceedStep1 = ministryName.trim().length >= 2 && subdomain.length >= 3 && subdomainStatus === 'available';
  const canProceedStep2 = true; // branding is optional

  const handleNext = () => {
    if (step === 0 && !canProceedStep0) return;
    if (step === 1 && !canProceedStep1) {
      if (subdomainStatus === 'taken') setError('That subdomain is already taken. Try another.');
      else if (subdomain.length < 3) setError('Subdomain must be at least 3 characters.');
      else if (ministryName.trim().length < 2) setError('Ministry name is required.');
      return;
    }
    setError('');
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    setError('');
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = async () => {
    const user = auth.currentUser;
    if (!user) { setError('You must be logged in.'); return; }
    if (!selectedPlan) { setError('Please select a plan.'); return; }

    setSaving(true);
    setError('');

    try {
      // Create the tenant
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

      // Update user doc: link to tenant, set role to church_admin, mark onboarding done
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

      setStep(3); // success screen
    } catch (err: any) {
      console.error('Church onboarding failed:', err);
      setError(err.message || 'Failed to set up your ministry. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Step progress bar
  const progressSteps = ['Plan', 'Ministry', 'Branding', 'Done'];

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
        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {progressSteps.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < step ? 'bg-primary text-white' :
                  i === step ? 'bg-primary/20 border-2 border-primary text-primary' :
                  'bg-white/10 text-gray-500'
                }`}>
                  {i < step ? <CheckCircle2 size={16} /> : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${
                  i <= step ? 'text-primary' : 'text-gray-500'
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

            {/* Step 0: Plan Selection */}
            {step === 0 && (
              <div className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <Sparkles className="mx-auto text-primary mb-3" size={32} />
                  <h1 className="text-3xl font-black text-white">Choose Your Plan</h1>
                  <p className="text-gray-300 text-sm mt-2">Select the plan that fits your ministry. You can upgrade anytime.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {PLANS.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`relative text-left p-5 rounded-2xl border-2 transition-all ${
                        selectedPlan === plan.id
                          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                          : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/8'
                      }`}
                    >
                      {plan.popular && (
                        <span className="absolute -top-2.5 left-4 bg-primary text-white text-xs font-bold px-3 py-0.5 rounded-full">
                          Most Popular
                        </span>
                      )}
                      <div className="flex items-baseline justify-between mb-2">
                        <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                        <span className="text-primary font-bold">{plan.price}</span>
                      </div>
                      <p className="text-gray-400 text-xs mb-3">{plan.desc}</p>
                      <ul className="space-y-1">
                        {plan.features.map((f) => (
                          <li key={f} className="text-gray-300 text-xs flex items-center gap-1.5">
                            <CheckCircle2 size={12} className="text-primary shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      {selectedPlan === plan.id && (
                        <div className="absolute top-3 right-3">
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                            <CheckCircle2 size={14} className="text-white" />
                          </div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Ministry Info */}
            {step === 1 && (
              <div className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <Church className="mx-auto text-primary mb-3" size={32} />
                  <h1 className="text-3xl font-black text-white">Your Ministry</h1>
                  <p className="text-gray-300 text-sm mt-2">Tell us about your church or ministry.</p>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-bold text-gray-200 mb-1">Ministry Name</label>
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
                    <label className="block text-sm font-bold text-gray-200 mb-1">Your Subdomain</label>
                    <div className="flex items-center gap-0">
                      <input
                        type="text"
                        value={subdomain}
                        onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        className={`flex-1 px-4 py-3 rounded-l-xl bg-white/5 border text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-mono text-sm ${
                          subdomainStatus === 'taken' ? 'border-red-500' :
                          subdomainStatus === 'available' ? 'border-green-500' :
                          'border-white/20'
                        }`}
                        placeholder="gracechurch"
                      />
                      <span className="px-3 py-3 bg-white/5 border border-l-0 border-white/20 rounded-r-xl text-sm text-gray-400">
                        .theharvest.app
                      </span>
                    </div>
                    <div className="mt-1.5 h-5">
                      {subdomainStatus === 'checking' && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
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
                    <label className="block text-sm font-bold text-gray-200 mb-1">
                      Description <span className="text-gray-500 font-normal">(optional)</span>
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

            {/* Step 2: Branding */}
            {step === 2 && (
              <div className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <Palette className="mx-auto text-primary mb-3" size={32} />
                  <h1 className="text-3xl font-black text-white">Brand Your Space</h1>
                  <p className="text-gray-300 text-sm mt-2">Customize how your ministry looks. This is optional — you can change it later.</p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-200 mb-2">Ministry Logo</label>
                    <ImageUpload
                      value={logo}
                      onChange={setLogo}
                      placeholder="Upload your ministry logo"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-200 mb-2">Brand Color</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="w-12 h-12 rounded-xl border-2 border-white/20 cursor-pointer bg-transparent"
                      />
                      <div>
                        <p className="text-white text-sm font-mono">{primaryColor}</p>
                        <p className="text-gray-400 text-xs">Used for accents and highlights</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <p className="text-gray-400 text-xs">
                      <strong className="text-gray-300">Tip:</strong> Your logo and color will appear on your ministry&apos;s app page.
                      {(selectedPlan === 'ultra' || selectedPlan === 'enterprise') && (
                        <span className="text-primary"> With your plan, you also get full rebranding and custom domain support.</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Success */}
            {step === 3 && (
              <div className="animate-fade-in-up text-center py-8">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={40} className="text-green-400" />
                </div>
                <h1 className="text-3xl font-black text-white mb-2">You&apos;re All Set!</h1>
                <p className="text-gray-300 text-sm mb-2">
                  <span className="font-bold text-white">{ministryName}</span> is ready to go.
                </p>
                <p className="text-gray-400 text-sm mb-8">
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
          {step < 3 && (
            <div className="p-6 border-t border-white/10 flex justify-between">
              {step > 0 ? (
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors font-medium"
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              ) : (
                <div />
              )}

              {step === 2 ? (
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
                  disabled={(step === 0 && !canProceedStep0) || (step === 1 && !canProceedStep1)}
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
