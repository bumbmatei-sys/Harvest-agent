"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../utils/auth-fetch';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';
import { CONTROL_DENSITY, FIELD_WIDTH, ACTION_BUTTON } from '../layout/form-layout';
// THE-318 — the installed primitive for an action-styled link. Used rather than
// a hand-rolled anchor so the KYC destination carries the same focus ring and
// palette treatment as every other action on this screen.
import { Button } from '@/components/ui/button';
// ── THE-320 — the rest of the installed primitives this panel composes from.
//
// ✅ `ui/card` IS SAFE HERE, and that was checked rather than assumed. Both
// shells below are `rounded-2xl`; `cn()` is twMerge, and twMerge resolves
// `rounded-2xl` against the primitive's own `rounded-xl` (both are Tailwind
// scale steps) so exactly ONE corner reaches the DOM. The sibling SMS screen has
// shells spelled `rounded-brand-lg`/`-xl`, which twMerge does NOT know and
// therefore keeps alongside `rounded-xl` — `ui/card` is rejected there and the
// rejection is recorded on each shell.
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * THE-314 — the ministry's phone number: search, buy, see, release.
 *
 * 🔴 IT REPLACED A BRING-YOUR-OWN CREDENTIAL FORM. This panel used to collect a
 * church's own Twilio account SID, auth token and from-number. Harvest now
 * RESELLS on one vendor account: the church never holds a credential, never
 * contracts with the vendor, and buys its number from inside Harvest.
 *
 * 🔴 IT NEVER APPLIES ENTITLEMENT. Nothing here writes a plan, a feature flag
 * or an add-on count — #434 removed a client-side `plan` write and THE-259's
 * sweep catches a new one. It ASKS `/api/sms/numbers` and then RE-READS what
 * that route recorded; it never renders the outcome it requested. A number that
 * failed to provision, or that provisioned into a pending carrier registration,
 * must look like what it is on the next read rather than like a success this
 * component assumed.
 */

/** Whose account, whose bill — stated where the money is spent, not discovered
 * on an invoice. Kept as a constant rather than inline JSX so the apostrophes
 * stay readable (and unescaped). */
export const RESOLD_NUMBER_NOTE =
  "Harvest buys and holds this number for you and bills you for it, so there is no separate carrier account to set up. Messages are charged against your plan's monthly allowance. SMS can only be sent to US numbers.";

/** 🔴 Said BEFORE the button that does it, because the vendor documents no
 * port-out: a released number cannot be recovered and cannot be moved to an
 * account the church controls. A church that published this number on its
 * noticeboard would lose it. */
export const RELEASE_WARNING =
  'Releasing gives the number up for good. It cannot be recovered, and it cannot be moved to another provider — anyone texting it afterwards reaches nobody.';

interface NumberRecord {
  phoneNumber: string;
  status: string;
  monthlyCostUsd: number | null;
  country: string;
  purchasedAt?: string;
}

/** Human copy for each status the provider can report. `pending_registration`
 * is the one that matters: the number EXISTS and is being billed, but US
 * carriers will not deliver from it until the brand registration is approved.
 * Saying "active" there would be a false claim on a screen about money. */
function statusLabel(status: string): string {
  if (status === 'active') return 'Active — able to send and receive';
  if (status === 'pending_registration') return 'Waiting on carrier registration — it cannot send yet';
  if (status === 'kyc_required') return 'Waiting on an identity check before it activates';
  if (status === 'released') return 'Released';
  return status;
}

/** Every control is ≥44px below `sm`; Rule 4's density tokens take over from
 * `sm:` up, where 38/40px is the settled desktop band. */
const CONTROL = `w-full min-h-[44px] px-4 border border-line rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-gold ${CONTROL_DENSITY.control}`;
const BUTTON = `min-h-[44px] px-6 rounded-xl text-sm font-semibold ${CONTROL_DENSITY.action} ${ACTION_BUTTON}`;

/**
 * The two recipes above, exported so they can be MEASURED rather than retyped.
 *
 * ⚠️ THE-320's layout suite renders these exact strings through the same
 * primitives this panel uses. The panel's own controls only exist after its
 * `/api/sms/numbers` effect has run, which server rendering never does — so a
 * measuring suite that cannot mount the panel would otherwise have to hand-copy
 * the class strings, and a hand-copied recipe drifts silently from the one that
 * ships. Exporting them means the thing measured IS the thing rendered.
 */
export const SMS_PANEL_CONTROL_CLASSES = { control: CONTROL, action: BUTTON } as const;

/** How the panel spells each control, for the same reason. */
export const SMS_PANEL_CONTROL_EXTRA = {
  input: 'h-auto border-line bg-transparent focus-visible:ring-2 focus-visible:ring-gold focus-visible:border-input',
  primaryAction: 'h-auto bg-gold hover:bg-gold text-white hover:opacity-90 disabled:opacity-50',
  secondaryAction: 'h-auto border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body',
} as const;

const SmsNumberPanel: React.FC = () => {
  const [number, setNumber] = useState<NumberRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [country, setCountry] = useState('US');
  const [areaCode, setAreaCode] = useState('');
  const [available, setAvailable] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 🔴 THE-318 — the identity-check address a regulated country answers with.
   * Held separately from `msg` because it is an ACTION, not a sentence: an
   * admin told "an identity check is needed" with no way to reach it cannot
   * finish, and the number is never ordered until they do. */
  const [kycUrl, setKycUrl] = useState<string | null>(null);

  /** The single re-read. Every mutation below ends by calling this rather than
   * setting state from its own response, so what the screen shows is always
   * what the server recorded. */
  const reload = useCallback(async () => {
    try {
      const r = await authFetch('/api/sms/numbers');
      const d = await r.json().catch(() => ({}));
      setNumber(r.ok ? d.number ?? null : null);
    } catch {
      setNumber(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const search = async () => {
    setBusy('search');
    setMsg(null);
    setAvailable(null);
    try {
      const q = new URLSearchParams({ available: '1', country });
      if (areaCode.trim()) q.set('prefix', areaCode.trim());
      const r = await authFetch(`/api/sms/numbers?${q.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setAvailable(d.available ?? 0);
      else setMsg({ ok: false, text: d.error || 'Could not check availability.' });
    } finally {
      setBusy('');
    }
  };

  const buy = async () => {
    setBusy('buy');
    setMsg(null);
    setKycUrl(null);
    try {
      const r = await authFetch('/api/sms/numbers', {
        method: 'POST',
        body: JSON.stringify({ country, areaCode: areaCode.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      // 🔴 THE-318 — a 202 is NOT a purchase. The provider answers
      // `kyc_required` before ordering anything, so saying "ordered" there
      // would be a false claim on a screen about money: nothing exists and
      // nothing is being billed until the check is done.
      if (d.kycUrl) setKycUrl(typeof d.kycUrl === 'string' ? d.kycUrl : null);
      setMsg(
        d.kycUrl
          ? {
              ok: false,
              text:
                d.error ||
                'This country needs an identity check before the number can be ordered. Nothing has been charged yet.',
            }
          : r.ok
            ? { ok: true, text: 'Number bought.' }
            : { ok: false, text: d.error || 'Could not buy a number.' },
      );
    } finally {
      setBusy('');
      // 🔴 Re-read whether it succeeded or not. A failed purchase can still have
      // provisioned a number at the provider, and the screen must show what is
      // actually being billed rather than what this component hoped.
      await reload();
    }
  };

  const release = async () => {
    setBusy('release');
    setMsg(null);
    try {
      const r = await authFetch('/api/sms/numbers', { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: 'Number released.' } : { ok: false, text: d.error || 'Could not release the number.' });
    } finally {
      setBusy('');
      setConfirmRelease(false);
      await reload();
    }
  };

  return (
    // Explicit bottom clearance: the admin shell still carries the inert
    // `pb-safe` class (#437 fixed only the member shell), so a panel that relied
    // on it would sit under the fixed bottom nav on a phone.
    <div className={CONTROL_DENSITY.sectionGap + ' space-y-6'} style={{ paddingBottom: 120 }}>
      <p className="text-body">
        Send SMS broadcasts and automated messages to your congregation from a number of your own.
      </p>
      <p className="text-sm text-muted">{RESOLD_NUMBER_NOTE}</p>

      {!loaded ? (
        /* ⚠️ `ui/skeleton` REJECTED — it is the primitive for a loading state and
           it cannot be used here, because adopting it DELETES the word
           "Loading…". This ticket may not change a word of copy, and a shimmer
           is not the same statement to a screen reader as a sentence. */
        <p className="text-sm text-muted">Loading…</p>
      ) : number ? (
        /* ✅ `ui/card` — `rounded-2xl` resolves against the primitive's
           `rounded-xl`, so the 16px corner this shell already had is the only
           one emitted. */
        <Card className="gap-0 py-0 overflow-visible ring-0 bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4 text-body">
          <div>
            {/* ⚠️ `CardTitle` REJECTED on this heading. It renders a `<div>` with
                no `render` escape, so adopting it would demote an `<h3>` inside
                the settings accordion to a non-heading — an accessibility
                regression traded for a class name. */}
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Your number</h3>
            <p className="text-body font-mono text-lg mt-1">{number.phoneNumber}</p>
          </div>
          {/* ⚠️ `ui/item` REJECTED for these three rows. They are a description
              list: each `<dt>` NAMES its `<dd>`, and that association is what a
              screen reader reads out on a billing surface. `Item` renders a div
              tree with no `dt`/`dd`, so composing here would trade a real
              semantic for a visual one. `ui/item` IS adopted for the broadcast
              rows on the sibling screen, where the rows are genuinely just rows. */}
          <dl className={CONTROL_DENSITY.fieldGap + ' space-y-2 text-sm'}>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted">Status</dt>
              <dd className="text-body">{statusLabel(number.status)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted">Monthly cost</dt>
              {/* An em dash rather than a guessed figure: a wrong price on a
                  billing screen is a false claim, and the provider does not
                  always report one. */}
              <dd className="text-body">
                {number.monthlyCostUsd === null ? '—' : `$${number.monthlyCostUsd.toFixed(2)} / month`}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted">Country</dt>
              <dd className="text-body">{number.country}</dd>
            </div>
          </dl>

          {confirmRelease ? (
            <div className="space-y-3">
              {/* `ui/alert` — this is the warning banner before an irreversible,
                  unrecoverable action, and it now carries `role="alert"` so it
                  is announced rather than merely printed. The copy, its tokens
                  and its 3-unit rhythm are unchanged. */}
              <Alert className="p-0 gap-0 rounded-none border-0 bg-transparent text-body">
                <AlertDescription className="text-sm text-body">{RELEASE_WARNING}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={release}
                  disabled={busy === 'release'}
                  className={`h-auto ${BUTTON} bg-gold hover:bg-gold text-white hover:opacity-90 disabled:opacity-50`}
                >
                  {busy === 'release' ? 'Releasing…' : 'Yes, release it'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmRelease(false)}
                  className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body`}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setConfirmRelease(true)}
              className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body`}
            >
              Release this number
            </Button>
          )}
        </Card>
      ) : (
        /* ✅ `ui/card` — `rounded-2xl`, resolves cleanly. */
        <Card className="gap-0 py-0 overflow-visible ring-0 bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4 text-body">
          {/* `CardTitle` rejected for the reason given on the sibling heading. */}
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Get a number</h3>
          <div className={FIELD_WIDTH.medium}>
            <Label htmlFor="sms-country" className={`block leading-5 text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
              Country
            </Label>
            <Input
              id="sms-country"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="US"
              className={`h-auto border-line bg-transparent focus-visible:ring-2 focus-visible:ring-gold focus-visible:border-input ${CONTROL} font-mono`}
            />
          </div>
          <div className={FIELD_WIDTH.short}>
            <Label htmlFor="sms-area" className={`block leading-5 text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
              Area code <span className="text-faint font-normal">(optional)</span>
            </Label>
            <Input
              id="sms-area"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="615"
              className={`h-auto border-line bg-transparent focus-visible:ring-2 focus-visible:ring-gold focus-visible:border-input ${CONTROL} font-mono`}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={search}
              disabled={busy === 'search'}
              className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body disabled:opacity-50`}
            >
              {busy === 'search' ? 'Checking…' : 'Check availability'}
            </Button>
            {/* 🔴 THE-318's purchase path is untouched by this composition: this
                is the same `buy` handler, and `buy` still POSTs the same body,
                still reads the RETURNED profile, still passes `allowMultiple`
                and still surfaces a KYC 202 through `kycUrl` below. */}
            <Button
              onClick={buy}
              disabled={busy === 'buy'}
              className={`h-auto ${BUTTON} bg-gold hover:bg-gold text-white hover:opacity-90 disabled:opacity-50`}
            >
              {busy === 'buy' ? 'Buying…' : 'Buy a number'}
            </Button>
          </div>

          {available !== null && (
            // ⚠️ A COUNT, NOT A LIST. The provider assigns the number itself —
            // you constrain the country and area, you do not pick the digits —
            // so offering a choice here and then delivering something else
            // would be a promise the purchase cannot keep.
            <p className="text-sm text-muted">
              {available > 0
                ? `Numbers are available in ${country}${areaCode ? ` (${areaCode})` : ''}. One will be assigned to you when you buy.`
                : `No numbers are available in ${country}${areaCode ? ` (${areaCode})` : ''} right now. Try another area code.`}
            </p>
          )}
        </Card>
      )}

      {msg && (
        /* `ui/alert` — the outcome banner. Both tones keep the exact tokens they
           had; what the primitive adds is `role="alert"`, so a purchase result
           an admin cannot see is still announced. */
        <Alert className={`p-3 gap-0 rounded-xl text-sm ${msg.ok ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
          <AlertDescription className="text-inherit">{msg.text}</AlertDescription>
          {kycUrl && (
            // ≥44px below `sm`; the primitive's own 32px height is the settled
            // desktop band from `sm:` up, so the minimum is released there.
            <Button
              variant="link"
              className="mt-2 min-h-[44px] sm:min-h-0"
              render={<a href={kycUrl} target="_blank" rel="noopener noreferrer" />}
            >
              Complete the identity check
            </Button>
          )}
        </Alert>
      )}
    </div>
  );
};

/**
 * THE-245 — the panel, behind the master switch.
 *
 * A WRAPPER rather than an early `return null` inside the panel, so its hooks
 * are never conditionally called: while SMS is hidden `SmsNumberPanel` is not
 * mounted at all, which means its `useEffect` never fires and the settings
 * screen makes no `/api/sms/numbers` request. (That route refuses with 503
 * anyway — this is the second layer, not the only one.)
 *
 * The wrapper stays now that the switch is on: it is what makes turning SMS
 * back off one value rather than a second edit here.
 */
export const SmsSection: React.FC = () => (SMS_FEATURE_ENABLED ? <SmsNumberPanel /> : null);

export default SmsSection;
