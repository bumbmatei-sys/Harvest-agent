import { describe, it, expect } from 'vitest';
import { extractYouTubeId, canonicalYouTubeUrl, formatIsoDuration } from '../youtube';

describe('extractYouTubeId', () => {
  it('parses a standard watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a watch URL with extra query params', () => {
    expect(extractYouTubeId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL')).toBe('dQw4w9WgXcQ');
  });

  it('parses a youtu.be short link', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses /shorts/, /embed/, /live/ and /v/ forms', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses m. and music. hosts', () => {
    expect(extractYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('accepts a bare 11-char id', () => {
    expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a URL without a scheme', () => {
    expect(extractYouTubeId('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube or malformed input', () => {
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(extractYouTubeId('not a url')).toBeNull();
    expect(extractYouTubeId('')).toBeNull();
    // Wrong-length id
    expect(extractYouTubeId('https://www.youtube.com/watch?v=tooShort')).toBeNull();
  });
});

describe('canonicalYouTubeUrl', () => {
  it('builds a clean watch URL', () => {
    expect(canonicalYouTubeUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('formatIsoDuration', () => {
  it('formats minutes + seconds (seconds dropped) — the PT34M12S example', () => {
    expect(formatIsoDuration('PT34M12S')).toBe('34 min');
  });

  it('formats minutes only', () => {
    expect(formatIsoDuration('PT45M')).toBe('45 min');
  });

  it('formats hours + minutes', () => {
    expect(formatIsoDuration('PT1H2M34S')).toBe('1 hr 2 min');
  });

  it('formats whole hours', () => {
    expect(formatIsoDuration('PT2H')).toBe('2 hr');
  });

  it('formats sub-minute videos in seconds', () => {
    expect(formatIsoDuration('PT48S')).toBe('48 sec');
  });

  it('returns empty string for empty/invalid input', () => {
    expect(formatIsoDuration('')).toBe('');
    expect(formatIsoDuration('garbage')).toBe('');
    expect(formatIsoDuration('PT0S')).toBe('');
  });
});
