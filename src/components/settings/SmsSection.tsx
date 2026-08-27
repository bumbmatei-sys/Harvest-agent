"use client";
import React, { useState, useEffect } from 'react';
import { authFetch } from '../../utils/auth-fetch';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';

/** Whose account, whose bill — stated where the credentials are entered, not
 * discovered from an invoice. These are the church's OWN Twilio credentials, so
 * no Harvest plan allotment applies to what they send. Kept as a constant rather
 * than inline JSX so the apostrophes stay readable (and unescaped). */
export const BYO_CREDENTIALS_NOTE =
  "These are your own Twilio credentials: messages sent with them go out on your Twilio account, so Twilio bills you directly and your Harvest plan's monthly SMS allotment doesn't apply. SMS can only be sent to US numbers.";

/** The form itself. Mounted only while SMS is visible — see the export below. */
const SmsCredentialsForm: React.FC = () => {
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [configured, setConfigured] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    authFetch('/api/sms/config')
      .then(r => r.json())
      .then(d => {
        setConfigured(!!d.configured);
        setAccountSid(d.accountSid || '');
        setFromNumber(d.fromNumber || '');
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const resp = await authFetch('/api/sms/config', {
        method: 'POST',
        body: JSON.stringify({ accountSid, fromNumber, ...(authToken ? { authToken } : {}) }),
      });
      if (resp.ok) {
        setMsg({ ok: true, text: 'Saved.' });
        setConfigured(!!(accountSid && fromNumber && (authToken || configured)));
        setAuthToken('');
      } else {
        const d = await resp.json().catch(() => ({}));
        setMsg({ ok: false, text: d.error || 'Failed to save.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const test = async (mode: 'connection' | 'sms') => {
    setBusy(mode);
    setMsg(null);
    try {
      const resp = await authFetch('/api/sms/test', {
        method: 'POST',
        body: JSON.stringify({ mode, ...(mode === 'sms' ? { to: testPhone } : {}) }),
      });
      const d = await resp.json().catch(() => ({}));
      setMsg({ ok: resp.ok, text: resp.ok ? (d.message || 'Success') : (d.error || 'Failed') });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6" style={{ paddingBottom: 120 }}>
      <p className="text-body">Connect Twilio to send SMS broadcasts and automated messages to your congregation.</p>

      <p className="text-sm text-muted">{BYO_CREDENTIALS_NOTE}</p>

      <div className="bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-body mb-1.5">Account SID</label>
          <input value={accountSid} onChange={e => setAccountSid(e.target.value)} placeholder="AC…" className="w-full px-4 py-2.5 border border-line rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gold" />
        </div>
        <div>
          <label className="block text-sm font-medium text-body mb-1.5">Auth Token {configured && <span className="text-faint font-normal">(leave blank to keep current)</span>}</label>
          <input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder={configured ? '••••••••' : 'Your Twilio auth token'} className="w-full px-4 py-2.5 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
        </div>
        <div>
          <label className="block text-sm font-medium text-body mb-1.5">From Number</label>
          <input value={fromNumber} onChange={e => setFromNumber(e.target.value)} placeholder="+15551234567" className="w-full px-4 py-2.5 border border-line rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gold" />
        </div>
        <button onClick={save} disabled={saving} className="px-6 py-2.5 bg-gold text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Credentials'}
        </button>
      </div>

      <div className="bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-3">
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Test</h3>
        <button onClick={() => test('connection')} disabled={busy === 'connection'} className="px-4 py-2 border border-line rounded-xl text-sm font-semibold text-body hover:bg-surface-tint disabled:opacity-50">
          {busy === 'connection' ? 'Checking…' : 'Test Connection'}
        </button>
        <div className="flex gap-2 pt-1">
          <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+1555… (your phone)" className="flex-1 px-4 py-2.5 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
          <button onClick={() => test('sms')} disabled={busy === 'sms' || !testPhone.trim()} className="px-4 py-2.5 border border-line rounded-xl text-sm font-semibold text-body hover:bg-surface-tint disabled:opacity-50 whitespace-nowrap">
            {busy === 'sms' ? 'Sending…' : 'Test SMS'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-sm ${msg.ok ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
};

/**
 * THE-245 — the Twilio credential entry, behind the master switch.
 *
 * A WRAPPER rather than an early `return null` inside the form, so the form's
 * hooks are never conditionally called: while SMS is hidden `SmsCredentialsForm`
 * is not mounted at all, which means its `useEffect` never fires and the
 * settings screen makes no `/api/sms/config` request. (That route refuses with
 * 503 anyway — this is the second layer, not the only one.)
 *
 * ✅ THE SIDEBAR ROW ABOVE THIS IS NOW GATED TOO — THE-250. The "SMS (Twilio)"
 * entry is declared in `components/AdminSettings.tsx`, which another ticket
 * owned while THE-245 was in flight, so that row listed and opened onto this
 * `null` until the concurrent work merged. Its `hidden:` clause now leads with
 * `SMS_FEATURE_ENABLED`, ahead of the untouched plan clause, so the label goes
 * with the panel and comes back with it.
 *
 * This wrapper stays regardless: the row is one of two callers' worth of
 * defence, and the gate that matters is the one closest to the form.
 */
export const SmsSection: React.FC = () =>
  SMS_FEATURE_ENABLED ? <SmsCredentialsForm /> : null;

export default SmsSection;
