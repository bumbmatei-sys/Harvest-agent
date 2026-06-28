"use client";
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import QRCode from 'qrcode';
import { QrCode, Download, Loader2, CalendarCheck, ClipboardList, Heart, Link2 } from 'lucide-react';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';

const GOLD = 'var(--brand-color, #B8962E)';

type QRType = 'event' | 'checkin' | 'giving' | 'form' | 'custom';

interface ContextItem { id: string; label: string }

const TYPE_OPTIONS: { key: QRType; label: string; icon: any }[] = [
  { key: 'event', label: 'Event Registration', icon: CalendarCheck },
  { key: 'checkin', label: 'Check-In Session', icon: QrCode },
  { key: 'giving', label: 'Giving Page', icon: Heart },
  { key: 'form', label: 'Form', icon: ClipboardList },
  { key: 'custom', label: 'Custom URL', icon: Link2 },
];

const AdminQR: React.FC = () => {
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null. On a tenant subdomain currentTenantId is set and takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  const [qrType, setQrType] = useState<QRType>('event');
  const [selectedId, setSelectedId] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [label, setLabel] = useState('');
  const [generating, setGenerating] = useState(false);

  const [events, setEvents] = useState<ContextItem[]>([]);
  const [sessions, setSessions] = useState<ContextItem[]>([]);
  const [forms, setForms] = useState<ContextItem[]>([]);

  // Load context lists (events / check-in sessions / forms) once the tenant resolves.
  useEffect(() => {
    if (!isAuthReady || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const [evSnap, csSnap, fmSnap] = await Promise.all([
          getDocs(query(collection(db, 'tenants', tenantId, 'events'), limit(200))),
          getDocs(query(collection(db, 'tenants', tenantId, 'checkinSessions'), limit(200))),
          getDocs(query(collection(db, 'tenants', tenantId, 'forms'), limit(200))),
        ]);
        if (cancelled) return;
        setEvents(evSnap.docs
          .filter(d => d.data().status === 'published')
          .map(d => ({ id: d.id, label: (d.data().title as string) || 'Untitled event' })));
        setSessions(csSnap.docs
          .filter(d => d.data().status !== 'closed')
          .map(d => ({ id: d.id, label: (d.data().name as string) || 'Untitled session' })));
        setForms(fmSnap.docs
          .filter(d => d.data().active !== false)
          .map(d => ({ id: d.id, label: (d.data().title as string) || 'Untitled form' })));
      } catch {
        if (!cancelled) { setEvents([]); setSessions([]); setForms([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, isAuthReady]);

  const contextList: ContextItem[] = qrType === 'event' ? events : qrType === 'checkin' ? sessions : qrType === 'form' ? forms : [];
  const needsContext = qrType === 'event' || qrType === 'checkin' || qrType === 'form';

  // Reset selection + result when switching type; pre-fill label for giving/custom.
  const changeType = (t: QRType) => {
    setQrType(t);
    setSelectedId('');
    setQrDataUrl('');
    setLabel(t === 'giving' ? 'Give' : t === 'custom' ? '' : '');
  };

  // When a context item is chosen, pre-fill the label with its name.
  const changeSelected = (id: string) => {
    setSelectedId(id);
    setQrDataUrl('');
    const item = contextList.find(i => i.id === id);
    if (item) setLabel(item.label);
  };

  const resolvedUrl = (): string => {
    const base = `https://${tenantId}.theharvest.app`;
    switch (qrType) {
      case 'event': return `${base}/event/${selectedId}`;
      case 'checkin': return `${base}/checkin/${selectedId}`;
      case 'giving': return `${base}/?giving=1`;
      case 'form': return `${base}/form/${selectedId}`;
      case 'custom': return customUrl.trim();
    }
  };

  const canGenerate = qrType === 'giving' || (qrType === 'custom' ? !!customUrl.trim() : !!selectedId);

  const generate = async () => {
    const url = resolvedUrl();
    if (!url) return;
    setGenerating(true);
    try {
      const data = await QRCode.toDataURL(url, { width: 400, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } });
      setQrDataUrl(data);
    } catch {
      setQrDataUrl('');
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${(label || 'qr-code').replace(/[^a-z0-9]/gi, '_')}-qr.png`;
    a.click();
  };

  const displayUrl = resolvedUrl();
  const truncated = displayUrl.length > 60 ? displayUrl.slice(0, 60) + '…' : displayUrl;

  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 120 }}>
      <p className="text-sm text-gray-500 mb-4 leading-relaxed">
        Generate a branded QR code for any of your public pages — print it, project it, or add it to a flyer.
      </p>

      {/* Type selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {TYPE_OPTIONS.map(opt => {
          const Icon = opt.icon;
          const active = qrType === opt.key;
          return (
            <button key={opt.key} onClick={() => changeType(opt.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors ${active ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'}`}
              style={active ? { backgroundColor: GOLD } : undefined}>
              <Icon size={13} /> {opt.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        {/* Context selector */}
        {needsContext && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {qrType === 'event' ? 'Event' : qrType === 'checkin' ? 'Check-In Session' : 'Form'}
            </label>
            <select value={selectedId} onChange={e => changeSelected(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
              <option value="">Select…</option>
              {contextList.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
            {contextList.length === 0 && (
              <p className="text-xs text-gray-400 mt-1.5">No {qrType === 'event' ? 'published events' : qrType === 'checkin' ? 'active sessions' : 'active forms'} yet.</p>
            )}
          </div>
        )}

        {qrType === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Custom URL</label>
            <input value={customUrl} onChange={e => { setCustomUrl(e.target.value); setQrDataUrl(''); }}
              placeholder="https://example.com/page"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
        )}

        {qrType === 'giving' && (
          <p className="text-sm text-gray-500">This QR opens your giving page so people can donate from their phone.</p>
        )}

        {/* Label */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Label <span className="text-gray-400 font-normal">(used for the filename)</span></label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Sunday Service"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
        </div>

        <button onClick={generate} disabled={!canGenerate || generating}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
          {generating ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />} Generate
        </button>
      </div>

      {/* QR display */}
      {qrDataUrl ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mt-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`${label} QR code`} className="w-[300px] h-[300px] mx-auto" />
          {label && <p className="text-sm font-mono text-gray-700 mt-3">{label}</p>}
          <p className="text-[11px] text-gray-400 mt-1 break-all">{truncated}</p>
          <button onClick={download} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50">
            <Download size={14} /> Download PNG
          </button>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400 mt-4">
          <QrCode size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a type above and click Generate to create a QR code.</p>
        </div>
      )}
    </div>
  );
};

export default AdminQR;
