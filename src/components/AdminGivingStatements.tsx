"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { Receipt, Loader2, RefreshCw, FileText, Settings, Save, Send } from 'lucide-react';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { authFetch } from '../utils/auth-fetch';
import { openStatementPdf } from '../utils/open-statement-pdf';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';

const GOLD = 'var(--brand-color, #B8962E)';

interface GenerationResult {
  generated: number;
  sent: number;
  totalDonors: number;
  failed?: number;
  emailConfigured?: boolean;
  message?: string;
  isError?: boolean;
}

interface StatementStatus {
  id: string;
  donorName: string;
  donorEmail: string;
  year: number;
  totalAmount: number; // cents
  status: string;
  generatedAt?: string;
  pdfPath?: string;
}

const fmtMoney = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);

const AdminGivingStatements: React.FC = () => {
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);
  const { setHeaderAction } = useAdminHeader();

  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [donorEmail, setDonorEmail] = useState('');
  const [singleDonor, setSingleDonor] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<GenerationResult | null>(null);
  const [statuses, setStatuses] = useState<StatementStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({ ein: '', address: '', footer: '', country: 'US' });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // Header "Settings" action toggles the config card.
  useEffect(() => {
    setHeaderAction(<HeaderActionButton label="Settings" icon={<Settings size={15} />} onClick={() => setShowConfig(v => !v)} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction]);

  // Load config on mount.
  useEffect(() => {
    authFetch('/api/giving-statements/config')
      .then(r => r.json())
      .then(d => setConfig({ ein: d.ein || '', address: d.address || '', footer: d.footer || '', country: d.country || 'US' }))
      .catch(() => {});
  }, []);

  const loadStatuses = useCallback(async () => {
    if (!tenantId) return;
    setLoadingStatuses(true);
    try {
      // Single-field query (year); sort client-side to avoid a composite index.
      const snap = await getDocs(query(
        collection(db, 'tenants', tenantId, 'givingStatements'),
        where('year', '==', year),
        limit(2000),
      ));
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as StatementStatus);
      rows.sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
      setStatuses(rows);
    } catch {
      setStatuses([]);
    } finally {
      setLoadingStatuses(false);
    }
  }, [tenantId, year]);

  useEffect(() => {
    if (isAuthReady && tenantId) loadStatuses();
  }, [isAuthReady, tenantId, loadStatuses]);

  const saveConfig = async () => {
    setSavingConfig(true);
    setConfigSaved(false);
    try {
      await authFetch('/api/giving-statements/config', { method: 'PUT', body: JSON.stringify(config) });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2500);
    } catch { /* ignore */ }
    finally { setSavingConfig(false); }
  };

  const generate = async () => {
    setGenerating(true);
    setResults(null);
    try {
      const resp = await authFetch('/api/giving-statements/generate', {
        method: 'POST',
        body: JSON.stringify({ year, donorEmail: singleDonor ? (donorEmail.trim() || undefined) : undefined, send: true }),
      });
      const d = await resp.json();
      if (!resp.ok) { setResults({ generated: 0, sent: 0, totalDonors: 0, message: d.error || 'Failed to generate.', isError: true }); return; }
      setResults({ ...d, isError: false });
      await loadStatuses();
    } catch (e: any) {
      setResults({ generated: 0, sent: 0, totalDonors: 0, message: e?.message || 'Failed to generate.', isError: true });
    } finally {
      setGenerating(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  const statusBadge = (s: string) => {
    if (s === 'sent') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Sent</span>;
    if (s === 'generated') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Generated (not sent)</span>;
    if (s === 'failed') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Failed</span>;
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-warm-brown">{s}</span>;
  };

  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 120 }}>
      {/* Section A — Configuration */}
      {showConfig && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-4 space-y-3">
          <h3 className="font-display text-sm font-bold text-[color:var(--text-body)]">Statement Settings</h3>
          <div>
            <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">EIN / Registration Number</label>
            <input value={config.ein} onChange={e => setConfig({ ...config, ein: e.target.value })}
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">Organization Address</label>
            <textarea value={config.address} onChange={e => setConfig({ ...config, address: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">Country</label>
            <select value={config.country} onChange={e => setConfig({ ...config, country: e.target.value })}
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="AU">Australia</option>
              <option value="NZ">New Zealand</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">Custom Footer</label>
            <textarea value={config.footer} onChange={e => setConfig({ ...config, footer: e.target.value })} rows={2}
              placeholder="No goods or services were provided..."
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold resize-none" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveConfig} disabled={savingConfig}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
              <Save size={14} /> {savingConfig ? 'Saving…' : 'Save Settings'}
            </button>
            {configSaved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
          </div>
        </div>
      )}

      {/* Section B — Generate */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-4 space-y-3">
        <h3 className="font-display text-sm font-bold text-[color:var(--text-body)] flex items-center gap-1.5"><Receipt size={15} /> Generate Statements</h3>
        <div>
          <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">Tax Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[color:var(--text-body)]">Single donor only</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={singleDonor} onChange={e => setSingleDonor(e.target.checked)} />
            <div className="w-10 h-6 bg-stone-200 peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
          </label>
        </div>
        {singleDonor && (
          <input value={donorEmail} onChange={e => setDonorEmail(e.target.value)} placeholder="donor@email.com" type="email"
            className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
        )}
        <button onClick={generate} disabled={generating || (singleDonor && !donorEmail.trim())}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
          {generating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {generating ? 'Generating…' : 'Generate & Send'}
        </button>
        {results && (
          <div className={`p-3 rounded-xl text-sm ${
            results.isError
              ? 'bg-red-50 text-red-600'
              : results.generated === 0 && results.message
                ? 'bg-stone-100 text-warm-brown'
                : results.message
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-green-50 text-green-700'
          }`}>
            {results.message
              ? results.message
              : `Generated ${results.generated} statement(s), sent ${results.sent} email(s).${results.failed ? ` ${results.failed} failed.` : ''}`}
          </div>
        )}
      </div>

      {/* Section C — History */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-bold text-[color:var(--text-body)]">Statement History — {year}</h3>
        <button onClick={loadStatuses} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-stone-200 text-warm-brown hover:bg-stone-100">
          <RefreshCw size={13} className={loadingStatuses ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {statuses.length === 0 ? (
        <div className="text-center py-12 text-[color:var(--text-faint)]">
          <Receipt size={36} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">{loadingStatuses ? 'Loading…' : `No statements generated for ${year} yet.`}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-200 divide-y divide-gray-50">
          {statuses.map(s => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-earth truncate">{s.donorName || s.donorEmail}</p>
                  {statusBadge(s.status)}
                </div>
                <p className="text-xs text-[color:var(--text-faint)] truncate">{s.donorEmail} · {fmtMoney(s.totalAmount)}</p>
              </div>
              {s.pdfPath && (
                <button onClick={() => openStatementPdf(s.pdfPath)} className="flex items-center gap-1 text-xs font-semibold text-warm-brown hover:text-earth shrink-0">
                  <FileText size={13} /> PDF
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminGivingStatements;
