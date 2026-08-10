/**
 * The canonical policy documents live on theharvest.site. The app links to
 * them; it does not restate them.
 *
 * ⚠️ WHY THIS FILE EXISTS. The app used to ship its OWN Privacy Policy and
 * Terms of Use (PrivacyTermsModal), a year out of date, contradicting the
 * published site on three points: what happens to AI conversations; a named
 * third-party ministry the policy said member data was shared with, which the
 * founder has confirmed Harvest has no relationship with (so it was a false
 * disclosure to data subjects); and a refund policy that did not exist at all.
 *
 * Two policy documents that disagree is worse than one that is out of date:
 * whichever a customer relies on, the other contradicts it. So there is one
 * source, it is the site, and every in-app surface points at these constants.
 * If you are about to write policy prose into a component — don't. Add a link
 * here instead.
 */

export type LegalLinkKey = 'privacy' | 'terms' | 'refunds';

export interface LegalLink {
  key: LegalLinkKey;
  label: string;
  /** One line of context under the label, so the row is not a bare URL. */
  description: string;
  href: string;
  /**
   * Refunds is admin-only: a member never pays Harvest anything, so the policy
   * is meaningless to them. Gated with the SAME condition as the Admin
   * Dashboard entry on the Profile screen, passed down as a prop — not a
   * second admin check of its own.
   *
   * 🔴 Privacy and Terms are `false` and must stay `false`. Members are the
   * data subjects: Harvest holds their name, email, attendance, giving
   * history, AI conversations and in some cases their children's check-in
   * details. Hiding how that data is processed from the person it belongs to
   * is the wrong side of GDPR and the first thing a reviewer looks for.
   */
  adminOnly: boolean;
}

export const LEGAL_LINKS: readonly LegalLink[] = [
  {
    key: 'privacy',
    label: 'Privacy Policy',
    description: 'What we collect, why, and how long we keep it.',
    href: 'https://theharvest.site/privacy',
    adminOnly: false,
  },
  {
    key: 'terms',
    label: 'Terms of Service',
    description: 'The agreement you accept by using Harvest.',
    href: 'https://theharvest.site/terms',
    adminOnly: false,
  },
  {
    key: 'refunds',
    label: 'Refund & Cancellation',
    description: 'How billing, cancellation and refunds work.',
    href: 'https://theharvest.site/refunds',
    adminOnly: true,
  },
] as const;

/** The links a given viewer may see. Members get everything not `adminOnly`. */
export function visibleLegalLinks(isAdmin: boolean): readonly LegalLink[] {
  return LEGAL_LINKS.filter((l) => !l.adminOnly || isAdmin);
}

/** Direct handles for the surfaces that need one link rather than the list. */
export const PRIVACY_URL = LEGAL_LINKS[0].href;
export const TERMS_URL = LEGAL_LINKS[1].href;
