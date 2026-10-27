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
  rules: { enabled: boolean; items: string[]; version: number };
  questions: { enabled: boolean; items: CommunityQuestion[] };
};

export function defaultCommunitySettings(): CommunitySettings {
  return {
    modules: Object.fromEntries(COMMUNITY_MODULES.map(key => [key, true])) as Record<CommunityModule, boolean>,
    isPublic: false,
    shortDescription: '',
    logoUrl: '',
    rules: { enabled: false, items: [], version: 0 },
    questions: { enabled: false, items: [] },
  };
}

/** A missing document preserves existing visibility. Malformed saved data must be surfaced. */
export function readCommunitySettings(value: unknown): CommunitySettings {
  if (value === undefined) return defaultCommunitySettings();
  if (!value || typeof value !== 'object') throw new Error('Invalid community settings');
  const raw = value as Partial<CommunitySettings>;
  const data = { ...raw, shortDescription: raw.shortDescription === undefined ? '' : raw.shortDescription, logoUrl: raw.logoUrl === undefined ? '' : raw.logoUrl } as CommunitySettings;
  if (!data.modules || COMMUNITY_MODULES.some(key => typeof data.modules[key] !== 'boolean') ||
      typeof data.shortDescription !== 'string' || typeof data.logoUrl !== 'string' ||
      typeof data.isPublic !== 'boolean' || !data.rules || typeof data.rules.enabled !== 'boolean' ||
      !Array.isArray(data.rules.items) || data.rules.items.some(item => typeof item !== 'string') ||
      !Number.isSafeInteger(data.rules.version) || data.rules.version < 0 || !data.questions ||
      typeof data.questions.enabled !== 'boolean' || !Array.isArray(data.questions.items) ||
      data.questions.items.some(q => !q || typeof q.id !== 'string' || !q.id ||
        (q.type !== 'short' && q.type !== 'choice') || typeof q.label !== 'string' ||
        typeof q.required !== 'boolean' || !Array.isArray(q.options) || q.options.some(o => typeof o !== 'string')) ||
      new Set(data.questions.items.map(q => q.id)).size !== data.questions.items.length) {
    throw new Error('Invalid community settings');
  }
  return data;
}

export function prepareCommunitySettings(previous: CommunitySettings, draft: CommunitySettings): CommunitySettings {
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
    (settings.questions.enabled && (!member?.answeredAt || member.answers?.__community_questions_pending__ === 'true'));
}

export function requiredQuestionsAnswered(questions: CommunityQuestion[], answers: Record<string, string>): boolean {
  return questions.every(q => !q.required || (Boolean(answers[q.id]?.trim()) &&
    (q.type !== 'choice' || q.options.includes(answers[q.id]))));
}

/** Compare settings by value, independent of Firestore map key order. */
export function communitySettingsFingerprint(settings: CommunitySettings): string {
  return JSON.stringify([COMMUNITY_MODULES.map(key => settings.modules[key]), settings.isPublic,
    settings.shortDescription, settings.logoUrl, settings.rules.enabled, settings.rules.items, settings.rules.version,
    settings.questions.enabled, settings.questions.items.map(q => [q.id, q.type, q.label, q.options, q.required])]);
}
