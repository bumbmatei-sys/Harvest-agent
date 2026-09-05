"use client";
import React from 'react';
import { ChartColumn, AlignLeft, Lock, TriangleAlert, FileText } from 'lucide-react';

import { Progress } from '../ui/progress';
import type { QuestionSummary } from './form-answers';

/**
 * The per-question rendering of a form's answers — Google Forms' summary, not
 * a table.
 *
 * ── Why there is no chart library here ───────────────────────────────────────
 * 🔴 `chart` (recharts) is installed and adopted, and it is deliberately NOT
 * used. Three reasons, and the third is the one that decided it:
 *
 *   1. What a choice question needs is a proportion bar — a track, a fill and
 *      the number written beside it. recharts renders an SVG coordinate system
 *      for that, which is a large dependency doing a `div`'s job.
 *   2. THE-272's guard records `chart`'s adopters as a CLOSED list and every
 *      entry on it is a dashboard widget owned by another ticket. Adopting here
 *      means amending a list made entirely of files this ticket may not open.
 *   3. 🔴 recharts renders NOTHING under happy-dom — #429 found its own series
 *      assertions passing against description text because of it. The counts on
 *      this screen are the whole ticket, so they must be assertable in the DOM
 *      the suite actually renders. Plain elements are; an SVG that never
 *      appears is not.
 *
 * So the guard is untouched, `chart` keeps exactly the four adopters it had,
 * and every figure a bar depicts is also written out as text next to it, so
 * nothing here is conveyed by the bar alone.
 *
 * ⚠️ THE-319 RE-EXAMINED THIS AND KEPT IT. Reason 3 is unchanged and decides it
 * again: recharts renders nothing under happy-dom, and the counts on this screen
 * are the whole ticket. The bar itself is no longer a hand-rolled `div` pair
 * though — it is `progress`, which is the primitive for a proportion of a whole
 * and which THE-290 already adopted for exactly this shape. `chart` gains no
 * adopter here and THE-272's list is untouched on that line; `progress` gains
 * one and that IS recorded there.
 *
 * ── Colour and size ──────────────────────────────────────────────────────────
 * No colour is spelled: every class is a palette token that already resolves in
 * all four palettes (Classic is the default). No `sm:`-gated size is invented —
 * the only numbers are the 44px tap-target floor below `sm` and the list's own
 * scroll height, which is a content clamp and not a layout measure.
 */

/**
 * THE-319 — the proportion bar is `progress`, the installed primitive, and this
 * is the only clamp left of what used to be an inline width.
 *
 * ⚠️ The clamp is still this file's job. `progress` maps `value` onto `min`/`max`
 * itself, but a share computed from a CHECKBOX question can legitimately exceed
 * its own denominator (see {@link ChoiceBody}), and a bar drawn past its track
 * would be a second, wrong reading of a number the text beside it states
 * correctly. Clamping here keeps the bar honest and leaves the figure alone.
 */
const barValue = (percent: number) => Math.max(0, Math.min(100, percent));

/**
 * How many free-text answers a list RENDERS.
 *
 * ⚠️ This is a rendering cap and NOT a read cap, and the difference is the whole
 * point. Every count on this screen is over the complete read; what is limited
 * here is how many `<li>` elements a browser is asked to lay out, because a form
 * with 10,000 responses and four text questions is 40,000 nodes and a phone will
 * not thank you for them.
 *
 * 🔴 It is never silent. When it binds, the card says how many it is showing and
 * out of how many, exactly as the read's own ceiling does. The complete set is
 * in the CSV export, unchanged.
 */
export const LIST_RENDER_LIMIT = 200;

const QuestionCard: React.FC<{
  summary: QuestionSummary;
  index: number;
  children: React.ReactNode;
  icon: React.ReactNode;
  note: string;
}> = ({ summary, index, children, icon, note }) => (
  <div
    data-question={summary.field.id}
    data-question-kind={summary.kind}
    className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-4 lg:p-5"
  >
    <div className="flex items-start gap-3">
      <span className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-strong break-words">
          {summary.field.label || `Question ${index + 1}`}
        </div>
        <div data-question-answered className="text-[11.5px] text-faint mt-0.5">
          {summary.answered} {summary.answered === 1 ? 'answer' : 'answers'} · {note}
        </div>
      </div>
    </div>
    <div className="mt-3 pt-3 border-t border-line">{children}</div>
  </div>
);

/**
 * A choice question — one row per option, commonest first among anything the
 * form no longer declares.
 *
 * ⚠️ A CHECKBOX question's counts sum past `answered` on purpose: one response
 * contributes to every option it ticked, so "68% of respondents chose Saturday"
 * is the reading and the denominator is people, not ticks. The note under the
 * heading says which of the two this question is.
 */
const ChoiceBody: React.FC<{ summary: Extract<QuestionSummary, { kind: 'choice' }> }> = ({ summary }) => {
  if (summary.options.length === 0) {
    return <p className="text-[13px] text-faint">This question declares no options and nobody has answered it.</p>;
  }
  return (
    /* The card scrolls its own overflow rather than letting a long option list
       push the page — #422's rule, and the reason the clamp is here and not on
       the page. */
    <div data-answer-scroller className="max-h-[320px] overflow-y-auto overflow-x-auto space-y-2.5">
      {summary.options.map((option) => (
        <div key={option.label} data-option={option.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-body break-words min-w-0">
              {option.label}
              {option.unlisted && (
                <span className="text-[11px] text-faint ml-1.5">(no longer offered)</span>
              )}
            </span>
            <span data-option-count className="text-[13px] font-semibold text-strong shrink-0 tabular-nums">
              {option.count} · {Math.round(option.percent)}%
            </span>
          </div>
          {/*
            🔴 THE-319 — `progress`, not a hand-rolled track and fill. The
            primitive owns the geometry and the width, so this file spells no
            `style={{ … }}` at all any more; the two classes below repaint its
            track and indicator in this screen's own surface tokens, which is
            the only seam `ui/progress` offers (it renders its own track and
            indicator and takes no className for either).
            ⚠️ `aria-hidden`, deliberately. The primitive's root is a
            `progressbar`, and this file's whole argument is that nothing is
            conveyed by a bar alone — the count and the share are written out
            in `data-option-count` immediately above it. Naming the bar as well
            would announce the same figure twice.
          */}
          <Progress
            aria-hidden
            data-option-bar
            value={barValue(option.percent)}
            className="mt-1.5 block [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-surface-sunken [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-indicator]]:bg-gold"
          />
        </div>
      ))}
    </div>
  );
};

/**
 * A question with no sensible aggregate — its answers, listed.
 *
 * 🔴 Free text is the obvious case and `number` and `date` are here with it.
 * Neither has an aggregate this screen can know is meaningful: a mean over a
 * number field is right for "How many guests" and nonsense for "Year you
 * joined", and a date histogram needs a bucket size the data cannot supply. A
 * bar drawn anyway would be a visualisation invented to fill a slot.
 */
const ListBody: React.FC<{ summary: Extract<QuestionSummary, { kind: 'list' }> }> = ({ summary }) => {
  if (summary.values.length === 0) {
    return <p className="text-[13px] text-faint">No answers yet.</p>;
  }
  const shown = summary.values.slice(0, LIST_RENDER_LIMIT);
  return (
    <div data-answer-scroller className="max-h-[320px] overflow-y-auto overflow-x-auto">
      <ul data-answer-list className="space-y-2">
        {shown.map((value, i) => (
          <li
            key={`${i}-${value}`}
            data-answer
            className="text-[13px] text-body break-words bg-surface-sunken rounded-brand px-3 py-2"
          >
            {value}
          </li>
        ))}
      </ul>
      {summary.values.length > shown.length && (
        <p data-list-render-cap className="text-[11.5px] text-faint mt-2">
          Showing the first {shown.length.toLocaleString()} of{' '}
          {summary.values.length.toLocaleString()} answers. The full set is in the CSV export.
        </p>
      )}
    </div>
  );
};

/**
 * 🔴 An email or phone question — counted, never charted and never listed.
 *
 * See PRIVATE_TYPES in form-answers.ts for the whole argument. In short: every
 * address is distinct so every bar would be 1, and a summary is the screen most
 * likely to be shown to a room. The values are unchanged and one tap away in
 * the responses table and the CSV export.
 */
const PrivateBody: React.FC<{ summary: Extract<QuestionSummary, { kind: 'private' }> }> = ({ summary }) => (
  <p data-private-note className="text-[13px] text-muted">
    This question collects contact details that identify the person answering, so
    the answers are counted here rather than summarised. Open the responses table
    or export the CSV to read them.
  </p>
);

const NOTE: Record<QuestionSummary['kind'], (s: QuestionSummary) => string> = {
  choice: (s) => (s.field.type === 'checkbox' ? 'choose any, so shares can total over 100%' : 'choose one'),
  list: (s) => `${s.field.type.replace('_', ' ')}, listed in full`,
  private: (s) => `${s.field.type}, counted only`,
};

const ICON: Record<QuestionSummary['kind'], React.ReactNode> = {
  choice: <ChartColumn size={17} />,
  list: <AlignLeft size={17} />,
  private: <Lock size={17} />,
};

export interface FormAnswersViewProps {
  summaries: QuestionSummary[];
  /** The EXACT response count, from getCountFromServer. */
  total: number;
  /** How many responses the aggregates below were actually computed over. */
  counted: number;
  /** True when `counted` is short of `total` because the read hit its ceiling. */
  truncated: boolean;
  loading: boolean;
}

export const FormAnswersView: React.FC<FormAnswersViewProps> = ({
  summaries, total, counted, truncated, loading,
}) => {
  if (loading) {
    return (
      <div data-answers-view className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin border-gold" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div data-answers-view className="text-center py-16 text-faint">
        <FileText size={40} className="mx-auto mb-3 opacity-30" />
        <p className="font-medium font-display">No answers yet</p>
      </div>
    );
  }

  return (
    <div data-answers-view className="space-y-4">
      {/*
        🔴 THE CEILING, SAID OUT LOUD. A silently truncated count is the defect
        this whole read exists to remove, so when the ceiling fires the screen
        states BOTH numbers and every aggregate below is explicitly a figure over
        `counted`, not over `total`. #405 shipped a "Partial list" notice for the
        same situation and this is that notice for this screen.
      */}
      {truncated && (
        <div
          data-truncation-notice
          className="flex items-start gap-2.5 bg-surface-sunken border border-line rounded-brand-xl p-3.5"
        >
          <TriangleAlert size={16} className="text-danger shrink-0 mt-0.5" />
          <p className="text-[13px] text-body">
            Partial summary. This form has {total.toLocaleString()} responses and the
            figures below count the {counted.toLocaleString()} that could be read in
            one go. Export the CSV for the complete set.
          </p>
        </div>
      )}

      <p data-answers-scope className="text-[13px] text-muted">
        {truncated
          ? `Each question below is summarised over ${counted.toLocaleString()} of ${total.toLocaleString()} responses.`
          : `Each question below is summarised over all ${total.toLocaleString()} ${total === 1 ? 'response' : 'responses'}.`}
      </p>

      {summaries.map((summary, index) => (
        <QuestionCard
          key={summary.field.id}
          summary={summary}
          index={index}
          icon={ICON[summary.kind]}
          note={NOTE[summary.kind](summary)}
        >
          {summary.kind === 'choice' ? <ChoiceBody summary={summary} />
            : summary.kind === 'list' ? <ListBody summary={summary} />
            : <PrivateBody summary={summary} />}
        </QuestionCard>
      ))}

      {summaries.length === 0 && (
        <p className="text-sm text-faint">This form has no questions.</p>
      )}
    </div>
  );
};

export default FormAnswersView;
