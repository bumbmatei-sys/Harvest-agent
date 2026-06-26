"use client";
import React, { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, CalendarCheck, Users, MapPin, Clock, DollarSign,
  Check, Download, Search, ChevronRight, Globe, X, Pin
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, limit, serverTimestamp, Timestamp, getDocs
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';

interface Event {
  id: string;
  title: string;
  description: string;
  coverImage: string | null;
  location: string;
  isOnline: boolean;
  onlineLink: string | null;
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  capacity: number | null;
  registrationDeadline: Timestamp | null;
  price: number;
  currency: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  pinned?: boolean;
  createdAt: Timestamp | null;
  createdBy: string;
  tenantId: string;
}

interface Registration {
  id: string;
  eventId: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string | null;
  ticketCode: string;
  status: 'confirmed' | 'cancelled' | 'attended';
  amount: number;
  registeredAt: Timestamp | null;
}

type ViewMode = 'list' | 'create' | 'edit' | 'detail';

const STATUS_COLORS: Record<Event['status'], string> = {
  draft: 'bg-gray-100 text-gray-500',
  published: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  completed: 'bg-blue-100 text-blue-700',
};

const fmtDate = (ts: Timestamp | null) => {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtDateInput = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  return d.toISOString().slice(0, 16);
};

const toTimestamp = (v: string): Timestamp | null => {
  if (!v) return null;
  return Timestamp.fromDate(new Date(v));
};

const emptyForm = {
  title: '',
  description: '',
  coverImage: '',
  location: '',
  isOnline: false,
  onlineLink: '',
  startDate: '',
  endDate: '',
  capacity: '',
  registrationDeadline: '',
  price: '0',
  currency: 'usd',
  status: 'draft' as Event['status'],
};

const AdminEvents: React.FC = () => {
  const { setHeaderAction, setHeaderOverride } = useAdminHeader();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('list');
  const [selected, setSelected] = useState<Event | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Detail view state
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regSearch, setRegSearch] = useState('');
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  // Drive the shared header. In a sub-view (create/edit/detail) the back chevron
  // returns to the event list; on the list it shows the "Create Event" action.
  useEffect(() => {
    if (view === 'create' || view === 'edit') {
      setHeaderOverride({
        title: view === 'edit' ? 'Edit Event' : 'Create Event',
        onBack: () => { setView('list'); setSelected(null); },
      });
    } else if (view === 'detail' && selected) {
      setHeaderOverride({
        title: selected.title || 'Event',
        onBack: () => { setView('list'); setSelected(null); },
      });
    } else {
      setHeaderOverride(null);
    }
    return () => setHeaderOverride(null);
  }, [view, selected, setHeaderOverride]);

  useEffect(() => {
    setHeaderAction(<HeaderActionButton label="Create Event" onClick={() => { setSelected(null); setForm(emptyForm); setView('create'); }} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    getTenantScope().then(tid => {
      if (cancelled) return;
      setTenantId(tid);
      if (!tid) { setLoading(false); return; }
      const q = query(
        collection(db, 'tenants', tid, 'events'),
        orderBy('startDate', 'desc'),
        limit(100)
      );
      unsub = onSnapshot(q, snap => {
        setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Event));
        setLoading(false);
      }, err => {
        try { handleFirestoreError(err, OperationType.GET, 'events'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  // Load registrations when viewing event detail
  useEffect(() => {
    if (view !== 'detail' || !selected || !tenantId) return;
    // Single-field filter only (eventId); sort client-side to avoid a composite index.
    const q = query(
      collection(db, 'tenants', tenantId, 'registrations'),
      where('eventId', '==', selected.id),
      limit(500)
    );
    const unsub = onSnapshot(q, snap => {
      setRegistrations(sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Registration), 'registeredAt', 'desc'));
    });
    return unsub;
  }, [view, selected, tenantId]);

  const openCreate = () => {
    setForm(emptyForm);
    setSelected(null);
    setView('create');
  };

  const openEdit = (ev: Event) => {
    setForm({
      title: ev.title,
      description: ev.description,
      coverImage: ev.coverImage || '',
      location: ev.location,
      isOnline: ev.isOnline,
      onlineLink: ev.onlineLink || '',
      startDate: fmtDateInput(ev.startDate),
      endDate: fmtDateInput(ev.endDate),
      capacity: ev.capacity?.toString() || '',
      registrationDeadline: fmtDateInput(ev.registrationDeadline),
      price: ev.price.toString(),
      currency: ev.currency,
      status: ev.status,
    });
    setSelected(ev);
    setView('edit');
  };

  const openDetail = (ev: Event) => {
    setSelected(ev);
    setRegSearch('');
    setView('detail');
  };

  const handleSave = async () => {
    if (!form.title.trim()) { notifyError('Event title is required', null); return; }
    if (!tenantId) { notifyError('Unable to determine your tenant. Please refresh.', null); return; }
    setSaving(true);
    try {
      const data: Partial<Omit<Event, 'id'>> = {
        title: form.title.trim(),
        description: form.description.trim(),
        coverImage: form.coverImage.trim() || null,
        location: form.location.trim(),
        isOnline: form.isOnline,
        onlineLink: form.onlineLink.trim() || null,
        startDate: toTimestamp(form.startDate),
        endDate: toTimestamp(form.endDate),
        capacity: form.capacity ? Number(form.capacity) : null,
        registrationDeadline: toTimestamp(form.registrationDeadline),
        price: Number(form.price) || 0,
        currency: form.currency,
        status: form.status,
      };
      if (view === 'edit' && selected) {
        await updateDoc(doc(db, 'tenants', tenantId, 'events', selected.id), {
          ...data,
          updatedAt: serverTimestamp(),
        });
        setSelected({ ...selected, ...data } as Event);
        setView('detail');
      } else {
        const ref = await addDoc(collection(db, 'tenants', tenantId, 'events'), {
          ...data,
          tenantId,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || '',
        });
        const newEvent: Event = {
          id: ref.id,
          title: data.title || '',
          description: data.description || '',
          coverImage: data.coverImage ?? null,
          location: data.location || '',
          isOnline: data.isOnline || false,
          onlineLink: data.onlineLink ?? null,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          capacity: data.capacity ?? null,
          registrationDeadline: data.registrationDeadline ?? null,
          price: data.price || 0,
          currency: data.currency || 'usd',
          status: data.status || 'draft',
          tenantId,
          createdAt: null,
          createdBy: auth.currentUser?.uid || '',
          pinned: false,
        };
        setSelected(newEvent);
        setView('detail');
      }
    } catch (e) { notifyError('Failed to save event', e); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId || !tenantId) return;
    try { await deleteDoc(doc(db, 'tenants', tenantId, 'events', deleteId)); }
    catch (e) { notifyError('Failed to delete event', e); }
    setDeleteId(null);
    if (view === 'detail') setView('list');
  };

  const togglePin = async (ev: Event) => {
    if (!tenantId) return;
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'events', ev.id), { pinned: !ev.pinned });
    } catch (e) { notifyError('Failed to update event', e); }
  };

  const checkIn = async (reg: Registration) => {
    if (!tenantId) return;
    setCheckingIn(reg.id);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'registrations', reg.id), { status: 'attended' });
    } catch (e) { notifyError('Failed to check in attendee', e); }
    finally { setCheckingIn(null); }
  };

  const exportCSV = () => {
    if (!selected) return;
    const rows = [
      ['Name', 'Email', 'Phone', 'Ticket Code', 'Status', 'Amount', 'Registered At'],
      ...registrations.map(r => [
        r.name, r.email, r.phone || '', r.ticketCode, r.status,
        `$${r.amount}`,
        r.registeredAt ? r.registeredAt.toDate().toLocaleDateString() : ''
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.title.replace(/\s+/g, '_')}_attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  // ── Form View ──
  if (view === 'create' || view === 'edit') {
    return (
      <div className="max-w-2xl mx-auto pb-32">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Event Title *</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="Event name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] resize-none"
                placeholder="What is this event about?" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Cover Image URL</label>
              <input value={form.coverImage} onChange={e => setForm({ ...form, coverImage: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="https://..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Start Date & Time *</label>
                <input type="datetime-local" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">End Date & Time</label>
                <input type="datetime-local" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-gray-700">Online Event</label>
                <button onClick={() => setForm({ ...form, isOnline: !form.isOnline })} className="transition-colors">
                  <div className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.isOnline ? 'bg-[#d4a017]' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isOnline ? 'translate-x-5' : ''}`} />
                  </div>
                </button>
              </div>
              {form.isOnline ? (
                <input value={form.onlineLink} onChange={e => setForm({ ...form, onlineLink: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="Meeting link (Zoom, Google Meet...)" />
              ) : (
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="Event location / address" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Capacity (blank = unlimited)</label>
                <input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="e.g. 100" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Ticket Price ($)</label>
                <input type="number" min={0} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="0 = free" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Registration Deadline</label>
              <input type="datetime-local" value={form.registrationDeadline} onChange={e => setForm({ ...form, registrationDeadline: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Event['status'] })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setView('list')} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.title.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
              {saving ? 'Saving...' : view === 'edit' ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View ──
  if (view === 'detail' && selected) {
    const attended = registrations.filter(r => r.status === 'attended').length;
    const confirmed = registrations.filter(r => r.status === 'confirmed').length;
    const filteredRegs = registrations.filter(r =>
      !regSearch ||
      r.name.toLowerCase().includes(regSearch.toLowerCase()) ||
      r.email.toLowerCase().includes(regSearch.toLowerCase()) ||
      r.ticketCode.toLowerCase().includes(regSearch.toLowerCase())
    );
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900 truncate">{selected.title}</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>
              {selected.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => openEdit(selected)} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">
              <Edit2 size={15} className="text-gray-500" />
            </button>
            <button onClick={() => setDeleteId(selected.id)} className="p-2 rounded-xl border border-red-100 hover:bg-red-50">
              <Trash2 size={15} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{registrations.length}</div>
            <div className="text-xs text-gray-400 mt-0.5">Total</div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center shadow-sm">
            <div className="text-2xl font-bold text-green-600">{confirmed}</div>
            <div className="text-xs text-gray-400 mt-0.5">Confirmed</div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center shadow-sm">
            <div className="text-2xl font-bold" style={{ color: 'var(--brand-color, #d4a017)' }}>{attended}</div>
            <div className="text-xs text-gray-400 mt-0.5">Attended</div>
          </div>
        </div>

        {/* Attendee list */}
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={regSearch} onChange={e => setRegSearch(e.target.value)}
              placeholder="Search attendees..." className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]" />
          </div>
          {registrations.length > 0 && (
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>

        {filteredRegs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Users size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{regSearch ? 'No attendees match' : 'No registrations yet'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRegs.map(r => (
              <div key={r.id} className="bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: r.status === 'attended' ? '#22c55e' : 'var(--brand-color, #d4a017)' }}>
                  {r.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      r.status === 'attended' ? 'bg-green-100 text-green-700' :
                      r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'
                    }`}>{r.status}</span>
                  </div>
                  <p className="text-xs text-gray-400">{r.email} · #{r.ticketCode}</p>
                </div>
                {r.status === 'confirmed' && (
                  <button
                    onClick={() => checkIn(r)}
                    disabled={checkingIn === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
                  >
                    <Check size={12} /> Check In
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="max-w-3xl mx-auto">
      {events.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No events yet</p>
          <p className="text-sm mt-1">Create your first event to start accepting registrations</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <div
              key={ev.id}
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm cursor-pointer hover:border-[#d4a017]/30 transition-all"
              onClick={() => openDetail(ev)}
            >
              {ev.coverImage && (
                <div className="w-full h-32 rounded-xl overflow-hidden mb-3">
                  <img src={ev.coverImage} alt={ev.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900 truncate">{ev.title}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[ev.status]}`}>
                      {ev.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                    {ev.startDate && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock size={11} /> {fmtDate(ev.startDate)}
                      </span>
                    )}
                    {ev.isOnline ? (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Globe size={11} /> Online
                      </span>
                    ) : ev.location ? (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <MapPin size={11} /> {ev.location}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <DollarSign size={11} /> {ev.price > 0 ? `$${ev.price}` : 'Free'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); togglePin(ev); }}
                    className="p-2 rounded-xl hover:bg-yellow-50 transition-colors"
                    title={ev.pinned ? 'Unpin from feed' : 'Pin to feed'}
                  >
                    <Pin size={14} className={ev.pinned ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); openEdit(ev); }}
                    className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                    <Edit2 size={14} className="text-gray-400" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setDeleteId(ev.id); }}
                    className="p-2 rounded-xl hover:bg-red-50 transition-colors">
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-gray-900 mb-2">Delete this event?</p>
            <p className="text-sm text-gray-500 mb-5">Registrations will not be deleted automatically.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEvents;
