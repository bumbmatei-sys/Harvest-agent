"use client";
import React, { useState, useEffect } from 'react';
import { Crown, Settings2, Plug, AlertTriangle, Check, FileText, MessageSquare, SlidersHorizontal, ChevronRight, DollarSign, CreditCard, Palette } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { getPlanFeatures, PLAN_DISPLAY_NAMES, PLAN_ORDER, formatPlanPrice, isUnpricedTier } from '../utils/plan-features';
import { hasPlatformOverride } from '../utils/tenant-scope';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
import SettingsAccordion from './settings/SettingsAccordion';
import OnboardingSection from './settings/OnboardingSection';
import GivingStatementsSection from './settings/GivingStatementsSection';
import SmsSection from './settings/SmsSection';
import IntegrationsSection from './settings/IntegrationsSection';
import { hasAnyIntegrationProvider } from './settings/integration-providers';
import { GIVING_PROVIDER_NAMES_OR } from './donations/giving-providers';
import ThemeToggle from './ThemeToggle';
import PaletteFamilyToggle from './PaletteFamilyToggle';
import SectionHeading from './settings/SectionHeading';
import { FORM_MEASURE, ACTION_BUTTON, CONTROL_DENSITY } from './layout/form-layout';

interface AdminSettingsProps {
  onBack: () => void;
  currentPlan?: TenantPlan;
  onChangePlan: (plan: TenantPlan) => void;
  onCancelPlan: () => void;
  tenantId?: string;
  email?: string;
  /** True only for the plan owner (tenant.ownerId) — gates plan-included AI Assistant.
   *  Owner by `tenants/{id}.ownerId` only — NOT the wider owner-or-roster gate
   *  that gates Billing. See AdminDashboard's `isPlanOwner` / `billingAccess`. */
  isPlanOwner?: boolean;
  /** Opens the bottom-bar / More-drawer customizer (lives in AdminDashboard). */
  onCustomizeNav?: () => void;
  /**
   * Opens the Donations section, where Stripe Connect now lives (THE-246).
   *
   * 🔴 REQUIRED, AND THAT IS THE DEAD-END GUARD. THE-193 is the precedent: a
   * CRM button pointed at a Settings screen that was hidden for that tier, and
   * the workflow simply ended. The fix there was to derive the gate; the fix
   * here is stronger, because the link and its destination are now the same
   * fact. AdminDashboard is the only caller, the callback it passes is
   * `go('donations')`, and `/admin/donations` always renders something — the
   * real screen when entitled, PlanUpgradeScreen when not. A caller that
   * cannot navigate cannot compile, so the row below cannot be drawn without a
   * destination.
   */
  onOpenDonations: () => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack, currentPlan, onChangePlan, onCancelPlan, tenantId, email, isPlanOwner, onCustomizeNav, onOpenDonations }) => {
  const [stripeStatus, setStripeStatus] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Platform-context super admins (apex) see every settings section. On a tenant
  // subdomain these plan-gated sections are gated by the tenant's plan, even for
  // a super admin.
  const platformOverride = hasPlatformOverride();

  // 🔴 THE-212. A tier with no price has no subscription with any processor, so
  // "Manage" and "Cancel Subscription" below are both inert for it: they open
  // `/api/stripe/portal`, which has no customer id to open a portal against and
  // answers "No Stripe subscription found. Please subscribe first." Offering a
  // church a Cancel button for a subscription it does not have is the worse
  // half of that. Asks the pricing table rather than naming the tier, the same
  // rule `isPricedPlan` is written under. An UNRECOGNISED tier is not treated
  // as free — see `isUnpricedTier` — so a legacy record keeps its controls.
  const hasSubscription = currentPlan !== undefined && !isUnpricedTier(currentPlan);
  const currentPlanData = currentPlan ? PLANS_DISPLAY.find(p => p.id === currentPlan) : null;
  const currentFeatures = currentPlan ? getPlanFeatures(currentPlan) : null;
  // Compact, comma/dot-separated plan summary, e.g. "Unlimited courses · Blog · AI Chat".
  const planSummary = currentFeatures
    ? [
        `${currentFeatures.maxCourses === -1 ? 'Unlimited' : currentFeatures.maxCourses} courses`,
        currentFeatures.blog ? 'Blog' : null,
        currentFeatures.aiChat ? 'AI Chat' : null,
        currentFeatures.crm ? 'CRM' : null,
      ].filter(Boolean).join(' · ')
    : '';
  const [forceOpen, setForceOpen] = useState<string | null>(null);

  // Handle Stripe return URL params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripe = params.get('stripe');
    const stripeConnect = params.get('stripe_connect');
    if (stripe === 'success') {
      // The Telegram assistant's `?addon=ai-assistant` return is gone with the
      // product (THE-253): the only Stripe success this screen can now see is a
      // plan change, which is what the generic banner below says.
      setStripeStatus('success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripe === 'cancel') {
      setStripeStatus('cancel');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripeConnect) {
      setStripeStatus(stripeConnect);
      // Returning from Stripe Connect onboarding → open the Payments section so
      // the (now updated) connection status is visible immediately.
      setForceOpen('payments');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleManageSubscription = async () => {
    const { auth, db } = await import('../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const { authFetch } = await import('../utils/auth-fetch');

    let tid = tenantId;
    if (!tid && auth.currentUser) {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (userDoc.exists()) tid = userDoc.data().tenantId || null;
    }
    if (!tid) { alert('Unable to find your organization.'); return; }

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
    }
  };

  // Sections kept in Settings after the nav overhaul. Branding, Domain, and
  // Billing live in their own tabs/pages. Payments (Stripe Connect) is now
  // surfaced here as the PRIMARY home for connecting the ONE account that powers
  // donations AND affiliate payouts (it also remains inside Fundraising).
  // Icons are neutral gray (no rainbow), rendered at 18px.
  //
  // ── THE-183: the regions, and why these ones ────────────────────────────────
  // Every `group` below labels a run of CONSECUTIVE rows, so the array order is
  // the region order and nothing is reordered — which is what lets the grouping
  // land without moving a single row on a phone. The groups fall out of the
  // order the screen already had; they were not chosen and then imposed on it.
  //
  //   Account          the plan card and the billing portal (outside this array)
  //   Appearance       palette family + light/dark
  //   Payments         Stripe Connect
  //   Church Setup     Onboarding Questions, Giving Statements
  //   Connected Services  SMS (Twilio), Mailchimp
  //   Danger Zone      Cancel Subscription, alone and cordoned off
  //   Navigation       Customize Navigation (outside this array)
  //
  // Departures from the grouping sketched in the ticket, and why:
  //
  //  • "Branding and Appearance" → "Appearance". There is no branding section on
  //    this screen — Branding is its own admin tab, per the header comment above
  //    — so that heading would name something that is not underneath it.
  //  • Payments is its own region rather than an Integration. The comment above
  //    calls it the PRIMARY home for the ONE account powering donations and
  //    affiliate payouts; it is the money root, and filing it beside Twilio
  //    would bury the screen's most consequential connection.
  //  • "Integrations" → "Connected Services". The region would otherwise carry
  //    the same word as one of the rows inside it (the Mailchimp row is labelled
  //    "Integrations"), and a heading that repeats its own child's label reads
  //    as a rendering bug. Renaming the ROW would have been the other fix, but
  //    that is visible copy on a phone.
  //  • Cancel is NOT in Account. See the Danger Zone note on that section.
  const sections = [
    {
      // Appearance is ungated — the theme is a per-user display preference, not
      // a plan feature, so it carries no `hidden` condition. Placed first
      // because it is the one section every admin can act on regardless of plan.
      id: 'appearance',
      label: 'Appearance',
      icon: <Palette size={18} />,
      group: 'Appearance',
      content: (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-strong">Colour theme</p>
            <p className="text-sm text-muted mt-0.5">
              Palette and light/dark, for your account on this device. System follows your device setting.
            </p>
          </div>
          {/* THE-183 — the palette family (Harvest / Classic) was reachable only
              from the member Profile, so an admin who never opens the member app
              could not select Classic at all. Same two components as the
              Profile's Appearance row, in the same wrapper: `flex items-center
              gap-2`, family on the LEFT and mode on the RIGHT, DOM order
              matching visual order so tab order agrees with reading order.

              Reused verbatim, not re-implemented and not re-sized. Both write
              their own localStorage key and both stamp <html> through
              applyTheme in lib/theme-runtime.ts — the ONE path THE-85
              consolidated to. Two UI copies of a control writing the same keys
              is fine; a second stamping path is not, and "no second stamping
              path exists" asserts that by enumerating the whole of src/.

              ThemeToggle moves from its `default` variant to `row` here: `row`
              is documented as the sizing for when the row holds two controls
              instead of one, which is now this row as well. That is also what
              brings the icon-only fallback with it — below `sm` (640px), and
              again from `xl` (1280px) up, where the Profile's settings column
              splits and available width stops growing with the viewport
              (THE-184). Admin Settings does not split at `xl`, so it has room
              for the labels there; it takes the fallback anyway because
              "match the member Profile exactly" is the requirement, and a
              per-caller breakpoint would be a second answer to one question. */}
          <div className="flex items-center gap-2">
            <PaletteFamilyToggle />
            <ThemeToggle variant="row" />
          </div>
        </div>
      ),
    },
    {
      id: 'payments',
      group: 'Payments',
      // 🔴 THE-246 — STRIPE CONNECT MOVED OUT OF SETTINGS. The founder: "Right
      // now to connect to Stripe I have to go into the settings. What I want
      // instead is to create... a donation section where you are going to put
      // Connect with Stripe."
      //
      // So this row is now a POINTER, not the panel. It keeps its id, its
      // group, its position in the array and its gate — nothing reorders on a
      // phone (THE-183's constraint) — and what changes is what is underneath
      // it. The label moves with the content: "Payments (Connect Stripe)" would
      // now name something this row no longer holds.
      //
      // ⚠️ ONE COMPONENT, NOT TWO. `PaymentSection` still has exactly one
      // definition and is mounted by AdminDonations (its new home) and by
      // AdminFundraising (unchanged, so the fundraising role keeps the path it
      // had). This screen no longer mounts it at all — it sends the admin to
      // the screen that does.
      label: 'Donations & payment links',
      icon: <CreditCard size={18} />,
      content: (
        <div className="space-y-3">
          <p className="text-sm text-body leading-relaxed">
            Connecting Stripe, and adding your own {GIVING_PROVIDER_NAMES_OR} links,
            now live together in <b className="text-strong">Donations</b>.
          </p>
          <button
            type="button"
            onClick={onOpenDonations}
            className={`inline-flex items-center gap-1.5 px-4 rounded-brand text-[13px] font-semibold text-white transition-opacity hover:opacity-90 ${CONTROL_DENSITY.action} py-2.5`}
            style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}
          >
            Open Donations
            <ChevronRight size={16} />
          </button>
        </div>
      ),
      // 🔴 THE-225's gate, unchanged — `fundraising`, the cell this row EXISTS
      // to serve. Stripe Connect is how a church is paid for donations; free
      // carries `fundraising: false`, so it has no donate page (the member Give
      // tab is gone, /campaign/[id] refuses and /api/stripe/donate 403s —
      // THE-202/THE-213). Connecting an account here would have configured a
      // payout destination for money that cannot arrive, and asked a church for
      // its bank details to do it. The founder has reported this three times.
      //
      // ⚠️ IT IS ALSO WHY THIS POINTER CANNOT DANGLE. AdminDashboard builds
      // `canDonations` from `planAllows(features?.fundraising)` and the same
      // manageSettings permission that lets this screen render at all — so
      // whenever this row is visible, the section it opens is too. The
      // dead-end proof is in `AdminSettings.donations-pointer.test.tsx`, which
      // walks the tiers through the real shell rather than comparing the two
      // expressions by eye.
      //
      // The section's other stated purpose — affiliate payouts, per the header
      // comment above — does not keep it alive on free: AFFILIATE_PROGRAM_ENABLED
      // is false, so every affiliate surface in the app is hidden on every tier.
      // If the programme comes back, this gate is the line that has to widen.
      //
      // Reads the FEATURE, not the tier, so nothing here has to be edited if a
      // future tier is sold without giving.
      hidden: !platformOverride && !currentFeatures?.fundraising,
    },
    {
      id: 'onboarding',
      group: 'Church Setup',
      label: 'Onboarding Questions',
      icon: <Settings2 size={18} />,
      content: <OnboardingSection />,
    },
    {
      id: 'giving-statements',
      group: 'Church Setup',
      label: 'Giving Statements',
      icon: <FileText size={18} />,
      content: <GivingStatementsSection />,
      hidden: !platformOverride && !currentFeatures?.givingStatements,
    },
    {
      id: 'sms',
      group: 'Connected Services',
      label: 'SMS (Twilio)',
      icon: <MessageSquare size={18} />,
      content: <SmsSection />,
      // 🔴 THE-250 — the row THE-245 could not reach. `SmsSection` already
      // renders `null` while SMS is hidden, so this label opened onto an empty
      // panel: a Connected Service that connects nothing, on a screen whose
      // whole job is to say what is connected.
      //
      // Master switch FIRST, exactly as the nav entry in AdminDashboard does
      // it — one idiom on this screen, not two. The switch is absolute and
      // ignores `platformOverride` because an override is a plan override, and
      // no tier can use a feature the server refuses with 503. (The AI Assistant
      // row that used to sit below this one, and set the same precedent, went
      // with the Telegram assistant in THE-253.)
      //
      // The plan clause behind it is UNTOUCHED and still reads the FEATURE, not
      // the tier, so flipping SMS_FEATURE_ENABLED restores the identical
      // entitlement — `smsAutomation` keeps its PLAN_FEATURES values throughout.
      hidden: !SMS_FEATURE_ENABLED || (!platformOverride && !currentFeatures?.smsAutomation),
    },
    {
      id: 'integrations',
      group: 'Connected Services',
      label: 'Integrations',
      icon: <Plug size={18} />,
      content: <IntegrationsSection currentPlan={currentPlan} platformOverride={platformOverride} />,
      // THE-193 — derived from the providers the section holds, not from a
      // hardcoded flag. It used to read `!currentFeatures?.newsletterAutomation`,
      // which hid Gmail — a CRM provider — from every tier without the
      // newsletter, so Individual's CRM "Connect your email" button routed here
      // and found nothing. Each provider now declares the feature it serves
      // (integration-providers.ts) and the section shows when any of them is
      // available. No plan flag changed.
      //
      // 🔴 THE-225 — the same derivation, now asked with the PLAN as well. Gmail
      // is entitled by `crm`, which free holds deliberately (its roster is half
      // of what the free tier is), so the feature cell alone could not withhold
      // it and this section rendered a Gmail card on a tier that pays nothing.
      // A provider that hands over a live outbound send is refused to a tier
      // that is not sold — see `outboundSend` in integration-providers.ts. Free
      // therefore has no available provider at all and this section disappears
      // on its own; the three priced tiers are unmoved, and no plan flag changed.
      hidden: !platformOverride && !hasAnyIntegrationProvider(currentFeatures, currentPlan),
    },
    {
      // THE-183 — the Danger Zone. A destructive action was sitting in the same
      // flat run as a colour preference; it is now the only row in its own
      // region, which SettingsAccordion draws behind a hairline rule with a
      // full section gap of padding above it, under a danger-toned heading.
      //
      // It stays exactly where it was in the array. The founder's requirement
      // is that Cancel is SEPARATED, explicitly "not merely last" — separation
      // is the property, being last is not — and every alternative placement
      // meant reordering rows on a phone, which is not allowed here. So it
      // moves nowhere and gains the separation instead. That also keeps it out
      // of the Account region, where "plan, billing, cancel" would have put a
      // destructive action back beside the two benign things it is most likely
      // to be misclicked for.
      id: 'cancel-plan',
      group: 'Danger Zone',
      label: 'Cancel Subscription',
      icon: <AlertTriangle size={18} />,
      content: (
        <div>
          <p className="text-muted text-sm mb-4">Cancel your subscription. Your ministry will remain active until the end of the current billing period.</p>
          {/* Rules 3 and 4 on the action. The red-* classes are pre-existing and
              deliberately untouched: they are literal palette colours rather
              than the `text-danger` token the row header already uses, but
              changing them repaints this button in every palette — a mobile
              change, and a theming fix rather than a layout one. Reported, not
              bundled. */}
          <button
            onClick={() => setShowCancelConfirm(true)}
            className={`px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
          >
            Cancel Subscription
          </button>
        </div>
      ),
      // 🔴 Hidden for a tier with no subscription as well as for a super admin:
      // there is nothing to cancel, and the button's only outcome is the
      // portal route's "please subscribe first".
      hidden: !hasSubscription,
      danger: true,
    },
  ];

  return (
    <div className={`space-y-6 ${CONTROL_DENSITY.sectionGap} px-4 lg:px-0 ${FORM_MEASURE}`}>
      {/* Mobile side gutter (px-4) to match the mockup's card margins. Desktop is
          unchanged — lg:px-0 is a no-op and the shell already pads with lg:p-6. */}
      {/* THE-183, Rule 1b — the form measure, replacing an unqualified
          `max-w-2xl mx-auto`.

          `max-w-2xl` is 42rem, and globals.css trims the rem base to 14.5px
          from 1024px up, so on a monitor it resolved to 609px — not the 672px
          the class name suggests. Measured in Chromium in the real admin shell
          at 1440px, the content box is 1164.5px (1440 − a 232px `lg:w-64`
          sidebar − 21.75px of `lg:p-6` either side), which left 277.75px of
          dead space on EACH side of a 609px column. That is the founder's
          "narrow column with large empty regions either side", and it is
          exactly the split-rem-base trap form-layout.ts documents.

          FORM_MEASURE (940px, in px so the number in the class is the number on
          screen at every viewport) is Rule 1b — a form's measure, not
          FORM_CONTAINER's 1120px page measure. Settings is a stack of controls
          a person acts on one at a time, not a data-dense page, so 1b is the
          rule that applies. It is `sm:`-gated, so nothing below 640px moves:
          `max-w-2xl` was 672px there and never bound a phone either.

          `space-y-6` (24px) stays for mobile and Rule 4's sectionGap (28px)
          takes over from `sm:` up, so the regions below get the settled rhythm
          rather than the 21.75px `space-y-6` collapses to at the desktop rem
          base. */}
      {/* Desktop page header (Platform eyebrow + Settings title). Hidden on mobile:
          the shell's AdminScreenHeader already renders "Settings", so an in-content
          title would duplicate it (same convention as the Accounting rebuild). The
          mobile settings surface starts at the plan card, per the mockup. */}
      <div className="hidden lg:block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold mb-1.5">Platform</p>
        <h2 className="font-display text-[1.75rem] lg:text-[2rem] leading-[1.1] font-light tracking-[-0.02em] text-strong">Settings</h2>
      </div>

      {/* Stripe status banners */}
      {stripeStatus === 'success' && (
        <div className="bg-field-100 border border-field-200 rounded-xl p-4 flex items-center gap-3 mb-4">
          <Check size={20} className="text-field-600" />
          <div>
            <p className="text-sm font-semibold text-field-700">Payment successful!</p>
            <p className="text-xs text-field-600">Your plan has been updated. It may take a moment to reflect.</p>
          </div>
          <button onClick={() => setStripeStatus(null)} className="ml-auto text-field-600 hover:text-field-700">✕</button>
        </div>
      )}
      {stripeStatus === 'cancel' && (
        <div className="bg-wheat-50 border border-wheat-200 rounded-xl p-4 flex items-center gap-3 mb-4">
          <AlertTriangle size={20} className="text-wheat-600" />
          <div>
            <p className="text-sm font-semibold text-wheat-700">Checkout cancelled</p>
            <p className="text-xs text-wheat-600">No charges were made. You can try again anytime.</p>
          </div>
          <button onClick={() => setStripeStatus(null)} className="ml-auto text-wheat-600 hover:text-wheat-700">✕</button>
        </div>
      )}

      {/* Account — the plan and the billing portal behind "Manage". The one
          region that is not an accordion, so its heading is rendered here
          rather than by SettingsAccordion. Cancel Subscription is deliberately
          NOT in this region: see the Danger Zone note on the sections array. */}
      <div>
        <SectionHeading className="sm:mb-2.5">Account</SectionHeading>
      {currentPlan ? (
        <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-4 flex items-center gap-4">
          <span className="w-11 h-11 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] flex items-center justify-center shrink-0">
            <DollarSign size={20} className="text-gold" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-strong">{currentPlanData?.name || 'Current'} plan</p>
            <p className="text-xs text-muted">{planSummary}</p>
          </div>
          {/* Absent for a tier with no subscription — see `hasSubscription`.
              No upgrade action is minted here in its place: this screen has no
              route to the plan cards, and the two surfaces that DO (Billing and
              the upgrade page) each offer one. Inventing a third navigation
              here would be a new flow, not a fix. */}
          {hasSubscription && (
            <button
              data-testid="settings-manage-action"
              onClick={handleManageSubscription}
              className={`shrink-0 px-4 py-2 rounded-brand border border-line bg-surface-raised text-[13px] font-semibold text-strong hover:bg-surface-sunken transition-colors ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
            >
              Manage
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-4 flex items-center gap-4">
          <span className="w-11 h-11 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] flex items-center justify-center shrink-0">
            <Crown size={20} className="text-gold" />
          </span>
          <div>
            <p className="text-sm font-semibold text-strong">Super Admin</p>
            <p className="text-xs text-muted">Platform-wide access — manage all tenants</p>
          </div>
        </div>
      )}
      </div>

      {/* Accordion Sections */}
      <SettingsAccordion sections={sections} forceOpen={forceOpen} />

      {/* Navigation — the bottom-bar / More-drawer reorder tool. It keeps the
          position it has always had, after the accordion, because moving it
          would reorder the page on a phone and mobile is not allowed to move.
          That leaves it below the Danger Zone; see the note on the sections
          array for why "separated" and "last" are not the same requirement. */}
      {onCustomizeNav && (
        <div>
        <SectionHeading className="sm:mb-2.5">Navigation</SectionHeading>
        <button
          onClick={onCustomizeNav}
          className="w-full flex items-center gap-3 px-5 py-4 bg-surface-raised rounded-brand border border-line shadow-[var(--ds-sh-sm)] hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors text-left"
        >
          <SlidersHorizontal size={18} className="text-gold shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-strong">Customize Navigation</p>
            <p className="text-xs text-faint">Rearrange your bottom bar &amp; More drawer</p>
          </div>
          <ChevronRight size={16} className="text-faint" />
        </button>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-surface-raised rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-strong font-display">Cancel Subscription?</h3>
            </div>
            <p className="text-muted text-sm mb-6">
              Your ministry will remain active until the end of the current billing period. After that, all data will be preserved but your ministry will be suspended.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCancelConfirm(false)} className="px-4 py-2 text-muted rounded-xl text-sm font-medium hover:bg-surface-sunken transition-colors">
                Keep Plan
              </button>
              <button onClick={() => { handleManageSubscription(); setShowCancelConfirm(false); }} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors">
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// Display constants (needed for current plan summary).
//
// 🔴 The NAME and the PRICE are derived; only the swatch colour is typed. Both
// carried literals — `$49` / `$99` / `$199` — and both went stale at the
// reprice, so the plan summary quoted a price the church was not paying. Colour
// has nothing in the price table to derive from, so it stays written down.
const PLAN_SWATCH: Record<TenantPlan, string> = {
  // Neutral grey — the paid swatches (indigo / gold / bronze) are a value
  // ladder and free is not a rung on it.
  free: '#64748b',
  plus: '#6366f1',
  pro: '#d4a017',
  max: '#b45309',
};

/** Shape of a plan summary row. Annotated rather than inferred: the array is
 *  declared at the foot of the file and read from a component above it, and an
 *  inferred type would not be available at that use site. */
interface PlanDisplayRow {
  id: TenantPlan;
  name: string;
  monthlyPrice: string;
  icon: typeof Crown;
  color: string;
}

const PLANS_DISPLAY: PlanDisplayRow[] = PLAN_ORDER.map((id) => ({
  id,
  name: PLAN_DISPLAY_NAMES[id],
  monthlyPrice: formatPlanPrice(id, 'monthly'),
  icon: Crown,
  color: PLAN_SWATCH[id],
}));

export default AdminSettings;
