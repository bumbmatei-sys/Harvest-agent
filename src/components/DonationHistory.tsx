"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, HeartHandshake, Download, Receipt, Loader2 } from 'lucide-react';
import { auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { authFetch } from '../utils/auth-fetch';
import { formatCents, type DonationReceiptRow, type DonationTotals } from '../lib/donation-history';

const BRAND = 'var(--brand-color, #B8962E)';

interface DonationHistoryResponse {
  receipts: DonationReceiptRow[];
  totals: DonationTotals;
}

interface DonationHistoryProps {
  onBack: () => void;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return 'Date unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unavailable';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Member-facing "Donation History": lists the signed-in member's OWN donation
 * receipts (served by the authed /api/donation-history route, matched to their
 * verified email) with lifetime + per-year giving totals and a per-receipt PDF
 * download via a short-lived signed url. Mirrors UserEvents' shell + card styling.
 */
const DonationHistory: React.FC<DonationHistoryProps> = ({ onBack }) => {
  const [receipts, setReceipts] = useState<DonationReceiptRow[]>([]);
  const [totals, setTotals] = useState<DonationTotals>({ lifetimeCents: 0, byYear: {}, count: 0 });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Invoice id currently being downloaded (disables its button + shows a spinner).
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const tid = await getTenantScope();
        if (cancelled) return;
        if (!tid) { setLoading(false); return; }
        setTenantId(tid);

        const resp = await authFetch(`/api/donation-history?tenantId=${encodeURIComponent(tid)}`)
          .catch(() => null);
        if (cancelled) return;
        if (!resp || !resp.ok) {
          setError('Could not load your donation history. Please try again.');
          return;
        }
        const data = (await resp.json().catch(() => null)) as DonationHistoryResponse | null;
        if (cancelled) return;
        setReceipts(Array.isArray(data?.receipts) ? data!.receipts : []);
        if (data?.totals) setTotals(data.totals);
      } catch (e) {
        console.error('Donation history load failed:', e);
        if (!cancelled) setError('Could not load your donation history. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleDownload = async (row: DonationReceiptRow) => {
    if (!tenantId || downloadingId) return;
    setDownloadingId(row.id);
    setDownloadError(null);
    try {
      const resp = await authFetch('/api/donation-history/download', {
        method: 'POST',
        body: JSON.stringify({ tenantId, invoiceId: row.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.url) {
        // Open the short-lived signed url in a new tab to view/save the PDF.
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        setDownloadError(data.error || 'Could not open that receipt. Please try again.');
      }
    } catch (e) {
      console.error('Receipt download failed:', e);
      setDownloadError('Could not open that receipt. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Years present, newest first, for the per-year totals strip.
  const years = Object.keys(totals.byYear).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="flex flex-col min-h-full h-full bg-cream overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[760px] lg:mx-auto">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-stone-100">
            <ArrowLeft size={18} className="text-warm-brown" />
          </button>
          <h2 className="font-display text-lg font-normal tracking-[-0.01em] text-earth">Donation History</h2>
        </div>
      </div>

      <div className="flex-1 p-4 lg:max-w-[760px] lg:mx-auto lg:w-full">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <Receipt size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">{error}</p>
          </div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <HeartHandshake size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No donations yet</p>
            <p className="text-sm mt-1">Your giving receipts will show up here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Lifetime + per-year totals summary. */}
            <div className="bg-white rounded-3xl shadow-sm border border-stone-200 p-5">
              <p className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase">
                Total given
              </p>
              <p className="font-display text-3xl font-light tracking-[-0.01em] mt-1" style={{ color: BRAND }}>
                {formatCents(totals.lifetimeCents)}
              </p>
              {years.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {years.map((y) => (
                    <div key={y} className="rounded-xl bg-wheat-50 border border-wheat-100 px-3 py-1.5">
                      <span className="text-xs font-semibold text-warm-brown">{y}</span>
                      <span className="text-xs font-bold text-earth ml-2">{formatCents(totals.byYear[y])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {downloadError && (
              <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600 font-medium">
                {downloadError}
              </div>
            )}

            {/* Receipt list. */}
            <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden">
              {receipts.map((r, i) => (
                <div key={r.id}>
                  {i > 0 && <div className="h-px bg-stone-100 mx-4" />}
                  <div className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-wheat-100">
                        <HeartHandshake size={16} className="text-wheat-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-earth truncate">{r.description}</p>
                        <p className="text-xs text-warm-brown truncate">
                          {fmtDate(r.date)}
                          {r.tenantName ? ` · ${r.tenantName}` : ''}
                        </p>
                        {r.receiptNumber && (
                          <p className="text-[10px] text-[color:var(--text-faint)] truncate">{r.receiptNumber}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* amountCents is CENTS — formatCents divides by 100. */}
                      <span className="text-sm font-bold text-earth">{formatCents(r.amountCents)}</span>
                      {r.hasPdf && (
                        <button
                          onClick={() => handleDownload(r)}
                          disabled={downloadingId === r.id}
                          aria-label={`Download receipt ${r.receiptNumber || ''}`.trim()}
                          className="w-9 h-9 rounded-full flex items-center justify-center border border-stone-200 hover:bg-stone-100 transition-colors disabled:opacity-50"
                          style={{ color: BRAND }}
                        >
                          {downloadingId === r.id
                            ? <Loader2 size={16} className="animate-spin" />
                            : <Download size={16} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DonationHistory;
