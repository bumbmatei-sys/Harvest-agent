"use client";
import React, { useState, useEffect } from 'react';
import {
  Plus, Search, Edit2, Trash2, Users, Mail, Phone, ArrowLeft,
  MessageSquare, DollarSign, PhoneCall, Calendar, Clock, ChevronRight, MapPin
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, limit, serverTimestamp, Timestamp, getDocs
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import AnalyticsAndRoles, { Permission } from './AnalyticsAndRoles';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: 'donor' | 'member' | 'both';
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  notes: string;
  tags: string[];
  totalDonated: number;
  lastDonationAt: Timestamp | null;
  memberSince: Timestamp | null;
  createdAt: Timestamp | null;
  createdBy: string;
  updatedAt: Timestamp | null;
  tenantId?: string;
}

interface ContactActivity {
  id: string;
  contactId: string;
  type: 'note' | 'donation' | 'email' | 'call' | 'meeting';
  description: string;
  amount: number | null;
  createdAt: Timestamp | null;
  createdBy: string;
}

const TYPE_LABELS: Record<Contact['type'], string> = {
  donor: 'Donor',
  member: 'Member',
  both: 'Donor & Member',
};

const TYPE_COLORS: Record<Contact['type'], string> = {
  donor: 'bg-amber-100 text-amber-700',
  member: 'bg-blue-100 text-blue-700',
  both: 'bg-purple-100 text-purple-700',
};

const ACTIVITY_ICONS: Record<ContactActivity['type'], React.ReactNode> = {
  note: <MessageSquare size={13} />,
  donation: <DollarSign size={13} />,
  email: <Mail size={13} />,
  call: <PhoneCall size={13} />,
  meeting: <Calendar size={13} />,
};

const emptyContact = {
  firstName: '', lastName: '', email: '', phone: '', type: 'member' as Contact['type'],
  notes: '', tags: [] as string[], totalDonated: 0,
  address: { street: '', city: '', state: '', zip: '', country: '' },
};

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtDate = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

type ViewMode = 'list' | 'detail' | 'form';

interface AdminCRMProps {
  currentUserRole?: string;
  currentUserPermissions?: Permission | null;
}

const AdminCRM: React.FC<AdminCRMProps> = ({ currentUserRole, currentUserPermissions }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Contact['type']>('all');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyContact);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [actForm, setActForm] = useState({ type: 'note' as ContactActivity['type'], description: '', amount: '' });
  const [savingAct, setSavingAct] = useState(false);

  // CRM sub-view: Contacts (default) or user registration Analytics
  const [crmSubView, setCrmSubView] = useState<'contacts' | 'analytics'>('contacts');

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    getTenantScope().then(tid => {
      if (cancelled) return;
      setTenantId(tid);
      const q = tid
        ? query(collection(db, 'contacts'), where('tenantId', '==', tid), orderBy('lastName'), limit(300))
        : query(collection(db, 'contacts'), orderBy('lastName'), limit(300));
      unsub = onSnapshot(q, snap => {
        setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contact));
        setLoading(false);
      }, err => {
        try { handleFirestoreError(err, OperationType.GET, 'contacts'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const q = query(
      collection(db, 'contactActivities'),
      where('contactId', '==', selected.id),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const unsub = onSnapshot(q, snap => {
      setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContactActivity));
    });
    return unsub;
  }, [selected]);

  const filtered = contacts.filter(c => {
    const matchType = filter === 'all' || c.type === filter || (filter !== 'both' && c.type === 'both');
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const matchSearch = !search ||
      fullName.includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const openCreate = () => { setIsEditing(false); setForm(emptyContact); setView('form'); };

  const openEdit = (c: Contact) => {
    setIsEditing(true);
    setForm({
      firstName: c.firstName || '', lastName: c.lastName || '', email: c.email || '',
      phone: c.phone || '', type: c.type, notes: c.notes || '', tags: c.tags || [],
      totalDonated: c.totalDonated || 0,
      address: { ...{ street: '', city: '', state: '', zip: '', country: '' }, ...c.address },
    });
    setSelected(c);
    setView('form');
  };

  const openDetail = (c: Contact) => { setSelected(c); setView('detail'); };

  const handleSave = async () => {
    if (!form.firstName.trim()) return;
    setSaving(true);
    try {
      const data = {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim(), phone: form.phone.trim(), type: form.type,
        notes: form.notes.trim(), tags: form.tags, totalDonated: form.totalDonated,
        address: form.address, updatedAt: serverTimestamp(),
      };
      if (isEditing && selected) {
        await updateDoc(doc(db, 'contacts', selected.id), data);
        setSelected({ ...selected, ...data, updatedAt: null });
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...data, tenantId: tenantId || null,
          lastDonationAt: null, memberSince: null,
          createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
        });
      }
      setView(isEditing ? 'detail' : 'list');
    } catch (e) { notifyError('Failed to save contact', e); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try { await deleteDoc(doc(db, 'contacts', deleteId)); }
    catch (e) { notifyError('Failed to delete contact', e); }
    setDeleteId(null);
    if (view === 'detail') setView('list');
  };

  const addActivity = async () => {
    if (!actForm.description.trim() || !selected) return;
    setSavingAct(true);
    try {
      await addDoc(collection(db, 'contactActivities'), {
        contactId: selected.id, tenantId: tenantId || null, type: actForm.type,
        description: actForm.description.trim(),
        amount: actForm.type === 'donation' && actForm.amount ? Number(actForm.amount) : null,
        createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
      });
      if (actForm.type === 'donation' && actForm.amount) {
        const newTotal = (selected.totalDonated || 0) + Number(actForm.amount);
        await updateDoc(doc(db, 'contacts', selected.id), { totalDonated: newTotal, lastDonationAt: serverTimestamp() });
        setSelected({ ...selected, totalDonated: newTotal });
      }
      setShowAddActivity(false);
      setActForm({ type: 'note', description: '', amount: '' });
    } catch (e) { notifyError('Failed to add activity', e); }
    finally { setSavingAct(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  // Sub-tab bar — visible in all sub-views (Contacts / Analytics)
  const subTabBar = (
    <div className="flex gap-1 mb-5 border-b border-gray-200">
      <button
        onClick={() => setCrmSubView('contacts')}
        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
          crmSubView === 'contacts'
            ? 'border-[#d4a017] text-[#d4a017]'
            : 'border-transparent text-gray-400 hover:text-gray-600'
        }`}
      >
        Contacts
      </button>
      <button
        onClick={() => { setCrmSubView('analytics'); setView('list'); setSelected(null); }}
        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
          crmSubView === 'analytics'
            ? 'border-[#d4a017] text-[#d4a017]'
            : 'border-transparent text-gray-400 hover:text-gray-600'
        }`}
      >
        Analytics
      </button>
    </div>
  );

  // ── Analytics sub-view ──
  if (crmSubView === 'analytics') {
    return (
      <div className="max-w-3xl mx-auto">
        {subTabBar}
        {currentUserRole ? (
          <AnalyticsAndRoles
            currentUserRole={currentUserRole}
            currentUserPermissions={currentUserPermissions}
            mode="analytics"
          />
        ) : (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">Analytics unavailable.</p>
          </div>
        )}
      </div>
    );
  }

  // ── Form View ──
  if (view === 'form') {
    return (
      <div className="max-w-2xl mx-auto">
        {subTabBar}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView(isEditing ? 'detail' : 'list')} className="p-2 rounded-xl hover:bg-gray-100">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">{isEditing ? 'Edit Contact' : 'Add Contact'}</h2>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">First Name *</label>
              <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="First name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">Last Name</label>
              <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="Last name" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as Contact['type'] })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white">
              <option value="member">Member</option>
              <option value="donor">Donor</option>
              <option value="both">Donor & Member</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="email@example.com" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="+1 555 000 0000" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">Street Address</label>
            <input value={form.address.street || ''} onChange={e => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="123 Main St" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">City</label>
              <input value={form.address.city || ''} onChange={e => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">State</label>
              <input value={form.address.state || ''} onChange={e => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">ZIP</label>
              <input value={form.address.zip || ''} onChange={e => setForm({ ...form, address: { ...form.address, zip: e.target.value } })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] resize-none"
              placeholder="Any notes about this contact..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setView(isEditing ? 'detail' : 'list')} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.firstName.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View ──
  if (view === 'detail' && selected) {
    return (
      <div className="max-w-2xl mx-auto">
        {subTabBar}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button onClick={() => { setSelected(null); setView('list'); }} className="p-2 rounded-xl hover:bg-gray-100">
              <ArrowLeft size={18} className="text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white flex-shrink-0"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {selected.firstName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selected.firstName} {selected.lastName}</h2>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[selected.type]}`}>
                  {TYPE_LABELS[selected.type]}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => openEdit(selected)} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50">
              <Edit2 size={14} className="text-gray-500" />
            </button>
            <button onClick={() => setDeleteId(selected.id)} className="p-2 rounded-xl border border-red-100 hover:bg-red-50">
              <Trash2 size={14} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* Contact info card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="grid grid-cols-2 gap-3">
            {selected.email && (
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate">{selected.email}</span>
              </div>
            )}
            {selected.phone && (
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700">{selected.phone}</span>
              </div>
            )}
            {selected.memberSince && (
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700">Member since {fmtDate(selected.memberSince)}</span>
              </div>
            )}
            {selected.totalDonated > 0 && (
              <div className="flex items-center gap-2">
                <DollarSign size={14} style={{ color: 'var(--brand-color, #d4a017)' }} className="flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-900">{fmt(selected.totalDonated)} total</span>
              </div>
            )}
            {selected.lastDonationAt && (
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700">Last gift {fmtDate(selected.lastDonationAt)}</span>
              </div>
            )}
            {selected.address?.city && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate">
                  {[selected.address.city, selected.address.state].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
          {selected.tags && selected.tags.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5">
              {selected.tags.map(tag => (
                <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{tag}</span>
              ))}
            </div>
          )}
          {selected.notes && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 leading-relaxed">{selected.notes}</p>
            </div>
          )}
        </div>

        {/* Activity timeline */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">Activity Timeline</h3>
          <button
            onClick={() => setShowAddActivity(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <Plus size={12} /> Add Activity
          </button>
        </div>

        {activities.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-gray-400">
            <Clock size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Activities will appear here when the user makes donations or attends events.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activities.map(act => (
              <div key={act.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3">
                <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white"
                  style={{ backgroundColor: act.type === 'donation' ? 'var(--brand-color, #d4a017)' : '#6b7280' }}>
                  {ACTIVITY_ICONS[act.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-gray-500 capitalize">{act.type}</span>
                    {act.amount && <span className="text-xs font-bold" style={{ color: 'var(--brand-color, #d4a017)' }}>{fmt(act.amount)}</span>}
                    <span className="text-[10px] text-gray-400 ml-auto">{fmtDate(act.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-700">{act.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Activity Modal */}
        {showAddActivity && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md">
              <div className="p-5 border-b border-gray-100"><h3 className="font-bold text-gray-900">Add Activity</h3></div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">Type</label>
                  <select value={actForm.type} onChange={e => setActForm({ ...actForm, type: e.target.value as ContactActivity['type'] })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white">
                    <option value="note">Note</option>
                    <option value="donation">Donation</option>
                    <option value="email">Email</option>
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                  </select>
                </div>
                {actForm.type === 'donation' && (
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1 block">Amount ($)</label>
                    <input type="number" min={0} value={actForm.amount} onChange={e => setActForm({ ...actForm, amount: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" placeholder="0.00" />
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">Description *</label>
                  <textarea value={actForm.description} onChange={e => setActForm({ ...actForm, description: e.target.value })}
                    rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] resize-none"
                    placeholder="What happened?" />
                </div>
              </div>
              <div className="p-5 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowAddActivity(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
                <button onClick={addActivity} disabled={savingAct || !actForm.description.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                  {savingAct ? 'Saving...' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteId && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
              <p className="font-bold text-gray-900 mb-2">Delete contact?</p>
              <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
                <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List View ──
  const totalGiven = contacts.reduce((s, c) => s + (c.totalDonated || 0), 0);
  const memberCount = contacts.filter(c => c.type === 'member' || c.type === 'both').length;
  const donorCount = contacts.filter(c => c.type === 'donor' || c.type === 'both').length;

  return (
    <div className="max-w-3xl mx-auto">
      {subTabBar}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <h2 className="text-xl font-bold text-gray-900">CRM</h2>
          <span className="text-sm text-gray-400 font-normal">— Donors & Members</span>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
          <Plus size={16} /> Add Contact
        </button>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl p-3 border border-gray-100 text-center shadow-sm">
          <div className="text-xl font-bold text-gray-900">{memberCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">Members</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-gray-100 text-center shadow-sm">
          <div className="text-xl font-bold text-gray-900">{donorCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">Donors</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-gray-100 text-center shadow-sm">
          <div className="text-base font-bold text-gray-900">{fmt(totalGiven)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total Given</div>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]" />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as any)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white">
          <option value="all">All</option>
          <option value="donor">Donors</option>
          <option value="member">Members</option>
          <option value="both">Both</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">{search || filter !== 'all' ? 'No contacts match' : 'No contacts yet'}</p>
          {!search && filter === 'all' && <p className="text-sm mt-1">Add your first donor or member</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div
              key={c.id}
              onClick={() => openDetail(c)}
              className="bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3 cursor-pointer hover:border-[#d4a017]/30 transition-all"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {c.firstName?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm truncate">{c.firstName} {c.lastName}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[c.type]}`}>{TYPE_LABELS[c.type]}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {c.email && <span className="text-xs text-gray-400 truncate flex items-center gap-1"><Mail size={11} />{c.email}</span>}
                  {c.phone && <span className="text-xs text-gray-400 flex items-center gap-1"><Phone size={11} />{c.phone}</span>}
                </div>
              </div>
              {c.totalDonated > 0 && (
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-gray-800">{fmt(c.totalDonated)}</div>
                  <div className="text-[10px] text-gray-400">donated</div>
                </div>
              )}
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-gray-900 mb-2">Delete contact?</p>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
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

export default AdminCRM;