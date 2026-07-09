"use client";
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  getDocs, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import QRCode from 'qrcode';
import {
  Trash2, Download, Users, QrCode, Link2, X, CheckCircle2, Loader2, Plus,
} from 'lucide-react';
import { db, auth } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useTenantOptional } from '../contexts/TenantContext';
import {
  AdminPrimaryButton, AdminSecondaryButton, AdminEditorHeader, AdminCard, AdminBadge,
} from './admin/AdminUI';
import AdminQR from './AdminQR';

const GOLD = 'var(--brand-color, #B8962E)';

interface CheckinSession {
  id: string;
  name: string;
  date: string | null;          // ISO datetime
  location?: string;
  linkedEventId?: string | null;
  status: 'active' | 'closed';
  attendeeCount?: number;
  createdAt: Timestamp | null;
  createdBy: string;
}

interface Attendee {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  checkedInAt: Timestamp | null;
  crmContactId?: string | null;
}

interface EventOption { id: string; title: string }

interface AdminCheckinProps {
  /** Admin holds manageCheckin (or full access). Defaults true when unset. */
  canCheckin?: boolean;
  /** Admin holds manageQR (or full access). Defaults true when unset. */
  canQR?: boolean;
}

const AdminCheckin: React.FC<AdminCheckinProps> = ({ canCheckin = true, canQR = true }) => {
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null (e.g. on a refresh) so create/QR never silently no-ops. On a
  // tenant subdomain currentTenantId is set and takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  // QR Codes is now nested here as a sub-tab. Each sub-tab combines its gate with
  // the admin's permission: Check-In behind checkInSystem + manageCheckin, QR
  // behind manageQR (QR itself is available on every plan). When only one is
  // available, only that tab is shown (and forced active).
  const ctx = useTenantOptional();
  const checkInEnabled = (ctx?.planFeatures?.checkInSystem ?? true) && canCheckin;
  const qrEnabled = canQR;
  const [tab, setTab] = useState<'checkin' | 'qr'>('checkin');
  const showBothSubTabs = checkInEnabled && qrEnabled;
  // Pick the active sub-tab from what's actually available. Crucially, don't
  // fall through to QR when QR isn't enabled — a manageCheckin-only admin on a
  // plan without checkInSystem holds neither, and must not be dropped into the
  // QR generator. 'none' renders a graceful empty state below.
  const activeSubTab: 'checkin' | 'qr' | 'none' =
    checkInEnabled && qrEnabled ? tab : checkInEnabled ? 'checkin' : qrEnabled ? 'qr' : 'none';

  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [sessions, setSessions] = useState<CheckinSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventOption[]>([]);

  // Create form
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [linkedEventId, setLinkedEventId] = useState('');
  const [saving, setSaving] = useState(false);

  // Detail / live
  const [selected, setSelected] = useState<CheckinSession | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  // Manual check-in
  const [mFirst, setMFirst] = useState('');
  const [mLast, setMLast] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mAdding, setMAdding] = useState(false);

  const checkinUrl = useCallback((sessionId: string) => `https://${tenantId}.theharvest.app/checkin/${sessionId}`, [tenantId]);

  // ── Load sessions ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthReady || !tenantId) { setLoading(false); return; }
    const q = query(collection(db, 'tenants', tenantId, 'checkinSessions'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as CheckinSession));
      setLoading(false);
    }, err => { console.error('Failed to load sessions:', err); setLoading(false); });
    return () => unsub();
  }, [tenantId, isAuthReady]);

  // Load events for the "linked event" dropdown
  useEffect(() => {
    if (!tenantId) return;
    getDocs(query(collection(db, 'tenants', tenantId, 'events'), limit(100)))
      .then(snap => setEvents(snap.docs.map(d => ({ id: d.id, title: (d.data().title as string) || 'Untitled' }))))
      .catch(() => setEvents([]));
  }, [tenantId]);

  const startCreate = () => { setName(''); setDate(''); setLocation(''); setLinkedEventId(''); setView('create'); };

  // ── Live attendees + QR when a session is open ───────────────────
  useEffect(() => {
    if (view !== 'detail' || !selected || !tenantId) return;
    QRCode.toDataURL(checkinUrl(selected.id), { width: 320, margin: 1 }).then(setQrDataUrl).catch(() => setQrDataUrl(''));
    const q = query(
      collection(db, 'tenants', tenantId, 'checkinSessions', selected.id, 'attendees'),
      orderBy('checkedInAt', 'desc'), limit(1000),
    );
    const unsub = onSnapshot(q, snap => setAttendees(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Attendee)));
    return () => unsub();
  }, [view, selected, tenantId, checkinUrl]);

  const sessionStatus = (s: CheckinSession): 'Upcoming' | 'Active' | 'Closed' => {
    if (s.status === 'closed') return 'Closed';
    if (s.date && new Date(s.date).getTime() > Date.now()) return 'Upcoming';
    return 'Active';
  };

  const handleCreate = async () => {
    if (!tenantId) { alert('Could not determine your workspace. Please refresh and try again.'); return; }
    if (!name.trim()) { alert('Please name the session.'); return; }
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, 'tenants', tenantId, 'checkinSessions'), {
        name: name.trim(),
        date: date ? new Date(date).toISOString() : null,
        location: location.trim() || null,
        linkedEventId: linkedEventId || null,
        status: 'active',
        attendeeCount: 0,
        qrCodeUrl: '', // filled below with the encoded URL
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
      });
      await updateDoc(doc(db, 'tenants', tenantId, 'checkinSessions', ref.id), { qrCodeUrl: checkinUrl(ref.id) });
      // Open the new session's detail view so its QR code shows immediately.
      // (createdAt is a server sentinel at write time, so use null client-side.)
      setSelected({
        id: ref.id,
        name: name.trim(),
        date: date ? new Date(date).toISOString() : null,
        location: location.trim() || undefined,
        linkedEventId: linkedEventId || null,
        status: 'active',
        attendeeCount: 0,
        createdAt: null,
        createdBy: auth.currentUser?.uid || '',
      });
      setName(''); setDate(''); setLocation(''); setLinkedEventId('');
      setView('detail');
    } catch (e) {
      console.error('Failed to create session:', e);
      alert('Failed to create session. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async (s: CheckinSession) => {
    if (!tenantId) return;
    if (!confirm(`Close "${s.name}"? No more check-ins will be accepted.`)) return;
    await updateDoc(doc(db, 'tenants', tenantId, 'checkinSessions', s.id), { status: 'closed' });
    setSelected({ ...s, status: 'closed' });
  };

  const deleteSession = async (s: CheckinSession) => {
    if (!tenantId) return;
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'tenants', tenantId, 'checkinSessions', s.id));
  };

  const manualCheckIn = async () => {
    if (!selected || !tenantId || !mFirst.trim()) return;
    setMAdding(true);
    try {
      const resp = await fetch('/api/checkin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sessionId: selected.id, firstName: mFirst, lastName: mLast, email: mEmail }),
      });
      if (resp.ok) { setMFirst(''); setMLast(''); setMEmail(''); }
      else alert('Failed to check in.');
    } catch { alert('Failed to check in.'); }
    finally { setMAdding(false); }
  };

  const copyLink = async (sessionId: string) => {
    try { await navigator.clipboard.writeText(checkinUrl(sessionId)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const exportCsv = () => {
    if (!selected) return;
    const header = ['First Name', 'Last Name', 'Email', 'Check-in Time'];
    const rows = attendees.map(a => [
      a.firstName, a.lastName || '', a.email || '',
      a.checkedInAt?.toDate ? a.checkedInAt.toDate().toISOString() : '',
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${selected.name.replace(/[^a-z0-9]/gi, '_')}_attendees.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const fmtTime = (ts: Timestamp | null) =>
    ts?.toDate ? ts.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  // Native pill segmented control (matches the CRM Contacts/Analytics toggle).
  // Only shown when the admin can reach BOTH sub-tabs.
  const subTabBar = showBothSubTabs ? (
    <div className="flex gap-1 bg-stone-100 rounded-xl p-1 mb-6 w-fit mx-auto">
      <button
        onClick={() => setTab('checkin')}
        className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          activeSubTab === 'checkin' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
        }`}
      >
        Check-In
      </button>
      <button
        onClick={() => setTab('qr')}
        className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          activeSubTab === 'qr' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
        }`}
      >
        QR Codes
      </button>
    </div>
  ) : null;

  // Neither sub-tab is available to this admin (e.g. manageCheckin only, on a
  // plan without checkInSystem, and no manageQR). Show a graceful empty state
  // rather than dropping them into a generator they aren't permitted to use.
  if (activeSubTab === 'none') {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 text-[color:var(--text-faint)]">
        <p className="text-sm">You don&apos;t have access to Check-In or QR Codes.</p>
      </div>
    );
  }

  // QR Codes sub-tab — the standalone QR generator.
  if (activeSubTab === 'qr') {
    return (
      <div className="max-w-2xl mx-auto">
        {subTabBar}
        <AdminQR />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  if (view === 'create') {
    return (
      <div className="max-w-xl mx-auto" style={{ paddingBottom: 120 }}>
        <AdminEditorHeader
          onBack={() => setView('list')}
          backLabel="All sessions"
          title="New session"
          subtitle="Generate a QR code attendees can scan to check in."
        />
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">Session Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Sunday Service — June 29" className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">Date &amp; Time</label>
            <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">Location <span className="text-[color:var(--text-faint)] font-normal">(optional)</span></label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Main Auditorium" className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">Linked Event <span className="text-[color:var(--text-faint)] font-normal">(optional)</span></label>
            <select value={linkedEventId} onChange={e => setLinkedEventId(e.target.value)} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold bg-white">
              <option value="">No linked event</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </select>
          </div>
          <button onClick={handleCreate} disabled={saving} className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
            {saving ? 'Creating…' : 'Generate QR & Save'}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'detail' && selected) {
    const status = sessionStatus(selected);
    return (
      <div className="max-w-3xl mx-auto" style={{ paddingBottom: 120 }}>
        <AdminEditorHeader
          onBack={() => setView('list')}
          backLabel="All sessions"
          title={selected.name}
          subtitle={<>
            {selected.date && new Date(selected.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {selected.location && ` · ${selected.location}`}
          </>}
          actions={<AdminBadge tone={status === 'Closed' ? 'stone' : status === 'Upcoming' ? 'sky' : 'green'}>{status}</AdminBadge>}
        />
        <div className="grid md:grid-cols-2 gap-4">
          {/* QR + actions */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Check-in QR code" className="w-56 h-56 mx-auto" />
            ) : (
              <div className="w-56 h-56 mx-auto flex items-center justify-center text-stone-300"><QrCode size={48} /></div>
            )}
            <p className="text-xs text-[color:var(--text-faint)] mt-2 break-all">{checkinUrl(selected.id)}</p>
            <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
              <button onClick={() => copyLink(selected.id)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100">
                <Link2 size={14} /> {copied ? 'Copied!' : 'Copy Link'}
              </button>
              {qrDataUrl && (
                <a href={qrDataUrl} download={`${selected.name.replace(/[^a-z0-9]/gi, '_')}_qr.png`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100">
                  <Download size={14} /> QR
                </a>
              )}
            </div>
          </div>

          {/* Counter + manual + close */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Users size={18} style={{ color: GOLD }} />
              <span className="font-display text-4xl font-light text-earth">{attendees.length}</span>
              <span className="text-sm text-warm-brown">checked in</span>
            </div>
            <AdminBadge tone={status === 'Closed' ? 'stone' : status === 'Upcoming' ? 'sky' : 'green'}>{status}</AdminBadge>

            {status !== 'Closed' && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-warm-brown uppercase tracking-wide">Manual Check-In</p>
                <div className="flex gap-2">
                  <input value={mFirst} onChange={e => setMFirst(e.target.value)} placeholder="First" className="flex-1 min-w-0 px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold" />
                  <input value={mLast} onChange={e => setMLast(e.target.value)} placeholder="Last" className="flex-1 min-w-0 px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold" />
                </div>
                <input value={mEmail} onChange={e => setMEmail(e.target.value)} placeholder="Email (optional)" className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold" />
                <button onClick={manualCheckIn} disabled={mAdding || !mFirst.trim()} className="w-full py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
                  {mAdding ? 'Adding…' : 'Check In'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <button onClick={exportCsv} disabled={attendees.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100 disabled:opacity-50">
                <Download size={14} /> Export CSV
              </button>
              {status !== 'Closed' && (
                <button onClick={() => closeSession(selected)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50">
                  <X size={14} /> Close Session
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Live list */}
        <div className="bg-white rounded-2xl border border-stone-200 mt-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50"><h3 className="text-sm font-bold text-[color:var(--text-body)] font-display">Checked In</h3></div>
          {attendees.length === 0 ? (
            <p className="text-center py-10 text-[color:var(--text-faint)] text-sm font-display">No one checked in yet.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {attendees.map(a => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: GOLD }}>
                    {(a.firstName?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-earth truncate">{a.firstName} {a.lastName}</div>
                    {a.email && <div className="text-xs text-[color:var(--text-faint)] truncate">{a.email}</div>}
                  </div>
                  {a.crmContactId && <CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                  <span className="text-xs text-[color:var(--text-faint)] shrink-0">{fmtTime(a.checkedInAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        {subTabBar}
        <div className="flex items-center justify-center h-40"><Loader2 size={28} className="animate-spin" style={{ color: GOLD }} /></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto" style={{ paddingBottom: 120 }}>
      {subTabBar}
      <div className="flex items-start justify-between gap-4 mb-6">
        <p className="text-sm text-warm-brown leading-relaxed max-w-lg">
          Create a session, then show its QR code. People scan it to check in — you&apos;ll see them appear live, and can export to CSV anytime.
        </p>
        <AdminPrimaryButton onClick={startCreate} icon={<Plus size={16} />} className="shrink-0">New session</AdminPrimaryButton>
      </div>
      {sessions.length === 0 ? (
        <AdminCard className="text-center py-16 px-6">
          <QrCode size={38} className="mx-auto mb-3 text-stone-300" />
          <p className="font-display text-lg text-earth">No check-in sessions yet</p>
          <p className="text-sm text-warm-brown mt-1">Create a session and share its QR code for attendees to scan.</p>
          <div className="mt-5"><AdminPrimaryButton onClick={startCreate} icon={<Plus size={16} />}>New session</AdminPrimaryButton></div>
        </AdminCard>
      ) : (
        <div className="space-y-4">
          {sessions.map(s => {
            const status = sessionStatus(s);
            return (
              <AdminCard key={s.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => { setSelected(s); setView('detail'); }} className="flex-1 min-w-0 text-left group">
                    <div className="font-semibold text-earth truncate group-hover:text-gold transition-colors">{s.name}</div>
                    <div className="text-xs text-[color:var(--text-faint)] mt-1">
                      {s.date && new Date(s.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {s.location && ` · ${s.location}`}
                    </div>
                  </button>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <AdminBadge tone={status === 'Closed' ? 'stone' : status === 'Upcoming' ? 'sky' : 'green'}>{status}</AdminBadge>
                    <span className="font-display text-lg font-light text-earth leading-none">{s.attendeeCount || 0}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-stone-200">
                  <button onClick={() => { setSelected(s); setView('detail'); }} className="flex items-center gap-1.5 text-xs font-semibold text-warm-brown hover:text-gold transition-colors"><QrCode size={13} /> Open</button>
                  <button onClick={() => copyLink(s.id)} className="flex items-center gap-1.5 text-xs font-semibold text-warm-brown hover:text-gold transition-colors"><Link2 size={13} /> Copy link</button>
                  <button onClick={() => deleteSession(s)} className="flex items-center gap-1.5 text-xs font-semibold text-[#C4553B] hover:opacity-80 transition-opacity ml-auto"><Trash2 size={13} /> Delete</button>
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminCheckin;
