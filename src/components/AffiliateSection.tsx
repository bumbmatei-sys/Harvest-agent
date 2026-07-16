'use client';

import React, { useState, useEffect } from 'react';
import { Copy, Check, Share2, ExternalLink, TrendingUp, ChevronRight } from 'lucide-react';

const GOLD = 'var(--brand-color, #B8962E)';
const GOLD_LIGHT = 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)';

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
  thisMonthPending: number;
  recurringEarnings: number;
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
      // Unified Connect: the ONE church account powers donations AND affiliate
      // payouts. Route tenant owners through /api/stripe/connect so no SECOND
      // Stripe account is ever created (it reuses tenants/{id}.stripeConnectAccountId
      // and mirrors it onto the owner's affiliate fields). Fall back to the
      // affiliate-only onboarding for users without a tenant (e.g. platform admins).
      const { getTenantId } = await import('./settings/useTenantId');
      const tid = await getTenantId();
      const res = tid
        ? await fetch('/api/stripe/connect', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: tid }),
          })
        : await fetch('/api/affiliate/onboard', {
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
    const code = status?.affiliateCode || status?.userId || '';
    return `https://theharvest.site/pricing?ref=${code}`;
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
          <div key={i} className="h-12 bg-stone-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 pb-8">

      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold mb-1.5">Grow</p>
        <h2 className="font-display text-[1.75rem] lg:text-[2rem] leading-[1.1] font-light tracking-[-0.02em] text-earth">Affiliate Program</h2>
        <p className="text-sm text-warm-brown mt-2 max-w-xl">
          Share your link and earn commission on every subscription you refer — for as long as they stay subscribed.
        </p>
      </div>

      {/* This Month Earnings — hero stat */}
      <div className="rounded-brand-lg p-6 flex items-center justify-between"
        style={{ backgroundColor: GOLD_LIGHT }}>
        <div>
          <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em]">This Month</p>
          <p className="font-display text-[2.6rem] leading-none font-light mt-1.5" style={{ color: GOLD }}>
            {fmt(status?.thisMonthEarnings || 0)}
          </p>
          {(status?.thisMonthPending || 0) > 0 && (
            <p className="text-xs text-warm-brown mt-1.5">
              {fmt(status?.thisMonthPending || 0)} pending payout
            </p>
          )}
        </div>
        <TrendingUp size={32} style={{ color: GOLD }} className="opacity-40" />
      </div>

      {/* Stats row — 2×2 on mobile, 4-across on desktop so the Recurring card fits
          without cramping the phone layout. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 text-center">
          <p className="font-display text-[1.75rem] leading-none font-light text-earth">{status?.affiliateClicks || 0}</p>
          <p className="text-xs text-warm-brown mt-1.5">Clicks</p>
        </div>
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 text-center">
          <p className="font-display text-[1.75rem] leading-none font-light text-earth">{status?.referralCount || 0}</p>
          <p className="text-xs text-warm-brown mt-1.5">Referrals</p>
        </div>
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 text-center">
          <p className="font-display text-[1.75rem] leading-none font-light" style={{ color: GOLD }}>{fmt(status?.recurringEarnings || 0)}</p>
          <p className="text-xs text-warm-brown mt-1.5">Recurring</p>
        </div>
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 text-center">
          <p className="font-display text-[1.75rem] leading-none font-light text-earth">{fmt(status?.totalEarnings || 0)}</p>
          <p className="text-xs text-warm-brown mt-1.5">Lifetime</p>
        </div>
      </div>

      {/* Referral Link */}
      <div>
        <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em] mb-2">Your Referral Link</p>
        <div className="bg-white rounded-2xl border border-stone-200 px-4 py-3 flex items-center gap-3">
          <Share2 size={16} style={{ color: GOLD }} className="flex-shrink-0" />
          <span className="flex-1 text-sm text-[color:var(--text-body)] truncate font-mono">
            {status?.affiliateCode
              ? `theharvest.site/pricing?ref=${status.affiliateCode}`
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
            className="text-xs text-[color:var(--text-faint)] hover:text-warm-brown flex items-center gap-1"
          >
            <ExternalLink size={12} /> Manage
          </button>
        </div>
      )}

      {/* Commission info — one flat rate for every referral, every plan. */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2">
        <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em] pb-1">Commission Rate</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-warm-brown">All plans</span>
          <span className="text-sm font-bold" style={{ color: GOLD }}>15% recurring</span>
        </div>
        <p className="text-[10px] text-[color:var(--text-faint)] pt-1 border-t border-stone-200">
          You earn commission every month for as long as your referral stays subscribed.
          If they cancel, commission stops.
        </p>
        <p className="text-[10px] text-[color:var(--text-faint)]">
          Commissions transfer to your Stripe account automatically — instantly when a
          referral pays if your payouts are already connected, or as soon as you finish
          connecting Stripe for anything you earned beforehand. When the money reaches
          your bank follows Stripe&rsquo;s payout schedule.
        </p>
      </div>

    </div>
  );
}
