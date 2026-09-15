import { aggregateScale, isPointAnswered, normaliseAnswer, type ScaleAggregate } from './rating-scale';
import {
  collection, query, orderBy, limit, startAfter, documentId, getDocs, getCountFromServer,
  type Firestore, type Query, type DocumentData, type QueryDocumentSnapshot,
  type QuerySnapshot, type Timestamp,
} from 'firebase/firestore';

/**
 * The per-question answers view — the READ, and the aggregation over it.
 *
 * The founder asked to "see straight from that form all answers in the style of
 * Google Forms answers". Google Forms' answers view is PER QUESTION and not
 * per row: each question carries its own aggregate — a bar per option for a
 * choice question, a list for free text. AdminForms already renders the per-row
 * half (a table, one row per submission, one column per field) and a CSV export
 * of the same shape. Neither is rebuilt here; what was missing is the summary,
 * and this module is it.
 *
 * Everything that decides a NUMBER lives here rather than in the view, because
 * the numbers are the part that can be quietly wrong.
 */

/**
 * The nine field types AdminForms' builder can create. Kept as a value rather
 * than only a type so the treatment table below can be checked exhaustive at
 * runtime — a tenth type added to the builder without a treatment here shows up
 * as a test failure rather than as a question rendered with no aggregate.
 *
 * 🔴 THE-366 added `rating` and `scale`. The note that stood here said a
 * per-question view for either "would be a different aggregate again, and
 * inventing one for a type the builder cannot produce would be fabricating a
 * slot as well as a visualisation." The builder produces both now, so the
 * aggregate is no longer fabricated — it is the one thing these two types have
 * that `number` does not: a DECLARED, FINITE, ORDERED set of points. That is
 * exactly what `number` lacks and why `number` is still a list. See the
 * `'scale'` treatment below.
 */
export const FIELD_TYPES_WITH_ANSWERS = [
  'short_text', 'long_text', 'email', 'phone', 'number',
  'dropdown', 'radio', 'checkbox', 'date', 'rating', 'scale',
] as const;

export type AnswerFieldType = typeof FIELD_TYPES_WITH_ANSWERS[number];

export interface AnswerField {
  id: string;
  type: AnswerFieldType;
  label: string;
  options?: string[];
  order: number;
  /** THE-366 — a `scale`'s run. Absent on every other type. */
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

export interface AnswerSubmission {
  id: string;
  answers: Record<string, unknown>;
  submittedAt: Timestamp | null;
}

/**
 * How each field type is summarised. THREE treatments, and the assignment is
 * the substance of this ticket — a per-question view that gave every type the
 * same treatment would be a table with extra steps.
 *
 *   'choice'  — countable options. dropdown/radio pick one, checkbox picks
 *               several, and that difference is in the COUNTING (below), not in
 *               the treatment: both render a bar per option with its count.
 *   'list'    — no sensible aggregate, so the answers are listed verbatim. Free
 *               text is the obvious case; `number` and `date` are here on
 *               purpose, see the note on {@link summariseField}.
 *   'private' — the field IDENTIFIES the respondent. Counted, never charted and
 *               never listed here. See {@link PRIVATE_TYPES}.
 */
export const TREATMENT: Record<AnswerFieldType, 'choice' | 'list' | 'private' | 'scale'> = {
  short_text: 'list',
  long_text: 'list',
  email: 'private',
  phone: 'private',
  number: 'list',
  dropdown: 'choice',
  radio: 'choice',
  checkbox: 'choice',
  date: 'list',
  // 🔴 THE-366 — a FOURTH treatment, and the reason it is not 'choice' or
  // 'list' is the whole of it. A choice bar chart keys on the answer STRING and
  // would lose the order of the points and the arithmetic; a list would hand an
  // admin 300 numbers to add up by eye. These two carry a declared, finite,
  // ORDERED run, which is precisely what `number` lacks — a mean over "Year you
  // joined" is meaningless, a mean over "1-5, how was the conference" is the
  // question — so they get a distribution over every point plus that mean.
  rating: 'scale',
  scale: 'scale',
};

/**
 * 🔴 The types that identify a person rather than describe an answer.
 *
 * A "top answers" bar chart of email addresses is not an aggregate: every
 * address is distinct, so every bar is 1 and the chart conveys the respondent
 * list and nothing else. It is also the wrong place to put one — a summary is
 * the screen most likely to be shown to a room, screenshotted into a group
 * chat, or left open on a shared laptop, and a column of members' phone numbers
 * has no business being the thing on it.
 *
 * So these two are COUNTED (how many people answered is a real, useful figure)
 * and neither charted nor listed. Nothing is withheld that an admin could not
 * already get: the submissions table and the CSV export both carry the values,
 * unchanged by this ticket, one tap away. What changes is only that the
 * aggregate view stops volunteering them.
 *
 * ⚠️ This is a decision about TYPES, and it is only as good as the type. A
 * "Full name" question is a `short_text` in this schema — there is no `name`
 * type — so it is listed like any other free text. Typing a name field is a
 * change to the BUILDER and to what /api/forms/submit writes, and this ticket
 * reads; it does not touch the write path.
 */
export const PRIVATE_TYPES: ReadonlyArray<AnswerFieldType> =
  FIELD_TYPES_WITH_ANSWERS.filter((t) => TREATMENT[t] === 'private');

/** One option of a choice question, with its share of the people who answered. */
export interface OptionCount {
  label: string;
  count: number;
  /** count / answered, 0-100. 0 when nobody answered — never NaN. */
  percent: number;
  /**
   * True when this row is an answer NOT among the field's declared options —
   * grouped rather than dropped. A church edits a form after it is live, and an
   * option removed from `fields` does not remove the answers already given
   * against it. Dropping them would take rows out of a count that is supposed
   * to be complete.
   */
  unlisted: boolean;
}

export type QuestionSummary =
  | { kind: 'choice'; field: AnswerField; answered: number; options: OptionCount[] }
  | { kind: 'list'; field: AnswerField; answered: number; values: string[] }
  | { kind: 'private'; field: AnswerField; answered: number }
  | { kind: 'scale'; field: AnswerField; answered: number; aggregate: ScaleAggregate };

/** An answer counts as given when it is neither absent nor empty. */
const isAnswered = (v: unknown): boolean => {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim() !== '');
  return String(v).trim() !== '';
};

/** Every value a single answer contributes, as trimmed strings. */
const valuesOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').trim()).filter(Boolean);

/**
 * Summarise ONE question over a set of submissions.
 *
 * ── Why `number` and `date` are lists and not charts ─────────────────────────
 * 🔴 They have no aggregate this module can know is sensible. A mean over a
 * `number` field is meaningful for "How many guests" and meaningless for "Year
 * you joined" or a phone extension typed into a number box, and nothing in the
 * schema distinguishes them — the field carries a label and a type, not a unit.
 * A `date` histogram needs a bucket size (day? week? month?) that the data
 * cannot supply either. Both would be a visualisation invented to fill a slot,
 * which is exactly the thing not to do, so both list their answers instead and
 * the admin reads them.
 *
 * ── Why a choice question counts by RESPONDENT ───────────────────────────────
 * `answered` is the number of PEOPLE who answered, so a checkbox question's
 * option counts sum to more than it — one response contributes to several — and
 * its percentages sum past 100. That is the correct reading of a multi-select
 * ("68% of respondents chose Saturday") and it is why the denominator is
 * `answered` rather than the sum of the counts.
 */
export function summariseField(field: AnswerField, submissions: AnswerSubmission[]): QuestionSummary {
  const given = submissions.map((s) => s.answers?.[field.id]).filter(isAnswered);
  const answered = given.length;
  const treatment = TREATMENT[field.type] ?? 'list';

  if (treatment === 'scale' && (field.type === 'rating' || field.type === 'scale')) {
    // 🔴 Counted over NORMALISED points, not over `isAnswered`. `isAnswered`
    // asks whether a value is non-empty, and `String(0).trim()` is '0' — so an
    // unanswered question stored as 0 by a form authored before THE-366, or by
    // anything writing to this collection outside the public form, would be
    // counted as a real response and would drag the mean down. The gate here is
    // `normaliseAnswer`, which admits a number only when it is one of THIS
    // field's declared points.
    const raw = submissions.map((s) => s.answers?.[field.id]);
    const range = { min: field.scaleMin, max: field.scaleMax };
    const aggregate = aggregateScale(raw, field.type, range);
    return { kind: 'scale', field, answered: aggregate.answered, aggregate };
  }

  if (treatment === 'private') return { kind: 'private', field, answered };

  if (treatment === 'choice') {
    const counts = new Map<string, number>();
    for (const option of field.options ?? []) counts.set(option, 0);
    for (const answer of given) {
      // A checkbox answer is an array and lands on several keys; a dropdown or
      // radio answer is a single value and lands on one. Same loop.
      for (const value of new Set(valuesOf(answer))) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const declared = new Set(field.options ?? []);
    const options: OptionCount[] = [...counts.entries()].map(([label, count]) => ({
      label,
      count,
      percent: answered === 0 ? 0 : (count / answered) * 100,
      unlisted: !declared.has(label),
    }));
    // Declared options keep the order the form declares them in — that is the
    // order the question was asked in and the order a respondent saw. Anything
    // unlisted follows, commonest first, so a stale option does not displace a
    // live one.
    options.sort((a, b) => {
      if (a.unlisted !== b.unlisted) return a.unlisted ? 1 : -1;
      if (!a.unlisted) return (field.options ?? []).indexOf(a.label) - (field.options ?? []).indexOf(b.label);
      return b.count - a.count;
    });
    return { kind: 'choice', field, answered, options };
  }

  return {
    kind: 'list',
    field,
    answered,
    values: given.flatMap((answer) => valuesOf(answer)),
  };
}

/** Summarise every question of a form, in the order the form declares them. */
export function summariseForm(fields: AnswerField[], submissions: AnswerSubmission[]): QuestionSummary[] {
  return [...fields]
    .sort((a, b) => a.order - b.order)
    .map((field) => summariseField(field, submissions));
}

/* ═════════════════════════════════════════════════════════════════════════════
   The read.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One page of the submissions read.
 *
 * 500 is Firestore's own batch size elsewhere in this repo and the size
 * useDocsQueries settled on for the same job. A form with fewer responses than
 * this — nearly every form — pays exactly one round trip, the same as the
 * single `limit()` it replaces.
 */
export const SUBMISSIONS_PAGE_SIZE = 500;

/**
 * Absolute ceiling across all pages of one read.
 *
 * Firestore bills per document read, so "page until exhausted" needs a stop.
 * 10,000 is 20 pages and far past any plausible single form, and a multiple of
 * the page size on purpose so the ceiling is never hit mid-page. Reaching it
 * sets `truncated` — which the view RENDERS — rather than quietly returning a
 * short list.
 */
export const SUBMISSIONS_FETCH_CEILING = 10_000;

export const NO_FORM_SCOPE_MESSAGE =
  'Could not determine which church these answers belong to. Reload the page, and if this keeps happening sign out and back in.';

/**
 * 🔴 The null-scope guard, client side.
 *
 * `getTenantScope()` returns `null` for a super admin, and on a READ null does
 * not mean "no tenant" — it means "no filter", i.e. every church at once. The
 * server-side `assertConcreteScope` in lib/member-deletion states exactly this
 * and exists for exactly this; it cannot be imported here because it pulls
 * firebase-admin into a client bundle, so the same check is spelled here with
 * the same shape and the same message discipline.
 *
 * There is no super-admin widening branch, unlike the docs read: this read is a
 * SUBCOLLECTION of one form of one tenant, so the path itself is the scope and
 * "every tenant's answers to this form" is not a query that means anything. A
 * missing tenant or form id is a fault, and it throws.
 */
export function assertFormScope(tenantId: unknown, formId: unknown): { tenantId: string; formId: string } {
  for (const [label, value] of [['tenantId', tenantId], ['formId', formId]] as const) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `Refusing to read form answers with a non-concrete ${label} (got ${JSON.stringify(value)}). ` +
          'A null or empty scope matches across tenants.',
      );
    }
  }
  return { tenantId: tenantId as string, formId: formId as string };
}

export interface SubmissionsRead {
  rows: AnswerSubmission[];
  /**
   * The EXACT number of submissions, from `getCountFromServer` — a server-side
   * aggregation over the whole collection, not over what was fetched. Correct
   * even when `truncated`.
   */
  total: number;
  /** True when `rows` is short of `total` because the ceiling fired. */
  truncated: boolean;
}

/**
 * Read a form's submissions COMPLETELY, or say so when it could not.
 *
 * ── Why the count comes first ────────────────────────────────────────────────
 * `getCountFromServer` is an aggregation over the whole collection, so the
 * headline "N responses" is exact whatever happens below it. Taking it first
 * also makes completeness checkable: `rows.length < total` is the truncation
 * test, rather than a flag inferred from how a loop happened to exit.
 *
 * ── Why `orderBy(documentId())` and not `orderBy('submittedAt')` ─────────────
 * 🔴 This is #405's precedent, and the defect it closed is the one this screen
 * still had. `limit(1000)` with no total order returns 1000 ARBITRARY documents
 * — Firestore answers in `__name__` order and the ids are random — so it is not
 * "the newest 1000", and a per-question count computed over it is a count over
 * an arbitrary slice that LOOKS right because the client sorts what it happened
 * to receive.
 *
 * `__name__` is unique, so a cursor on it can neither skip nor repeat a
 * document. It is also the one total order Firestore can serve here for free:
 * this is a subcollection with no `where` clause, so the automatic single-field
 * index answers it and 🔴 NO COMPOSITE INDEX IS INVOLVED. That matters twice —
 * query-helpers.ts documents that this codebase avoids composite indexes by
 * design, and `firestore.indexes.json` is NOT deployed by deploy-rules.yml
 * (which runs `firestore:rules,storage`, and whose `paths:` filter does not
 * name the indexes file), so an index added there would be inert and the query
 * would throw `failed-precondition` in production.
 *
 * ⚠️ Ordering by `submittedAt` would have been wrong for a second reason even
 * if an index existed. Elsewhere in this repo `contactActivities.createdAt` and
 * `invoices.issuedAt` hold Timestamps AND ISO strings, and Firestore sorts
 * across types by TYPE first, so a mixed column pages in two blocks. This
 * collection is written in exactly one place — /api/forms/submit writes
 * `submittedAt: FieldValue.serverTimestamp()`, and it is the only writer — so
 * it is single-typed today. Ordering by `documentId()` means that stays a
 * property of the data rather than a dependency of the read.
 *
 * The caller sorts the finished set in memory, and that sort is correct BECAUSE
 * the set is complete. Sorting a truncated set is what made the old bug
 * invisible.
 */
export async function readAllSubmissions(
  db: Firestore,
  tenantIdIn: unknown,
  formIdIn: unknown,
): Promise<SubmissionsRead> {
  const { tenantId, formId } = assertFormScope(tenantIdIn, formIdIn);
  const base = collection(db, 'tenants', tenantId, 'forms', formId, 'submissions');

  const total = (await getCountFromServer(base)).data().count;

  const docs: QueryDocumentSnapshot<DocumentData>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (docs.length < SUBMISSIONS_FETCH_CEILING) {
    const page: QuerySnapshot<DocumentData> = await getDocs(
      query(
        base as unknown as Query<DocumentData>,
        orderBy(documentId()),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(SUBMISSIONS_PAGE_SIZE),
      ),
    );
    docs.push(...page.docs);
    // A short page means the collection is exhausted. This is the exit every
    // real form takes, on the first pass.
    if (page.docs.length < SUBMISSIONS_PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1];
  }

  const rows = docs.map((d) => ({ id: d.id, ...d.data() }) as AnswerSubmission);
  return { rows, total, truncated: rows.length < total };
}
