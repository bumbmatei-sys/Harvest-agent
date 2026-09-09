"use client";
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Link2, Code, FileText,
  Download, ExternalLink, GripVertical, Edit2, ChartColumn,
} from 'lucide-react';
import { db, auth } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import {
  AdminPageHeader, AdminPrimaryButton, AdminSecondaryButton, AdminEditorHeader,
  AdminCard, AdminBadge,
} from './admin/AdminUI';
import { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, CONTROL_DENSITY } from './layout/form-layout';
import { readAllSubmissions, summariseForm, type AnswerField } from './forms/form-answers';
import FormAnswersView from './forms/FormAnswersView';

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

/**
 * The three field types that carry an option list, derived from FIELD_TYPES so
 * there is ONE declaration of "has options" rather than the `f.type === 'dropdown'
 * || f.type === 'radio' || f.type === 'checkbox'` triple this file previously
 * spelled twice. A fourth choice type added to FIELD_TYPES with `hasOptions`
 * reaches the option editor automatically instead of silently rendering none.
 */
export const OPTION_TYPES: ReadonlyArray<FieldType> =
  FIELD_TYPES.filter((t) => t.hasOptions).map((t) => t.type);

export const fieldHasOptions = (type: FieldType): boolean => OPTION_TYPES.includes(type);

/**
 * 🔴 The cap on one field's option list, and it is STATED, never silent.
 *
 * A form document is a single Firestore document and Firestore's hard limit is
 * 1 MiB for the whole of it — every field, every label, every placeholder, and
 * every option of every field together. An unbounded option list therefore has
 * a real failure mode: the save stops working, at a size nobody was told about,
 * on a form that already exists. 100 options per field is far past any question
 * a church actually asks and leaves the document limit an order of magnitude
 * away even on a form with many choice fields.
 *
 * ⚠️ The number is only half of it. The editor renders "N of 100 options" at
 * all times — not on approach, not at the ceiling — so the limit is a fact the
 * admin can see before it binds, and the Add option control states why it is
 * disabled when it is. A cap that only announces itself by a control that stops
 * responding is the same class of defect as the one this ticket is fixing.
 */
export const MAX_FIELD_OPTIONS = 100;

/**
 * A default label for a newly added option that is not already in the list.
 *
 * Duplicate option TEXT is not cosmetic here: a submission stores the option's
 * text as its answer (see /api/forms/submit, which this ticket does not touch),
 * so two options reading "Option 3" are one answer key wearing two rows in the
 * per-question answers view. Adding, removing and adding again is the ordinary
 * way to produce that pair, so the default label skips any name already taken.
 */
export const nextOptionLabel = (existing: ReadonlyArray<string>): string => {
  for (let n = existing.length + 1; ; n++) {
    const candidate = `Option ${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
};

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

  const [view, setView] = useState<'list' | 'builder' | 'submissions' | 'answers'>('list');
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

  // Submissions state — shared by the responses TABLE and the per-question
  // ANSWERS summary, because both are readings of the same set and a figure on
  // one that disagrees with the other is a defect either way.
  const [selectedForm, setSelectedForm] = useState<CustomForm | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  /** The EXACT count, from getCountFromServer — correct even when truncated. */
  const [total, setTotal] = useState(0);
  /** True when the read hit its ceiling and `submissions` is short of `total`. */
  const [truncated, setTruncated] = useState(false);
  const [answersLoading, setAnswersLoading] = useState(false);

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
      options: fieldHasOptions(type) ? ['Option 1'] : undefined,
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

  // ── Builder OPTION ops ───────────────────────────────────────────
  /**
   * 🔴 The four operations this ticket exists for.
   *
   * What was here before was a single `<textarea>` holding
   * `(f.options || []).join('\n')`, whose onChange did
   * `e.target.value.split('\n').filter(Boolean)`. It reads as an editor that
   * can do all four, and it can do NONE of them by typing: the control is
   * CONTROLLED, and `filter(Boolean)` deletes the empty string that a freshly
   * typed newline produces. So pressing Enter set state back to the list it
   * already held, React restored the DOM value, and the newline vanished under
   * the cursor. There was no cap and no error — the keystroke was simply
   * reverted, which is exactly the founder's "I cannot add more option in any
   * of the fields". The same erasure blocked splitting a line in the middle,
   * so options could not be inserted between two others either.
   *
   * Each option is now its own row with its own controls, so an option is
   * added, renamed, reordered and removed by an act that cannot be undone by
   * the next render. `options` stays a `string[]` in the stored `fields` — the
   * shape is not touched, and a form saved before this change loads, edits and
   * saves identically.
   */
  const setOptions = (id: string, next: string[]) => updateField(id, { options: next });

  const addOption = (f: FormField) => {
    const cur = f.options || [];
    // The cap is enforced here as well as on the disabled control, so it holds
    // however the call is reached, and it is the SAME constant the editor
    // prints — there is no second number and no unstated one.
    if (cur.length >= MAX_FIELD_OPTIONS) return;
    setOptions(f.id, [...cur, nextOptionLabel(cur)]);
  };

  const renameOption = (f: FormField, index: number, text: string) =>
    setOptions(f.id, (f.options || []).map((o, i) => (i === index ? text : o)));

  const moveOption = (f: FormField, index: number, dir: -1 | 1) => {
    const cur = f.options || [];
    const swap = index + dir;
    if (index < 0 || swap < 0 || swap >= cur.length) return;
    const copy = [...cur];
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
    setOptions(f.id, copy);
  };

  const removeOption = (f: FormField, index: number) =>
    setOptions(f.id, (f.options || []).filter((_, i) => i !== index));

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
            // Options are trimmed and blanks dropped ON SAVE rather than on
            // every keystroke. Doing it on keystroke is what the old textarea
            // did, and it is what made a new option impossible to type: the
            // in-progress empty value IS a legitimate editing state and must
            // survive until the admin is done. `undefined` is preserved for a
            // field type that has no options, so the delete pass below still
            // strips the key rather than storing an empty array on a
            // short_text field.
            options: f.options ? f.options.map((o) => o.trim()).filter(Boolean) : undefined,
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
  /**
   * Load one form's responses COMPLETELY, for either surface.
   *
   * 🔴 This replaces a `getDocs(orderBy('submittedAt','desc'), limit(1000))`.
   * That read was not "the newest 1000" — Firestore caps AFTER ordering, so a
   * form past 1000 responses returned 1000 of them and the screen then printed
   * `submissions.length` as its response count and exported those rows as its
   * CSV. A truncation nobody can see is the defect; see readAllSubmissions for
   * why the replacement counts first and pages by `documentId()`, and why no
   * composite index is involved.
   *
   * ⚠️ The rows are still sorted newest-first HERE rather than by the query,
   * so the table and the CSV keep exactly the order they had. That sort is now
   * correct because the set is complete — sorting a truncated set is what made
   * the old bug invisible. `tsMillis` semantics inline: a null or pending
   * `submittedAt` sorts last rather than becoming NaN.
   */
  const openFor = async (form: CustomForm, next: 'submissions' | 'answers') => {
    if (!tenantId) return;
    setSelectedForm(form);
    setView(next);
    setAnswersLoading(true);
    try {
      const read = await readAllSubmissions(db, tenantId, form.id);
      const rows = (read.rows as unknown as Submission[]).slice().sort(
        (a, b) => (b.submittedAt?.toMillis?.() ?? -Infinity) - (a.submittedAt?.toMillis?.() ?? -Infinity),
      );
      setSubmissions(rows);
      setTotal(read.total);
      setTruncated(read.truncated);
    } catch (e) {
      console.error('Failed to load submissions:', e);
      setSubmissions([]);
      setTotal(0);
      setTruncated(false);
    } finally {
      setAnswersLoading(false);
    }
  };

  const openSubmissions = (form: CustomForm) => openFor(form, 'submissions');
  const openAnswers = (form: CustomForm) => openFor(form, 'answers');

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

  /**
   * How many responses the form being edited already has, from the list
   * subscription's own `submissionCount` — no extra read. 0 for a new form, and
   * 0 for an existing one with no responses, which is exactly when the note
   * about renaming an option has nothing to warn about and is not rendered.
   */
  const editingSubmissionCount =
    (editingId ? forms.find(f => f.id === editingId)?.submissionCount : 0) || 0;

  // ════════════════════════════════════════════════════════════════
  if (view === 'builder') {
    return (
      <div className={FORM_MEASURE} style={{ paddingBottom: 120 }}>
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
          <div className="bg-surface-raised rounded-2xl border border-line p-6">
            <h2 className="text-2xl font-bold text-strong mb-1 font-display">{title || 'Untitled form'}</h2>
            {description && <p className="text-sm text-muted mb-5">{description}</p>}
            <div className="space-y-4">
              {fields.map(f => (
                <div key={f.id}>
                  <label className="block text-sm font-medium text-body mb-1.5">{f.label || 'Untitled field'}{f.required && <span className="text-red-500 ml-0.5">*</span>}</label>
                  {f.type === 'long_text' ? <textarea disabled rows={3} placeholder={f.placeholder} className="w-full px-4 py-2.5 border border-line rounded-xl text-sm bg-surface-sunken" />
                    : f.type === 'dropdown' ? <select disabled className="w-full px-4 py-2.5 border border-line rounded-xl text-sm bg-surface-sunken"><option>Select…</option>{(f.options || []).map(o => <option key={o}>{o}</option>)}</select>
                    : (f.type === 'radio' || f.type === 'checkbox') ? <div className="space-y-1.5">{(f.options || []).map(o => <label key={o} className="flex items-center gap-2 text-sm text-muted"><input type={f.type === 'radio' ? 'radio' : 'checkbox'} disabled />{o}</label>)}</div>
                    : <input disabled type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder} className="w-full px-4 py-2.5 border border-line rounded-xl text-sm bg-surface-sunken" />}
                </div>
              ))}
              {fields.length === 0 && <p className="text-sm text-faint">No fields yet.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-surface-raised rounded-2xl border border-line p-5 space-y-3">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Form title" className={`w-full text-lg font-bold px-0 py-1 border-0 border-b border-line focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long}`} />
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className={`w-full text-sm px-0 py-1 border-0 focus:outline-hidden resize-none text-muted ${FIELD_WIDTH.long}`} />
            </div>

            {fields.map((f, i) => (
              <div key={f.id} className="bg-surface-raised rounded-2xl border border-line p-4">
                <div className="flex items-start gap-2">
                  <GripVertical size={16} className="text-stone-300 mt-2.5 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={f.label} onChange={e => updateField(f.id, { label: e.target.value })} placeholder="Field label" className={`flex-1 px-3 py-2 border border-line rounded-lg text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-surface-sunken text-muted whitespace-nowrap">{FIELD_TYPES.find(t => t.type === f.type)?.label}</span>
                    </div>
                    {!fieldHasOptions(f.type) && (
                      <input value={f.placeholder || ''} onChange={e => updateField(f.id, { placeholder: e.target.value })} placeholder="Placeholder (optional)" className={`w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
                    )}
                    {fieldHasOptions(f.type) && (
                      /* ⚠️ A repeating row of small controls is the hard case at 380px, so
                         the row is `flex-wrap` with a `min-w-0 basis-full` text input: the
                         input takes the whole first line and the three icon controls wrap
                         under it rather than squeezing it to nothing or pushing the card
                         wider than the viewport. Above `sm` the basis is released and the
                         row is a single line again.
                         The 44px floor is put on THESE controls rather than on any shared
                         primitive, exactly as THE-298 did with AdminSecondaryButton —
                         resizing a primitive is a redesign of the whole admin app and is
                         not this ticket's. Above `sm` the floor is reset to 0 so Rule 4's
                         deliberate 38px control height decides, unchanged. */
                      <div className="space-y-1.5">
                        {(f.options || []).map((opt, oi) => (
                          <div key={oi} className="flex flex-wrap items-center gap-1.5">
                            <input
                              value={opt}
                              onChange={e => renameOption(f, oi, e.target.value)}
                              placeholder={`Option ${oi + 1}`}
                              aria-label={`Option ${oi + 1}`}
                              className={`basis-full min-w-0 sm:basis-auto sm:flex-1 px-3 py-2 border border-line rounded-lg text-sm focus:outline-hidden focus:border-gold min-h-[44px] sm:min-h-0 ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`}
                            />
                            <button
                              type="button"
                              onClick={() => moveOption(f, oi, -1)}
                              disabled={oi === 0}
                              aria-label={`Move option ${oi + 1} up`}
                              className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1 text-faint hover:text-body disabled:opacity-30"
                            ><ChevronUp size={16} /></button>
                            <button
                              type="button"
                              onClick={() => moveOption(f, oi, 1)}
                              disabled={oi === (f.options || []).length - 1}
                              aria-label={`Move option ${oi + 1} down`}
                              className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1 text-faint hover:text-body disabled:opacity-30"
                            ><ChevronDown size={16} /></button>
                            <button
                              type="button"
                              onClick={() => removeOption(f, oi)}
                              aria-label={`Remove option ${oi + 1}`}
                              className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1 text-faint hover:text-red-600"
                            ><Trash2 size={15} /></button>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => addOption(f)}
                            disabled={(f.options || []).length >= MAX_FIELD_OPTIONS}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-line text-body hover:bg-surface-sunken min-h-[44px] sm:min-h-0 disabled:opacity-30"
                          ><Plus size={12} /> Add option</button>
                          {/* Stated at every size, not only at the ceiling. */}
                          <span className="text-[10px] text-muted">
                            {(f.options || []).length} of {MAX_FIELD_OPTIONS} options
                          </span>
                        </div>
                        {(f.options || []).length >= MAX_FIELD_OPTIONS && (
                          <p className="text-[10px] text-muted">
                            This field is at the {MAX_FIELD_OPTIONS}-option limit. Remove an option to add another.
                          </p>
                        )}
                        {editingSubmissionCount > 0 && (
                          /* 🔴 What renaming or removing an option does to answers already
                             given, said out loud on the screen where it is done. A
                             submission stores the option's TEXT (api/forms/submit is the
                             only writer and is untouched), so a rename cannot reach back
                             into it — the past answer keeps the wording it was submitted
                             with. Nothing is lost or altered: THE-298's per-question view
                             already groups an answer that is not among the declared
                             options as `unlisted` rather than dropping it, so the counts
                             stay complete and the old wording stays visible. What the
                             admin needs to know is that the two rows are the same
                             question asked twice, and that is what this says. */
                          <p className="text-[10px] text-muted">
                            {editingSubmissionCount} response{editingSubmissionCount === 1 ? '' : 's'} already
                            {' '}reference this form. Renaming or removing an option never changes an answer
                            {' '}someone already gave — past answers keep their original wording and stay
                            {' '}counted, listed separately in the answers view.
                          </p>
                        )}
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={!!f.required} onChange={e => updateField(f.id, { required: e.target.checked })} /> Required
                    </label>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => moveField(f.id, -1)} disabled={i === 0} className="p-1 text-faint hover:text-body disabled:opacity-30"><ChevronUp size={16} /></button>
                    <button onClick={() => moveField(f.id, 1)} disabled={i === fields.length - 1} className="p-1 text-faint hover:text-body disabled:opacity-30"><ChevronDown size={16} /></button>
                    <button onClick={() => deleteField(f.id)} className="p-1 text-faint hover:text-red-600"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-surface-raised rounded-2xl border border-dashed border-line p-4">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Add Field</p>
              <div className="flex flex-wrap gap-2">
                {FIELD_TYPES.map(t => (
                  <button key={t.type} onClick={() => addField(t.type)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-line text-body hover:bg-surface-sunken">
                    <Plus size={12} /> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {editingId && (
              <div className="bg-surface-raised rounded-2xl border border-line p-4 space-y-2">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide">Share</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => copy(formUrl(editingId), 'link')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-line text-body hover:bg-surface-sunken">
                    <Link2 size={14} /> {copied === 'link' ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button onClick={() => copy(`<iframe src="${formUrl(editingId)}" width="100%" height="700" frameborder="0"></iframe>`, 'embed')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-line text-body hover:bg-surface-sunken">
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

  /**
   * The ANSWERS view — the per-question summary, which is what the founder
   * asked for: "see straight from that form all answers in the style of Google
   * Forms answers". Google Forms' answers view is per QUESTION, so this is a
   * card per question with its own aggregate, not another table.
   *
   * The responses TABLE below is untouched and is one tap away from here — it
   * is the per-row half and it already worked, so nothing about it is rebuilt.
   */
  if (view === 'answers' && selectedForm) {
    const summaries = summariseForm(
      (selectedForm.fields || []) as unknown as AnswerField[],
      submissions as unknown as Parameters<typeof summariseForm>[1],
    );
    return (
      <div className={FORM_CONTAINER} style={{ paddingBottom: 120 }}>
        <AdminEditorHeader
          onBack={() => setView('list')}
          backLabel="All forms"
          title={selectedForm.title}
          subtitle={`${total} response${total === 1 ? '' : 's'}`}
          actions={
            /* ⚠️ `min-h-[44px] sm:min-h-0` MEASURED, not assumed: AdminSecondaryButton
               renders 41.5px in Chromium at 380px, 2.5px under the phone floor.
               The floor is put on THIS button rather than on the primitive —
               changing AdminUI would resize every secondary button in the admin
               app, which is a redesign and not this ticket's. Above `sm` the
               reset hands the box back to Rule 4, which fixes a control at 38px
               deliberately. */
            <AdminSecondaryButton
              onClick={() => setView('submissions')}
              disabled={total === 0}
              className="min-h-[44px] sm:min-h-0"
            >
              <FileText size={14} /> All responses
            </AdminSecondaryButton>
          }
        />
        <FormAnswersView
          summaries={summaries}
          total={total}
          counted={submissions.length}
          truncated={truncated}
          loading={answersLoading}
        />
      </div>
    );
  }

  if (view === 'submissions' && selectedForm) {
    const cols = [...selectedForm.fields].sort((a, b) => a.order - b.order);
    return (
      <div className={FORM_CONTAINER} style={{ paddingBottom: 120 }}>
        <AdminEditorHeader
          onBack={() => setView('list')}
          backLabel="All forms"
          title={selectedForm.title}
          subtitle={`${total} submission${total === 1 ? '' : 's'}`}
          actions={
            <AdminSecondaryButton onClick={exportCsv} disabled={submissions.length === 0}>
              <Download size={14} /> Export CSV
            </AdminSecondaryButton>
          }
        />
        {/* 🔴 The same ceiling, said on this surface too. The table and the
            summary read the same set, so a truncation the summary declares and
            the table hides would be the silent one all over again. Rendered
            only when it actually fires. */}
        {truncated && (
          <p data-table-truncation-notice className="text-[13px] text-body bg-surface-sunken border border-line rounded-brand-xl p-3.5 mb-4">
            Partial list. This form has {total.toLocaleString()} submissions and the
            table below shows the {submissions.length.toLocaleString()} that could be read
            in one go.
          </p>
        )}
        {submissions.length === 0 ? (
          <div className="text-center py-16 text-faint">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium font-display">No submissions yet</p>
          </div>
        ) : (
          <div className="bg-surface-raised rounded-2xl border border-line shadow-xs overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted uppercase whitespace-nowrap">Submitted</th>
                  {cols.map(c => <th key={c.id} className="px-3 py-2.5 text-left text-xs font-semibold text-muted uppercase whitespace-nowrap">{c.label}</th>)}
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted uppercase">CRM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {submissions.map(s => (
                  <tr key={s.id} className="hover:bg-surface-sunken">
                    <td className="px-3 py-2.5 text-xs text-muted whitespace-nowrap">{fmtDate(s.submittedAt)}</td>
                    {cols.map(c => {
                      const v = s.answers?.[c.id];
                      return <td key={c.id} className="px-3 py-2.5 text-body">{Array.isArray(v) ? v.join(', ') : (v ?? '—')}</td>;
                    })}
                    <td className="px-3 py-2.5 text-right">
                      {s.crmContactId
                        ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-field-100 text-field-700">In CRM</span>
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
  // Rule 1b — the FORM measure, not the page one. A stack of form cards is not
  // a data-dense surface; the submissions TABLE is, and keeps FORM_CONTAINER.
  return (
    <div className={`w-full ${FORM_MEASURE} space-y-6`} style={{ paddingBottom: 120 }}>
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
          <p className="font-display text-lg text-strong">No forms yet</p>
          <p className="text-sm text-muted mt-1">Create a form to collect visitor cards, applications, and connect cards.</p>
          <div className="mt-5">
            <AdminPrimaryButton onClick={() => openBuilder()} icon={<Plus size={16} />}>Create form</AdminPrimaryButton>
          </div>
        </AdminCard>
      ) : (
        <>
          {/* Mobile list — mockup card list: gold disc, title (tap → submissions),
              submissions · fields meta, Active/Inactive status pill (tap → toggleActive),
              and an Edit / Copy link / Open / Delete action row. Same `forms` data and the
              same openSubmissions / toggleActive / openBuilder / copy / formUrl / handleDelete
              handlers as the desktop cards below — no wiring changed. */}
          <div className="lg:hidden space-y-3">
            {forms.map(form => (
              <div key={form.id} className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-4">
                <div className="flex items-start gap-3">
                  <span className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
                    <FileText size={17} />
                  </span>
                  <button onClick={() => openSubmissions(form)} className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-semibold text-strong truncate">{form.title}</div>
                    <div className="text-[11.5px] text-faint mt-0.5">
                      {form.submissionCount || 0} submission{(form.submissionCount || 0) === 1 ? '' : 's'} · {(form.fields?.length || 0)} field{(form.fields?.length || 0) === 1 ? '' : 's'}
                    </div>
                  </button>
                  <button onClick={() => toggleActive(form)} title={form.active ? 'Deactivate' : 'Activate'} className="shrink-0">
                    <AdminBadge tone={form.active ? 'green' : 'stone'}>{form.active ? 'Active' : 'Inactive'}</AdminBadge>
                  </button>
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-line">
                  {/* THE-298 — the founder's button: the per-question answers
                      summary, straight from the form. Reuses this row's exact
                      class string so the phone rendering gains no token but the
                      icon's own name. */}
                  <button onClick={() => openAnswers(form)} className="p-1.5 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors" title="Answers"><ChartColumn size={15} /></button>
                  <button onClick={() => openBuilder(form)} className="p-1.5 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors" title="Edit"><Edit2 size={15} /></button>
                  <button onClick={() => copy(formUrl(form.id), `link_${form.id}`)} className="p-1.5 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors" title={copied === `link_${form.id}` ? 'Copied!' : 'Copy link'}><Link2 size={15} /></button>
                  <a href={formUrl(form.id)} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors" title="Open"><ExternalLink size={15} /></a>
                  <button onClick={() => handleDelete(form)} className="p-1.5 rounded-brand text-danger hover:bg-danger-tint transition-colors ml-auto" title="Delete"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop cards — existing approved layout, unchanged (now lg-only). */}
          <div className="hidden lg:block space-y-4">
          {forms.map(form => (
            <AdminCard key={form.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => openSubmissions(form)} className="flex-1 min-w-0 text-left group">
                  <div className="font-semibold text-strong truncate group-hover:text-gold transition-colors">{form.title}</div>
                  <div className="text-xs text-faint mt-1">
                    {form.submissionCount || 0} submission{(form.submissionCount || 0) === 1 ? '' : 's'}
                    {form.createdAt?.toDate && ` · ${form.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    {` · ${(form.fields?.length || 0)} field${(form.fields?.length || 0) === 1 ? '' : 's'}`}
                  </div>
                </button>
                <button onClick={() => toggleActive(form)} title={form.active ? 'Deactivate' : 'Activate'} className="shrink-0">
                  <AdminBadge tone={form.active ? 'green' : 'stone'}>{form.active ? 'Active' : 'Inactive'}</AdminBadge>
                </button>
              </div>
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-line flex-wrap">
                {/* THE-298 — the same button on the desktop card, same row, same
                    class string. */}
                <button onClick={() => openAnswers(form)} className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-gold transition-colors">
                  <ChartColumn size={13} /> Answers
                </button>
                <button onClick={() => openBuilder(form)} className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-gold transition-colors">
                  <Edit2 size={13} /> Edit
                </button>
                <button onClick={() => copy(formUrl(form.id), `link_${form.id}`)} className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-gold transition-colors">
                  <Link2 size={13} /> {copied === `link_${form.id}` ? 'Copied!' : 'Copy link'}
                </button>
                <a href={formUrl(form.id)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-gold transition-colors">
                  <ExternalLink size={13} /> Open
                </a>
                <button onClick={() => handleDelete(form)} className="flex items-center gap-1.5 text-xs font-semibold text-danger hover:opacity-80 transition-opacity ml-auto">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </AdminCard>
          ))}
        </div>
        </>
      )}
    </div>
  );
};

export default AdminForms;
