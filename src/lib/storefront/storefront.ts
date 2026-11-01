/**
 * Storefront: the ministry's one link for a bio (Eden's Storefront,
 * docs/prd/screenshots/11-link-in-bio). A profile, social links, a look and an
 * ordered list of blocks. One template for now; more designs come later, so the
 * look is a template id plus an accent rather than free CSS.
 *
 * The document lives at storefronts/{tenantId} and is written and read only
 * through the Admin SDK (the admin route and the public page), so it needs no
 * Firestore rule. Everything here is a pure reader: anything it cannot read is
 * dropped, so a hand-edited document shows less rather than breaking the page.
 */

export const STOREFRONT_BLOCK_TYPES = [
  'category', 'link', 'text', 'video', 'emailCapture', 'give', 'events', 'blog',
  'community', 'course', 'form', 'testimonials', 'bookCall',
] as const;
export type StorefrontBlockType = typeof STOREFRONT_BLOCK_TYPES[number];

export const STOREFRONT_BLOCK_INFO: Record<StorefrontBlockType, { label: string; description: string }> = {
  category: { label: 'Category', description: 'Groups the blocks below it. Two or more add filter chips on top.' },
  link: { label: 'Link', description: 'Any URL, with an optional subtitle.' },
  text: { label: 'Text', description: 'A heading and a paragraph.' },
  video: { label: 'Video', description: 'YouTube, Vimeo or Loom.' },
  emailCapture: { label: 'Email capture', description: 'Signups land in your People and newsletter list.' },
  give: { label: 'Give', description: 'Your giving page, with your giving links.' },
  events: { label: 'Events', description: 'Your next upcoming events.' },
  blog: { label: 'Blog', description: 'Your three latest articles, with a View all page.' },
  community: { label: 'Community', description: 'One of your communities, to join.' },
  course: { label: 'Course', description: 'One of your courses.' },
  form: { label: 'Form', description: 'One of your forms.' },
  testimonials: { label: 'Testimonials', description: 'A few words from people you serve.' },
  bookCall: { label: 'Book a call', description: 'A link to book time with you.' },
};

export const STOREFRONT_SOCIALS = ['instagram', 'facebook', 'youtube', 'tiktok', 'x', 'threads', 'spotify', 'website'] as const;
export type StorefrontSocial = typeof STOREFRONT_SOCIALS[number];

export const STOREFRONT_ACCENTS = ['#C9963A', '#1F2A44', '#58755A', '#875C70', '#A55E47', '#386C70'] as const;

export const STOREFRONT_LIMITS = { blocks: 40, title: 80, subtitle: 160, body: 1000, bio: 200, name: 80, testimonials: 6, quote: 300, url: 2048 } as const;

interface BlockBase { readonly id: string; readonly enabled: boolean }
export type StorefrontBlock =
  | BlockBase & { readonly type: 'category'; readonly title: string }
  | BlockBase & { readonly type: 'link'; readonly title: string; readonly subtitle: string; readonly url: string }
  | BlockBase & { readonly type: 'text'; readonly title: string; readonly body: string }
  | BlockBase & { readonly type: 'video'; readonly title: string; readonly url: string }
  | BlockBase & { readonly type: 'emailCapture'; readonly title: string; readonly subtitle: string }
  | BlockBase & { readonly type: 'give'; readonly title: string; readonly subtitle: string }
  | BlockBase & { readonly type: 'events'; readonly title: string; readonly count: number }
  | BlockBase & { readonly type: 'blog'; readonly title: string }
  | BlockBase & { readonly type: 'community' | 'course' | 'form'; readonly title: string; readonly subtitle: string; readonly targetId: string }
  | BlockBase & { readonly type: 'testimonials'; readonly title: string; readonly items: readonly { readonly quote: string; readonly name: string }[] }
  | BlockBase & { readonly type: 'bookCall'; readonly title: string; readonly subtitle: string; readonly url: string };

export interface Storefront {
  readonly profile: { readonly name: string; readonly bio: string; readonly photoUrl: string };
  readonly socials: readonly { readonly network: StorefrontSocial; readonly url: string }[];
  readonly look: { readonly template: 'classic'; readonly accent: string };
  readonly blocks: readonly StorefrontBlock[];
  readonly published: boolean;
}

export function emptyStorefront(name = ''): Storefront {
  return {
    profile: { name, bio: '', photoUrl: '' },
    socials: [],
    look: { template: 'classic', accent: STOREFRONT_ACCENTS[0] },
    blocks: [],
    published: false,
  };
}

/** A fresh block of a type, with the copy Eden starts from. */
export function newStorefrontBlock(type: StorefrontBlockType, id: string): StorefrontBlock {
  const base = { id, enabled: true };
  switch (type) {
    case 'category': return { ...base, type, title: 'New section' };
    case 'link': return { ...base, type, title: '', subtitle: '', url: '' };
    case 'text': return { ...base, type, title: '', body: '' };
    case 'video': return { ...base, type, title: '', url: '' };
    case 'emailCapture': return { ...base, type, title: 'Stay in the loop', subtitle: 'Only the essentials. No spam.' };
    case 'give': return { ...base, type, title: 'Give', subtitle: 'Support the ministry.' };
    case 'events': return { ...base, type, title: 'Upcoming events', count: 3 };
    case 'blog': return { ...base, type, title: 'From the blog' };
    case 'community': case 'course': case 'form': return { ...base, type, title: '', subtitle: '', targetId: '' };
    case 'testimonials': return { ...base, type, title: 'What people say', items: [] };
    case 'bookCall': return { ...base, type, title: 'Book a call', subtitle: '', url: '' };
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** An https URL, or empty. Anything else (javascript:, data:, relative) is dropped. */
export function safeUrl(value: unknown): string {
  const raw = text(value, STOREFRONT_LIMITS.url);
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function readBlock(value: unknown): StorefrontBlock | null {
  const row = asRecord(value);
  const id = typeof row.id === 'string' && ID.test(row.id) ? row.id : null;
  const type = (STOREFRONT_BLOCK_TYPES as readonly unknown[]).includes(row.type) ? (row.type as StorefrontBlockType) : null;
  if (!id || !type) return null;
  const enabled = row.enabled !== false;
  const title = text(row.title, STOREFRONT_LIMITS.title);
  const subtitle = text(row.subtitle, STOREFRONT_LIMITS.subtitle);
  const base = { id, enabled };
  switch (type) {
    case 'category': return { ...base, type, title };
    case 'link': return { ...base, type, title, subtitle, url: safeUrl(row.url) };
    case 'text': return { ...base, type, title, body: text(row.body, STOREFRONT_LIMITS.body) };
    case 'video': return { ...base, type, title, url: safeUrl(row.url) };
    case 'emailCapture': return { ...base, type, title, subtitle };
    case 'give': return { ...base, type, title, subtitle };
    case 'events': {
      const count = typeof row.count === 'number' && Number.isInteger(row.count) ? Math.min(6, Math.max(1, row.count)) : 3;
      return { ...base, type, title, count };
    }
    case 'blog': return { ...base, type, title };
    case 'community': case 'course': case 'form': {
      const targetId = typeof row.targetId === 'string' && ID.test(row.targetId) ? row.targetId : '';
      return { ...base, type, title, subtitle, targetId };
    }
    case 'testimonials': {
      const items = (Array.isArray(row.items) ? row.items : []).map((item) => {
        const entry = asRecord(item);
        return { quote: text(entry.quote, STOREFRONT_LIMITS.quote), name: text(entry.name, STOREFRONT_LIMITS.name) };
      }).filter((item) => item.quote).slice(0, STOREFRONT_LIMITS.testimonials);
      return { ...base, type, title, items };
    }
    case 'bookCall': return { ...base, type, title, subtitle, url: safeUrl(row.url) };
  }
}

/** Reads a stored or submitted storefront. Never throws; drops what it cannot read. */
export function readStorefront(value: unknown, fallbackName = ''): Storefront {
  const row = asRecord(value);
  const profile = asRecord(row.profile);
  const look = asRecord(row.look);
  const seen = new Set<string>();
  const blocks: StorefrontBlock[] = [];
  for (const raw of Array.isArray(row.blocks) ? row.blocks : []) {
    const block = readBlock(raw);
    if (!block || seen.has(block.id)) continue;
    seen.add(block.id);
    blocks.push(block);
    if (blocks.length >= STOREFRONT_LIMITS.blocks) break;
  }
  const socials: Storefront['socials'][number][] = [];
  for (const raw of Array.isArray(row.socials) ? row.socials : []) {
    const entry = asRecord(raw);
    const network = (STOREFRONT_SOCIALS as readonly unknown[]).includes(entry.network) ? (entry.network as StorefrontSocial) : null;
    const url = safeUrl(entry.url);
    if (network && url && !socials.some((s) => s.network === network)) socials.push({ network, url });
  }
  return {
    profile: {
      name: text(profile.name, STOREFRONT_LIMITS.name) || fallbackName,
      bio: text(profile.bio, STOREFRONT_LIMITS.bio),
      photoUrl: safeUrl(profile.photoUrl).startsWith('https://') ? safeUrl(profile.photoUrl) : '',
    },
    socials,
    look: { template: 'classic', accent: typeof look.accent === 'string' && HEX.test(look.accent) ? look.accent : STOREFRONT_ACCENTS[0] },
    blocks,
    published: row.published === true,
  };
}

/** What a block needs before it can show: a link needs its URL, a picker block its item. */
export function blockIsComplete(block: StorefrontBlock): boolean {
  switch (block.type) {
    case 'link': case 'video': case 'bookCall': return Boolean(block.url);
    case 'community': case 'course': case 'form': return Boolean(block.targetId);
    case 'testimonials': return block.items.length > 0;
    case 'text': return Boolean(block.title || block.body);
    default: return true;
  }
}

/** The visible blocks, in order, grouped under their categories (blocks before the first category have none). */
export function storefrontSections(blocks: readonly StorefrontBlock[]): { category: string | null; blocks: StorefrontBlock[] }[] {
  const sections: { category: string | null; blocks: StorefrontBlock[] }[] = [{ category: null, blocks: [] }];
  for (const block of blocks) {
    if (!block.enabled || !blockIsComplete(block)) continue;
    if (block.type === 'category') sections.push({ category: block.title || 'More', blocks: [] });
    else sections[sections.length - 1].blocks.push(block);
  }
  return sections.filter((section) => section.blocks.length > 0);
}

/** The embeddable player URL for a YouTube, Vimeo or Loom link, or null. */
export function videoEmbedUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(parsed.pathname.slice(1))}`;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.searchParams.get('v') ?? (parsed.pathname.startsWith('/shorts/') ? parsed.pathname.split('/')[2] : null);
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (host === 'loom.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[0] === 'share' && parts[1] ? `https://www.loom.com/embed/${encodeURIComponent(parts[1])}` : null;
  }
  return null;
}
