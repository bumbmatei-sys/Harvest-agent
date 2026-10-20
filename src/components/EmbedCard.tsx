"use client";
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FileText, HeartHandshake, Calendar as CalendarIcon, MapPin, Globe, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CampaignDetailSheet, type Campaign } from './CampaignWidget';
import { Button } from '@/components/ui/button';

// A post carries at most ONE embed — a lightweight reference (type + id), not a
// copy of the referenced content. The title/image/progress are resolved from
// the live doc at render time, so a card stays fresh if the campaign progress
// or event details change after the post was written.
export type EmbedType = 'blog' | 'fundraising' | 'event';
export interface PostEmbed {
  type: EmbedType;
  id: string;
}

export interface ResolvedEmbed {
  type: EmbedType;
  id: string;
  title: string;
  image?: string;
  href: string;
  // blog
  excerpt?: string;
  category?: string;
  // fundraising
  raised?: number;
  goal?: number;
  percentage?: number;
  // event
  dateLabel?: string;
  location?: string;
  /**
   * The live campaign, when this embed is a fundraiser. The member feed opens
   * it in `CampaignDetailSheet` instead of navigating to the public page.
   */
  campaign?: Campaign;
}

type ResolveStatus = 'loading' | 'ready' | 'missing';

// LucideIcon rather than a hand-written ComponentType: lucide types `size` as
// string | number, which does not satisfy a `size?: number` prop contract.
const TYPE_META: Record<EmbedType, { label: string; Icon: LucideIcon }> = {
  blog: { label: 'Article', Icon: FileText },
  fundraising: { label: 'Fundraiser', Icon: HeartHandshake },
  event: { label: 'Event', Icon: CalendarIcon },
};

// Resolve once, then share across every post/preview that references the same
// item — a feed can show the same campaign in several places, and the composer
// preview + feed card of a just-posted embed should not each refetch.
const cache = new Map<string, ResolvedEmbed | null>();
const inflight = new Map<string, Promise<ResolvedEmbed | null>>();

const keyOf = (embed: PostEmbed, tenantId: string | null | undefined) => `${embed.type}:${tenantId ?? ''}:${embed.id}`;

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function campaignFromDoc(id: string, d: Record<string, unknown>): Campaign {
  const providers = Array.isArray(d.paymentProviders)
    ? d.paymentProviders.filter((provider): provider is string => typeof provider === 'string')
    : undefined;
  return {
    id,
    title: typeof d.title === 'string' && d.title ? d.title : 'Campaign',
    description: typeof d.description === 'string' ? d.description : '',
    coverImage: typeof d.coverImage === 'string' ? d.coverImage : undefined,
    goal: Number(d.goal) || 0,
    raised: Number(d.raised) || 0,
    endDate: typeof d.endDate === 'string' ? d.endDate : undefined,
    isActive: d.isActive !== false,
    donateUrl: typeof d.donateUrl === 'string' ? d.donateUrl : undefined,
    paymentProviders: providers,
    tenantId: typeof d.tenantId === 'string' ? d.tenantId : undefined,
    campaignType: typeof d.campaignType === 'string' ? d.campaignType : undefined,
  };
}

async function resolveEmbed(embed: PostEmbed, tenantId: string | null | undefined): Promise<ResolvedEmbed | null> {
  try {
    if (embed.type === 'blog') {
      const snap = await getDoc(doc(db, 'blog_posts', embed.id));
      if (!snap.exists()) return null;
      const d = snap.data() as any;
      const raw = typeof d.content === 'string' ? stripHtml(d.content) : '';
      return {
        type: 'blog',
        id: embed.id,
        title: d.title || 'Untitled article',
        image: d.featuredImage || undefined,
        excerpt: raw ? raw.slice(0, 140) : undefined,
        category: d.category || undefined,
        href: `/blog/${embed.id}`,
      };
    }
    if (embed.type === 'fundraising') {
      const snap = await getDoc(doc(db, 'campaigns', embed.id));
      if (!snap.exists()) return null;
      const d = snap.data() as Record<string, unknown>;
      const campaign = campaignFromDoc(embed.id, d);
      const percentage = campaign.goal > 0
        ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100))
        : 0;
      // Pledge campaigns keep their public page. A fundraising campaign's
      // public URL stays `/campaign/[id]` for shares; the member feed opens
      // the in-app sheet instead of following that href.
      const isPledge = campaign.campaignType === 'pledge';
      return {
        type: 'fundraising',
        id: embed.id,
        title: campaign.title,
        image: campaign.coverImage,
        raised: campaign.raised,
        goal: campaign.goal,
        percentage,
        href: `/${isPledge ? 'pledge' : 'campaign'}/${embed.id}`,
        campaign,
      };
    }
    // event — lives under tenants/{tenantId}/events
    if (!tenantId) return null;
    const snap = await getDoc(doc(db, 'tenants', tenantId, 'events', embed.id));
    if (!snap.exists()) return null;
    const d = snap.data() as any;
    const start = d.startDate && typeof d.startDate.toDate === 'function' ? d.startDate.toDate() : null;
    return {
      type: 'event',
      id: embed.id,
      title: d.title || 'Event',
      image: d.coverImage || undefined,
      dateLabel: start ? fmtDate(start) : undefined,
      location: d.isOnline ? 'Online' : d.location || undefined,
      href: `/event/${embed.id}`,
    };
  } catch (e) {
    console.error('Failed to resolve embed', embed, e);
    return null;
  }
}

/**
 * Resolve an embed reference to its live display data. Returns a status of
 * 'loading' | 'ready' | 'missing' — 'missing' covers a deleted referenced item
 * (and, for events, a null tenant), so callers can degrade gracefully instead
 * of crashing.
 */
export function useResolvedEmbed(embed: PostEmbed | null | undefined, tenantId: string | null | undefined) {
  const [state, setState] = useState<{ status: ResolveStatus; data: ResolvedEmbed | null }>(() => {
    if (!embed) return { status: 'missing', data: null };
    const k = keyOf(embed, tenantId);
    if (cache.has(k)) {
      const c = cache.get(k)!;
      return { status: c ? 'ready' : 'missing', data: c };
    }
    return { status: 'loading', data: null };
  });

  useEffect(() => {
    if (!embed) {
      setState({ status: 'missing', data: null });
      return;
    }
    const k = keyOf(embed, tenantId);
    if (cache.has(k)) {
      const c = cache.get(k)!;
      setState({ status: c ? 'ready' : 'missing', data: c });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', data: null });
    let p = inflight.get(k);
    if (!p) {
      p = resolveEmbed(embed, tenantId);
      inflight.set(k, p);
    }
    p.then((res) => {
      cache.set(k, res);
      inflight.delete(k);
      if (!cancelled) setState({ status: res ? 'ready' : 'missing', data: res });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.type, embed?.id, tenantId]);

  return state;
}

const EMBED_CARD_CLASS =
  'group mb-3 flex overflow-hidden rounded-xl border border-line bg-surface-raised transition-colors hover:border-gold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gold';

const EmbedCardFace: React.FC<{ data: ResolvedEmbed }> = ({ data }) => {
  const { Icon, label } = TYPE_META[data.type];
  return (
    <>
      {data.image ? (
        <div className="relative w-24 sm:w-28 shrink-0 bg-surface-sunken">
          <Image src={data.image} alt="" fill sizes="112px" className="object-cover" referrerPolicy="no-referrer" />
        </div>
      ) : (
        <div className="w-24 sm:w-28 shrink-0 bg-surface-sunken flex items-center justify-center">
          <Icon size={22} className="text-stone-300" />
        </div>
      )}
      <div className="flex-1 min-w-0 p-3">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gold">
          <Icon size={11} /> {label}
        </span>
        <h5 className="font-bold text-strong text-sm leading-snug line-clamp-2 mt-1 group-hover:text-gold transition-colors">
          {data.title}
        </h5>

        {data.type === 'blog' && data.excerpt && (
          <p className="text-xs text-muted line-clamp-2 mt-1">{data.excerpt}</p>
        )}

        {data.type === 'fundraising' && (
          <div className="mt-2">
            <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${data.percentage}%`, backgroundColor: 'var(--brand-color, #e6b325)' }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted mt-1">
              <span className="font-semibold text-body">{fmtMoney(data.raised || 0)}</span>
              <span>of {fmtMoney(data.goal || 0)}</span>
            </div>
          </div>
        )}

        {data.type === 'event' && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted mt-1.5">
            {data.dateLabel && (
              <span className="flex items-center gap-1">
                <CalendarIcon size={12} />
                {data.dateLabel}
              </span>
            )}
            {data.location && (
              <span className="flex items-center gap-1">
                {data.location === 'Online' ? <Globe size={12} /> : <MapPin size={12} />}
                {data.location}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
};

/**
 * The rich preview card rendered below a post's text/images when it has an
 * embed. Blog and event cards, and pledge campaigns, link to their public
 * page. A fundraising campaign opens the same in-app detail sheet as the
 * feed banner — `/campaign/[id]` stays the public share URL and is not where
 * a signed-in member is sent. A deleted item degrades to a muted
 * "no longer available" chip.
 */
export const FeedEmbedCard: React.FC<{ embed: PostEmbed; tenantId: string | null | undefined }> = ({ embed, tenantId }) => {
  const { status, data } = useResolvedEmbed(embed, tenantId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [embed.type, embed.id]);

  if (status === 'loading') {
    return <div className="mb-3 h-[76px] rounded-xl bg-surface-sunken border border-line animate-pulse" />;
  }
  if (status === 'missing' || !data) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2.5 text-xs text-muted">
        <FileText size={14} className="text-faint shrink-0" />
        This attachment is no longer available.
      </div>
    );
  }

  // Pledge campaigns have their own public page. Every other fundraiser in
  // the member feed opens the in-app sheet rather than `/campaign/[id]`.
  const inAppCampaign = data.type === 'fundraising'
    && !!data.campaign
    && data.campaign.campaignType !== 'pledge';

  if (inAppCampaign && data.campaign) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          data-testid="feed-campaign-card"
          aria-label={`View ${data.title}`}
          onClick={() => setOpen(true)}
          className={`${EMBED_CARD_CLASS} h-auto w-full cursor-pointer items-stretch justify-start whitespace-normal p-0 text-left font-normal hover:bg-transparent`}
        >
          <EmbedCardFace data={data} />
        </Button>
        {open && (
          <CampaignDetailSheet campaign={data.campaign} onClose={() => setOpen(false)} />
        )}
      </>
    );
  }

  return (
    <a href={data.href} className={EMBED_CARD_CLASS}>
      <EmbedCardFace data={data} />
    </a>
  );
};

/**
 * Compact, removable preview of the currently-attached embed shown inside the
 * composer. One embed per post — attaching a new one replaces this.
 */
export const EmbedComposerChip: React.FC<{ embed: PostEmbed; tenantId: string | null | undefined; onRemove: () => void }> = ({
  embed,
  tenantId,
  onRemove,
}) => {
  const { status, data } = useResolvedEmbed(embed, tenantId);
  const { Icon, label } = TYPE_META[embed.type];

  return (
    <div className="relative flex items-center gap-3 rounded-xl border border-line bg-surface-sunken p-2.5 pr-9">
      <div className="w-11 h-11 rounded-lg overflow-hidden bg-surface-sunken shrink-0 relative flex items-center justify-center">
        {data?.image ? (
          <Image src={data.image} alt="" fill sizes="44px" className="object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Icon size={18} className="text-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gold">
          <Icon size={10} /> {label}
        </span>
        <p className="text-sm font-semibold text-strong truncate">
          {status === 'loading' ? 'Loading…' : status === 'missing' ? 'Unavailable' : data?.title}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
};
