"use client";
import React, { useState } from 'react';
import { HeartHandshake, Heart, Lock, ShieldCheck, Loader2 } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { authFetch } from '../utils/auth-fetch';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { DesktopCard } from './layout/DesktopLayout';
import GivingLinks from './donations/GivingLinks';
import type { PublishedGivingLink } from './donations/giving-providers';

type DonationType = 'one-time' | 'monthly';

/**
 * The Give page.
 *
 * 🔴 THE-246 — THREE OF THE FOUR STATES ARE DECIDED BY THE CALLER, AND ONLY BY
 * THE CALLER. MainApp derives both facts once (`hasStripeGiving`,
 * `givingLinks`) and uses them for the tab entry, the redirect and this mount,
 * so the strip and the page cannot disagree about whether a church can take a
 * gift. This component is mounted from nowhere else; the fourth state — neither
 * rail, so no Give page at all — is therefore the absence of this mount, which
 * is why there is no "nothing to show" branch below to get out of step with it.
 *
 *   Stripe ✗ links ✗ → never mounted (MainApp)
 *   Stripe ✓ links ✗ → the donation form alone
 *   Stripe ✗ links ✓ → the links alone, no form
 *   Stripe ✓ links ✓ → the form, with the links beneath it
 *
 * ⚠️ Hiding the form is not what refuses the money. `/api/stripe/donate` is
 * deliberately unauthenticated so anonymous donors can give, and it already
 * refuses a plan without `fundraising`, a tenant past its grace window, and a
 * tenant with no connected account — before any Stripe object exists. That
 * route is the server gate; this is the surface.
 */
interface PartnerWithUsTabProps {
  /**
   * Does this ministry have a Stripe account that can actually take a card?
   * `false` renders the page WITHOUT the amount picker and the Give button —
   * a form whose submit is guaranteed to fail is worse than no form.
   */
  showDonationForm: boolean;
  /** The church's own payment links, already validated and in table order. */
  links: readonly PublishedGivingLink[];
}

const PartnerWithUsTab: React.FC<PartnerWithUsTabProps> = ({ showDonationForm, links }) => {
  const { tenantId, tenantName } = useTenant();
  const [donationType, setDonationType] = useState<DonationType>('one-time');
  const [amount, setAmount] = useState<string>('50');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetAmounts = ['10', '25', '50', '100'];

  const handleDonate = async () => {
    const effectiveTenantId = tenantId || PLATFORM_TENANT_ID;

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!amountCents || amountCents < 100) {
      setError('Minimum donation is $1.00');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await authFetch('/api/stripe/donate', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountCents,
          tenantId: effectiveTenantId,
          donationType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create checkout session');
        setIsLoading(false);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 px-4 lg:px-0 pb-32 max-w-md mx-auto w-full lg:max-w-[960px] lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 lg:items-start">
      {/* The left column. `contents` below `lg` means this wrapper draws NO BOX
          at all on a phone — its children stay direct children of the flow they
          were in before, so mobile is unmoved — and becomes a real column from
          `lg` up, where it keeps the links under the form rather than letting
          auto-placement drop them into the summary rail's column. The same
          `contents` + `lg:` pairing form-layout's Rule 5 documents. */}
      <div className="contents lg:block">
      {/* Desktop (lg:+) only: lift the whole donation form onto an elevated,
          padded card that reads as an intentional single surface on the page
          field. All classes are lg:-gated (DesktopCard's bg/border/shadow/radius
          are lg: by construction), so mobile stays byte-identical. */}
      <DesktopCard elevation="md" className="lg:p-8">
      {/* Top Icon & Text.
          Desktop (lg:) shifts to the warm-neutral Harvest Member App look (serif
          "Give", surface-gold disc, warm copy); mobile classes are unchanged. */}
      <div className={`flex flex-col items-center text-center mt-4 ${showDonationForm ? 'mb-8' : 'mb-2'}`}>
        <div className="w-16 h-16 bg-[var(--surface-gold)] rounded-full flex items-center justify-center mb-4">
          <HeartHandshake size={32} className="text-gold" />
        </div>
        <h2 className="text-[26px] font-light text-strong mb-1 font-display lg:text-[28px]">Give</h2>
        {tenantName && (
          <p className="text-gold font-semibold text-sm mb-2">{tenantName}</p>
        )}
        <p className="text-muted text-sm leading-relaxed">
          {showDonationForm
            ? 'Your partnership keeps this platform free for the new believer and scalable for the nations.'
            /* Links-only. The copy has to carry what the form's "Secure,
               encrypted payment via Stripe" line carried — WHO is being paid —
               because here it is not Harvest, and a member is entitled to know
               that before they leave the app. */
            : `Give directly to ${tenantName || 'this ministry'} through one of the accounts below.`}
        </p>
      </div>

      {showDonationForm && (
        <>
      {/* One-Time / Monthly Toggle */}
      <div className="bg-surface-sunken rounded-xl p-1 flex mb-8 border border-line">
        <button
          onClick={() => setDonationType('one-time')}
          className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${
            donationType === 'one-time'
              ? 'bg-gold text-white'
              : 'text-muted hover:bg-surface-raised'
          }`}
        >
          One-Time
        </button>
        <button
          onClick={() => setDonationType('monthly')}
          className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
            donationType === 'monthly'
              ? 'bg-gold text-white'
              : 'text-muted hover:bg-surface-raised'
          }`}
        >
          Monthly <Heart size={14} className={donationType === 'monthly' ? 'fill-white' : 'fill-[color:var(--text-muted)]'} />
        </button>
      </div>

      {/* Select Amount */}
      <div className="mb-8">
        <h3 className="text-[11px] font-bold text-faint tracking-wider uppercase mb-3">
          Select Amount
        </h3>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {presetAmounts.map((preset) => (
            <button
              key={preset}
              onClick={() => setAmount(preset)}
              className={`py-3 rounded-xl text-sm font-bold transition-colors border ${
                amount === preset
                  ? 'bg-[var(--surface-gold)] border-gold text-wheat-800'
                  : 'bg-surface-raised border-line text-strong'
              }`}
            >
              ${preset}
            </button>
          ))}
        </div>
        <div className="bg-surface-sunken rounded-xl p-4 flex items-center border border-line">
          <span className="text-faint font-bold mr-2">$</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="bg-transparent font-bold text-strong w-full focus:outline-hidden text-lg"
            placeholder="Other Amount"
          />
        </div>
      </div>

      {/* Security Info */}
      <div className="flex items-center justify-center gap-2 text-faint mb-4">
        <Lock size={14} />
        <span className="text-xs font-medium">Secure, encrypted payment via Stripe</span>
        <ShieldCheck size={14} className="ml-2" />
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center font-medium">
          {error}
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={handleDonate}
        disabled={isLoading}
        className="w-full bg-gold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl shadow-[var(--glow-gold)] transition-all flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Redirecting to Stripe...
          </>
        ) : (
          <>
            <Heart size={18} className="fill-white" />
            Give ${amount || '0'}{donationType === 'monthly' ? ' Monthly' : ''}
          </>
        )}
      </button>
        </>
      )}
      </DesktopCard>

      {/* The church's own payment links. Beneath the form when there is one,
          and the whole of the page when there is not — the heading changes with
          it so "Other ways to give" never names the only way there is. */}
      <GivingLinks
        links={links}
        heading={showDonationForm ? 'Other ways to give' : 'Ways to give'}
      />
      </div>

      {/* Desktop-only "Your gift" summary rail. Real values only — no impact,
          year-to-date, tax-statement, fund, or processing-fee lines (the app
          has no data/feature for those yet). hidden on mobile, so mobile is
          byte-identical.

          Bound to the form: it summarises the amount and frequency the form
          holds, so with no form there is no gift for it to total. */}
      {showDonationForm && (
      <div className="hidden lg:block">
        <DesktopCard elevation="sm" className="lg:p-6 lg:sticky lg:top-4">
          <div className="text-[11px] font-bold text-faint tracking-[0.14em] uppercase mb-2">Your gift</div>
          <div className="text-[40px] leading-none font-light tracking-[-0.02em] text-strong font-display">
            ${amount || '0'}
            {donationType === 'monthly' && <span className="text-base font-medium text-muted"> /mo</span>}
          </div>
          <div className="mt-5 border-t border-b border-line">
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-muted">Frequency</span>
              <b className="text-strong font-semibold">{donationType === 'monthly' ? 'Monthly' : 'One-time'}</b>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-muted">Total charge</span>
              <b className="text-strong font-semibold">${amount || '0'}{donationType === 'monthly' ? '/mo' : ''}</b>
            </div>
          </div>
          <div className="flex items-start gap-2.5 mt-5 p-3.5 rounded-xl bg-[var(--surface-gold)]">
            <Heart size={16} className="text-gold shrink-0 mt-0.5" />
            <p className="text-[13px] text-muted leading-snug m-0">
              Thank you for partnering with {tenantName || 'us'}. Your generosity fuels the mission.
            </p>
          </div>
        </DesktopCard>
      </div>
      )}
    </div>
  );
};

export default PartnerWithUsTab;
