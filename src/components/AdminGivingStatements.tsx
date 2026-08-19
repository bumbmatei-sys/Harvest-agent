"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { Receipt, Loader2, RefreshCw, FileText, Settings, Save, Send, DollarSign } from 'lucide-react';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { authFetch } from '../utils/auth-fetch';
import { openStatementPdf } from '../utils/open-statement-pdf';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
// Rules 2 and 3 (form-layout.ts). Rule 1 is deliberately NOT applied — see the
// note on the page root below. No figure on this screen is touched: the rules
// below change the WIDTH a control is drawn at and nothing else.
import { FIELD_WIDTH, ACTION_BUTTON } from './layout/form-layout';

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
    if (s === 'sent') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-field-100 text-field-700">Sent</span>;
    if (s === 'generated') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">Generated (not sent)</span>;
    if (s === 'failed') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Failed</span>;
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">{s}</span>;
  };

  // Rule 1 is NOT applied to this container, deliberately — same reasoning
  // as AdminSms.tsx, and the same measurement: 609px at 1024px and above,
  // already well inside FORM_MEASURE's 940px, so adopting it would widen
  // this screen by 331px. `max-w-2xl` does carry the rem-base split (672px
  // below 1024px, 609px above), which is reported rather than papered over
  // with a third measure invented in the shared module.
  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 120 }}>
      {/* Section A — Configuration */}
      {showConfig && (
        <div className="bg-surface-raised rounded-2xl border border-line p-5 mb-4 space-y-3">
          <h3 className="font-display text-sm font-bold text-body">Statement Settings</h3>
          <div>
            <label className="block text-xs font-semibold text-body mb-1">EIN / Registration Number</label>
            <input value={config.ein} onChange={e => setConfig({ ...config, ein: e.target.value })}
              className={`w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:border-gold ${FIELD_WIDTH.medium}`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-body mb-1">Organization Address</label>
            <textarea value={config.address} onChange={e => setConfig({ ...config, address: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:border-gold resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-body mb-1">Country</label>
            <select value={config.country} onChange={e => setConfig({ ...config, country: e.target.value })}
              className={`w-full px-3 py-2 border border-line rounded-xl text-sm bg-surface-raised focus:outline-none focus:border-gold ${FIELD_WIDTH.medium}`}>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="AU">Australia</option>
              <option value="NZ">New Zealand</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-body mb-1">Custom Footer</label>
            <textarea value={config.footer} onChange={e => setConfig({ ...config, footer: e.target.value })} rows={2}
              placeholder="No goods or services were provided..."
              className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:border-gold resize-none" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveConfig} disabled={savingConfig}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
              <Save size={14} /> {savingConfig ? 'Saving…' : 'Save Settings'}
            </button>
            {configSaved && <span className="text-sm text-field-600 font-medium">✓ Saved</span>}
          </div>
        </div>
      )}

      {/* Section B — Generate */}
      <div className="bg-surface-raised rounded-2xl border border-line p-5 mb-4 space-y-3">
        <h3 className="font-display text-sm font-bold text-body flex items-center gap-1.5"><Receipt size={15} /> Generate Statements</h3>
        <div>
          <label className="block text-xs font-semibold text-body mb-1">Tax Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className={`w-full px-3 py-2 border border-line rounded-xl text-sm bg-surface-raised focus:outline-none focus:border-gold ${FIELD_WIDTH.short}`}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-body">Single donor only</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={singleDonor} onChange={e => setSingleDonor(e.target.checked)} />
            <div className="w-10 h-6 bg-surface-chip peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface-raised after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
          </label>
        </div>
        {singleDonor && (
          <input value={donorEmail} onChange={e => setDonorEmail(e.target.value)} placeholder="donor@email.com" type="email"
            className={`w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:border-gold ${FIELD_WIDTH.long}`} />
        )}
        <button onClick={generate} disabled={generating || (singleDonor && !donorEmail.trim())}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 ${ACTION_BUTTON}`} style={{ backgroundColor: GOLD }}>
          {generating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {generating ? 'Generating…' : 'Generate & Send'}
        </button>
        {results && (
          <div className={`p-3 rounded-xl text-sm ${
            results.isError
              ? 'bg-red-50 text-red-600'
              : results.generated === 0 && results.message
                ? 'bg-surface-sunken text-muted'
                : results.message
                  ? 'bg-wheat-50 text-wheat-700'
                  : 'bg-field-100 text-field-700'
          }`}>
            {results.message
              ? results.message
              : `Generated ${results.generated} statement(s), sent ${results.sent} email(s).${results.failed ? ` ${results.failed} failed.` : ''}`}
          </div>
        )}
      </div>

      {/* Section C — History */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-bold text-body">Statement History — {year}</h3>
        <button onClick={loadStatuses} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken">
          <RefreshCw size={13} className={loadingStatuses ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {statuses.length === 0 ? (
        <div className="text-center py-12 text-faint">
          <Receipt size={36} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">{loadingStatuses ? 'Loading…' : `No statements generated for ${year} yet.`}</p>
        </div>
      ) : (
        <>
          {/* Mobile summary — 2-col stat cards (mockup StatRow). Display-only
              count/sum over the already-loaded `statuses`; desktop shows no stat
              row and is unchanged. */}
          <div className="lg:hidden grid grid-cols-2 gap-2.5 mb-4">
            {[
              { label: 'Statements', value: String(statuses.length), icon: <Receipt size={14} /> },
              { label: `Total · ${year}`, value: fmtMoney(statuses.reduce((sum, s) => sum + (s.totalAmount || 0), 0)), icon: <DollarSign size={14} /> },
            ].map(s => (
              <div key={s.label} className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-3.5">
                <div className="w-7 h-7 rounded-lg bg-[var(--surface-gold)] text-gold flex items-center justify-center mb-2">{s.icon}</div>
                <div className="font-display text-[1.375rem] font-normal leading-none tracking-[-0.02em] text-strong">{s.value}</div>
                <div className="text-[11px] text-muted mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Mobile history — mockup list card: gold receipt disc, donor + status,
              email·total sub (money in field-green), PDF action. Same `statuses`,
              statusBadge, fmtMoney, openStatementPdf as the desktop list below. */}
          <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
            {statuses.map((s, i) => (
              <div key={s.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-line' : ''}`}>
                <div className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
                  <Receipt size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-[13.5px] font-semibold text-strong truncate">{s.donorName || s.donorEmail}</p>
                    <span className="shrink-0">{statusBadge(s.status)}</span>
                  </div>
                  <p className="text-[11.5px] text-faint truncate">{s.donorEmail} · <span className="font-semibold text-field-700">{fmtMoney(s.totalAmount)}</span></p>
                </div>
                {s.pdfPath && (
                  <button onClick={() => openStatementPdf(s.pdfPath)} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-strong shrink-0">
                    <FileText size={13} /> PDF
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop history — existing approved layout, unchanged (now lg-only). */}
        <div className="hidden lg:block bg-surface-raised rounded-2xl border border-line divide-y divide-stone-200">
          {statuses.map(s => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-strong truncate">{s.donorName || s.donorEmail}</p>
                  {statusBadge(s.status)}
                </div>
                <p className="text-xs text-faint truncate">{s.donorEmail} · {fmtMoney(s.totalAmount)}</p>
              </div>
              {s.pdfPath && (
                <button onClick={() => openStatementPdf(s.pdfPath)} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-strong shrink-0">
                  <FileText size={13} /> PDF
                </button>
              )}
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
};

export default AdminGivingStatements;
