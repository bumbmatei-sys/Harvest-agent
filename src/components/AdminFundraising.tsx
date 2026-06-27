"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Heart, DollarSign } from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { notifyError } from '../utils/notify';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { useCampaigns } from '../hooks/queries/useCampaignQueries';

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

interface AdminFundraisingProps {
  /** Deep-link: open this campaign on mount (e.g. from a chat attachment card). */
  initialCampaignId?: string;
  /** Called once the deep-linked campaign has been opened, to clear the URL param. */
  onItemConsumed?: () => void;
}

const AdminFundraising: React.FC<AdminFundraisingProps> = ({ initialCampaignId, onItemConsumed }) => {
  const { setHeaderAction } = useAdminHeader();
  const queryClient = useQueryClient();
  const { currentTenantId: tenantId, isAuthReady } = useAppStore();

  const { data: campaigns = [], isLoading: loading } = useCampaigns(tenantId, isAuthReady);

  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState<Omit<Campaign, 'id'>>(empty);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setForm(empty); setShowForm(true); };
  const openEdit = (c: Campaign) => { setEditing(c); setForm({ ...c }); setShowForm(true); };

  // Publish the "New Campaign" action into the shared header.
  useEffect(() => {
    setHeaderAction(<HeaderActionButton label="New Campaign" onClick={() => { setEditing(null); setForm(empty); setShowForm(true); }} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction]);

  // Deep-link: open a specific campaign when navigated to /admin/fundraising/:id.
  useEffect(() => {
    if (!initialCampaignId) return;
    const c = campaigns.find(x => x.id === initialCampaignId);
    if (c) { setEditing(c); setForm({ ...c }); setShowForm(true); onItemConsumed?.(); }
  }, [initialCampaignId, campaigns]); // eslint-disable-line react-hooks/exhaustive-deps

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
      await queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] });
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
        const others = campaigns.filter((other) => other.id !== c.id && other.isActive);
        await Promise.all(
          others.map((other) => updateDoc(doc(db, 'campaigns', other.id), { isActive: false }))
        );
      }
      await updateDoc(doc(db, 'campaigns', c.id), { isActive: !c.isActive });
      await queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] });
    } catch (e) { notifyError('Failed to update campaign', e); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, 'campaigns', deleteId));
      await queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] });
    } catch (e) { notifyError('Failed to delete campaign', e); }
    setDeleteId(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
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
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold"
                  placeholder="Campaign title" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold resize-none"
                  rows={3} placeholder="What is this campaign for?" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Goal ($)</label>
                <input type="number" min={0} value={form.goal} onChange={(e) => setForm({ ...form, goal: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">End Date</label>
                <input type="date" value={form.endDate || ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Cover Image URL</label>
                <input value={form.coverImage || ''} onChange={(e) => setForm({ ...form, coverImage: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold"
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
