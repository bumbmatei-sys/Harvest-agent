"use client";
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  getDocs, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Link2, Code, FileText,
  Download, ExternalLink, GripVertical, Edit2,
} from 'lucide-react';
import { db, auth } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import {
  AdminPageHeader, AdminPrimaryButton, AdminSecondaryButton, AdminEditorHeader,
  AdminCard, AdminBadge,
} from './admin/AdminUI';

const GOLD = 'var(--brand-color, #B8962E)';

type FieldType = 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'dropdown' | 'radio' | 'checkbox' | 'date';

interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  order: number;
}

interface CustomForm {
  id: string;
  title: string;
  description: string;
  fields: FormField[];
  active: boolean;
  submissionCount: number;
  createdAt: Timestamp | null;
  createdBy: string;
}

interface Submission {
  id: string;
  answers: Record<string, any>;
  submittedAt: Timestamp | null;
  crmContactId?: string | null;
}

const FIELD_TYPES: { type: FieldType; label: string; hasOptions?: boolean }[] = [
  { type: 'short_text', label: 'Short Text' },
  { type: 'long_text', label: 'Long Text' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'number', label: 'Number' },
  { type: 'dropdown', label: 'Dropdown', hasOptions: true },
  { type: 'radio', label: 'Radio', hasOptions: true },
  { type: 'checkbox', label: 'Checkbox', hasOptions: true },
  { type: 'date', label: 'Date' },
];

const newId = () => `f_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

interface AdminFormsProps {
  initialFormId?: string;
  onItemConsumed?: () => void;
}

const AdminForms: React.FC<AdminFormsProps> = () => {
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null so creating/saving a form never silently no-ops. On a tenant
  // subdomain currentTenantId is set and takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  const [view, setView] = useState<'list' | 'builder' | 'submissions'>('list');
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);

  // Builder state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');

  // Submissions state
  const [selectedForm, setSelectedForm] = useState<CustomForm | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  // ── Load forms list ──────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthReady || !tenantId) { setLoading(false); return; }
    const q = query(collection(db, 'tenants', tenantId, 'forms'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, snap => {
      setForms(snap.docs.map(d => ({ id: d.id, ...d.data() }) as CustomForm));
      setLoading(false);
    }, err => { console.error('Failed to load forms:', err); setLoading(false); });
    return () => unsub();
  }, [tenantId, isAuthReady]);

  // ── Open builder (in-shell editor; back is rendered in-content) ───
  const openBuilder = useCallback((form?: CustomForm) => {
    if (form) {
      setEditingId(form.id);
      setTitle(form.title);
      setDescription(form.description || '');
      setFields([...(form.fields || [])].sort((a, b) => a.order - b.order));
    } else {
      setEditingId(null);
      setTitle('');
      setDescription('');
      setFields([]);
    }
    setPreview(false);
    setView('builder');
  }, []);

  // ── Builder field ops ────────────────────────────────────────────
  const addField = (type: FieldType) => {
    setFields(f => [...f, {
      id: newId(), type, label: '', placeholder: '', required: false,
      options: FIELD_TYPES.find(t => t.type === type)?.hasOptions ? ['Option 1'] : undefined,
      order: f.length,
    }]);
  };
  const updateField = (id: string, patch: Partial<FormField>) =>
    setFields(f => f.map(x => x.id === id ? { ...x, ...patch } : x));
  const deleteField = (id: string) =>
    setFields(f => f.filter(x => x.id !== id).map((x, i) => ({ ...x, order: i })));
  const moveField = (id: string, dir: -1 | 1) => {
    setFields(f => {
      const idx = f.findIndex(x => x.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= f.length) return f;
      const copy = [...f];
      [copy[idx], copy[swap]] = [copy[swap], copy[idx]];
      return copy.map((x, i) => ({ ...x, order: i }));
    });
  };

  const handleSave = async () => {
    if (!tenantId) { alert('Could not determine your workspace. Please refresh and try again.'); return; }
    if (!title.trim()) { alert('Please give your form a title.'); return; }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        fields: fields.map((f, i) => {
          const cleaned: Record<string, unknown> = {
            ...f,
            label: f.label.trim() || `Field ${i + 1}`,
            order: i,
          };
          // Firestore rejects undefined values — drop any key whose value is undefined
          // (e.g. `options` on non-choice field types, `placeholder` if ever unset).
          Object.keys(cleaned).forEach((k) => cleaned[k] === undefined && delete cleaned[k]);
          return cleaned;
        }),
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'tenants', tenantId, 'forms', editingId), payload);
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'forms'), {
          ...payload,
          active: true,
          submissionCount: 0,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || '',
        });
      }
      setView('list');
    } catch (e) {
      console.error('Failed to save form:', e);
      alert('Failed to save form. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (form: CustomForm) => {
    if (!tenantId) return;
    await updateDoc(doc(db, 'tenants', tenantId, 'forms', form.id), { active: !form.active });
  };

  const handleDelete = async (form: CustomForm) => {
    if (!tenantId) return;
    if (!confirm(`Delete "${form.title}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'tenants', tenantId, 'forms', form.id));
  };

  const formUrl = (formId: string) =>
    `https://${tenantId}.theharvest.app/form/${formId}`;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* clipboard unavailable */ }
  };

  // ── Submissions ──────────────────────────────────────────────────
  const openSubmissions = async (form: CustomForm) => {
    if (!tenantId) return;
    setSelectedForm(form);
    setView('submissions');
    try {
      const snap = await getDocs(query(
        collection(db, 'tenants', tenantId, 'forms', form.id, 'submissions'),
        orderBy('submittedAt', 'desc'), limit(1000),
      ));
      setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Submission));
    } catch (e) {
      console.error('Failed to load submissions:', e);
      setSubmissions([]);
    }
  };

  const exportCsv = () => {
    if (!selectedForm) return;
    const cols = selectedForm.fields.sort((a, b) => a.order - b.order);
    const header = ['Submitted At', ...cols.map(c => c.label)];
    const rows = submissions.map(s => [
      s.submittedAt?.toDate ? s.submittedAt.toDate().toISOString() : '',
      ...cols.map(c => {
        const v = s.answers?.[c.id];
        return Array.isArray(v) ? v.join('; ') : (v ?? '');
      }),
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedForm.title.replace(/[^a-z0-9]/gi, '_')}_submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtDate = (ts: Timestamp | null) =>
    ts?.toDate ? ts.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  // ════════════════════════════════════════════════════════════════
  if (view === 'builder') {
    return (
      <div className="max-w-3xl mx-auto" style={{ paddingBottom: 120 }}>
        <AdminEditorHeader
          onBack={() => setView('list')}
          backLabel="All forms"
          title={editingId ? (title || 'Edit form') : 'New form'}
          subtitle={`${fields.length} field${fields.length === 1 ? '' : 's'}`}
          actions={<>
            <AdminSecondaryButton onClick={() => setPreview(p => !p)}>
              {preview ? <><EyeOff size={16} /> Edit</> : <><Eye size={16} /> Preview</>}
            </AdminSecondaryButton>
            <AdminPrimaryButton onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save form'}
            </AdminPrimaryButton>
          </>}
        />

        {preview ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-6">
            <h2 className="text-2xl font-bold text-earth mb-1 font-display">{title || 'Untitled form'}</h2>
            {description && <p className="text-sm text-warm-brown mb-5">{description}</p>}
            <div className="space-y-4">
              {fields.map(f => (
                <div key={f.id}>
                  <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">{f.label || 'Untitled field'}{f.required && <span className="text-red-500 ml-0.5">*</span>}</label>
                  {f.type === 'long_text' ? <textarea disabled rows={3} placeholder={f.placeholder} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-stone-100" />
                    : f.type === 'dropdown' ? <select disabled className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-stone-100"><option>Select…</option>{(f.options || []).map(o => <option key={o}>{o}</option>)}</select>
                    : (f.type === 'radio' || f.type === 'checkbox') ? <div className="space-y-1.5">{(f.options || []).map(o => <label key={o} className="flex items-center gap-2 text-sm text-warm-brown"><input type={f.type === 'radio' ? 'radio' : 'checkbox'} disabled />{o}</label>)}</div>
                    : <input disabled type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-stone-100" />}
                </div>
              ))}
              {fields.length === 0 && <p className="text-sm text-[color:var(--text-faint)]">No fields yet.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Form title" className="w-full text-lg font-bold px-0 py-1 border-0 border-b border-stone-200 focus:outline-none focus:border-gold" />
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full text-sm px-0 py-1 border-0 focus:outline-none resize-none text-warm-brown" />
            </div>

            {fields.map((f, i) => (
              <div key={f.id} className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="flex items-start gap-2">
                  <GripVertical size={16} className="text-stone-300 mt-2.5 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={f.label} onChange={e => updateField(f.id, { label: e.target.value })} placeholder="Field label" className="flex-1 px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold" />
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-stone-100 text-warm-brown whitespace-nowrap">{FIELD_TYPES.find(t => t.type === f.type)?.label}</span>
                    </div>
                    {(f.type !== 'dropdown' && f.type !== 'radio' && f.type !== 'checkbox') && (
                      <input value={f.placeholder || ''} onChange={e => updateField(f.id, { placeholder: e.target.value })} placeholder="Placeholder (optional)" className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold" />
                    )}
                    {(f.type === 'dropdown' || f.type === 'radio' || f.type === 'checkbox') && (
                      <textarea
                        value={(f.options || []).join('\n')}
                        onChange={e => updateField(f.id, { options: e.target.value.split('\n').filter(Boolean) })}
                        placeholder="One option per line"
                        rows={3}
                        className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold"
                      />
                    )}
                    <label className="flex items-center gap-2 text-xs text-warm-brown">
                      <input type="checkbox" checked={!!f.required} onChange={e => updateField(f.id, { required: e.target.checked })} /> Required
                    </label>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => moveField(f.id, -1)} disabled={i === 0} className="p-1 text-[color:var(--text-faint)] hover:text-[color:var(--text-body)] disabled:opacity-30"><ChevronUp size={16} /></button>
                    <button onClick={() => moveField(f.id, 1)} disabled={i === fields.length - 1} className="p-1 text-[color:var(--text-faint)] hover:text-[color:var(--text-body)] disabled:opacity-30"><ChevronDown size={16} /></button>
                    <button onClick={() => deleteField(f.id)} className="p-1 text-[color:var(--text-faint)] hover:text-red-600"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-4">
              <p className="text-xs font-semibold text-warm-brown uppercase tracking-wide mb-2">Add Field</p>
              <div className="flex flex-wrap gap-2">
                {FIELD_TYPES.map(t => (
                  <button key={t.type} onClick={() => addField(t.type)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100">
                    <Plus size={12} /> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {editingId && (
              <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2">
                <p className="text-xs font-semibold text-warm-brown uppercase tracking-wide">Share</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => copy(formUrl(editingId), 'link')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100">
                    <Link2 size={14} /> {copied === 'link' ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button onClick={() => copy(`<iframe src="${formUrl(editingId)}" width="100%" height="700" frameborder="0"></iframe>`, 'embed')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-stone-200 text-[color:var(--text-body)] hover:bg-stone-100">
                    <Code size={14} /> {copied === 'embed' ? 'Copied!' : 'Embed Code'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (view === 'submissions' && selectedForm) {
    const cols = [...selectedForm.fields].sort((a, b) => a.order - b.order);
    return (
      <div className="max-w-4xl mx-auto" style={{ paddingBottom: 120 }}>
        <AdminEditorHeader
          onBack={() => setView('list')}
          backLabel="All forms"
          title={selectedForm.title}
          subtitle={`${submissions.length} submission${submissions.length === 1 ? '' : 's'}`}
          actions={
            <AdminSecondaryButton onClick={exportCsv} disabled={submissions.length === 0}>
              <Download size={14} /> Export CSV
            </AdminSecondaryButton>
          }
        />
        {submissions.length === 0 ? (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium font-display">No submissions yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-warm-brown uppercase whitespace-nowrap">Submitted</th>
                  {cols.map(c => <th key={c.id} className="px-3 py-2.5 text-left text-xs font-semibold text-warm-brown uppercase whitespace-nowrap">{c.label}</th>)}
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-warm-brown uppercase">CRM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {submissions.map(s => (
                  <tr key={s.id} className="hover:bg-stone-100">
                    <td className="px-3 py-2.5 text-xs text-warm-brown whitespace-nowrap">{fmtDate(s.submittedAt)}</td>
                    {cols.map(c => {
                      const v = s.answers?.[c.id];
                      return <td key={c.id} className="px-3 py-2.5 text-[color:var(--text-body)]">{Array.isArray(v) ? v.join(', ') : (v ?? '—')}</td>;
                    })}
                    <td className="px-3 py-2.5 text-right">
                      {s.crmContactId
                        ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">In CRM</span>
                        : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-3xl mx-auto space-y-6" style={{ paddingBottom: 120 }}>
      <AdminPageHeader
        eyebrow="Ministry"
        title={`${forms.length} form${forms.length === 1 ? '' : 's'}`}
        action={<AdminPrimaryButton onClick={() => openBuilder()} icon={<Plus size={16} />}>Create form</AdminPrimaryButton>}
      />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
        </div>
      ) : forms.length === 0 ? (
        <AdminCard className="text-center py-16 px-6">
          <FileText size={38} className="mx-auto mb-3 text-stone-300" />
          <p className="font-display text-lg text-earth">No forms yet</p>
          <p className="text-sm text-warm-brown mt-1">Create a form to collect visitor cards, applications, and connect cards.</p>
          <div className="mt-5">
            <AdminPrimaryButton onClick={() => openBuilder()} icon={<Plus size={16} />}>Create form</AdminPrimaryButton>
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-4">
          {forms.map(form => (
            <AdminCard key={form.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => openSubmissions(form)} className="flex-1 min-w-0 text-left group">
                  <div className="font-semibold text-earth truncate group-hover:text-gold transition-colors">{form.title}</div>
                  <div className="text-xs text-[color:var(--text-faint)] mt-1">
                    {form.submissionCount || 0} submission{(form.submissionCount || 0) === 1 ? '' : 's'}
                    {form.createdAt?.toDate && ` · ${form.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    {` · ${(form.fields?.length || 0)} field${(form.fields?.length || 0) === 1 ? '' : 's'}`}
                  </div>
                </button>
                <button onClick={() => toggleActive(form)} title={form.active ? 'Deactivate' : 'Activate'} className="shrink-0">
                  <AdminBadge tone={form.active ? 'green' : 'stone'}>{form.active ? 'Active' : 'Inactive'}</AdminBadge>
                </button>
              </div>
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-stone-200 flex-wrap">
                <button onClick={() => openBuilder(form)} className="flex items-center gap-1.5 text-xs font-semibold text-warm-brown hover:text-gold transition-colors">
                  <Edit2 size={13} /> Edit
                </button>
                <button onClick={() => copy(formUrl(form.id), `link_${form.id}`)} className="flex items-center gap-1.5 text-xs font-semibold text-warm-brown hover:text-gold transition-colors">
                  <Link2 size={13} /> {copied === `link_${form.id}` ? 'Copied!' : 'Copy link'}
                </button>
                <a href={formUrl(form.id)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-warm-brown hover:text-gold transition-colors">
                  <ExternalLink size={13} /> Open
                </a>
                <button onClick={() => handleDelete(form)} className="flex items-center gap-1.5 text-xs font-semibold text-[#C4553B] hover:opacity-80 transition-opacity ml-auto">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </AdminCard>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminForms;
