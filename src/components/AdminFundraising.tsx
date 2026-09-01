"use client";
import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Heart, DollarSign, ChevronDown,
  Copy, Check, Send, X, ArrowLeft, AlertTriangle,
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  query, where, onSnapshot, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ImageUpload } from './ImageUpload';
import { notifyError } from '../utils/notify';
import { authFetch } from '../utils/auth-fetch';
import PaymentSection from './settings/PaymentSection';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { AdminPageHeader, AdminPrimaryButton, AdminBadge } from './admin/AdminUI';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID, hasPlatformOverride } from '../utils/tenant-scope';
import { getPlanFeatures } from '../utils/plan-features';
import { useCampaigns, type Campaign } from '../hooks/queries/useCampaignQueries';
import { FORM_CONTAINER, FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY } from './layout/form-layout';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
import { GIVING_PROVIDERS, GIVING_PROVIDER_NAMES_OR, readGivingLinks } from './donations/giving-providers';
import { useTenant } from '@/contexts/TenantContext';

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

  /**
   * 🔴 THE-251 — does this church publish payment links Harvest is not in?
   *
   * Identical derivation, identical reasoning and identical source to
   * `hasManualGivingLinks` in AdminCRM (THE-249): `config.givingLinks` off the
   * tenant document `TenantContext` has already loaded, validated through the
   * same `readGivingLinks` the member Give page reads through. No new query.
   *
   * ⚠️ A CONDITION, NOT A CONSTANT, for the reason the CRM's copy of this gives:
   * a church with no links has no link gap, and a warning shown to every church
   * on every campaign edit is the banner that teaches the churches which DO have
   * the gap to skip it. The REMEDY below is unconditional — an envelope of cash
   * is worth recording whether or not a church publishes a PayPal link — but the
   * sentence about payment links is shown only to the churches that have them.
   */
  const { branding } = useTenant();
  const hasManualGivingLinks = useMemo(() => readGivingLinks(branding).length > 0, [branding]);

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

  // THE-251 — recording a gift that came through the church's own payment links.
  // `amount` is the SIZE OF ONE GIFT, never a total; see `recordOfflineGift`.
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ amount: '', provider: '', note: '' });
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

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
        // 🔴 `raised` IS NOT THE EDITOR'S TO WRITE — THE-251.
        //
        // `openEdit` loads the whole campaign into `form`, `raised` included,
        // and this update spread it straight back. So every save wrote a
        // SNAPSHOT of the total taken when the modal opened: an admin who opened
        // the editor, fixed a typo in the title and saved five minutes later
        // silently reset `raised` to its five-minutes-ago value, destroying any
        // Stripe gift that landed in between — a webhook credit that had been
        // idempotently, atomically written was undone by a title edit.
        //
        // It never showed up as a bug because the two values usually agree. They
        // stop agreeing the moment money moves, which is the only moment that
        // matters, and adding the manual adjustment makes it worse: an
        // adjustment recorded while the editor sat open would be erased on save.
        //
        // So the total is stripped from the payload here and the increment
        // paths — the Stripe webhook and /api/campaigns/adjust-raised — are its
        // only writers. The editor still owns every other field.
        const { raised: _ignoredRaised, ...editable } = payload;
        await updateDoc(doc(db, 'campaigns', editing.id), { ...editable, updatedAt: serverTimestamp() });
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

  /**
   * THE-251 — add an offline gift to this campaign's raised amount.
   *
   * 🔴 IT ADDS. The field below is "how much came in", not "what the total
   * should now be", and the route it posts to only ever increments. That is
   * deliberate and it is the whole design: `raised` is incremented per payment
   * by the Stripe webhook, so a control that SET the total would double-count
   * the moment the next Stripe gift landed on top of a figure an admin had
   * already typed Stripe's share into. Same contract as the CRM's
   * Add Activity → Donation, which adds to `totalDonated` rather than replacing it.
   *
   * A correction is a negative amount: an admin who recorded $500 and meant $50
   * enters -450. Both entries survive in the campaign's adjustment trail, so the
   * total stays explainable rather than quietly patched.
   *
   * Server-side, not a client write: the increment and its audit row have to
   * land atomically, the free-tier refusal belongs on the server, and
   * `campaigns/{id}/adjustments` has no rule of its own (firestore.rules is not
   * this ticket's to touch).
   */
  const recordOfflineGift = async () => {
    if (!detailCampaign || !tenantId) return;
    const amount = Number(adjustForm.amount.trim());
    if (!adjustForm.amount.trim() || !Number.isFinite(amount) || amount === 0) {
      setAdjustError('Enter the amount of the gift. Use a negative amount to correct a mistake.');
      return;
    }
    setAdjustError(null);
    setSavingAdjust(true);
    try {
      const res = await authFetch('/api/campaigns/adjust-raised', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: detailCampaign.id,
          tenantId,
          amountDollars: amount,
          provider: adjustForm.provider || null,
          note: adjustForm.note.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdjustError(data.error || 'Could not record that gift. Please try again.');
        return;
      }
      // The server is the authority on the new total — it applied the increment
      // and enforced the zero floor, so this reflects what actually landed
      // rather than re-doing the arithmetic locally and hoping they agree.
      const raised = typeof data.raised === 'number' ? data.raised : detailCampaign.raised;
      setDetailCampaign({ ...detailCampaign, raised });
      await queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] });
      setAdjustForm({ amount: '', provider: '', note: '' });
      setShowAdjust(false);
    } catch (e) {
      notifyError('Failed to record the gift', e);
      setAdjustError('Could not record that gift. Please try again.');
    } finally {
      setSavingAdjust(false);
    }
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
      <div className={FORM_CONTAINER}>
        <button onClick={() => setDetailCampaign(null)} className="flex items-center gap-1.5 text-sm text-muted mb-4 hover:text-body">
          <ArrowLeft size={15} /> Back to campaigns
        </button>

        {isPledge && (
          <div className="flex gap-2 mb-4">
            <button onClick={() => setTab('overview')} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === 'overview' ? 'text-white' : 'text-muted bg-surface-sunken'}`} style={tab === 'overview' ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}>Overview</button>
            <button onClick={() => setTab('pledges')} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === 'pledges' ? 'text-white' : 'text-muted bg-surface-sunken'}`} style={tab === 'pledges' ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}>Pledges</button>
          </div>
        )}

        {(!isPledge || tab === 'overview') ? (
          <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-strong font-display">{c.title}</h2>
              <button onClick={() => openEdit(c)} className="p-2 rounded-xl border border-line hover:bg-surface-sunken"><Edit2 size={15} className="text-muted" /></button>
            </div>
            <p className="text-sm text-muted mb-4">{c.description}</p>
            <div className="flex items-baseline justify-between text-xs text-muted mb-1.5">
              <span className="font-semibold text-body">{fmt(c.raised)} raised</span>
              <span>of {fmt(c.goal)}</span>
            </div>
            <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--brand-color, #d4a017)' }} />
            </div>
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm font-medium text-body">Active campaign</span>
              <button onClick={() => toggleActive(c)}>
                {c.isActive ? <ToggleRight size={28} style={{ color: 'var(--brand-color, #d4a017)' }} /> : <ToggleLeft size={28} className="text-stone-300" />}
              </button>
            </div>

            {/*
              🔴 THE-251 — THE REMEDY, beside the total it corrects.

              This is the only way to move `raised` by hand. It sits here rather
              than in the editor because the editor also creates campaigns, and a
              campaign that does not exist yet has no total to add to; and
              because the number it changes is on screen directly above it.
            */}
            <div className="mt-4 pt-4 border-t border-line">
              {!showAdjust ? (
                <button
                  data-testid="campaign-record-offline-gift"
                  onClick={() => { setShowAdjust(true); setAdjustError(null); }}
                  className={`w-full sm:w-auto ${ACTION_BUTTON} inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-brand border border-line bg-surface-raised text-[13px] font-semibold text-strong hover:bg-surface-sunken transition-colors`}
                >
                  <DollarSign size={15} className="text-muted" /> Record an offline gift
                </button>
              ) : (
                <div data-testid="campaign-adjust-form" className="space-y-3">
                  <div>
                    <label htmlFor="offline-gift-amount" className="text-xs font-semibold text-strong mb-1.5 block">
                      Amount received ($)
                    </label>
                    <input
                      id="offline-gift-amount"
                      type="number"
                      step="0.01"
                      value={adjustForm.amount}
                      onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
                      placeholder="250"
                      className={`w-full ${FIELD_WIDTH.short} border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent`}
                    />
                    {/*
                      🔴 SAYS "ADDS", NOT "SETS", where the number is typed. The
                      one misreading that would corrupt a total is an admin
                      entering the campaign's whole figure, so the field says
                      what it does at the point of entry rather than in a
                      paragraph above it.
                    */}
                    <p className="text-xs text-muted mt-1.5 leading-relaxed">
                      This <b className="text-strong">adds to</b> the {fmt(c.raised)} already raised &mdash; enter
                      the size of the gift, not the new total. To correct a gift you entered by
                      mistake, enter a negative amount.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="offline-gift-provider" className="text-xs font-semibold text-strong mb-1.5 block">
                      Where it came from <span className="font-normal text-faint">(optional)</span>
                    </label>
                    <select
                      id="offline-gift-provider"
                      value={adjustForm.provider}
                      onChange={(e) => setAdjustForm({ ...adjustForm, provider: e.target.value })}
                      className={`w-full ${FIELD_WIDTH.medium} border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong bg-surface-raised focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent ${CONTROL_DENSITY.control}`}
                    >
                      <option value="">Not specified</option>
                      {/* The THE-246 table, walked — the fifth provider appears
                          here with no edit to this file. */}
                      {GIVING_PROVIDERS.map((prov) => (
                        <option key={prov.id} value={prov.id}>{prov.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="offline-gift-note" className="text-xs font-semibold text-strong mb-1.5 block">
                      Note <span className="font-normal text-faint">(optional)</span>
                    </label>
                    <input
                      id="offline-gift-note"
                      value={adjustForm.note}
                      onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })}
                      placeholder="Sunday envelope, Cash App from the Bakers"
                      className={`w-full ${FIELD_WIDTH.long} border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent`}
                    />
                  </div>
                  {adjustError && (
                    <p data-testid="campaign-adjust-error" className="text-sm text-red-600">{adjustError}</p>
                  )}
                  <p className="text-xs text-faint leading-relaxed">
                    Recorded with your name and the date so your campaign total can be reconciled.
                    It does not create a receipt and will not appear on a giving statement.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={recordOfflineGift}
                      disabled={savingAdjust}
                      className={`${ACTION_BUTTON} flex-1 sm:flex-none px-4 py-2.5 rounded-brand text-[13px] font-semibold text-white disabled:opacity-50 transition-opacity`}
                      style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
                    >
                      {savingAdjust ? 'Recording…' : 'Record gift'}
                    </button>
                    <button
                      onClick={() => { setShowAdjust(false); setAdjustError(null); setAdjustForm({ amount: '', provider: '', note: '' }); }}
                      disabled={savingAdjust}
                      className={`${ACTION_BUTTON} flex-1 sm:flex-none px-4 py-2.5 rounded-brand border border-line text-[13px] font-semibold text-strong hover:bg-surface-sunken transition-colors`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            {/* Totals */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-surface-raised rounded-2xl p-4 border border-line text-center shadow-xs">
                <div className="text-xl font-bold text-strong">{fmt(totalPledged)}</div>
                <div className="text-xs text-faint mt-0.5">Pledged</div>
              </div>
              <div className="bg-surface-raised rounded-2xl p-4 border border-line text-center shadow-xs">
                <div className="text-xl font-bold text-field-600">{fmt(totalPaid)}</div>
                <div className="text-xs text-faint mt-0.5">Paid</div>
              </div>
              <div className="bg-surface-raised rounded-2xl p-4 border border-line text-center shadow-xs">
                <div className="text-xl font-bold" style={{ color: 'var(--brand-color, #d4a017)' }}>{fulfillment}%</div>
                <div className="text-xs text-faint mt-0.5">Fulfilled</div>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button onClick={() => { setPledgeForm(emptyPledge); setShowPledgeForm(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                <Plus size={13} /> Add Pledge
              </button>
              <button onClick={copyPledgeLink} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken">
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy Pledge Link'}
              </button>
              {/* THE-245 — "Send Reminder" POSTs to /api/sms/broadcast, so it is an
                  SMS surface living outside AdminSms and it goes with the rest.
                  The route refuses with 503 while the switch is off, so leaving
                  the button would offer a church an action that can only fail.
                  Everything else on a pledge campaign — the pledge list, Add
                  Pledge, Copy Pledge Link — is untouched. */}
              {SMS_FEATURE_ENABLED && (
                <button onClick={() => setReminderConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken">
                  <Send size={13} /> Send Reminder
                </button>
              )}
            </div>

            {showPledgeForm && (
              <div className="bg-surface-sunken rounded-2xl p-4 mb-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <input value={pledgeForm.donorName} onChange={e => setPledgeForm({ ...pledgeForm, donorName: e.target.value })} placeholder="Donor name *" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
                  <input value={pledgeForm.donorEmail} onChange={e => setPledgeForm({ ...pledgeForm, donorEmail: e.target.value })} placeholder="Email *" type="email" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={pledgeForm.donorPhone} onChange={e => setPledgeForm({ ...pledgeForm, donorPhone: e.target.value })} placeholder="Phone (optional)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
                  <input value={pledgeForm.pledgeAmount} onChange={e => setPledgeForm({ ...pledgeForm, pledgeAmount: e.target.value })} placeholder="Pledge amount ($) *" type="number" min={0} className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} />
                </div>
                <input value={pledgeForm.dueDate} onChange={e => setPledgeForm({ ...pledgeForm, dueDate: e.target.value })} type="date" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
                <textarea value={pledgeForm.notes} onChange={e => setPledgeForm({ ...pledgeForm, notes: e.target.value })} placeholder="Notes (optional)" rows={2} className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold resize-none ${FIELD_WIDTH.long}`} />
                <div className="flex gap-2">
                  <button onClick={() => { setShowPledgeForm(false); setPledgeForm(emptyPledge); }} className={`flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Cancel</button>
                  <button onClick={savePledge} disabled={savingPledge} className={`flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`} style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>{savingPledge ? 'Saving…' : 'Add Pledge'}</button>
                </div>
              </div>
            )}

            {pledges.length === 0 ? (
              <div className="text-center py-12 text-faint">
                <Heart size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-display">No pledges yet</p>
              </div>
            ) : (
              <div className="bg-surface-raised rounded-2xl border border-line divide-y divide-stone-200">
                {pledges.map(p => {
                  const status = derivePledgeStatus(p);
                  const isEditing = editPledge?.id === p.id;
                  return (
                    <div key={p.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-strong truncate">{p.donorName}</p>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${status === 'fulfilled' ? 'bg-field-100 text-field-700' : status === 'lapsed' ? 'bg-red-100 text-red-600' : 'bg-sky-100 text-sky-700'}`}>{status}</span>
                          </div>
                          <p className="text-xs text-faint truncate">
                            {p.donorEmail} · {fmt(p.paidAmount)} / {fmt(p.pledgeAmount)}{p.dueDate ? ` · due ${new Date(p.dueDate).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                        <button onClick={() => setEditPledge({ id: p.id, paidAmount: String(p.paidAmount), status })} className="p-1.5 rounded-lg hover:bg-surface-sunken"><Edit2 size={14} className="text-faint" /></button>
                        <button onClick={() => deletePledge(p.id)} className="p-1.5 rounded-lg hover:bg-red-50"><X size={14} className="text-red-400" /></button>
                      </div>
                      {isEditing && (
                        <div className="flex items-center gap-2 mt-2">
                          <input type="number" min={0} value={editPledge.paidAmount} onChange={e => setEditPledge({ ...editPledge, paidAmount: e.target.value })} placeholder="Paid ($)" className="flex-1 min-w-0 border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold" />
                          <select value={editPledge.status} onChange={e => setEditPledge({ ...editPledge, status: e.target.value as Pledge['status'] })} className="border border-line rounded-lg px-2 py-2 text-sm bg-surface-raised focus:outline-hidden focus:border-gold">
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
        {SMS_FEATURE_ENABLED && reminderConfirm && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-surface-raised rounded-2xl p-6 w-full max-w-sm text-center">
              <p className="font-bold text-strong mb-2 font-display">Send pledge reminders?</p>
              <p className="text-sm text-muted mb-5">This sends an SMS reminder to all donors with a phone number on file.</p>
              <div className="flex gap-3">
                <button onClick={() => setReminderConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted">Cancel</button>
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
    <div className={`${FORM_CONTAINER} space-y-6`}>
      {/* Payment Setup — Stripe Connect for receiving donations (moved from Settings) */}
      <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
        <button
          onClick={() => setShowPayment((v) => !v)}
          className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors text-left"
        >
          <span className="w-11 h-11 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] flex items-center justify-center shrink-0">
            <DollarSign size={20} className="text-gold" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-strong">Payment setup</p>
            <p className="text-xs text-faint">Stripe Connect — 100% of donations go to your ministry</p>
          </div>
          <ChevronDown size={16} className={`text-faint transition-transform ${showPayment ? 'rotate-180' : ''}`} />
        </button>
        {showPayment && (
          <div className="px-5 py-4 border-t border-line">
            <PaymentSection />
          </div>
        )}
      </div>

      {/* Page header — desktop only. On mobile the shell header already shows the
          "Fundraising" title and the "New Campaign" action (see useEffect above), and
          the mockup's mobile list opens straight into the payment row + stat cards. */}
      <div className="hidden lg:block">
        <AdminPageHeader
          eyebrow="Campaigns"
          title={`${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}`}
          action={<AdminPrimaryButton onClick={openCreate} icon={<Plus size={16} />}>New campaign</AdminPrimaryButton>}
        />
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] text-center py-16 px-6">
          <Heart size={38} className="mx-auto mb-3 text-stone-300" />
          <p className="font-display text-lg text-strong">No campaigns yet</p>
          <p className="text-sm text-muted mt-1">Create your first fundraising campaign</p>
          <div className="mt-5"><AdminPrimaryButton onClick={openCreate} icon={<Plus size={16} />}>New campaign</AdminPrimaryButton></div>
        </div>
      ) : (
        <>
          {/* Mobile totals — mockup StatRow: a gold icon disc (+ optional field-green
              chip) on one row, then a serif value and a muted label. Display-only sums
              over the already-loaded campaigns; the mockup's "Donors" has no field in the
              campaign data, so Raised/Goal are shown. Desktop uses the page header above. */}
          {(() => {
            const totalRaised = campaigns.reduce((sum, x) => sum + (x.raised || 0), 0);
            const totalGoal = campaigns.reduce((sum, x) => sum + (x.goal || 0), 0);
            const overallPct = totalGoal > 0 ? Math.min(100, Math.round((totalRaised / totalGoal) * 100)) : null;
            const stats = [
              { label: 'Raised · all', value: fmt(totalRaised), icon: <DollarSign size={14} />, chip: overallPct != null ? `${overallPct}%` : null },
              { label: 'Goal · all', value: fmt(totalGoal), icon: <Heart size={14} />, chip: null },
            ];
            return (
              <div className="lg:hidden grid grid-cols-2 gap-2.5 mb-5">
                {stats.map((s) => (
                  <div key={s.label} className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="w-7 h-7 rounded-lg bg-[var(--surface-gold)] text-gold flex items-center justify-center">{s.icon}</span>
                      {s.chip && <span className="text-[11px] font-semibold text-field-600">{s.chip}</span>}
                    </div>
                    <div className="font-display text-[1.375rem] font-normal leading-none tracking-[-0.02em] text-strong">{s.value}</div>
                    <div className="text-[11px] text-muted mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        <div className="grid md:grid-cols-2 gap-5">
          {campaigns.map((c) => {
            const pct = c.goal > 0 ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : 0;
            const isPledge = c.campaignType === 'pledge';
            return (
              <React.Fragment key={c.id}>
                {/* Mobile card — mockup design: title + type/status pills, description,
                    raised/goal progress. Same handlers as the desktop card
                    (openDetail, toggleActive, openEdit, setDeleteId). */}
                <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => openDetail(c)} className="flex-1 min-w-0 text-left group">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <h3 className="font-display text-[17px] font-normal text-strong group-hover:text-gold transition-colors">{c.title}</h3>
                        <AdminBadge tone={isPledge ? 'sky' : 'gold'}>{isPledge ? 'Pledge' : 'Fundraising'}</AdminBadge>
                        <AdminBadge tone={c.isActive ? 'green' : 'stone'}>{c.isActive ? 'Active' : 'Inactive'}</AdminBadge>
                      </div>
                      <p className="text-xs text-muted line-clamp-1">{c.description}</p>
                    </button>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => toggleActive(c)} className="p-1.5 rounded-brand hover:bg-surface-sunken transition-colors" title={c.isActive ? 'Deactivate' : 'Activate'}>
                        {c.isActive ? <ToggleRight size={16} style={{ color: 'var(--brand-color, #d4a017)' }} /> : <ToggleLeft size={16} className="text-faint" />}
                      </button>
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded-brand hover:bg-surface-sunken transition-colors">
                        <Edit2 size={14} className="text-faint" />
                      </button>
                      <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-brand hover:bg-danger-tint transition-colors">
                        <Trash2 size={14} className="text-danger" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between mt-3 mb-1.5">
                    <span className="font-display text-[1.375rem] font-light text-field-700 leading-none">{fmt(c.raised)}</span>
                    <span className="text-[11px] text-faint">of {fmt(c.goal)}</span>
                  </div>
                  <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11px]">
                    <span className="text-gold font-semibold">{pct}%</span>
                    {c.endDate && <span className="text-faint">Ends {new Date(c.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                  </div>
                </div>

                {/* Desktop card — existing approved layout, unchanged (now lg-only). */}
              <div className="hidden lg:block bg-surface-raised rounded-brand-lg p-6 border border-line shadow-[var(--ds-sh-sm)]">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <button onClick={() => openDetail(c)} className="flex-1 min-w-0 text-left group">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-display text-xl font-normal text-strong truncate group-hover:text-gold transition-colors">{c.title}</h3>
                      <AdminBadge tone={isPledge ? 'sky' : 'gold'}>{isPledge ? 'Pledge' : 'Fundraising'}</AdminBadge>
                    </div>
                    <AdminBadge tone={c.isActive ? 'green' : 'stone'}>{c.isActive ? 'Active' : 'Inactive'}</AdminBadge>
                    <p className="text-sm text-muted line-clamp-1 mt-2.5">{c.description}</p>
                  </button>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => toggleActive(c)} className="p-2 rounded-brand hover:bg-surface-sunken transition-colors" title={c.isActive ? 'Deactivate' : 'Activate'}>
                      {c.isActive ? <ToggleRight size={18} style={{ color: 'var(--brand-color, #d4a017)' }} /> : <ToggleLeft size={18} className="text-faint" />}
                    </button>
                    <button onClick={() => openEdit(c)} className="p-2 rounded-brand hover:bg-surface-sunken transition-colors">
                      <Edit2 size={15} className="text-faint" />
                    </button>
                    <button onClick={() => setDeleteId(c.id)} className="p-2 rounded-brand hover:bg-danger-tint transition-colors">
                      <Trash2 size={15} className="text-danger" />
                    </button>
                  </div>
                </div>
                <div className="flex items-baseline justify-between mt-4 mb-2">
                  <span className="font-display text-[1.75rem] font-light text-strong leading-none">{fmt(c.raised)}</span>
                  <span className="text-xs text-faint">of {fmt(c.goal)}</span>
                </div>
                <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--brand-color, #d4a017)' }} />
                </div>
                <div className="flex justify-between mt-2 text-[11px]">
                  <span style={{ color: 'var(--brand-color, #d4a017)' }} className="font-semibold">{pct}%</span>
                  {c.endDate && <span className="text-faint">Ends {new Date(c.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                </div>
              </div>
              </React.Fragment>
            );
          })}
        </div>
        </>
      )}

      {/* Campaign form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-raised rounded-brand-lg w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[var(--ds-sh-lg)]">
            <div className="p-6 flex items-center justify-between">
              <h3 className="font-display text-2xl font-normal text-strong">{editing ? 'Edit campaign' : 'New campaign'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-surface-sunken transition-colors">
                <X size={18} className="text-faint" />
              </button>
            </div>
            <div className="px-6 pb-6 space-y-5">
              {canPledge && (
                <div>
                  <label className="text-xs font-semibold text-strong mb-2 block">Campaign type</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setForm({ ...form, campaignType: 'fundraising' })}
                      className={`text-left p-4 rounded-brand border transition-colors ${form.campaignType !== 'pledge' ? 'border-[color-mix(in_srgb,var(--brand-color)_55%,transparent)] bg-[color-mix(in_srgb,var(--brand-color)_8%,transparent)]' : 'border-line hover:border-line-strong'}`}>
                      <p className={`font-semibold text-sm ${form.campaignType !== 'pledge' ? 'text-gold' : 'text-strong'}`}>Fundraising</p>
                      <p className="text-[11px] text-muted mt-1 leading-relaxed">One-time &amp; recurring gifts toward a goal</p>
                    </button>
                    <button onClick={() => setForm({ ...form, campaignType: 'pledge' })}
                      className={`text-left p-4 rounded-brand border transition-colors ${form.campaignType === 'pledge' ? 'border-[color-mix(in_srgb,var(--brand-color)_55%,transparent)] bg-[color-mix(in_srgb,var(--brand-color)_8%,transparent)]' : 'border-line hover:border-line-strong'}`}>
                      <p className={`font-semibold text-sm ${form.campaignType === 'pledge' ? 'text-gold' : 'text-strong'}`}>Pledge campaign</p>
                      <p className="text-[11px] text-muted mt-1 leading-relaxed">Donors commit an amount, tracked over time</p>
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-strong mb-1.5 block">Title *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent"
                  placeholder="Campaign title" />
              </div>
              <div>
                <label className="text-xs font-semibold text-strong mb-1.5 block">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent resize-none"
                  rows={3} placeholder="What is this campaign for?" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-strong mb-1.5 block">Goal ($)</label>
                  <input type="number" min={0} value={form.goal} onChange={(e) => setForm({ ...form, goal: Number(e.target.value) })}
                    className="w-full border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-strong mb-1.5 block">End date</label>
                  <input type="date" value={form.endDate || ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent" />
                </div>
              </div>

              {/*
                🔴 THE-251 — WHAT THE GOAL WILL BE MEASURED AGAINST.

                Beside the goal, because this is the moment an admin forms an
                expectation about the number underneath it. The fourth statement
                of one fact the church now meets in four places — AdminDonations
                (before it pastes a link), AdminGivingStatements (before it sends
                a tax document), AdminCRM (under the giving totals) and here
                (where the campaign target is set). Same voice, same providers
                named in the same order, same shape: what is missing, why Harvest
                cannot see it, and the exact control that fixes it.

                There is no Raised input beside the Goal one and there deliberately
                never will be: `raised` is incremented per Stripe payment, so a
                field that SET it would double-count. The remedy this names adds.
              */}
              {hasManualGivingLinks && (
                <div
                  data-testid="campaign-manual-giving"
                  className="flex items-start gap-2.5 rounded-brand-lg border border-line bg-surface-sunken px-4 py-3 text-[13px] text-body"
                >
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
                  <div className="leading-relaxed">
                    <span className="font-semibold">
                      Gifts sent through your own payment links do not update the amount raised.
                    </span>{' '}
                    Harvest never sees a {GIVING_PROVIDER_NAMES_OR} gift, so this campaign
                    counts Stripe gifts alone and its total will read lower than what you actually
                    received. To add one, open the campaign and press Record an offline gift. That
                    adds to the total; it does not create a receipt and will not appear on a giving
                    statement.
                  </div>
                </div>
              )}
              {form.campaignType === 'pledge' && (
                <div>
                  <label className="text-xs font-semibold text-strong mb-1.5 block">Pledge deadline</label>
                  <input type="date" value={form.pledgeDeadline || ''} onChange={(e) => setForm({ ...form, pledgeDeadline: e.target.value })}
                    className="w-full border border-line rounded-brand px-3.5 py-2.5 text-sm text-strong focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent" />
                  <p className="text-[11px] text-faint mt-1">Date by which pledges should be fulfilled</p>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-strong mb-1.5 block">Cover image</label>
                <ImageUpload value={form.coverImage || ''} onChange={(url) => setForm({ ...form, coverImage: url })} label="Add cover image" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-strong">Set as active campaign</span>
                <button onClick={() => setForm({ ...form, isActive: !form.isActive })} className="transition-colors">
                  {form.isActive
                    ? <ToggleRight size={28} style={{ color: 'var(--brand-color, #d4a017)' }} />
                    : <ToggleLeft size={28} className="text-stone-300" />}
                </button>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-brand border border-line text-sm font-semibold text-muted hover:bg-surface-sunken">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || !form.title.trim()}
                  className="flex-1 py-3 rounded-brand text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-raised rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-strong mb-2 font-display">Delete campaign?</p>
            <p className="text-sm text-muted mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminFundraising;
