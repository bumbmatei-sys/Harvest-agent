"use client";
import React, { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, CalendarCheck, Users, MapPin, Clock, DollarSign,
  Check, Download, Search, ChevronRight, Globe, X, Pin, QrCode, Copy,
  Ticket, Tag, ArrowUp, ArrowDown, Link2,
} from 'lucide-react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import QRCode from 'qrcode';
import { db, auth } from '../firebase';
import { sortByTime } from '../utils/query-helpers';
import { notifyError } from '../utils/notify';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useEvents } from '../hooks/queries/useEventQueries';

import type { Event, Registration, TicketType, DiscountCode } from '../hooks/queries/useEventQueries';

type ViewMode = 'list' | 'create' | 'edit' | 'detail';

/** Client-side id generator (uuid is not a dependency). */
const genId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Format a cents price for display ("Free" / "$12.00"). */
const fmtCents = (cents: number) => (cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'Free');

/** Small pill toggle matching the existing online-event toggle style. */
const Toggle: React.FC<{ on: boolean; onClick: () => void }> = ({ on, onClick }) => (
  <button onClick={onClick} className="transition-colors shrink-0" aria-pressed={on}>
    <div className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${on ? 'bg-gold' : 'bg-gray-200'}`}>
      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </div>
  </button>
);

/** Format a discount code's value for display. */
const fmtDiscount = (d: DiscountCode) => (d.type === 'percent' ? `${d.value}% off` : `${fmtCents(d.value)} off`);

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
  // Registration engine
  registrationEnabled: false,
  ticketTypes: [] as TicketType[],
  waitlistEnabled: false,
  discountCodes: [] as DiscountCode[],
  showOnPublicCalendar: true,
};

const AdminEvents: React.FC = () => {
  const { setHeaderAction, setHeaderOverride } = useAdminHeader();
  const queryClient = useQueryClient();
  // Resolve the tenant from the store, falling back to the platform tenant for a
  // super admin if the store value is briefly null (e.g. on a refresh before the
  // App store effect has resolved). This keeps every create/write below from
  // dying on a transient null. On a tenant subdomain currentTenantId is set and
  // takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  const { data: events = [], isLoading: loading } = useEvents(tenantId, isAuthReady);

  const [view, setView] = useState<ViewMode>('list');
  const [selected, setSelected] = useState<Event | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Detail view state
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regSearch, setRegSearch] = useState('');
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Registration-engine sub-forms (inside the create/edit form)
  const emptyTicket = { name: '', description: '', price: '0', capacity: '' };
  const [ticketDraft, setTicketDraft] = useState(emptyTicket);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const emptyDiscount = { code: '', type: 'percent' as DiscountCode['type'], value: '', maxUses: '' };
  const [discountDraft, setDiscountDraft] = useState(emptyDiscount);
  const [showDiscountForm, setShowDiscountForm] = useState(false);

  const registrationUrl = (eventId: string) => `https://${tenantId}.theharvest.app/event/${eventId}`;

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

  // Generate the registration QR code when viewing a registration-enabled event.
  useEffect(() => {
    if (view === 'detail' && selected && selected.registrationEnabled && tenantId) {
      QRCode.toDataURL(registrationUrl(selected.id), { width: 320, margin: 1 })
        .then(setQrDataUrl).catch(() => setQrDataUrl(''));
    } else {
      setQrDataUrl('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      registrationEnabled: ev.registrationEnabled ?? false,
      ticketTypes: Array.isArray(ev.ticketTypes) ? ev.ticketTypes : [],
      waitlistEnabled: ev.waitlistEnabled ?? false,
      discountCodes: Array.isArray(ev.discountCodes) ? ev.discountCodes : [],
      showOnPublicCalendar: ev.showOnPublicCalendar ?? true,
    });
    setShowTicketForm(false);
    setShowDiscountForm(false);
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
        registrationEnabled: form.registrationEnabled,
        ticketTypes: form.ticketTypes,
        waitlistEnabled: form.waitlistEnabled,
        discountCodes: form.discountCodes,
        showOnPublicCalendar: form.showOnPublicCalendar,
      };
      if (view === 'edit' && selected) {
        await updateDoc(doc(db, 'tenants', tenantId, 'events', selected.id), {
          ...data,
          updatedAt: serverTimestamp(),
        });
        setSelected({ ...selected, ...data } as Event);
        await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
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
          registrationEnabled: data.registrationEnabled || false,
          ticketTypes: data.ticketTypes || [],
          waitlistEnabled: data.waitlistEnabled || false,
          discountCodes: data.discountCodes || [],
          showOnPublicCalendar: data.showOnPublicCalendar ?? true,
        };
        await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
        setSelected(newEvent);
        setView('detail');
      }
    } catch (e) { notifyError('Failed to save event', e); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId || !tenantId) return;
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'events', deleteId));
      await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
    } catch (e) { notifyError('Failed to delete event', e); }
    setDeleteId(null);
    if (view === 'detail') setView('list');
  };

  const togglePin = async (ev: Event) => {
    if (!tenantId) return;
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'events', ev.id), { pinned: !ev.pinned });
      await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
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

  // ── Registration engine: ticket type management (within the form) ──
  const saveTicketDraft = () => {
    if (!ticketDraft.name.trim()) return;
    const t: TicketType = {
      id: genId(),
      name: ticketDraft.name.trim(),
      description: ticketDraft.description.trim() || undefined,
      price: Math.max(0, Math.round((Number(ticketDraft.price) || 0) * 100)),
      capacity: ticketDraft.capacity ? Number(ticketDraft.capacity) : null,
      order: form.ticketTypes.length,
    };
    setForm({ ...form, ticketTypes: [...form.ticketTypes, t] });
    setTicketDraft(emptyTicket);
    setShowTicketForm(false);
  };

  const removeTicket = (id: string) =>
    setForm({ ...form, ticketTypes: form.ticketTypes.filter(t => t.id !== id).map((t, i) => ({ ...t, order: i })) });

  const moveTicket = (id: string, dir: -1 | 1) => {
    const arr = [...form.ticketTypes];
    const idx = arr.findIndex(t => t.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setForm({ ...form, ticketTypes: arr.map((t, i) => ({ ...t, order: i })) });
  };

  // ── Registration engine: discount code management ──
  const saveDiscountDraft = () => {
    const code = discountDraft.code.trim().toUpperCase();
    if (!code) return;
    if (form.discountCodes.some(d => d.code === code)) { notifyError('A discount code with that name already exists', null); return; }
    const isPercent = discountDraft.type === 'percent';
    const raw = Number(discountDraft.value) || 0;
    const value = isPercent ? Math.min(100, Math.max(0, Math.round(raw))) : Math.max(0, Math.round(raw * 100));
    const d: DiscountCode = {
      code,
      type: discountDraft.type,
      value,
      maxUses: discountDraft.maxUses ? Number(discountDraft.maxUses) : null,
      usedCount: 0,
    };
    setForm({ ...form, discountCodes: [...form.discountCodes, d] });
    setDiscountDraft(emptyDiscount);
    setShowDiscountForm(false);
  };

  const removeDiscount = (code: string) =>
    setForm({ ...form, discountCodes: form.discountCodes.filter(d => d.code !== code) });

  const copyRegUrl = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(registrationUrl(selected.id)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
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
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" placeholder="Event name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold resize-none"
                placeholder="What is this event about?" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Cover Image URL</label>
              <input value={form.coverImage} onChange={e => setForm({ ...form, coverImage: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" placeholder="https://..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Start Date & Time *</label>
                <input type="datetime-local" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">End Date & Time</label>
                <input type="datetime-local" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-gray-700">Online Event</label>
                <button onClick={() => setForm({ ...form, isOnline: !form.isOnline })} className="transition-colors">
                  <div className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.isOnline ? 'bg-gold' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isOnline ? 'translate-x-5' : ''}`} />
                  </div>
                </button>
              </div>
              {form.isOnline ? (
                <input value={form.onlineLink} onChange={e => setForm({ ...form, onlineLink: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" placeholder="Meeting link (Zoom, Google Meet...)" />
              ) : (
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" placeholder="Event location / address" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Capacity (blank = unlimited)</label>
                <input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" placeholder="e.g. 100" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Ticket Price ($)</label>
                <input type="number" min={0} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" placeholder="0 = free" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Registration Deadline</label>
              <input type="datetime-local" value={form.registrationDeadline} onChange={e => setForm({ ...form, registrationDeadline: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" />
            </div>

            {/* ── Registration engine ── */}
            <div className="border-t border-gray-100 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">Enable Registrations</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    When enabled, attendees can sign up for this event via a public registration page with QR code access.
                  </p>
                </div>
                <Toggle on={form.registrationEnabled} onClick={() => setForm({ ...form, registrationEnabled: !form.registrationEnabled })} />
              </div>

              {form.registrationEnabled && (
                <div className="mt-5 space-y-5">
                  {/* Ticket Types */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><Ticket size={13} /> Ticket Types</h4>
                      {!showTicketForm && (
                        <button onClick={() => { setTicketDraft(emptyTicket); setShowTicketForm(true); }}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                          <Plus size={12} /> Add Ticket Type
                        </button>
                      )}
                    </div>

                    {form.ticketTypes.length === 0 && !showTicketForm && (
                      <p className="text-xs text-gray-400 bg-gray-50 rounded-xl p-3">
                        Add at least one ticket type. Attendees will choose one when registering.
                      </p>
                    )}

                    <div className="space-y-2">
                      {form.ticketTypes.map((t, i) => (
                        <div key={t.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                          <div className="flex flex-col">
                            <button onClick={() => moveTicket(t.id, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30"><ArrowUp size={12} /></button>
                            <button onClick={() => moveTicket(t.id, 1)} disabled={i === form.ticketTypes.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30"><ArrowDown size={12} /></button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
                            <p className="text-xs text-gray-400">
                              {fmtCents(t.price)} · {t.capacity == null ? 'Unlimited' : `${t.capacity} cap`}
                              {t.description ? ` · ${t.description}` : ''}
                            </p>
                          </div>
                          <button onClick={() => removeTicket(t.id)} className="p-1.5 rounded-lg hover:bg-red-50"><X size={14} className="text-red-400" /></button>
                        </div>
                      ))}
                    </div>

                    {showTicketForm && (
                      <div className="mt-2 bg-gray-50 rounded-xl p-3 space-y-2.5">
                        <input value={ticketDraft.name} onChange={e => setTicketDraft({ ...ticketDraft, name: e.target.value })}
                          placeholder="Name (e.g. Adult)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                        <input value={ticketDraft.description} onChange={e => setTicketDraft({ ...ticketDraft, description: e.target.value })}
                          placeholder="Description (optional)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" min={0} step="0.01" value={ticketDraft.price} onChange={e => setTicketDraft({ ...ticketDraft, price: e.target.value })}
                            placeholder="Price ($) — 0 = Free" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                          <input type="number" min={0} value={ticketDraft.capacity} onChange={e => setTicketDraft({ ...ticketDraft, capacity: e.target.value })}
                            placeholder="Capacity (blank = ∞)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setShowTicketForm(false); setTicketDraft(emptyTicket); }} className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Cancel</button>
                          <button onClick={saveTicketDraft} disabled={!ticketDraft.name.trim()}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Add</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Waitlist — only when at least one ticket type is capped */}
                  {form.ticketTypes.some(t => t.capacity != null) && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Enable waitlist when capacity is full</span>
                      <Toggle on={form.waitlistEnabled} onClick={() => setForm({ ...form, waitlistEnabled: !form.waitlistEnabled })} />
                    </div>
                  )}

                  {/* Discount Codes */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><Tag size={13} /> Discount Codes</h4>
                      {!showDiscountForm && (
                        <button onClick={() => { setDiscountDraft(emptyDiscount); setShowDiscountForm(true); }}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                          <Plus size={12} /> Add Discount Code
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {form.discountCodes.map(d => (
                        <div key={d.code} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.type === 'percent' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{d.type === 'percent' ? '%' : '$'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate font-mono">{d.code}</p>
                            <p className="text-xs text-gray-400">{fmtDiscount(d)} · {d.usedCount}{d.maxUses == null ? '' : `/${d.maxUses}`} used</p>
                          </div>
                          <button onClick={() => removeDiscount(d.code)} className="p-1.5 rounded-lg hover:bg-red-50"><X size={14} className="text-red-400" /></button>
                        </div>
                      ))}
                    </div>

                    {showDiscountForm && (
                      <div className="mt-2 bg-gray-50 rounded-xl p-3 space-y-2.5">
                        <input value={discountDraft.code} onChange={e => setDiscountDraft({ ...discountDraft, code: e.target.value.toUpperCase() })}
                          placeholder="CODE (e.g. SCHOLAR50)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-gold" />
                        <div className="flex gap-3">
                          <label className="flex items-center gap-1.5 text-sm text-gray-700">
                            <input type="radio" name="discountType" checked={discountDraft.type === 'percent'} onChange={() => setDiscountDraft({ ...discountDraft, type: 'percent' })} /> Percent off
                          </label>
                          <label className="flex items-center gap-1.5 text-sm text-gray-700">
                            <input type="radio" name="discountType" checked={discountDraft.type === 'fixed'} onChange={() => setDiscountDraft({ ...discountDraft, type: 'fixed' })} /> Fixed ($) off
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" min={0} step={discountDraft.type === 'percent' ? '1' : '0.01'} value={discountDraft.value} onChange={e => setDiscountDraft({ ...discountDraft, value: e.target.value })}
                            placeholder={discountDraft.type === 'percent' ? 'Percent (0–100)' : 'Amount ($)'} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                          <input type="number" min={0} value={discountDraft.maxUses} onChange={e => setDiscountDraft({ ...discountDraft, maxUses: e.target.value })}
                            placeholder="Max uses (blank = ∞)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setShowDiscountForm(false); setDiscountDraft(emptyDiscount); }} className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Cancel</button>
                          <button onClick={saveDiscountDraft} disabled={!discountDraft.code.trim()}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Add</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Public calendar */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Show on public calendar</span>
                      <Toggle on={form.showOnPublicCalendar} onClick={() => setForm({ ...form, showOnPublicCalendar: !form.showOnPublicCalendar })} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Your public calendar is at {tenantId || 'your-ministry'}.theharvest.app/calendar</p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Event['status'] })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold bg-white">
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
    const waitlistedCount = registrations.filter(r => r.waitlisted).length;
    const ticketTypes = Array.isArray(selected.ticketTypes) ? selected.ticketTypes : [];
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

        {/* Registration panel — only for registration-enabled events */}
        {selected.registrationEnabled && (
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm mb-5">
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5"><Ticket size={14} /> Public Registration</h3>
            <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
              <div className="text-center">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="Registration QR code" className="w-36 h-36 mx-auto" />
                ) : (
                  <div className="w-36 h-36 mx-auto flex items-center justify-center text-gray-300 border border-dashed border-gray-200 rounded-xl"><QrCode size={40} /></div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-500 mb-1">Registration link</p>
                <p className="text-xs text-gray-500 break-all mb-2">{registrationUrl(selected.id)}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={copyRegUrl} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50">
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied!' : 'Copy link'}
                  </button>
                  {qrDataUrl && (
                    <a href={qrDataUrl} download={`${selected.title.replace(/[^a-z0-9]/gi, '_')}_qr.png`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50">
                      <Download size={13} /> QR
                    </a>
                  )}
                  <a href={registrationUrl(selected.id)} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50">
                    <Link2 size={13} /> Open
                  </a>
                </div>

                {/* Ticket type breakdown */}
                {ticketTypes.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {ticketTypes.map(t => {
                      const count = registrations.filter(r => r.ticketTypeId === t.id && !r.waitlisted).length;
                      return (
                        <div key={t.id} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 font-medium truncate">{t.name}</span>
                          <span className="text-gray-400">{count} registered{t.capacity == null ? '' : ` / ${t.capacity} capacity`}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {selected.waitlistEnabled && (
                  <p className="text-xs text-amber-600 mt-3 font-medium">{waitlistedCount} on waitlist</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attendee list */}
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={regSearch} onChange={e => setRegSearch(e.target.value)}
              placeholder="Search attendees..." className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold" />
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
                      r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                      r.status === 'waitlisted' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                    }`}>{r.status}</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {r.email} · #{r.ticketCode}{r.ticketTypeName ? ` · ${r.ticketTypeName}` : ''}
                  </p>
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
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] transition-all"
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
