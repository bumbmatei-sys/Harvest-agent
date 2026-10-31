import { COMMUNITY_QUESTIONS_PENDING, LEGACY_QUESTIONS_PENDING } from '../community-membership';
import { DEFAULT_COMMUNITY_BRAND, isCommunityBrandColor } from './branding';
/** Tenant-controlled visibility is additional to, never a replacement for, plan access. */
export const COMMUNITY_MODULES = [
  'news', 'blog', 'courses', 'events', 'messages', 'prayer', 'give', 'livestream', 'bible', 'map',
] as const;
export type CommunityModule = typeof COMMUNITY_MODULES[number];
export type CommunityQuestion = {
  id: string;
  type: 'short' | 'choice';
  label: string;
  options: string[];
  required: boolean;
};
export type CommunitySettings = {
  modules: Record<CommunityModule, boolean>;
  isPublic: boolean;
  shortDescription: string;
  logoUrl: string;
  brandColor: string;
  coverUrl: string;
  galleryUrls: string[];
  longDescription: string;
  ownerName: string;
  rules: { enabled: boolean; items: string[]; version: number };
  questions: { enabled: boolean; items: CommunityQuestion[] };
  /** Set only by the server when an admin deletes the default community. */
  closed?: boolean;
};

export function defaultCommunitySettings(): CommunitySettings {
  return {
    modules: Object.fromEntries(COMMUNITY_MODULES.map(key => [key, true])) as Record<CommunityModule, boolean>,
    isPublic: false,
    shortDescription: '',
    logoUrl: '', brandColor: DEFAULT_COMMUNITY_BRAND,
    coverUrl: '', galleryUrls: [], longDescription: '', ownerName: '',
    rules: { enabled: false, items: [], version: 0 },
    questions: { enabled: false, items: [] },
  };
}

/** A missing document preserves existing visibility. Malformed saved data must be surfaced. */
export function readCommunitySettings(value: unknown): CommunitySettings {
  if (value === undefined) return defaultCommunitySettings();
  if (!value || typeof value !== 'object') throw new Error('Invalid community settings');
  const raw = value as Partial<CommunitySettings>;
  const data = { ...raw, brandColor: raw.brandColor === undefined ? DEFAULT_COMMUNITY_BRAND : raw.brandColor, shortDescription: raw.shortDescription === undefined ? '' : raw.shortDescription, logoUrl: raw.logoUrl === undefined ? '' : raw.logoUrl, coverUrl: raw.coverUrl === undefined ? '' : raw.coverUrl, galleryUrls: raw.galleryUrls === undefined ? [] : raw.galleryUrls, longDescription: raw.longDescription === undefined ? '' : raw.longDescription, ownerName: raw.ownerName === undefined ? '' : raw.ownerName } as CommunitySettings;
  if (!data.modules || COMMUNITY_MODULES.some(key => typeof data.modules[key] !== 'boolean') ||
      !isCommunityBrandColor(data.brandColor) || typeof data.shortDescription !== 'string' || data.shortDescription.length > 240 || typeof data.logoUrl !== 'string' || data.logoUrl.length > 2048 ||
      typeof data.coverUrl !== 'string' || data.coverUrl.length > 2048 || !Array.isArray(data.galleryUrls) || data.galleryUrls.length > 8 || data.galleryUrls.some(url => typeof url !== 'string' || !url || url.length > 2048) ||
      typeof data.longDescription !== 'string' || data.longDescription.length > 10000 || typeof data.ownerName !== 'string' || data.ownerName.length > 120 ||
      typeof data.isPublic !== 'boolean' || !data.rules || typeof data.rules.enabled !== 'boolean' ||
      !Array.isArray(data.rules.items) || data.rules.items.some(item => typeof item !== 'string') ||
      !Number.isSafeInteger(data.rules.version) || data.rules.version < 0 || !data.questions ||
      typeof data.questions.enabled !== 'boolean' || !Array.isArray(data.questions.items) ||
      data.questions.items.some(q => !q || typeof q.id !== 'string' || !q.id ||
        (q.type !== 'short' && q.type !== 'choice') || typeof q.label !== 'string' ||
        typeof q.required !== 'boolean' || !Array.isArray(q.options) || q.options.some(o => typeof o !== 'string')) ||
      new Set(data.questions.items.map(q => q.id)).size !== data.questions.items.length ||
      (data.closed !== undefined && typeof data.closed !== 'boolean')) {
    throw new Error('Invalid community settings');
  }
  return data;
}

export function prepareCommunitySettings(previous: CommunitySettings, draft: CommunitySettings): CommunitySettings {
  if (!isCommunityBrandColor(draft.brandColor)) throw new Error('Enter a valid hex colour in the form #RRGGBB.');
  if (draft.rules.enabled && (!draft.rules.items.length || draft.rules.items.some(item => !item.trim()))) {
    throw new Error('Add text for each community rule.');
  }
  if (draft.questions.enabled && draft.questions.items.some(q => !q.label.trim() ||
      (q.type === 'choice' && (q.options.length < 2 || q.options.some(option => !option.trim()))))) {
    throw new Error('Add a question and at least two choices for each multiple choice question.');
  }
  const rulesChanged = previous.rules.enabled !== draft.rules.enabled ||
    JSON.stringify(previous.rules.items) !== JSON.stringify(draft.rules.items);
  return { ...draft, rules: { ...draft.rules, version: previous.rules.version + (rulesChanged ? 1 : 0) } };
}

export function needsCommunityEntry(settings: CommunitySettings, member: { rulesAcceptedVersion?: number; answeredAt?: unknown; answers?: Record<string, string> } | null): boolean {
  return (settings.rules.enabled && member?.rulesAcceptedVersion !== settings.rules.version) ||
    (settings.questions.enabled && (!member?.answeredAt || member.answers?.[COMMUNITY_QUESTIONS_PENDING] === 'true' || member.answers?.[LEGACY_QUESTIONS_PENDING] === 'true'));
}

export function requiredQuestionsAnswered(questions: CommunityQuestion[], answers: Record<string, string>): boolean {
  return questions.every(q => !q.required || (Boolean(answers[q.id]?.trim()) &&
    (q.type !== 'choice' || q.options.includes(answers[q.id]))));
}

/** Compare settings by value, independent of Firestore map key order. */
export function communitySettingsFingerprint(settings: CommunitySettings): string {
  return JSON.stringify([COMMUNITY_MODULES.map(key => settings.modules[key]), settings.isPublic,
    settings.shortDescription, settings.logoUrl, settings.brandColor, settings.coverUrl, settings.galleryUrls, settings.longDescription, settings.ownerName, settings.rules.enabled, settings.rules.items, settings.rules.version,
    settings.questions.enabled, settings.questions.items.map(q => [q.id, q.type, q.label, q.options, q.required])]);
}
