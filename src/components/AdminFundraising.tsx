"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Heart, DollarSign } from 'lucide-react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, limit, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import { sortByNumber } from '../utils/query-helpers';

interface Campaign {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  goal: number;
  raised: number;
  endDate?: string;
  isActive: boolean;
  tenantId?: string;
}

const empty: Omit<Campaign, 'id'> = {
  title: '',
  description: '',
  coverImage: '',
  goal: 0,
  raised: 0,
  endDate: '',
  isActive: false,
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const AdminFundraising: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState<Omit<Campaign, 'id'>>(empty);
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
      // Single-field filter only (tenantId); sort client-side to avoid a composite index.
      const q = tid
        ? query(collection(db, 'campaigns'), where('tenantId', '==', tid), limit(100))
        : query(collection(db, 'campaigns'), limit(100));
      unsub = onSnapshot(q, (snap) => {
        setCampaigns(sortByNumber(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Campaign), 'isActive', 'desc'));
        setLoading(false);
      }, (err) => {
        try { handleFirestoreError(err, OperationType.GET, 'campaigns'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    })();
    return () => { cancelled = true; unsub?.(); };
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowForm(true); };
  const openEdit = (c: Campaign) => { setEditing(c); setForm({ ...c }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'campaigns', editing.id), { ...form, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'campaigns'), {
          ...form,
          tenantId: tenantId || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setShowForm(false);
    } catch (e) {
      notifyError('Failed to save campaign', e);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: Campaign) => {
    try {
      if (!c.isActive) {
        // Deactivate all other campaigns first (only 1 active at a time)
        const others = campaigns.filter((other) => other.id !== c.id && other.isActive);
        await Promise.all(
          others.map((other) => updateDoc(doc(db, 'campaigns', other.id), { isActive: false }))
        );
      }
      await updateDoc(doc(db, 'campaigns', c.id), { isActive: !c.isActive });
    } catch (e) { notifyError('Failed to update campaign', e); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try { await deleteDoc(doc(db, 'campaigns', deleteId)); }
    catch (e) { notifyError('Failed to delete campaign', e); }
    setDeleteId(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Heart size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <h2 className="text-xl font-bold text-gray-900">Fundraising Campaigns</h2>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          <Plus size={16} /> New Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Heart size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first fundraising campaign</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => {
            const pct = c.goal > 0 ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : 0;
            return (
              <div key={c.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 truncate">{c.title}</h3>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-1">{c.description}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleActive(c)} className="p-2 rounded-xl hover:bg-gray-50 transition-colors" title={c.isActive ? 'Deactivate' : 'Activate'}>
                      {c.isActive ? <ToggleRight size={20} style={{ color: 'var(--brand-color, #d4a017)' }} /> : <ToggleLeft size={20} className="text-gray-400" />}
                    </button>
                    <button onClick={() => openEdit(c)} className="p-2 rounded-xl hover:bg-gray-50 transition-colors">
                      <Edit2 size={16} className="text-gray-400" />
                    </button>
                    <button onClick={() => setDeleteId(c.id)} className="p-2 rounded-xl hover:bg-red-50 transition-colors">
                      <Trash2 size={16} className="text-red-400" />
                    </button>
                  </div>
                </div>
                <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1.5">
                  <span className="font-semibold text-gray-800">{fmt(c.raised)} raised</span>
                  <span>of {fmt(c.goal)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--brand-color, #d4a017)' }} />
                </div>
                <div className="flex justify-between mt-1 text-[11px]">
                  <span style={{ color: 'var(--brand-color, #d4a017)' }} className="font-semibold">{pct}%</span>
                  {c.endDate && <span className="text-gray-400">Ends {new Date(c.endDate).toLocaleDateString()}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Campaign form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">{editing ? 'Edit Campaign' : 'New Campaign'}</h3>
            </div>
            <div className="p-5 space-y-4 pb-32">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Title *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="Campaign title" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] resize-none"
                  rows={3} placeholder="What is this campaign for?" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Goal ($)</label>
                <input type="number" min={0} value={form.goal} onChange={(e) => setForm({ ...form, goal: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">End Date</label>
                <input type="date" value={form.endDate || ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Cover Image URL</label>
                <input value={form.coverImage || ''} onChange={(e) => setForm({ ...form, coverImage: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="https://..." />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-gray-700">Set as active campaign</span>
                <button onClick={() => setForm({ ...form, isActive: !form.isActive })} className="transition-colors">
                  {form.isActive
                    ? <ToggleRight size={28} style={{ color: 'var(--brand-color, #d4a017)' }} />
                    : <ToggleLeft size={28} className="text-gray-300" />}
                </button>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.title.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-gray-900 mb-2">Delete campaign?</p>
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

export default AdminFundraising;
