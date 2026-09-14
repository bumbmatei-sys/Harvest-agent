"use client";
import React, { useState } from 'react';
import { Heart, Clock, Loader2 } from 'lucide-react';
import GivingLinks from './donations/GivingLinks';
import type { PublishedGivingLink } from './donations/giving-providers';

interface PublicCampaignProps {
  tenantId: string;
  tenantName: string;
  logo: string | null;
  primaryColor: string;
  campaign: {
    id: string;
    title: string;
    description: string;
    coverImage: string | null;
    goal: number;
    raised: number;
    endDate: string | null;
  };
  /**
   * THE-251 — the church's own payment links, already validated and in the
   * provider table's order by `readGivingLinks` on the server.
   *
   * 🔴 NOT RE-DERIVED HERE, and not fetched here. The page that mounts this
   * resolves them from the same `tenant.config` it takes the logo from, so the
   * campaign page and the Give page cannot disagree about which links a church
   * publishes — a second derivation is exactly how two surfaces drift.
   *
   * Optional, and defaulted to empty: every other caller of this component
   * (tests, and any future mount) keeps rendering exactly as it did.
   */
  links?: readonly PublishedGivingLink[];
  /**
   * 🔴 THE-303 — CAN THIS CHURCH ACTUALLY TAKE A CARD?
   *
   * The founder: "If stripe is not connected, the fundraising page shall only
   * show the donation links. Wise etc." This page drew the amount picker, the
   * donor fields, the Donate button and "Secure payment powered by Stripe."
   * UNCONDITIONALLY — for every tenant, connected or not, and with
   * `STRIPE_CONNECT_ENABLED` false platform-wide (THE-256) that meant a public
   * appeal whose primary action posts to `/api/stripe/donate` and comes back
   * 503. A form whose submit is guaranteed to fail is worse than no form; the
   * member Give page has read exactly this way since THE-246, and this is that
   * rule reaching the page a stranger actually lands on.
   *
   * ⚠️ FALSE DRAWS NO APOLOGY AND NO PLACEHOLDER. There is no "card payments
   * unavailable" line, no disabled button and no coming-soon note — the church's
   * own accounts become the page, which is what the founder asked for. A
   * visitor is not owed an explanation of a payment method this church does not
   * offer.
   *
   * 🔴 DECIDED BY THE ROUTE, and only by the route, exactly as `MainApp`
   * decides it for the member Give page: the master switch and the tenant's
   * connect status are both server-side facts, and a component that re-derived
   * either would be a second answer to "are we connected".
   *
   * Required, deliberately: an optional flag defaulting to `true` would let a
   * future mount ship the dead form back by saying nothing, which is precisely
   * the silent default this ticket exists to remove.
   */
  showDonationForm: boolean;
}

const AMOUNT_PRESETS = [25, 50, 100, 250];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

// Module-scope so its identity is stable across renders (a render-time nested
// component would remount the whole subtree on every keystroke → focus loss).
const Shell: React.FC<{ logo: string | null; tenantName: string; primaryColor: string; children: React.ReactNode }> = ({ logo, tenantName, primaryColor, children }) => (
  <div className="min-h-screen bg-surface-tint py-10 px-4">
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={tenantName} className="h-12 mx-auto mb-2 object-contain" />
        ) : (
          <div className="font-display text-lg font-extrabold" style={{ color: primaryColor }}>{tenantName}</div>
        )}
      </div>
      {children}
    </div>
  </div>
);

const PublicCampaign: React.FC<PublicCampaignProps> = ({ tenantId, tenantName, logo, primaryColor, campaign, links = [], showDonationForm }) => {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = 'w-full px-4 py-2.5 border border-line rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:border-transparent';
  const ring = { '--tw-ring-color': primaryColor } as React.CSSProperties;

  const pct = campaign.goal > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100)) : 0;
  const daysLeft = campaign.endDate
    ? Math.max(0, Math.ceil((new Date(campaign.endDate).getTime() - new Date().getTime()) / 86_400_000))
    : null;

  const amount = selectedAmount ?? (customAmount ? parseFloat(customAmount) : 0);

  // The DONATE action routes to the existing Stripe Checkout flow, which handles
  // its own auth + payment. This creates a Checkout session only — it records
  // nothing in Firestore until Stripe confirms payment, so there is no data
  // mutation from the public view itself.
  const donate = async () => {
    if (!amount || amount <= 0) { setError('Please select or enter an amount.'); return; }
    if (!donorEmail.trim()) { setError('Email is required.'); return; }
    setError(null);
    setProcessing(true);
    try {
      const res = await fetch('/api/stripe/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          tenantId,
          donationType: 'one-time',
          campaignId: campaign.id,
          donorName: donorName.trim(),
          donorEmail: donorEmail.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
        setProcessing(false);
      }
    } catch {
      setError('Network error. Please try again.');
      setProcessing(false);
    }
  };

  return (
    <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
      <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line-subtle overflow-hidden">
        {campaign.coverImage && (
          <div className="relative bg-surface-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={campaign.coverImage} alt={campaign.title} className="w-full max-h-64 object-cover" referrerPolicy="no-referrer" />
            {daysLeft !== null && (
              <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-xs">
                <Clock size={12} />
                {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
              </div>
            )}
          </div>
        )}

        <div className="p-6">
          {!campaign.coverImage && daysLeft !== null && (
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold mb-2" style={{ color: primaryColor }}>
              <Clock size={12} />
              {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
            </div>
          )}

          <h1 className="font-display text-2xl font-bold text-strong mb-2">{campaign.title}</h1>
          {campaign.description && <p className="text-sm text-muted mb-4 whitespace-pre-line">{campaign.description}</p>}

          {campaign.goal > 0 && (
            <div className="mb-5">
              <div className="flex items-baseline justify-between text-xs text-muted mb-1.5">
                <span className="font-semibold text-strong">{fmt(campaign.raised)} raised</span>
                <span>of {fmt(campaign.goal)}</span>
              </div>
              <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: primaryColor }} />
              </div>
              <div className="text-right text-[11px] font-bold mt-1" style={{ color: primaryColor }}>{pct}%</div>
            </div>
          )}

          {/* Donate — routes to Stripe Checkout (its own auth/payment).
              🔴 GATED BY `showDonationForm` (THE-303). With Stripe off there is
              no picker, no donor field, no button and no "powered by Stripe"
              line — see the prop's own note for why there is no apology in
              their place either. */}
          {showDonationForm && (
          <div>
            <p className="text-sm font-semibold text-body mb-2.5">Select an amount</p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {AMOUNT_PRESETS.map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => { setSelectedAmount(amt); setCustomAmount(''); }}
                  className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${selectedAmount === amt ? 'text-white border-transparent' : 'text-strong border-line bg-surface-raised'}`}
                  style={selectedAmount === amt ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
              <input
                type="number"
                min={1}
                value={customAmount}
                onChange={e => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                placeholder="Custom amount"
                className={`${inputCls} pl-7`}
                style={ring}
              />
            </div>

            <div className="space-y-3 mb-4">
              <input
                value={donorName}
                onChange={e => setDonorName(e.target.value)}
                placeholder="Your name (optional)"
                className={inputCls}
                style={ring}
              />
              <input
                type="email"
                value={donorEmail}
                onChange={e => setDonorEmail(e.target.value)}
                placeholder="Your email *"
                className={inputCls}
                style={ring}
              />
            </div>

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

            <button
              type="button"
              onClick={donate}
              disabled={processing || (!selectedAmount && !customAmount)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ backgroundColor: primaryColor }}
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : <Heart size={15} strokeWidth={2.5} />}
              {processing ? 'Processing…' : `Donate${amount ? ` ${fmt(amount)}` : ''}`}
            </button>
            <p className="text-[11px] text-faint text-center mt-3">Secure, encrypted payment.</p>
          </div>
          )}

          {/*
            THE-251 — the church's OWN payment links, beneath the Stripe form.

            🔴 THE SAME COMPONENT AND THE SAME TABLE AS THE GIVE PAGE. Logo,
            name, handle, email, ordering, the external-link affordance and the
            "not processed by Harvest" line are all `GivingLinks`' already, and
            a second renderer here would drift from it the first time either
            changed. Adding the fifth provider stays one row in
            `GIVING_PROVIDERS` — this file does not know how many there are.

            ⚠️ NO EMPTY BLOCK. `GivingLinks` returns null on an empty list, so a
            campaign whose church publishes no links renders exactly what it
            rendered before this change — no heading, no rule, no gap. That is
            the Give page's fourth state reproduced here by the same mechanism
            rather than by a second condition that could disagree with it.
          */}
          {/* 🔴 THE HEADING FOLLOWS THE FORM (THE-303). With no form above them
              these are not "other" ways to give — they are the ways — and a
              heading naming a way that is not on the page sends a member
              looking for it. The member Give page makes the same swap for the
              same reason. */}
          <GivingLinks
            links={links}
            heading={showDonationForm ? 'Other ways to give' : 'Ways to give'}
          />
        </div>
      </div>
    </Shell>
  );
};

export default PublicCampaign;
