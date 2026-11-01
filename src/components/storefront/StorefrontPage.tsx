'use client';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Globe, HandHeart, Music2, Quote } from 'lucide-react';
import { SubscribeForm, type SubscribeSubmit } from '@/components/email/SubscribeBlock';
import { PlatformLogo } from '@/components/admin/social/PlatformLogo';
import {
  storefrontSections, videoEmbedUrl,
  type Storefront, type StorefrontBlock, type StorefrontSocial,
} from '@/lib/storefront/storefront';

export interface StorefrontArticleCard {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly excerpt: string;
  readonly image: string | null;
  readonly publishedAt: string | null;
}

export interface StorefrontEventCard {
  readonly id: string;
  readonly title: string;
  readonly startDate: string | null;
  readonly location: string | null;
}

export interface StorefrontPageProps {
  readonly storefront: Storefront;
  readonly tenantId: string;
  readonly articles: readonly StorefrontArticleCard[];
  readonly events: readonly StorefrontEventCard[];
  /** Picker blocks show the title they were saved with; this fills in a blank one. */
  readonly titles?: Readonly<Record<string, string>>;
  /** The editor's preview: links do not navigate and the email form does not send. */
  readonly preview?: boolean;
  readonly onSubscribe?: SubscribeSubmit;
}

const SOCIAL_LABEL: Record<StorefrontSocial, string> = {
  instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', threads: 'Threads', spotify: 'Spotify', website: 'Website',
};

function SocialIcon({ network }: { network: StorefrontSocial }) {
  if (network === 'instagram' || network === 'facebook' || network === 'youtube' || network === 'tiktok' || network === 'threads') {
    return <PlatformLogo platform={network} className="size-4" decorative />;
  }
  if (network === 'spotify') return <Music2 className="size-4" aria-hidden />;
  if (network === 'x') return <span aria-hidden className="text-sm font-bold leading-none">𝕏</span>;
  return <Globe className="size-4" aria-hidden />;
}

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso)) : '');

/** Where a block sends people. Relative paths stay on the ministry's own host. */
export function blockHref(block: StorefrontBlock, tenantId: string): string | null {
  switch (block.type) {
    case 'link': case 'bookCall': return block.url || null;
    case 'give': return '/giving';
    case 'community': return block.targetId ? `/community/${encodeURIComponent(tenantId)}/${encodeURIComponent(block.targetId)}` : null;
    case 'course': return block.targetId ? `/courses/${encodeURIComponent(block.targetId)}` : null;
    case 'form': return block.targetId ? `/form/${encodeURIComponent(block.targetId)}` : null;
    default: return null;
  }
}

function LinkCard({ href, preview, title, subtitle, icon }: { href: string; preview?: boolean; title: string; subtitle?: string; icon?: ReactNode }) {
  const external = /^https?:/.test(href);
  return (
    <a
      href={preview ? undefined : href}
      {...(external && !preview ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      aria-disabled={preview || undefined}
      data-storefront-link
      className="group flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-left transition-colors hover:border-[var(--sf-accent)] hover:bg-white/[0.1]"
    >
      {icon && <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--sf-accent)]/20 text-[var(--sf-accent)]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">{title}</span>
        {subtitle && <span className="block truncate text-xs text-white/60">{subtitle}</span>}
      </span>
      <ArrowRight className="size-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </a>
  );
}

function Block({ block, props }: { block: StorefrontBlock; props: StorefrontPageProps }) {
  const { tenantId, preview, titles = {} } = props;
  const href = blockHref(block, tenantId);
  switch (block.type) {
    case 'link':
    case 'bookCall':
      return href ? <LinkCard href={href} preview={preview} title={block.title || (block.type === 'bookCall' ? 'Book a call' : href)} subtitle={block.subtitle} icon={block.type === 'bookCall' ? <CalendarDays className="size-4" /> : undefined} /> : null;
    case 'give':
      return <LinkCard href="/giving" preview={preview} title={block.title || 'Give'} subtitle={block.subtitle} icon={<HandHeart className="size-4" />} />;
    case 'community': case 'course': case 'form':
      return href ? <LinkCard href={href} preview={preview} title={block.title || titles[block.targetId] || 'Open'} subtitle={block.subtitle} /> : null;
    case 'text':
      return (
        <div className="px-1 text-center">
          {block.title && <h2 className="text-lg font-semibold text-white">{block.title}</h2>}
          {block.body && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-white/70">{block.body}</p>}
        </div>
      );
    case 'video': {
      const embed = videoEmbedUrl(block.url);
      return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          {block.title && <p className="px-4 pt-3 text-sm font-semibold text-white">{block.title}</p>}
          {embed
            ? <iframe src={embed} title={block.title || 'Video'} className="aspect-video w-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" loading="lazy" />
            : <LinkCard href={block.url} preview={preview} title={block.title || 'Watch'} />}
        </div>
      );
    }
    case 'emailCapture':
      return (
        <div data-storefront-capture className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-white [&_input]:bg-white/10 [&_input]:text-white">
          <p className="font-semibold">{block.title || 'Stay in the loop'}</p>
          {block.subtitle && <p className="mt-0.5 text-sm text-white/60">{block.subtitle}</p>}
          <SubscribeForm className="mt-3" buttonLabel="Subscribe"
            onSubmit={preview ? async () => ({ ok: false, message: 'This is a preview. Nothing is sent.' }) : props.onSubscribe} />
        </div>
      );
    case 'events': {
      const events = props.events.slice(0, block.count);
      if (events.length === 0) return null;
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          {block.title && <p className="mb-2 font-semibold text-white">{block.title}</p>}
          <ul className="flex flex-col divide-y divide-white/10">
            {events.map((event) => (
              <li key={event.id}>
                <a href={preview ? undefined : `/event/${encodeURIComponent(event.id)}`} className="flex items-center gap-3 py-2 text-white">
                  <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--sf-accent)]">{day(event.startDate)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{event.title}</span>
                    {event.location && <span className="block truncate text-xs text-white/50">{event.location}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'blog': {
      const latest = props.articles.slice(0, 3);
      if (latest.length === 0) return null;
      return (
        <div data-storefront-blog className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          {block.title && <p className="mb-2 font-semibold text-white">{block.title}</p>}
          <ul className="flex flex-col gap-2">
            {latest.map((article) => (
              <li key={article.id}>
                <a href={preview ? undefined : `/blog/${encodeURIComponent(article.id)}`} className="flex gap-3 rounded-xl p-1 text-white hover:bg-white/5">
                  {article.image
                    ? <img src={article.image} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
                    : <span className="size-14 shrink-0 rounded-lg bg-[var(--sf-accent)]/20" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    {article.category && <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--sf-accent)]">{article.category}</span>}
                    <span className="line-clamp-2 text-sm font-medium">{article.title}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <a href={preview ? undefined : '/storefront/blog'} data-storefront-view-all
            className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-white/15 text-sm font-semibold text-white hover:border-[var(--sf-accent)]">
            View all
          </a>
        </div>
      );
    }
    case 'testimonials':
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          {block.title && <p className="mb-2 font-semibold text-white">{block.title}</p>}
          <ul className="flex flex-col gap-3">
            {block.items.map((item, index) => (
              <li key={index} className="text-white">
                <Quote className="size-4 text-[var(--sf-accent)]" aria-hidden />
                <p className="mt-1 text-sm leading-relaxed text-white/80">{item.quote}</p>
                {item.name && <p className="mt-1 text-xs font-semibold text-white/60">{item.name}</p>}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'category':
      return null;
  }
}

/**
 * The public Storefront, in its one template (Eden 001/005/015): the profile on
 * a dark card, social icons, then the blocks. Categories add filter chips when
 * there are two or more of them.
 */
export function StorefrontPage(props: StorefrontPageProps) {
  const { storefront } = props;
  const sections = useMemo(() => storefrontSections(storefront.blocks), [storefront.blocks]);
  const categories = sections.map((section) => section.category).filter((c): c is string => Boolean(c));
  const [filter, setFilter] = useState<string | null>(null);
  const shown = filter ? sections.filter((section) => section.category === filter) : sections;
  const initials = storefront.profile.name.trim().slice(0, 1).toUpperCase() || 'H';

  return (
    <main data-storefront style={{ '--sf-accent': storefront.look.accent, '--sf-ink': '#111312' } as CSSProperties}
      className="min-h-full bg-[radial-gradient(120%_60%_at_50%_0%,#2a2f2b_0%,#111312_55%)] px-4 pb-16 pt-10 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        {storefront.profile.photoUrl
          ? <img src={storefront.profile.photoUrl} alt="" className="size-24 rounded-full border-2 border-white/20 object-cover" />
          : <span className="flex size-24 items-center justify-center rounded-full bg-[var(--sf-accent)] text-3xl font-semibold" aria-hidden>{initials}</span>}
        <h1 className="mt-4 font-display text-3xl font-semibold">{storefront.profile.name}</h1>
        {storefront.profile.bio && <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/70">{storefront.profile.bio}</p>}
        {storefront.socials.length > 0 && (
          <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Social links">
            {storefront.socials.map((social) => (
              <li key={social.network}>
                <a href={props.preview ? undefined : social.url} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABEL[social.network]}
                  className="flex size-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
                  <SocialIcon network={social.network} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {categories.length >= 2 && (
        <div role="group" aria-label="Filter" className="mx-auto mt-6 flex w-full max-w-md flex-wrap justify-center gap-2">
          {[null, ...categories].map((category) => (
            <button key={category ?? 'all'} type="button" aria-pressed={filter === category} onClick={() => setFilter(category)}
              className="min-h-9 rounded-full border border-white/15 px-3 text-xs font-semibold text-white/80 aria-pressed:border-[var(--sf-accent)] aria-pressed:bg-[var(--sf-accent)] aria-pressed:text-[var(--sf-ink)]">
              {category ?? 'All'}
            </button>
          ))}
        </div>
      )}

      <div className="mx-auto mt-6 flex w-full max-w-md flex-col gap-6">
        {shown.map((section, index) => (
          <section key={`${section.category ?? 'top'}-${index}`} data-storefront-section={section.category ?? ''} className="flex flex-col gap-3">
            {section.category && <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">{section.category}</h2>}
            {section.blocks.map((block) => <Block key={block.id} block={block} props={props} />)}
          </section>
        ))}
        {sections.length === 0 && <p className="text-center text-sm text-white/50">Nothing here yet.</p>}
      </div>
      <p className="mt-12 text-center text-xs text-white/30">Made with Harvest</p>
    </main>
  );
}
