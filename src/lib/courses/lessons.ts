import type { Course, Level, Lesson, Section } from '@/types/course.types';
import type { CourseProductFields, LessonType, ProductLesson } from '@/types/course-product.types';
import { stripHtml } from '@/utils/stripHtml';
import { extractYouTubeId } from '@/utils/course.utils';

export const LESSON_TYPE_LABEL: Record<LessonType, string> = {
  text: 'Text',
  video: 'Video',
  'video-text': 'Video + text',
};

export const LESSON_TYPE_HINT: Record<LessonType, string> = {
  text: 'Headings, lists and images. No video needed.',
  video: 'A YouTube video.',
  'video-text': 'A video with a written lesson beside it.',
};

export const newId = (): string => crypto.randomUUID().slice(0, 7);

export function videoUrlOf(lesson: Pick<Lesson, 'youtubeUrl' | 'youtubeId'>): string {
  if (lesson.youtubeUrl?.trim()) return lesson.youtubeUrl.trim();
  return lesson.youtubeId ? `https://www.youtube.com/watch?v=${lesson.youtubeId}` : '';
}

/**
 * What a lesson is. A lesson written before lesson types existed has no `type`:
 * one with a video is a Video lesson, anything else reads as Text.
 */
export function lessonTypeOf(lesson: ProductLesson): LessonType {
  if (lesson.type) return lesson.type;
  return videoUrlOf(lesson) ? 'video' : 'text';
}

export const hasVideo = (lesson: ProductLesson): boolean => lessonTypeOf(lesson) !== 'text';
export const hasBody = (lesson: ProductLesson): boolean => lessonTypeOf(lesson) !== 'video';

/** The words a text lesson holds, without markup. */
export const bodyText = (lesson: ProductLesson): string => stripHtml(lesson.body ?? '');

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The text of a lesson written before lesson types existed: it lives in
 * `summary` and `outline`, never in `body`. Read as HTML (escaped) so the
 * player can show it; stored data is not rewritten.
 */
function legacyHtml(lesson: ProductLesson): string {
  if (lesson.type) return '';
  const summary = lesson.summary?.trim();
  return [
    summary ? `<p>${escapeText(summary)}</p>` : '',
    ...(lesson.outline ?? []).map((o) => {
      const title = o.title?.trim();
      const text = o.text?.trim();
      return `${title ? `<h3>${escapeText(title)}</h3>` : ''}${text ? `<p>${escapeText(text)}</p>` : ''}`;
    }),
  ].join('');
}

/**
 * The written part of a lesson, as unsanitised HTML ('' when there is none).
 * A typed lesson reads its body when its type has one. A legacy lesson reads its
 * body, else summary and outline, whether or not it also has a video.
 */
export function lessonHtml(lesson: ProductLesson): string {
  if (bodyText(lesson) && (hasBody(lesson) || !lesson.type)) return lesson.body ?? '';
  const legacy = legacyHtml(lesson);
  return stripHtml(legacy) ? legacy : '';
}

export function emptyLesson(type: LessonType = 'text'): ProductLesson {
  return {
    id: newId(),
    type,
    title: '',
    summary: '',
    duration: '',
    authorId: '',
    ...(type === 'text' ? {} : { youtubeUrl: '' }),
    ...(type === 'video' ? {} : { body: '<p></p>' }),
  };
}

export function emptySection(title = ''): Section {
  return { id: newId(), title, lessons: [] };
}

export function emptyCourseLevels(): Level[] {
  return [{ id: newId(), title: 'Course', sections: [emptySection('Start here')] }];
}

/** Why a lesson cannot be published, or null when it is ready. Text lessons never need a video. */
export function lessonProblem(lesson: ProductLesson): string | null {
  if (!lesson.title.trim()) return 'needs a title';
  const type = lessonTypeOf(lesson);
  if (type !== 'text') {
    const url = videoUrlOf(lesson);
    if (!url) return 'needs a video link';
    if (!extractYouTubeId(url)) return 'needs a valid YouTube link';
  }
  if (type === 'text' && !stripHtml(lessonHtml(lesson))) return 'needs some text';
  return null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** A blocking item keeps Publish disabled. An advisory one only tells the truth. */
  blocking: boolean;
  detail?: string;
}

export interface PublishReadiness {
  ready: boolean;
  items: ChecklistItem[];
}

export const sectionsOf = (levels: Level[]): Section[] => levels.flatMap((l) => l.sections);
export const lessonsOf = (levels: Level[]): ProductLesson[] =>
  levels.flatMap((l) => l.sections.flatMap((s) => s.lessons as ProductLesson[]));

/**
 * The publish checklist. It is the same list the Publish step draws and the
 * same gate Publish uses, so the page cannot say "ready" while the button
 * refuses. A course made only of text lessons is ready: nothing here asks for a
 * video.
 */
export function publishReadiness(
  course: Pick<Course, 'title' | 'levels'> & CourseProductFields,
): PublishReadiness {
  const lessons = lessonsOf(course.levels);
  const problems = lessons
    .map((l, i) => ({ l, i, problem: lessonProblem(l) }))
    .filter((x): x is { l: ProductLesson; i: number; problem: string } => x.problem !== null);
  const restricted = course.accessMode === 'restricted';
  const someoneHasAccess =
    (course.accessUserIds?.length ?? 0) > 0 || (course.communityIds?.length ?? 0) > 0;

  const items: ChecklistItem[] = [
    { id: 'title', label: 'Name your course', done: course.title.trim().length > 0, blocking: true },
    {
      id: 'lessons',
      label: 'Add at least one lesson',
      done: lessons.length > 0,
      blocking: true,
    },
    {
      id: 'lesson-content',
      label: 'Every lesson has its content',
      done: lessons.length > 0 && problems.length === 0,
      blocking: true,
      detail: problems.length
        ? problems.slice(0, 3).map((p) => `${p.l.title.trim() || `Lesson ${p.i + 1}`} ${p.problem}`).join('; ')
        : undefined,
    },
    {
      id: 'access',
      label: restricted ? 'Give someone access' : 'Choose who can open it',
      done: !restricted || someoneHasAccess,
      blocking: false,
      detail: restricted && !someoneHasAccess
        ? 'Only people on the access list or in an attached community can open it, and nobody is on either yet.'
        : undefined,
    },
  ];
  return { ready: items.filter((i) => i.blocking).every((i) => i.done), items };
}

/** Lessons done in one section, as the rail's "2 of 7 done" line reads it. */
export function sectionProgress(section: Section, completed: ReadonlySet<string>): { done: number; total: number } {
  return {
    total: section.lessons.length,
    done: section.lessons.filter((l) => completed.has(l.id)).length,
  };
}

export interface LessonPosition {
  lesson: ProductLesson;
  sectionIndex: number;
  indexInSection: number;
  /** 0-based across the whole course. */
  index: number;
}

export function positionsOf(levels: Level[]): LessonPosition[] {
  const out: LessonPosition[] = [];
  sectionsOf(levels).forEach((section, sectionIndex) => {
    section.lessons.forEach((lesson, indexInSection) => {
      out.push({ lesson: lesson as ProductLesson, sectionIndex, indexInSection, index: out.length });
    });
  });
  return out;
}

/** The first lesson not yet done, else the first lesson: what the Continue card opens. */
export function continueTarget(levels: Level[], completed: ReadonlySet<string>): ProductLesson | null {
  const all = positionsOf(levels);
  return (all.find((p) => !completed.has(p.lesson.id)) ?? all[0])?.lesson ?? null;
}

/** Immutable tree edits. Sections added from the builder go into the last level. */
export function addSection(levels: Level[], title = ''): Level[] {
  const base = levels.length ? levels : emptyCourseLevels().map((l) => ({ ...l, sections: [] }));
  return base.map((l, i) => (i === base.length - 1 ? { ...l, sections: [...l.sections, emptySection(title)] } : l));
}

export function updateSection(levels: Level[], sectionId: string, patch: Partial<Section>): Level[] {
  return levels.map((l) => ({ ...l, sections: l.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) }));
}

export function removeSection(levels: Level[], sectionId: string): Level[] {
  return levels.map((l) => ({ ...l, sections: l.sections.filter((s) => s.id !== sectionId) }));
}

export function addLesson(levels: Level[], sectionId: string, lesson: ProductLesson): Level[] {
  return updateSectionLessons(levels, sectionId, (ls) => [...ls, lesson]);
}

export function updateLesson(levels: Level[], lessonId: string, patch: Partial<ProductLesson>): Level[] {
  return levels.map((l) => ({
    ...l,
    sections: l.sections.map((s) => ({ ...s, lessons: s.lessons.map((x) => (x.id === lessonId ? { ...x, ...patch } : x)) })),
  }));
}

export function removeLesson(levels: Level[], lessonId: string): Level[] {
  return levels.map((l) => ({
    ...l,
    sections: l.sections.map((s) => ({ ...s, lessons: s.lessons.filter((x) => x.id !== lessonId) })),
  }));
}

/** Move a lesson up or down inside its own section. */
export function moveLesson(levels: Level[], lessonId: string, delta: -1 | 1): Level[] {
  return levels.map((l) => ({
    ...l,
    sections: l.sections.map((s) => {
      const from = s.lessons.findIndex((x) => x.id === lessonId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= s.lessons.length) return s;
      const next = [...s.lessons];
      [next[from], next[to]] = [next[to], next[from]];
      return { ...s, lessons: next };
    }),
  }));
}

function updateSectionLessons(levels: Level[], sectionId: string, fn: (ls: Lesson[]) => Lesson[]): Level[] {
  return levels.map((l) => ({ ...l, sections: l.sections.map((s) => (s.id === sectionId ? { ...s, lessons: fn(s.lessons) } : s)) }));
}
