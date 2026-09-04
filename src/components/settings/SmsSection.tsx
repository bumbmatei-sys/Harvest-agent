"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../utils/auth-fetch';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';
import { CONTROL_DENSITY, FIELD_WIDTH, ACTION_BUTTON } from '../layout/form-layout';

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

const SmsNumberPanel: React.FC = () => {
  const [number, setNumber] = useState<NumberRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [country, setCountry] = useState('US');
  const [areaCode, setAreaCode] = useState('');
  const [available, setAvailable] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    try {
      const r = await authFetch('/api/sms/numbers', {
        method: 'POST',
        body: JSON.stringify({ country, areaCode: areaCode.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      setMsg(
        r.ok
          ? { ok: true, text: d.kycUrl ? 'Ordered. An identity check is needed before it activates.' : 'Number bought.' }
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
        <p className="text-sm text-muted">Loading…</p>
      ) : number ? (
        <div className="bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Your number</h3>
            <p className="text-body font-mono text-lg mt-1">{number.phoneNumber}</p>
          </div>
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
              <p className="text-sm text-body">{RELEASE_WARNING}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={release}
                  disabled={busy === 'release'}
                  className={`${BUTTON} bg-gold text-white hover:opacity-90 disabled:opacity-50`}
                >
                  {busy === 'release' ? 'Releasing…' : 'Yes, release it'}
                </button>
                <button
                  onClick={() => setConfirmRelease(false)}
                  className={`${BUTTON} border border-line text-body hover:bg-surface-tint`}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRelease(true)}
              className={`${BUTTON} border border-line text-body hover:bg-surface-tint`}
            >
              Release this number
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Get a number</h3>
          <div className={FIELD_WIDTH.medium}>
            <label htmlFor="sms-country" className={`block text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
              Country
            </label>
            <input
              id="sms-country"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="US"
              className={`${CONTROL} font-mono`}
            />
          </div>
          <div className={FIELD_WIDTH.short}>
            <label htmlFor="sms-area" className={`block text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
              Area code <span className="text-faint font-normal">(optional)</span>
            </label>
            <input
              id="sms-area"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="615"
              className={`${CONTROL} font-mono`}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={search}
              disabled={busy === 'search'}
              className={`${BUTTON} border border-line text-body hover:bg-surface-tint disabled:opacity-50`}
            >
              {busy === 'search' ? 'Checking…' : 'Check availability'}
            </button>
            <button
              onClick={buy}
              disabled={busy === 'buy'}
              className={`${BUTTON} bg-gold text-white hover:opacity-90 disabled:opacity-50`}
            >
              {busy === 'buy' ? 'Buying…' : 'Buy a number'}
            </button>
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
        </div>
      )}

      {msg && (
        <div className={`p-3 rounded-xl text-sm ${msg.ok ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
          {msg.text}
        </div>
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
