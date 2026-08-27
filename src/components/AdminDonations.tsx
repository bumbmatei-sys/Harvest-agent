"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { notifyError } from '../utils/notify';
import { getTenantId } from './settings/useTenantId';
import PaymentSection from './settings/PaymentSection';
import { AdminCard, AdminPageHeader, AdminPrimaryButton, AdminSectionLabel } from './admin/AdminUI';
import { ProviderMark } from './donations/GivingLinks';
import {
  GIVING_PROVIDERS,
  MAX_GIVING_EMAIL_LENGTH,
  MAX_GIVING_HANDLE_LENGTH,
  MAX_GIVING_URL_LENGTH,
  buildGivingLinkRecord,
  givingUrlRejectionMessage,
  isGivingEmailAcceptable,
  validateGivingUrl,
  type GivingLinkRecord,
  type GivingProvider,
  type GivingProviderId,
} from './donations/giving-providers';
import { CONTROL_DENSITY, FIELD_WIDTH, FORM_MEASURE, READING_MEASURE } from './layout/form-layout';

/**
 * THE-246 — Donations. The one admin screen about money coming IN.
 *
 * ─── Where this lives, and why here ─────────────────────────────────────────
 *
 * The founder: "Right now to connect to Stripe I have to go into the settings.
 * What I want instead is to create, in the Featured tab or sidebar depending, a
 * donation section where you are going to put Connect with Stripe."
 *
 * ⚠️ THERE IS NO "FEATURED" TAB in the admin nav — that premise is drift. The
 * nav is Dashboard, then four sidebar groups (CONTENT · MINISTRY ·
 * BROADCASTING · GROW), then Settings. So this is a section in the MINISTRY
 * group, directly after Fundraising: MINISTRY is already where giving lives,
 * and campaigns are the thing that spends what this screen configures.
 *
 * 🔴 GATED ON `fundraising` VIA `planAllows`, NOT `navAllows` — one of only two
 * entries in AdminDashboard where the nav clause and the render clause are the
 * same expression (Branding is the other). Free carries `fundraising: false`
 * and has no donate page by decision, so a visible-but-walled Donations tab
 * would be the exact surface THE-225 removed from Settings: a Connect button
 * asking a church for its bank details to receive money that cannot arrive.
 *
 * ─── 🔴 Harvest is not in the manual-links flow at all ──────────────────────
 *
 * Stripe and the links below are NOT two versions of the same thing, and the
 * copy on this screen exists to stop a church believing they are. A Stripe gift
 * is recorded, receipted and counted into a year-end giving statement. A PayPal
 * link is a link: Harvest never sees the money, takes no fee, carries no
 * liability, and cannot put it on any statement. A church that discovers that
 * distinction in January, from a member asking where their receipt is, has been
 * failed by this screen.
 *
 * ─── THE-249 — the third gap, and the one remedy that exists ────────────────
 *
 * THE-246 stated two of the three: no receipt, no statement. The third is the
 * CRM, and it is the one a church hits first. `contacts.totalDonated`,
 * `lastDonationAt` and the derived pipeline stage are written by exactly two
 * things — the Stripe donation webhook (`src/lib/donation-webhook.ts`) and the
 * CRM's own `donation` activity — so a member who gives by PayPal stays on $0
 * and on the Member stage forever. A church that adds a link, watches gifts
 * arrive and then opens the CRM concludes the CRM is broken.
 *
 * ⚠️ The remedy EXISTS and is named here rather than gestured at: AdminCRM's
 * Add Activity → Donation increments `totalDonated` and stamps
 * `lastDonationAt`. It is reachable from every tier that can reach this screen
 * — both gate on `fundraising` (`showGiving` in AdminCRM), so there is no tier
 * that can paste a link and cannot record the gift.
 *
 * 🔴 It fixes the CRM and NOTHING ELSE. Giving statements are built from
 * `tenants/{id}/invoices` where `type === 'donation_receipt'`, and the only
 * writer of those is the Stripe donation webhook. No admin surface writes one,
 * so no manual entry can put a gift on a statement. The copy below says that
 * out loud instead of letting "record it manually" read as a fix for all three.
 */

/** The draft an admin is editing — strings, exactly as typed. */
type Draft = Record<GivingProviderId, { url: string; handle: string; email: string }>;

const emptyDraft = (): Draft =>
  GIVING_PROVIDERS.reduce((acc, p) => {
    acc[p.id] = { url: '', handle: '', email: '' };
    return acc;
  }, {} as Draft);

const draftFromRecord = (record: GivingLinkRecord | undefined): Draft => {
  const draft = emptyDraft();
  if (!record) return draft;
  for (const provider of GIVING_PROVIDERS) {
    const stored = record[provider.id];
    if (!stored) continue;
    draft[provider.id] = {
      url: stored.url ?? '',
      handle: stored.handle ?? '',
      email: stored.email ?? '',
    };
  }
  return draft;
};

const FIELD_CLASS =
  `w-full px-3 py-2.5 rounded-brand border border-line bg-surface-raised text-sm text-strong ` +
  `placeholder:text-faint focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] ` +
  `focus:border-transparent outline-none transition-all ${CONTROL_DENSITY.control}`;

const LABEL_CLASS = `block text-xs font-semibold text-muted ${CONTROL_DENSITY.labelGap}`;

/** One provider's three fields. Rendered from the table — never per provider. */
const ProviderFields: React.FC<{
  provider: GivingProvider;
  value: { url: string; handle: string; email: string };
  urlError: string | null;
  emailError: string | null;
  onChange: (field: 'url' | 'handle' | 'email', next: string) => void;
}> = ({ provider, value, urlError, emailError, onChange }) => (
  <div className="px-5 py-4 border-t border-line first:border-t-0">
    <div className="flex items-center gap-3 mb-3">
      <ProviderMark provider={provider} size={36} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-strong">{provider.label}</p>
        <p className="text-xs text-faint">
          {provider.hasPersonalLink
            ? `Link must be on ${provider.hosts.join(' or ')}`
            : /* Zelle. Asking a church for a URL that does not exist is how a
                 field gets filled in with something wrong. */
              'Zelle has no personal link — members send to the email or name below'}
        </p>
      </div>
    </div>
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${CONTROL_DENSITY.rowGap} ${CONTROL_DENSITY.columnGap}`}>
      <div className={`sm:col-span-2 ${FIELD_WIDTH.long}`}>
        <label className={LABEL_CLASS} htmlFor={`giving-${provider.id}-url`}>
          {provider.label} link
        </label>
        <input
          id={`giving-${provider.id}-url`}
          type="url"
          inputMode="url"
          maxLength={MAX_GIVING_URL_LENGTH}
          value={value.url}
          onChange={(e) => onChange('url', e.target.value)}
          placeholder={provider.urlExample}
          className={FIELD_CLASS}
          aria-invalid={!!urlError}
          aria-describedby={urlError ? `giving-${provider.id}-url-error` : undefined}
        />
        {urlError && (
          <p id={`giving-${provider.id}-url-error`} role="alert" className="text-xs text-red-600 mt-1.5">
            {urlError}
          </p>
        )}
      </div>
      <div className={FIELD_WIDTH.medium}>
        <label className={LABEL_CLASS} htmlFor={`giving-${provider.id}-handle`}>
          {provider.handleLabel}
        </label>
        <input
          id={`giving-${provider.id}-handle`}
          type="text"
          maxLength={MAX_GIVING_HANDLE_LENGTH}
          value={value.handle}
          onChange={(e) => onChange('handle', e.target.value)}
          placeholder={provider.handleExample}
          className={FIELD_CLASS}
        />
      </div>
      <div className={FIELD_WIDTH.long}>
        <label className={LABEL_CLASS} htmlFor={`giving-${provider.id}-email`}>
          Email on this account
        </label>
        <input
          id={`giving-${provider.id}-email`}
          type="email"
          inputMode="email"
          maxLength={MAX_GIVING_EMAIL_LENGTH}
          value={value.email}
          onChange={(e) => onChange('email', e.target.value)}
          placeholder="giving@yourchurch.org"
          className={FIELD_CLASS}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? `giving-${provider.id}-email-error` : undefined}
        />
        {emailError && (
          <p id={`giving-${provider.id}-email-error`} role="alert" className="text-xs text-red-600 mt-1.5">
            {emailError}
          </p>
        )}
      </div>
    </div>
  </div>
);

const AdminDonations: React.FC = () => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tid = await getTenantId();
        if (cancelled) return;
        setTenantId(tid);
        if (!tid) { setLoadState('error'); return; }
        const { doc, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'tenants', tid));
        if (cancelled) return;
        setDraft(draftFromRecord(snap.exists() ? snap.data()?.config?.givingLinks : undefined));
        setLoadState('ready');
      } catch (e) {
        // 🔴 The silent-failure rule. A read that fails must not resolve into an
        // empty form: an admin who then presses Save would overwrite links they
        // still have with the blank ones this screen invented.
        if (cancelled) return;
        console.error('Failed to load payment links:', e);
        setLoadState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((id: GivingProviderId, field: 'url' | 'handle' | 'email', next: string) => {
    setSaved(false);
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [field]: next } }));
  }, []);

  /** Live validation, per provider — the same rules the save and the read use. */
  const errors = useMemo(() => {
    const out: Record<string, { url: string | null; email: string | null }> = {};
    for (const provider of GIVING_PROVIDERS) {
      const value = draft[provider.id];
      const urlResult = validateGivingUrl(value.url, provider);
      out[provider.id] = {
        // An EMPTY url is not an error — a provider reached by email alone is
        // the Zelle case, and the whole point of the three fields.
        url: value.url.trim() && !urlResult.ok
          ? givingUrlRejectionMessage(urlResult.reason, provider)
          : null,
        email: isGivingEmailAcceptable(value.email) ? null : 'That is not an email address.',
      };
    }
    return out;
  }, [draft]);

  const hasErrors = GIVING_PROVIDERS.some((p) => errors[p.id].url || errors[p.id].email);

  const handleSave = async () => {
    if (!tenantId || hasErrors) return;
    setSaving(true);
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      // Re-validated on the way in, exactly as `readGivingLinks` re-validates on
      // the way out. A dotted path so nothing else on `config` is touched —
      // the same write shape OnboardingSection uses, and the same one
      // firestore.rules already governs (manageSettings / manageBranding).
      await updateDoc(doc(db, 'tenants', tenantId), {
        'config.givingLinks': buildGivingLinkRecord(draft),
      });
      setSaved(true);
    } catch (e) {
      // Never swallowed: a PERMISSION_DENIED here is the difference between
      // "saved" and "looked saved".
      notifyError('Could not save your payment links', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${FORM_MEASURE} ${CONTROL_DENSITY.sectionGap} space-y-7`}>
      <AdminPageHeader
        eyebrow="Donations"
        title="How your church gets paid"
        subtitle="Connect Stripe to take card gifts inside the app, and add your own payment links for everything else."
      />

      {/* ── Stripe ───────────────────────────────────────────────────────────
          🔴 THE SAME COMPONENT SETTINGS AND FUNDRAISING MOUNT, not a second
          copy of it. Stripe Connect state lives in one place; a screen that
          re-implemented the status badge would be a second answer to "are we
          connected", and the two would disagree the first time one was edited. */}
      <AdminCard>
        <div className="px-5 py-4 border-b border-line">
          <AdminSectionLabel>Stripe</AdminSectionLabel>
          <p className="text-sm text-muted mt-1.5">
            Card and bank gifts, taken inside the app. Harvest records every gift, sends
            the receipt, and includes it on your year-end giving statements.
          </p>
        </div>
        <div className="px-5 py-4">
          <PaymentSection />
        </div>
      </AdminCard>

      {/* ── The church's own payment links ─────────────────────────────────── */}
      <AdminCard>
        <div className="px-5 py-4 border-b border-line">
          <AdminSectionLabel>Your own payment links</AdminSectionLabel>
          <p className="text-sm text-muted mt-1.5">
            Paste the links your ministry already uses. They appear on your Give page with
            your username, and open in the app your members already have.
          </p>
        </div>

        {/*
          🔴 THE TWO THINGS A CHURCH MUST BE TOLD BEFORE IT PASTES A LINK.
          Above the fields, not under them: a warning a person reads after they
          have finished is a warning that did not work.
        */}
        <div className={`px-5 py-4 border-b border-line ${READING_MEASURE} lg:mx-0`}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-gold shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-body leading-relaxed space-y-2">
              <p>
                <b className="text-strong">Harvest does not process these gifts.</b> The money
                goes straight from your member to your own PayPal, Cash App, Venmo or Zelle
                account. There is no Harvest fee, no Harvest receipt, and nothing for Harvest
                to refund or dispute — these accounts are yours, and so is everything that
                happens in them.
              </p>
              <p>
                <b className="text-strong">
                  Gifts given this way will not appear on giving statements.
                </b>{' '}
                Harvest never sees them, so they are missing from donation history, from a
                member&apos;s receipts, and from every year-end statement you generate. Only
                gifts given through Stripe are recorded and receipted.
              </p>
              <p>
                <b className="text-strong">Your CRM will not record them either.</b> A member
                who gives this way keeps a total given of $0, no last-gift date and the Member
                stage &mdash; the same as someone who has never given. To record one, open the
                contact in your CRM, press Add Activity, choose Donation and enter the amount:
                that adds to their total given and dates the gift. It does not put the gift on
                a giving statement, and nothing else does either &mdash; statements are built
                from Stripe gifts alone.
              </p>
            </div>
          </div>
        </div>

        <div className={`px-5 py-3 border-b border-line ${READING_MEASURE} lg:mx-0`}>
          <div className="flex items-start gap-2.5">
            <Info size={16} className="text-faint shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-muted leading-relaxed">
              Everything you enter here is shown publicly on your Give page, including the
              email addresses — that is how a member sends to the right account. Use an
              address you are happy to publish.
            </p>
          </div>
        </div>

        {loadState === 'loading' ? (
          <div className="px-5 py-8 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> Loading your payment links…
          </div>
        ) : loadState === 'error' ? (
          /* 🔴 "Could not load" is not "you have none". Showing an empty form
             here would invite an admin to Save over links they still have. */
          <div className="px-5 py-8" role="alert">
            <p className="text-sm font-semibold text-strong">We could not load your payment links.</p>
            <p className="text-sm text-muted mt-1">
              Nothing has been changed. Reload the page to try again — do not re-enter them
              until this screen can show you what is already saved.
            </p>
          </div>
        ) : (
          <>
            {GIVING_PROVIDERS.map((provider) => (
              <ProviderFields
                key={provider.id}
                provider={provider}
                value={draft[provider.id]}
                urlError={errors[provider.id].url}
                emailError={errors[provider.id].email}
                onChange={(field, next) => update(provider.id, field, next)}
              />
            ))}
            <div className="px-5 py-4 border-t border-line flex items-center gap-3">
              <AdminPrimaryButton onClick={handleSave} disabled={saving || hasErrors}>
                {saving ? 'Saving…' : 'Save payment links'}
              </AdminPrimaryButton>
              {hasErrors && (
                <span className="text-xs text-red-600">Fix the errors above before saving.</span>
              )}
              {!hasErrors && saved && <span className="text-xs text-muted">Saved.</span>}
            </div>
          </>
        )}
      </AdminCard>
    </div>
  );
};

export default AdminDonations;
