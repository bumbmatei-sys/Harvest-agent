"use client";
import React, { useEffect, useState } from 'react';
import { CreditCard, CalendarClock, FileText, Download, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/auth-fetch';
import { getPlanDisplayName, TOP_PLAN } from '../utils/plan-features';
import type { TenantPlan } from '../types/tenant.types';
import PlanUpgradeSection from './settings/PlanUpgradeSection';
import { useTenantOptional } from '../contexts/TenantContext';
import AddOnsSection from './settings/AddOnsSection';
import { FORM_CONTAINER } from './layout/form-layout';

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
  cancelled: 'bg-surface-sunken text-muted',
  canceled: 'bg-surface-sunken text-muted',
  void: 'bg-surface-sunken text-muted',
  draft: 'bg-surface-sunken text-muted',
  uncollectible: 'bg-red-100 text-red-700',
};

const statusPill = (status?: string | null) => {
  const s = (status || 'unknown').toLowerCase();
  return STATUS_STYLES[s] || 'bg-surface-sunken text-muted';
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
  /**
   * True when this tenant's payment history lives with a processor whose ledger
   * this page cannot read (Dodo). Without it the empty table below reads "No
   * payments yet." to an owner who is being charged every month — the one
   * sentence a treasurer reconciling two statements must not be told.
   */
  const [historyInPortal, setHistoryInPortal] = useState(false);
  /**
   * Which processor owns the subscription, from the same invoices response.
   * PlanUpgradeSection uses it to route a plan change to the right flow —
   * undefined until the fetch lands, and the section resolves it itself then.
   */
  const [processor, setProcessor] = useState<'stripe' | 'dodo' | null | undefined>(undefined);

  /**
   * THE-259 — the live tier, which the mount-time billing snapshot must not
   * shadow.
   *
   * 🔴 WHY THIS PAGE HAD TO CHANGE WHEN THE RELOAD WENT. `subscription.plan` is
   * not a second fact about the tier: `/api/billing/invoices` reads it straight
   * off `tenants/{id}.plan`, the SAME field the context re-reads. The
   * difference is age — this page fetches once, on mount (`[]`), so
   * `subscription.plan` is a snapshot, and it sat AHEAD of the live value in
   * the `planId` chain below. That is what the `window.location.reload()` in
   * `PlanUpgradeSection` was really refreshing: drop the reload without this
   * and the bounded re-read would move the context while the card kept
   * rendering the pre-purchase tier off a stale snapshot — the ticket's own bug
   * with an extra step.
   *
   * `useTenantOptional` keeps every suite that renders this page bare working
   * unchanged: with no provider there is no context tier and the chain below is
   * exactly what it was.
   */
  const tenant = useTenantOptional();

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
          setHistoryInPortal(data.historySource === 'portal');
          setProcessor(data.processor === 'dodo' ? 'dodo' : data.processor === 'stripe' ? 'stripe' : null);
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

  /**
   * The live tier wins over the snapshot — but only when it is THIS tenant's.
   *
   * The identity guard is not hypothetical bookkeeping: `tenantId` arrives as a
   * prop while the context resolves its own tenant, and rendering one church's
   * tier against another's billing page is the one failure worse than showing a
   * stale one. When the context has no tier yet (still loading, or platform
   * context where it is undefined) the chain falls through to exactly what it
   * was before.
   */
  const contextPlan =
    tenant && (!tenantId || !tenant.tenantId || tenant.tenantId === tenantId)
      ? tenant.tenantPlan
      : undefined;
  const planId = contextPlan ?? ((subscription?.plan as TenantPlan) || currentPlan);
  const planLabel = planId ? getPlanDisplayName(planId) : '—';
  const status = subscription?.status || null;
  // Nothing to upgrade to on the top tier. Derived from PLAN_ORDER via TOP_PLAN
  // rather than naming a tier, so a future tier change moves it automatically.
  const isTopPlan = planId === TOP_PLAN;

  if (loading) {
    return (
      <div className={`${FORM_CONTAINER} flex items-center justify-center h-40`}>
        <Loader2 size={28} className="animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }

  /* ── The container ────────────────────────────────────────────────────────
     This screen is a full-viewport overlay (AdminDashboard renders it inside a
     `fixed inset-0` panel with `p-4 lg:p-6`), NOT the sidebar shell, so at
     1440px it has 1396.5px to lay out in.

     It used to cap itself at `max-w-3xl` — an invented width, and one whose
     number is not the number it reads as: 48rem is 768px on a tablet but 696px
     from 1024px up, where globals.css trims the rem base to 14.5px. 696px is
     what clipped the third plan card (see PlanUpgradeSection). Rule 1a's page
     measure is what this screen actually is — a data-dense page, an invoice
     table and a three-up plan comparison — so it takes FORM_CONTAINER rather
     than minting a fourth width. Below `sm:` the rule applies nothing, and the
     classes it replaces were already inert there (`max-w-3xl` is wider than any
     phone, `mx-auto` on a full-width block does nothing), so the phone
     rendering is untouched. */
  return (
    <div className={`${FORM_CONTAINER} space-y-6`}>
      {error && (
        <div className="p-3 rounded-xl text-sm flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-100">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* 1 + 2: Current plan / status / next billing */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-surface-raised rounded-2xl p-4 border border-line shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={16} style={{ color: GOLD }} />
            <span className="text-xs text-muted font-medium">Current Plan</span>
          </div>
          <div className="text-2xl font-bold text-strong">{planLabel}</div>
          {status && (
            <span className={`inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusPill(status)}`}>
              {status}
            </span>
          )}
        </div>
        <div className="bg-surface-raised rounded-2xl p-4 border border-line shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock size={16} style={{ color: GOLD }} />
            <span className="text-xs text-muted font-medium">
              {subscription?.cancelAtPeriodEnd ? 'Access Until' : 'Next Billing'}
            </span>
          </div>
          {subscription?.currentPeriodEnd ? (
            <>
              <div className="text-2xl font-bold text-strong">{fmtDate(subscription.currentPeriodEnd)}</div>
              {!subscription.cancelAtPeriodEnd && subscription.nextAmount != null && (
                <p className="text-sm text-muted mt-1">{fmtMoney(subscription.nextAmount, subscription.currency)}</p>
              )}
              {subscription.cancelAtPeriodEnd && (
                <p className="text-sm text-amber-600 mt-1">Cancels at period end</p>
              )}
            </>
          ) : (
            <div className="text-sm text-faint">No active subscription</div>
          )}
        </div>
      </div>

      {/* 3: Upgrade / Cancel — reuses PlanUpgradeSection; upgrade UI hidden on Ministry */}
      <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
        <PlanUpgradeSection
          currentPlan={planId}
          tenantId={tenantId}
          email={email}
          hideUpgrade={isTopPlan}
          processor={processor}
        />
      </div>

      {/* 4: Add-ons — the canonical purchase surface (REP-5b). Renders nothing
          for a Stripe tenant, and nothing when this environment can sell no
          add-ons; the offer list is derived server-side from the active add-on
          table, never from a list held here. */}
      <AddOnsSection tenantId={tenantId} processor={processor} />

      {/* 5: Payment history — links to Stripe's own hosted invoice PDFs */}
      <div>
        <h3 className="text-sm font-bold text-body mb-3 font-display">Payment History</h3>
        {invoices.length === 0 ? (
          <div className="text-center py-12 text-faint bg-surface-raised rounded-2xl border border-line">
            <FileText size={36} className="mx-auto mb-2 opacity-30" />
            {historyInPortal ? (
              <p className="text-sm px-6">
                Your invoices and receipts are held by our payment processor. Open{' '}
                <span className="font-semibold">Manage subscription</span> above to view and download them.
              </p>
            ) : (
              <p className="text-sm">No payments yet.</p>
            )}
          </div>
        ) : (
          <div className="bg-surface-raised rounded-2xl border border-line shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted uppercase tracking-wider">Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-sunken transition-colors">
                      <td className="px-4 py-3 text-muted whitespace-nowrap">{fmtDate(inv.date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-strong">{fmtMoney(inv.amount, inv.currency)}</td>
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
                          <span className="text-stone-300">—</span>
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

      {/* 6: Generate consolidated billing-summary PDF (pdf-lib, admin-facing) */}
      <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
        <h3 className="text-sm font-bold text-body mb-1 font-display">Billing Statement</h3>
        <p className="text-sm text-muted mb-4">
          {historyInPortal
            ? 'Your payment history is held by our payment processor — open “Manage subscription” above to download your invoices and receipts.'
            : 'Download a consolidated PDF summary of your plan and all subscription payments.'}
        </p>
        <button
          onClick={handleGenerateStatement}
          // Disabled rather than hidden: the owner can see the capability exists
          // and the sentence above says where it moved to. The server refuses this
          // request anyway (409) — this just stops them having to find that out.
          disabled={generating || historyInPortal}
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
