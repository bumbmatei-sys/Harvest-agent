'use client';
import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, Loader2, ArrowRight, Instagram, Mail, Globe, Palette } from 'lucide-react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface PostPurchaseWizardProps {
  tenantId: string;
  onComplete: () => void;
  isUpgrade?: boolean;
}

type PlanTier = string;

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  action?: () => void;
  actionLabel?: string;
}

const PostPurchaseWizard: React.FC<PostPurchaseWizardProps> = ({ tenantId, onComplete, isUpgrade = false }) => {
  const [plan, setPlan] = useState<PlanTier | null>(null);
  const [polling, setPolling] = useState(!isUpgrade);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const pollCountRef = useRef(0);

  useEffect(() => {
    if (isUpgrade) {
      loadPlan();
      return;
    }
    const interval = setInterval(async () => {
      pollCountRef.current++;
      try {
        const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
        if (!tenantDoc.exists()) return;
        const data = tenantDoc.data();
        if (data?.plan && data.plan !== 'free') {
          setPlan(data.plan);
          setPolling(false);
          clearInterval(interval);
          return;
        }
        if (pollCountRef.current >= 30) {
          clearInterval(interval);
          setPolling(false);
          if (data?.plan) setPlan(data.plan);
          else setPlan('plus');
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [tenantId, isUpgrade]);

  const loadPlan = async () => {
    try {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      if (tenantDoc.exists()) setPlan(tenantDoc.data()?.plan || 'plus');
      else setPlan('plus');
    } catch { setPlan('plus'); }
  };

  const getSteps = (p: PlanTier): Step[] => {
    const steps: Step[] = [
      {
        id: 'welcome',
        title: isUpgrade ? 'Plan upgraded!' : 'Welcome to Harvest!',
        description: isUpgrade
          ? 'Your new features are active and ready to use.'
          : `Your ${p} plan is active. Let\'s get you set up in a few quick steps.`,
        icon: <CheckCircle size={28} className="text-green-500" />,
      },
    ];

    if (['pro', 'max', 'ultra', 'enterprise'].includes(p)) {
      steps.push({
        id: 'instagram',
        title: 'Connect Instagram',
        description: 'Link your Instagram account so Harvest can auto-generate newsletters from your posts.',
        icon: <Instagram size={28} className="text-pink-500" />,
        action: onComplete,
        actionLabel: 'Go to Settings → Integrations',
      });
      steps.push({
        id: 'mailchimp',
        title: 'Connect Mailchimp',
        description: 'Connect Mailchimp to send polished newsletters to your community.',
        icon: <Mail size={28} className="text-yellow-500" />,
        action: onComplete,
        actionLabel: 'Go to Settings → Integrations',
      });
    }

    if (['max', 'ultra', 'enterprise'].includes(p)) {
      steps.push({
        id: 'domain',
        title: 'Custom Domain',
        description: 'Give your ministry a professional home with a custom domain.',
        icon: <Globe size={28} className="text-blue-500" />,
        action: onComplete,
        actionLabel: 'Set Up Domain',
      });
      steps.push({
        id: 'branding',
        title: 'Brand Your App',
        description: 'Upload your logo and pick your brand colors to match your ministry identity.',
        icon: <Palette size={28} className="text-purple-500" />,
        action: onComplete,
        actionLabel: 'Customize Branding',
      });
    }

    steps.push({
      id: 'done',
      title: 'You\'re all set!',
      description: 'Your workspace is ready. Head to the dashboard to start using Harvest.',
      icon: <CheckCircle size={28} className="text-green-500" />,
    });

    return steps;
  };

  const handleComplete = async () => {
    try {
      await updateDoc(doc(db, 'tenants', tenantId), {
        setupWizardCompleted: true,
        updatedAt: new Date().toISOString(),
      });
    } catch { /* non-fatal */ }
    onComplete();
  };

  const steps = plan ? getSteps(plan) : [];
  const step = steps[currentStep];

  if (polling) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <Loader2 size={40} className="mx-auto animate-spin" style={{ color: 'var(--brand-color, #d4a017)' }} />
          <p className="text-gray-700 font-medium">Confirming your purchase…</p>
          <p className="text-sm text-gray-400">This usually takes just a few seconds.</p>
        </div>
      </div>
    );
  }

  if (!plan || steps.length === 0) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div
              key={s.id}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === currentStep ? 'w-6' :
                completedSteps.has(s.id) ? 'w-2 bg-green-400' : 'w-2 bg-gray-200'
              }`}
              style={i === currentStep ? { width: '1.5rem', backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center">
            {step.icon}
          </div>
          <h2 className="text-2xl font-bold text-gray-900">{step.title}</h2>
          <p className="text-gray-500 text-sm leading-relaxed">{step.description}</p>
        </div>

        {/* Buttons */}
        <div className="mt-8 space-y-3">
          {step.action && (
            <button
              onClick={() => {
                setCompletedSteps(prev => new Set([...prev, step.id]));
                step.action?.();
              }}
              className="w-full py-3 px-4 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              {step.actionLabel}
              <ArrowRight size={16} />
            </button>
          )}

          {currentStep < steps.length - 1 ? (
            <button
              onClick={() => {
                setCompletedSteps(prev => new Set([...prev, step.id]));
                setCurrentStep(i => i + 1);
              }}
              className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-colors ${
                step.action
                  ? 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                  : 'text-white hover:opacity-90'
              }`}
              style={!step.action ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}
            >
              {step.action ? 'Skip for now' : (
                <span className="flex items-center justify-center gap-2">Next <ArrowRight size={16} /></span>
              )}
            </button>
          ) : (
            <button
              onClick={handleComplete}
              className="w-full py-3 px-4 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              Go to Dashboard
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostPurchaseWizard;
