/**
 * The platforms a ministry may connect or post to.
 *
 * 🔴 AN ALLOW-LIST, NOT A DENY-LIST. X/Twitter is absent because it is not
 * offered, and so is every other network Zernio can name that is not in this
 * list (Discord, Slack, iMessage). A check that only rejected the strings
 * "twitter" and "x" would accept the next slug Zernio adds. Anything that is
 * not one of these thirteen is refused, on every connect, publish, schedule
 * and edit path, before a client is asked to do anything.
 *
 * Slugs are Zernio's own (`googlebusiness`, not "Google Business"). Comparison
 * is case-insensitive and trimmed; the stored value is always the slug below.
 */

export const SOCIAL_PLATFORMS = [
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'pinterest',
  'facebook',
  'threads',
  'bluesky',
  'snapchat',
  'googlebusiness',
  'reddit',
  'telegram',
  'whatsapp',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  facebook: 'Facebook',
  threads: 'Threads',
  bluesky: 'Bluesky',
  snapchat: 'Snapchat',
  googlebusiness: 'Google Business',
  reddit: 'Reddit',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

/**
 * Platforms whose publish payload Zernio documents an AI-disclosure flag for.
 *
 * Zernio's published field is `platformSpecificData.madeWithAi`. The platform
 * page that documents it is X, slug `twitter`. No offered platform is in this
 * list, so the composer does not render "Made with AI". Adding a slug here
 * does nothing unless that slug is also on `SOCIAL_PLATFORMS` — the allow-list
 * still wins, and X cannot be added by editing only this array.
 */
export const ZERNIO_AI_DISCLOSURE_SLUGS = ['twitter'] as const;

export type PlatformField =
  | { readonly key: string; readonly label: string; readonly kind: 'text' }
  | { readonly key: string; readonly label: string; readonly kind: 'boolean' }
  | {
      readonly key: string;
      readonly label: string;
      readonly kind: 'select';
      readonly options: readonly { readonly value: string; readonly label: string }[];
    };

/**
 * Fields Zernio documents on `platformSpecificData` for an offered platform.
 * A platform with an empty list gets the shared text and nothing else.
 */
export const PLATFORM_FIELDS: Record<SocialPlatform, readonly PlatformField[]> = {
  instagram: [
    { key: 'firstComment', label: 'First comment', kind: 'text' },
    {
      key: 'contentType',
      label: 'Placement',
      kind: 'select',
      options: [
        { value: 'feed', label: 'Feed' },
        { value: 'story', label: 'Story' },
        { value: 'reel', label: 'Reel' },
      ],
    },
  ],
  tiktok: [
    {
      key: 'privacyLevel',
      label: 'Who can view',
      kind: 'select',
      options: [
        { value: 'PUBLIC_TO_EVERYONE', label: 'Everyone' },
        { value: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
        { value: 'SELF_ONLY', label: 'Only me' },
      ],
    },
  ],
  youtube: [
    {
      key: 'visibility',
      label: 'Visibility',
      kind: 'select',
      options: [
        { value: 'public', label: 'Public' },
        { value: 'unlisted', label: 'Unlisted' },
        { value: 'private', label: 'Private' },
      ],
    },
  ],
  linkedin: [],
  pinterest: [{ key: 'title', label: 'Pin title', kind: 'text' }],
  facebook: [],
  threads: [],
  bluesky: [],
  snapchat: [],
  googlebusiness: [
    {
      key: 'topicType',
      label: 'Post type',
      kind: 'select',
      options: [
        { value: 'STANDARD', label: 'Update' },
        { value: 'EVENT', label: 'Event' },
        { value: 'OFFER', label: 'Offer' },
      ],
    },
  ],
  reddit: [{ key: 'subreddit', label: 'Subreddit', kind: 'text' }],
  telegram: [{ key: 'silent', label: 'Silent message', kind: 'boolean' }],
  whatsapp: [],
};

const ALLOWED = new Set<string>(SOCIAL_PLATFORMS);

export function parseSocialPlatform(raw: unknown): SocialPlatform | null {
  if (typeof raw !== 'string') return null;
  const slug = raw.trim().toLowerCase();
  return ALLOWED.has(slug) ? (slug as SocialPlatform) : null;
}

/** True only when Zernio documents the AI-disclosure flag for this platform. */
export function supportsMadeWithAi(platform: SocialPlatform): boolean {
  return (ZERNIO_AI_DISCLOSURE_SLUGS as readonly string[]).includes(platform);
}

export function platformsSupportingMadeWithAi(
  selected: readonly SocialPlatform[],
): SocialPlatform[] {
  return selected.filter(supportsMadeWithAi);
}
