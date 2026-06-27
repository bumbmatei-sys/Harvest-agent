'use client';

import React, { useState, useEffect } from 'react';
import { Copy, Check, Share2, ExternalLink, TrendingUp, ChevronRight } from 'lucide-react';

const GOLD = '#B8962E';
const GOLD_LIGHT = '#FBF3E4';

interface AffiliateStatus {
  isAffiliate: boolean;
  userId: string;
  stripeConnectAccountId: string | null;
  affiliateConnectStatus: string | null;
  affiliateCode: string | null;
  affiliateClicks: number;
  totalEarnings: number;
  pendingPayouts: number;
  referralCount: number;
  thisMonthEarnings: number;
}

export default function AffiliateSection() {
  const [status, setStatus] = useState<AffiliateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchStatus(); }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const { auth } = await import('../firebase');
      const user = auth.currentUser;
      if (!user) { setLoading(false); return; }
      const token = await user.getIdToken();
      const res = await fetch('/api/affiliate/status', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) setStatus(await res.json());
    } catch (err) { console.error('Failed to fetch affiliate status:', err); }
    finally { setLoading(false); }
  };

  const handleGetLink = async () => {
    // If code already exists, just show it — no action needed
    // If not (shouldn't happen since status API auto-generates), call onboard
    if (!status?.affiliateCode) {
      setGeneratingLink(true);
      try {
        const { auth } = await import('../firebase');
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        // Calling status again forces code generation
        const res = await fetch('/api/affiliate/status', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) setStatus(await res.json());
      } catch (err) { console.error(err); }
      finally { setGeneratingLink(false); }
    }
  };

  const handleSetupPayouts = async () => {
    try {
      setOnboarding(true);
      const { auth } = await import('../firebase');
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch('/api/affiliate/onboard', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Failed to start payout setup. Please try again.');
    } catch (err) { console.error(err); }
    finally { setOnboarding(false); }
  };

  const getReferralLink = () => {
    if (status?.affiliateCode) return `https://theharvest.app/r/${status.affiliateCode}`;
    return `https://theharvest.app/?ref=${status?.userId || ''}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getReferralLink());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const payoutsConnected = status?.stripeConnectAccountId &&
    status?.affiliateConnectStatus === 'active';

  if (loading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ paddingBottom: 32 }}>

      {/* Header */}
      <div>
        <h3 className="text-base font-black text-gray-900">Affiliate Program</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Share your link and earn commission on every subscription you refer — for as long as they stay subscribed.
        </p>
      </div>

      {/* This Month Earnings — hero stat */}
      <div className="rounded-2xl p-4 flex items-center justify-between"
        style={{ backgroundColor: GOLD_LIGHT }}>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">This Month</p>
          <p className="text-3xl font-black mt-0.5" style={{ color: GOLD }}>
            {fmt(status?.thisMonthEarnings || 0)}
          </p>
        </div>
        <TrendingUp size={32} style={{ color: GOLD }} className="opacity-40" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-lg font-black text-gray-900">{status?.affiliateClicks || 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Clicks</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-lg font-black text-gray-900">{status?.referralCount || 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Referrals</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-base font-black text-gray-900">{fmt(status?.totalEarnings || 0)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Lifetime</p>
        </div>
      </div>

      {/* Referral Link */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Your Referral Link</p>
        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
          <Share2 size={16} style={{ color: GOLD }} className="flex-shrink-0" />
          <span className="flex-1 text-sm text-gray-700 truncate font-mono">
            {status?.affiliateCode
              ? `theharvest.app/r/${status.affiliateCode}`
              : 'Generating your link…'}
          </span>
          <button
            onClick={handleCopy}
            disabled={!status?.affiliateCode}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
            style={{ backgroundColor: GOLD_LIGHT, color: GOLD }}
          >
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
      </div>

      {/* Payout status */}
      {!payoutsConnected ? (
        <button
          onClick={handleSetupPayouts}
          disabled={onboarding}
          className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2"
          style={{ backgroundColor: GOLD }}
        >
          {onboarding ? 'Opening Stripe…' : 'Set Up Payouts with Stripe'}
          {!onboarding && <ChevronRight size={16} />}
        </button>
      ) : (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-semibold text-green-700">Payouts connected</span>
          </div>
          <button
            onClick={handleSetupPayouts}
            disabled={onboarding}
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            <ExternalLink size={12} /> Manage
          </button>
        </div>
      )}

      {/* Commission info */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Commission Rates</p>
        {[
          { plan: 'Individual', rate: '10%', key: 'plus' },
          { plan: 'Small Team', rate: '10%', key: 'pro' },
          { plan: 'Community', rate: '15%', key: 'max' },
          { plan: 'Ministry', rate: '20%', key: 'ultra' },
        ].map(row => (
          <div key={row.key} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{row.plan}</span>
            <span className="text-sm font-bold" style={{ color: GOLD }}>{row.rate} recurring</span>
          </div>
        ))}
        <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-100">
          You earn commission every month for as long as your referral stays subscribed.
          If they cancel, commission stops.
        </p>
      </div>

    </div>
  );
}
