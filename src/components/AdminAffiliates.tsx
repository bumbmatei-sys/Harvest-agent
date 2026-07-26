"use client";
import React, { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { Link2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { AdminSearchBar } from './admin/AdminUI';

/**
 * Super-admin affiliate overview — one row per affiliate, showing whether the
 * programme is actually producing anything: revenue brought in, plans sold,
 * what they earned, what is still owed, what Harvest kept, the payout-status
 * breakdown and their Stripe Connect state.
 *
 * Read-only. It reads /api/admin/affiliates (super-admin gated) and never
 * writes: no editing commissions, no triggering payouts. AffiliateDashboard
 * (an affiliate's own numbers) is untouched.
 *
 * Three labelling rules this view exists to honour:
 *  • Commission figures come from the STORED `commission` field. One legacy row
 *    was written at 20%, so a "15% of revenue" figure would be a lie — the
 *    per-affiliate rate chips make an off-rate row visible instead.
 *  • `convertedReferrals` is CONVERTED referrals, never "signups". A live trial
 *    is not counted, and the affiliate's own dashboard shows the same number.
 *  • `pending` is never presented as "about to be paid" — each affiliate's
 *    pendingReason says whether the sweep will ever reach it.
 */

interface StatusBucket { count: number; commission: number }

interface Affiliate {
  userId: string;
  email: string | null;
  name: string | null;
  affiliateCode: string | null;
  revenueBrought: number;
  plansSold: number;
  recurringPayments: number;
  earned: number;
  owedUnpaid: number;
  harvestKept: number;
  commissionFromRows: number;
  payoutStatus: { paid: StatusBucket; pending: StatusBucket; cancelled: StatusBucket; failed: StatusBucket };
  pendingReason: 'no_connect_account' | 'connect_incomplete' | 'awaiting_sweep' | null;
  connect: { accountId: string | null; status: string | null; payoutReady: boolean };
  convertedReferrals: number;
  commissionRates: { rate: number; count: number }[];
  transfers: { commissionId: string; commission: number; stripeTransferId: string | null; paidAt: string | null }[];
  recentCommissions: {
    id: string; tenantId: string | null; plan: string | null; type: string | null;
    status: string | null; amount: number; commission: number; createdAt: string | null;
  }[];
}

/** Amounts are Stripe minor units (cents). */
function usd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Why a pending commission is pending. "Pending" alone reads as "about to be
 * paid"; for a referrer who never finished Connect onboarding the sweep skips
 * the row on every run, so it is stuck, not queued. */
const PENDING_REASON: Record<string, { label: string; stuck: boolean }> = {
  no_connect_account: { label: 'Stuck — no Stripe Connect account, the sweep skips these forever', stuck: true },
  connect_incomplete: { label: 'Stuck — Connect onboarding never finished, not payout-ready', stuck: true },
  awaiting_sweep: { label: 'Queued — Connect is ready, awaiting the next payout sweep', stuck: false },
};

function ConnectBadge({ connect }: { connect: Affiliate['connect'] }) {
  if (!connect.accountId) {
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-warm-brown">Not connected</span>;
  }
  if (connect.payoutReady) {
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">Connected</span>;
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
      Onboarding {connect.status ? `· ${connect.status}` : 'incomplete'}
    </span>
  );
}

function Cell({ label, value, tone = '' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-[110px]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${tone || 'text-earth'}`}>{value}</p>
    </div>
  );
}

const AdminAffiliates: React.FC = () => {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) { if (!cancelled) { setError('Not authenticated'); setLoading(false); } return; }
        const res = await fetch('/api/admin/affiliates', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data.error || 'Failed to load affiliates'); return; }
        setAffiliates(data.affiliates || []);
        setTruncated(!!data.truncated);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load affiliates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? affiliates.filter(a =>
        (a.email || '').toLowerCase().includes(term) ||
        (a.name || '').toLowerCase().includes(term) ||
        (a.affiliateCode || '').toLowerCase().includes(term))
    : affiliates;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">Affiliate overview unavailable — {error}.</p>;
  }

  return (
    <div className="space-y-4">
      <AdminSearchBar value={search} onChange={setSearch} placeholder="Search affiliates…" />

      {truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Showing the first 500 affiliates — this list is a prefix, not the whole programme.
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-stone-200">
          <Link2 size={40} className="mx-auto text-stone-300 mb-4" />
          <p className="text-warm-brown font-medium font-display">No affiliates yet</p>
          <p className="text-[color:var(--text-faint)] text-sm mt-1">Nobody has generated a referral link.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(a => {
            const open = expanded === a.userId;
            const reason = a.pendingReason ? PENDING_REASON[a.pendingReason] : null;
            const offRate = a.commissionRates.some(r => r.rate !== 0.15);
            return (
              <div key={a.userId} className="bg-white rounded-2xl border border-stone-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-earth truncate">
                      {a.name || a.email || a.userId}
                    </h3>
                    <p className="text-xs text-warm-brown mt-0.5">
                      {a.email && <span>{a.email} · </span>}
                      {a.affiliateCode ? <span className="font-mono">{a.affiliateCode}</span> : <span>no referral code</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ConnectBadge connect={a.connect} />
                    <button
                      onClick={() => setExpanded(open ? null : a.userId)}
                      className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                      title={open ? 'Hide detail' : 'Show detail'}
                    >
                      {open ? <ChevronDown size={16} className="text-warm-brown" /> : <ChevronRight size={16} className="text-warm-brown" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-3 mt-4">
                  <Cell label="Revenue brought" value={usd(a.revenueBrought)} />
                  <Cell label="Plans sold" value={a.plansSold} />
                  <Cell label="They earned" value={usd(a.earned)} />
                  <Cell
                    label="Owed but unpaid"
                    value={usd(a.owedUnpaid)}
                    tone={a.owedUnpaid > 0 && reason?.stuck ? 'text-red-600' : undefined}
                  />
                  <Cell label="Harvest kept" value={usd(a.harvestKept)} />
                  {/* CONVERTED referrals — a trial in progress is not counted, and
                      this is the same number the affiliate sees on their own
                      dashboard. Calling it "signups" would contradict both. */}
                  <Cell label="Converted referrals" value={a.convertedReferrals} />
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-4 text-[11px]">
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-700">
                    paid {a.payoutStatus.paid.count} · {usd(a.payoutStatus.paid.commission)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800">
                    pending {a.payoutStatus.pending.count} · {usd(a.payoutStatus.pending.commission)}
                  </span>
                  {a.payoutStatus.failed.count > 0 && (
                    <span className="px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">
                      failed {a.payoutStatus.failed.count} · {usd(a.payoutStatus.failed.commission)}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-stone-100 text-warm-brown">
                    cancelled {a.payoutStatus.cancelled.count}
                  </span>
                </div>

                {reason && (
                  <p className={`flex items-start gap-1.5 text-xs mt-2 ${reason.stuck ? 'text-red-600' : 'text-warm-brown'}`}>
                    {reason.stuck && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
                    <span>{reason.label}</span>
                  </p>
                )}

                {offRate && (
                  <p className="text-xs text-amber-700 mt-2">
                    Mixed commission rates on record:{' '}
                    {a.commissionRates.map(r => `${(r.rate * 100).toFixed(r.rate * 100 % 1 ? 1 : 0)}% ×${r.count}`).join(', ')}
                    {' '}— figures use the rate stored on each commission, not today&apos;s.
                  </p>
                )}

                {open && (
                  <div className="mt-4 pt-4 border-t border-stone-100 space-y-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-2">
                        Transfers that actually fired ({a.transfers.length})
                      </p>
                      {a.transfers.length === 0 ? (
                        <p className="text-xs text-[color:var(--text-faint)]">No money has moved for this affiliate.</p>
                      ) : (
                        <ul className="space-y-1">
                          {a.transfers.map(t => (
                            <li key={t.commissionId} className="text-xs text-warm-brown">
                              <span className="font-semibold text-earth">{usd(t.commission)}</span>
                              {t.paidAt && <span> · {t.paidAt.slice(0, 10)}</span>}
                              {t.stripeTransferId && <span className="font-mono"> · {t.stripeTransferId}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-2">
                        Commissions ({a.recentCommissions.length} most recent)
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-[color:var(--text-faint)]">
                              <th className="py-1 pr-3 font-semibold">Date</th>
                              <th className="py-1 pr-3 font-semibold">Tenant</th>
                              <th className="py-1 pr-3 font-semibold">Plan</th>
                              <th className="py-1 pr-3 font-semibold">Type</th>
                              <th className="py-1 pr-3 font-semibold">Status</th>
                              <th className="py-1 pr-3 font-semibold text-right">Amount</th>
                              <th className="py-1 pr-3 font-semibold text-right">Commission</th>
                              <th className="py-1 font-semibold text-right">Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.recentCommissions.map(c => (
                              <tr key={c.id} className="border-t border-stone-100 text-warm-brown">
                                <td className="py-1 pr-3">{(c.createdAt || '').slice(0, 10) || '—'}</td>
                                <td className="py-1 pr-3 font-mono">{c.tenantId || '—'}</td>
                                <td className="py-1 pr-3">{c.plan || '—'}</td>
                                <td className="py-1 pr-3">{c.type || '—'}</td>
                                <td className="py-1 pr-3">{c.status || '—'}</td>
                                <td className="py-1 pr-3 text-right">{usd(c.amount)}</td>
                                <td className="py-1 pr-3 text-right text-earth font-semibold">{usd(c.commission)}</td>
                                <td className="py-1 text-right">
                                  {c.amount > 0 ? `${((c.commission / c.amount) * 100).toFixed(0)}%` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {a.commissionFromRows !== a.earned && (
                      <p className="text-xs text-amber-700">
                        Lifetime counter ({usd(a.earned)}) differs from the sum of their commission rows
                        ({usd(a.commissionFromRows)}). Both are shown as stored — neither is recomputed.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAffiliates;
