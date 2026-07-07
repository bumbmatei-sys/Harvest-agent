"use client";
import React, { useEffect, useState } from 'react';
import { CreditCard, CalendarClock, FileText, Download, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/auth-fetch';
import { getPlanDisplayName } from '../utils/plan-features';
import type { TenantPlan } from '../types/tenant.types';
import PlanUpgradeSection from './settings/PlanUpgradeSection';

const GOLD = 'var(--brand-color, #B8962E)';

interface BillingInvoice {
  id: string;
  date: number;            // unix seconds
  amount: number;          // minor units (cents)
  currency: string;
  status: string | null;
  invoicePdf: string | null;
  hostedUrl: string | null;
}

interface BillingSubscription {
  plan: string | null;
  status: string | null;
  currentPeriodEnd: number | null;
  nextAmount: number | null;
  currency: string;
  cancelAtPeriodEnd: boolean;
}

interface BillingAndPaymentsProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
  tenantName?: string;
}

const fmtMoney = (minor: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(minor / 100);

const fmtDate = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paid: 'bg-green-100 text-green-700',
  past_due: 'bg-amber-100 text-amber-700',
  open: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
  canceled: 'bg-gray-100 text-gray-500',
  void: 'bg-gray-100 text-gray-500',
  draft: 'bg-gray-100 text-gray-500',
  uncollectible: 'bg-red-100 text-red-700',
};

const statusPill = (status?: string | null) => {
  const s = (status || 'unknown').toLowerCase();
  return STATUS_STYLES[s] || 'bg-gray-100 text-gray-500';
};

/**
 * Owner-only Billing & Payments page (opened from the My Account menu). Shows the
 * current plan + status, next billing date/amount, plan upgrade/cancel (reusing
 * PlanUpgradeSection — upgrade UI hidden on the top Ministry plan), Stripe-hosted
 * payment history, and a consolidated billing-summary PDF. All data comes from
 * the owner-gated /api/billing/* routes.
 */
const BillingAndPayments: React.FC<BillingAndPaymentsProps> = ({ currentPlan, tenantId, email }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await authFetch('/api/billing/invoices');
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) {
          setError(data.error || 'Failed to load billing information');
        } else {
          setSubscription(data.subscription || null);
          setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load billing information');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleGenerateStatement = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const resp = await authFetch('/api/billing/statement', { method: 'POST', body: '{}' });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        setGenError(d.error || 'Failed to generate statement');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'billing-summary.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setGenError(e?.message || 'Failed to generate statement');
    } finally {
      setGenerating(false);
    }
  };

  const planId = (subscription?.plan as TenantPlan) || currentPlan;
  const planLabel = planId ? getPlanDisplayName(planId) : '—';
  const status = subscription?.status || null;
  const isUltra = planId === 'ultra';

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center h-40">
        <Loader2 size={28} className="animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {error && (
        <div className="p-3 rounded-xl text-sm flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-100">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* 1 + 2: Current plan / status / next billing */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={16} style={{ color: GOLD }} />
            <span className="text-xs text-gray-500 font-medium">Current Plan</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{planLabel}</div>
          {status && (
            <span className={`inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusPill(status)}`}>
              {status}
            </span>
          )}
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock size={16} style={{ color: GOLD }} />
            <span className="text-xs text-gray-500 font-medium">
              {subscription?.cancelAtPeriodEnd ? 'Access Until' : 'Next Billing'}
            </span>
          </div>
          {subscription?.currentPeriodEnd ? (
            <>
              <div className="text-2xl font-bold text-gray-900">{fmtDate(subscription.currentPeriodEnd)}</div>
              {!subscription.cancelAtPeriodEnd && subscription.nextAmount != null && (
                <p className="text-sm text-gray-500 mt-1">{fmtMoney(subscription.nextAmount, subscription.currency)}</p>
              )}
              {subscription.cancelAtPeriodEnd && (
                <p className="text-sm text-amber-600 mt-1">Cancels at period end</p>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400">No active subscription</div>
          )}
        </div>
      </div>

      {/* 3: Upgrade / Cancel — reuses PlanUpgradeSection; upgrade UI hidden on Ministry */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <PlanUpgradeSection
          currentPlan={planId}
          tenantId={tenantId}
          email={email}
          hideUpgrade={isUltra}
        />
      </div>

      {/* 4: Payment history — links to Stripe's own hosted invoice PDFs */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3 font-display">Payment History</h3>
        {invoices.length === 0 ? (
          <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <FileText size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No payments yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(inv.date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmtMoney(inv.amount, inv.currency)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusPill(inv.status)}`}>
                          {inv.status || 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inv.invoicePdf || inv.hostedUrl ? (
                          <a
                            href={(inv.invoicePdf || inv.hostedUrl) as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                            style={{ color: GOLD }}
                          >
                            <ExternalLink size={12} /> PDF
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 5: Generate consolidated billing-summary PDF (pdf-lib, admin-facing) */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700 mb-1 font-display">Billing Statement</h3>
        <p className="text-sm text-gray-500 mb-4">
          Download a consolidated PDF summary of your plan and all subscription payments.
        </p>
        <button
          onClick={handleGenerateStatement}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: GOLD }}
        >
          {generating ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><Download size={15} /> Generate Statement</>}
        </button>
        {genError && (
          <div className="mt-3 p-3 rounded-xl text-sm flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-100">
            <AlertCircle size={14} /> {genError}
          </div>
        )}
      </div>
    </div>
  );
};

export default BillingAndPayments;
