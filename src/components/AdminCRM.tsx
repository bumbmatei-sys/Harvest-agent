"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, Users, Mail, Phone } from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: 'donor' | 'member' | 'both';
  notes?: string;
  totalDonated?: number;
  lastContact?: string;
  tenantId?: string;
}

const emptyContact: Omit<Contact, 'id'> = {
  name: '',
  email: '',
  phone: '',
  type: 'member',
  notes: '',
  totalDonated: 0,
  lastContact: '',
};

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

const AdminCRM: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Contact['type']>('all');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<Omit<Contact, 'id'>>(emptyContact);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const tid = await getTenantScope();
      if (cancelled) return;
      setTenantId(tid);
      const q = tid
        ? query(collection(db, 'contacts'), where('tenantId', '==', tid), orderBy('name'), limit(200))
        : query(collection(db, 'contacts'), orderBy('name'), limit(200));
      unsub = onSnapshot(q, (snap) => {
        setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact));
        setLoading(false);
      }, (err) => {
        try { handleFirestoreError(err, OperationType.GET, 'contacts'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    })();
    return () => { cancelled = true; unsub?.(); };
  }, []);

  const filtered = contacts.filter((c) => {
    const matchType = filter === 'all' || c.type === filter || (filter !== 'both' && c.type === 'both');
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const openCreate = () => { setEditing(null); setForm(emptyContact); setShowForm(true); };
  const openEdit = (c: Contact) => { setEditing(c); setForm({ ...c }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'contacts', editing.id), { ...form, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...form,
          tenantId: tenantId || null,
          createdAt: serverTimestamp(),
        });
      }
      setShowForm(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try { await deleteDoc(doc(db, 'contacts', deleteId)); }
    catch (e) { console.error(e); }
    setDeleteId(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <h2 className="text-xl font-bold text-gray-900">CRM</h2>
          <span className="text-sm text-gray-400 font-normal">— Donors & Members</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          <Plus size={16} /> Add Contact
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]"
          />
        </div>
        <select
          value={filter} onChange={(e) => setFilter(e.target.value as any)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white"
        >
          <option value="all">All</option>
          <option value="donor">Donors</option>
          <option value="member">Members</option>
          <option value="both">Both</option>
        </select>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {(['donor', 'member', 'both'] as const).map((t) => (
          <div key={t} className="bg-white rounded-xl p-3 border border-gray-100 text-center">
            <div className="text-xl font-bold text-gray-900">{contacts.filter((c) => c.type === t).length}</div>
            <div className="text-xs text-gray-500 mt-0.5">{TYPE_LABELS[t]}s</div>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">{search || filter !== 'all' ? 'No contacts match' : 'No contacts yet'}</p>
          {!search && filter === 'all' && <p className="text-sm mt-1">Add your first donor or member</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm truncate">{c.name}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[c.type]}`}>{TYPE_LABELS[c.type]}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {c.email && <span className="text-xs text-gray-400 truncate flex items-center gap-1"><Mail size={11} />{c.email}</span>}
                  {c.phone && <span className="text-xs text-gray-400 flex items-center gap-1"><Phone size={11} />{c.phone}</span>}
                </div>
              </div>
              {c.totalDonated ? (
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-gray-800">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(c.totalDonated)}
                  </div>
                  <div className="text-[10px] text-gray-400">total donated</div>
                </div>
              ) : null}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => openEdit(c)} className="p-2 rounded-xl hover:bg-gray-50"><Edit2 size={15} className="text-gray-400" /></button>
                <button onClick={() => setDeleteId(c.id)} className="p-2 rounded-xl hover:bg-red-50"><Trash2 size={15} className="text-red-400" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact form */}
      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">{editing ? 'Edit Contact' : 'Add Contact'}</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="Full name" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Contact['type'] })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] bg-white">
                  <option value="member">Member</option>
                  <option value="donor">Donor</option>
                  <option value="both">Donor & Member</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Email</label>
                <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="email@example.com" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Phone</label>
                <input type="tel" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="+1 (555) 000-0000" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Total Donated ($)</label>
                <input type="number" min={0} value={form.totalDonated || 0} onChange={(e) => setForm({ ...form, totalDonated: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Last Contact Date</label>
                <input type="date" value={form.lastContact || ''} onChange={(e) => setForm({ ...form, lastContact: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Notes</label>
                <textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] resize-none"
                  rows={3} placeholder="Any notes about this contact..." />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {saving ? 'Saving...' : 'Save'}
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
};

export default AdminCRM;
