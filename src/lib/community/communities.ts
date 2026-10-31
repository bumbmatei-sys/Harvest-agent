import type { CommunitySettings } from './settings';

/**
 * A ministry can run several communities. The default one is the ministry's
 * existing community: its content and setup still live in
 * `tenants/{t}/settings/community`, and its record here only marks whether it
 * was deleted. Every other community is a record in
 * `tenants/{t}/communities/{id}`, read and written only by the server.
 */
export const DEFAULT_COMMUNITY_ID = 'default';

export type CommunityVisibility = 'public' | 'private';
export type CommunityPriceInterval = 'month' | 'year' | 'once';
export type CommunityPricing =
  | { type: 'free' }
  | { type: 'paid'; amountCents: number; currency: string; interval: CommunityPriceInterval };
export type CommunityJoining = { mode: 'open' | 'apply' };
export type CommunityStatus = 'draft' | 'published';

export type CommunityRecord = {
  id: string;
  name: string;
  tagline: string;
  iconUrl: string;
  about: string;
  visibility: CommunityVisibility;
  pricing: CommunityPricing;
  joining: CommunityJoining;
  status: CommunityStatus;
  isDefault: boolean;
};

/** The fields an admin edits. Status and identity are the server's. */
export type CommunityEdit = Pick<CommunityRecord, 'name' | 'tagline' | 'iconUrl' | 'about' | 'visibility' | 'pricing' | 'joining'>;

/**
 * Paid communities wait for the business entity that can take payments (Matei's
 * LLC). Until then the editor shows Paid as coming soon and the server refuses it.
 */
export const PAID_COMMUNITIES_ENABLED = false;
export const PAID_COMING_SOON_MESSAGE = 'Paid communities are coming soon. Keep this community free for now.';

/** Shown until each community has its own members, feed and chat. */
export const PUBLISH_LATER_MESSAGE = 'Publishing a second community opens once each community has its own feed and chat. Your setup is saved as a draft.';

export const COMMUNITY_LIMITS = { name: 80, tagline: 160, about: 10000, url: 2048 } as const;
const CURRENCIES = ['usd', 'eur', 'gbp', 'ron', 'cad', 'aud'] as const;
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isCommunityId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function newCommunityDraft(name: string): CommunityEdit {
  return { name: name.trim(), tagline: '', iconUrl: '', about: '', visibility: 'private', pricing: { type: 'free' }, joining: { mode: 'open' } };
}

function readPricing(value: unknown): CommunityPricing {
  if (!value || typeof value !== 'object') throw new Error('Invalid community pricing');
  const raw = value as Record<string, unknown>;
  if (raw.type === 'free') return { type: 'free' };
  if (raw.type !== 'paid') throw new Error('Invalid community pricing');
  const { amountCents, currency, interval } = raw;
  if (!Number.isSafeInteger(amountCents) || (amountCents as number) < 100 || (amountCents as number) > 10_000_000 ||
      typeof currency !== 'string' || !(CURRENCIES as readonly string[]).includes(currency) ||
      (interval !== 'month' && interval !== 'year' && interval !== 'once')) {
    throw new Error('Invalid community pricing');
  }
  return { type: 'paid', amountCents: amountCents as number, currency, interval };
}

/** Validate an admin's edit. Throws a message fit to show the admin. */
export function readCommunityEdit(value: unknown): CommunityEdit {
  if (!value || typeof value !== 'object') throw new Error('Invalid community.');
  const raw = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const v = raw[key] === undefined ? '' : raw[key];
    if (typeof v !== 'string' || v.length > max) throw new Error('Invalid community.');
    return v.trim();
  };
  const name = text('name', COMMUNITY_LIMITS.name);
  if (!name) throw new Error('Give the community a name.');
  const iconUrl = text('iconUrl', COMMUNITY_LIMITS.url);
  if (iconUrl) {
    let url: URL;
    try { url = new URL(iconUrl); } catch { throw new Error('Enter a valid HTTPS icon URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter a valid HTTPS icon URL.');
  }
  if (raw.visibility !== 'public' && raw.visibility !== 'private') throw new Error('Invalid community.');
  const joining = raw.joining as Record<string, unknown> | undefined;
  if (!joining || (joining.mode !== 'open' && joining.mode !== 'apply')) throw new Error('Invalid community.');
  let pricing: CommunityPricing;
  try { pricing = readPricing(raw.pricing); } catch { throw new Error('Enter a price of at least 1.00 in a supported currency.'); }
  return {
    name, tagline: text('tagline', COMMUNITY_LIMITS.tagline), iconUrl, about: text('about', COMMUNITY_LIMITS.about),
    visibility: raw.visibility, pricing, joining: { mode: joining.mode },
  };
}

/** A stored record, as the server reads it back. */
export function readCommunityRecord(id: string, data: Record<string, unknown>): CommunityRecord {
  if (!isCommunityId(id) || id === DEFAULT_COMMUNITY_ID) throw new Error('Invalid community record');
  const edit = readCommunityEdit(data);
  if (data.status !== 'draft' && data.status !== 'published') throw new Error('Invalid community record');
  return { id, ...edit, status: data.status, isDefault: false };
}

/** The default community, drawn from the ministry's existing community setup. */
export function defaultCommunityRecord(tenantName: string, settings: CommunitySettings): CommunityRecord {
  return {
    id: DEFAULT_COMMUNITY_ID,
    name: tenantName.trim() || 'Community',
    tagline: settings.shortDescription,
    iconUrl: settings.logoUrl,
    about: settings.longDescription,
    visibility: settings.isPublic ? 'public' : 'private',
    pricing: { type: 'free' },
    joining: { mode: settings.questions.enabled ? 'apply' : 'open' },
    status: 'published',
    isDefault: true,
  };
}

/** A URL-safe id from the name, made unique against the ids already taken. */
export function communityIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'community';
  const root = base === DEFAULT_COMMUNITY_ID ? `${base}-community` : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
}

export function formatCommunityPrice(pricing: CommunityPricing): string {
  if (pricing.type === 'free') return 'Free';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: pricing.currency.toUpperCase() }).format(pricing.amountCents / 100);
  return pricing.interval === 'once' ? amount : `${amount} / ${pricing.interval}`;
}
