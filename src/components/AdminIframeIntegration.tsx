"use client";
import React, { useState, useEffect } from 'react';
import { ExternalLink, Settings2, Check, Loader2 } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getWriteTenantScope } from '../utils/tenant-scope';

interface AdminIframeIntegrationProps {
  /** Firestore key used in tenants/{id}/integrations/{integrationKey} */
  integrationKey: string;
  /** Display name shown in the setup screen */
  displayName: string;
  /** Short description of the service */
  description: string;
  /** Logo icon component or SVG */
  icon: React.ReactNode;
  /** Help text shown below the URL input */
  urlHelp: string;
  /** Placeholder for the URL input */
  urlPlaceholder: string;
}

const AdminIframeIntegration: React.FC<AdminIframeIntegrationProps> = ({
  integrationKey,
  displayName,
  description,
  icon,
  urlHelp,
  urlPlaceholder,
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Write-aware: the integration doc lives at tenants/{tid}/integrations/...,
      // so a super admin on the apex needs the platform tenant (not null) for
      // both reading the saved config and the setDoc in handleSave. On a
      // subdomain the host tenant takes precedence, unchanged.
      const tid = await getWriteTenantScope();
      if (cancelled) return;
      setTenantId(tid);
      if (!tid) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, 'tenants', tid, 'integrations', integrationKey));
        if (!cancelled && snap.exists()) {
          const saved = snap.data().url as string | undefined;
          if (saved) { setUrl(saved); setInputUrl(saved); }
        }
      } catch (e) { console.error(e); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [integrationKey]);

  const handleSave = async () => {
    const trimmed = inputUrl.trim();
    if (!trimmed || !tenantId) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'integrations', integrationKey), { url: trimmed }, { merge: true });
      setUrl(trimmed);
      setConfiguring(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const handleRemove = async () => {
    if (!tenantId) return;
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'integrations', integrationKey), { url: null }, { merge: true });
      setUrl(null);
      setInputUrl('');
      setConfiguring(false);
    } catch (e) { console.error(e); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 size={24} className="animate-spin text-gray-300" /></div>;
  }

  // Configuration form (shown first time, or when reconfiguring)
  if (!url || configuring) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-2xl flex-shrink-0 border border-gray-100">
                {icon}
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-gray-900">{displayName}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{description}</p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <label className="text-xs font-semibold text-gray-700 mb-2 block">{displayName} URL</label>
            <input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder={urlPlaceholder}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold mb-2"
            />
            <p className="text-xs text-gray-400 mb-5">{urlHelp}</p>
            <div className="flex gap-3">
              {configuring && (
                <button onClick={() => setConfiguring(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !inputUrl.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Saving...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Iframe view
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-700">{displayName}</span>
          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-semibold">Connected</span>
        </div>
        <div className="flex items-center gap-2">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <ExternalLink size={12} /> Open in new tab
          </a>
          <button onClick={() => setConfiguring(true)}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-400 hover:text-gray-600">
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* iframe — fills remaining admin content area */}
      <div className="flex-1 rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white" style={{ minHeight: 500 }}>
        <iframe
          src={url}
          title={displayName}
          className="w-full h-full"
          style={{ minHeight: 500, border: 'none' }}
          allow="camera; microphone; fullscreen"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>

      {/* Reconfigure section shown below iframe */}
      <div className="mt-3 text-center">
        <button onClick={handleRemove} className="text-xs text-red-400 hover:text-red-500 transition-colors">
          Disconnect {displayName}
        </button>
      </div>
    </div>
  );
};

export default AdminIframeIntegration;
