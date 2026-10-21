import type { Course, Lesson } from './course.types';

/** Text is rich text only, Video is a video only, Video + text carries both. */
export type LessonType = 'text' | 'video' | 'video-text';

export const LESSON_TYPES: readonly LessonType[] = ['text', 'video', 'video-text'];

/** A lesson as the course product edits and plays it. Additive over the shared Lesson. */
export interface ProductLesson extends Lesson {
  type?: LessonType;
  /** Rich-text body as TipTap HTML. Present on text and video + text lessons. */
  body?: string;
}

export type CourseAccessMode = 'everyone' | 'restricted';

export type CoursePriceMode = 'free' | 'one-time' | 'membership';

/**
 * What the offer step records. Nothing here is ever charged: paid checkout is
 * parked, so a price is a stored intention and no payment call reads it.
 */
export interface CoursePrice {
  mode: CoursePriceMode;
  amountUsd?: number;
  wasAmountUsd?: number;
}

/**
 * The fields the course product adds to a /courses document. Every one is
 * optional so a document written before this model still parses, and so the
 * shared Course interface (which AdminCourseEditor's forked type is pinned
 * against) does not move.
 */
export interface CourseProductFields {
  status?: 'draft' | 'published';
  author?: string;
  coverImage?: string;
  tagline?: string;
  /** Absent means the legacy rule: every member of the tenant may open it. */
  accessMode?: CourseAccessMode;
  /** Explicit access list, by user id. */
  accessUserIds?: string[];
  /** Communities this course is attached to. Members of any of them get access. */
  communityIds?: string[];
  price?: CoursePrice;
  /** "What's included" bullets on the landing page. */
  included?: string[];
  signOff?: string;
  buttonText?: string;
  createdAt?: string;
  updatedAt?: string;
  tenantId?: string | null;
}

export type ProductCourse = Course & CourseProductFields;

/** A community a course can be attached to. The Community remodel supplies these. */
export interface CommunityRef {
  id: string;
  name: string;
}
