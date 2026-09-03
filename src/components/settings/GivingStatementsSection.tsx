"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CONTROL_DENSITY } from '../layout/form-layout';
import { useAutosaveField, type AutosaveStatus } from './autosave';

/**
 * THE-286 — the proof section for the settings chrome and autosave.
 *
 * ─── Why this section and not another ────────────────────────────────────────
 *
 * It is the only candidate with NO reason to be difficult. Three plain text
 * fields, all of them descriptive text on a tax receipt: no money moves, nothing
 * is destroyed, no credential is entered, no feature switch stands in front of
 * it, and `AdminSettings` is its single mount — so converting it cannot reach a
 * second screen. `BrandingSection` fails that last test three times over (it is
 * mounted by AdminBranding AND by FirstRunSetup, so a change here lands in
 * first-run onboarding), and it carries a colour input that fires continuously
 * while dragged plus a `refreshBranding()` that repaints the whole app —
 * neither of which is a good first thing to put behind an autosave. `SmsSection`
 * renders `null` while SMS_FEATURE_ENABLED is false, so it can prove nothing.
 *
 * ─── 🔴 What "inherits the chrome" means here, concretely ────────────────────
 *
 * This file used to draw its OWN card — `bg-surface-raised rounded-2xl border
 * border-line-subtle p-6` — inside the accordion row, which already draws
 * `bg-surface-raised rounded-brand border border-line shadow-[…]`. Two nested
 * cards, two radii, two borders, for one panel. It also spelled its own input
 * chrome (`px-4 py-2.5 border border-line rounded-xl focus:ring-gold`) three
 * times and its own success colour (`text-green-600`).
 *
 * None of that is spelled here now. The card is the accordion row's,
 * the field chrome is the installed `field`/`input`/`textarea` primitives, and
 * the density is Rule 4's. What is left in this file is the three fields and
 * what they mean — which is the whole point of doing the chrome slice first:
 * the other twelve sections are the same deletion, not the same design work.
 *
 * ⚠️ The one dimension this file still spells is its BOTTOM CLEARANCE, and that
 * is deliberate — see {@link NAV_CLEARANCE}.
 */

const DEFAULT_FOOTER = 'No goods or services were provided in exchange for these contributions.';

/**
 * Clearance for the bottom nav, INCLUDING the safe-area inset.
 *
 * 🔴 The inset is the point. The nav is `fixed bottom-0` at `z-[100]`, and the
 * class it carries for the notch is `pb-safe` — which THIS REPO DOES NOT
 * DEFINE. Compiled against the real config, `pb-safe` emits no rule at all
 * (`pb-[calc(…env(safe-area-inset-bottom))]` does, and is what is used here).
 * So the nav does not in fact reserve the ~34px a notched phone takes, and a
 * section that budgeted for the nav alone would have its last field sitting
 * under the home indicator.
 *
 * ⚠️ Reported rather than fixed here: defining a `pb-safe` utility would change
 * the height of the bottom nav on every admin screen at once, which is not this
 * slice's change to make. What this section does instead is stop DEPENDING on
 * it — the inset is added explicitly, so this panel is correct whether or not
 * `pb-safe` ever starts resolving.
 *
 * 120px is the budget this file already spent (as an inline
 * `style={{ paddingBottom: 120 }}`), kept so nothing regresses; `env()` is the
 * part that is new. Measured at 380×844 in
 * `THE-286.settings-chrome-autosave.layout.test.tsx`, which asserts the last
 * field's bottom clears the nav's top rather than trusting this number.
 */
export const NAV_CLEARANCE = 'pb-[calc(120px+env(safe-area-inset-bottom))]';

/**
 * A text control's height: the 44px touch floor on a phone, Rule 4's 38px from
 * `sm:` up.
 *
 * 🔴 Both halves are load-bearing and they are NOT the same requirement.
 * `Input` ships `h-8` (32px), which is a mouse target and fails the 44px floor
 * on a phone. `min-h-` rather than `h-` because the primitive's own `h-8` is a
 * `height` and two competing `height` utilities resolve by stylesheet order,
 * which is not something a component may rely on; a minimum wins over a height
 * regardless of order. It is released at `sm:` so Rule 4's 38px — the settled
 * desktop density, capped by DESKTOP_CONTROL_MAX_PX — is what renders on a
 * desktop, where 44px would be 6px over the band.
 */
const CONTROL_HEIGHT = `min-h-[44px] sm:min-h-[38px] ${CONTROL_DENSITY.control}`;

/** A textarea's floor. Taller than a single line by construction, so the 44px
 *  touch floor is already cleared; it keeps `min-h-16` from the primitive and
 *  only drops the `sm:h-[38px]` a one-line control takes. */
const TEXTAREA_HEIGHT = 'min-h-[44px]';

/**
 * The failure marker, and the reason it is not only a toast.
 *
 * 🔴 A toast is a notification, not a record: it fades. A settings field is
 * exactly the surface a person edits and walks away from, so the toast can be
 * gone before they look up. This row stays until a later save succeeds, names
 * the field that did not save, and gives them the retry — so a failed autosave
 * is visible in TWO places and neither of them is transient.
 *
 * `FieldError` carries `role="alert"` from the primitive, which is what makes
 * the failure reach a screen reader as well as an eye.
 */
const AutosaveError: React.FC<{ status: AutosaveStatus; onRetry: () => void }> = ({ status, onRetry }) =>
  status !== 'error' ? null : (
    <FieldError>
      <span className="flex items-center gap-2">
        <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
        <span>Not saved — your change is still here.</span>
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1 underline underline-offset-2 ${CONTROL_HEIGHT}`}
        >
          <RotateCw size={14} aria-hidden="true" />
          Retry
        </button>
      </span>
    </FieldError>
  );

export const GivingStatementsSection: React.FC = () => {
  const [ein, setEin] = useState('');
  const [address, setAddress] = useState('');
  const [footer, setFooter] = useState('');
  const [loaded, setLoaded] = useState(false);

  /**
   * The single writer. One DOTTED path per field rather than the whole
   * `config.givingStatements` object the Save button used to write: three
   * independent autosaves each replacing the whole map would let the last one
   * home put its own stale copy of the other two back.
   */
  const writeField = useCallback(async (key: 'ein' | 'address' | 'footer', value: string) => {
    const { auth, db } = await import('../../firebase');
    const { doc, getDoc, updateDoc } = await import('firebase/firestore');
    if (!auth.currentUser) throw new Error('not signed in');
    const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
    if (!userDoc.exists()) throw new Error('no user record');
    const tenantId = userDoc.data().tenantId;
    if (!tenantId) throw new Error('no tenant');
    await updateDoc(doc(db, 'tenants', tenantId), {
      [`config.givingStatements.${key}`]: value,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  // Normalisation is per field and matches what the Save button wrote: a
  // trimmed value, and the IRS default restored when the footer is emptied.
  const einSave = useCallback((v: string) => writeField('ein', v.trim()), [writeField]);
  const addressSave = useCallback((v: string) => writeField('address', v.trim()), [writeField]);
  const footerSave = useCallback(
    (v: string) => writeField('footer', v.trim() || DEFAULT_FOOTER),
    [writeField],
  );

  const einAuto = useAutosaveField(einSave, 'the EIN');
  const addressAuto = useAutosaveField(addressSave, 'the address');
  const footerAuto = useAutosaveField(footerSave, 'the footer note');

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const tenantId = userDoc.data().tenantId;
            if (tenantId) {
              const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
              const gs = tenantDoc.exists() ? tenantDoc.data().config?.givingStatements || {} : {};
              const nextFooter = gs.footer || DEFAULT_FOOTER;
              if (!cancelled) {
                if (gs.ein) setEin(gs.ein);
                if (gs.address) setAddress(gs.address);
                setFooter(nextFooter);
              }
              // 🔴 Seed the baseline WITHOUT writing it. Otherwise the first
              // blur on a field nobody touched would count as a change and
              // spend a write echoing the value straight back.
              einAuto.prime(gs.ein || '');
              addressAuto.prime(gs.address || '');
              footerAuto.prime(nextFooter);
            }
          }
        }
      } catch (e) {
        console.error('Failed to load giving statement settings:', e);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [loaded, einAuto, addressAuto, footerAuto]);

  return (
    <div className={`${CONTROL_DENSITY.sectionGap} space-y-6 ${NAV_CLEARANCE}`}>
      <p className="text-body">
        These details appear on the annual giving statements (tax receipts) you send to donors.
        Changes save on their own.
      </p>

      <FieldGroup>
        <Field data-invalid={einAuto.status === 'error' || undefined}>
          <FieldLabel htmlFor="gs-ein">Ministry EIN (Tax ID)</FieldLabel>
          <Input
            id="gs-ein"
            data-autosave="ein"
            value={ein}
            placeholder="e.g. 12-3456789"
            className={CONTROL_HEIGHT}
            onChange={(e) => { setEin(e.target.value); einAuto.onChange(e.target.value); }}
            onBlur={() => { void einAuto.onBlur(ein); }}
          />
          <AutosaveError status={einAuto.status} onRetry={() => { void einAuto.retry(ein); }} />
        </Field>

        <Field data-invalid={addressAuto.status === 'error' || undefined}>
          <FieldLabel htmlFor="gs-address">Ministry Address</FieldLabel>
          <Textarea
            id="gs-address"
            data-autosave="address"
            value={address}
            placeholder="123 Faith St&#10;City, State ZIP"
            rows={3}
            className={TEXTAREA_HEIGHT}
            onChange={(e) => { setAddress(e.target.value); addressAuto.onChange(e.target.value); }}
            onBlur={() => { void addressAuto.onBlur(address); }}
          />
          <AutosaveError status={addressAuto.status} onRetry={() => { void addressAuto.retry(address); }} />
        </Field>

        <Field data-invalid={footerAuto.status === 'error' || undefined}>
          <FieldLabel htmlFor="gs-footer">Statement Footer Note</FieldLabel>
          <Textarea
            id="gs-footer"
            data-autosave="footer"
            value={footer}
            rows={2}
            className={TEXTAREA_HEIGHT}
            onChange={(e) => { setFooter(e.target.value); footerAuto.onChange(e.target.value); }}
            onBlur={() => { void footerAuto.onBlur(footer); }}
          />
          <FieldDescription>
            Required IRS disclosure text. A sensible default is provided.
          </FieldDescription>
          <AutosaveError status={footerAuto.status} onRetry={() => { void footerAuto.retry(footer); }} />
        </Field>
      </FieldGroup>
    </div>
  );
};

export default GivingStatementsSection;
