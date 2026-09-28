/**
 * Which of a ministry's saved payment links a campaign (or an event) offers.
 *
 * The document stores provider ids, never URLs. Every read intersects that
 * list with the links `readGivingLinks` just re-validated, so a selection can
 * only narrow what the ministry currently publishes. An empty selection, an
 * absent field, and a selection whose providers were all removed mean every
 * current link: a campaign saved before this field existed must not lose the
 * only way a donor can give.
 *
 * `readEventProviderIds` and `resolveEventPaymentLinks` in
 * `event-payment-claims.ts` keep the same rules. That file is digest-pinned,
 * so the functions there stay the original implementation and these are the
 * generic copy. The two must not drift; the selection tests compare them.
 */
import {
  GIVING_PROVIDERS,
  GIVING_PROVIDER_NAMES_OR,
  isGivingProviderId,
  type GivingProviderId,
  type PublishedGivingLink,
} from '@/components/donations/giving-providers';

/**
 * Provider ids from a stored array, in table order, with anything this build
 * does not define dropped. A non-array (missing field, a string, a map) is
 * "nothing chosen".
 */
export function readSelectedProviderIds(raw: unknown): GivingProviderId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter(isGivingProviderId));
  return GIVING_PROVIDERS.filter((p) => set.has(p.id)).map((p) => p.id);
}

/**
 * The published links a selection leaves standing.
 *
 * Empty means all. A non-empty selection that matches nothing also means all,
 * because a stale id must not leave a donor with a price and nowhere to pay.
 */
export function resolveSelectedPaymentLinks(
  published: readonly PublishedGivingLink[],
  selectedIds: unknown,
): PublishedGivingLink[] {
  const wanted = readSelectedProviderIds(selectedIds);
  if (wanted.length === 0) return [...published];
  const narrowed = published.filter((l) => wanted.includes(l.provider.id));
  return narrowed.length > 0 ? narrowed : [...published];
}

export interface ResolvedCampaignGiving {
  links: PublishedGivingLink[];
  /**
   * The single link Donate opens, or null. Set only when `narrowed` is true,
   * exactly one link survived, and that link has a URL. A Zelle row (no URL)
   * is shown, never redirected to.
   */
  direct: (PublishedGivingLink & { url: string }) | null;
  /** True only when a non-empty selection matched at least one published link. */
  narrowed: boolean;
}

/**
 * What a campaign page should offer. "None chosen" and "the chosen providers
 * are no longer published" both return every current link and no direct
 * target. One surviving link with a URL is the direct Donate target.
 */
export function resolveCampaignGiving(
  published: readonly PublishedGivingLink[],
  selectedIds: unknown,
): ResolvedCampaignGiving {
  const wanted = readSelectedProviderIds(selectedIds);
  if (wanted.length === 0) {
    return { links: [...published], direct: null, narrowed: false };
  }
  const matched = published.filter((l) => wanted.includes(l.provider.id));
  if (matched.length === 0) {
    return { links: [...published], direct: null, narrowed: false };
  }
  const only = matched.length === 1 ? matched[0] : null;
  const direct = only?.url ? { ...only, url: only.url } : null;
  return { links: matched, direct, narrowed: true };
}

/** Heading over the campaign editor's checkbox group. */
export const CAMPAIGN_PICKER_TITLE = 'Where Donate sends people';

/** The sentence under that heading. */
export const CAMPAIGN_PICKER_HELP =
  'Tick one link and the Donate button opens it directly. Tick several and donors choose between them. Leave all unticked to show every link you saved.';

/**
 * Shown in the campaign editor when the ministry has saved no payment links.
 * Names every provider from the table, so a new row does not leave this
 * sentence describing a shorter list than the product ships.
 */
export const CAMPAIGN_NO_PAYMENT_LINKS =
  'You have no payment links saved yet. Add a '
  + GIVING_PROVIDER_NAMES_OR
  + ' link under Ministry > Donations and choose it here.';
