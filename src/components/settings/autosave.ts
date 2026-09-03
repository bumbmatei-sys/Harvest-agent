"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * THE-286 — autosave for settings fields, and the loud failure that makes it
 * safe to remove a Save button.
 *
 * ─── Why this is not a new mechanism ─────────────────────────────────────────
 *
 * `AdminDocs.tsx` already autosaves: a 2s debounce on a content keystroke, an
 * immediate write on a title blur, a monotonic sequence number so a slow older
 * write cannot raise an alarm about content the server already has, and a
 * fixed-id `toast.error` whose copy says the work is still on screen. That is
 * this mechanism, and it has been in production since THE-275. Writing a second
 * one beside it would be a second answer to a settled question, so what follows
 * is the SAME idiom extracted — the numbers, the sequence guard, the unmount
 * flush and the wording of the failure all come from there.
 *
 * What is added is the part a note editor does not need and a settings screen
 * does: a settings field is small, independent and easy to leave immediately,
 * so a toast that has faded is the only record a person would have had. See
 * `status === 'error'` below — the failure ALSO persists in the field.
 *
 * ─── 🔴 The three questions autosave has to answer ───────────────────────────
 *
 * 1. WHAT HAPPENS WHEN A SAVE FAILS.  Three things, together:
 *      · the value the person typed is NEVER reverted — this hook does not own
 *        the field's state and cannot put the old value back, which is a
 *        deliberate shape and not an omission;
 *      · a `toast.error` with a FIXED id, so a run of failures offline replaces
 *        rather than stacks;
 *      · the hook stays in `error` until a later save succeeds, so the field
 *        can render a durable, non-transient marker with a Retry. A toast is a
 *        notification; it is not a record, and a settings field is exactly the
 *        surface a person walks away from before reading one.
 *    A silent failed autosave is worse than the Save button it replaces, and
 *    this repo has already shipped that class of bug once — the `deleteState`
 *    machine in PersonalInformationModal exists because a member tapped Delete
 *    and nothing on screen moved.
 *
 * 2. DEBOUNCE, AND WHAT "CHANGED" MEANS.  A text field writes
 *    {@link AUTOSAVE_DEBOUNCE_MS} after the last keystroke, and immediately on
 *    blur; a toggle writes at once, because a switch has one discrete change
 *    and no keystroke storm to absorb. "Changed" is measured against the last
 *    value KNOWN TO BE ON THE SERVER, so tabbing through an untouched field
 *    writes nothing and a debounce that has already been flushed by a blur does
 *    not write again. Without that, a three-field panel cost three Firestore
 *    writes per visit for a person who edited nothing.
 *
 * 3. WHICH FIELDS MUST NOT AUTOSAVE.  {@link AUTOSAVE_EXCLUDED}, below, with a
 *    reason each — and the guard that enforces it is a source sweep, not this
 *    comment.
 */

/**
 * The debounce, in milliseconds — the same 2000 `AdminDocs` spends, and for the
 * same reason: it is long enough that ordinary typing produces ONE write per
 * pause rather than one per keystroke, and short enough that a person who types
 * and immediately closes the panel has already been saved by the blur.
 *
 * 🔴 A per-keystroke write is a Firestore cost and a rate-limit problem: the EIN
 * field alone is ten characters, so an unbounded field would spend ten document
 * writes on one value that only ever mattered once.
 *
 * Exported so the bound is asserted against a number rather than a magic
 * literal read out of a timer.
 */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * The single toast id every autosave failure in settings reuses.
 *
 * Fixed, so that going offline with three fields queued replaces one toast
 * rather than stacking three copies of the same news.
 */
export const AUTOSAVE_ERROR_TOAST_ID = 'settings-autosave-error';

/**
 * The single toast id every autosave SUCCESS in settings reuses.
 *
 * A settings panel has several independent fields and a person can finish with
 * three of them in a second; three separate "Saved" toasts for one visit would
 * be the Save bar's noise without its control. One fixed id means the newest
 * confirmation replaces the last rather than queueing behind it.
 *
 * ⚠️ Deliberately a DIFFERENT id from the error above, not a shared one: a
 * success must never silently replace a failure that is still unresolved, which
 * is what reusing one id would do the moment a second field saved cleanly.
 */
export const AUTOSAVE_SAVED_TOAST_ID = 'settings-autosave-saved';

/** What a field is doing, and what it should therefore render. */
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 🔴 THE EXCLUSION LIST — fields that stay an explicit, confirmed action.
 *
 * Autosave is right for a small independent preference. It is wrong for
 * anything that moves money or destroys something, because both of those want a
 * person to have MEANT it, and an autosaved field is committed by walking away
 * from it.
 *
 * ⚠️ This constant is documentation. The enforcement is a source sweep in
 * `THE-286.settings-chrome-autosave.test.tsx` which asserts that not one of
 * these files imports this module — so adding autosave to a money-path file
 * fails the suite whether or not anybody updates this list.
 */
export const AUTOSAVE_EXCLUDED: ReadonlyArray<{ file: string; field: string; why: string }> = [
  {
    file: 'src/components/settings/PlanUpgradeSection.tsx',
    field: 'plan choice (Upgrade / Downgrade / Switch)',
    why:
      'The money path. It reaches runDodoPlanChange and arms the THE-217 refresh window via ' +
      'armPlanRefresh(); a plan change bills a real card and changes what the tenant may do. ' +
      'It stays an explicit, confirmed action.',
  },
  {
    file: 'src/components/settings/PlanUpgradeSection.tsx',
    field: 'billing term (monthly / yearly)',
    why:
      'Chooses what is charged and over what period. It is an input to the plan change above, ' +
      'not a preference, and autosaving it would commit a price the person was still comparing.',
  },
  {
    file: 'src/components/settings/BillingTermToggle.tsx',
    field: 'the term toggle itself',
    why:
      'The control the billing term is expressed through. Excluded with the field it sets, so the ' +
      'exclusion cannot be sidestepped by autosaving the widget instead of the value.',
  },
  {
    file: 'src/components/AdminSettings.tsx',
    field: 'Cancel Subscription',
    why:
      'Destructive and irreversible from this screen. It already opens a confirm panel; an ' +
      'autosaved cancellation is a subscription ended by a misclick.',
  },
  {
    file: 'src/components/PersonalInformationModal.tsx',
    field: 'Delete Account (and its re-auth password)',
    why:
      'The most destructive action in the app — it erases a member across 25 collections and ' +
      'deletes their sign-in. It owns a five-state machine and eight outcome messages precisely ' +
      'because it must never act without saying what happened. Nothing here is autosaved, and the ' +
      'password typed for re-authentication is a credential, not a setting.',
  },
  {
    file: 'src/components/settings/PaymentSection.tsx',
    field: 'Stripe Connect account',
    why:
      'The money path\'s other half: it configures where donations are paid out. Behind the ' +
      'Stripe Connect master switch (THE-256), which is off, so the panel renders its ' +
      'unavailable state — there is no field to autosave today and there must not be one when ' +
      'it returns.',
  },
  {
    file: 'src/components/settings/DomainSection.tsx',
    field: 'custom domain',
    why:
      'A domain change repoints a live site and is not a preference. Behind the custom-domain ' +
      'master switch (THE-280), which is off, so the section is hidden entirely.',
  },
  {
    file: 'src/components/settings/SmsSection.tsx',
    field: 'Twilio credentials and the test send',
    why:
      'Credentials, and a control that spends the church\'s own money on a real send to a real ' +
      'phone. Behind the SMS master switch (THE-245), which is server-side first and is off.',
  },
  {
    file: 'src/components/settings/AddOnsSection.tsx',
    field: 'add-on purchase and removal',
    why: 'Buying an add-on is a charge. Removing one is a downgrade. Both are the money path.',
  },
];

/**
 * One autosaved field.
 *
 * The caller owns the value and its `useState`; this hook owns only WHEN the
 * write goes out and WHAT is shown about it. That split is what makes the
 * failure behaviour above possible — a hook that owned the value could revert
 * it, and reverting is precisely the silent discard being designed out.
 *
 * @param save   Writes the value. Must reject or throw to signal failure;
 *               resolving is taken as "this is on the server now".
 * @param label  Names the field in the failure toast, so a person reading it
 *               knows which of three fields did not save.
 */
export function useAutosaveField<T>(
  save: (value: T) => Promise<void>,
  label: string,
  options?: { debounceMs?: number },
) {
  const debounceMs = options?.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The value a queued write will send. Held in a ref, not in the timer's
   *  closure, so a later keystroke updates the pending payload rather than
   *  queueing a second write of an older value. */
  const pending = useRef<{ value: T } | null>(null);
  /**
   * The last value known to be ON THE SERVER — the baseline "changed" is
   * measured against. Seeded by {@link prime} from whatever the section loaded,
   * so a field that is merely displayed is not also saved.
   */
  const committed = useRef<{ value: T } | null>(null);
  /**
   * Only the most recently issued write may drive the status and the toast. An
   * older save failing after a newer one succeeded means the newer value is
   * already on the server, so the failure is moot and raising it would be an
   * alarm the person cannot act on. (Taken from `AdminDocs.saveSeq`.)
   */
  const seq = useRef(0);
  const mounted = useRef(true);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  /** Record what the server already has, without writing it. */
  const prime = useCallback((value: T) => { committed.current = { value }; }, []);

  const write = useCallback(async (value: T): Promise<boolean> => {
    const mine = ++seq.current;
    const isLatest = () => seq.current === mine;
    if (mounted.current) setStatus('saving');
    try {
      await saveRef.current(value);
      committed.current = { value };
      if (isLatest()) {
        if (mounted.current) setStatus('saved');
        // The confirmation the founder's call asks for, in place of a Save bar.
        // Only the latest write may raise it, for the same reason only the
        // latest may raise the failure: an older write landing afterwards is
        // news about a value that is no longer on screen.
        toast.success('Saved', { id: AUTOSAVE_SAVED_TOAST_ID });
      }
      return true;
    } catch (e) {
      console.error(`Failed to autosave ${label}`, e);
      if (isLatest()) {
        if (mounted.current) setStatus('error');
        // 🔴 NOT gated on `mounted`: the Toaster lives in the root layout, so a
        // save that fails as the panel closes can still say so. Same reasoning
        // as AdminDocs — and the copy makes the same promise, because it is the
        // same promise: the value is still in the field, nothing was discarded.
        toast.error(`Could not save ${label} — your change is still here. Try again.`, {
          id: AUTOSAVE_ERROR_TOAST_ID,
        });
      }
      return false;
    }
  }, [label]);

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
  }, []);

  /** Write whatever the debounce has not written yet, now. */
  const flush = useCallback((): Promise<boolean> => {
    const queued = pending.current;
    cancel();
    if (!queued) return Promise.resolve(true);
    return write(queued.value);
  }, [cancel, write]);

  /** True when `value` differs from what the server is known to hold. */
  const changed = useCallback(
    (value: T) => !committed.current || !Object.is(committed.current.value, value),
    [],
  );

  /**
   * A text field changed. Queue a write for `debounceMs` from now.
   *
   * An unchanged value cancels any queued write instead of scheduling one:
   * typing a character and deleting it again leaves the field where the server
   * already is, and should cost nothing.
   */
  const onChange = useCallback((value: T) => {
    if (!changed(value)) { cancel(); setStatus('idle'); return; }
    pending.current = { value };
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, debounceMs);
  }, [cancel, changed, debounceMs, flush]);

  /**
   * The field lost focus. Write now rather than waiting out the debounce — a
   * person who has moved on has finished with this value.
   */
  const onBlur = useCallback((value: T): Promise<boolean> => {
    cancel();
    if (!changed(value)) return Promise.resolve(true);
    return write(value);
  }, [cancel, changed, write]);

  /**
   * A toggle changed. Writes immediately and is NOT debounced: a switch has one
   * discrete change per interaction, so there is no keystroke storm to absorb
   * and a 2s wait would only be 2s in which the switch lied about its state.
   */
  const onCommit = useCallback((value: T): Promise<boolean> => {
    cancel();
    return write(value);
  }, [cancel, write]);

  /** Re-run the last failed write, from the field's Retry affordance. */
  const retry = useCallback((value: T): Promise<boolean> => {
    cancel();
    return write(value);
  }, [cancel, write]);

  // Flush on unmount rather than leaving a timer to fire into a component that
  // is gone. `mounted` goes false first so the flush's own status updates are
  // skipped while its write proceeds — the Firestore SDK owns the write, not
  // React, so it still lands. Without this, closing an accordion row within the
  // debounce window dropped everything typed since the last write.
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void flushRef.current(); };
  }, []);

  return { status, onChange, onBlur, onCommit, retry, flush, prime, changed };
}
