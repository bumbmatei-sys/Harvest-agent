export interface LinkData {
  id?: string;
  platform: string;
  url: string;
}

export interface Author {
  id: string;
  name: string;
  title?: string;
  picture?: string;
  bio?: string;
  links?: LinkData[];
}

export interface OutlineItem {
  id: string;
  title: string;
  text: string;
}

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface QuizQuestion {
  id: string;
  q: string;
  options: QuizOption[];
}

export interface QuizAttempt {
  score: number;
  total: number;
  passed: boolean;
  answeredAt: string;
}

export interface Lesson {
  id: string;
  youtubeId?: string;
  youtubeUrl?: string;
  title: string;
  duration: string;
  authorId: string;
  summary: string;
  outline?: OutlineItem[];
  sources?: string;
  scripture?: string;
  quiz?: QuizQuestion[];
  /**
   * Private teaching notes. AdminCourseEditor has always written this field
   * (its local Lesson declares it), so course documents carry it in Firestore —
   * the canonical interface simply never declared it. Optional and additive:
   * declaring it here means a LibraryCourse round-trips through the editor
   * without the field being invisible to the type system.
   */
  teacherNote?: string;
}

export interface Section {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Level {
  id: string;
  title: string;
  sections: Section[];
}

export interface Course {
  id: string;
  featured: boolean;
  title: string;
  description: string;
  category: string;
  thumbnail: string;
  authorIds: string[];
  levels: Level[];
  issueCertificate?: boolean;
  requireQuiz?: boolean;
}

// ─── Platform course library ──────────────────────────────────────────
// Super-admin-authored courses in /libraryCourses, browsable and adoptable by
// every tenant on every tier. A library course IS a Course — same Level /
// Section / Lesson / Author shapes, same authorIds resolution, same player —
// so these extend the interfaces above instead of forking parallel ones.

export type CourseStatus = "draft" | "published";

/**
 * A course in the shared catalogue (/libraryCourses).
 *
 * Adds three fields a tenant Course does not carry, all optional so every
 * existing Course consumer accepts a LibraryCourse unchanged:
 *  - `status`     authoring state. The catalogue is public to all tenants the
 *                 moment a doc exists, so a super admin needs to draft a course
 *                 without every church seeing it half-written. (Tenant courses
 *                 carry the same field on the Firestore doc; it lives on
 *                 AdminCourseEditor's local Course type, not this one.)
 *  - `createdAt`  ISO timestamps for catalogue ordering and "new this month".
 *  - `updatedAt`  Also the adopter-facing signal that a shared course changed.
 *
 * `authorIds` resolves against `libraryAuthors`, NOT the tenant-scoped
 * `authors` collection — see LibraryAuthor.
 *
 * Deliberately absent: `tenantId`. Library courses are platform-owned; adding
 * one would put them back under a resource.data-based read rule.
 */
export interface LibraryCourse extends Course {
  status?: CourseStatus;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A platform-owned author (/libraryAuthors) — the same shape as Author, so the
 * existing `authors.find(a => a.id === id)` lookups in CourseOverview /
 * CourseCard / CourseLibrary work on it with no change. It exists as a separate
 * collection because the tenant-scoped /authors is unreadable across tenants:
 * a library course's authorIds could never resolve there.
 */
export type LibraryAuthor = Author;

/** A category in the shared catalogue (/libraryCategories). */
export interface LibraryCategory {
  id: string;
  name: string;
}

/**
 * A tenant's adoption of a library course
 * (tenants/{tenantId}/adoptedCourses/{libraryCourseId}).
 *
 * A POINTER plus adoption metadata — never a copy of the course. `id` equals
 * the libraryCourses doc id, so adopting twice is idempotent and un-adopting is
 * a delete. Edits to the library course reach every adopter because nothing
 * about its content is duplicated here.
 */
export interface AdoptedCourse {
  /** Doc id — identical to `libraryCourseId`, kept for symmetry with Course.id. */
  id: string;
  libraryCourseId: string;
  /** ISO timestamp. */
  adoptedAt: string;
  /** uid of the admin who adopted it. */
  adoptedBy: string;
  /**
   * The ADOPTING tenant's publish state, independent of the library course's
   * own `status`: a church may adopt a course and stage it before showing it to
   * members. Absent means published.
   */
  status?: CourseStatus;
  /**
   * PER-TENANT OVERRIDES — the only two fields a church controls on a course
   * they did not author. Everything else stays platform-owned and read-only,
   * which is the whole point of adoption being a pointer.
   *
   * ⚠️ OPTIONAL, AND ABSENT WHEN UNSET. "The tenant has not chosen" must stay
   * distinguishable from "the tenant chose false": absent falls back to the
   * library course's own value, false is an active opt-out. Do not give these
   * defaults here — see resolveOverriddenFlag() in utils/course-adoption.ts.
   *
   * Written ONLY by PATCH /api/courses/adopt. adoptedCourses is
   * `allow write: if false` (#247), so a client cannot set them directly.
   */
  requireQuiz?: boolean;
  issueCertificate?: boolean;
}
