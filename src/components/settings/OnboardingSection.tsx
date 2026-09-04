"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Plus, RotateCw, Search, Trash2 } from 'lucide-react';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CONTROL_DENSITY } from '../layout/form-layout';
import { useAutosaveField, type AutosaveStatus } from './autosave';
import { NAV_CLEARANCE } from './GivingStatementsSection';

/**
 * THE-296 — the onboarding questions, converted onto THE-286's chrome.
 *
 * ─── Why this section, and what the conversion actually removes ──────────────
 *
 * Of the sections `AdminSettings` mounts, this is the one that still carried a
 * SAVE BUTTON — the exact control THE-286's autosave was extracted to replace.
 * Everything else here followed from that button existing: an `onboardingSaved`
 * flag with a 3s `setTimeout`, a `✓ Questions saved successfully` line in
 * `text-green-600`, and — the part that matters — `alert('Failed to save
 * onboarding questions. Please try again.')` as the entire failure story.
 *
 * 🔴 That `alert()` is the bug THE-286 was written against, in its other form.
 * A blocking modal a person dismisses leaves NO record: the questions are still
 * on screen, unsaved, indistinguishable from saved, and the next navigation
 * discards them silently. `deleteState` in `PersonalInformationModal.tsx`
 * (:234–261) exists because that class of silence already shipped once. The
 * failure is now what THE-286 made it — the value is never reverted, a toast
 * fires, and a durable `role="alert"` row with a Retry stays in the panel until
 * a later save lands.
 *
 * ─── 🔴 What is NOT autosaved here, and why that is not a footer bar ─────────
 *
 * DELETE. Autosave is right for a small independent preference and wrong for
 * anything destructive — THE-286's own words, and a deleted question is a piece
 * of the church's signup form gone with one tap. Today the Save button was the
 * accident-brake: delete, walk away, nothing was lost. Removing the button
 * without replacing that brake would make this conversion a REGRESSION in
 * safety, so delete became a two-tap confirmed action IN THE ROW (see
 * {@link confirmingDelete}) — a confirmed action, per the brief, not a footer
 * bar, and nothing about it is deferred or batched.
 *
 * Add, edit and reorder do autosave: each is a discrete, reversible change to a
 * list that is fully on screen, which is exactly `onCommit`'s case.
 *
 * ─── What the chrome gave back ──────────────────────────────────────────────
 *
 * The editor dialog used to spell its own field chrome three times
 * (`px-4 py-2 border border-line rounded-lg focus:ring-2 focus:ring-gold`); it
 * now spells none, and takes `field` + the pre-existing `input`. The question
 * rows keep a card because they ARE items in a list, not a second copy of the
 * accordion's panel — the panel card is the accordion row's and this file draws
 * none.
 */

interface OnboardingQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'textarea';
  options?: string[];
  required: boolean;
  order: number;
}

const DEFAULT_ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { id: 'default_name', label: 'Full Name', type: 'text', required: true, order: 0 },
  { id: 'default_country', label: 'Country', type: 'select', required: true, order: 1, options: [] },
  { id: 'default_city', label: 'City', type: 'text', required: true, order: 2 },
  { id: 'default_phone', label: 'Phone Number', type: 'text', required: true, order: 3 },
  { id: 'default_accepted_jesus', label: 'Have you accepted Jesus?', type: 'radio', required: true, order: 4, options: ['Yes', 'No'] },
];

const questionTypeOptions: { value: 'text' | 'select' | 'radio' | 'textarea'; label: string }[] = [
  { value: 'text', label: 'Text Input' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio Buttons' },
];

/**
 * A control's height: the 44px touch floor on a phone, Rule 4's 38px from `sm:`
 * up. Identical to the reasoning in `GivingStatementsSection` — `min-h-` rather
 * than `h-` so it wins over the primitive's own `h-8` regardless of stylesheet
 * order, and released at `sm:` so a desktop keeps the settled density band
 * (`DENSITY_PX.control` is 38 ON PURPOSE, and a test asserts it is under 44).
 */
export const CONTROL_HEIGHT = `min-h-[44px] sm:min-h-[38px] ${CONTROL_DENSITY.control}`;

/**
 * An action button's height. Rule 4's `action` band (40px) above `sm`, the
 * touch floor below it. Distinct from CONTROL_HEIGHT because Rule 4 separates
 * them and `DESKTOP_CONTROL_MAX_PX` caps this one at exactly 40.
 */
export const ACTION_HEIGHT = `min-h-[44px] sm:min-h-[40px] ${CONTROL_DENSITY.action}`;

/**
 * An icon-only control. The icon is 16px; the 44px comes from the BUTTON, not
 * from the glyph, so the target is real rather than merely declared. Square
 * below `sm` so a reorder arrow is not a 44×20 sliver.
 */
export const ICON_BUTTON = 'min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] inline-flex items-center justify-center rounded-brand';

/**
 * The failure marker, and the reason it is not only a toast.
 *
 * Same shape and the same argument as `GivingStatementsSection`'s: a toast is a
 * notification, not a record, and it fades. This row stays until a later save
 * succeeds and carries the retry. `FieldError` supplies `role="alert"` from the
 * primitive, which is what puts the failure in front of a screen reader too.
 *
 * 🔴 It replaces an `alert()`. A dismissed browser alert leaves nothing behind
 * at all, which is the silent discard this whole mechanism exists to prevent.
 */
const AutosaveError: React.FC<{ status: AutosaveStatus; onRetry: () => void }> = ({ status, onRetry }) =>
  status !== 'error' ? null : (
    <FieldError>
      <span className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
        <span>Not saved — your questions are still here.</span>
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1 underline underline-offset-2 ${CONTROL_HEIGHT}`}
        >
          <RotateCw size={14} aria-hidden="true" />
          Retry
        </button>
      </span>
    </FieldError>
  );

const OnboardingSection: React.FC = () => {
  const [onboardingQuestions, setOnboardingQuestions] = useState<OnboardingQuestion[]>([]);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<OnboardingQuestion | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  /**
   * The id whose Delete is armed. 🔴 The accident-brake that replaces the Save
   * button — one tap arms, a second commits, and anything else disarms. Held as
   * an id rather than a boolean so opening a second row's confirm closes the
   * first instead of arming two at once.
   */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  /**
   * The single writer. Writes the whole list, because the list IS the value —
   * order is a property of the array, so a per-question dotted path could not
   * express a reorder. That is the opposite of `GivingStatementsSection`'s
   * three independent fields, and for the opposite reason: there, three writers
   * racing on one map would clobber each other; here there is exactly one
   * writer and one value.
   */
  const writeQuestions = useCallback(async (questions: OnboardingQuestion[]) => {
    const { auth, db } = await import('../../firebase');
    const { doc, getDoc, updateDoc } = await import('firebase/firestore');
    if (!auth.currentUser) throw new Error('not signed in');
    const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
    if (!userDoc.exists()) throw new Error('no user record');
    const tenantId = userDoc.data().tenantId;
    if (!tenantId) throw new Error('no tenant');
    await updateDoc(doc(db, 'tenants', tenantId), {
      'config.onboardingQuestions': questions,
      'config.onboardingInitialized': true,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const auto = useAutosaveField(writeQuestions, 'your onboarding questions');

  /**
   * Apply a change to the list and save it.
   *
   * `onCommit`, not `onChange`: every mutation here is one discrete act on a
   * control that has already been pressed — there is no keystroke storm to
   * absorb, and a 2s debounce would only be 2s in which the screen disagreed
   * with the server. Same reasoning the hook gives for a toggle.
   *
   * The state is set FIRST and never reverted on failure, which is THE-286's
   * deliberate shape: the person keeps what they built and the error row tells
   * them it is not on the server yet.
   */
  const commit = useCallback((next: OnboardingQuestion[]) => {
    setOnboardingQuestions(next);
    void auto.onCommit(next);
  }, [auto]);

  /** The latest list, for a Retry that must not close over a stale array. */
  const latest = useRef(onboardingQuestions);
  useEffect(() => { latest.current = onboardingQuestions; }, [onboardingQuestions]);

  useEffect(() => {
    if (onboardingLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const tenantId = userDoc.data().tenantId;
            if (tenantId) {
              const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
              if (tenantDoc.exists()) {
                const config = tenantDoc.data().config || {};
                const stored = config.onboardingQuestions;
                const next: OnboardingQuestion[] = config.onboardingInitialized
                  ? (Array.isArray(stored) && stored.length > 0
                      ? [...stored].sort((a: OnboardingQuestion, b: OnboardingQuestion) => a.order - b.order)
                      : [])
                  : DEFAULT_ONBOARDING_QUESTIONS;
                if (!cancelled) setOnboardingQuestions(next);
                // 🔴 Seed the baseline WITHOUT writing it, exactly as the proof
                // section does — otherwise merely opening this panel would spend
                // a write echoing the stored list straight back, and on a tenant
                // that had never initialised it would silently persist the
                // defaults as if someone had chosen them.
                auto.prime(next);
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to load onboarding questions:', e);
      }
      if (!cancelled) setOnboardingLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [onboardingLoaded, auto]);

  const addQuestion = () => {
    setEditingQuestion({
      id: `custom_${Date.now()}`,
      label: '',
      type: 'text',
      options: [],
      required: false,
      order: onboardingQuestions.length,
    });
    setShowQuestionModal(true);
  };

  const editQuestion = (q: OnboardingQuestion) => {
    setEditingQuestion({ ...q });
    setShowQuestionModal(true);
  };

  /** 🔴 Only ever reached from the armed second tap. */
  const deleteQuestion = (id: string) => {
    setConfirmingDelete(null);
    commit(onboardingQuestions.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    const next = [...onboardingQuestions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= next.length) return;
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setConfirmingDelete(null);
    commit(next.map((q, i) => ({ ...q, order: i })));
  };

  const saveQuestion = () => {
    if (!editingQuestion || !editingQuestion.label.trim()) return;
    const exists = onboardingQuestions.some(q => q.id === editingQuestion.id);
    commit(
      exists
        ? onboardingQuestions.map(q => (q.id === editingQuestion.id ? editingQuestion : q))
        : [...onboardingQuestions, editingQuestion],
    );
    setShowQuestionModal(false);
    setEditingQuestion(null);
  };

  return (
    <div className={`${CONTROL_DENSITY.sectionGap} space-y-6 ${NAV_CLEARANCE}`}>
      <p className="text-body">
        These are the questions new members see when signing up. Edit, reorder, or delete any
        question. Add your own custom questions below. Changes save on their own.
      </p>

      <button
        onClick={addQuestion}
        className={`inline-flex items-center gap-2 px-4 bg-gold text-white rounded-brand text-sm font-medium hover:opacity-90 transition-opacity ${ACTION_HEIGHT}`}
      >
        <Plus size={16} aria-hidden="true" />
        Add Question
      </button>

      {/* 🔴 The failure record, at the top of the panel rather than beside one
          field: the value that failed to save is the WHOLE list, so there is no
          single field to hang it on. */}
      <AutosaveError status={auto.status} onRetry={() => { void auto.retry(latest.current); }} />

      {onboardingQuestions.length === 0 && onboardingLoaded && (
        <div className="bg-surface-sunken rounded-brand border border-line-subtle p-8 text-center">
          <p className="text-xs text-faint">No questions yet. Use Add Question to create one.</p>
        </div>
      )}

      {onboardingQuestions.map((q, index) => (
        <div
          key={q.id}
          data-question={q.id}
          className="bg-surface-sunken rounded-brand border border-line-subtle p-4 flex items-start gap-3"
        >
          <div className="flex flex-col shrink-0">
            <button
              onClick={() => moveQuestion(index, 'up')}
              disabled={index === 0}
              aria-label={`Move ${q.label || 'question'} up`}
              className={`text-faint hover:text-body disabled:opacity-30 ${ICON_BUTTON}`}
            >
              <ChevronUp size={16} aria-hidden="true" />
            </button>
            <button
              onClick={() => moveQuestion(index, 'down')}
              disabled={index === onboardingQuestions.length - 1}
              aria-label={`Move ${q.label || 'question'} down`}
              className={`text-faint hover:text-body disabled:opacity-30 ${ICON_BUTTON}`}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-strong">{q.label || '(Untitled)'}</span>
              <span className="text-xs bg-surface-chip text-muted px-2 py-0.5 rounded-full">{q.type}</span>
              {q.required && (
                <span className="text-xs bg-danger-tint text-danger-strong px-2 py-0.5 rounded-full">Required</span>
              )}
            </div>
            {(q.type === 'select' || q.type === 'radio') && q.options && q.options.length > 0 && (
              <p className="text-xs text-faint">Options: {q.options.join(', ')}</p>
            )}
            {q.id === 'default_country' && (
              <p className="text-xs text-muted mt-1 flex items-center gap-1">
                {/* Was a 🔍 magnifying-glass emoji standing in for an icon. */}
                <Search size={12} aria-hidden="true" className="shrink-0" />
                Renders as a searchable country picker in the signup form
              </p>
            )}
            {q.id === 'default_accepted_jesus' && (
              <p className="text-xs text-faint mt-1">Options: Yes, No (fixed)</p>
            )}

            {/* 🔴 The confirm, in the row. Not a dialog — this is one list item,
                and a modal for it would be heavier than the act. Not a footer
                bar either: it commits immediately when pressed. */}
            {confirmingDelete === q.id && (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-danger-strong">Delete this question?</span>
                <button
                  onClick={() => deleteQuestion(q.id)}
                  data-confirm-delete={q.id}
                  className={`px-4 bg-danger text-white rounded-brand text-xs font-semibold hover:opacity-90 transition-opacity ${ACTION_HEIGHT}`}
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmingDelete(null)}
                  className={`px-4 text-body rounded-brand text-xs font-semibold hover:bg-surface-tint transition-colors ${ACTION_HEIGHT}`}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button
              onClick={() => { setConfirmingDelete(null); editQuestion(q); }}
              className={`px-4 text-xs font-semibold text-gold bg-surface-chip rounded-brand hover:opacity-90 transition-opacity ${ACTION_HEIGHT}`}
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmingDelete(prev => (prev === q.id ? null : q.id))}
              aria-label={`Delete ${q.label || 'question'}`}
              aria-expanded={confirmingDelete === q.id}
              className={`inline-flex items-center justify-center gap-1 px-4 text-xs font-semibold text-danger-strong bg-danger-tint rounded-brand hover:opacity-90 transition-opacity ${ACTION_HEIGHT}`}
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* The editor dialog.
          🔴 z-[200], ABOVE the bottom nav's z-[100] — the same layer THE-286's
          settings dialog takes. It does NOT depend on THE-295 raising the
          primitives' defaults, and it is not the `dialog`/`sheet` primitive at
          all, so nothing here is coupled to that ticket landing first. */}
      {showQuestionModal && editingQuestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-surface-raised rounded-brand-lg p-4 max-w-md w-full max-h-[85dvh] overflow-y-auto">
            <h3 className="font-display text-sm font-semibold text-strong mb-4">
              {onboardingQuestions.some(q => q.id === editingQuestion.id) ? 'Edit Question' : 'Add Question'}
            </h3>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="oq-label">Label</FieldLabel>
                <Input
                  id="oq-label"
                  value={editingQuestion.label}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, label: e.target.value })}
                  placeholder="e.g. What is your favorite verse?"
                  className={CONTROL_HEIGHT}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="oq-type">Type</FieldLabel>
                {/* A NATIVE select on purpose: on a phone it opens the platform
                    picker, which is a better target than any listbox this panel
                    could draw, and it costs no new primitive. Its chrome is the
                    input primitive's, borrowed by class rather than re-spelled. */}
                <select
                  id="oq-type"
                  value={editingQuestion.type}
                  onChange={(e) => setEditingQuestion({
                    ...editingQuestion,
                    type: e.target.value as OnboardingQuestion['type'],
                  })}
                  className={`w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm ${CONTROL_HEIGHT}`}
                >
                  {questionTypeOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>

              {(editingQuestion.type === 'select' || editingQuestion.type === 'radio') && (
                <Field>
                  <FieldLabel htmlFor="oq-options">Options</FieldLabel>
                  <Input
                    id="oq-options"
                    value={(editingQuestion.options || []).join(', ')}
                    onChange={(e) => setEditingQuestion({
                      ...editingQuestion,
                      options: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                    })}
                    placeholder="e.g. Option A, Option B, Option C"
                    className={CONTROL_HEIGHT}
                  />
                  <FieldDescription>Separate each option with a comma.</FieldDescription>
                </Field>
              )}

              <Field orientation="horizontal">
                <FieldLabel htmlFor="oq-required">Required</FieldLabel>
                {/* The tappable target is the BUTTON, not the pill inside it —
                    the installed `switch` primitive is 18.4px tall, which is a
                    pointer target and not a thumb's, and stretching it to 44
                    would deform the control rather than enlarge the target. */}
                <button
                  id="oq-required"
                  type="button"
                  role="switch"
                  aria-checked={editingQuestion.required}
                  onClick={() => setEditingQuestion({ ...editingQuestion, required: !editingQuestion.required })}
                  className={`${ICON_BUTTON} px-2`}
                >
                  <span
                    aria-hidden="true"
                    className={`block w-10 h-6 rounded-full relative transition-colors ${editingQuestion.required ? 'bg-gold' : 'bg-surface-chip'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-surface-raised shadow transition-all ${editingQuestion.required ? 'left-5' : 'left-1'}`} />
                  </span>
                </button>
              </Field>
            </FieldGroup>

            <div className="flex gap-3 justify-end pt-4">
              <button
                onClick={() => { setShowQuestionModal(false); setEditingQuestion(null); }}
                className={`px-4 text-body rounded-brand text-sm font-medium hover:bg-surface-tint transition-colors ${ACTION_HEIGHT}`}
              >
                Cancel
              </button>
              <button
                onClick={saveQuestion}
                disabled={!editingQuestion.label.trim()}
                className={`px-4 bg-gold text-white rounded-brand text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 ${ACTION_HEIGHT}`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnboardingSection;
