"use client";
import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { GivingProvider, PublishedGivingLink } from './giving-providers';

/**
 * THE-246 — the church's own payment links, as a member sees them.
 *
 * The founder: "In the user app people can see the PayPal logo, the title, and
 * their username and when they press on it the link will be opened." So each
 * row is a mark, the provider's name, and the church's handle — and the whole
 * row is the tap target.
 *
 * ─── 🔴 The mark is a MONOGRAM, and that is a reported constraint ────────────
 *
 * The founder asked for the PayPal logo. This repo has no licensed brand-mark
 * asset and no dependency carrying one: `lucide-react` (its only icon package)
 * ships no brand marks, and there is no `simple-icons` / `react-icons`. The one
 * hand-drawn third-party mark in the codebase is the Google "G" on the sign-in
 * button in AuthPage — a mark Google publishes precisely for that button.
 *
 * Scraping PayPal's, Block's, Venmo's or Early Warning's artwork into this repo
 * would be shipping someone else's trademark with no licence, on a money
 * surface, under a church's name. So this draws a tile in the app's own type
 * instead: one letter, on an accent in the provider's familiar hue. The
 * provider's NAME is right beside it in text, which is what actually identifies
 * the row — and naming a service to say you accept it is exactly what nominative
 * use is for.
 *
 * When a licensed asset set is chosen, it lands as one field on the provider
 * table and this component reads it; no gate, no caller and no test moves.
 */

/**
 * The tile. A single letter from the provider table, never artwork.
 *
 * `tint` / `ink` are the only hardcoded colours in this feature and they come
 * from the table as DATA — they identify a third party, so they cannot be a
 * palette token, and each pair was picked to keep the letter legible on the
 * fill in Harvest and Classic, light and dark alike (the tile carries its own
 * ground, so it does not change with the theme at all).
 */
export const ProviderMark: React.FC<{ provider: GivingProvider; size?: number }> = ({
  provider,
  size = 44,
}) => (
  <span
    aria-hidden="true"
    className="inline-flex items-center justify-center rounded-brand font-display font-semibold shrink-0"
    style={{
      width: size,
      height: size,
      backgroundColor: provider.tint,
      color: provider.ink,
      fontSize: Math.round(size * 0.45),
      lineHeight: 1,
    }}
  >
    {provider.monogram}
  </span>
);

/** One row's inner content — identical whether or not the row is a link. */
const LinkBody: React.FC<{ link: PublishedGivingLink }> = ({ link }) => (
  <>
    <ProviderMark provider={link.provider} />
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-semibold text-strong">{link.provider.label}</span>
      {link.handle && (
        <span className="block text-sm text-muted truncate">{link.handle}</span>
      )}
      {/*
        ⚠️ THE EMAIL IS RENDERED, NOT HIDDEN BEHIND A TAP.

        It is scrapable either way. `tenants/{id}` is world-readable by rule
        (`allow read: if true` — that is what resolves a subdomain before
        sign-in), so this address is already served to anyone who asks for the
        document, and drawing it only on tap would hide it from the member who
        needs it while hiding it from nobody else. The admin copy states that it
        will be public before a church types it; see AdminDonations.

        Not a `mailto:` anchor: the row's tap target is the payment link, and a
        second one inside it would send a member to their mail client when they
        meant to give.
      */}
      {link.email && (
        <span className="block text-xs text-faint truncate">{link.email}</span>
      )}
    </span>
  </>
);

const ROW_CLASS =
  'flex items-center gap-3.5 w-full px-4 py-3 rounded-brand-lg border border-line bg-surface-raised text-left';

/**
 * The links a church publishes, in the provider table's order.
 *
 * 🔴 ORDER IS `GIVING_PROVIDERS`' ORDER, resolved in `readGivingLinks` before
 * anything reaches here — not the order the church filled the form in, and not
 * the order Firestore returned the object's keys in (which is unspecified). A
 * member coming back next month finds the same option in the same place.
 */
const GivingLinks: React.FC<{
  links: readonly PublishedGivingLink[];
  /** Shown when a donation form sits above these, so the two read as one page. */
  heading?: string;
  className?: string;
}> = ({ links, heading = 'Other ways to give', className = '' }) => {
  if (links.length === 0) return null;
  return (
    <section className={`mt-8 ${className}`} data-testid="giving-links">
      <h3 className="text-[11px] font-bold text-faint tracking-wider uppercase mb-3">{heading}</h3>
      <div className="space-y-3">
        {links.map((link) =>
          link.url ? (
            <a
              key={link.provider.id}
              href={link.url}
              target="_blank"
              /* `noopener` and `noreferrer` on a link a church typed and a
                 stranger's site receives; `nofollow` because a giving page is
                 not an endorsement Harvest is lending its domain's weight to. */
              rel="noopener noreferrer nofollow"
              data-provider={link.provider.id}
              className={`${ROW_CLASS} hover:bg-surface-sunken transition-colors`}
            >
              <LinkBody link={link} />
              <ExternalLink size={16} className="text-faint shrink-0" aria-hidden="true" />
            </a>
          ) : (
            /* No valid URL — Zelle normally, which has no per-church page at
               all. A card, deliberately not an anchor: a row that looks
               tappable and does nothing is the dead end THE-193 is about. */
            <div
              key={link.provider.id}
              data-provider={link.provider.id}
              className={ROW_CLASS}
            >
              <LinkBody link={link} />
            </div>
          ),
        )}
      </div>
      {/*
        🔴 THE MEMBER'S HALF OF THE SAME WARNING THE ADMIN GETS. These gifts do
        not pass through Harvest, so no receipt and no year-end giving statement
        can cover them — and a member who assumes otherwise finds out in
        January. Said here, once, in the member's own words.
      */}
      <p className="text-xs text-faint mt-3 leading-relaxed">
        These go straight to your ministry through their own account. They are not
        processed by Harvest, so they will not appear in your donation history or on a
        giving statement.
      </p>
    </section>
  );
};

export default GivingLinks;
