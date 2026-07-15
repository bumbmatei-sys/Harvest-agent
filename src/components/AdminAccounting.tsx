"use client";
import React, { useState, useEffect } from 'react';
import { Receipt, TrendingUp, Download, Search, DollarSign, FileText, Lock, Loader2, CheckCircle, AlertCircle, RefreshCw, ExternalLink, Link2 } from 'lucide-react';
import {
  collection, query, orderBy, onSnapshot, limit
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { toSafeDate, type DateLike } from '../utils/format-date';
import { getWriteTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { useTenantOptional } from '../contexts/TenantContext';
import { authFetch } from '../utils/auth-fetch';
import { openStatementPdf } from '../utils/open-statement-pdf';
import AdminGivingStatements from './AdminGivingStatements';

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
  // ISO string (donation webhook / event receipts) OR Timestamp — normalize before formatting.
  issuedAt: DateLike;
  tenantName: string;
  pdfUrl: string | null;
  pdfPath?: string | null;
  status: 'pending' | 'generated' | 'sent';
  quickbooksSyncStatus?: 'synced' | 'failed' | null;
  quickbooksReceiptId?: string | null;
}

interface GivingStatement {
  id: string;
  donorId: string;
  donorEmail: string;
  donorName: string;
  year: number;
  totalAmount: number; // cents
  donationCount: number;
  pdfPath?: string | null;
  sentAt?: string | null;
  status: 'generated' | 'sent' | 'failed';
}

const TYPE_LABELS: Record<Invoice['type'], string> = {
  donation_receipt: 'Donation Receipt',
  event_ticket: 'Event Ticket',
  invoice: 'Invoice',
};

const TYPE_COLORS: Record<Invoice['type'], string> = {
  donation_receipt: 'bg-wheat-100 text-wheat-700',
  event_ticket: 'bg-sky-100 text-sky-700',
  invoice: 'bg-purple-100 text-purple-700',
};

const STATUS_COLORS: Record<Invoice['status'], string> = {
  pending: 'bg-stone-100 text-warm-brown',
  generated: 'bg-field-100 text-field-700',
  sent: 'bg-sky-100 text-sky-700',
};

const fmt = (n: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(n);

const fmtDate = (ts: DateLike) => {
  // The donation-receipt webhook writes issuedAt as an ISO string, so a bare
  // .toDate() here throws the same "e.toDate is not a function" that crashed the CRM.
  const d = toSafeDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

interface AdminAccountingProps {
  /** Admin holds manageAccounting (or full access). Defaults true when unset. */
  canManageAccounting?: boolean;
  /** Admin holds manageGivingStatements (or full access). Defaults true when unset. */
  canManageStatements?: boolean;
}

const AdminAccounting: React.FC<AdminAccountingProps> = ({ canManageAccounting = true, canManageStatements = true }) => {
  const ctx = useTenantOptional();
  const isTaxReceiptsEnabled = ctx?.planFeatures?.taxReceipt ?? true;
  const isQbEnabled = ctx?.planFeatures?.accountingTools ?? true;

  // Statements is now nested here as a sub-tab. Each keeps its own gate combining
  // the plan feature AND the admin's permission: Accounting behind accountingTools
  // + manageAccounting, Statements behind givingStatements + manageGivingStatements.
  // If only one is available, only that tab is shown (and forced active).
  const accountingEnabled = (ctx?.planFeatures?.accountingTools ?? true) && canManageAccounting;
  const statementsEnabled = (ctx?.planFeatures?.givingStatements ?? true) && canManageStatements;
  const [subTab, setSubTab] = useState<'accounting' | 'statements'>('accounting');
  const showBothSubTabs = accountingEnabled && statementsEnabled;
  const activeSubTab = !accountingEnabled ? 'statements' : !statementsEnabled ? 'accounting' : subTab;

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | Invoice['type']>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');

  // Annual receipt generation state
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // QuickBooks integration state
  const [qbConnected, setQbConnected] = useState(false);
  const [qbCompany, setQbCompany] = useState<string | null>(null);
  const [qbLoading, setQbLoading] = useState(true);
  const [qbConnecting, setQbConnecting] = useState(false);
  const [qbSyncing, setQbSyncing] = useState(false);
  const [qbLastSyncedAt, setQbLastSyncedAt] = useState<string | null>(null);
  const [qbSyncMsg, setQbSyncMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Giving statements state
  const [statements, setStatements] = useState<GivingStatement[]>([]);
  const [statementYear, setStatementYear] = useState<number>(new Date().getFullYear());
  const [genStatements, setGenStatements] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [resendingDonor, setResendingDonor] = useState<string | null>(null);
  const [statementsMsg, setStatementsMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  const runStatements = async (opts: { send: boolean; donorEmail?: string }) => {
    setStatementsMsg(null);
    try {
      const resp = await authFetch('/api/giving-statements/generate', {
        method: 'POST',
        body: JSON.stringify({ year: statementYear, send: opts.send, ...(opts.donorEmail ? { donorEmail: opts.donorEmail } : {}) }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatementsMsg({ ok: false, msg: data.error || 'Failed to generate statements' });
        return;
      }
      if (data.totalDonors === 0) {
        setStatementsMsg({ ok: false, msg: data.message || `No donations found for ${statementYear}` });
        return;
      }
      const emailNote = opts.send
        ? (data.emailConfigured ? ` — emailed ${data.sent}` : ' (email not configured)')
        : '';
      setStatementsMsg({ ok: true, msg: `Generated ${data.generated} statement(s)${emailNote}` });
    } catch (e: any) {
      setStatementsMsg({ ok: false, msg: e?.message || 'Failed to generate statements' });
    }
  };

  const handleGenerateStatements = async () => {
    setGenStatements(true);
    await runStatements({ send: false });
    setGenStatements(false);
  };

  const handleSendAll = async () => {
    setSendingAll(true);
    await runStatements({ send: true });
    setSendingAll(false);
  };

  const handleResendStatement = async (donorEmail: string) => {
    setResendingDonor(donorEmail);
    await runStatements({ send: true, donorEmail });
    setResendingDonor(null);
  };

  const loadQbStatus = async () => {
    try {
      const resp = await authFetch('/api/composio/quickbooks/status');
      if (resp.ok) {
        const data = await resp.json();
        setQbConnected(!!data.connected);
        setQbCompany(data.companyName || null);
      }
    } catch (e) {
      console.warn('Failed to load QuickBooks status:', e);
    } finally {
      setQbLoading(false);
    }
  };

  useEffect(() => {
    loadQbStatus();
  }, []);

  const handleConnectQb = async () => {
    setQbConnecting(true);
    try {
      const resp = await authFetch('/api/composio/quickbooks/connect', { method: 'POST', body: '{}' });
      const data = await resp.json();
      if (resp.ok && data.redirectUrl) {
        window.open(data.redirectUrl, '_blank', 'noopener');
        // Poll for connection completion (up to ~2 min)
        let tries = 0;
        const poll = setInterval(async () => {
          tries++;
          try {
            const s = await authFetch('/api/composio/quickbooks/status');
            const sd = await s.json();
            if (sd.connected) {
              setQbConnected(true);
              setQbCompany(sd.companyName || null);
              clearInterval(poll);
              setQbConnecting(false);
            }
          } catch { /* keep polling */ }
          if (tries >= 40) { clearInterval(poll); setQbConnecting(false); }
        }, 3000);
      } else {
        alert(data.error || 'Failed to start QuickBooks connection');
        setQbConnecting(false);
      }
    } catch (e) {
      console.error('QuickBooks connect error:', e);
      alert('Failed to connect QuickBooks. Please try again.');
      setQbConnecting(false);
    }
  };

  const handleDisconnectQb = async () => {
    if (!confirm('Disconnect QuickBooks? Synced receipts will remain in QuickBooks.')) return;
    try {
      await authFetch('/api/composio/quickbooks/disconnect', { method: 'POST', body: '{}' });
      setQbConnected(false);
      setQbCompany(null);
    } catch (e) {
      console.error('QuickBooks disconnect error:', e);
    }
  };

  const handleSyncNow = async (invoiceId?: string) => {
    if (invoiceId) setRetryingId(invoiceId); else setQbSyncing(true);
    setQbSyncMsg(null);
    try {
      const resp = await authFetch('/api/quickbooks/sync', {
        method: 'POST',
        body: JSON.stringify(invoiceId ? { invoiceId } : {}),
      });
      const data = await resp.json();
      if (resp.ok) {
        setQbLastSyncedAt(new Date().toISOString());
        setQbSyncMsg({
          ok: data.failed === 0,
          msg: invoiceId
            ? (data.synced > 0 ? 'Invoice synced to QuickBooks' : 'Failed to sync invoice')
            : `Synced ${data.synced} • ${data.failed} failed`,
        });
      } else {
        setQbSyncMsg({ ok: false, msg: data.error || 'Sync failed' });
      }
    } catch (e: any) {
      setQbSyncMsg({ ok: false, msg: e?.message || 'Sync failed' });
    } finally {
      setQbSyncing(false);
      setRetryingId(null);
    }
  };

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
    // Resolve write-aware: this tenantId drives the scoped receipt-generation
    // action (generateAnnualReceipts) as well as the invoice/statement lists, so
    // a super admin on the apex must operate as the platform tenant rather than
    // null (which would no-op the whole screen). On a subdomain the host tenant
    // takes precedence, unchanged.
    getWriteTenantScope().then(tid => {
      if (cancelled) return;
      setTenantId(tid);
      if (!tid) { setLoading(false); return; }
      const q = query(
        collection(db, 'tenants', tid, 'invoices'),
        orderBy('issuedAt', 'desc'),
        limit(500)
      );
      unsub = onSnapshot(q, snap => {
        // Invoices store `amount` in CENTS (written by the Stripe webhook:
        // `amount: amountCents`). Normalize to DOLLARS once here so every
        // downstream sum (This Month / This Year) and every render of an invoice
        // amount works in dollars — matching how giving-statements and the
        // annual-receipt function already divide by 100. (Before this, cents were
        // formatted as dollars, so $105,500 showed as $10,550,000.) The separate
        // givingStatements collection has its own `totalAmount` field, still
        // divided at its own render site, so it is unaffected.
        setInvoices(snap.docs.map(d => {
          const data = d.data() as Omit<Invoice, 'id'>;
          return { id: d.id, ...data, amount: (data.amount || 0) / 100 } as Invoice;
        }));
        setLoading(false);
      }, err => {
        try { handleFirestoreError(err, OperationType.GET, 'invoices'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  // Subscribe to giving statements for the selected year
  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'givingStatements'),
      orderBy('generatedAt', 'desc'),
      limit(1000)
    );
    const unsub = onSnapshot(q, snap => {
      setStatements(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GivingStatement));
    }, err => {
      try { handleFirestoreError(err, OperationType.GET, 'givingStatements'); } catch (e) { console.error(e); }
    });
    return () => unsub();
  }, [tenantId]);

  const yearStatements = statements.filter(s => s.year === statementYear);

  const now = new Date();
  const thisMonth = invoices.filter(inv => {
    const d = toSafeDate(inv.issuedAt);
    if (!d) return false;
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisYear = invoices.filter(inv => {
    const d = toSafeDate(inv.issuedAt);
    return !!d && d.getFullYear() === now.getFullYear();
  });

  const totalThisMonth = thisMonth.reduce((s, i) => s + i.amount, 0);
  const totalThisYear = thisYear.reduce((s, i) => s + i.amount, 0);
  const sentCount = invoices.filter(i => i.status === 'sent').length;

  const availableYears = [...new Set(
    invoices
      .map(i => toSafeDate(i.issuedAt))
      .filter((d): d is Date => d != null)
      .map(d => d.getFullYear().toString())
  )].sort((a, b) => Number(b) - Number(a));

  const filtered = invoices.filter(inv => {
    const matchType = typeFilter === 'all' || inv.type === typeFilter;
    const issuedDate = toSafeDate(inv.issuedAt);
    const matchYear = yearFilter === 'all' || (!!issuedDate && issuedDate.getFullYear().toString() === yearFilter);
    const matchSearch = !search ||
      inv.recipientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.recipientEmail.toLowerCase().includes(search.toLowerCase()) ||
      inv.receiptNumber.toLowerCase().includes(search.toLowerCase());
    return matchType && matchYear && matchSearch;
  });

  // Native pill segmented control (matches the CRM Contacts/Analytics toggle).
  const subTabBar = showBothSubTabs ? (
    <div className="flex gap-1 bg-stone-100 rounded-xl p-1 mb-5 w-fit">
      <button
        onClick={() => setSubTab('accounting')}
        className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          activeSubTab === 'accounting' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
        }`}
      >
        Accounting
      </button>
      <button
        onClick={() => setSubTab('statements')}
        className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          activeSubTab === 'statements' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
        }`}
      >
        Statements
      </button>
    </div>
  ) : null;

  // Statements sub-tab — the standalone giving-statements screen.
  if (activeSubTab === 'statements') {
    return (
      <div className="max-w-4xl mx-auto">
        {subTabBar}
        <AdminGivingStatements />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        {subTabBar}
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {subTabBar}

      {/* Mobile: no in-content page title — the shell's mobile header already
          renders "Accounting", so an H1 here would duplicate it. */}

      {/* Summary Cards — mobile: 2-col stat cards with gold icon disc + serif
          value (mockup StatRow). Same computed totals as the desktop grid;
          no delta shown (the screen has no period-over-period data). */}
      <div className="lg:hidden grid grid-cols-2 gap-2.5 mb-6">
        {[
          { label: 'This Month', value: fmt(totalThisMonth), icon: <TrendingUp size={14} /> },
          { label: 'This Year', value: fmt(totalThisYear), icon: <DollarSign size={14} /> },
          { label: 'Receipts Sent', value: sentCount, icon: <FileText size={14} /> },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] p-3.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--surface-gold)] text-gold flex items-center justify-center mb-2">{s.icon}</div>
            <div className="font-display text-[1.375rem] font-normal leading-none tracking-[-0.02em] text-earth">{s.value}</div>
            <div className="text-[11px] text-warm-brown mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="hidden lg:grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'This Month', value: fmt(totalThisMonth), icon: <TrendingUp size={15} /> },
          { label: 'This Year', value: fmt(totalThisYear), icon: <DollarSign size={15} /> },
          { label: 'Receipts Sent', value: sentCount, icon: <FileText size={15} /> },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-brand-lg p-5 border border-stone-200 shadow-[var(--ds-sh-sm)]">
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">{s.label}</span>
              <span className="text-stone-300">{s.icon}</span>
            </div>
            <div className="font-display text-[2rem] font-light text-earth mt-2 leading-none">{s.value}</div>
          </div>
        ))}
      </div>

      {/* QuickBooks Section */}
      {isQbEnabled && (
        <div className="mb-6">
          <p className="lg:hidden text-[11px] font-bold uppercase tracking-[0.14em] text-gold mb-3">QuickBooks</p>
          <h3 className="hidden lg:block font-display text-xl font-normal text-earth mb-4">QuickBooks</h3>
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
            {qbLoading ? (
              <div className="flex items-center gap-2 text-sm text-[color:var(--text-faint)]"><Loader2 size={15} className="animate-spin" /> Checking connection…</div>
            ) : qbConnected ? (
              <div>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-field-600" />
                    <span className="text-sm font-medium text-earth">Connected{qbCompany ? ` — ${qbCompany}` : ''}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href="https://qbo.intuit.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100"
                    >
                      <ExternalLink size={14} /> Open QB
                    </a>
                    <button
                      onClick={() => handleSyncNow()}
                      disabled={qbSyncing}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
                    >
                      {qbSyncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync Now</>}
                    </button>
                    <button onClick={handleDisconnectQb} className="px-3 py-2 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50">
                      Disconnect
                    </button>
                  </div>
                </div>
                {qbLastSyncedAt && (
                  <p className="text-xs text-[color:var(--text-faint)] mt-2">Last synced {new Date(qbLastSyncedAt).toLocaleString()}</p>
                )}
                {qbSyncMsg && (
                  <div className={`mt-3 p-3 rounded-xl text-sm flex items-center gap-2 ${
                    qbSyncMsg.ok ? 'bg-field-100 text-field-700 border border-field-100' : 'bg-wheat-50 text-wheat-700 border border-wheat-100'
                  }`}>
                    {qbSyncMsg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                    {qbSyncMsg.msg}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-warm-brown">Connect QuickBooks to automatically sync donations and event payments as Sales Receipts.</p>
                <button
                  onClick={handleConnectQb}
                  disabled={qbConnecting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
                >
                  {qbConnecting ? <><Loader2 size={14} className="animate-spin" /> Connecting…</> : <><Link2 size={14} /> Connect QuickBooks</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tax Receipts Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="lg:hidden text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Tax Receipts</p>
          <h3 className="hidden lg:block font-display text-xl font-normal text-earth">Tax Receipts</h3>
          {!isTaxReceiptsEnabled && (
            <span className="text-xs text-wheat-600 bg-wheat-50 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
              <Lock size={10} /> Ministry plan required
            </span>
          )}
        </div>
        {isTaxReceiptsEnabled ? (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
            <p className="text-sm text-warm-brown mb-4">
              Generate year-end consolidated tax receipts for all donors. Each donor receives one PDF summarizing their total donations for the year.
            </p>
            <div className="flex gap-3">
              <select
                value={yearFilter}
                onChange={e => setYearFilter(e.target.value)}
                className="border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gold bg-white"
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
                genResult.ok ? 'bg-field-100 text-field-700 border border-field-100' : 'bg-wheat-50 text-wheat-700 border border-wheat-100'
              }`}>
                {genResult.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {genResult.msg}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-wheat-50 rounded-2xl border border-wheat-100 p-4 flex items-start gap-3">
            <Lock size={18} className="text-wheat-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-wheat-700">Tax receipt generation requires the Ministry plan</p>
              <p className="text-xs text-wheat-600 mt-0.5">Upgrade to generate and email year-end tax receipts to all donors.</p>
            </div>
          </div>
        )}
      </div>

      {/* Giving Statements Section */}
      {isTaxReceiptsEnabled && (
        <div className="mb-6">
          <p className="lg:hidden text-[11px] font-bold uppercase tracking-[0.14em] text-gold mb-3">Giving Statements</p>
          <h3 className="hidden lg:block font-display text-xl font-normal text-earth mb-4">Giving Statements</h3>
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
            <p className="text-sm text-warm-brown mb-4">
              Generate annual giving statements (charitable contribution receipts) for each donor, then email them as PDFs.
            </p>
            <div className="flex gap-3 flex-wrap items-center">
              <select
                value={statementYear}
                onChange={e => setStatementYear(Number(e.target.value))}
                className="border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gold bg-white"
              >
                {[...new Set([new Date().getFullYear(), ...availableYears.map(Number)])]
                  .sort((a, b) => b - a)
                  .map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
                onClick={handleGenerateStatements}
                disabled={genStatements || sendingAll}
              >
                {genStatements ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><FileText size={15} /> Generate Statements</>}
              </button>
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100 disabled:opacity-50"
                onClick={handleSendAll}
                disabled={genStatements || sendingAll}
              >
                {sendingAll ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <>Send All</>}
              </button>
            </div>
            {statementsMsg && (
              <div className={`mt-3 p-3 rounded-xl text-sm flex items-center gap-2 ${
                statementsMsg.ok ? 'bg-field-100 text-field-700 border border-field-100' : 'bg-wheat-50 text-wheat-700 border border-wheat-100'
              }`}>
                {statementsMsg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {statementsMsg.msg}
              </div>
            )}

            {yearStatements.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-gold uppercase tracking-[0.08em]">Donor</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-gold uppercase tracking-[0.08em]">Total</th>
                      <th className="px-3 py-2 text-center text-[11px] font-semibold text-gold uppercase tracking-[0.08em]"># Gifts</th>
                      <th className="px-3 py-2 text-center text-[11px] font-semibold text-gold uppercase tracking-[0.08em]">Statement</th>
                      <th className="px-3 py-2 text-center text-[11px] font-semibold text-gold uppercase tracking-[0.08em]">Status</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-gold uppercase tracking-[0.08em]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {yearStatements.map(s => (
                      <tr key={s.id} className="hover:bg-stone-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-earth">{s.donorName}</div>
                          <div className="text-xs text-[color:var(--text-faint)]">{s.donorEmail}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-earth">{fmt(s.totalAmount / 100)}</td>
                        <td className="px-3 py-2 text-center text-warm-brown">{s.donationCount}</td>
                        <td className="px-3 py-2 text-center">
                          {s.pdfPath ? (
                            <button onClick={() => openStatementPdf(s.pdfPath)} className="inline-flex items-center gap-1 text-gold hover:underline text-xs font-medium">
                              <Download size={12} /> Preview
                            </button>
                          ) : <span className="text-stone-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            s.status === 'sent' ? 'bg-sky-100 text-sky-700' : s.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-field-100 text-field-700'
                          }`}>{s.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleResendStatement(s.donorEmail)}
                            disabled={resendingDonor === s.donorEmail}
                            className="text-xs font-medium text-warm-brown hover:text-earth disabled:opacity-50"
                          >
                            {resendingDonor === s.donorEmail ? 'Sending…' : 'Resend Email'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Invoices List */}
      <div>
        <p className="lg:hidden text-[11px] font-bold uppercase tracking-[0.14em] text-gold mb-3">Invoice History</p>
        <h3 className="hidden lg:block text-sm font-bold text-[color:var(--text-body)] mb-3 font-display">Invoice History</h3>
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email or receipt #..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:border-gold" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
            className="border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold bg-white">
            <option value="all">All Types</option>
            <option value="donation_receipt">Donation Receipts</option>
            <option value="event_ticket">Event Tickets</option>
            <option value="invoice">Invoices</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <Receipt size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium font-display">{search || typeFilter !== 'all' ? 'No invoices match' : 'No invoices yet'}</p>
            <p className="text-sm mt-1">Invoices are created automatically when donations and event registrations are processed</p>
          </div>
        ) : (
          <>
            {/* Mobile transaction list — mockup card list: recipient + type · date,
                amount in field-green, plus status / QuickBooks / PDF so no column is
                dropped. Same `filtered` data and handlers as the desktop table. */}
            <div className="lg:hidden bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
              {filtered.map(inv => (
                <div key={inv.id} className="p-3.5 border-t border-stone-200 first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-earth truncate">{inv.recipientName}</div>
                      <div className="text-xs text-[color:var(--text-faint)] truncate">{inv.recipientEmail}</div>
                    </div>
                    <span className="font-display text-[15px] font-semibold text-field-700 whitespace-nowrap">{fmt(inv.amount, inv.currency)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[inv.type]}`}>{TYPE_LABELS[inv.type]}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                    {isQbEnabled && inv.quickbooksSyncStatus === 'synced' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-field-100 text-field-700">synced</span>
                    )}
                    {isQbEnabled && inv.quickbooksSyncStatus === 'failed' && (
                      <button
                        onClick={() => handleSyncNow(inv.id)}
                        disabled={!qbConnected || retryingId === inv.id}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        title={qbConnected ? 'Retry sync' : 'Connect QuickBooks to retry'}
                      >
                        {retryingId === inv.id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} retry
                      </button>
                    )}
                    {isQbEnabled && !inv.quickbooksSyncStatus && (inv.type === 'donation_receipt' || inv.type === 'event_ticket') && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-[color:var(--text-faint)]">not synced</span>
                    )}
                    <span className="text-[11px] text-[color:var(--text-faint)] ml-auto whitespace-nowrap">{fmtDate(inv.issuedAt)}</span>
                    {inv.pdfPath && (
                      <button onClick={() => openStatementPdf(inv.pdfPath)} className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors text-warm-brown" title="Download PDF">
                        <Download size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table — existing approved layout, unchanged (now lg-only). */}
            <div className="hidden lg:block bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Date</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Recipient</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Type</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Amount</th>
                    <th className="px-4 py-3 text-center text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Status</th>
                    {isQbEnabled && <th className="px-4 py-3 text-center text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">QuickBooks</th>}
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {filtered.map(inv => (
                    <tr key={inv.id} className="hover:bg-stone-100 transition-colors">
                      <td className="px-4 py-3 text-xs text-warm-brown whitespace-nowrap">{fmtDate(inv.issuedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-earth text-sm">{inv.recipientName}</div>
                        <div className="text-xs text-[color:var(--text-faint)]">{inv.recipientEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[inv.type]}`}>
                          {TYPE_LABELS[inv.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-earth">{fmt(inv.amount, inv.currency)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>
                          {inv.status}
                        </span>
                      </td>
                      {isQbEnabled && (
                        <td className="px-4 py-3 text-center">
                          {inv.quickbooksSyncStatus === 'synced' ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-field-100 text-field-700">synced</span>
                          ) : inv.quickbooksSyncStatus === 'failed' ? (
                            <button
                              onClick={() => handleSyncNow(inv.id)}
                              disabled={!qbConnected || retryingId === inv.id}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                              title={qbConnected ? 'Retry sync' : 'Connect QuickBooks to retry'}
                            >
                              {retryingId === inv.id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} retry
                            </button>
                          ) : (inv.type === 'donation_receipt' || inv.type === 'event_ticket') ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-[color:var(--text-faint)]">not synced</span>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {inv.pdfPath && (
                            <button onClick={() => openStatementPdf(inv.pdfPath)}
                              className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors text-warm-brown" title="Download PDF">
                              <Download size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminAccounting;
