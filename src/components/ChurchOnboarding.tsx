"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { Church, Palette, CheckCircle2, ArrowRight, ArrowLeft, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { createTenant, isSubdomainAvailable } from '../utils/tenant.utils';
import { ImageUpload } from './ImageUpload';
import { sendEmail, welcomeEmail } from '../utils/email';

interface ChurchOnboardingProps {
  onComplete: () => void;
  signupPlan?: TenantPlan;
}

const PLAN_NAMES: Record<TenantPlan, string> = {
  plus: 'Individual',
  pro: 'Small Team',
  max: 'Community',
  ultra: 'Ministry',
};

const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ onComplete, signupPlan }) => {
  const urlPlan = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('plan') as TenantPlan | null
    : null;
  const selectedPlan = signupPlan || (urlPlan && ['plus', 'pro', 'max', 'ultra'].includes(urlPlan) ? urlPlan : 'plus');

  const hasBranding = selectedPlan === 'max' || selectedPlan === 'ultra';
  const hasCustomDomain = selectedPlan === 'max' || selectedPlan === 'ultra';

  const [step, setStep] = useState(0);
  const [ministryName, setMinistryName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [description, setDescription] = useState('');
  const [logo, setLogo] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [subdomainStatus, setSubdomainStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stripeLoading, setStripeLoading] = useState(false);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);

  const progressSteps = hasBranding ? ['Ministry', 'Branding', 'Done'] : ['Ministry', 'Done'];

  useEffect(() => {
    if (ministryName && step === 0) {
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
        setSubdomainStatus('available');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [subdomain]);

  const isInfoStep = step === 0;
  const isBrandingStep = hasBranding && step === 1;
  const isDoneStep = hasBranding ? step === 2 : step === 1;

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
          customDomain: customDomain.trim() || undefined,
        },
      });

      setCreatedTenantId(tenantId);

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const updateData: Record<string, any> = {
        tenantId,
        role: 'church_admin',
        plan: selectedPlan,
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

      try {
        const token = await user.getIdToken();
        await fetch('/api/auth/set-claims', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: user.uid }),
        });
        await user.getIdToken(true);
      } catch (claimsErr) {
        console.error('Failed to set custom claims after tenant assignment:', claimsErr);
      }

      if (auth.currentUser?.email) {
        const emailData = welcomeEmail(auth.currentUser.displayName || 'Friend', ministryName.trim());
        emailData.to = auth.currentUser.email;
        sendEmail(emailData).catch(console.error);
      }

      setStep(hasBranding ? 2 : 1);
    } catch (err: any) {
      console.error('Church onboarding failed:', err);
      setError(err.message || 'Failed to set up your ministry. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const s = {
    label: { display: 'block', fontSize: '14px', fontWeight: 700, color: '#ffffff', marginBottom: '6px' } as React.CSSProperties,
    sublabel: { color: 'rgba(255,255,255,0.5)', fontWeight: 400 } as React.CSSProperties,
    helper: { fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '4px' } as React.CSSProperties,
    desc: { fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginTop: '8px' } as React.CSSProperties,
    tip: { fontSize: '12px', color: 'rgba(255,255,255,0.7)' } as React.CSSProperties,
    tipBold: { color: '#ffffff', fontWeight: 700 } as React.CSSProperties,
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-8 relative overflow-hidden">
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
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-primary/10 blur-[150px] rounded-full pointer-events-none mix-blend-overlay z-0" />

      <div className="max-w-2xl w-full z-10 relative">
        {/* Plan badge */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '6px 16px', borderRadius: '9999px',
            background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)',
            fontSize: '14px', fontWeight: 700, color: '#D4AF37',
          }}>
            <Sparkles size={14} />
            {PLAN_NAMES[selectedPlan]} Plan
          </span>
        </div>

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
                <div className={`w-8 h-0.5 rounded ${i < step ? 'bg-primary' : 'bg-white/10'}`} />
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

            {/* Step 0: Ministry Info */}
            {isInfoStep && (
              <div className="animate-fade-in-up">
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <Church style={{ margin: '0 auto 12px', color: '#D4AF37' }} size={32} />
                  <h1 style={{ fontSize: '30px', fontWeight: 900, color: '#ffffff', marginBottom: '8px' }}>Your Ministry</h1>
                  <p style={s.desc}>Tell us about your church or ministry.</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label style={s.label}>Ministry Name</label>
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
                    <label style={s.label}>Your Subdomain</label>
                    <div className="flex items-center gap-0">
                      <input
                        type="text"
                        value={subdomain}
                        onChange={(e) => {
                          setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                          setSubdomainStatus('idle');
                        }}
                        className={`flex-1 px-4 py-3 rounded-l-xl bg-white/5 border text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-mono text-sm ${
                          subdomainStatus === 'taken' ? 'border-red-500' :
                          subdomainStatus === 'available' ? 'border-green-500' :
                          'border-white/20'
                        }`}
                        placeholder="gracechurch"
                      />
                      <span style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)', borderLeft: 'none', borderRadius: '0 12px 12px 0', fontSize: '14px', color: 'rgba(255,255,255,0.6)' }}>
                        .theharvest.app
                      </span>
                    </div>
                    <div style={{ marginTop: '6px', height: '20px' }}>
                      {subdomainStatus === 'checking' && (
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Loader2 size={12} className="animate-spin" /> Checking availability...
                        </span>
                      )}
                      {subdomainStatus === 'available' && (
                        <span style={{ fontSize: '12px', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} /> {subdomain}.theharvest.app is available!
                        </span>
                      )}
                      {subdomainStatus === 'taken' && (
                        <span style={{ fontSize: '12px', color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={12} /> This subdomain is already taken.
                        </span>
                      )}
                    </div>
                  </div>

                  {hasCustomDomain && (
                    <div>
                      <label style={s.label}>
                        Custom Domain <span style={s.sublabel}>(optional — can configure later)</span>
                      </label>
                      <input
                        type="text"
                        value={customDomain}
                        onChange={(e) => setCustomDomain(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                        placeholder="yourchurch.com"
                      />
                      <p style={s.helper}>Your own domain. We&apos;ll help you configure DNS after setup.</p>
                    </div>
                  )}

                  <div>
                    <label style={s.label}>
                      Description <span style={s.sublabel}>(optional)</span>
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

            {/* Step 1: Branding (Community/Ministry/Organization only) */}
            {isBrandingStep && (
              <div className="animate-fade-in-up">
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <Palette style={{ margin: '0 auto 12px', color: '#D4AF37' }} size={32} />
                  <h1 style={{ fontSize: '30px', fontWeight: 900, color: '#ffffff', marginBottom: '8px' }}>Brand Your Space</h1>
                  <p style={s.desc}>Customize how your ministry looks. You can change this later.</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div>
                    <label style={s.label}>Ministry Logo</label>
                    <ImageUpload
                      value={logo}
                      onChange={setLogo}
                      placeholder="Upload your ministry logo"
                    />
                  </div>

                  <div>
                    <label style={s.label}>Brand Color</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        style={{ width: '48px', height: '48px', borderRadius: '12px', border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', background: 'transparent' }}
                      />
                      <div>
                        <p style={{ color: '#ffffff', fontSize: '14px', fontFamily: 'monospace' }}>{primaryColor}</p>
                        <p style={s.helper}>Used for accents and highlights</p>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <p style={s.tip}>
                      <strong style={s.tipBold}>Your plan includes:</strong> full rebranding, custom domain, and unlimited admin accounts.
                      Your logo and color will appear throughout your ministry&apos;s app.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Done */}
            {isDoneStep && (
              <div className="animate-fade-in-up text-center py-8">
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                  <CheckCircle2 size={40} style={{ color: '#4ade80' }} />
                </div>
                <h1 style={{ fontSize: '30px', fontWeight: 900, color: '#ffffff', marginBottom: '8px' }}>You&apos;re All Set!</h1>
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginBottom: '8px' }}>
                  <strong style={{ color: '#ffffff' }}>{ministryName}</strong> is ready to go.
                </p>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginBottom: '32px' }}>
                  Your app will be live at{' '}
                  <span style={{ fontFamily: 'monospace', color: '#D4AF37' }}>{subdomain}.theharvest.app</span>
                  {customDomain && (
                    <span> and <span style={{ fontFamily: 'monospace', color: '#D4AF37' }}>{customDomain}</span></span>
                  )}
                </p>
                {signupPlan ? (
                  <button
                    onClick={async () => {
                      setStripeLoading(true);
                      try {
                        const user = auth.currentUser;
                        if (!user || !createdTenantId) {
                          setError('Could not find your tenant. Please try again.');
                          setStripeLoading(false);
                          return;
                        }
                        const token = await user.getIdToken();
                        const resp = await fetch('/api/stripe/checkout', {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            plan: selectedPlan,
                            billing: 'monthly',
                            tenantId: createdTenantId,
                            tenantName: subdomain,
                            email: user.email || undefined,
                          }),
                        });
                        const data = await resp.json();
                        if (data.url) {
                          window.location.href = data.url;
                        } else {
                          setError(data.error || 'Failed to start checkout. Please try again.');
                          setStripeLoading(false);
                        }
                      } catch (err) {
                        console.error('Stripe checkout error:', err);
                        setError('Connection error. Please try again or go to Settings > Billing.');
                        setStripeLoading(false);
                      }
                    }}
                    disabled={stripeLoading}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#D4AF37', color: '#ffffff', fontWeight: 700, padding: '12px 32px', borderRadius: '12px', border: 'none', cursor: stripeLoading ? 'wait' : 'pointer', fontSize: '16px', boxShadow: '0 4px 12px rgba(212,175,55,0.3)', opacity: stripeLoading ? 0.7 : 1 }}
                  >
                    {stripeLoading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Redirecting to payment...
                      </>
                    ) : (
                      <>
                        Continue to Payment
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={onComplete}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#D4AF37', color: '#ffffff', fontWeight: 700, padding: '12px 32px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontSize: '16px', boxShadow: '0 4px 12px rgba(212,175,55,0.3)' }}
                  >
                    Go to Admin Dashboard
                    <ArrowRight size={18} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          {!isDoneStep && (
            <div style={{ padding: '24px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between' }}>
              {step > 0 ? (
                <button
                  onClick={handleBack}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '14px' }}
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              ) : <div />}

              {isBrandingStep ? (
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#D4AF37', color: '#ffffff', fontWeight: 700, padding: '12px 24px', borderRadius: '12px', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, boxShadow: '0 4px 12px rgba(212,175,55,0.3)' }}
                >
                  {saving ? (
                    <><Loader2 size={16} className="animate-spin" /> Setting up...</>
                  ) : (
                    <>Launch Ministry <Sparkles size={16} /></>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={isInfoStep && !canProceedInfo && subdomainStatus !== 'checking'}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#D4AF37', color: '#ffffff', fontWeight: 700, padding: '12px 24px', borderRadius: '12px', border: 'none', cursor: (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking') ? 'not-allowed' : 'pointer', opacity: (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking') ? 0.3 : 1, boxShadow: '0 4px 12px rgba(212,175,55,0.3)' }}
                >
                  Continue <ArrowRight size={16} />
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
