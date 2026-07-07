"use client";
import React, { useState } from 'react';
import { CheckCircle2, CalendarClock } from 'lucide-react';

interface PublicPledgeProps {
  tenantId: string;
  tenantName: string;
  logo: string | null;
  primaryColor: string;
  campaign: any;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

// Module-scope so its identity is stable across renders (a render-time nested
// component would remount the whole subtree on every keystroke → focus loss).
const Shell: React.FC<{ logo: string | null; tenantName: string; primaryColor: string; children: React.ReactNode }> = ({ logo, tenantName, primaryColor, children }) => (
  <div className="min-h-screen bg-[#F7F6F3] py-10 px-4">
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

const PublicPledge: React.FC<PublicPledgeProps> = ({ tenantId, tenantName, logo, primaryColor, campaign }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const inputCls = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent';
  const ring = { '--tw-ring-color': primaryColor } as React.CSSProperties;

  const pct = campaign.goal > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100)) : 0;
  const deadline = campaign.pledgeDeadline ? new Date(campaign.pledgeDeadline).toLocaleDateString() : null;

  const submit = async () => {
    if (!name.trim() || !email.trim() || !Number(amount)) {
      setError('Please enter your name, email and a pledge amount.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch('/api/pledge/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          campaignId: campaign.id,
          donorName: name.trim(),
          donorEmail: email.trim(),
          donorPhone: phone.trim() || undefined,
          pledgeAmount: Number(amount),
          notes: notes.trim() || undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Pledge failed');
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h1 className="font-display text-xl font-bold text-gray-900 mb-2">Thank you, {name}!</h1>
          <p className="text-sm text-gray-500">Your pledge of {fmt(Number(amount))} has been recorded. We&apos;ll be in touch.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
      <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-6" style={{ paddingBottom: 24 }}>
        <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">{campaign.title}</h1>
        {campaign.description && <p className="text-sm text-gray-500 mb-4 whitespace-pre-line">{campaign.description}</p>}

        {campaign.goal > 0 && (
          <div className="mb-4">
            <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1.5">
              <span className="font-semibold text-gray-800">{fmt(campaign.raised)} raised</span>
              <span>of {fmt(campaign.goal)}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: primaryColor }} />
            </div>
          </div>
        )}

        {deadline && (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 mb-5">
            <CalendarClock size={13} /> Pledges due by {deadline}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name<span className="text-red-500 ml-0.5">*</span></label>
            <input className={inputCls} style={ring} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email<span className="text-red-500 ml-0.5">*</span></label>
            <input type="email" className={inputCls} style={ring} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="tel" className={inputCls} style={ring} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="For pledge reminders" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Pledge Amount<span className="text-red-500 ml-0.5">*</span></label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input type="number" min={0} className={`${inputCls} pl-7`} style={ring} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea rows={3} className={`${inputCls} resize-none`} style={ring} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

        <button onClick={submit} disabled={submitting}
          className="mt-6 w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
          style={{ backgroundColor: primaryColor }}>
          {submitting ? 'Submitting…' : 'Make My Pledge'}
        </button>
      </div>
    </Shell>
  );
};

export default PublicPledge;
