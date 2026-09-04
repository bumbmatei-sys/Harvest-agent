import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-304 — "Forms are working as intended but it's a poor system. I cannot add
 * more option in any of the fields."
 *
 * ─── Which of the four possible failures this actually was ───────────────────
 *
 * "Cannot add more" has four readings, and they are four different bugs: no add
 * control at all; a hardcoded cap; an add control that fails silently; or
 * options editable only at creation. 🔴 IT WAS THE THIRD, and the mechanism is
 * worth stating exactly because the fix follows from it.
 *
 * The option editor was ONE controlled `<textarea>`:
 *
 *     value={(f.options || []).join('\n')}
 *     onChange={e => updateField(f.id, { options: e.target.value.split('\n').filter(Boolean) })}
 *
 * Type "Option 1" and press Enter. The DOM value becomes `"Option 1\n"`, which
 * splits to `['Option 1', '']`, which `filter(Boolean)` reduces to
 * `['Option 1']` — the list it already held. React re-renders with the
 * unchanged `value`, restores the DOM node, and THE NEWLINE IS GONE UNDER THE
 * CURSOR. No error, no cap, no message: the keystroke is simply reverted. The
 * same erasure blocks splitting an existing line, so an option could not be
 * inserted between two others either. An add control existed, was reachable
 * after creation, and had no limit — and it could not add an option.
 *
 * ⚠️ Note what was NOT broken, and stays untouched here: forms submit,
 * /api/forms/submit still writes every submission and both CRM rows, THE-298's
 * per-question answers view still keys to the form's fields, and the CSV export
 * still exports the columns it did. Those are pinned below, as facts, because
 * the founder said the rest of the system works and a fix that quietly moved
 * one of them would be a worse defect than the one being fixed.
 *
 * ─── What happens to a past answer when an option is renamed ─────────────────
 *
 * 🔴 Stated rather than assumed. A submission stores the ANSWER TEXT, keyed by
 * FIELD id — `answers[fieldId] = 'Worship'` — and /api/forms/submit is its only
 * writer. So an option's text is not a foreign key into anything: renaming an
 * option in the builder cannot reach a submission and does not try to. The past
 * answer keeps the wording it was given with, permanently.
 *
 * ⚠️ That is not the same as "nothing happens". THE-298's aggregate already
 * anticipated exactly this: an answer that is not among the field's declared
 * options is counted and shown as `unlisted` rather than dropped, so after a
 * rename the question shows two rows — the old wording with its historical
 * count, and the new wording from zero. NOTHING IS LOST AND NO COUNT MOVES;
 * what changes is that one question wears two labels, which is a fact the admin
 * has to know before they rename. So the editor SAYS SO, on the screen where
 * the rename happens, whenever the form already has responses. Asserted below.
 *
 * A rename that rewrote past submissions to match would be the real data loss —
 * it would edit what people actually said — and it would need the write path
 * this ticket may not touch. It is deliberately not done.
 */

/* ═════════════════════════════════════════════════════════════════════════════
   Mocks.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Doc { id: string; data: Record<string, unknown> }

const STORE: Record<string, Doc[]> = {};
/** Every write this suite let through, so the SAVED SHAPE is assertable. */
const writes: { kind: string; path: string; payload: Record<string, unknown> }[] = [];

const pathOf = (x: unknown) => (x as { __path?: string })?.__path ?? '';

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (base: unknown, ...cs: unknown[]) => ({ __path: pathOf(base), __cs: cs }),
  where: (...a: unknown[]) => ({ __t: 'where', a }),
  orderBy: (...a: unknown[]) => ({ __t: 'orderBy', a }),
  limit: (n: number) => ({ __t: 'limit', n }),
  startAfter: (d: unknown) => ({ __t: 'startAfter', d }),
  documentId: () => '__name__',
  getCountFromServer: async (q: unknown) => ({ data: () => ({ count: (STORE[pathOf(q)] ?? []).length }) }),
  getDocs: async (q: unknown) => {
    const docs = (STORE[pathOf(q)] ?? []).map((r) => ({ id: r.id, data: () => r.data }));
    return { docs, size: docs.length, forEach: (f: never) => docs.forEach(f) };
  },
  onSnapshot: (q: unknown, cb: unknown) => {
    const docs = (STORE[pathOf(q)] ?? []).map((r) => ({ id: r.id, data: () => r.data }));
    if (typeof cb === 'function') (cb as (s: unknown) => void)({ docs, size: docs.length });
    return () => {};
  },
  getDoc: async () => ({ exists: () => true, data: () => ({}) }),
  addDoc: async (c: unknown, payload: Record<string, unknown>) => {
    writes.push({ kind: 'addDoc', path: pathOf(c), payload });
    return { id: 'new' };
  },
  updateDoc: async (d: unknown, payload: Record<string, unknown>) => {
    writes.push({ kind: 'updateDoc', path: pathOf(d), payload });
  },
  deleteDoc: async () => {},
  setDoc: async () => {},
  serverTimestamp: () => null,
  Timestamp: class {},
  increment: (n: number) => n,
  arrayUnion: (...a: unknown[]) => a,
  arrayRemove: (...a: unknown[]) => a,
  writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false, currentTenant: { id: 't1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'platform', getTenantId: async () => 't1', getTenantIdFromHost: () => 't1',
  isPlatformContext: () => false, hasPlatformOverride: () => false,
  getTenantScope: async () => null, getWriteTenantScope: async () => 't1',
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mountScreen, click, settle, buttonByLabel, buttonStartingWith, controlByPlaceholder } =
  await import('../../test/support/ministry-screens');
const AdminForms = (await import('../AdminForms')).default;
const { MAX_FIELD_OPTIONS, OPTION_TYPES, fieldHasOptions, nextOptionLabel } = await import('../AdminForms');
const { summariseForm, summariseField } = await import('../forms/form-answers');
import type { AnswerField } from '../forms/form-answers';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const readRepo = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/* ═════════════════════════════════════════════════════════════════════════════
   Driving the option editor through what a person actually touches.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Type into a controlled React input the way React's own onChange sees it. */
async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  const { act } = await import('react');
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

/** Every option control of the ONE choice field on screen, in render order. */
const optionInputs = (root: ParentNode): HTMLInputElement[] =>
  Array.from(root.querySelectorAll('input[aria-label^="Option "]')) as HTMLInputElement[];

const optionValues = (root: ParentNode): string[] => optionInputs(root).map((i) => i.value);

const controlLabelled = (root: ParentNode, label: string): HTMLButtonElement => {
  const el = root.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`no control labelled "${label}" — the option editor's markup changed`);
  return el as HTMLButtonElement;
};

/**
 * Open an EXISTING form in the builder, through the card's own Edit control.
 *
 * ⚠️ Found by its `title="Edit"`, which is the label a person reads, never by a
 * class or an index — a positional lookup would silently open whatever button
 * happened to be first, which on this screen is "Create form".
 */
async function editStoredForm(root: ParentNode) {
  const edit = root.querySelector('button[title="Edit"]');
  if (!edit) throw new Error('no Edit control on the form card — the list markup changed');
  await click(edit as HTMLElement);
}

/** Open the builder on a new form and add one field of `type`. */
async function builderWith(typeLabel: string) {
  const m = await mountScreen(<AdminForms />);
  await click(buttonStartingWith(m.container, 'Create form'));
  // A title is required to save, and every assertion here that reaches the save
  // needs the save to actually happen rather than to alert.
  await typeInto(controlByPlaceholder(m.container, 'Form title') as HTMLInputElement, 'Volunteer Sign-Up');
  await click(buttonByLabel(m.container, typeLabel));
  return m;
}

/** Save, and fail loudly if the builder refused instead of writing. */
async function save(root: ParentNode) {
  const before = writes.length;
  await click(buttonStartingWith(root, 'Save form'));
  if (writes.length === before) throw new Error(`the save did not write; alerts: ${alerts.join(' | ')}`);
}

beforeEach(() => {
  for (const k of Object.keys(STORE)) delete STORE[k];
  writes.length = 0;
  STORE['tenants/t1/forms'] = [];
  // happy-dom has no window.alert. The builder alerts on a missing title and on
  // a save failure; both are recorded so a silent failure cannot pass as a save.
  alerts.length = 0;
  (globalThis as unknown as { alert: (m?: unknown) => void }).alert =
    (m?: unknown) => { alerts.push(String(m)); };
});

const alerts: string[] = [];

/* ═════════════════════════════════════════════════════════════════════════════
   1. THE LITERAL COMPLAINT — named per type.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('an option can be added', () => {
  // Named per type on purpose: the founder said "any of the fields", and a
  // single test over one type would leave the other two unproven.
  for (const [typeLabel, fieldType] of [['Dropdown', 'dropdown'], ['Radio', 'radio'], ['Checkbox', 'checkbox']] as const) {
    it(`an option can be added to a ${fieldType} field`, async () => {
      const m = await builderWith(typeLabel);
      try {
        expect(optionValues(m.container), `${fieldType} did not start with its seeded option`).toEqual(['Option 1']);

        await click(buttonStartingWith(m.container, 'Add option'));
        expect(optionValues(m.container), `${fieldType} could not add a SECOND option`).toEqual(['Option 1', 'Option 2']);

        await click(buttonStartingWith(m.container, 'Add option'));
        expect(optionValues(m.container), `${fieldType} could not add a THIRD option`)
          .toEqual(['Option 1', 'Option 2', 'Option 3']);

        // And the added option survives into what is actually stored.
        await typeInto(optionInputs(m.container)[2], 'Hospitality');
        await save(m.container);
        const saved = writes.at(-1)!.payload.fields as { type: string; options?: string[] }[];
        expect(saved[0].type).toBe(fieldType);
        expect(saved[0].options).toEqual(['Option 1', 'Option 2', 'Hospitality']);
      } finally { m.unmount(); }
    });
  }

  it('reaches every type FIELD_TYPES marks as having options, with none left out', () => {
    // The editor renders off `fieldHasOptions`, which is derived from
    // FIELD_TYPES — so a fourth choice type cannot be added to the builder and
    // silently get no option editor.
    expect([...OPTION_TYPES]).toEqual(['dropdown', 'radio', 'checkbox']);
    for (const t of OPTION_TYPES) expect(fieldHasOptions(t)).toBe(true);
    for (const t of ['short_text', 'long_text', 'email', 'phone', 'number', 'date'] as const) {
      expect(fieldHasOptions(t)).toBe(false);
    }
  });

  it('no longer edits options through a newline-split textarea', () => {
    // 🔴 The regression guard for the actual mechanism. `filter(Boolean)` over a
    // split on newlines is what deleted the keystroke; if it comes back, so does
    // the bug, and every behavioural test above would still pass against a
    // control that reverts what you type only when it is TYPED rather than set.
    const code = readRepo('src/components/AdminForms.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/options:\s*e\.target\.value\.split/);
    expect(code).not.toMatch(/One option per line/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   2. AN ADD-ONLY EDITOR WOULD STILL BE POOR.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('an option can be renamed, reordered and removed', () => {
  it('renames an option in place, and stores the new wording', async () => {
    const m = await builderWith('Dropdown');
    try {
      await click(buttonStartingWith(m.container, 'Add option'));
      await typeInto(optionInputs(m.container)[0], 'Worship');
      await typeInto(optionInputs(m.container)[1], 'Kids');
      expect(optionValues(m.container)).toEqual(['Worship', 'Kids']);

      await typeInto(optionInputs(m.container)[0], 'Worship & Production');
      expect(optionValues(m.container)).toEqual(['Worship & Production', 'Kids']);
    } finally { m.unmount(); }
  });

  it('reorders options up and down, and the ends are disabled rather than silent', async () => {
    const m = await builderWith('Radio');
    try {
      await click(buttonStartingWith(m.container, 'Add option'));
      await click(buttonStartingWith(m.container, 'Add option'));
      await typeInto(optionInputs(m.container)[0], 'A');
      await typeInto(optionInputs(m.container)[1], 'B');
      await typeInto(optionInputs(m.container)[2], 'C');

      await click(controlLabelled(m.container, 'Move option 3 up'));
      expect(optionValues(m.container)).toEqual(['A', 'C', 'B']);
      await click(controlLabelled(m.container, 'Move option 1 down'));
      expect(optionValues(m.container)).toEqual(['C', 'A', 'B']);

      // The ends say so, rather than being controls that do nothing.
      expect(controlLabelled(m.container, 'Move option 1 up').disabled).toBe(true);
      expect(controlLabelled(m.container, 'Move option 3 down').disabled).toBe(true);
    } finally { m.unmount(); }
  });

  it('removes an option, and the remaining ones keep their order', async () => {
    const m = await builderWith('Checkbox');
    try {
      await click(buttonStartingWith(m.container, 'Add option'));
      await click(buttonStartingWith(m.container, 'Add option'));
      await typeInto(optionInputs(m.container)[0], 'Saturday');
      await typeInto(optionInputs(m.container)[1], 'Sunday');
      await typeInto(optionInputs(m.container)[2], 'Midweek');

      await click(controlLabelled(m.container, 'Remove option 2'));
      expect(optionValues(m.container)).toEqual(['Saturday', 'Midweek']);
    } finally { m.unmount(); }
  });

  it('keeps an option blank while it is being typed, and drops blanks only on save', async () => {
    // 🔴 This is the defect, inverted. The old editor cleaned on every keystroke
    // and that cleaning is what made an option impossible to add: the empty
    // in-progress value IS a legitimate editing state.
    const m = await builderWith('Dropdown');
    try {
      await click(buttonStartingWith(m.container, 'Add option'));
      await typeInto(optionInputs(m.container)[1], '');
      expect(optionValues(m.container), 'an emptied option row vanished mid-edit').toEqual(['Option 1', '']);

      await typeInto(optionInputs(m.container)[1], '  Kids  ');
      await save(m.container);
      const saved = writes.at(-1)!.payload.fields as { options?: string[] }[];
      expect(saved[0].options).toEqual(['Option 1', 'Kids']);
    } finally { m.unmount(); }
  });

  it('never seeds a duplicate option label, because duplicate TEXT is a duplicate answer key', () => {
    expect(nextOptionLabel([])).toBe('Option 1');
    expect(nextOptionLabel(['Option 1'])).toBe('Option 2');
    // Add three, delete the middle one, add again: the naive `length + 1` would
    // hand back "Option 3", which already exists.
    expect(nextOptionLabel(['Option 1', 'Option 3'])).toBe('Option 4');
    expect(nextOptionLabel(['Option 1', 'Option 2', 'Option 4'])).toBe('Option 5');
    expect(nextOptionLabel(['Option 3', 'Option 4'])).toBe('Option 5');
  });

  it('edits options on a form that ALREADY EXISTS, not only at creation', async () => {
    // The fourth reading of "cannot add more" — options frozen after creation.
    // It was not the bug, and this pins that it stays not the bug.
    STORE['tenants/t1/forms'] = [{
      id: 'f1',
      data: {
        title: 'Volunteer Sign-Up', description: '', active: true, submissionCount: 12, createdAt: null, createdBy: 'u',
        fields: [{ id: 'q_team', type: 'dropdown', label: 'Which team', options: ['Worship', 'Kids'], order: 0 }],
      },
    }];
    const m = await mountScreen(<AdminForms />);
    try {
      await editStoredForm(m.container);
      expect(optionValues(m.container), 'an existing form did not open with its stored options').toEqual(['Worship', 'Kids']);
      await click(buttonStartingWith(m.container, 'Add option'));
      expect(optionValues(m.container)).toEqual(['Worship', 'Kids', 'Option 3']);
    } finally { m.unmount(); }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   3. RENAMING AND PAST ANSWERS.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('renaming an option does not orphan existing submissions', () => {
  const FIELD = (options: string[]): AnswerField =>
    ({ id: 'q_team', type: 'dropdown', label: 'Which team', options, order: 0 });
  const SUBS = Array.from({ length: 30 }, (_, i) => ({
    id: `s${i}`, submittedAt: null, answers: { q_team: i < 18 ? 'Worship' : 'Kids' },
  }));

  it('keeps every past answer counted after a rename, under its original wording', () => {
    const before = summariseField(FIELD(['Worship', 'Kids']), SUBS);
    const after = summariseField(FIELD(['Worship & Production', 'Kids']), SUBS);
    if (before.kind !== 'choice' || after.kind !== 'choice') throw new Error('not a choice question');

    // Nothing is dropped: the same 30 people answered, before and after.
    expect(before.answered).toBe(30);
    expect(after.answered).toBe(30);
    const total = (s: typeof after) => s.options.reduce((n, o) => n + o.count, 0);
    expect(total(after)).toBe(total(before));

    // The 18 who chose "Worship" still read as 18, under the wording they gave.
    const worship = after.options.find((o) => o.label === 'Worship')!;
    expect(worship.count).toBe(18);
    // ⚠️ And it is MARKED, not hidden — THE-298's `unlisted` is exactly this case.
    expect(worship.unlisted).toBe(true);
    // The new wording starts from zero, which is the honest reading.
    expect(after.options.find((o) => o.label === 'Worship & Production')!.count).toBe(0);
  });

  it('keeps every past answer counted after an option is REMOVED', () => {
    const after = summariseField(FIELD(['Kids']), SUBS);
    if (after.kind !== 'choice') throw new Error('not a choice question');
    expect(after.answered).toBe(30);
    expect(after.options.find((o) => o.label === 'Worship')).toMatchObject({ count: 18, unlisted: true });
  });

  it('states that on the screen where the rename happens, whenever the form has responses', async () => {
    STORE['tenants/t1/forms'] = [{
      id: 'f1',
      data: {
        title: 'Volunteer Sign-Up', description: '', active: true, submissionCount: 12, createdAt: null, createdBy: 'u',
        fields: [{ id: 'q_team', type: 'dropdown', label: 'Which team', options: ['Worship'], order: 0 }],
      },
    }];
    const m = await mountScreen(<AdminForms />);
    try {
      await editStoredForm(m.container);
      const text = (m.container.textContent ?? '').replace(/\s+/g, ' ');
      expect(text, 'the rename consequence is not stated on a form that has responses')
        .toContain('Renaming or removing an option never changes an answer someone already gave');
      expect(text).toContain('12 responses');
    } finally { m.unmount(); }
  });

  it('does not state it on a NEW form, where there is nothing to warn about', async () => {
    const m = await builderWith('Dropdown');
    try {
      expect((m.container.textContent ?? '')).not.toContain('Renaming or removing an option');
    } finally { m.unmount(); }
  });

  it('writes nothing to any submission — the builder saves the FORM and only the form', async () => {
    const m = await builderWith('Dropdown');
    try {
      await click(buttonStartingWith(m.container, 'Add option'));
      await typeInto(optionInputs(m.container)[0], 'Renamed');
      await save(m.container);
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) {
        expect(w.path, `the builder wrote to ${w.path}`).not.toContain('submissions');
        expect(w.path).toMatch(/^tenants\/t1\/forms/);
      }
    } finally { m.unmount(); }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   4. THE CAP.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('if a cap exists it is stated, never silent', () => {
  it('prints the count against the cap at ALL times, not only on approach', async () => {
    const m = await builderWith('Dropdown');
    try {
      const text = () => (m.container.textContent ?? '').replace(/\s+/g, ' ');
      expect(text(), 'the cap is invisible at one option').toContain(`1 of ${MAX_FIELD_OPTIONS} options`);
      await click(buttonStartingWith(m.container, 'Add option'));
      expect(text()).toContain(`2 of ${MAX_FIELD_OPTIONS} options`);
    } finally { m.unmount(); }
  });

  it('disables the add control AT the cap and says why, rather than no-opping', async () => {
    STORE['tenants/t1/forms'] = [{
      id: 'f1',
      data: {
        title: 'Big', description: '', active: true, submissionCount: 0, createdAt: null, createdBy: 'u',
        fields: [{
          id: 'q', type: 'dropdown', label: 'Pick', order: 0,
          options: Array.from({ length: MAX_FIELD_OPTIONS }, (_, i) => `Option ${i + 1}`),
        }],
      },
    }];
    const m = await mountScreen(<AdminForms />);
    try {
      await editStoredForm(m.container);
      expect(optionInputs(m.container).length).toBe(MAX_FIELD_OPTIONS);
      const add = buttonStartingWith(m.container, 'Add option');
      expect(add.disabled, 'the add control is live at the cap and silently no-ops').toBe(true);

      const text = (m.container.textContent ?? '').replace(/\s+/g, ' ');
      expect(text, 'the cap binds without saying so')
        .toContain(`This field is at the ${MAX_FIELD_OPTIONS}-option limit. Remove an option to add another.`);
      expect(text).toContain(`${MAX_FIELD_OPTIONS} of ${MAX_FIELD_OPTIONS} options`);

      // Clicking it changes nothing — the cap holds at the operation too.
      await click(add);
      expect(optionInputs(m.container).length).toBe(MAX_FIELD_OPTIONS);
    } finally { m.unmount(); }
  });

  it('states the cap with ONE number, so the message and the limit cannot drift apart', () => {
    expect(MAX_FIELD_OPTIONS).toBe(100);
    const code = readRepo('src/components/AdminForms.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('export const MAX_FIELD_OPTIONS = 100;');
    // 🔴 Both the guard and both messages read the CONSTANT. A cap whose stated
    // number is a separate literal is exactly how a stated cap becomes a silent
    // one — the limit moves and the sentence does not.
    expect(code).toContain('>= MAX_FIELD_OPTIONS');
    expect(code).toContain('{(f.options || []).length} of {MAX_FIELD_OPTIONS} options');
    expect(code).toContain('This field is at the {MAX_FIELD_OPTIONS}-option limit.');
    // And no message spells the number itself.
    expect(code).not.toMatch(/(?:of|at the)\s+100[\s-]/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   5-8. NO-REGRESSION. The write path, the answers view, the CSV, the rules.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the stored fields shape is unchanged, so a live form still loads and submits', () => {
  const LIVE_FORM = {
    title: 'Volunteer Sign-Up', description: 'Serve with us', active: true, submissionCount: 41,
    createdAt: null, createdBy: 'u',
    fields: [
      { id: 'q_name', type: 'short_text', label: 'Full name', placeholder: 'Your name', required: true, order: 0 },
      { id: 'q_team', type: 'dropdown', label: 'Which team', options: ['Worship', 'Kids'], required: false, order: 1 },
    ],
  };

  it('an existing form still loads, and round-trips through the builder unchanged', async () => {
    STORE['tenants/t1/forms'] = [{ id: 'f1', data: LIVE_FORM }];
    const m = await mountScreen(<AdminForms />);
    try {
      await editStoredForm(m.container);
      expect(optionValues(m.container)).toEqual(['Worship', 'Kids']);
      await save(m.container);

      const saved = writes.at(-1)!.payload.fields as Record<string, unknown>[];
      // 🔴 Byte-for-byte the same fields, saved without editing anything. A
      // church with a live form must not lose it, and must not have it rewritten.
      expect(saved).toEqual(LIVE_FORM.fields);
      // And the keys are the same set — no key added, none dropped.
      expect(Object.keys(saved[1]).sort()).toEqual(['id', 'label', 'options', 'order', 'required', 'type']);
    } finally { m.unmount(); }
  });

  it('stores options as a plain string[], and stores no options key on a non-choice field', async () => {
    const m = await builderWith('Short Text');
    try {
      await save(m.container);
      const saved = writes.at(-1)!.payload.fields as Record<string, unknown>[];
      expect('options' in saved[0], 'a short_text field gained an options key').toBe(false);
    } finally { m.unmount(); }

    const m2 = await builderWith('Radio');
    try {
      await save(m2.container);
      const saved = writes.at(-1)!.payload.fields as Record<string, unknown>[];
      expect(Array.isArray(saved[0].options)).toBe(true);
      for (const o of saved[0].options as unknown[]) expect(typeof o).toBe('string');
    } finally { m2.unmount(); }
  });
});

describe('nothing outside the builder moved', () => {
  it('api/forms/submit is byte-identical', () => {
    expect(sha256(readRepo('src/app/api/forms/submit/route.ts')))
      .toBe('5322a5cf3c9aee481833e6a33d33a060aa32db403341b1747a86fde64cddb9cc');
  });

  it('api/forms/get is byte-identical, so a live form still renders publicly', () => {
    expect(sha256(readRepo('src/app/api/forms/get/route.ts')))
      .toBe('8e8ad1d36349725c7219f1c45c7e2f4e103e07e05bcfe70e3c6a2c5de98de2cc');
  });

  it('firestore.rules and functions/ are byte-identical', () => {
    expect(sha256(readRepo('firestore.rules')))
      .toBe('a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499');
    // Every file under functions/, hashed by path — a tree digest, so an added
    // or removed file fails as loudly as an edited one.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      if (n === 'node_modules' || n === '.git') return [];
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const root = path.join(REPO_ROOT, 'functions');
    const tree = walk(root).sort()
      .map((p) => `${path.relative(root, p)}\t${sha256(readFileSync(p, 'utf8'))}`).join('\n');
    expect(sha256(tree)).toBe('868ee83fd658b4e3eb9a479fe6663bcee1b84abe12b3029aaf427a67b1108cd3');
  });

  it("THE-298's per-question answers view still keys correctly to the fields", () => {
    // The keying is `submissions[i].answers[field.id]`. The builder does not
    // touch field ids, and this asserts the whole path end to end rather than
    // the absence of a change.
    const fields: AnswerField[] = [
      { id: 'q_name', type: 'short_text', label: 'Full name', order: 0 },
      { id: 'q_team', type: 'dropdown', label: 'Which team', options: ['Worship', 'Kids'], order: 1 },
      { id: 'q_days', type: 'checkbox', label: 'Which days', options: ['Sat', 'Sun'], order: 2 },
    ];
    const subs = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, submittedAt: null,
      answers: { q_name: `P${i}`, q_team: i < 6 ? 'Worship' : 'Kids', q_days: i % 2 ? ['Sat', 'Sun'] : ['Sat'] },
    }));
    const out = summariseForm(fields, subs);
    expect(out.map((s) => s.field.id)).toEqual(['q_name', 'q_team', 'q_days']);
    expect(out.map((s) => s.kind)).toEqual(['list', 'choice', 'choice']);
    const team = out[1];
    if (team.kind !== 'choice') throw new Error('q_team stopped being a choice question');
    expect(team.options.map((o) => [o.label, o.count])).toEqual([['Worship', 6], ['Kids', 4]]);
    expect(team.options.every((o) => !o.unlisted)).toBe(true);
    const days = out[2];
    if (days.kind !== 'choice') throw new Error('q_days stopped being a choice question');
    expect(days.answered).toBe(10);
    expect(days.options.map((o) => [o.label, o.count])).toEqual([['Sat', 10], ['Sun', 5]]);
  });

  it("the CSV export's columns are unchanged, pinned as TEXT", () => {
    const code = readRepo('src/components/AdminForms.tsx');
    const start = code.indexOf('const exportCsv = () => {');
    expect(start, 'exportCsv was renamed or removed').toBeGreaterThan(-1);
    const end = code.indexOf('\n  };', start);
    const body = code.slice(start, end + 5);
    // ⚠️ Pinned as the TEXT of the function, per THE-298 — a church may already
    // depend on the shape, so a digest that says "something changed" is not
    // enough; the columns themselves are the thing being fixed in place.
    expect(body).toBe(`const exportCsv = () => {
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
      .map(r => r.map(cell => \`"\${String(cell).replace(/"/g, '""')}"\`).join(','))
      .join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`\${selectedForm.title.replace(/[^a-z0-9]/gi, '_')}_submissions.csv\`;
    a.click();
    URL.revokeObjectURL(url);
  };`);
  });
});
