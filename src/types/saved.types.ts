// ─────────────────────────────────────────────────────────────────────────────
// Saved / Bookmarks — polymorphic "savedItems" map stored as a FIELD on
// users/{uid} (mirrors the completedLessons/lessonNotes/quizAttempts pattern in
// CoursePage.tsx). No new collection, no migration, no firestore.rules change:
// the users self-edit rule is a blocklist (role/permissions/tenantId/plan +
// affiliate fields), so a new `savedItems` field is already self-editable.
//
// savedItems is a map keyed by a composite id (see the *Key helpers below), each
// entry storing just enough to render the Saved list + navigate to the item
// without re-fetching everything.
// ─────────────────────────────────────────────────────────────────────────────

export type SavedType = 'blog' | 'lesson' | 'post' | 'verse';

/** A saved blog article — navigate by id (resolve the live doc on open). */
export interface SavedBlog {
  type: 'blog';
  id: string;
  title: string;
  snippet?: string;
  savedAt: string;
}

/** A saved course lesson — navigate by courseId + lessonId. */
export interface SavedLesson {
  type: 'lesson';
  courseId: string;
  lessonId: string;
  title: string;
  courseTitle?: string;
  savedAt: string;
}

/** A saved community feed post — navigate by id (opens the feed). */
export interface SavedPost {
  type: 'post';
  id: string;
  snippet?: string;
  authorName?: string;
  savedAt: string;
}

/**
 * A saved Bible verse. Verses are NOT Firestore docs — they're identified by
 * translation + book + chapter + verse and are value-based, so we store the
 * verse TEXT + a human reference ("John 3:16") to render the Saved list directly
 * without any doc lookup.
 */
export interface SavedVerse {
  type: 'verse';
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  reference: string;
  savedAt: string;
}

export type SavedEntry = SavedBlog | SavedLesson | SavedPost | SavedVerse;

/**
 * An entry as supplied by a save surface — the same shape as SavedEntry but
 * without `savedAt`, which is stamped at toggle time by the SavedItems provider.
 */
export type SavedEntryInput =
  | Omit<SavedBlog, 'savedAt'>
  | Omit<SavedLesson, 'savedAt'>
  | Omit<SavedPost, 'savedAt'>
  | Omit<SavedVerse, 'savedAt'>;

// ── Composite key helpers ────────────────────────────────────────────────────
// The key is the map key inside savedItems AND the last segment of the dotted
// Firestore field path (`savedItems.<key>`). None of the interpolated parts
// contain a `.` (translation ids, book names, blog/post/course/lesson ids all
// lack dots), so `.` stays purely the path separator — no field-path escaping
// needed.

export const blogKey = (id: string) => `blog:${id}`;
export const lessonKey = (courseId: string, lessonId: string) => `lesson:${courseId}:${lessonId}`;
export const postKey = (id: string) => `post:${id}`;
export const verseKey = (translation: string, book: string, chapter: number, verse: number) =>
  `verse:${translation}:${book}:${chapter}:${verse}`;

/** Resolve the composite key for a given entry (input or stored). */
export const keyForEntry = (e: SavedEntryInput | SavedEntry): string => {
  switch (e.type) {
    case 'blog':
      return blogKey(e.id);
    case 'lesson':
      return lessonKey(e.courseId, e.lessonId);
    case 'post':
      return postKey(e.id);
    case 'verse':
      return verseKey(e.translation, e.book, e.chapter, e.verse);
  }
};
