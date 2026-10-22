"use client";

import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarClock, Download, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';
import AddOnsSection from './AddOnsSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface BillingInvoice {
  id: string;
  date: number;
  amount: number;
  currency: string;
  status: string | null;
  invoicePdf: string | null;
  hostedUrl: string | null;
}

interface BillingSubscription {
  status: string | null;
  currentPeriodEnd: number | null;
  nextAmount: number | null;
  currency: string;
  cancelAtPeriodEnd: boolean;
}

const fmtMoney = (minor: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(minor / 100);

const fmtDate = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const GOOD_STATUSES = new Set(['active', 'paid']);
const WARN_STATUSES = new Set(['past_due', 'open', 'uncollectible']);

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  const variant = GOOD_STATUSES.has(s) ? 'secondary' : WARN_STATUSES.has(s) ? 'destructive' : 'outline';
  return <Badge variant={variant}>{status || 'unknown'}</Badge>;
}

/**
 * The parts of Billing & Payments that the Plan & billing pane did not carry:
 * next billing date, add-ons, payment history and the billing-summary PDF.
 * Reads the same owner-only /api/billing/* routes as the Billing & Payments
 * overlay, so the owner gate lives on the caller (`canUpgrade`).
 */
export default function BillingActivity({ tenantId }: { tenantId?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [historyInPortal, setHistoryInPortal] = useState(false);
  const [processor, setProcessor] = useState<'stripe' | 'dodo' | null | undefined>(undefined);
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
          setHistoryInPortal(data.historySource === 'portal');
          setProcessor(data.processor === 'dodo' ? 'dodo' : data.processor === 'stripe' ? 'stripe' : null);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load billing information');
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
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate statement');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center" data-testid="billing-activity-loading">
        <Loader2 size={24} className="animate-spin text-gold" />
      </div>
    );
  }

  // A failed read is not an empty history: say it could not load and draw nothing else.
  if (error) {
    return (
      <Alert variant="destructive" data-testid="billing-activity-error">
        <AlertCircle size={16} />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="billing-activity">
      {subscription?.currentPeriodEnd ? (
        <Item variant="outline" className="gap-4 px-4 py-4" data-testid="billing-next-date">
          <ItemMedia variant="icon">
            <CalendarClock size={18} className="text-gold" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="text-sm font-semibold text-strong">
              {subscription.cancelAtPeriodEnd ? 'Access until' : 'Next billing'} {fmtDate(subscription.currentPeriodEnd)}
              {subscription.status && <StatusBadge status={subscription.status} />}
            </ItemTitle>
            <ItemDescription className="text-xs text-muted">
              {subscription.cancelAtPeriodEnd
                ? 'Cancels at period end'
                : subscription.nextAmount != null
                  ? fmtMoney(subscription.nextAmount, subscription.currency)
                  : null}
            </ItemDescription>
          </ItemContent>
        </Item>
      ) : null}

      <AddOnsSection tenantId={tenantId} processor={processor} />

      <section aria-labelledby="settings-billing-history" className="space-y-3" data-testid="billing-history">
        <h3 id="settings-billing-history" className="font-display text-base font-semibold text-strong">
          Payment history
        </h3>
        {invoices.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>{historyInPortal ? 'History is with our payment processor' : 'No payments yet'}</EmptyTitle>
              {historyInPortal && (
                <EmptyDescription>
                  Your invoices and receipts are held by our payment processor. Open Manage above to view and download them.
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const href = inv.invoicePdf || inv.hostedUrl;
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="whitespace-nowrap text-muted">{fmtDate(inv.date)}</TableCell>
                      <TableCell className="text-right font-semibold text-strong">{fmtMoney(inv.amount, inv.currency)}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell className="text-right">
                        {href ? (
                          <Button
                            variant="link"
                            size="sm"
                            nativeButton={false}
                            render={<a href={href} target="_blank" rel="noopener noreferrer" />}
                            className="min-h-[44px] sm:min-h-0"
                          >
                            <ExternalLink /> PDF
                          </Button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="settings-billing-statement" className="space-y-2" data-testid="billing-statement">
        <h3 id="settings-billing-statement" className="font-display text-base font-semibold text-strong">
          Billing statement
        </h3>
        <p className="text-sm text-muted">
          {historyInPortal
            ? 'Your payment history is held by our payment processor. Open Manage above to download your invoices and receipts.'
            : 'Download a consolidated PDF summary of your plan and all subscription payments.'}
        </p>
        <Button
          variant="outline"
          onClick={handleGenerateStatement}
          disabled={generating || historyInPortal}
          className="min-h-[44px] sm:min-h-0"
        >
          {generating ? <><Loader2 className="animate-spin" /> Generating…</> : <><Download /> Generate statement</>}
        </Button>
        {genError && (
          <Alert variant="destructive">
            <AlertCircle size={16} />
            <AlertDescription>{genError}</AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  );
}
