"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { Heart, Clock } from 'lucide-react';

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
  /** Called when the user taps Donate. Receives the active campaign object. */
  onDonate?: (campaign: Campaign) => void;
}

/**
 * Fundraising campaign widget — renders only when an active campaign exists.
 * Pinned at the top of the News & Updates section.
 * Disappears completely when there is no active campaign (no placeholder).
 */
const CampaignWidget: React.FC<CampaignWidgetProps> = ({ onDonate }) => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      const tenantId = await getTenantScope();
      if (cancelled) return;

      const q = tenantId
        ? query(
            collection(db, 'campaigns'),
            where('tenantId', '==', tenantId),
            where('isActive', '==', true),
            limit(1)
          )
        : query(collection(db, 'campaigns'), where('isActive', '==', true), limit(1));

      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          if (!snap.empty) {
            const d = snap.docs[0];
            setCampaign({ id: d.id, ...d.data() } as Campaign);
          } else {
            setCampaign(null);
          }
          setLoading(false);
        },
        (err) => {
          console.error('Failed to load campaign:', err);
          if (!cancelled) setLoading(false);
        }
      );
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Render nothing during load or when no active campaign exists
  if (loading || !campaign) return null;

  const percentage = campaign.goal > 0
    ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100))
    : 0;

  const daysLeft = campaign.endDate
    ? Math.max(0, Math.ceil((new Date(campaign.endDate).getTime() - Date.now()) / 86_400_000))
    : null;

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      {/* Cover image */}
      {campaign.coverImage && (
        <div className="relative h-40 bg-gray-100">
          <Image
            src={campaign.coverImage}
            alt={campaign.title}
            fill
            sizes="(max-width: 768px) 100vw, 800px"
            className="object-cover"
            referrerPolicy="no-referrer"
          />
          {/* Deadline badge overlaid on image */}
          {daysLeft !== null && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm">
              <Clock size={12} />
              {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        {/* Deadline when no cover image */}
        {!campaign.coverImage && daysLeft !== null && (
          <div className="flex items-center gap-1 text-xs font-semibold mb-2" style={{ color: 'var(--brand-color, #d4a017)' }}>
            <Clock size={12} />
            {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
          </div>
        )}

        <h3 className="text-base font-bold text-gray-900 mb-1 leading-snug">{campaign.title}</h3>
        <p className="text-sm text-gray-500 line-clamp-2 mb-3 leading-snug">{campaign.description}</p>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex justify-between items-baseline mb-1.5 text-xs text-gray-500">
            <span className="font-semibold text-gray-700">{fmt(campaign.raised)} raised</span>
            <span>of {fmt(campaign.goal)}</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${percentage}%`, backgroundColor: 'var(--brand-color, #e6b325)' }}
            />
          </div>
          <div
            className="text-right text-[11px] font-bold mt-1"
            style={{ color: 'var(--brand-color, #e6b325)' }}
          >
            {percentage}%
          </div>
        </div>

        {/* Donate CTA */}
        <button
          onClick={() => {
            if (campaign.donateUrl) {
              window.open(campaign.donateUrl, '_blank', 'noopener,noreferrer');
            } else {
              onDonate?.(campaign);
            }
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-75"
          style={{ backgroundColor: 'var(--brand-color, #e6b325)' }}
        >
          <Heart size={15} strokeWidth={2.5} />
          Donate
        </button>
      </div>
    </div>
  );
};

export default CampaignWidget;
