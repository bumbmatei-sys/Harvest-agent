"use client";
import React, { useState, useEffect } from 'react';
import { Receipt, TrendingUp, Download, Search, Filter, ArrowUpRight, FileText, Lock, ChevronRight, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, limit, Timestamp
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { useTenantOptional } from '../contexts/TenantContext';

interface Invoice {
  id: string;
  type: 'donation_receipt' | 'event_ticket' | 'invoice';
  recipientName: string;
  recipientEmail: string;
  amount: number;
  currency: string;
  description: string;
  relatedId: string;
  receiptNumber: string;
  issuedAt: Timestamp | null;
  tenantName: string;
  pdfUrl: string | null;
  status: 'pending' | 'generated' | 'sent';
}

const TYPE_LABELS: Record<Invoice['type'], string> = {
  donation_receipt: 'Donation Receipt',
  event_ticket: 'Event Ticket',
  invoice: 'Invoice',
};

const TYPE_COLORS: Record<Invoice['type'], string> = {
  donation_receipt: 'bg-amber-100 text-amber-700',
  event_ticket: 'bg-blue-100 text-blue-700',
  invoice: 'bg-purple-100 text-purple-700',
};

const STATUS_COLORS: Record<Invoice['status'], string> = {
  pending: 'bg-gray-100 text-gray-500',
  generated: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
};

const fmt = (n: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(n);

const fmtDate = (ts: Timestamp | null) => {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const AdminAccounting: React.FC = () => {
  const ctx = useTenantOptional();
  const isTaxReceiptsEnabled = ctx?.planFeatures?.taxReceipt ?? true;

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | Invoice['type']>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');

  // Annual receipt generation state
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleGenerateAnnualReceipts = async () => {
    if (!tenantId) return;
    const year = yearFilter !== 'all' ? Number(yearFilter) : new Date().getFullYear();
    setGenerating(true);
    setGenResult(null);
    try {
      const fn = httpsCallable(getFunctions(), 'generateAnnualReceipts');
      const result = await fn({ year, tenantId });
      const data = result.data as any;
      if (data.generated > 0) {
        const msg = data.sent > 0
          ? `Generated ${data.generated} receipts — emailed ${data.sent} donor(s)`
          : `Generated ${data.generated} receipt PDFs (not emailed — no Resend key)`;
        setGenResult({ ok: true, msg });
      } else {
        setGenResult({ ok: false, msg: data.message || `No donation records found for ${year}` });
      }
    } catch (err: any) {
      setGenResult({ ok: false, msg: err.message || 'Failed to generate receipts' });
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    getTenantScope().then(tid => {
      if (cancelled) return;
      setTenantId(tid);
      if (!tid) { setLoading(false); return; }
      const q = query(
        collection(db, 'tenants', tid, 'invoices'),
        orderBy('issuedAt', 'desc'),
        limit(500)
      );
      unsub = onSnapshot(q, snap => {
        setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice));
        setLoading(false);
      }, err => {
        try { handleFirestoreError(err, OperationType.GET, 'invoices'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  const now = new Date();
  const thisMonth = invoices.filter(inv => {
    if (!inv.issuedAt) return false;
    const d = inv.issuedAt.toDate();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisYear = invoices.filter(inv => {
    if (!inv.issuedAt) return false;
    return inv.issuedAt.toDate().getFullYear() === now.getFullYear();
  });

  const totalThisMonth = thisMonth.reduce((s, i) => s + i.amount, 0);
  const totalThisYear = thisYear.reduce((s, i) => s + i.amount, 0);
  const sentCount = invoices.filter(i => i.status === 'sent').length;

  const availableYears = [...new Set(
    invoices
      .filter(i => i.issuedAt)
      .map(i => i.issuedAt!.toDate().getFullYear().toString())
  )].sort((a, b) => Number(b) - Number(a));

  const filtered = invoices.filter(inv => {
    const matchType = typeFilter === 'all' || inv.type === typeFilter;
    const matchYear = yearFilter === 'all' || (inv.issuedAt && inv.issuedAt.toDate().getFullYear().toString() === yearFilter);
    const matchSearch = !search ||
      inv.recipientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.recipientEmail.toLowerCase().includes(search.toLowerCase()) ||
      inv.receiptNumber.toLowerCase().includes(search.toLowerCase());
    return matchType && matchYear && matchSearch;
  });

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Receipt size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
        <h2 className="text-xl font-bold text-gray-900">Accounting</h2>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} style={{ color: 'var(--brand-color, #d4a017)' }} />
            <span className="text-xs text-gray-500 font-medium">This Month</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{fmt(totalThisMonth)}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpRight size={16} className="text-green-500" />
            <span className="text-xs text-gray-500 font-medium">This Year</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{fmt(totalThisYear)}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={16} className="text-blue-500" />
            <span className="text-xs text-gray-500 font-medium">Receipts Sent</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{sentCount}</div>
        </div>
      </div>

      {/* Tax Receipts Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">Tax Receipts</h3>
          {!isTaxReceiptsEnabled && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
              <Lock size={10} /> Ministry plan required
            </span>
          )}
        </div>
        {isTaxReceiptsEnabled ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-600 mb-4">
              Generate year-end consolidated tax receipts for all donors. Each donor receives one PDF summarizing their total donations for the year.
            </p>
            <div className="flex gap-3">
              <select
                value={yearFilter}
                onChange={e => setYearFilter(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#d4a017] bg-white"
              >
                <option value="all">All Years</option>
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
                onClick={handleGenerateAnnualReceipts}
                disabled={generating}
              >
                {generating ? (
                  <><Loader2 size={15} className="animate-spin" /> Generating...</>
                ) : (
                  <><FileText size={15} /> Generate Annual Receipts</>
                )}
              </button>
            </div>
            {genResult && (
              <div className={`mt-3 p-3 rounded-xl text-sm flex items-center gap-2 ${
                genResult.ok ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
              }`}>
                {genResult.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {genResult.msg}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 flex items-start gap-3">
            <Lock size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Tax receipt generation requires the Ministry plan</p>
              <p className="text-xs text-amber-600 mt-0.5">Upgrade to generate and email year-end tax receipts to all donors.</p>
            </div>
          </div>
        )}
      </div>

      {/* Invoices List */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3">Invoice History</h3>
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email or receipt #..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white">
            <option value="all">All Types</option>
            <option value="donation_receipt">Donation Receipts</option>
            <option value="event_ticket">Event Tickets</option>
            <option value="invoice">Invoices</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Receipt size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">{search || typeFilter !== 'all' ? 'No invoices match' : 'No invoices yet'}</p>
            <p className="text-sm mt-1">Invoices are created automatically when donations and event registrations are processed</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Recipient</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(inv.issuedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 text-sm">{inv.recipientName}</div>
                        <div className="text-xs text-gray-400">{inv.recipientEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[inv.type]}`}>
                          {TYPE_LABELS[inv.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(inv.amount, inv.currency)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {inv.pdfUrl && (
                            <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer"
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500" title="Download PDF">
                              <Download size={13} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminAccounting;
