"use client";
import React, { useState, useRef, useCallback } from 'react';
import { Check } from 'lucide-react';
import { TenantPlan } from '../../types/tenant.types';
import {
  getPlanFeatures,
  getPlanDisplayName,
  crmLabel,
  PLAN_DISPLAY_NAMES,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  PLAN_PRICING,
  isPricedPlan,
  AI_TELEGRAM_ASSISTANT_ENABLED,
  UNLIMITED_CAP,
  formatPlanPrice,
  formatPlanMonthlyHeadline,
  TERM_MONTHS,
  type BillingTerm,
  PlanFeatures,
  PLAN_BLURBS,
} from '../../utils/plan-features';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';
import { PLATFORM_FEE_MAP } from '../../lib/stripe-connect';
import { authFetch } from '../../utils/auth-fetch';
import { fetchBillingProcessor, needsFirstSubscription, runDodoPlanChange, startFirstSubscription, subscriptionProcessorAttribution, PlanChangeProcessor } from '../../utils/plan-change';
import { getTenantId } from './useTenantId';
import { BillingTermToggle } from './BillingTermToggle';

interface PlanUpgradeSectionProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
  /**
   * Hide the plan cards (there's nothing to upgrade to on the top tier). The
   * "Manage Subscription" / cancel action stays available.
   */
  hideUpgrade?: boolean;
  /**
   * Which processor owns this tenant's subscription, when the parent already
   * knows (BillingAndPayments reads it off /api/billing/invoices). Undefined
   * means "not known yet" and it is resolved lazily on the first plan click;
   * the server guards both routes regardless, so this only picks the flow.
   */
  processor?: PlanChangeProcessor;
}

/**
 * Presentation only — the display name and which tier carries the RECOMMENDED
 * badge. Prices are NOT listed here: this table used to carry
 * `monthlyPrice`/`yearlyPrice` literals ('$59/mo', '$2,990/yr') that the card
 * actually rendered while `formatPlanPrice` sat imported and unused two lines
 * above it, so a repricing in PLAN_PRICING left the in-app comparison showing
 * the old numbers. The card renders formatPlanPrice(planId, billingPeriod). Do
 * not reintroduce price literals.
 *
 * `icon` and `color` are gone with the icon disc they fed. `color` held the
 * only colour literals in this file — three raw hexes, one per tier, that
 * belonged to no palette in this app and themed in none of the four, painting a
 * tinted 48px disc at the top of each card. The marketing card has no icon, and
 * removing them is what lets "no colour is hardcoded" be literally true here
 * rather than true-with-an-exemption: there is now no colour literal in this
 * file at all.
 *
 * `recommended` moved from `pro` to `max`: on the marketing site the
 * recommended card is Ministry, and it is the dark one. This is the flag that
 * decides the card TREATMENT, not just a badge.
 */
const PLANS: { id: TenantPlan; name: string; recommended?: boolean; comingSoon: string[] }[] = [
  { id: 'plus', name: 'Individual', comingSoon: [] },
  { id: 'pro',  name: 'Small Team', comingSoon: [] },
  { id: 'max',  name: 'Ministry', recommended: true, comingSoon: [] },
];

// Keyed lookup so we can resolve plan metadata by id (icon/color/popular).
const PLAN_META = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<
  TenantPlan,
  (typeof PLANS)[number]
>;

/**
 * One matrix cell, and the name to print for it.
 *
 * 🔴 THE ONLY COPY IN THIS FILE IS A NAME PER CELL — never a tier's contents.
 * Every card walks this one list and prints the cells that ITS OWN
 * `getPlanFeatures(planId)` row unlocks, so flipping a cell in the matrix moves
 * the card with no edit here. That is the entire point. A hand-written "what
 * Individual includes" list is how this product once advertised "keeps 100%"
 * against a real 2.5% fee and how a `$59/mo` figure outlived a reprice; a third
 * standing copy of the tier contents is exactly what must not reappear.
 *
 * `count` marks a NUMERIC cell: [singular, plural] nouns printed against the
 * tier's own number ("150 contacts", "1 church"). Everything else is a boolean
 * cell, printed as `label` when the tier has it and left out when it does not.
 *
 * The platform donation fee is deliberately NOT here. It was the one row the
 * deleted comparison table hardcoded (`staticValue: '0%'`), because
 * PLATFORM_FEE_MAP (src/lib/stripe-connect.ts) is server-only and
 * `getPlanFeatures` does not carry the fee at all — so on a card that derives
 * every line it has nowhere to come from. That is a gap in the feature matrix,
 * not a string to retype here.
 */
type CardFeature = {
  key: keyof PlanFeatures;
  /** Boolean cell — the line printed when the tier has it. */
  label?: string;
  /**
   * Boolean cell whose LABEL is itself tier-dependent, derived from the same
   * resolved feature set the line's presence is. Only `crm` needs this today
   * (its "Donors" half is a claim about `fundraising` — see `crmLabel`), and a
   * function rather than a second literal is what stops the two halves drifting.
   * Takes precedence over `label`.
   */
  labelFor?: (features: PlanFeatures) => string;
  /** Numeric cell — [singular, plural] noun printed against the tier's count. */
  count?: readonly [string, string];
};

/**
 * Everything a card can say, in the order it says it: capacity first — the
 * numbers a church sizes itself against — then capabilities.
 *
 * These are the same cells the deleted comparison table named, plus
 * `maxContacts`. That one is new to this surface and is here deliberately: CRM
 * is on every tier now, and the contact cap is what scopes the claim.
 * Advertising the roster without the number it stops at is the overselling this
 * file has been burned by twice. It derives like every other line.
 */
const CARD_FEATURES: CardFeature[] = [
  { key: 'maxContacts', count: ['contact', 'contacts'] },
  { key: 'maxAdmins', count: ['admin account', 'admin accounts'] },
  { key: 'maxCourses', count: ['course', 'courses'] },
  { key: 'maxChurches', count: ['church', 'churches'] },
  { key: 'aiAssistant', count: ['AI Assistant', 'AI Assistants'] },
  { key: 'blog', label: 'Blog' },
  { key: 'pwaApp', label: 'Mobile App (PWA)' },
  { key: 'aiChat', label: 'AI Chat' },
  { key: 'aiKnowledge', label: 'AI Knowledge Base' },
  { key: 'map', label: 'Church Map' },
  { key: 'newsletterAutomation', label: 'Newsletter' },
  { key: 'customBranding', label: 'Custom Branding' },
  { key: 'customDomain', label: 'Custom Domain' },
  { key: 'fundraising', label: 'Fundraising' },
  { key: 'eventRegistration', label: 'Event Registration' },
  { key: 'docs', label: 'Notes' },
  { key: 'crm', labelFor: crmLabel },
  { key: 'accountingTools', label: 'Accounting Tools' },
  { key: 'taxReceipt', label: 'Tax Receipts' },
  { key: 'givingStatements', label: 'Giving Statements' },
  { key: 'customForms', label: 'Custom Forms → CRM' },
  { key: 'checkInSystem', label: 'Check-In (QR)' },
  { key: 'livestream', label: 'Livestream + Live Giving' },
  { key: 'smsAutomation', label: 'SMS Automation' },
  { key: 'sermonNotes', label: 'Sermon Notes → Livestream' },
  { key: 'automatedBlog', label: 'Automated Blog Articles' },
  { key: 'communityGroups', label: 'Community Groups' },
];

// While the AI Telegram Assistant is hidden, drop its line from every card.
// Flip AI_TELEGRAM_ASSISTANT_ENABLED to bring it back.
//
// THE-245 does the same for 'SMS Automation'. These cards are in-app MARKETING:
// they tell a church what a tier includes, so a line here is a promise on every
// upgrade screen. 🔴 The `smsAutomation` cell in the plan matrix is untouched —
// only this card's line is withheld, so the tiers that own SMS still own it and
// get the line back with the switch.
const VISIBLE_CARD_FEATURES = CARD_FEATURES.filter(
  (f) =>
    (AI_TELEGRAM_ASSISTANT_ENABLED || f.key !== 'aiAssistant') &&
    (SMS_FEATURE_ENABLED || f.key !== 'smsAutomation'),
);

/**
 * The line this tier's card prints for one cell, or `null` when the tier does
 * not include it and the card leaves it out entirely.
 *
 * "Includes" is `hasFeature`'s definition rather than a second one: booleans by
 * their value, numbers by being non-zero. `features` arrives already resolved so
 * a card reads the matrix ONCE rather than once per line.
 */
function cardLine(feature: CardFeature, features: PlanFeatures): string | null {
  const value = features[feature.key];
  if (feature.count) {
    const [one, many] = feature.count;
    const n = value as number;
    if (n === 0) return null;
    if (n === UNLIMITED_CAP) return `Unlimited ${many}`;
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
  }
  if (!value) return null;
  return feature.labelFor ? feature.labelFor(features) : feature.label!;
}

/**
 * 🔴 THE DARK CARD, IN FOUR PALETTES.
 *
 * The marketing card paints the recommended tier with a navy border over a dark
 * ground and a deep navy-tinted drop shadow, both written there as raw literals
 * against that repo's own variables. This app has four palettes — Harvest and
 * Classic,
 * each light and dark — so a navy hex copied across would be a dark card on a
 * cream page in two of them and a dark card on an ALREADY-DARK page in the
 * other two, where it stops reading as a distinct card at all. Every value
 * below is a token instead, and each was chosen because it already solves that
 * exact problem:
 *
 *   --surface-night   The "dark hero band" ground. It is the brand navy in
 *                     light AND it is deliberately LIGHTENED in dark, for
 *                     the documented reason that "on a dark page a dark band
 *                     has almost no contrast and the section visually
 *                     disappears". Classic overrides neither value — the block
 *                     in globals.css lists --surface-night among the tokens it
 *                     leaves alone, because it is fixed brand structure rather
 *                     than part of the neutral ramp. So one token gives a navy
 *                     card that separates from the ground in all four.
 *   --border-gold     The accent hairline. Fixed-alpha gold is weak on a dark
 *                     ground, so this token is already lifted 40% → 52% in
 *                     dark, and Classic leaves it alone for the same reason.
 *                     It is what gives the card an edge in Classic dark, where
 *                     navy-on-neutral-grey is the least separated of the four.
 *   --ds-sh-lg        The elevation ramp's top step. In light it is a warm drop
 *                     shadow; in dark it becomes a hairline top highlight plus
 *                     a deeper black, because a warm shadow on a dark ground is
 *                     not subtle, it is absent.
 *
 * The ink is `text-cream` and `text-cream/70..80` rather than the inverting
 * --text-* ramp, and that is the point: --text-strong is near-black in light,
 * and this card is dark in light. Cream on navy is the same pairing the
 * member Profile's night band and the design kit's HeroBand already ship, and
 * it is correct in all four because the GROUND is navy in all four.
 *
 * NO NEW TOKEN WAS NEEDED. That was the thing most likely to go wrong here.
 */
const RECOMMENDED_CARD_STYLE: React.CSSProperties = {
  background: 'var(--surface-night)',
  borderColor: 'var(--border-gold)',
  boxShadow: 'var(--ds-sh-lg)',
};

/** A plain card: the raised surface it already used, one step down the ramp. */
const PLAIN_CARD_STYLE: React.CSSProperties = { boxShadow: 'var(--ds-sh-md)' };

/**
 * The check mark on the dark card. `text-green-600` is the ink the plain cards
 * use and it resolves to a mid green that falls under AA on navy in the light
 * theme. The accent does not: globals.css records Harvest gold at 6.77:1 on the
 * dark ground, and --brand-color-on-dark is the tenant-corrected accent a
 * white-label tenant gets injected, so a tenant whose colour would vanish on
 * navy keeps a readable check.
 */
const RECOMMENDED_CHECK_STYLE: React.CSSProperties = {
  color: 'var(--brand-color-on-dark, var(--brand-color))',
};

/** One derived line on a card: the matrix cell it came from, and its text. */
type RenderedLine = { key: keyof PlanFeatures; text: string };

/**
 * Every line a tier's card COULD print, derived from its own matrix row and
 * nothing else. `cardLine` decides both the wording and whether there is a line
 * at all, so this is a filter, not a second definition.
 */
function linesFor(features: PlanFeatures): RenderedLine[] {
  return VISIBLE_CARD_FEATURES
    .map((feature) => {
      const text = cardLine(feature, features);
      return text === null ? null : { key: feature.key, text };
    })
    .filter((line): line is RenderedLine => line !== null);
}

/**
 * 🔴 THE ROLLUP, COMPUTED.
 *
 * What a tier adds over the tier below it — Small Team's card is what is true
 * on `pro` and not on `plus`, Ministry's is `max` minus `pro`. That is a
 * DERIVATION, not a curated list: a cell flipped in PLAN_FEATURES moves the
 * rollup with no edit here, exactly as the full list already moved.
 *
 * Comparing the rendered TEXT rather than the raw cell is what makes numeric
 * cells fall out correctly. `maxContacts` goes 150 → 500 → 2,000, so its line
 * differs at every tier and is re-printed each time (the cap is the thing that
 * moved, and a church reading "Everything in Individual" must still be told the
 * new number). `maxChurches` is 1 on every tier, so its line is identical and
 * is inherited silently rather than repeated three times under a heading that
 * already says it is inherited.
 */
function rollupLines(features: PlanFeatures, below: PlanFeatures): RenderedLine[] {
  const inherited = new Map(linesFor(below).map((line) => [line.key, line.text]));
  return linesFor(features).filter((line) => inherited.get(line.key) !== line.text);
}

/**
 * The platform's cut of a donation or a paid ticket, as the card prints it.
 *
 * 🔴 READ FROM `PLATFORM_FEE_MAP`, NOT TYPED. The previous card had no fee line
 * at all, on the reading that the map is server-only — it is not. It is a
 * 36-line module with no imports, no `server-only` marker, no env access and no
 * SDK: a bare `Record<string, number>` and its documentation. So the number can
 * reach a client component directly, which is the ONLY acceptable way to put it
 * on a card. A `0%` typed into this file would be the exact duplication that
 * once let the app advertise "keeps 100%" against a real 2.5% charge.
 *
 * Formatted rather than interpolated raw so a future 2.5% prints as "2.5%" and
 * not "2.5000000000000004%".
 */
function platformFeeLabel(plan: TenantPlan): string {
  const pct = (PLATFORM_FEE_MAP[plan] ?? 0) * 100;
  return `${Number(pct.toFixed(2))}%`;
}

const PlanUpgradeSection: React.FC<PlanUpgradeSectionProps> = ({ currentPlan, tenantId, email, hideUpgrade, processor }) => {
  const [billingPeriod, setBillingPeriod] = useState<BillingTerm>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [activePlanIndex, setActivePlanIndex] = useState(0);
  const planScrollRef = useRef<HTMLDivElement>(null);

  const handlePlanScroll = useCallback(() => {
    const container = planScrollRef.current;
    if (!container) return;
    const scrollLeft = container.scrollLeft;
    const cardWidth = 300;
    const index = Math.round(scrollLeft / cardWidth);
    setActivePlanIndex(Math.min(index, PLANS.length - 1));
  }, []);

  const resolveTenantId = async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    return getTenantId();
  };

  // Does this tenant need its FIRST subscription rather than a plan change?
  // One derivation, read by both the click routing and the footer action, so a
  // tenant can never be offered a manage action and a first-subscription
  // checkout at the same time.
  const isFirstSubscriptionTenant = needsFirstSubscription(currentPlan);

  /**
   * One entry point per plan card. Dodo tenants get the in-place
   * preview-then-confirm change (up AND down — Dodo's hosted portal has no plan
   * controls, so sending a downgrade there would dead-end); Stripe tenants keep
   * exactly the flow they had: checkout for an upgrade, the portal for a
   * downgrade. The server refuses a mis-routed request either way.
   */
  const handlePlanSelect = async (planId: TenantPlan, isDowngrade: boolean) => {
    setCheckoutLoading(planId);
    try {
      // ── 🔴 THE FREE TENANT'S FIRST SUBSCRIPTION (THE-212). ────────────────
      //
      // Checked BEFORE the processor, and that order is the fix. A free tenant
      // owns no subscription, so `/api/billing/invoices` has no processor to
      // report and answers with its Stripe default — which sent every free
      // tenant pressing Upgrade into `/api/stripe/checkout` and a Stripe PRICE
      // ID. See the note above `needsFirstSubscription` for the whole chain.
      //
      // The tier is the question here, not the processor: a tenant with no
      // priced plan has no subscription to change and needs its first one.
      if (isFirstSubscriptionTenant && isPricedPlan(planId)) {
        const result = await startFirstSubscription({ plan: planId, billing: billingPeriod });
        if (!result.ok && result.message) alert(result.message);
        return;
      }
      const proc = processor !== undefined ? processor : await fetchBillingProcessor();
      if (proc === 'dodo') {
        const tid = await resolveTenantId();
        if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
        const result = await runDodoPlanChange({ tenantId: tid, plan: planId, billing: billingPeriod });
        if (result.ok) {
          alert(result.message);
          window.location.reload();
        } else if (result.message) {
          alert(result.message);
        }
        return;
      }
      if (isDowngrade) {
        await handleManageSubscription();
        return;
      }
      await handleStripeCheckout(planId);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleStripeCheckout = async (planId: string) => {
    const tid = await resolveTenantId();
    if (!tid) { alert('Unable to find your organization. Please try again.'); return; }
    setCheckoutLoading(planId);
    try {
      let referrerId: string | undefined;
      try {
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) {
          const parsed = JSON.parse(stored);
          referrerId = parsed.id || stored;
        }
      } catch { /* ignore */ }

      const resp = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan: planId,
          billing: billingPeriod,
          tenantId: tid,
          tenantName: tid,
          email: email || undefined,
          ...(referrerId ? { referrerId } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to start checkout');
      }
    } catch (e) {
      console.error('Checkout error:', e);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    const tid = await resolveTenantId();
    if (!tid) { alert('Unable to find your organization.'); return; }
    setPortalLoading(true);
    try {
      const resp = await authFetch('/api/stripe/portal', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (e) {
      console.error('Portal error:', e);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {!hideUpgrade ? (
      <>
      <h2 className="font-display text-2xl font-bold text-strong">Upgrade Your Plan</h2>
      <p className="text-muted">Choose the plan that best fits your ministry&apos;s needs.</p>

      {/* Billing term toggle — three segments, shared with AdminUpgradePage.
          The badge is INSIDE each segment rather than hung off it; see the
          component for why an absolutely-positioned badge is what clips. */}
      <BillingTermToggle value={billingPeriod} onChange={setBillingPeriod} />

      {/* ── The plan cards ───────────────────────────────────────────────────
          Below `sm:` this is the horizontal snap carousel it has always been:
          fixed-width cards, one scroll track, dots underneath. From `sm:` up it
          becomes a grid, which is the fix for the clip — see the note on the
          container in BillingAndPayments.tsx.

          🔴 WHAT WAS CLIPPED. The row is `overflow-x-auto` with the scrollbar
          hidden, so on a desktop it did not scroll, it simply ended: three
          `min-w-[280px]` cards and two `gap-4`s need 869px at the 14.5px
          desktop rem base, inside a track that the old `max-w-3xl` left 659.75px
          of. 209.25px over, and what a founder saw of the third card was the
          70.75px that fit — a column of checkmarks against "2,00…", "15 a…".

          The grid is `sm:grid-cols-2 lg:grid-cols-3` rather than three columns
          everywhere. Three across a 768px tablet is a 221px card; two is 332px
          and the third wraps, which is what "fit or wrap" is for. `lg` is also
          where the rem base changes and where the app's other desktop rules
          gate, so nothing new reflows at a width nothing else reflows at.

          Every token added here is breakpoint-prefixed, so the carousel — and
          the phone rendering of it — is untouched. */}
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
      <div
        ref={planScrollRef}
        onScroll={handlePlanScroll}
        data-testid="plan-card-track"
        className="flex overflow-x-auto gap-4 pb-4 snap-x snap-mandatory scrollbar-hide sm:grid sm:grid-cols-2 sm:overflow-x-visible sm:pb-0 lg:grid-cols-3"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {/* 🔴 PRICED tiers only — see PRICED_PLAN_ORDER. Each card below ends in
            a checkout, and the Forever Free tier has no price and no Dodo
            product. `isDowngrade` still compares against PLAN_ORDER, because a
            tenant's CURRENT plan can be 'free'. Renders the same three cards it
            rendered before this tier existed. */}
        {PRICED_PLAN_ORDER.map((planId, planIndex) => {
          const meta = PLAN_META[planId];
          const plan = meta;
          const features = getPlanFeatures(planId);
          const name = PLAN_DISPLAY_NAMES[planId];
          // 🔴 THE-196 FLIPPED THESE TWO. The headline is now the PER-MONTH
          // figure and the charged total sits beneath it. Both still come from
          // the one formatter each, so neither is assembled here.
          const displayPrice = formatPlanPrice(planId, billingPeriod);
          // The charged figure without its suffix — "$329" out of "$329/yr" —
          // for the line beneath, which names its own cadence in words.
          const chargedTotal = displayPrice.split('/')[0];
          // The headline. Ceiled at the cent, so it can never imply less than
          // `chargedTotal`; see planTermMonthlyDisplayed for why that matters
          // more as a headline than it did as a footnote.
          const monthlyHeadline = formatPlanMonthlyHeadline(planId, billingPeriod);
          const isCurrent = planId === currentPlan;
          const isDowngrade = PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(currentPlan ?? 'plus');

          // The tier below this one, and therefore whether this card rolls up.
          // Individual is the floor and prints its list whole.
          // The tier below THIS card in the priced ladder, so Individual stays
          // the floor that prints its list whole. Reading PLAN_ORDER here would
          // make Individual roll up as "Everything in Free", which is both a
          // downgrade of its own pitch and, since free has almost nothing, a
          // rollup that hides the features it is actually selling.
          const below = planIndex > 0 ? PRICED_PLAN_ORDER[planIndex - 1] : null;
          const lines = below ? rollupLines(features, getPlanFeatures(below)) : linesFor(features);
          const rollup = below ? `Everything in ${PLAN_DISPLAY_NAMES[below]}` : null;

          // The recommended card is DARK, and the badge is suppressed when this
          // is the tenant's own plan — see the note above the badge below.
          const isRecommended = !!meta.recommended;

          return (
            <div
              key={planId}
              data-testid="plan-card"
              data-plan={planId}
              data-recommended={isRecommended ? 'true' : undefined}
              /* 24px radius and 24px padding, in px rather than `rounded-2xl`
                 / `p-6`, because both are load-bearing for the width arithmetic
                 above and `p-6` is 24px on a phone but 21.75px from 1024px up.
                 `rounded-brand-xl` IS 24px and is the token for it. */
              className={`relative rounded-brand-xl p-[24px] transition-all min-w-[280px] max-w-[320px] flex-shrink-0 snap-center flex flex-col sm:min-w-0 sm:max-w-none ${
                isRecommended ? 'border' : 'bg-surface-raised border border-line-subtle'
              }`}
              /* Colour comes from tokens only — see the block comment on
                 RECOMMENDED_CARD_STYLE. */
              style={isRecommended ? RECOMMENDED_CARD_STYLE : PLAIN_CARD_STYLE}
            >
              {/* ── The badge slot ──────────────────────────────────────────
                  ONE badge, top-right, and the current-plan marker WINS it.

                  RECOMMENDED is an advertisement aimed at somebody choosing a
                  plan. The current-plan marker is a statement of fact about
                  this account, and on a billing screen it is the only thing
                  telling a customer where they stand. Selling a church the
                  plan it is already paying for reads as a nag; the button
                  under it already says "Current Plan", so a RECOMMENDED badge
                  on the same card contradicts it outright. The marker wins,
                  and the card keeps its dark treatment either way — that is
                  the tier's identity, not a badge. */}
              {isCurrent ? (
                <span
                  data-testid="plan-card-current"
                  className="absolute top-[18px] right-[18px] px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-gold text-white"
                >
                  Current plan
                </span>
              ) : isRecommended ? (
                <span
                  data-testid="plan-card-recommended"
                  className="absolute top-[18px] right-[18px] px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-gold text-white"
                >
                  RECOMMENDED
                </span>
              ) : null}

              {/* Plan name — small and left-aligned, not a centred heading. */}
              <h3
                className={`font-display text-[13px] font-bold tracking-wide ${
                  isRecommended ? 'text-cream' : 'text-strong'
                }`}
              >
                {name}
              </h3>

              {/* Price — large, with a small period beside it. */}
              <p
                data-testid="plan-card-price"
                className={`mt-2 flex items-baseline ${isRecommended ? 'text-cream' : 'text-strong'}`}
              >
                <span className="text-[34px] font-bold leading-none">{monthlyHeadline}</span>
                <span className="text-[13px] font-semibold">/mo</span>
              </p>
              {/* ── 🔴 THE CHARGED TOTAL (THE-196) ─────────────────────────
                  The headline above is a per-month EQUIVALENT. This is the
                  amount that actually leaves the account, and now that it is
                  the smaller of the two it has to carry its own weight:

                    12.5px, not `text-xs`. The desktop rem base is 14.5px from
                    1024px up, where `text-xs` computes to 10.875px — under the
                    11px floor. An explicit px size cannot drift with the base.

                    `text-muted` (7.02:1 on white) rather than `text-faint`
                    (5.28:1), and `cream/80` (11.23:1 on navy) rather than
                    `cream/70`. Both were already AA; the point is that the
                    number a church is billed should not be the quietest ink on
                    the card while a figure nobody is billed is the loudest.

                  On MONTHLY this renders nothing at all — no element and no
                  reserved space. The headline is already the charged amount on
                  the charged cycle, so "billed as $39 every 1 month" underneath
                  "$39/mo" is the same sentence twice. No spacer is needed
                  either: the toggle is global, so all three cards are on the
                  same term at the same time and the row cannot go missing from
                  one card while its neighbour keeps it. */}
              {billingPeriod !== 'monthly' && (
                <p
                  data-testid="plan-card-term-note"
                  className={`mt-1 text-[12.5px] font-medium ${isRecommended ? 'text-cream/80' : 'text-muted'}`}
                >
                  {`billed as ${chargedTotal} every ${TERM_MONTHS[billingPeriod]} months`}
                </p>
              )}

              {/* Blurb — one line, and `min-h` reserves the row whether it
                  wraps to two or not, so the three cards stay aligned. */}
              <p
                data-testid="plan-card-blurb"
                className={`mt-2 text-[12.5px] leading-snug min-h-[34px] ${
                  isRecommended ? 'text-cream/70' : 'text-muted'
                }`}
              >
                {PLAN_BLURBS[planId]}
              </p>

              {/* The donation-fee callout — the strongest line on the
                  marketing card, and the number is READ, never typed. */}
              <div
                data-testid="plan-card-fee"
                className={`mt-3 flex items-center gap-2.5 rounded-brand py-[10px] px-[12px] ${
                  isRecommended ? 'bg-cream/10' : 'bg-surface-sunken'
                }`}
              >
                <span
                  className={`text-[22px] font-bold leading-none ${isRecommended ? 'text-cream' : 'text-strong'}`}
                >
                  {platformFeeLabel(planId)}
                </span>
                <span
                  className={`text-[11px] leading-tight ${isRecommended ? 'text-cream/70' : 'text-muted'}`}
                >
                  Platform donation fee
                  <br />
                  on every gift and paid ticket
                </span>
              </div>

              {/* What this tier includes. Every line is derived from `features`
                  above — the card names no feature the matrix did not hand it,
                  and omits what the tier does not have rather than printing a
                  row of ✗ against it. On the two upper tiers the list is the
                  DELTA over the tier below, headed by the rollup line. */}
              <div className="mt-4 mb-5 flex-1">
                {rollup && (
                  <p
                    data-testid="plan-card-rollup"
                    className={`mb-2 text-[12.5px] font-bold ${
                      isRecommended ? 'text-cream' : 'text-strong'
                    }`}
                  >
                    {rollup}
                  </p>
                )}
                <ul data-testid="plan-card-features" data-plan={planId} className="space-y-2">
                  {lines.map((line) => (
                    <li
                      key={line.key}
                      data-feature={line.key}
                      className="flex items-start gap-2 text-[12.5px]"
                    >
                      <Check
                        size={15}
                        aria-hidden="true"
                        className={`shrink-0 mt-0.5 ${isRecommended ? '' : 'text-green-600'}`}
                        style={isRecommended ? RECOMMENDED_CHECK_STYLE : undefined}
                      />
                      <span className={isRecommended ? 'text-cream/80' : 'text-body'}>{line.text}</span>
                    </li>
                  ))}
                </ul>

                {plan.comingSoon.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-line-subtle">
                    <p className="text-[11px] font-semibold text-amber-500 uppercase tracking-wider mb-1.5">Coming Soon</p>
                    {plan.comingSoon.map((item) => (
                      <div key={item} className="flex items-center justify-between text-sm">
                        <span className="text-muted">{item}</span>
                        <span className="text-amber-500 text-xs font-semibold">Soon</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 🔴 UNCHANGED. The click still goes to `handlePlanSelect`, which
                  still routes Dodo in place and Stripe to checkout or the
                  portal; the labels are still Current Plan / Upgrade to /
                  Downgrade to, because these are existing customers and this
                  card is not a "Start free trial". Nothing below this line was
                  touched by the marketing match, including the touch target. */}
              <button
                onClick={() => {
                  if (!isCurrent) handlePlanSelect(plan.id, isDowngrade);
                }}
                disabled={isCurrent || checkoutLoading === planId}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-surface-sunken text-faint cursor-default'
                    : isDowngrade
                    ? 'border border-line text-body hover:bg-surface-tint'
                    : checkoutLoading === planId
                    ? 'bg-[color-mix(in_srgb,var(--brand-color)_70%,transparent)] text-white cursor-wait'
                    : 'bg-gold text-white hover:bg-gold'
                }`}
              >
                {checkoutLoading === planId ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecting...
                  </span>
                ) : isCurrent ? 'Current Plan' : isDowngrade ? `Downgrade to ${plan.name}` : `Upgrade to ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Carousel Dot Indicators. A scroll affordance for a track that only
          scrolls below `sm:` — from there up the cards are a grid and there is
          nothing to page through, so the row is hidden. `sm:hidden` is
          breakpoint-gated, so the phone keeps its dots exactly as they are. */}
      <div className="flex justify-center gap-2 py-2 sm:hidden">
        {PRICED_PLAN_ORDER.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              const container = planScrollRef.current;
              if (container) container.scrollTo({ left: index * 300, behavior: 'smooth' });
              setActivePlanIndex(index);
            }}
            className={`transition-all rounded-full ${
              activePlanIndex === index ? 'w-6 h-2 bg-gold' : 'w-2 h-2 bg-line-strong hover:bg-warm-brown'
            }`}
            aria-label={`Go to plan ${index + 1}`}
          />
        ))}
      </div>

      {/* The "Full Feature Comparison" table stood here and is deliberately
          gone. It was a 27-row ✓/✗ matrix rendering the same `getPlanFeatures`
          cells the three cards above already carry — a second rendering of the
          same facts, on the screen where a church is choosing a plan rather than
          auditing one. The cards are the comparison now. */}
      </>
      ) : (
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold text-strong">Billing</h2>
          <p className="text-muted mt-1">You&apos;re on the Ministry plan — the highest tier. Manage or cancel your subscription below.</p>
        </div>
      )}

      {/* ── Billing & Payments ───────────────────────────────────────────────
          🔴 A FREE TENANT HAS NOTHING TO MANAGE (THE-212). The button below
          opens `/api/stripe/portal` — the hosted customer portal where a
          subscription is cancelled, a card replaced and an invoice read. A
          Forever Free tenant has no subscription, no card and no invoice with
          any processor, so there is no portal to open: the route finds no
          customer id and answers "No Stripe subscription found. Please
          subscribe first." A control whose only outcome is that error is worse
          than no control — on the one screen where this tenant is supposed to
          be able to start PAYING, it offered them an exit from a subscription
          they do not have.

          So the action is replaced rather than merely hidden, and it is
          replaced by the thing this tenant actually needs: the plan cards
          directly above, which are the purchase. The attribution line goes with
          it — `processor` is 'stripe' for a tenant with no billing records at
          all (see `needsFirstSubscription`), and "Powered by Stripe" under an
          upgrade action would be a claim about a processor this tenant has
          never paid and, once it upgrades, never will.

          ⚠️ Keyed on the TIER, exactly as the routing above is, so the two
          cannot disagree about who this tenant is. */}
      {isFirstSubscriptionTenant ? (
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            data-testid="billing-upgrade-action"
            onClick={() => {
              planScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-earth text-cream rounded-xl text-sm font-semibold hover:bg-warm-dark dark:bg-cream dark:text-earth dark:hover:bg-stone-200 transition-colors"
          >
            Upgrade Your Plan
          </button>
          <p className="text-xs text-faint">
            You&apos;re on the Free plan — there&apos;s no subscription to manage yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            data-testid="billing-manage-action"
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-earth text-cream rounded-xl text-sm font-semibold hover:bg-warm-dark dark:bg-cream dark:text-earth dark:hover:bg-stone-200 transition-colors disabled:opacity-50"
          >
            {portalLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Opening portal...
              </>
            ) : (
              'Manage Subscription'
            )}
          </button>
          {subscriptionProcessorAttribution(processor) && (
            <p className="text-xs text-faint">{subscriptionProcessorAttribution(processor)}</p>
          )}
        </div>
      )}

    </div>
  );
};

export default PlanUpgradeSection;
