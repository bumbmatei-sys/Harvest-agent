"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { getTenantIdFromHost } from '../../utils/tenant-scope';
import CountrySelect from '../CountrySelect';
import { CONTROL_DENSITY, FIELD_WIDTH } from '../layout/form-layout';
import {
  isRecordableCountry,
  recordDismissal,
  saveMemberCountry,
  shouldPromptForCountry,
} from '../../lib/member-country';

/**
 * THE-292 — the optional, dismissible "where are you joining us from?" card.
 *
 * The decision, the write and the dismissal policy all live in
 * `lib/member-country.ts`, which carries the reasoning. This file is the
 * surface: where it is mounted, what it says, and how it clears the chrome.
 *
 * ═══ 🔴 WHERE IT IS MOUNTED, AND WHY THAT IS THE TICKET ══════════════════════
 *
 * Mounted TWICE in `App.tsx`, as a self-gating sibling — once beside
 * `<AdminDashboard/>` inside `adminElement`, once beside `<MainApp/>` in the
 * '/' route element. Both sit inside `<Routes>`, inside `<OnboardingGate>`.
 * That placement is doing four things at once:
 *
 *   🔴 POST-HOP. `getTenantIdFromHost()` must be non-null, so this can only
 *      render on `<tenant>.theharvest.app` — after the origin hop and the second
 *      sign-in it forces (App.tsx:419-429, THE-138). A card shown before the hop
 *      is a card the member never finishes.
 *   🔴 POST-FUNNEL. `<OnboardingGate>` renders its children only once it
 *      resolves to 'ready'. '/onboarding' and '/church-onboarding' are OTHER
 *      routes and do not mount this, so a congregant who is about to be asked
 *      for their country by the onboarding form is never asked here as well.
 *   🔴 NOTHING IN THE FUNNEL MOVES. This is a sibling inside two existing route
 *      elements. No route is added, none is reordered, and `FUNNEL_PATHS`,
 *      `resolvePostAuthFunnelRoute`, `signupInProgress`, `termsAccepted`, the
 *      paid-arrival hold and Turnstile's mount are all untouched — the same
 *      discipline, and the same mount point, THE-255 used for
 *      `PostOnboardingInstallStep`.
 *   ⚠️ BOTH SURFACES, ONE COMPONENT. The structural gap is the owner, who lands
 *      on '/admin'; a congregant of a tenant that dropped `default_country` from
 *      its questions has the same empty field and lands on '/'. One component,
 *      one condition, two mounts — and `AdminDashboard.tsx` is not opened to do
 *      it, because the mount point is in `App.tsx`.
 *
 * ═══ Layering and clearance ══════════════════════════════════════════════════
 *
 * 🔴 The bottom nav is `fixed bottom-0 … z-[100]` in BOTH shells
 * (MainApp.tsx:649, and the admin shell's equivalent). `ui/dialog.tsx` and
 * `ui/sheet.tsx` ship at `z-50` — UNDER it — so this layers explicitly instead:
 * scrim `z-[101]`, panel `z-[102]`, the pairing #427 established for the giving
 * share sheet.
 *
 * ⚠️ `pb-safe` IS NOT CLEARANCE. THE-286 measured it against the real config and
 * it compiles to NOTHING — this repo defines no such utility, so the nav
 * reserves no home-indicator inset. Nothing here depends on it: the overlay adds
 * `env(safe-area-inset-bottom)` itself, so the card is clear of the indicator
 * whether or not `pb-safe` ever starts resolving.
 *
 * ═══ 🔵 The copy is optional and reads as optional ═══════════════════════════
 *
 * "Help us show where your church family is" is honest; "required" is false.
 * There is no asterisk, no "please complete your profile", and the way out is a
 * labelled button rather than a corner glyph. The eyebrow says "Optional" before
 * the heading is read.
 *
 * ⚠️ The scrim is deliberately INERT — no click-to-dismiss. A member has three
 * asks in total (see the dismissal policy) and a stray tap on the backdrop
 * should not spend one of them.
 */

/** 🔴 44px touch floor below `sm`; Rule 4's settled desktop band above it. */
const CONTROL_HEIGHT = `min-h-[44px] sm:min-h-[38px] ${CONTROL_DENSITY.control}`;
const ACTION_HEIGHT = `min-h-[44px] sm:min-h-[40px] ${CONTROL_DENSITY.action}`;

/**
 * The overlay's own bottom budget, safe-area inset included.
 *
 * 🔴 Explicit, for the reason in the header: `pb-safe` emits no rule in this
 * repo, so a card that trusted it would sit under the home indicator on a
 * notched phone. 40px is the overlay's ordinary gutter; `env()` is the part
 * that is load-bearing. Measured at 380×844 rather than trusted.
 */
export const OVERLAY_CLEARANCE = 'pb-[calc(40px+env(safe-area-inset-bottom))]';

/** 🔵 One place for the wording, so a test reads what a member reads. */
export const COUNTRY_PROMPT_COPY = {
  eyebrow: 'Optional',
  heading: 'Where are you joining us from?',
  body: 'Add your country and your church can see where its family is spread across the world. You can change or remove it any time from your profile.',
  save: 'Save country',
  dismiss: 'Not now',
} as const;

/** What the open prompt needs in order to paint. No I/O, no gating. */
export interface CountryPromptSurfaceProps {
  readonly country: string;
  readonly onChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onDismiss: () => void;
  readonly saving: boolean;
  readonly error: string | null;
}

/**
 * The card itself, split out from the gate above it.
 *
 * ⚠️ Not an abstraction for its own sake — it is what makes the LAYOUT
 * measurable. `THE-292.country-prompt.layout.test.tsx` renders this to static
 * markup and measures it in real Chromium against the real compiled stylesheet;
 * the gated component renders `null` until an async auth callback and a
 * Firestore read have both resolved, which `renderToStaticMarkup` never runs. So
 * the alternative to this split is a layout test that measures a hand-typed copy
 * of these classes, which is the drift `browser-measure.ts` exists to end.
 *
 * The behaviour suite drives the real `<CountryPrompt/>`, not this — so nothing
 * about the gate is tested through a seam.
 */
export const CountryPromptSurface: React.FC<CountryPromptSurfaceProps> = ({
  country, onChange, onSave, onDismiss, saving, error,
}) => (
  <>
    {/* Scrim — z-[101], directly above the bottom nav's z-[100]. The modal
        backdrop token, not a hardcoded black: --scrim-night is redefined by
        the dark and Classic blocks, so it is the right depth in all four
        palettes from one declaration. Inert by design — see the header. */}
    <div
      data-testid="country-prompt-scrim"
      className="fixed inset-0 z-[101]"
      style={{ backgroundColor: 'var(--scrim-night)' }}
    />
    <div
      data-testid="country-prompt-layer"
      className={`fixed inset-0 z-[102] flex items-center justify-center overflow-y-auto px-5 pt-10 ${OVERLAY_CLEARANCE}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="country-prompt-heading"
        data-testid="country-prompt"
        className={`w-full ${FIELD_WIDTH.long} rounded-brand-xl border border-line bg-surface-raised p-6 shadow-[var(--ds-sh-md)]`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.19em] text-gold">
          {COUNTRY_PROMPT_COPY.eyebrow}
        </div>
        <h2
          id="country-prompt-heading"
          className="mt-2 font-display text-xl font-light tracking-[-0.02em] text-strong"
        >
          {COUNTRY_PROMPT_COPY.heading}
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-body">
          {COUNTRY_PROMPT_COPY.body}
        </p>

        {/* `relative z-50` so the dropdown opens over the card's own content,
            exactly as the two existing country fields do. The panel's z-[102]
            is what keeps the whole thing over the nav. */}
        <div className={`relative z-50 mt-5 ${CONTROL_DENSITY.labelGap}`}>
          <label
            htmlFor="country-prompt-select"
            className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-faint"
          >
            Country
          </label>
          <CountrySelect
            value={country}
            onChange={onChange}
            className="w-full"
            buttonClassName={CONTROL_HEIGHT}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">{error}</p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onSave}
            disabled={!isRecordableCountry(country) || saving}
            data-testid="country-prompt-save"
            className={`w-full rounded-brand-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-none sm:px-8 ${ACTION_HEIGHT}`}
          >
            {saving ? 'Saving…' : COUNTRY_PROMPT_COPY.save}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            data-testid="country-prompt-dismiss"
            className={`w-full rounded-brand-lg border border-line px-5 text-sm font-semibold text-body transition-colors hover:bg-surface-sunken sm:flex-none sm:px-8 ${ACTION_HEIGHT}`}
          >
            {COUNTRY_PROMPT_COPY.dismiss}
          </button>
        </div>
      </div>
    </div>
  </>
);

const CountryPrompt: React.FC = () => {
  const [uid, setUid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Decide once, when the member's document resolves.
   *
   * ⚠️ The read is skipped entirely off the tenant subdomain, so the apex pays
   * nothing for a card it can never show.
   */
  useEffect(() => {
    if (getTenantIdFromHost() === null) return;
    let cancelled = false;

    const stop = onAuthStateChanged(auth, async (user) => {
      if (cancelled || !user) return;
      setUid(user.uid);
      let existing: unknown;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        // A document that failed to read is not a document with no country —
        // #194's tri-state discipline. Only a resolved read decides.
        if (!snap.exists()) return;
        existing = snap.data()?.country;
      } catch {
        return;
      }
      if (cancelled) return;
      if (shouldPromptForCountry({
        tenantIdFromHost: getTenantIdFromHost(),
        uid: user.uid,
        country: existing,
      })) {
        setOpen(true);
      }
    });

    return () => { cancelled = true; stop(); };
  }, []);

  const dismiss = useCallback(() => {
    if (uid) recordDismissal(uid);
    setOpen(false);
  }, [uid]);

  const save = useCallback(async () => {
    if (!uid || !isRecordableCountry(country) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveMemberCountry(uid, country);
      setOpen(false);
    } catch {
      // 🔴 Said out loud rather than logged. A member who tapped Save and saw
      // the card sit there would have no way to tell it had failed.
      setError('That could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [uid, country, saving]);

  if (!open) return null;

  return (
    <CountryPromptSurface
      country={country}
      onChange={setCountry}
      onSave={save}
      onDismiss={dismiss}
      saving={saving}
      error={error}
    />
  );
};

export default CountryPrompt;
