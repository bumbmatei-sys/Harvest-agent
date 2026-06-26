"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { Heart, Clock, ChevronLeft, Loader2 } from 'lucide-react';

interface Campaign {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  goal: number;
  raised: number;
  endDate?: string;
  isActive: boolean;
  donateUrl?: string;
  tenantId?: string;
}

interface CampaignWidgetProps {
  onDonate?: (campaign: Campaign) => void;
}

const AMOUNT_PRESETS = [25, 50, 100, 250];

const CampaignWidget: React.FC<CampaignWidgetProps> = ({ onDonate }) => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [donateError, setDonateError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      const tenantId = await getTenantScope();
      if (cancelled) return;

      // Single-field filter only (isActive); tenant scoping applied in-memory to avoid a composite index.
      const q = query(collection(db, 'campaigns'), where('isActive', '==', true), limit(20));

      unsub = onSnapshot(q, (snap) => {
        if (cancelled) return;
        const docs = tenantId ? snap.docs.filter(d => d.data().tenantId === tenantId) : snap.docs;
        if (docs.length > 0) {
          const d = docs[0];
          setCampaign({ id: d.id, ...d.data() } as Campaign);
        } else {
          setCampaign(null);
        }
        setLoading(false);
      }, (err) => {
        console.error('Failed to load campaign:', err);
        if (!cancelled) setLoading(false);
      });
    })();

    return () => { cancelled = true; unsub?.(); };
  }, []);

  useEffect(() => {
    if (showDetail && auth.currentUser) {
      setDonorName(auth.currentUser.displayName || '');
      setDonorEmail(auth.currentUser.email || '');
    }
    if (!showDetail) {
      setSelectedAmount(null);
      setCustomAmount('');
      setDonateError('');
    }
  }, [showDetail]);

  if (loading || !campaign) return null;

  const percentage = campaign.goal > 0
    ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100))
    : 0;

  const daysLeft = campaign.endDate
    ? Math.max(0, Math.ceil((new Date(campaign.endDate).getTime() - Date.now()) / 86_400_000))
    : null;

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const handleDonateClick = () => {
    if (campaign.donateUrl) {
      window.open(campaign.donateUrl, '_blank', 'noopener,noreferrer');
    } else if (onDonate) {
      onDonate(campaign);
    } else {
      setShowDetail(true);
    }
  };

  const handleSubmitDonation = async () => {
    const amount = selectedAmount ?? (customAmount ? parseFloat(customAmount) : 0);
    if (!amount || amount <= 0) { setDonateError('Please select or enter an amount'); return; }
    if (!donorEmail.trim()) { setDonateError('Email is required'); return; }
    setIsProcessing(true);
    setDonateError('');
    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      const res = await fetch('/api/stripe/donate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          metadata: {
            type: 'donation',
            campaignId: campaign.id,
            tenantId: campaign.tenantId || '',
            donorName: donorName.trim(),
            donorEmail: donorEmail.trim(),
          },
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setDonateError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setDonateError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
        {campaign.coverImage && (
          <div className="relative h-40 bg-gray-100">
            <Image src={campaign.coverImage} alt={campaign.title} fill sizes="(max-width: 768px) 100vw, 800px" className="object-cover" referrerPolicy="no-referrer" />
            {daysLeft !== null && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm">
                <Clock size={12} />
                {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
              </div>
            )}
          </div>
        )}
        <div className="p-4">
          {!campaign.coverImage && daysLeft !== null && (
            <div className="flex items-center gap-1 text-xs font-semibold mb-2" style={{ color: 'var(--brand-color, #d4a017)' }}>
              <Clock size={12} />
              {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
            </div>
          )}
          <h3 className="text-base font-bold text-gray-900 mb-1 leading-snug">{campaign.title}</h3>
          <p className="text-sm text-gray-500 line-clamp-2 mb-3 leading-snug">{campaign.description}</p>
          <div className="mb-3">
            <div className="flex justify-between items-baseline mb-1.5 text-xs text-gray-500">
              <span className="font-semibold text-gray-700">{fmt(campaign.raised)} raised</span>
              <span>of {fmt(campaign.goal)}</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${percentage}%`, backgroundColor: 'var(--brand-color, #e6b325)' }} />
            </div>
            <div className="text-right text-[11px] font-bold mt-1" style={{ color: 'var(--brand-color, #e6b325)' }}>{percentage}%</div>
          </div>
          <button
            onClick={handleDonateClick}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-75"
            style={{ backgroundColor: 'var(--brand-color, #e6b325)' }}
          >
            <Heart size={15} strokeWidth={2.5} />
            Donate
          </button>
        </div>
      </div>

      {/* Campaign Detail / Donation Modal */}
      {showDetail && (
        <div className="fixed inset-0 z-[300] flex flex-col bg-white overflow-y-auto">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
            <button onClick={() => setShowDetail(false)} className="p-1">
              <ChevronLeft size={24} color="#B8962E" strokeWidth={2.5} />
            </button>
            <h2 className="text-base font-bold text-gray-900 flex-1 truncate">{campaign.title}</h2>
          </div>

          {/* Cover Image */}
          {campaign.coverImage && (
            <div className="relative h-52 bg-gray-100 flex-shrink-0">
              <Image src={campaign.coverImage} alt={campaign.title} fill sizes="100vw" className="object-cover" referrerPolicy="no-referrer" />
              {daysLeft !== null && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm">
                  <Clock size={12} />
                  {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
                </div>
              )}
            </div>
          )}

          <div className="p-4 space-y-5 pb-10">
            {/* Progress */}
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="flex justify-between items-baseline mb-2 text-sm">
                <span className="font-bold text-gray-900">{fmt(campaign.raised)} raised</span>
                <span className="text-gray-500">of {fmt(campaign.goal)}</span>
              </div>
              <div className="h-3 bg-gray-200 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full" style={{ width: `${percentage}%`, backgroundColor: 'var(--brand-color, #e6b325)' }} />
              </div>
              <div className="text-right text-xs font-bold" style={{ color: 'var(--brand-color, #e6b325)' }}>{percentage}%</div>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-600 leading-relaxed">{campaign.description}</p>

            {/* Amount Selection */}
            <div>
              <p className="text-sm font-bold text-gray-900 mb-3">Select Amount</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {AMOUNT_PRESETS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => { setSelectedAmount(amt); setCustomAmount(''); }}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${
                      selectedAmount === amt ? 'text-white border-transparent' : 'text-gray-700 border-gray-200 bg-white'
                    }`}
                    style={selectedAmount === amt ? { backgroundColor: 'var(--brand-color, #e6b325)', borderColor: 'var(--brand-color, #e6b325)' } : {}}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                value={customAmount}
                onChange={e => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                placeholder="Custom amount ($)"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
              />
            </div>

            {/* Donor Info */}
            <div className="space-y-3">
              <p className="text-sm font-bold text-gray-900">Your Information</p>
              <input
                value={donorName}
                onChange={e => setDonorName(e.target.value)}
                placeholder="Your name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
              />
              <input
                type="email"
                value={donorEmail}
                onChange={e => setDonorEmail(e.target.value)}
                placeholder="Your email *"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
              />
            </div>

            {donateError && (
              <p className="text-xs text-red-500 font-medium">{donateError}</p>
            )}

            <button
              onClick={handleSubmitDonation}
              disabled={isProcessing || (!selectedAmount && !customAmount)}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--brand-color, #e6b325)' }}
            >
              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Heart size={15} strokeWidth={2.5} />}
              {isProcessing
                ? 'Processing...'
                : `Donate${selectedAmount ? ` $${selectedAmount}` : customAmount ? ` $${customAmount}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default CampaignWidget;
