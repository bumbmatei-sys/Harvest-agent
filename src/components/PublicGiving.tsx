"use client";
import React from 'react';
import GivingLinks from './donations/GivingLinks';
import type { PublishedGivingLink } from './donations/giving-providers';

/**
 * THE-303 — the church's giving page, as a STRANGER sees it.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * The founder: "I shared the giving page but its not public. It's bringing me
 * to the auth page." `buildGivingSharePayload` emitted the app root with a
 * query parameter (`/?giving=1`), which is the SPA — and the SPA has no session
 * for a visitor, so the one URL the share sheet, the printed QR and the
 * Text-to-Give reply all carry ended at a sign-in form. A giving link that
 * demands an account is not a giving link.
 *
 * So this is the page `/giving` renders: no session, no Firebase client, no
 * tab strip, no shell. The same thing `/pledge/[campaignId]` and
 * `/campaign/[campaignId]` already are.
 *
 * ─── 🔴 WHAT IS ON IT, AND NOTHING ELSE ─────────────────────────────────────
 *
 * The church's NAME, its LOGO, and the payment links it has already published.
 * That is the whole page. Every one of those three is a field of
 * `tenants/{id}`, whose document is world-readable by rule today (`allow read:
 * if true` — that is what resolves a subdomain before sign-in), and the giving
 * links in particular are stated to be public before an admin types them:
 * AdminDonations says "Everything you enter here is shown publicly on your Give
 * page, including the email addresses". So this route publishes nothing that
 * was not already published; it stops requiring a login to read it.
 *
 * ⚠️ NO MEMBER DATA, NO CAMPAIGN DATA, NO TOTALS. There is no gift history, no
 * amount raised, no contact, no member count and no admin control here — the
 * route hands this component three values and there is no seam for a fourth.
 *
 * ─── 🔴 NO STRIPE CONTROL AND NO APOLOGY — THE-256, and the founder ─────────
 *
 * "If stripe is not connected, the fundraising page shall only show the
 * donation links." Stripe Connect is off platform-wide, so there is no card
 * form to draw here and — just as deliberately — no line explaining its
 * absence. A stranger arriving to give does not need to be told about a payment
 * method this church does not offer; they need the accounts it does.
 *
 * ─── The links are RENDERED, not resolved, here ─────────────────────────────
 *
 * `readGivingLinks` runs once, on the server, in `app/giving/page.tsx` — the
 * same boundary `app/campaign/[campaignId]/page.tsx` validates at. This
 * component takes `PublishedGivingLink[]` and draws them through the shared
 * `GivingLinks`, so the row, the monogram, the `rel` tokens and the member's
 * half of the disclosure are the Give page's, not a second copy of them.
 */
export interface PublicGivingProps {
  tenantName: string;
  logo: string | null;
  /** Already validated and in provider-table order by the route. */
  links: readonly PublishedGivingLink[];
}

const PublicGiving: React.FC<PublicGivingProps> = ({ tenantName, logo, links }) => (
  <div className="min-h-screen bg-surface-tint py-10 px-4">
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={tenantName} className="h-12 mx-auto mb-2 object-contain" />
        ) : (
          <div className="font-display text-lg font-extrabold text-strong">{tenantName}</div>
        )}
      </div>

      <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line-subtle p-6">
        <h1 className="font-display text-2xl font-bold text-strong mb-1.5">Give to {tenantName}</h1>
        <p className="text-sm text-muted">
          Thank you for supporting this ministry. Choose the account that suits you below.
        </p>

        {/*
          ⚠️ NO EMPTY BLOCK. `GivingLinks` returns null on an empty list, so the
          "not published yet" line below is the ONE thing a visitor sees in that
          case — the same mechanism the campaign page uses, rather than a second
          condition that could disagree with it.

          `heading="Ways to give"` and not "Other ways to give": there is no
          form above these, so "other" would name a way to give that is not on
          the page. The Give page in the member app makes the same swap for the
          same reason.
        */}
        <GivingLinks links={links} heading="Ways to give" />

        {links.length === 0 && (
          /* 🔴 "Nothing published" is not "something went wrong", and it is not
             a blank card either. A visitor who followed a printed QR is told
             plainly that there is nothing here yet, so they stop looking for a
             button that does not exist. */
          <p className="text-sm text-muted mt-6" data-testid="giving-none">
            This ministry has not published any payment links yet. Please get in touch with
            them directly to give.
          </p>
        )}
      </div>
    </div>
  </div>
);

export default PublicGiving;
