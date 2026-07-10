"use client";
import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Search, Edit2, Trash2, Users, Mail, Phone,
  MessageSquare, DollarSign, PhoneCall, Calendar, Clock, ChevronRight, MapPin,
  List, LayoutGrid, Heart, Award
} from 'lucide-react';
import {
  collection, addDoc, deleteDoc, setDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { toSafeDate, type DateLike } from '../utils/format-date';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { sortByTime, sortByString } from '../utils/query-helpers';
import { notifyError } from '../utils/notify';
import AnalyticsAndRoles, { Permission } from './AnalyticsAndRoles';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import {
  useContactsWithUsers, useContactActivities, useContactOnboardingAnswers,
  type Contact, type ContactActivity, type PipelineStage,
} from '../hooks/queries/useCRMQueries';
import { useTenant as useTenantDoc } from '../hooks/queries/useTenantQueries';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';

const TYPE_LABELS: Record<Contact['type'], string> = {
  donor: 'Donor',
  member: 'Member',
  both: 'Donor & Member',
};

// Warm brand tag styles used on the list/detail badges (gold / sky / field-green).
const TYPE_COLORS: Record<Contact['type'], string> = {
  donor: 'bg-[color-mix(in_srgb,var(--brand-color)_14%,white)] text-[color-mix(in_srgb,var(--brand-color)_80%,black)]',
  member: 'bg-sky-100 text-sky-700',
  both: 'bg-[color-mix(in_srgb,#6E8E52_16%,white)] text-[#40562F]',
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
  stage: 'new' as PipelineStage,
  notes: '', tags: [] as string[], totalDonated: 0,
  address: { street: '', city: '', state: '', zip: '', country: '' },
};

// Pipeline stage definitions: ordered left→right on the kanban board.
const STAGES: { id: PipelineStage; label: string; color: string; bg: string }[] = [
  { id: 'new',       label: 'New',       color: '#8B7355', bg: '#F3EEE7' },
  { id: 'connected', label: 'Connected', color: '#3B82F6', bg: '#EFF6FF' },
  { id: 'active',    label: 'Active',    color: '#8B5CF6', bg: '#F5F3FF' },
  { id: 'giving',    label: 'Giving',    color: '#B8962E', bg: '#FBF3E4' },
  { id: 'champion',  label: 'Champion',  color: '#10B981', bg: '#ECFDF5' },
];

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// Robust to EVERY date shape the CRM data actually contains — a Firestore
// Timestamp, an ISO string (donation webhook, #119), a JS Date, epoch millis, or
// null. Assuming `.toDate()` here is what threw "e.toDate is not a function" and
// white-screened the whole CRM; toSafeDate normalizes all of them and never throws.
const fmtDate = (ts: DateLike) => {
  const d = toSafeDate(ts);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

type ViewMode = 'list' | 'detail' | 'form';

interface KanbanBoardProps {
  contacts: Contact[];
  stages: typeof STAGES;
  onOpenContact: (c: Contact) => void;
  onStageChange: (contactId: string, newStage: PipelineStage) => void;
}

// Horizontal pipeline board: one column per stage, contacts sorted into the
// column matching their `stage` (defaulting to 'new'). The dotted footer on
// each card is a quick "stage mover" — tap a dot to send the contact to that
// stage without opening the detail view.
const KanbanBoard: React.FC<KanbanBoardProps> = ({ contacts, stages, onOpenContact, onStageChange }) => {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
      {stages.map(stage => {
        const stageContacts = contacts.filter(c => (c.stage || 'new') === stage.id);
        return (
          <div key={stage.id} className="flex-shrink-0 w-[220px]">
            {/* Column header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="text-xs font-bold text-[color:var(--text-body)]">{stage.label}</span>
              </div>
              <span className="text-[10px] font-semibold text-[color:var(--text-faint)] bg-stone-100 px-1.5 py-0.5 rounded-full">
                {stageContacts.length}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-2">
              {stageContacts.map(c => (
                <div
                  key={c.id}
                  onClick={() => onOpenContact(c)}
                  className="bg-white rounded-xl border border-[#EDEBE8] p-3 cursor-pointer hover:shadow-sm hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-all"
                >
                  {/* Avatar + name */}
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
                    >
                      {(c.firstName?.[0] || c.lastName?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-earth truncate">
                        {[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed'}
                      </p>
                      <p className="text-[10px] text-[color:var(--text-faint)] truncate">{c.email}</p>
                    </div>
                  </div>

                  {/* Type badge */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[c.type]}`}
                    >
                      {TYPE_LABELS[c.type]}
                    </span>
                    {c.totalDonated > 0 && (
                      <span className="text-[9px] font-bold text-gold">
                        {fmt(c.totalDonated)}
                      </span>
                    )}
                  </div>

                  {/* Stage mover — tap to move to that stage */}
                  <div className="flex gap-1 mt-2 pt-2 border-t border-[#F0EDE8]">
                    {stages.map(s => (
                      <button
                        key={s.id}
                        onClick={(e) => { e.stopPropagation(); onStageChange(c.id, s.id); }}
                        className="flex-1 h-1.5 rounded-full transition-colors"
                        style={{
                          backgroundColor: (c.stage || 'new') === s.id ? s.color : '#E8E2D9',
                        }}
                        title={s.label}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {stageContacts.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-[#EDEBE8] p-4 text-center">
                  <p className="text-[10px] text-[color:var(--text-faint)]">No contacts</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface AdminCRMProps {
  currentUserRole?: string;
  currentUserPermissions?: Permission | null;
  /** Deep-link: open this contact's detail on mount (e.g. from a chat attachment). */
  initialContactId?: string;
  /** Called once the deep-linked contact has been opened, to clear the URL param. */
  onItemConsumed?: () => void;
}

const AdminCRM: React.FC<AdminCRMProps> = ({ currentUserRole, currentUserPermissions, initialContactId, onItemConsumed }) => {
  const { setHeaderAction, setHeaderOverride } = useAdminHeader();
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { currentTenantId: tenantId, isAuthReady } = useAppStore();

  // React Query for contacts list
  const { data: contacts = [], isLoading: loading } = useContactsWithUsers(tenantId, isAuthReady);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Contact['type']>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyContact);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [actForm, setActForm] = useState({ type: 'note' as ContactActivity['type'], description: '', amount: '' });
  const [savingAct, setSavingAct] = useState(false);
  // Sub-view entitlements. Contacts = manageCRM, Analytics = analytics, Roles =
  // manageAdmins (full access / super admin see all three). The CRM drawer entry
  // shows when the admin has ANY of these, so default to one they can actually view.
  const canViewContacts = currentUserRole === 'super_admin' || !!currentUserPermissions?.fullAccess || !!currentUserPermissions?.manageCRM;
  const canViewAnalytics = currentUserRole === 'super_admin' || !!currentUserPermissions?.fullAccess || !!currentUserPermissions?.analytics;
  const canManageRoles = currentUserRole === 'super_admin' || !!currentUserPermissions?.fullAccess || !!currentUserPermissions?.manageAdmins;
  const [crmSubView, setCrmSubView] = useState<'contacts' | 'analytics' | 'roles'>(
    canViewContacts ? 'contacts' : canViewAnalytics ? 'analytics' : canManageRoles ? 'roles' : 'contacts'
  );
  const [listMode, setListMode] = useState<'list' | 'kanban'>('list');

  // Drive the shared header: in detail/form sub-views the back chevron steps
  // back within CRM; on the list view it shows the "Add Contact" action.
  useEffect(() => {
    if (view === 'form') {
      setHeaderOverride({
        title: isEditing ? 'Edit Contact' : 'Add Contact',
        onBack: () => setView(isEditing ? 'detail' : 'list'),
      });
    } else if (view === 'detail' && selected) {
      setHeaderOverride({
        title: `${selected.firstName} ${selected.lastName}`.trim() || 'Contact',
        onBack: () => { setSelected(null); setView('list'); },
      });
    } else {
      setHeaderOverride(null);
    }
    return () => setHeaderOverride(null);
  }, [view, selected, isEditing, setHeaderOverride]);

  // Publish the "Add Contact" action into the shared header — but only on the
  // Contacts sub-view (the Analytics sub-view renders AnalyticsAndRoles, which
  // manages its own header action). Re-asserts when the sub-view changes back.
  useEffect(() => {
    // Only the Contacts sub-view owns the shared header action. Analytics/Roles
    // render AnalyticsAndRoles, which publishes its own action (e.g. "Add Admin"),
    // so do NOT clear the slot here on those sub-views or we'd clobber theirs.
    if (crmSubView !== 'contacts') return;
    setHeaderAction(<HeaderActionButton label="Add Contact" onClick={() => { setIsEditing(false); setForm(emptyContact); setView('form'); }} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction, crmSubView]);

  // React Query for contact activities
  const { data: activities = [] } = useContactActivities(tenantId, selected?.id);

  // Tenant onboarding questions via React Query
  const { data: tenantData } = useTenantDoc(tenantId);
  const onboardingQuestions = tenantData?.config?.onboardingQuestions
    ? [...tenantData.config.onboardingQuestions].sort((a, b) => a.order - b.order)
    : [];

  // Onboarding answers — fetched via React Query when a contact is selected
  const { data: onboardingAnswers = null, isLoading: loadingAnswers } = useContactOnboardingAnswers(selected?.email);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scroller = el.closest('[class*="overflow-y-auto"], [class*="overflow-auto"]') as HTMLElement | null;
    if (scroller) scroller.scrollTo({ top: 0, left: 0 });
  }, [view, crmSubView, selected?.id]);

  // Reset scroll position to top whenever the user navigates between CRM views
  // (list → detail → form, Contacts ↔ Analytics, or selecting a new contact).
  // The scroll container lives in the parent FocusScreen wrapper, so we walk up
  // the DOM from the view's root element to find the nearest overflow-y-auto
  // ancestor and reset it. This is the systematic scroll-reset pattern.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scroller = el.closest('[class*="overflow-y-auto"], [class*="overflow-auto"]') as HTMLElement | null;
    if (scroller) scroller.scrollTo({ top: 0, left: 0 });
  }, [view, crmSubView, selected?.id]);

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
      phone: c.phone || '', type: c.type, stage: c.stage || 'new',
      notes: c.notes || '', tags: c.tags || [],
      totalDonated: c.totalDonated || 0,
      address: { ...{ street: '', city: '', state: '', zip: '', country: '' }, ...c.address },
    });
    setSelected(c);
    setView('form');
  };

  const openDetail = (c: Contact) => { setSelected(c); setView('detail'); };

  // Deep-link: open a specific contact when navigated to /admin/crm/:id
  // (e.g. tapping "View Contact" on a chat attachment card).
  useEffect(() => {
    if (!initialContactId) return;
    const c = contacts.find(x => x.id === initialContactId);
    if (c) { setSelected(c); setView('detail'); onItemConsumed?.(); }
  }, [initialContactId, contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!form.firstName.trim()) return;
    setSaving(true);
    try {
      const data = {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim(), phone: form.phone.trim(), type: form.type,
        stage: form.stage || 'new',
        notes: form.notes.trim(), tags: form.tags, totalDonated: form.totalDonated,
        address: form.address, updatedAt: serverTimestamp(),
      };
      if (isEditing && selected) {
        // Upsert (not updateDoc): a member surfaced from the `users` collection
        // has no `contacts` doc yet, so editing it should CREATE the contact.
        await setDoc(doc(db, 'contacts', selected.id), {
          ...data,
          tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID,
        }, { merge: true });
        setSelected({ ...selected, ...data, updatedAt: null });
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...data, tenantId: tenantId || PLATFORM_TENANT_ID,
          lastDonationAt: null, memberSince: null,
          createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
      setView(isEditing ? 'detail' : 'list');
    } catch (e) { notifyError('Failed to save contact', e); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, 'contacts', deleteId));
      await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
    } catch (e) { notifyError('Failed to delete contact', e); }
    setDeleteId(null);
    if (view === 'detail') setView('list');
  };

  const handleStageChange = async (contactId: string, newStage: PipelineStage) => {
    try {
      // Upsert with the row's identifying fields so dragging a member that came
      // from the `users` collection (no contacts doc yet) creates it correctly.
      const existing = contacts.find(c => c.id === contactId);
      await setDoc(doc(db, 'contacts', contactId), {
        firstName: existing?.firstName ?? '',
        lastName: existing?.lastName ?? '',
        email: existing?.email ?? '',
        phone: existing?.phone ?? '',
        type: existing?.type ?? 'member',
        tenantId: existing?.tenantId || tenantId || PLATFORM_TENANT_ID,
        stage: newStage,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      // Keep the open detail view in sync without waiting for the refetch.
      if (selected?.id === contactId) setSelected({ ...selected, stage: newStage });
      await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
    } catch (err) {
      notifyError('Failed to update stage', err);
    }
  };

  const addActivity = async () => {
    if (!actForm.description.trim() || !selected) return;
    setSavingAct(true);
    try {
      await addDoc(collection(db, 'contactActivities'), {
        // Store the contact's own concrete tenantId (never null) so the doc is
        // readable under the top-level contactActivities rule, which gates the
        // read on isTenantAdmin(resource.data.tenantId). A null/mismatched
        // tenantId is why an added activity wrote but never showed in the
        // timeline. Mirrors the donation branch below and the contact writes.
        contactId: selected.id, tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID, type: actForm.type,
        description: actForm.description.trim(),
        amount: actForm.type === 'donation' && actForm.amount ? Number(actForm.amount) : null,
        createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
      });
      if (actForm.type === 'donation' && actForm.amount) {
        const newTotal = (selected.totalDonated || 0) + Number(actForm.amount);
        await setDoc(doc(db, 'contacts', selected.id), {
          firstName: selected.firstName ?? '', lastName: selected.lastName ?? '',
          email: selected.email ?? '', phone: selected.phone ?? '', type: selected.type ?? 'member',
          tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID,
          totalDonated: newTotal, lastDonationAt: serverTimestamp(),
        }, { merge: true });
        setSelected({ ...selected, totalDonated: newTotal });
        await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
      }
      await queryClient.invalidateQueries({ queryKey: ['contactActivities', tenantId, selected.id] });
      setShowAddActivity(false);
      setActForm({ type: 'note', description: '', amount: '' });
    } catch (e) { notifyError('Failed to add activity', e); }
    finally { setSavingAct(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} /></div>;
  }

  // Pill segmented control for the Contacts / Analytics / Roles sub-views. Each
  // pill is shown only to admins entitled to that sub-view (Roles lives here
  // rather than as its own top-level tab).
  const subTabBar = (
    <div className="flex gap-1 bg-stone-100 rounded-xl p-1 mb-5 w-fit">
      {canViewContacts && (
        <button
          onClick={() => setCrmSubView('contacts')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            crmSubView === 'contacts' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
          }`}
        >
          Contacts
        </button>
      )}
      {canViewAnalytics && (
        <button
          onClick={() => { setCrmSubView('analytics'); setView('list'); setSelected(null); }}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            crmSubView === 'analytics' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
          }`}
        >
          Analytics
        </button>
      )}
      {canManageRoles && (
        <button
          onClick={() => { setCrmSubView('roles'); setView('list'); setSelected(null); }}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            crmSubView === 'roles' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'
          }`}
        >
          Roles
        </button>
      )}
    </div>
  );

  if (crmSubView === 'analytics') {
    return (
      <div ref={scrollRef} className="max-w-3xl mx-auto">
        {subTabBar}
        {canViewAnalytics && currentUserRole ? (
          <AnalyticsAndRoles
            currentUserRole={currentUserRole}
            currentUserPermissions={currentUserPermissions}
            mode="analytics"
          />
        ) : (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <p className="text-sm">Analytics unavailable.</p>
          </div>
        )}
      </div>
    );
  }

  if (crmSubView === 'roles') {
    return (
      <div ref={scrollRef} className="max-w-3xl mx-auto">
        {subTabBar}
        {canManageRoles && currentUserRole ? (
          <AnalyticsAndRoles
            currentUserRole={currentUserRole}
            currentUserPermissions={currentUserPermissions}
            mode="roles"
          />
        ) : (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <p className="text-sm">You don&apos;t have access to manage roles.</p>
          </div>
        )}
      </div>
    );
  }

  if (view === 'form') {
    return (
      <div ref={scrollRef} className="max-w-2xl mx-auto">
        {subTabBar}
        <div className="bg-white rounded-2xl border border-[#EDEBE8] shadow-sm p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">First Name *</label>
              <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" placeholder="First name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">Last Name</label>
              <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" placeholder="Last name" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-warm-brown mb-1 block">Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as Contact['type'] })}
              className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none bg-white">
              <option value="member">Member</option>
              <option value="donor">Donor</option>
              <option value="both">Donor & Member</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-warm-brown mb-2 block">Pipeline Stage</label>
            <div className="flex gap-1.5 flex-wrap">
              {STAGES.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, stage: s.id }))}
                  className="px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
                  style={{
                    backgroundColor: (form.stage || 'new') === s.id ? s.color : s.bg,
                    color: (form.stage || 'new') === s.id ? '#fff' : s.color,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" placeholder="email@example.com" />
            </div>
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" placeholder="+1 555 000 0000" />
            </div>
          </div>
          <p className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mt-2 mb-3">Address</p>
          <div>
            <label className="text-xs font-semibold text-warm-brown mb-1 block">Street Address</label>
            <input value={form.address.street || ''} onChange={e => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
              className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" placeholder="123 Main St" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">City</label>
              <input value={form.address.city || ''} onChange={e => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">State</label>
              <input value={form.address.state || ''} onChange={e => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-warm-brown mb-1 block">ZIP</label>
              <input value={form.address.zip || ''} onChange={e => setForm({ ...form, address: { ...form.address, zip: e.target.value } })}
                className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-warm-brown mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3} className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none resize-none"
              placeholder="Any notes about this contact..." />
          </div>
          <div className="space-y-2 pt-2">
            <button onClick={() => setView(isEditing ? 'detail' : 'list')} className="w-full py-3 rounded-xl border border-[#EDEBE8] text-sm font-semibold text-warm-brown">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.firstName.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div ref={scrollRef} className="max-w-2xl mx-auto">
        {subTabBar}

        {/* Hero */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black text-white flex-shrink-0"
              style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
              {selected.firstName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl font-black text-earth leading-tight truncate">{selected.firstName} {selected.lastName}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[selected.type]}`}>
                  {TYPE_LABELS[selected.type]}
                </span>
                {selected.memberSince && <span className="text-xs text-[color:var(--text-faint)]">· Member since {fmtDate(selected.memberSince)}</span>}
              </div>
              {/* Stage selector in detail view */}
              <div className="flex gap-1.5 flex-wrap mt-2">
                {STAGES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => handleStageChange(selected.id, s.id)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors"
                    style={{
                      backgroundColor: (selected.stage || 'new') === s.id ? s.color : s.bg,
                      color: (selected.stage || 'new') === s.id ? '#fff' : s.color,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => openEdit(selected)} className="p-2 rounded-xl border border-[#EDEBE8] hover:bg-stone-100">
              <Edit2 size={14} className="text-warm-brown" />
            </button>
            <button onClick={() => setDeleteId(selected.id)} className="p-2 rounded-xl border border-[#EDEBE8] hover:bg-red-50">
              <Trash2 size={14} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex gap-2 flex-wrap mb-5">
          <span className="bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] text-gold text-xs font-semibold px-3 py-1.5 rounded-full">{fmt(selected.totalDonated || 0)} total given</span>
          <span className="bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] text-gold text-xs font-semibold px-3 py-1.5 rounded-full">
            {selected.lastDonationAt ? `Last gift ${fmtDate(selected.lastDonationAt)}` : 'No donations yet'}
          </span>
          <span className="bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] text-gold text-xs font-semibold px-3 py-1.5 rounded-full">{activities.length} {activities.length === 1 ? 'activity' : 'activities'}</span>
        </div>

        {/* Contact info card */}
        <div className="bg-white rounded-2xl border border-[#EDEBE8] shadow-sm p-4 mb-4">
          <div className="grid grid-cols-2 gap-3">
            {selected.email && (
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-[color:var(--text-faint)] flex-shrink-0" />
                <span className="text-sm text-[color:var(--text-body)] truncate">{selected.email}</span>
              </div>
            )}
            {selected.phone && (
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-[color:var(--text-faint)] flex-shrink-0" />
                <span className="text-sm text-[color:var(--text-body)] truncate">{selected.phone}</span>
              </div>
            )}
            {selected.address?.street && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[color:var(--text-faint)] flex-shrink-0" />
                <span className="text-sm text-[color:var(--text-body)] truncate">{selected.address.street}</span>
              </div>
            )}
            {selected.address?.city && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[color:var(--text-faint)] flex-shrink-0" />
                <span className="text-sm text-[color:var(--text-body)] truncate">
                  {[selected.address.city, selected.address.state].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
          {selected.tags && selected.tags.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#EDEBE8] flex flex-wrap gap-1.5">
              {selected.tags.map(tag => (
                <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-warm-brown">{tag}</span>
              ))}
            </div>
          )}
          <div className="border-t border-[#EDEBE8] pt-3 mt-3">
            <label className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-1 block">Admin Notes</label>
            <textarea
              defaultValue={selected.notes || ''}
              onBlur={async (e) => {
                const val = e.target.value.trim();
                if (val !== (selected.notes || '')) {
                  try {
                    await setDoc(doc(db, 'contacts', selected.id), {
                      firstName: selected.firstName ?? '', lastName: selected.lastName ?? '',
                      email: selected.email ?? '', phone: selected.phone ?? '', type: selected.type ?? 'member',
                      tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID,
                      notes: val,
                    }, { merge: true });
                    setSelected({ ...selected, notes: val });
                  } catch (err) { console.error('Failed to save notes:', err); }
                }
              }}
              rows={3}
              className="border-0 focus:outline-none text-sm text-[color:var(--text-body)] resize-none w-full bg-transparent leading-relaxed"
              placeholder="Add notes about this contact..."
            />
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider">Activity Timeline</h3>
          <button
            onClick={() => setShowAddActivity(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <Plus size={12} /> Add Activity
          </button>
        </div>

        {activities.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#EDEBE8] shadow-sm p-8 text-center text-[color:var(--text-faint)]">
            <Clock size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm font-display">No activities recorded yet — add the first one</p>
          </div>
        ) : (
          <div className="relative pl-6 ml-1 border-l-2 border-[#EDEBE8] space-y-5">
            {activities.map(act => (
              <div key={act.id} className="relative">
                <div className="absolute -left-[25px] top-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center"
                  style={{ backgroundColor: act.type === 'donation' ? 'var(--brand-color, #B8962E)' : '#E8E2D9' }}>
                  <span className="text-white flex items-center justify-center" style={{ fontSize: 8 }}>
                    {ACTIVITY_ICONS[act.type]}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-warm-brown capitalize">{act.type}</span>
                    {act.amount && (
                      <span className="text-xs font-bold" style={{ color: 'var(--brand-color, #B8962E)' }}>{fmt(act.amount)}</span>
                    )}
                    <span className="text-[10px] text-[color:var(--text-faint)] ml-auto">{fmtDate(act.createdAt)}</span>
                  </div>
                  <p className="text-sm text-[color:var(--text-body)]">{act.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Onboarding Responses */}
        <div className="mt-6">
          <h3 className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-3">Onboarding Responses</h3>
          {loadingAnswers ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
            </div>
          ) : !onboardingAnswers || Object.keys(onboardingAnswers).length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#EDEBE8] shadow-sm p-6 text-center text-[color:var(--text-faint)] text-sm font-display">
              No onboarding responses yet.
            </div>
          ) : (
            <div className="space-y-3">
              {(onboardingQuestions.length > 0
                ? onboardingQuestions.filter(q => onboardingAnswers[q.id])
                : Object.keys(onboardingAnswers).map(id => ({ id, label: id.replace(/_/g, ' '), order: 0 }))
              ).map(q => (
                <div key={q.id} className="bg-[#F7F6F3] rounded-xl p-4">
                  <p className="text-[10px] font-bold text-[color:var(--text-faint)] uppercase tracking-wider">{q.label}</p>
                  <p className="text-sm text-[color:var(--text-body)] mt-0.5">{onboardingAnswers[q.id]}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {showAddActivity && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-3xl w-full max-w-md">
              <div className="p-5 border-b border-[#EDEBE8]"><h3 className="font-bold text-earth font-display">Add Activity</h3></div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-warm-brown mb-2 block">Type</label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(['note', 'donation', 'email', 'call', 'meeting'] as ContactActivity['type'][]).map(t => (
                      <button
                        key={t}
                        onClick={() => setActForm({ ...actForm, type: t })}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize whitespace-nowrap transition-colors ${actForm.type === t ? 'text-white' : 'bg-stone-100 text-warm-brown'}`}
                        style={actForm.type === t ? { backgroundColor: 'var(--brand-color, #B8962E)' } : undefined}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {actForm.type === 'donation' && (
                  <div>
                    <label className="text-xs font-semibold text-warm-brown mb-1 block">Amount ($)</label>
                    <input type="number" min={0} value={actForm.amount} onChange={e => setActForm({ ...actForm, amount: e.target.value })}
                      className="w-full rounded-xl border border-[#EDEBE8] px-3 py-2.5 text-sm focus:border-gold focus:outline-none" placeholder="0.00" />
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-warm-brown mb-1 block">Description *</label>
                  <div className="bg-[#F7F6F3] rounded-xl p-3">
                    <textarea value={actForm.description} onChange={e => setActForm({ ...actForm, description: e.target.value })}
                      rows={3} className="border-0 focus:outline-none text-sm text-[color:var(--text-body)] resize-none w-full bg-transparent"
                      placeholder="What happened?" />
                  </div>
                </div>
              </div>
              <div className="p-5 border-t border-[#EDEBE8] space-y-2">
                <button onClick={() => setShowAddActivity(false)} className="w-full py-2.5 rounded-xl border border-[#EDEBE8] text-sm font-semibold text-warm-brown">Cancel</button>
                <button onClick={addActivity} disabled={savingAct || !actForm.description.trim()}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                  {savingAct ? 'Saving...' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteId && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center">
              <p className="font-bold text-earth mb-2 font-display">Delete contact?</p>
              <p className="text-sm text-warm-brown mb-5">This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-[#EDEBE8] text-sm font-semibold text-warm-brown">Cancel</button>
                <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalGiven = contacts.reduce((s, c) => s + (c.totalDonated || 0), 0);
  const memberCount = contacts.filter(c => c.type === 'member' || c.type === 'both').length;
  const donorCount = contacts.filter(c => c.type === 'donor' || c.type === 'both').length;
  const championCount = contacts.filter(c => (c.stage || 'new') === 'champion').length;

  const stats: { label: string; value: React.ReactNode; icon: React.ReactNode }[] = [
    { label: 'Members', value: memberCount, icon: <Users size={15} /> },
    { label: 'Donors', value: donorCount, icon: <Heart size={15} /> },
    { label: 'Total Given', value: fmt(totalGiven), icon: <DollarSign size={15} /> },
    { label: 'Champions', value: championCount, icon: <Award size={15} /> },
  ];

  return (
    <div ref={scrollRef} className="max-w-6xl mx-auto">
      {subTabBar}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5">
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">{s.label}</p>
              <span className="text-stone-300">{s.icon}</span>
            </div>
            <p className="font-display text-[2rem] font-light text-earth mt-2 leading-none">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + filters + view toggle + add */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full bg-white pl-11 pr-4 py-3 text-sm border border-stone-200 rounded-brand-lg text-earth placeholder:text-[color:var(--text-faint)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent" />
        </div>
        {/* Type filter segmented */}
        <div className="flex gap-0.5 bg-stone-100 rounded-lg p-1 shrink-0">
          {([['all', 'All'], ['member', 'Members'], ['donor', 'Donors']] as ['all' | Contact['type'], string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === val ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* List / Pipeline view toggle */}
        <div className="flex gap-0.5 bg-stone-100 rounded-lg p-1 shrink-0">
          <button onClick={() => setListMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${listMode === 'list' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'}`}>
            <List size={13} /> List
          </button>
          <button onClick={() => setListMode('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${listMode === 'kanban' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'}`}>
            <LayoutGrid size={13} /> Pipeline
          </button>
        </div>
        <button
          onClick={() => { setIsEditing(false); setForm(emptyContact); setView('form'); }}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}
        >
          <Plus size={16} /> Add contact
        </button>
      </div>

      {listMode === 'kanban' ? (
        <KanbanBoard
          contacts={filtered}
          stages={STAGES}
          onOpenContact={openDetail}
          onStageChange={handleStageChange}
        />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[color:var(--text-faint)]">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium font-display">{search || filter !== 'all' ? 'No contacts match' : 'No contacts yet'}</p>
          {!search && filter === 'all' && <p className="text-sm mt-1">Add your first donor or member</p>}
        </div>
      ) : (
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Contact</th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Type</th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Stage</th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Given</th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Last Gift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {filtered.map(c => {
                  const stage = STAGES.find(s => s.id === (c.stage || 'new')) || STAGES[0];
                  return (
                    <tr key={c.id} onClick={() => openDetail(c)} className="hover:bg-stone-100/60 transition-colors cursor-pointer">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}>
                            {c.firstName?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-earth truncate">{c.firstName} {c.lastName}</p>
                            {c.email && <p className="text-xs text-[color:var(--text-faint)] truncate">{c.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_COLORS[c.type]}`}>{TYPE_LABELS[c.type]}</span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-sm text-warm-brown">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                          {stage.label}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className={`text-sm font-semibold ${c.totalDonated > 0 ? 'text-earth' : 'text-stone-300'}`}>{c.totalDonated > 0 ? fmt(c.totalDonated) : '—'}</span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className="text-sm text-[color:var(--text-faint)]">{c.lastDonationAt ? fmtDate(c.lastDonationAt) : '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-earth mb-2 font-display">Delete contact?</p>
            <p className="text-sm text-warm-brown mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-[#EDEBE8] text-sm font-semibold text-warm-brown">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCRM;
