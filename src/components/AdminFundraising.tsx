"use client";
import React, { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Heart, DollarSign, ChevronDown,
  Copy, Check, Send, X, ArrowLeft,
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  query, where, onSnapshot, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { notifyError } from '../utils/notify';
import { authFetch } from '../utils/auth-fetch';
import PaymentSection from './settings/PaymentSection';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID, hasPlatformOverride } from '../utils/tenant-scope';
import { getPlanFeatures } from '../utils/plan-features';
import { useCampaigns, type Campaign } from '../hooks/queries/useCampaignQueries';

const empty: Omit<Campaign, 'id'> = {
  title: '',
  description: '',
  coverImage: '',
  goal: 0,
  raised: 0,
  endDate: '',
  isActive: false,
  campaignType: 'fundraising',
  pledgeDeadline: null,
};

interface Pledge {
  id: string;
  campaignId: string;
  tenantId: string;
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  pledgeAmount: number;   // dollars
  paidAmount: number;     // dollars
  notes: string;
  dueDate: string | null;
  status: 'active' | 'fulfilled' | 'lapsed';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

const emptyPledge = { donorName: '', donorEmail: '', donorPhone: '', pledgeAmount: '', dueDate: '', notes: '' };

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Derive a pledge's display status from its amounts + due date. */
const derivePledgeStatus = (p: Pledge): 'fulfilled' | 'lapsed' | 'active' => {
  if (p.pledgeAmount > 0 && p.paidAmount >= p.pledgeAmount) return 'fulfilled';
  if (p.dueDate && new Date(p.dueDate) < new Date() && p.paidAmount < p.pledgeAmount) return 'lapsed';
  return 'active';
};

interface AdminFundraisingProps {
  /** Deep-link: open this campaign on mount (e.g. from a chat attachment card). */
  initialCampaignId?: string;
  /** Called once the deep-linked campaign has been opened, to clear the URL param. */
  onItemConsumed?: () => void;
}

const AdminFundraising: React.FC<AdminFundraisingProps> = ({ initialCampaignId, onItemConsumed }) => {
  const { setHeaderAction, setHeaderOverride } = useAdminHeader();
  const queryClient = useQueryClient();
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null so a saved campaign is never orphaned with a null tenantId. On
  // a tenant subdomain currentTenantId is set and takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin, tenantPlan } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  const platformOverride = hasPlatformOverride();
  const features = tenantPlan ? getPlanFeatures(tenantPlan) : null;
  const canPledge = platformOverride || !!features?.pledgeCampaigns;

  const { data: campaigns = [], isLoading: loading } = useCampaigns(tenantId, isAuthReady);

  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState<Omit<Campaign, 'id'>>(empty);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  // Pledge detail state
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [tab, setTab] = useState<'overview' | 'pledges'>('overview');
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [pledgeForm, setPledgeForm] = useState(emptyPledge);
  const [showPledgeForm, setShowPledgeForm] = useState(false);
  const [savingPledge, setSavingPledge] = useState(false);
  const [editPledge, setEditPledge] = useState<{ id: string; paidAmount: string; status: Pledge['status'] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [reminderConfirm, setReminderConfirm] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  const openCreate = () => { setEditing(null); setForm(empty); setShowForm(true); };
  const openEdit = (c: Campaign) => { setEditing(c); setForm({ ...empty, ...c }); setShowForm(true); };
  const openDetail = (c: Campaign) => { setDetailCampaign(c); setTab((c.campaignType === 'pledge') ? 'pledges' : 'overview'); };

  // Publish the "New Campaign" action into the shared header (list view only).
  useEffect(() => {
    if (detailCampaign) {
      setHeaderAction(null);
      setHeaderOverride({ title: detailCampaign.title || 'Campaign', onBack: () => setDetailCampaign(null) });
    } else {
      setHeaderOverride(null);
      setHeaderAction(<HeaderActionButton label="New Campaign" onClick={openCreate} />);
    }
    return () => { setHeaderAction(null); setHeaderOverride(null); };
  }, [setHeaderAction, setHeaderOverride, detailCampaign]);

  // Deep-link: open a specific campaign when navigated to /admin/fundraising/:id.
  useEffect(() => {
    if (!initialCampaignId) return;
    const c = campaigns.find(x => x.id === initialCampaignId);
    if (c) { setEditing(c); setForm({ ...empty, ...c }); setShowForm(true); onItemConsumed?.(); }
  }, [initialCampaignId, campaigns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load pledges for the open campaign (single-field query; sort client-side).
  useEffect(() => {
    if (!detailCampaign || !tenantId) { setPledges([]); return; }
    const q = query(
      collection(db, 'tenants', tenantId, 'pledges'),
      where('campaignId', '==', detailCampaign.id),
      limit(1000),
    );
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pledge);
      rows.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setPledges(rows);
    }, () => setPledges([]));
    return () => unsub();
  }, [detailCampaign, tenantId]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (!tenantId) { notifyError('Unable to determine your tenant. Please refresh.', null); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        campaignType: form.campaignType || 'fundraising',
        pledgeDeadline: form.campaignType === 'pledge' ? (form.pledgeDeadline || null) : null,
      };
      if (editing) {
        await updateDoc(doc(db, 'campaigns', editing.id), { ...payload, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'campaigns'), {
          ...payload,
          tenantId,
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

  // ── Pledge operations ──
  const savePledge = async () => {
    if (!tenantId || !detailCampaign) return;
    if (!pledgeForm.donorName.trim() || !pledgeForm.donorEmail.trim() || !Number(pledgeForm.pledgeAmount)) {
      notifyError('Donor name, email and pledge amount are required', null); return;
    }
    setSavingPledge(true);
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'pledges'), {
        campaignId: detailCampaign.id,
        tenantId,
        donorName: pledgeForm.donorName.trim(),
        donorEmail: pledgeForm.donorEmail.trim().toLowerCase(),
        donorPhone: pledgeForm.donorPhone.trim() || null,
        pledgeAmount: Number(pledgeForm.pledgeAmount),
        paidAmount: 0,
        notes: pledgeForm.notes.trim(),
        dueDate: pledgeForm.dueDate || null,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setPledgeForm(emptyPledge);
      setShowPledgeForm(false);
    } catch (e) { notifyError('Failed to add pledge', e); }
    finally { setSavingPledge(false); }
  };

  const saveEditPledge = async () => {
    if (!tenantId || !editPledge) return;
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'pledges', editPledge.id), {
        paidAmount: Number(editPledge.paidAmount) || 0,
        status: editPledge.status,
        updatedAt: serverTimestamp(),
      });
      setEditPledge(null);
    } catch (e) { notifyError('Failed to update pledge', e); }
  };

  const deletePledge = async (id: string) => {
    if (!tenantId) return;
    if (!confirm('Delete this pledge?')) return;
    try { await deleteDoc(doc(db, 'tenants', tenantId, 'pledges', id)); }
    catch (e) { notifyError('Failed to delete pledge', e); }
  };

  const copyPledgeLink = async () => {
    if (!detailCampaign) return;
    try {
      await navigator.clipboard.writeText(`https://${tenantId}.theharvest.app/pledge/${detailCampaign.id}`);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const sendReminder = async () => {
    setSendingReminder(true);
    try {
      const msg = `Reminder: please fulfill your pledge to ${detailCampaign?.title}. Thank you for your generosity!`;
      const resp = await authFetch('/api/sms/broadcast', {
        method: 'POST',
        body: JSON.stringify({ recipientGroup: 'all_donors', message: msg }),
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) notifyError('Failed to send reminders', d.error || null);
    } catch (e) { notifyError('Failed to send reminders', e); }
    finally { setSendingReminder(false); setReminderConfirm(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  // ── Pledge / campaign detail view ──
  if (detailCampaign) {
    const c = detailCampaign;
    const isPledge = c.campaignType === 'pledge';
    const pct = c.goal > 0 ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : 0;
    const totalPledged = pledges.reduce((s, p) => s + (p.pledgeAmount || 0), 0);
    const totalPaid = pledges.reduce((s, p) => s + (p.paidAmount || 0), 0);
    const fulfillment = totalPledged > 0 ? Math.min(100, Math.round((totalPaid / totalPledged) * 100)) : 0;

    return (
      <div className="max-w-3xl mx-auto">
        <button onClick={() => setDetailCampaign(null)} className="flex items-center gap-1.5 text-sm text-gray-500 mb-4 hover:text-gray-800">
          <ArrowLeft size={15} /> Back to campaigns
        </button>

        {isPledge && (
          <div className="flex gap-2 mb-4">
            <button onClick={() => setTab('overview')} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === 'overview' ? 'text-white' : 'text-gray-600 bg-gray-100'}`} style={tab === 'overview' ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}>Overview</button>
            <button onClick={() => setTab('pledges')} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === 'pledges' ? 'text-white' : 'text-gray-600 bg-gray-100'}`} style={tab === 'pledges' ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}>Pledges</button>
          </div>
        )}

        {(!isPledge || tab === 'overview') ? (
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900 font-display">{c.title}</h2>
              <button onClick={() => openEdit(c)} className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50"><Edit2 size={15} className="text-gray-500" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{c.description}</p>
            <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1.5">
              <span className="font-semibold text-gray-800">{fmt(c.raised)} raised</span>
              <span>of {fmt(c.goal)}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--brand-color, #d4a017)' }} />
            </div>
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm font-medium text-gray-700">Active campaign</span>
              <button onClick={() => toggleActive(c)}>
                {c.isActive ? <ToggleRight size={28} style={{ color: 'var(--brand-color, #d4a017)' }} /> : <ToggleLeft size={28} className="text-gray-300" />}
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Totals */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center shadow-sm">
                <div className="text-xl font-bold text-gray-900">{fmt(totalPledged)}</div>
                <div className="text-xs text-gray-400 mt-0.5">Pledged</div>
              </div>
              <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center shadow-sm">
                <div className="text-xl font-bold text-green-600">{fmt(totalPaid)}</div>
                <div className="text-xs text-gray-400 mt-0.5">Paid</div>
              </div>
              <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center shadow-sm">
                <div className="text-xl font-bold" style={{ color: 'var(--brand-color, #d4a017)' }}>{fulfillment}%</div>
                <div className="text-xs text-gray-400 mt-0.5">Fulfilled</div>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button onClick={() => { setPledgeForm(emptyPledge); setShowPledgeForm(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                <Plus size={13} /> Add Pledge
              </button>
              <button onClick={copyPledgeLink} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy Pledge Link'}
              </button>
              <button onClick={() => setReminderConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
                <Send size={13} /> Send Reminder
              </button>
            </div>

            {showPledgeForm && (
              <div className="bg-gray-50 rounded-2xl p-4 mb-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <input value={pledgeForm.donorName} onChange={e => setPledgeForm({ ...pledgeForm, donorName: e.target.value })} placeholder="Donor name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                  <input value={pledgeForm.donorEmail} onChange={e => setPledgeForm({ ...pledgeForm, donorEmail: e.target.value })} placeholder="Email *" type="email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={pledgeForm.donorPhone} onChange={e => setPledgeForm({ ...pledgeForm, donorPhone: e.target.value })} placeholder="Phone (optional)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                  <input value={pledgeForm.pledgeAmount} onChange={e => setPledgeForm({ ...pledgeForm, pledgeAmount: e.target.value })} placeholder="Pledge amount ($) *" type="number" min={0} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                </div>
                <input value={pledgeForm.dueDate} onChange={e => setPledgeForm({ ...pledgeForm, dueDate: e.target.value })} type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                <textarea value={pledgeForm.notes} onChange={e => setPledgeForm({ ...pledgeForm, notes: e.target.value })} placeholder="Notes (optional)" rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => { setShowPledgeForm(false); setPledgeForm(emptyPledge); }} className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Cancel</button>
                  <button onClick={savePledge} disabled={savingPledge} className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>{savingPledge ? 'Saving…' : 'Add Pledge'}</button>
                </div>
              </div>
            )}

            {pledges.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Heart size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-display">No pledges yet</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
                {pledges.map(p => {
                  const status = derivePledgeStatus(p);
                  const isEditing = editPledge?.id === p.id;
                  return (
                    <div key={p.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900 truncate">{p.donorName}</p>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${status === 'fulfilled' ? 'bg-green-100 text-green-700' : status === 'lapsed' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>{status}</span>
                          </div>
                          <p className="text-xs text-gray-400 truncate">
                            {p.donorEmail} · {fmt(p.paidAmount)} / {fmt(p.pledgeAmount)}{p.dueDate ? ` · due ${new Date(p.dueDate).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                        <button onClick={() => setEditPledge({ id: p.id, paidAmount: String(p.paidAmount), status })} className="p-1.5 rounded-lg hover:bg-gray-50"><Edit2 size={14} className="text-gray-400" /></button>
                        <button onClick={() => deletePledge(p.id)} className="p-1.5 rounded-lg hover:bg-red-50"><X size={14} className="text-red-400" /></button>
                      </div>
                      {isEditing && (
                        <div className="flex items-center gap-2 mt-2">
                          <input type="number" min={0} value={editPledge.paidAmount} onChange={e => setEditPledge({ ...editPledge, paidAmount: e.target.value })} placeholder="Paid ($)" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold" />
                          <select value={editPledge.status} onChange={e => setEditPledge({ ...editPledge, status: e.target.value as Pledge['status'] })} className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-gold">
                            <option value="active">active</option>
                            <option value="fulfilled">fulfilled</option>
                            <option value="lapsed">lapsed</option>
                          </select>
                          <button onClick={saveEditPledge} className="px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Save</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Send-reminder confirm */}
        {reminderConfirm && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
              <p className="font-bold text-gray-900 mb-2 font-display">Send pledge reminders?</p>
              <p className="text-sm text-gray-500 mb-5">This sends an SMS reminder to all donors with a phone number on file.</p>
              <div className="flex gap-3">
                <button onClick={() => setReminderConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
                <button onClick={sendReminder} disabled={sendingReminder} className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>{sendingReminder ? 'Sending…' : 'Send'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="max-w-3xl mx-auto">
      {/* Payment Setup — Stripe Connect for receiving donations (moved from Settings) */}
      <div className="mb-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowPayment((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
        >
          <DollarSign size={18} className="text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 font-display">Payment Setup</p>
            <p className="text-xs text-gray-400">Connect Stripe to receive donations</p>
          </div>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${showPayment ? 'rotate-180' : ''}`} />
        </button>
        {showPayment && (
          <div className="px-4 py-4 border-t border-gray-100">
            <PaymentSection />
          </div>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Heart size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium font-display">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first fundraising campaign</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => {
            const pct = c.goal > 0 ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : 0;
            const isPledge = c.campaignType === 'pledge';
            return (
              <div key={c.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <button onClick={() => openDetail(c)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-gray-900 truncate">{c.title}</h3>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isPledge ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {isPledge ? 'Pledge' : 'Fundraising'}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-1">{c.description}</p>
                  </button>
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
              <h3 className="text-base font-bold text-gray-900 font-display">{editing ? 'Edit Campaign' : 'New Campaign'}</h3>
            </div>
            <div className="p-5 space-y-4 pb-32">
              {canPledge && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">Campaign Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setForm({ ...form, campaignType: 'fundraising' })}
                      className={`text-left p-3 rounded-xl border transition-colors ${form.campaignType !== 'pledge' ? 'border-transparent ring-2' : 'border-gray-200'}`}
                      style={form.campaignType !== 'pledge' ? ({ '--tw-ring-color': 'var(--brand-color, #d4a017)' } as React.CSSProperties) : undefined}>
                      <p className="font-semibold text-sm text-gray-900">Fundraising</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">Accept one-time and recurring donations toward a goal</p>
                    </button>
                    <button onClick={() => setForm({ ...form, campaignType: 'pledge' })}
                      className={`text-left p-3 rounded-xl border transition-colors ${form.campaignType === 'pledge' ? 'border-transparent ring-2' : 'border-gray-200'}`}
                      style={form.campaignType === 'pledge' ? ({ '--tw-ring-color': 'var(--brand-color, #d4a017)' } as React.CSSProperties) : undefined}>
                      <p className="font-semibold text-sm text-gray-900">Pledge Campaign</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">Donors commit to give a set amount, tracked over time</p>
                    </button>
                  </div>
                </div>
              )}
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
              {form.campaignType === 'pledge' && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">Pledge Deadline</label>
                  <input type="date" value={form.pledgeDeadline || ''} onChange={(e) => setForm({ ...form, pledgeDeadline: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold" />
                  <p className="text-[11px] text-gray-400 mt-1">Date by which pledges should be fulfilled</p>
                </div>
              )}
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
            <p className="font-bold text-gray-900 mb-2 font-display">Delete campaign?</p>
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
