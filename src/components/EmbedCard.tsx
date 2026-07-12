"use client";
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FileText, HeartHandshake, Calendar as CalendarIcon, MapPin, Globe, X } from 'lucide-react';

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
}

type ResolveStatus = 'loading' | 'ready' | 'missing';

const TYPE_META: Record<EmbedType, { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
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
      const d = snap.data() as any;
      const goal = Number(d.goal) || 0;
      const raised = Number(d.raised) || 0;
      const percentage = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
      // Pledge campaigns have their own public page; regular donation campaigns
      // live at /campaign/[id] — mirror CampaignWidget's routing.
      const isPledge = d.campaignType === 'pledge';
      return {
        type: 'fundraising',
        id: embed.id,
        title: d.title || 'Campaign',
        image: d.coverImage || undefined,
        raised,
        goal,
        percentage,
        href: `/${isPledge ? 'pledge' : 'campaign'}/${embed.id}`,
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

/**
 * The rich preview card rendered below a post's text/images when it has an
 * embed. Whole card is a link to the referenced item's public page. A deleted
 * item degrades to a muted "no longer available" chip.
 */
export const FeedEmbedCard: React.FC<{ embed: PostEmbed; tenantId: string | null | undefined }> = ({ embed, tenantId }) => {
  const { status, data } = useResolvedEmbed(embed, tenantId);

  if (status === 'loading') {
    return <div className="mb-3 h-[76px] rounded-xl bg-stone-100 border border-stone-200 animate-pulse" />;
  }
  if (status === 'missing' || !data) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-warm-brown">
        <FileText size={14} className="text-stone-400 shrink-0" />
        This attachment is no longer available.
      </div>
    );
  }

  const { Icon, label } = TYPE_META[data.type];

  return (
    <a
      href={data.href}
      className="group mb-3 flex overflow-hidden rounded-xl border border-stone-200 bg-white transition-colors hover:border-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {data.image ? (
        <div className="relative w-24 sm:w-28 shrink-0 bg-stone-100">
          <Image src={data.image} alt="" fill sizes="112px" className="object-cover" referrerPolicy="no-referrer" />
        </div>
      ) : (
        <div className="w-24 sm:w-28 shrink-0 bg-stone-100 flex items-center justify-center">
          <Icon size={22} className="text-stone-300" />
        </div>
      )}
      <div className="flex-1 min-w-0 p-3">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gold">
          <Icon size={11} /> {label}
        </span>
        <h5 className="font-bold text-earth text-sm leading-snug line-clamp-2 mt-1 group-hover:text-gold transition-colors">
          {data.title}
        </h5>

        {data.type === 'blog' && data.excerpt && (
          <p className="text-xs text-warm-brown line-clamp-2 mt-1">{data.excerpt}</p>
        )}

        {data.type === 'fundraising' && (
          <div className="mt-2">
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${data.percentage}%`, backgroundColor: 'var(--brand-color, #e6b325)' }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-warm-brown mt-1">
              <span className="font-semibold text-[color:var(--text-body)]">{fmtMoney(data.raised || 0)}</span>
              <span>of {fmtMoney(data.goal || 0)}</span>
            </div>
          </div>
        )}

        {data.type === 'event' && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-warm-brown mt-1.5">
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
    <div className="relative flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 p-2.5 pr-9">
      <div className="w-11 h-11 rounded-lg overflow-hidden bg-stone-100 shrink-0 relative flex items-center justify-center">
        {data?.image ? (
          <Image src={data.image} alt="" fill sizes="44px" className="object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Icon size={18} className="text-stone-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gold">
          <Icon size={10} /> {label}
        </span>
        <p className="text-sm font-semibold text-earth truncate">
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
