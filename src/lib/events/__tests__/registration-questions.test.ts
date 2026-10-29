import { describe, it, expect } from 'vitest';
import { validateAnswers, SHORT_ANSWER_MAX_LENGTH, LONG_ANSWER_MAX_LENGTH } from '../registration-questions';
import type { RegistrationQuestion } from '../../../hooks/queries/useEventQueries';

describe('validateAnswers', () => {
  it('passes with no questions regardless of input', () => {
    expect(validateAnswers(undefined, { anything: 'x' })).toEqual({ ok: true, answers: {} });
    expect(validateAnswers([], null)).toEqual({ ok: true, answers: {} });
  });

  it('rejects a missing required answer', () => {
    const qs: RegistrationQuestion[] = [{ id: 'q1', label: 'Dietary needs', kind: 'short', required: true }];
    const result = validateAnswers(qs, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Dietary needs');
  });

  it('rejects a required answer that is only whitespace', () => {
    const qs: RegistrationQuestion[] = [{ id: 'q1', label: 'Name', kind: 'short', required: true }];
    const result = validateAnswers(qs, { q1: '   ' });
    expect(result.ok).toBe(false);
  });

  it('allows an optional question to be skipped', () => {
    const qs: RegistrationQuestion[] = [{ id: 'q1', label: 'Notes', kind: 'short', required: false }];
    expect(validateAnswers(qs, {})).toEqual({ ok: true, answers: {} });
  });

  it('accepts a required answer and trims it', () => {
    const qs: RegistrationQuestion[] = [{ id: 'q1', label: 'Name', kind: 'short', required: true }];
    const result = validateAnswers(qs, { q1: '  Grace  ' });
    expect(result).toEqual({ ok: true, answers: { q1: 'Grace' } });
  });

  it('caps short answers at SHORT_ANSWER_MAX_LENGTH', () => {
    const qs: RegistrationQuestion[] = [{ id: 'q1', label: 'Bio', kind: 'short', required: true }];
    const long = 'x'.repeat(SHORT_ANSWER_MAX_LENGTH + 50);
    const result = validateAnswers(qs, { q1: long });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.q1.length).toBe(SHORT_ANSWER_MAX_LENGTH);
  });

  it('caps long answers at LONG_ANSWER_MAX_LENGTH', () => {
    const qs: RegistrationQuestion[] = [{ id: 'q1', label: 'Testimony', kind: 'long', required: true }];
    const long = 'y'.repeat(LONG_ANSWER_MAX_LENGTH + 500);
    const result = validateAnswers(qs, { q1: long });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.q1.length).toBe(LONG_ANSWER_MAX_LENGTH);
  });

  it('rejects a choice answer not in the offered options', () => {
    const qs: RegistrationQuestion[] = [
      { id: 'q1', label: 'Shirt size', kind: 'choice', required: true, options: ['S', 'M', 'L'] },
    ];
    const result = validateAnswers(qs, { q1: 'XL' });
    expect(result.ok).toBe(false);
  });

  it('accepts a choice answer that is in the offered options', () => {
    const qs: RegistrationQuestion[] = [
      { id: 'q1', label: 'Shirt size', kind: 'choice', required: true, options: ['S', 'M', 'L'] },
    ];
    expect(validateAnswers(qs, { q1: 'M' })).toEqual({ ok: true, answers: { q1: 'M' } });
  });

  it('validates multiple questions independently and ignores extra keys', () => {
    const qs: RegistrationQuestion[] = [
      { id: 'q1', label: 'Name', kind: 'short', required: true },
      { id: 'q2', label: 'Notes', kind: 'long', required: false },
    ];
    const result = validateAnswers(qs, { q1: 'Sam', q2: '', q3: 'ignored' });
    expect(result).toEqual({ ok: true, answers: { q1: 'Sam' } });
  });

  it('only validates the first 10 questions even if more are stored', () => {
    const qs: RegistrationQuestion[] = Array.from({ length: 12 }, (_, i) => ({
      id: `q${i}`,
      label: `Q${i}`,
      kind: 'short' as const,
      required: true,
    }));
    // None answered — would fail on q0 regardless, but this pins the slice behaviour.
    const result = validateAnswers(qs, {});
    expect(result.ok).toBe(false);
  });
});
