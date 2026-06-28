"use client";
import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { Church, Palette, CheckCircle2, ArrowRight, ArrowLeft, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { PLAN_DISPLAY_NAMES } from '../utils/plan-features';
import { createTenant, isSubdomainAvailable } from '../utils/tenant.utils';
import { ImageUpload } from './ImageUpload';
import { sendEmail, welcomeEmail } from '../utils/email';

const BRAND = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

interface ChurchOnboardingProps {
  onComplete: () => void;
  signupPlan?: TenantPlan;
}

const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ onComplete, signupPlan }) => {
  const urlPlan = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('plan') as TenantPlan | null
    : null;
  const selectedPlan = signupPlan || (urlPlan && ['plus', 'pro', 'max', 'ultra'].includes(urlPlan) ? urlPlan : 'plus');

  const hasBranding = selectedPlan === 'max' || selectedPlan === 'ultra';
  const hasCustomDomain = selectedPlan === 'ultra';

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

  // Light-theme inline text styles (mirror AuthPage's white aesthetic).
  const s = {
    label: { display: 'block', fontSize: '14px', fontWeight: 600, color: '#111111', marginBottom: '6px' } as React.CSSProperties,
    sublabel: { color: '#AAAAAA', fontWeight: 400 } as React.CSSProperties,
    helper: { fontSize: '12px', color: '#888888', marginTop: '4px' } as React.CSSProperties,
    desc: { fontSize: '14px', color: '#888888', marginTop: '8px' } as React.CSSProperties,
    tip: { fontSize: '12px', color: '#666666' } as React.CSSProperties,
    tipBold: { color: '#111111', fontWeight: 700 } as React.CSSProperties,
  };

  // Shared light input styling (matches Onboarding / AuthPage).
  const inputClass =
    'w-full px-4 py-3 rounded-xl bg-white text-[#111111] placeholder-[#AAAAAA] border border-[#E5E5E5] outline-none transition-colors';
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BRAND; },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = '#E5E5E5'; },
  };

  return (
    <div className="min-h-screen bg-white px-6 py-10 flex flex-col">
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col justify-center">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HARVEST_LOGO} alt="Harvest logo" className="h-20 w-auto object-contain" />
        </div>

        {/* Plan badge */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '6px 16px', borderRadius: '9999px',
            background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)',
            border: '1px solid color-mix(in srgb, var(--brand-color, #B8962E) 30%, white)',
            fontSize: '14px', fontWeight: 700, color: BRAND,
          }}>
            <Sparkles size={14} />
            {PLAN_DISPLAY_NAMES[selectedPlan]} Plan
          </span>
        </div>

        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {progressSteps.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all"
                    style={
                      done
                        ? { backgroundColor: BRAND, color: '#ffffff' }
                        : current
                        ? { backgroundColor: 'color-mix(in srgb, var(--brand-color, #B8962E) 14%, white)', color: BRAND, border: `2px solid ${BRAND}` }
                        : { backgroundColor: '#F3F4F6', color: '#9CA3AF' }
                    }
                  >
                    {done ? <CheckCircle2 size={16} /> : i + 1}
                  </div>
                  <span className="text-xs font-medium hidden sm:block" style={{ color: i <= step ? BRAND : '#9CA3AF' }}>{label}</span>
                </div>
                {i < progressSteps.length - 1 && (
                  <div className="w-8 h-0.5 rounded" style={{ backgroundColor: i < step ? BRAND : '#E5E7EB' }} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Card — subtle bordered container (church onboarding is denser). */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 sm:p-8">
            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-start gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {/* Step 0: Ministry Info */}
            {isInfoStep && (
              <div className="animate-fade-in-up">
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                  <Church style={{ margin: '0 auto 12px', color: BRAND }} size={32} />
                  <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>Your Ministry</h1>
                  <p style={s.desc}>Tell us about your church or ministry.</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label style={s.label}>Ministry Name</label>
                    <input
                      type="text"
                      value={ministryName}
                      onChange={(e) => setMinistryName(e.target.value)}
                      className={inputClass}
                      style={{ borderColor: '#E5E5E5' }}
                      {...focusHandlers}
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
                        className="flex-1 px-4 py-3 rounded-l-xl bg-white text-[#111111] placeholder-[#AAAAAA] border outline-none transition-colors font-mono text-sm"
                        style={{ borderColor: subdomainStatus === 'taken' ? '#EF4444' : subdomainStatus === 'available' ? '#22C55E' : '#E5E5E5' }}
                        placeholder="gracechurch"
                      />
                      <span style={{ padding: '12px', background: '#F9FAFB', border: '1px solid #E5E5E5', borderLeft: 'none', borderRadius: '0 12px 12px 0', fontSize: '14px', color: '#888888' }}>
                        .theharvest.app
                      </span>
                    </div>
                    <div style={{ marginTop: '6px', height: '20px' }}>
                      {subdomainStatus === 'checking' && (
                        <span style={{ fontSize: '12px', color: '#888888', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Loader2 size={12} className="animate-spin" /> Checking availability...
                        </span>
                      )}
                      {subdomainStatus === 'available' && (
                        <span style={{ fontSize: '12px', color: '#16A34A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} /> {subdomain}.theharvest.app is available!
                        </span>
                      )}
                      {subdomainStatus === 'taken' && (
                        <span style={{ fontSize: '12px', color: '#DC2626', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                        className={inputClass}
                        style={{ borderColor: '#E5E5E5' }}
                        {...focusHandlers}
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
                      className={`${inputClass} resize-none`}
                      style={{ borderColor: '#E5E5E5' }}
                      {...focusHandlers}
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
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                  <Palette style={{ margin: '0 auto 12px', color: BRAND }} size={32} />
                  <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>Brand Your Space</h1>
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
                        style={{ width: '48px', height: '48px', borderRadius: '12px', border: '2px solid #E5E5E5', cursor: 'pointer', background: 'transparent' }}
                      />
                      <div>
                        <p style={{ color: '#111111', fontSize: '14px', fontFamily: 'monospace' }}>{primaryColor}</p>
                        <p style={s.helper}>Used for accents and highlights</p>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '16px', borderRadius: '12px', background: '#F9FAFB', border: '1px solid #F0F0F0' }}>
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
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                  <CheckCircle2 size={40} style={{ color: '#22C55E' }} />
                </div>
                <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111111', marginBottom: '8px' }}>You&apos;re All Set!</h1>
                <p style={{ color: '#888888', fontSize: '14px', marginBottom: '8px' }}>
                  <strong style={{ color: '#111111' }}>{ministryName}</strong> is ready to go.
                </p>
                <p style={{ color: '#888888', fontSize: '14px', marginBottom: '32px' }}>
                  Your app will be live at{' '}
                  <span style={{ fontFamily: 'monospace', color: BRAND }}>{subdomain}.theharvest.app</span>
                  {customDomain && (
                    <span> and <span style={{ fontFamily: 'monospace', color: BRAND }}>{customDomain}</span></span>
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
                        let referrerId: string | undefined;
                        try {
                          const stored = localStorage.getItem('affiliateReferrerId');
                          if (stored) {
                            const parsed = JSON.parse(stored);
                            referrerId = parsed.id || undefined;
                          }
                        } catch {}
                        const resp = await fetch('/api/stripe/checkout', {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            plan: selectedPlan,
                            billing: 'monthly',
                            tenantId: createdTenantId,
                            tenantName: subdomain,
                            email: user.email || undefined,
                            ...(referrerId ? { referrerId } : {}),
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
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: BRAND, color: '#ffffff', fontWeight: 600, padding: '12px 32px', borderRadius: '12px', border: 'none', cursor: stripeLoading ? 'wait' : 'pointer', fontSize: '16px', opacity: stripeLoading ? 0.7 : 1 }}
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
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: BRAND, color: '#ffffff', fontWeight: 600, padding: '12px 32px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontSize: '16px' }}
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
            <div style={{ padding: '20px 24px', borderTop: '1px solid #F0F0F0', display: 'flex', justifyContent: 'space-between' }}>
              {step > 0 ? (
                <button
                  onClick={handleBack}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#888888', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '14px' }}
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              ) : <div />}

              {(isBrandingStep || (isInfoStep && !hasBranding)) ? (
                <button
                  onClick={handleFinish}
                  disabled={saving || (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking')}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: BRAND, color: '#ffffff', fontWeight: 600, padding: '12px 24px', borderRadius: '12px', border: 'none', cursor: (saving || (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking')) ? 'not-allowed' : 'pointer', opacity: (saving || (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking')) ? 0.5 : 1 }}
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
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: BRAND, color: '#ffffff', fontWeight: 600, padding: '12px 24px', borderRadius: '12px', border: 'none', cursor: (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking') ? 'not-allowed' : 'pointer', opacity: (isInfoStep && !canProceedInfo && subdomainStatus !== 'checking') ? 0.3 : 1 }}
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
