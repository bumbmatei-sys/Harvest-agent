import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AnswerField, AnswerSubmission } from '../forms/form-answers';

/**
 * THE-298 — "Of a form I created, I should have a button to see straight from
 * that form all answers in the style of Google Forms answers."
 *
 * ─── What was already there, before this ticket ──────────────────────────────
 *
 * AdminForms.tsx already had a submissions surface and a CSV export, so the gap
 * was never the whole view. Tapping a form's title opened a TABLE — one row per
 * submission, one column per field, plus Submitted and CRM columns — with an
 * Export CSV button above it. That is the per-ROW half, and it worked.
 *
 * Google Forms' answers view is the other half: PER QUESTION, each with its own
 * aggregate. That is what did not exist, and it is all this ticket adds. The
 * table and the CSV are not rebuilt; the CSV's body is pinned byte-for-byte
 * below precisely because a church may already depend on its shape.
 *
 * ─── The read is where it went wrong ─────────────────────────────────────────
 *
 * 🔴 The one thing this ticket CHANGES about the existing surface is its read.
 * It was `orderBy('submittedAt','desc') + limit(1000)`, and the screen printed
 * `submissions.length` as its response count and exported those rows as its
 * CSV — so a form past 1000 responses showed "1000 submissions" and exported
 * 1000 of them, with nothing on screen saying so. A per-question count over
 * that slice would have inherited the same defect, which is why the read is
 * fixed rather than a second read being added beside it.
 */

/* ═════════════════════════════════════════════════════════════════════════════
   An in-memory Firestore that HONOURS the query, so a paging bug can fail.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Doc { id: string; data: Record<string, unknown> }

/** collection path → its documents. */
const STORE: Record<string, Doc[]> = {};
/** Every read this suite let through, so the query SHAPE is assertable. */
const issued: { path: string; kind: 'count' | 'docs'; constraints: unknown[] }[] = [];

const pathOf = (x: unknown) => (x as { __path?: string })?.__path ?? '';

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('firebase/firestore', () => {
  const collection = (_d: unknown, ...s: string[]) => ({ __path: s.join('/') });
  return {
    collection,
    doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
    query: (base: unknown, ...cs: unknown[]) => ({ __path: pathOf(base), __cs: cs }),
    where: (...a: unknown[]) => ({ __t: 'where', a }),
    orderBy: (...a: unknown[]) => ({ __t: 'orderBy', a }),
    limit: (n: number) => ({ __t: 'limit', n }),
    startAfter: (d: unknown) => ({ __t: 'startAfter', d }),
    documentId: () => '__name__',
    getCountFromServer: async (q: unknown) => {
      const p = pathOf(q);
      issued.push({ path: p, kind: 'count', constraints: (q as { __cs?: unknown[] })?.__cs ?? [] });
      return { data: () => ({ count: (STORE[p] ?? []).length }) };
    },
    /**
     * 🔴 This HONOURS orderBy/startAfter/limit rather than returning everything.
     * A fake that ignored them would make a broken pager pass — the exact way a
     * truncation stays invisible.
     */
    getDocs: async (q: unknown) => {
      const p = pathOf(q);
      const cs = ((q as { __cs?: unknown[] })?.__cs ?? []) as { __t: string; a?: unknown[]; n?: number; d?: Doc }[];
      issued.push({ path: p, kind: 'docs', constraints: cs });
      const order = cs.find((c) => c.__t === 'orderBy');
      if (!order || order.a?.[0] !== '__name__') {
        throw new Error(`this fake only serves orderBy(documentId()); got ${JSON.stringify(order)}`);
      }
      let rows = [...(STORE[p] ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const after = cs.find((c) => c.__t === 'startAfter')?.d;
      if (after) rows = rows.filter((r) => r.id > (after as Doc).id);
      const cap = cs.find((c) => c.__t === 'limit')?.n;
      if (typeof cap === 'number') rows = rows.slice(0, cap);
      const docs = rows.map((r) => ({ id: r.id, data: () => r.data }));
      return { docs, size: docs.length, forEach: (f: never) => docs.forEach(f) };
    },
    onSnapshot: (q: unknown, cb: unknown) => {
      const docs = (STORE[pathOf(q)] ?? []).map((r) => ({ id: r.id, data: () => r.data }));
      if (typeof cb === 'function') (cb as (s: unknown) => void)({ docs, size: docs.length });
      return () => {};
    },
    getDoc: async () => ({ exists: () => true, data: () => ({}) }),
    addDoc: async () => ({ id: 'x' }),
    updateDoc: async () => {},
    deleteDoc: async () => {},
    setDoc: async () => {},
    serverTimestamp: () => null,
    Timestamp: class {},
    increment: (n: number) => n,
    arrayUnion: (...a: unknown[]) => a,
    arrayRemove: (...a: unknown[]) => a,
    writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }),
  };
});

let STORE_TENANT = 't1';
let STORE_SUPER = false;
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      currentTenantId: STORE_TENANT as string | null,
      isAuthReady: true,
      isSuperAdmin: STORE_SUPER,
      currentTenant: { id: STORE_TENANT },
    };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'platform', getTenantId: async () => 't1', getTenantIdFromHost: () => 't1',
  isPlatformContext: () => false, hasPlatformOverride: () => false,
  getTenantScope: async () => null, getWriteTenantScope: async () => 't1',
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mountScreen, click, settle } = await import('../../test/support/ministry-screens');
const AdminForms = (await import('../AdminForms')).default;
const {
  summariseForm, summariseField, readAllSubmissions, assertFormScope,
  SUBMISSIONS_PAGE_SIZE, SUBMISSIONS_FETCH_CEILING, TREATMENT, PRIVATE_TYPES,
  FIELD_TYPES_WITH_ANSWERS,
} = await import('../forms/form-answers');
const { LIST_RENDER_LIMIT } = await import('../forms/FormAnswersView');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const readRepo = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Source with its comments removed.
 *
 * ⚠️ Every "the code does not spell X" assertion below reads THIS and not the
 * raw file, and the first cut of this suite proved why: the notes in these
 * files quote the query they replaced (`orderBy('submittedAt'…`), cite PRs by
 * number (`#405`, which is a `#` and three hex digits), and use the repo's
 * 🔴/⚠️ annotation marks. All three are prose about the change, and matching
 * them turns a guard into a rule against explaining yourself.
 */
const codeOf = (rel: string) => readRepo(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([^:'"\`\\])\/\/.*$/gm, '$1');

/* ═════════════════════════════════════════════════════════════════════════════
   The form under test — one field of every type the builder can create.
   ═══════════════════════════════════════════════════════════════════════════ */

const FIELDS: AnswerField[] = [
  { id: 'q_name', type: 'short_text', label: 'Full name', order: 0 },
  { id: 'q_story', type: 'long_text', label: 'Tell us about yourself', order: 1 },
  { id: 'q_email', type: 'email', label: 'Email address', order: 2 },
  { id: 'q_phone', type: 'phone', label: 'Mobile number', order: 3 },
  { id: 'q_guests', type: 'number', label: 'How many guests', order: 4 },
  { id: 'q_team', type: 'dropdown', label: 'Which team', options: ['Worship', 'Kids', 'Hospitality'], order: 5 },
  { id: 'q_first', type: 'radio', label: 'Is this your first time', options: ['Yes', 'No'], order: 6 },
  { id: 'q_days', type: 'checkbox', label: 'Which days can you serve', options: ['Saturday', 'Sunday', 'Midweek'], order: 7 },
  { id: 'q_start', type: 'date', label: 'Available from', order: 8 },
];

const FORM_DOC = {
  title: 'Volunteer Sign-Up',
  description: 'Tell us where you would like to serve.',
  fields: FIELDS,
  active: true,
  submissionCount: 0,
  createdAt: null,
  createdBy: 'u',
};

/**
 * 🔴 THE FIXTURE SIZE, AND WHY.
 *
 * 1,203 submissions. `SUBMISSIONS_PAGE_SIZE` is 500, so this is THREE pages and
 * the last one is short — which exercises the paging exit AND an off-by-one at
 * a page boundary. A 5-row fixture would have proved nothing: it fits in one
 * page, so a pager that never advanced its cursor would pass it.
 *
 * ⚠️ It is also HOSTILE by construction. `q_team` is 'Hospitality' only on ids
 * from s0700 up, and `q_days` includes 'Midweek' only from s1000 up. Documents
 * page in `__name__` order and these ids sort lexically, so a read that stopped
 * at 500 — or at 1000 — would report ZERO for those options and a tidy,
 * plausible-looking chart for the rest. That is exactly the defect #405 named:
 * a count over an arbitrary slice that LOOKS right.
 */
const N = 1203;
const id = (i: number) => `s${String(i).padStart(4, '0')}`;

const ts = (i: number) => ({
  toMillis: () => 1_700_000_000_000 + i * 1000,
  toDate: () => new Date(1_700_000_000_000 + i * 1000),
});

const submissionAt = (i: number): Doc => ({
  id: id(i),
  data: {
    submittedAt: ts(i),
    crmContactId: i % 3 === 0 ? `c${i}` : null,
    answers: {
      q_name: `Person ${i}`,
      // Deliberately blank on some rows: "answered" must be the number of people
      // who answered THIS question, not the number of submissions.
      q_story: i % 4 === 0 ? '' : `A story about number ${i}.`,
      q_email: `person${i}@example.com`,
      q_phone: `+1555000${i}`,
      q_guests: String(i % 5),
      q_team: i >= 700 ? 'Hospitality' : (i % 2 === 0 ? 'Worship' : 'Kids'),
      q_first: i % 2 === 0 ? 'Yes' : 'No',
      q_days: i >= 1000 ? ['Saturday', 'Midweek'] : (i % 2 === 0 ? ['Saturday'] : ['Saturday', 'Sunday']),
      q_start: `2026-0${(i % 9) + 1}-01`,
    },
  },
});

const SUBS_PATH = 'tenants/t1/forms/f1/submissions';

function seed(count: number) {
  for (const k of Object.keys(STORE)) delete STORE[k];
  STORE['tenants/t1/forms'] = [{ id: 'f1', data: FORM_DOC as unknown as Record<string, unknown> }];
  STORE[SUBS_PATH] = Array.from({ length: count }, (_, i) => submissionAt(i));
}

/** The submissions as the pure summariser wants them. */
const asRows = (count: number): AnswerSubmission[] =>
  Array.from({ length: count }, (_, i) => {
    const d = submissionAt(i);
    return { id: d.id, ...(d.data as object) } as AnswerSubmission;
  });

const open: { unmount: () => void }[] = [];
beforeEach(() => { issued.length = 0; STORE_TENANT = 't1'; STORE_SUPER = false; seed(N); });
afterEach(() => { while (open.length) open.pop()!.unmount(); });

async function mountForms() {
  const m = await mountScreen(<AdminForms />);
  open.push(m);
  return m.container;
}

const buttonTitled = (c: ParentNode, title: string) =>
  c.querySelector<HTMLButtonElement>(`button[title="${title}"]`);

/* ═════════════════════════════════════════════════════════════════════════════
   1. The whole ticket — a button, on a form, that opens its answers.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a button on a created form opens its answers view', () => {
  it('offers an Answers control on the form card and opens the per-question view', async () => {
    const c = await mountForms();
    expect(c.querySelector('[data-answers-view]'), 'the answers view is open before anything was clicked').toBeNull();

    const button = buttonTitled(c, 'Answers');
    expect(button, 'the form card offers no Answers button').toBeTruthy();

    await click(button!);
    await settle();

    expect(c.querySelector('[data-answers-view]'), 'the Answers button opened nothing').toBeTruthy();
  });

  it('offers the same control on the desktop card, by its visible label', async () => {
    const c = await mountForms();
    const labelled = Array.from(c.querySelectorAll('button'))
      .filter((b) => (b.textContent ?? '').trim() === 'Answers');
    expect(labelled.length, 'the desktop card offers no Answers button').toBe(1);
    await click(labelled[0]);
    await settle();
    expect(c.querySelector('[data-answers-view]')).toBeTruthy();
  });

  it('leaves the existing responses table reachable and open to it', async () => {
    // 🔴 The per-row surface is NOT replaced. Google Forms pairs the summary
    // with a way through the individual responses, and this screen already had
    // that; the summary links to it rather than rebuilding it.
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const toTable = Array.from(c.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === 'All responses');
    expect(toTable, 'the summary offers no route to the responses table').toBeTruthy();
    await click(toTable!);
    await settle();
    expect(c.querySelector('table'), 'the responses table did not open').toBeTruthy();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   2. Per question, keyed to the form's own fields — not a flat table.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('each question renders its own aggregate, keyed to the form’s fields', () => {
  it('renders one card per field, in the form’s order, and no table', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();

    const cards = Array.from(c.querySelectorAll('[data-question]'));
    expect(cards.map((el) => el.getAttribute('data-question')))
      .toEqual([...FIELDS].sort((a, b) => a.order - b.order).map((f) => f.id));

    // 🔴 The mutation this is the guard for: rendering the flat table instead.
    expect(c.querySelector('[data-answers-view] table'), 'the answers view rendered a table').toBeNull();
    for (const f of FIELDS) {
      const card = c.querySelector(`[data-question="${f.id}"]`);
      expect(card?.textContent, `${f.id} does not carry its own label`).toContain(f.label);
    }
  });

  it('gives every field type a recorded treatment, and covers the type union exhaustively', () => {
    // The builder's own list, read from the screen rather than retyped, so a
    // tenth type added there fails HERE rather than rendering with no aggregate.
    const declared = [...readRepo('src/components/AdminForms.tsx')
      .match(/type FieldType = ([^;]+);/)![1]
      .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...FIELD_TYPES_WITH_ANSWERS].sort());
    for (const t of declared) expect(TREATMENT[t as keyof typeof TREATMENT], `${t} has no treatment`).toBeTruthy();
    // ⚠️ Reported rather than assumed: this schema has NO rating or scale type.
    expect(declared).not.toContain('rating');
    expect(declared).not.toContain('scale');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   3. Choice and checkbox — counts per option.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('choice and checkbox questions show counts per option', () => {
  const rows = () => asRows(N);

  it('counts a single-choice question once per response', () => {
    const s = summariseField(FIELDS.find((f) => f.id === 'q_team')!, rows());
    expect(s.kind).toBe('choice');
    if (s.kind !== 'choice') throw new Error('unreachable');
    const by = Object.fromEntries(s.options.map((o) => [o.label, o.count]));
    // 700..1202 inclusive is 503; the rest split even/odd across the first 700.
    expect(by).toEqual({ Hospitality: 503, Worship: 350, Kids: 350 });
    expect(s.options.reduce((n, o) => n + o.count, 0)).toBe(N);
    expect(s.answered).toBe(N);
  });

  it('counts ONE checkbox response toward several options', () => {
    const s = summariseField(FIELDS.find((f) => f.id === 'q_days')!, rows());
    if (s.kind !== 'choice') throw new Error('expected a choice summary');
    const by = Object.fromEntries(s.options.map((o) => [o.label, o.count]));
    expect(by.Saturday).toBe(N);            // every response ticks it
    expect(by.Midweek).toBe(203);           // ids s1000..s1202
    expect(by.Sunday).toBe(500);            // odd ids below 1000
    // 🔴 The multi-select property, stated: the counts sum PAST the number of
    // people, and the denominator is people.
    expect(s.options.reduce((n, o) => n + o.count, 0)).toBeGreaterThan(s.answered);
    expect(s.answered).toBe(N);
    expect(Math.round(by.Midweek / s.answered * 100)).toBe(17);
  });

  it('renders a bar and a written count for every option, so nothing is conveyed by the bar alone', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const card = c.querySelector('[data-question="q_days"]')!;
    expect(card.getAttribute('data-question-kind')).toBe('choice');
    const options = Array.from(card.querySelectorAll('[data-option]'));
    expect(options.map((o) => o.getAttribute('data-option'))).toEqual(['Saturday', 'Sunday', 'Midweek']);
    for (const o of options) {
      expect(o.querySelector('[data-option-bar]'), 'an option has no bar').toBeTruthy();
      expect(o.querySelector('[data-option-count]')?.textContent, 'an option has no written count').toMatch(/\d+ · \d+%/);
    }
    expect(card.textContent).toContain('203');
  });

  it('keeps an answer whose option the form no longer offers, marked rather than dropped', () => {
    const field: AnswerField = { id: 'q', type: 'radio', label: 'Q', options: ['Yes'], order: 0 };
    const s = summariseField(field, [
      { id: 'a', answers: { q: 'Yes' }, submittedAt: null },
      { id: 'b', answers: { q: 'Maybe' }, submittedAt: null },
    ]);
    if (s.kind !== 'choice') throw new Error('expected a choice summary');
    expect(s.options.map((o) => [o.label, o.count, o.unlisted]))
      .toEqual([['Yes', 1, false], ['Maybe', 1, true]]);
    expect(s.answered, 'a dropped row would make the total disagree with the read').toBe(2);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   4 & 5. Free text lists; nothing fabricated.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('free-text questions show a list, not a chart', () => {
  it('lists every free-text answer and draws no bar for it', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const card = c.querySelector('[data-question="q_story"]')!;
    expect(card.getAttribute('data-question-kind')).toBe('list');
    expect(card.querySelector('[data-answer-list]'), 'the free-text question rendered no list').toBeTruthy();
    expect(card.querySelectorAll('[data-option-bar]').length, 'a bar was drawn for free text').toBe(0);
    expect(card.querySelectorAll('svg.recharts-surface').length).toBe(0);
    // Blank stories are not answers: 1203 minus every fourth row.
    const s = summariseField(FIELDS.find((f) => f.id === 'q_story')!, asRows(N));
    if (s.kind !== 'list') throw new Error('expected a list summary');
    expect(s.answered).toBe(N - Math.ceil(N / 4));
    // The COUNT above the list is complete; what the browser is asked to lay
    // out is capped — and the card says so rather than trailing off.
    expect(card.querySelector('[data-question-answered]')?.textContent).toContain(String(s.answered));
    expect(card.querySelectorAll('[data-answer]').length).toBe(LIST_RENDER_LIMIT);
    const cap = card.querySelector('[data-list-render-cap]');
    expect(cap, 'the list trailed off with nothing saying so').toBeTruthy();
    expect(cap!.textContent).toContain('200');
    expect(cap!.textContent).toContain(s.values.length.toLocaleString());
  });

  it('renders every answer, uncapped, when the list is short enough to', async () => {
    // 🔴 So the cap is a CAP and not the list's normal behaviour: a form under
    // it renders all of its answers.
    seed(12);
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const card = c.querySelector('[data-question="q_story"]')!;
    const s = summariseField(FIELDS.find((f) => f.id === 'q_story')!, asRows(12));
    if (s.kind !== 'list') throw new Error('expected a list summary');
    expect(s.values.length).toBeLessThan(LIST_RENDER_LIMIT);
    expect(card.querySelectorAll('[data-answer]').length).toBe(s.values.length);
    expect(card.querySelector('[data-list-render-cap]'), 'a short list claimed to be capped').toBeNull();
  });
});

describe('no aggregate is fabricated for a field type that has none', () => {
  it('lists number and date answers rather than inventing a mean or a histogram', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    for (const fieldId of ['q_guests', 'q_start']) {
      const card = c.querySelector(`[data-question="${fieldId}"]`)!;
      expect(card.getAttribute('data-question-kind'), `${fieldId} was given an aggregate`).toBe('list');
      expect(card.querySelectorAll('[data-option-bar]').length, `${fieldId} drew a bar`).toBe(0);
      expect(card.querySelector('[data-answer-list]'), `${fieldId} rendered no list`).toBeTruthy();
    }
  });

  it('COUNTS an email or phone question and neither charts nor lists it', async () => {
    // 🔴 The PII decision, asserted. Every address is distinct, so a "top
    // answers" chart of them is not an aggregate — it is the respondent list
    // wearing a chart. A summary is also the screen most likely to be shown to
    // a room. The values are unchanged in the responses table and the CSV.
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    for (const fieldId of ['q_email', 'q_phone']) {
      const card = c.querySelector(`[data-question="${fieldId}"]`)!;
      expect(card.getAttribute('data-question-kind')).toBe('private');
      expect(card.querySelectorAll('[data-option-bar]').length, `${fieldId} was charted`).toBe(0);
      expect(card.querySelectorAll('[data-answer]').length, `${fieldId} was listed`).toBe(0);
      expect(card.querySelector('[data-private-note]'), `${fieldId} does not say why`).toBeTruthy();
      // The COUNT is still there — that figure is real and useful.
      expect(card.querySelector('[data-question-answered]')?.textContent).toContain(String(N));
    }
    expect(c.querySelector('[data-answers-view]')!.textContent)
      .not.toContain('person5@example.com');
  });

  it('names the private types, so the decision is a list and not a scattered condition', () => {
    expect([...PRIVATE_TYPES].sort()).toEqual(['email', 'phone']);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   6. Complete reads.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('counts are computed over a complete read', () => {
  it('pages past every page boundary and returns all 1,203 rows', async () => {
    const read = await readAllSubmissions({} as never, 't1', 'f1');
    expect(N).toBeGreaterThan(SUBMISSIONS_PAGE_SIZE);
    expect(read.total, 'the count is not the exact server aggregation').toBe(N);
    expect(read.rows.length, 'the read stopped short').toBe(N);
    expect(read.truncated).toBe(false);
    expect(new Set(read.rows.map((r) => r.id)).size, 'the cursor repeated a document').toBe(N);
  });

  it('takes the count FIRST, from the server aggregation, not from what it fetched', async () => {
    await readAllSubmissions({} as never, 't1', 'f1');
    expect(issued[0], 'the first read was not the count').toMatchObject({ kind: 'count', path: SUBS_PATH });
    expect(issued.filter((r) => r.kind === 'docs').length).toBe(Math.ceil(N / SUBMISSIONS_PAGE_SIZE));
  });

  it('reports counts over the WHOLE set, not over the first page', async () => {
    // 🔴 The mutation guard. The fixture puts 'Hospitality' only on ids from
    // s0700 and 'Midweek' only from s1000, so a read capped at one page reports
    // zero for both and a tidy chart for the rest.
    const read = await readAllSubmissions({} as never, 't1', 'f1');
    const summaries = summariseForm(FIELDS, read.rows);
    const team = summaries.find((s) => s.field.id === 'q_team')!;
    const days = summaries.find((s) => s.field.id === 'q_days')!;
    if (team.kind !== 'choice' || days.kind !== 'choice') throw new Error('expected choice summaries');
    expect(team.options.find((o) => o.label === 'Hospitality')!.count).toBe(503);
    expect(days.options.find((o) => o.label === 'Midweek')!.count).toBe(203);

    const firstPageOnly = summariseField(FIELDS.find((f) => f.id === 'q_days')!, asRows(SUBMISSIONS_PAGE_SIZE));
    if (firstPageOnly.kind !== 'choice') throw new Error('unreachable');
    expect(firstPageOnly.options.find((o) => o.label === 'Midweek')!.count,
      'the fixture is not hostile — a partial read would score the same').toBe(0);
  });

  it('drives the screen from that complete read', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const scope = c.querySelector('[data-answers-scope]')!.textContent ?? '';
    expect(scope).toContain('1,203');
    expect(scope).toContain('all');
    expect(c.querySelector('[data-truncation-notice]'), 'a complete read claimed to be partial').toBeNull();
    const days = c.querySelector('[data-question="q_days"]')!;
    expect(days.querySelector('[data-option="Midweek"] [data-option-count]')?.textContent).toContain('203');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   7. The ceiling, said out loud.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('if a ceiling is hit, the view says so', () => {
  it('stops at the ceiling and marks the read truncated', async () => {
    seed(SUBMISSIONS_FETCH_CEILING + 250);
    const read = await readAllSubmissions({} as never, 't1', 'f1');
    expect(read.total, 'the headline count is not exact under the ceiling')
      .toBe(SUBMISSIONS_FETCH_CEILING + 250);
    expect(read.rows.length).toBe(SUBMISSIONS_FETCH_CEILING);
    expect(read.truncated).toBe(true);
  }, 30_000);

  it('renders the notice and states BOTH numbers, so no figure reads as a total', async () => {
    seed(SUBMISSIONS_FETCH_CEILING + 250);
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const notice = c.querySelector('[data-truncation-notice]');
    expect(notice, 'a truncated read rendered no notice').toBeTruthy();
    expect(notice!.textContent).toContain('10,250');
    expect(notice!.textContent).toContain('10,000');
    const scope = c.querySelector('[data-answers-scope]')!.textContent ?? '';
    expect(scope, 'the aggregates still claim to be over everything').toContain('10,000 of 10,250');
  }, 30_000);

  it('says the same thing on the responses table, which reads the same set', async () => {
    seed(SUBMISSIONS_FETCH_CEILING + 250);
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    await click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'All responses')!);
    await settle();
    expect(c.querySelector('[data-table-truncation-notice]'), 'the table hid a truncation the summary declared').toBeTruthy();
  }, 60_000);

  it('keeps the ceiling a whole number of pages, so it can never fire mid-page', () => {
    expect(SUBMISSIONS_FETCH_CEILING % SUBMISSIONS_PAGE_SIZE).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   8. Scope.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the read is scoped to one tenant’s form', () => {
  it('issues every read against that one form’s subcollection and nothing wider', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    const reads = issued.filter((r) => r.path.includes('submissions'));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.path, 'a read reached outside the form').toBe(SUBS_PATH);
    // No collection-group read, and no `where` standing in for the path.
    for (const r of issued) {
      expect(JSON.stringify(r.constraints)).not.toContain('"where"');
    }
  });

  it('REFUSES a null or empty scope — null is not "no tenant", it is every tenant', () => {
    // 🔴 getTenantScope() returns null for a super admin, and on a READ that
    // means no filter at all. assertConcreteScope states this server-side; this
    // is the same check on the client, where firebase-admin cannot be imported.
    for (const bad of [null, undefined, '', '   ', 0, {}]) {
      expect(() => assertFormScope(bad, 'f1'), `tenantId ${JSON.stringify(bad)}`)
        .toThrow(/non-concrete tenantId/);
      expect(() => assertFormScope('t1', bad), `formId ${JSON.stringify(bad)}`)
        .toThrow(/non-concrete formId/);
    }
    expect(assertFormScope('t1', 'f1')).toEqual({ tenantId: 't1', formId: 'f1' });
  });

  it('issues NO submissions read at all when the super admin has no tenant in context', async () => {
    // The screen resolves a super admin to the platform tenant, so the null
    // never reaches a query. Asserted end to end rather than assumed: with no
    // tenant and no super-admin standing, nothing is read.
    STORE_TENANT = null as unknown as string;
    STORE_SUPER = false;
    const c = await mountForms();
    expect(buttonTitled(c, 'Answers'), 'a form card rendered with no tenant').toBeNull();
    expect(issued.filter((r) => r.path.includes('submissions')), 'an unscoped read was issued').toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   9. Ordering — and the mixed-type trap it avoids.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no Firestore orderBy is issued if the timestamp field holds mixed types', () => {
  it('orders only by documentId(), never by submittedAt', async () => {
    await readAllSubmissions({} as never, 't1', 'f1');
    const orders = issued.flatMap((r) => (r.constraints as { __t?: string; a?: unknown[] }[])
      .filter((c) => c?.__t === 'orderBy').map((c) => c.a?.[0]));
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) expect(o, 'the read ordered by a data field').toBe('__name__');
    expect(codeOf('src/components/forms/form-answers.ts')).not.toMatch(/orderBy\(\s*['"]submittedAt/);
    expect(codeOf('src/components/AdminForms.tsx')).not.toMatch(/orderBy\(\s*['"]submittedAt/);
    // And the `limit(1000)` that made the old read arbitrary is gone with it.
    expect(codeOf('src/components/AdminForms.tsx')).not.toMatch(/limit\(1000\)/);
  });

  it('reads completely even when submittedAt is a mix of Timestamps, ISO strings and nulls', async () => {
    // ⚠️ contactActivities.createdAt and invoices.issuedAt both hold Timestamps
    // AND ISO strings elsewhere in this repo, and Firestore orders across types
    // by TYPE first — so a mixed column pages in blocks. /api/forms/submit is
    // the ONLY writer here and it always writes serverTimestamp(), so this
    // collection is single-typed today; ordering by documentId() keeps that a
    // property of the data rather than a dependency of the read.
    STORE[SUBS_PATH] = STORE[SUBS_PATH].map((d, i) => ({
      ...d,
      data: { ...d.data, submittedAt: i % 3 === 0 ? null : i % 3 === 1 ? '2026-01-02T03:04:05Z' : ts(i) },
    }));
    const read = await readAllSubmissions({} as never, 't1', 'f1');
    expect(read.rows.length, 'a mixed timestamp column truncated the read').toBe(N);
    expect(read.truncated).toBe(false);
  });

  it('sorts the finished set in memory, which is only correct because it is complete', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    await click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'All responses')!);
    await settle();
    const first = c.querySelectorAll('tbody tr')[0];
    expect(first?.textContent, 'the table is not newest-first').toContain(`Person ${N - 1}`);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   10 & 11. No regression: the CSV export, and the write path.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The CSV export exactly as it stood at origin/main (133d557), extracted rather
 * than retyped, and stored here as text so a failure shows the real diff. ⚠️ A
 * church may already depend on this shape.
 */
const CSV_EXPORT_AT_MAIN = `  const exportCsv = () => {
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
  };`;

const exportCsvOf = (src: string): string | null => {
  const from = src.indexOf('  const exportCsv');
  if (from < 0) return null;
  const to = src.indexOf('\n  };', from);
  return to < 0 ? null : src.slice(from, to + '\n  };'.length);
};

describe('the existing CSV export’s columns are unchanged', () => {
  it('is byte-identical to the implementation on main', () => {
    expect(exportCsvOf(readRepo('src/components/AdminForms.tsx'))).toBe(CSV_EXPORT_AT_MAIN);
  });

  it('still names Submitted At and then every field, in the form’s order', () => {
    expect(CSV_EXPORT_AT_MAIN).toContain("const header = ['Submitted At', ...cols.map(c => c.label)]");
    expect(CSV_EXPORT_AT_MAIN).toContain('sort((a, b) => a.order - b.order)');
    expect(CSV_EXPORT_AT_MAIN).toContain("Array.isArray(v) ? v.join('; ') : (v ?? '')");
  });

  it('still renders the Export CSV control on the responses table', async () => {
    const c = await mountForms();
    await click(buttonTitled(c, 'Answers')!);
    await settle();
    await click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'All responses')!);
    await settle();
    expect(Array.from(c.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('Export CSV'))).toBe(true);
  });
});

describe('forms/submit’s write path is byte-identical', () => {
  it('is untouched — this ticket reads, it does not write', () => {
    // ⚠️ The route also creates a CRM contact and two contactActivities rows.
    expect(sha256(readRepo('src/app/api/forms/submit/route.ts')))
      .toBe('5322a5cf3c9aee481833e6a33d33a060aa32db403341b1747a86fde64cddb9cc');
  });

  it('still writes the same submission shape the summary reads', () => {
    const src = readRepo('src/app/api/forms/submit/route.ts');
    expect(src).toContain("await formRef.collection('submissions').add({");
    expect(src).toContain('submittedAt: FieldValue.serverTimestamp(),');
    expect(src).toContain("await formRef.set({ submissionCount: FieldValue.increment(1) }, { merge: true });");
  });

  it('is the ONLY writer of that subcollection, which is why it is single-typed', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
        return /\.(ts|tsx)$/.test(e.name) && !p.includes('__tests__') ? [p] : [];
      });
    const writers = walk(path.join(REPO_ROOT, 'src'))
      .filter((f) => /collection\('submissions'\)\s*\.add\(|collection\("submissions"\)\s*\.add\(/.test(readFileSync(f, 'utf8')));
    expect(writers.map((f) => path.relative(REPO_ROOT, f)))
      .toEqual(['src/app/api/forms/submit/route.ts']);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   14 & 15. No emoji, no colour, no index, nothing pinned moved.
   ═══════════════════════════════════════════════════════════════════════════ */

const NEW_FILES = ['src/components/forms/form-answers.ts', 'src/components/forms/FormAnswersView.tsx'];

describe('no emoji, no hardcoded colour; all four palettes resolve', () => {
  it('spells no emoji in any file this ticket adds or edits', () => {
    // The ticket comments themselves use the repo's established 🔴/⚠️/✅
    // annotation marks, so only the RENDERED strings are in scope: every JSX
    // text node and string literal that reaches a screen.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const rel of [...NEW_FILES, 'src/components/AdminForms.tsx']) {
      const code = codeOf(rel);
      expect(emoji.test(code), `${rel} spells an emoji in code`).toBe(false);
    }
  });

  it('hardcodes no colour — every colour is a palette token', () => {
    for (const rel of NEW_FILES) {
      const src = codeOf(rel);
      expect(src, `${rel} spells a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, `${rel} spells rgb()/hsl()`).not.toMatch(/\b(?:rgba?|hsla?)\(/);
      for (const m of src.matchAll(/\btext-\[[^\]]+\]|\bbg-\[[^\]]+\]/g)) {
        // Arbitrary bg/text values are allowed ONLY when they name a CSS
        // variable the palettes define — never a literal colour.
        expect(m[0], `${rel} spells an arbitrary colour ${m[0]}`).toMatch(/var\(--|px\]$/);
      }
    }
  });

  it('spends only tokens the four palettes define, Classic first', () => {
    const css = readRepo('src/app/globals.css');
    // Classic has been the default family since #409; the app also ships the
    // Harvest family, each in light and dark.
    for (const selector of [
      '[data-palette="classic"][data-theme="light"]',
      '[data-palette="classic"][data-theme="dark"]',
    ]) expect(css, `${selector} is gone`).toContain(selector);
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    for (const v of ['--surface-gold', '--surface-sunken', '--surface-raised']) {
      expect(css, `${v} is gone`).toContain(v);
    }
    // Every colour-bearing class the two new files spell, checked against the
    // tailwind config / globals rather than assumed.
    const config = readRepo('tailwind.config.ts');
    for (const token of ['bg-gold', 'text-gold', 'text-strong', 'text-muted', 'text-faint', 'text-body', 'text-danger', 'bg-surface-raised', 'bg-surface-sunken', 'border-line']) {
      const family = token.split('-')[0];
      const name = token.slice(family.length + 1);
      expect(`${config}${css}`, `${token} resolves to nothing`).toContain(name.split('-')[0]);
    }
  });

  it('mints no width, height or gap of its own outside form-layout', () => {
    for (const rel of NEW_FILES) {
      const literals = [...codeOf(rel).matchAll(/sm:(?:max-w|w|h|gap|space-[xy]|p[xytblr]?|m[xytblr]?)-\[[^\]]+\]/g)];
      expect(literals.map((m) => m[0]), `${rel} writes its own sm: size`).toEqual([]);
    }
  });
});

describe('firestore.rules, firestore.indexes.json and functions/ byte-identical', () => {
  // 🔴 firestore.indexes.json does NOT deploy on merge — deploy-rules.yml runs
  // `firestore:rules,storage` and its paths: filter never names the file — so a
  // composite index added there would be inert and the query would throw
  // failed-precondition in production. The read below needs none: it is a
  // subcollection with no `where`, ordered by documentId(), which the automatic
  // single-field index already answers.
  const UNTOUCHED: Record<string, string> = {
    'firestore.rules': 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
    'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
  };

  it.each(Object.entries(UNTOUCHED))('%s carries no edit from this ticket', (file, digest) => {
    expect(sha256(readRepo(file))).toBe(digest);
  });

  it('functions/ is unchanged, file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(REPO_ROOT, p));
      }
    };
    walk(path.join(REPO_ROOT, 'functions'));
    expect(out.sort()).toEqual([
      'functions/.gcloudignore', 'functions/package-lock.json',
      'functions/package.json', 'functions/src/index.ts', 'functions/tsconfig.json',
    ]);
  });

  it('deploy-rules.yml still does not deploy the indexes file, which is why none was added', () => {
    const wf = readRepo('.github/workflows/deploy-rules.yml');
    expect(wf).toContain('firestore:rules,storage');
    expect(wf).not.toContain('firestore:indexes');
  });

  it('adds no dependency — chart/recharts is not adopted here', () => {
    for (const rel of NEW_FILES) {
      expect(codeOf(rel), `${rel} imports recharts`).not.toMatch(/from ['"]recharts['"]/);
      expect(codeOf(rel), `${rel} imports the chart primitive`).not.toMatch(/\/ui\/chart['"]/);
    }
    expect(codeOf('src/components/AdminForms.tsx')).not.toMatch(/\/ui\/chart['"]/);
  });
});
