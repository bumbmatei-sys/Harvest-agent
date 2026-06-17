'use client';

import React, { useState, useEffect } from 'react';
import { Share2, DollarSign, Users, ExternalLink } from 'lucide-react';

interface AffiliateStatus {
  isAffiliate: boolean;
  userId: string;
  stripeConnectAccountId: string | null;
  totalEarnings: number;
  pendingPayouts: number;
  referralCount: number;
}

export default function AffiliateSection() {
  const [status, setStatus] = useState<AffiliateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

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
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch affiliate status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBecomeAffiliate = async () => {
    try {
      setOnboarding(true);
      const { auth } = await import('../firebase');
      const user = auth.currentUser;
      if (!user) { alert('Please sign in first.'); return; }
      const token = await user.getIdToken();
      const res = await fetch('/api/affiliate/onboard', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to start affiliate onboarding. Please try again.');
      }
    } catch (err) {
      console.error('Failed to start affiliate onboarding:', err);
      alert('Failed to start affiliate onboarding. Please try again.');
    } finally {
      setOnboarding(false);
    }
  };

  const handleCopyLink = () => {
    if (typeof window !== 'undefined' && status?.userId) {
      const link = `${window.location.origin}/?ref=${status.userId}`;
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="text-lg font-bold text-gray-900 mb-3">Affiliate Program</h3>

      {status?.isAffiliate ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share your referral link and earn <strong>10% lifetime commission</strong> on every subscription.
          </p>

          {/* Referral Link */}
          <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-2">
            <Share2 size={18} className="text-gray-400 shrink-0" />
            <input
              type="text"
              readOnly
              value={`${window.location.origin}/?ref=${status.userId}`}
              className="flex-1 bg-transparent text-sm text-gray-700 outline-none"
            />
            <button
              onClick={handleCopyLink}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <DollarSign size={18} className="mx-auto text-green-500 mb-1" />
              <p className="text-lg font-bold text-gray-900">
                ${(status.totalEarnings / 100).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500">Total Earnings</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <DollarSign size={18} className="mx-auto text-yellow-500 mb-1" />
              <p className="text-lg font-bold text-gray-900">
                ${(status.pendingPayouts / 100).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500">Pending</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <Users size={18} className="mx-auto text-blue-500 mb-1" />
              <p className="text-lg font-bold text-gray-900">{status.referralCount}</p>
              <p className="text-xs text-gray-500">Referrals</p>
            </div>
          </div>

          <a
            href="/api/affiliate/onboard"
            onClick={(e) => { e.preventDefault(); handleBecomeAffiliate(); }}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ExternalLink size={14} />
            Manage Stripe account
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Join our affiliate program and earn <strong>10% lifetime commission</strong> on every subscription
            you refer. Payouts are processed through Stripe Connect.
          </p>
          <button
            onClick={handleBecomeAffiliate}
            disabled={onboarding}
            className="w-full py-3 px-4 rounded-xl font-medium text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand-color, #e6b325)' }}
          >
            {onboarding ? 'Setting up…' : 'Become an Affiliate'}
          </button>
        </div>
      )}
    </div>
  );
}
