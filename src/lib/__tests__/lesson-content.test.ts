import { describe, it, expect } from 'vitest';
import {
  parseLessonGenerationJson,
  normalizeLessonContent,
  sanitizeScriptureReference,
} from '../lesson-content';

const validObj = {
  title: 'The Word Became Flesh',
  summary: 'A study of the incarnation.',
  outline: [
    { title: 'The Word', text: 'In the beginning was the Word.' },
    { title: 'The Light', text: 'The light shines in darkness.' },
  ],
  quiz: [
    {
      q: 'Who is the Word?',
      options: [
        { text: 'Jesus', correct: true },
        { text: 'Moses', correct: false },
        { text: 'Paul', correct: false },
      ],
    },
  ],
  scripture: 'John 1:14',
  videoSummary: 'A longer recap of the teaching on the incarnation of Christ.',
};

describe('parseLessonGenerationJson', () => {
  it('parses a clean JSON object', () => {
    const out = parseLessonGenerationJson(JSON.stringify(validObj));
    expect(out).not.toBeNull();
    expect(out!.title).toBe('The Word Became Flesh');
    expect(out!.outline).toHaveLength(2);
    expect(out!.quiz[0].options).toHaveLength(3);
    expect(out!.scripture).toBe('John 1:14');
  });

  it('strips ```json fences', () => {
    const fenced = '```json\n' + JSON.stringify(validObj) + '\n```';
    const out = parseLessonGenerationJson(fenced);
    expect(out).not.toBeNull();
    expect(out!.title).toBe('The Word Became Flesh');
  });

  it('salvages a JSON object embedded in prose', () => {
    const messy = 'Sure! Here is your lesson:\n' + JSON.stringify(validObj) + '\nHope that helps.';
    const out = parseLessonGenerationJson(messy);
    expect(out).not.toBeNull();
    expect(out!.summary).toBe('A study of the incarnation.');
  });

  it('returns null for unrecoverable garbage', () => {
    expect(parseLessonGenerationJson('this is not json at all')).toBeNull();
    expect(parseLessonGenerationJson('')).toBeNull();
  });

  it('returns null for an empty-content object', () => {
    expect(parseLessonGenerationJson('{"title":"","summary":"","outline":[],"quiz":[]}')).toBeNull();
  });
});

describe('normalizeLessonContent', () => {
  it('tolerates field-name drift (question/description/body)', () => {
    const drift = {
      title: 'T',
      description: 'desc-as-summary',
      outline: [{ heading: 'H', body: 'B' }],
      quiz: [{ question: 'Q?', options: [{ text: 'a', correct: true }, { text: 'b' }] }],
    };
    const out = normalizeLessonContent(drift)!;
    expect(out.summary).toBe('desc-as-summary');
    expect(out.outline[0]).toEqual({ title: 'H', text: 'B' });
    expect(out.quiz[0].q).toBe('Q?');
  });

  it('forces exactly one correct option, defaulting to the first', () => {
    const noCorrect = {
      title: 'T',
      quiz: [{ q: 'Q?', options: [{ text: 'a' }, { text: 'b' }] }],
    };
    const out = normalizeLessonContent(noCorrect)!;
    expect(out.quiz[0].options.map((o) => o.correct)).toEqual([true, false]);
  });

  it('collapses multiple correct options down to the first', () => {
    const many = {
      title: 'T',
      quiz: [{ q: 'Q?', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }],
    };
    const out = normalizeLessonContent(many)!;
    expect(out.quiz[0].options.map((o) => o.correct)).toEqual([true, false]);
  });

  it('drops quiz questions with fewer than 2 options', () => {
    const out = normalizeLessonContent({
      title: 'T',
      quiz: [{ q: 'Q?', options: [{ text: 'only one', correct: true }] }],
    })!;
    expect(out.quiz).toHaveLength(0);
  });

  it('accepts string-array options', () => {
    const out = normalizeLessonContent({
      title: 'T',
      quiz: [{ q: 'Q?', options: ['a', 'b', 'c'] }],
    })!;
    expect(out.quiz[0].options).toHaveLength(3);
    expect(out.quiz[0].options[0].correct).toBe(true); // first defaulted correct
  });

  it('returns null for non-objects', () => {
    expect(normalizeLessonContent(null)).toBeNull();
    expect(normalizeLessonContent('nope')).toBeNull();
  });
});

describe('sanitizeScriptureReference — reference only, NEVER verse text', () => {
  it('passes through a clean reference', () => {
    expect(sanitizeScriptureReference('John 1:14')).toBe('John 1:14');
  });

  it('keeps chapter-only references', () => {
    expect(sanitizeScriptureReference('Psalm 23')).toBe('Psalm 23');
  });

  it('keeps verse ranges', () => {
    expect(sanitizeScriptureReference('1 Corinthians 13:4-7')).toBe('1 Corinthians 13:4-7');
  });

  it('handles multi-word book names', () => {
    expect(sanitizeScriptureReference('Song of Solomon 2:1')).toBe('Song of Solomon 2:1');
  });

  it('STRIPS appended verse text, keeping only the reference', () => {
    expect(
      sanitizeScriptureReference('John 1:14 — "And the Word became flesh and dwelt among us"'),
    ).toBe('John 1:14');
  });

  it('extracts the reference from surrounding prose', () => {
    expect(sanitizeScriptureReference('See John 3:16 for more')).toBe('John 3:16');
  });

  it('returns empty when there is no recognizable reference (never leaks verse text)', () => {
    expect(sanitizeScriptureReference('For God so loved the world that he gave his only Son')).toBe('');
    expect(sanitizeScriptureReference('')).toBe('');
    expect(sanitizeScriptureReference('Some random teaching notes')).toBe('');
  });
});
