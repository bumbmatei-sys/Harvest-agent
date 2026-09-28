"use client";
import React from 'react';
import { Heart } from 'lucide-react';
import GivingLinks from './GivingLinks';
import type { PublishedGivingLink } from './giving-providers';

/**
 * The links under a campaign, on the public page and in the member detail.
 *
 * One renderer so the two surfaces cannot disagree about a direct Donate
 * button or about which heading sits over the rows. The card form, when it
 * is drawn, stays in the caller and sits above this.
 */
const CampaignGivingOptions: React.FC<{
  links: readonly PublishedGivingLink[];
  directLink?: PublishedGivingLink | null;
  narrowed?: boolean;
  /** True when the card form is rendered above these options. */
  showCardForm: boolean;
  /** Background of the direct Donate button. The caller owns the colour. */
  brandColor: string;
}> = ({ links, directLink = null, narrowed = false, showCardForm, brandColor }) => {
  const directHref = directLink?.url ?? null;
  const heading = directHref
    ? 'Payment details'
    : showCardForm
      ? 'Other ways to give'
      : narrowed
        ? 'Choose how to give'
        : 'Ways to give';

  return (
    <>
      {directHref && directLink && (
        <a
          href={directHref}
          target="_blank"
          rel="noopener noreferrer nofollow"
          data-testid="campaign-direct-donate"
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold transition-opacity hover:opacity-90 ${showCardForm ? 'mt-4' : ''}`}
          style={{ backgroundColor: brandColor }}
        >
          <Heart size={15} strokeWidth={2.5} />
          Donate with {directLink.provider.label}
        </a>
      )}
      <GivingLinks links={links} heading={heading} />
    </>
  );
};

export default CampaignGivingOptions;
