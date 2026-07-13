import { describe, it, expect } from 'vitest';
import {
  blogKey,
  lessonKey,
  postKey,
  verseKey,
  keyForEntry,
  SavedEntryInput,
} from '../../types/saved.types';

/**
 * The composite key is both the map key inside savedItems AND the last segment
 * of the dotted Firestore field path (`savedItems.<key>`). These tests pin the
 * key format and — critically — assert no interpolated part introduces a `.`,
 * which would corrupt the dotted field-path write.
 */
describe('saved composite keys', () => {
  it('builds stable per-type keys', () => {
    expect(blogKey('abc123')).toBe('blog:abc123');
    expect(lessonKey('course1', 'lesson9')).toBe('lesson:course1:lesson9');
    expect(postKey('p42')).toBe('post:p42');
    expect(verseKey('BSB', 'John', 3, 16)).toBe('verse:BSB:John:3:16');
  });

  it('handles book names with spaces (still no dots for the field path)', () => {
    const key = verseKey('eng_kjv', '1 Corinthians', 13, 4);
    expect(key).toBe('verse:eng_kjv:1 Corinthians:13:4');
    expect(key).not.toContain('.');
  });

  it('keyForEntry matches the per-type helpers for every saved type', () => {
    const blog: SavedEntryInput = { type: 'blog', id: 'b1', title: 'T' };
    const lesson: SavedEntryInput = { type: 'lesson', courseId: 'c1', lessonId: 'l1', title: 'L' };
    const post: SavedEntryInput = { type: 'post', id: 'po1' };
    const verse: SavedEntryInput = {
      type: 'verse', translation: 'BSB', book: 'John', chapter: 3, verse: 16,
      text: 'For God so loved…', reference: 'John 3:16',
    };
    expect(keyForEntry(blog)).toBe(blogKey('b1'));
    expect(keyForEntry(lesson)).toBe(lessonKey('c1', 'l1'));
    expect(keyForEntry(post)).toBe(postKey('po1'));
    expect(keyForEntry(verse)).toBe(verseKey('BSB', 'John', 3, 16));
  });

  it('round-trips: a saved verse entry reconstructs its own key', () => {
    const verse: SavedEntryInput = {
      type: 'verse', translation: 'BSB', book: '1 Corinthians', chapter: 13, verse: 4,
      text: 'Love is patient…', reference: '1 Corinthians 13:4',
    };
    expect(keyForEntry(verse)).toBe('verse:BSB:1 Corinthians:13:4');
  });
});
