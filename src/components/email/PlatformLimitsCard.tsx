'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmailApiError, type EmailApi, type EmailLimits } from '@/components/email/email-api';
import { ErrorNote } from '@/components/email/kit';

const PLANS = [
  { id: 'free', label: 'Forever Free' },
  { id: 'plus', label: 'Individual' },
  { id: 'pro', label: 'Small Team' },
  { id: 'max', label: 'Ministry' },
] as const;

function Field({ id, label, hint, value, onChange, placeholder }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" className="min-h-11" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

const num = (v: string): number => (v.trim() === '' ? Number.NaN : Number(v));

/**
 * Platform-wide sending limits. Super admin only (the server refuses anyone
 * else). Every number a ministry is held to is edited here, with no deploy.
 */
export function PlatformLimitsCard({ api, limits, onSaved }: { api: Pick<EmailApi, 'saveLimits'>; limits: EmailLimits; onSaved: (next: EmailLimits) => void }) {
  const [monthly, setMonthly] = useState<Record<string, string>>(() => Object.fromEntries(PLANS.map((p) => [p.id, String(limits.monthlySends[p.id])])));
  const [packSize, setPackSize] = useState(String(limits.pack.size));
  const [packPrice, setPackPrice] = useState(limits.pack.priceUsd == null ? '' : String(limits.pack.priceUsd));
  const [warn, setWarn] = useState(String(limits.warnAtPercent));
  const [dailyCap, setDailyCap] = useState(String(limits.newChurch.dailyCap));
  const [days, setDays] = useState(String(limits.newChurch.days));
  const [large, setLarge] = useState(String(limits.largeSendThreshold));
  const [bounce, setBounce] = useState(String(+(limits.autoPause.bounceRate * 100).toFixed(3)));
  const [complaint, setComplaint] = useState(String(+(limits.autoPause.complaintRate * 100).toFixed(3)));
  const [minSent, setMinSent] = useState(String(limits.autoPause.minSent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const next: EmailLimits = {
      monthlySends: Object.fromEntries(PLANS.map((p) => [p.id, num(monthly[p.id])])) as EmailLimits['monthlySends'],
      pack: { size: num(packSize), priceUsd: packPrice.trim() === '' ? null : num(packPrice) },
      warnAtPercent: num(warn),
      newChurch: { dailyCap: num(dailyCap), days: num(days) },
      largeSendThreshold: num(large),
      autoPause: { bounceRate: num(bounce) / 100, complaintRate: num(complaint) / 100, minSent: num(minSent) },
    };
    try {
      onSaved(await api.saveLimits(next));
      setSaved(true);
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'The limits could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" data-platform-limits>
      <div>
        <h2 className="text-base font-semibold text-strong">Sending limits (Harvest only)</h2>
        <p className="mt-0.5 text-sm text-muted">These apply to every ministry. Changes take effect on the next send. Contacts are never limited.</p>
      </div>
      <Card className="gap-6 p-6">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-strong">Emails included each month</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            {PLANS.map((p) => (
              <Field key={p.id} id={`limit-monthly-${p.id}`} label={p.label} value={monthly[p.id]} onChange={(v) => setMonthly({ ...monthly, [p.id]: v })} />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="limit-pack-size" label="Extra pack size (emails)" value={packSize} onChange={setPackSize} />
          <Field id="limit-pack-price" label="Extra pack price (USD)" hint="Leave empty until a price is set." value={packPrice} onChange={setPackPrice} placeholder="Not set" />
          <Field id="limit-warn" label="Warn at (% used)" value={warn} onChange={setWarn} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="limit-daily" label="New ministry: emails a day" value={dailyCap} onChange={setDailyCap} />
          <Field id="limit-days" label="New ministry: first how many days" value={days} onChange={setDays} />
          <Field id="limit-large" label="Needs a verified domain above (recipients)" value={large} onChange={setLarge} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="limit-bounce" label="Pause at bounce rate (%)" value={bounce} onChange={setBounce} />
          <Field id="limit-complaint" label="Pause at complaint rate (%)" value={complaint} onChange={setComplaint} />
          <Field id="limit-min" label="Only judge after (emails sent)" value={minSent} onChange={setMinSent} />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-3">
          <Button className="min-h-11" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save limits'}</Button>
          {saved && <span role="status" className="text-sm text-muted">Saved.</span>}
        </div>
      </Card>
    </section>
  );
}
