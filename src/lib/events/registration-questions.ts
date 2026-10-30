import type { RegistrationQuestion } from '../../hooks/queries/useEventQueries';

export const MAX_REGISTRATION_QUESTIONS = 10;
export const SHORT_ANSWER_MAX_LENGTH = 300;
export const LONG_ANSWER_MAX_LENGTH = 3000;

export type ValidateAnswersResult =
  | { ok: true; answers: Record<string, string> }
  | { ok: false; error: string };

/**
 * Server-side validation for `Event.registrationQuestions` answers, shared
 * by the public submit route and anything else that accepts a registration.
 * Required-but-blank and an out-of-set choice are REJECTED (the registrant
 * must fix them); free text is truncated to its kind's cap rather than
 * rejected, matching this repo's existing convention for public text inputs
 * (`src/app/api/contact/route.ts`'s `MAX_LENGTH.slice`).
 */
export function validateAnswers(
  questions: RegistrationQuestion[] | undefined | null,
  rawAnswers: unknown,
): ValidateAnswersResult {
  const qs = Array.isArray(questions) ? questions.slice(0, MAX_REGISTRATION_QUESTIONS) : [];
  if (qs.length === 0) return { ok: true, answers: {} };

  const input: Record<string, unknown> =
    rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
      ? (rawAnswers as Record<string, unknown>)
      : {};

  const answers: Record<string, string> = {};
  for (const q of qs) {
    const raw = input[q.id];
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (q.required && !value) {
      return { ok: false, error: `"${q.label}" is required.` };
    }
    if (!value) continue; // optional and blank: nothing to store

    if (q.kind === 'choice') {
      const options = Array.isArray(q.options) ? q.options : [];
      if (!options.includes(value)) {
        return { ok: false, error: `"${q.label}" must be one of the offered choices.` };
      }
      answers[q.id] = value;
    } else {
      const cap = q.kind === 'long' ? LONG_ANSWER_MAX_LENGTH : SHORT_ANSWER_MAX_LENGTH;
      answers[q.id] = value.slice(0, cap);
    }
  }
  return { ok: true, answers };
}
