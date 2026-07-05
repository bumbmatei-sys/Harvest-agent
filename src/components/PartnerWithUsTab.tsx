"use client";
import React, { useState } from 'react';
import { HeartHandshake, Heart, Lock, ShieldCheck, Loader2 } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { authFetch } from '../utils/auth-fetch';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';

type DonationType = 'one-time' | 'monthly';

const PartnerWithUsTab: React.FC = () => {
  const { tenantId, tenantName, tenantPlan } = useTenant();
  const [donationType, setDonationType] = useState<DonationType>('one-time');
  const [amount, setAmount] = useState<string>('50');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetAmounts = ['10', '25', '50', '100'];

  const handleDonate = async () => {
    const effectiveTenantId = tenantId || PLATFORM_TENANT_ID;

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!amountCents || amountCents < 100) {
      setError('Minimum donation is $1.00');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await authFetch('/api/stripe/donate', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountCents,
          tenantId: effectiveTenantId,
          donationType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create checkout session');
        setIsLoading(false);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 px-4 pb-32 max-w-md mx-auto w-full">
      {/* Top Icon & Text */}
      <div className="flex flex-col items-center text-center mb-8 mt-4">
        <div className="w-16 h-16 bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] rounded-full flex items-center justify-center mb-4">
          <HeartHandshake size={32} className="text-gold" />
        </div>
        <h2 className="text-2xl font-bold text-[#0b1121] mb-1">Partner with Us</h2>
        {tenantName && (
          <p className="text-gold font-semibold text-sm mb-2">{tenantName}</p>
        )}
        <p className="text-[#64748b] text-sm leading-relaxed">
          Your partnership keeps this platform free for the new believer and scalable for the nations.
        </p>
      </div>

      {/* One-Time / Monthly Toggle */}
      <div className="bg-white rounded-xl p-1 flex mb-8 shadow-sm border border-gray-100">
        <button
          onClick={() => setDonationType('one-time')}
          className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${
            donationType === 'one-time'
              ? 'bg-gold text-white'
              : 'text-[#64748b] hover:bg-gray-50'
          }`}
        >
          One-Time
        </button>
        <button
          onClick={() => setDonationType('monthly')}
          className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
            donationType === 'monthly'
              ? 'bg-gold text-white'
              : 'text-[#64748b] hover:bg-gray-50'
          }`}
        >
          Monthly <Heart size={14} className={donationType === 'monthly' ? 'fill-white' : 'fill-[#64748b]'} />
        </button>
      </div>

      {/* Select Amount */}
      <div className="mb-8">
        <h3 className="text-[11px] font-bold text-[#94a3b8] tracking-wider uppercase mb-3">
          Select Amount
        </h3>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {presetAmounts.map((preset) => (
            <button
              key={preset}
              onClick={() => setAmount(preset)}
              className={`py-3 rounded-xl text-sm font-bold transition-colors border ${
                amount === preset
                  ? 'bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] border-gold text-gold'
                  : 'bg-white border-transparent text-[#0b1121] shadow-sm'
              }`}
            >
              ${preset}
            </button>
          ))}
        </div>
        <div className="bg-white rounded-xl p-4 flex items-center shadow-sm border border-gray-100">
          <span className="text-[#94a3b8] font-bold mr-2">$</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="bg-transparent font-bold text-[#0b1121] w-full focus:outline-none text-lg"
            placeholder="Other Amount"
          />
        </div>
      </div>

      {/* Security Info */}
      <div className="flex items-center justify-center gap-2 text-[#94a3b8] mb-4">
        <Lock size={14} />
        <span className="text-xs font-medium">Secure, encrypted payment via Stripe</span>
        <ShieldCheck size={14} className="ml-2" />
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center font-medium">
          {error}
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={handleDonate}
        disabled={isLoading}
        className="w-full bg-gold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl shadow-lg shadow-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] transition-all flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Redirecting to Stripe...
          </>
        ) : (
          <>
            <Heart size={18} className="fill-white" />
            Donate ${amount || '0'}{donationType === 'monthly' ? ' Monthly' : ''}
          </>
        )}
      </button>
    </div>
  );
};

export default PartnerWithUsTab;
