'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNote } from '@/components/email/kit';
import { auth, db } from '@/firebase';
import { coursesForCommunity } from '@/lib/courses/access';
import { lessonsOf } from '@/lib/courses/lessons';
import { fetchMemberCourses } from '@/utils/member-courses';
import { COURSE_STATUS_CTA, COURSE_STATUS_LABEL, getCourseStatus } from '@/utils/course.utils';
import type { Course, QuizAttempt } from '@/types/course.types';
import type { ProductCourse } from '@/types/course-product.types';

type ClassroomCourse = ProductCourse & { id: string };

/**
 * A community's Classroom: the courses attached to it, as cards that open in the
 * course player. It is presentational — the host decides which courses it gets —
 * so the Community remodel can mount it as a tab without owning any course logic.
 */
export function ClassroomTab({ courses, completed, quizAttempts, onOpenCourse, communityName }: {
  courses: readonly ClassroomCourse[];
  completed: ReadonlySet<string>;
  quizAttempts?: Record<string, QuizAttempt>;
  onOpenCourse: (courseId: string) => void;
  communityName?: string;
}) {
  if (courses.length === 0) {
    return (
      <Empty className="border border-dashed border-line py-14" data-classroom-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><GraduationCap /></EmptyMedia>
          <EmptyTitle>No courses in the Classroom yet</EmptyTitle>
          <EmptyDescription>
            {communityName ? `Courses attached to ${communityName} will appear here.` : 'Courses attached to this community will appear here.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Classroom" data-classroom>
      {courses.map((course) => {
        const lessons = lessonsOf(course.levels ?? []);
        const done = lessons.filter((l) => completed.has(l.id)).length;
        const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0;
        const status = getCourseStatus(course as unknown as Course, completed, quizAttempts ?? {});
        return (
          <li key={course.id} data-classroom-course={course.id}>
            <Card className="h-full gap-0 py-0">
              <div className="relative h-32 bg-surface-gold">
                {(course.coverImage || course.thumbnail) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={course.coverImage || course.thumbnail} alt="" className="size-full object-cover" />
                ) : (
                  <span aria-hidden className="absolute inset-0 flex items-center justify-center text-wheat-800 [&_svg]:size-8"><BookOpen /></span>
                )}
                <Badge variant="secondary" className="absolute right-3 top-3" data-classroom-status={status}>{COURSE_STATUS_LABEL[status]}</Badge>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <h3 className="line-clamp-2 text-base font-semibold text-strong">{course.title}</h3>
                  {course.author && <p className="mt-0.5 text-sm text-muted">By {course.author}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Progress value={pct} aria-label={`${course.title} progress`} />
                  <p className="text-xs text-muted">{done} of {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'} done</p>
                </div>
              </div>
              <div className="border-t border-line px-2 py-1">
                <Button type="button" variant="ghost" className="min-h-11 w-full justify-between px-2 text-sm font-semibold text-strong" onClick={() => onOpenCourse(course.id)} data-open-course={course.id}>
                  {COURSE_STATUS_CTA[status]}<ArrowRight aria-hidden />
                </Button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

type Loaded =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; courses: ClassroomCourse[]; completed: Set<string>; quizAttempts: Record<string, QuizAttempt> };

/**
 * The Classroom tab with its data: reads the member's courses, keeps those
 * attached to this community that the person may open, and reads their progress.
 * `memberCommunityIds` comes from the host, which knows which communities the
 * person belongs to.
 */
export function CommunityClassroom({ communityId, communityName, memberCommunityIds, onOpenCourse }: {
  communityId: string;
  communityName?: string;
  memberCommunityIds: readonly string[];
  onOpenCourse: (courseId: string) => void;
}) {
  const [state, setState] = useState<Loaded>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    const uid = auth.currentUser?.uid ?? null;
    (async () => {
      const [all, progress] = await Promise.all([
        fetchMemberCourses(),
        uid ? getDoc(doc(db, 'users', uid)) : Promise.resolve(null),
      ]);
      const data = progress && progress.exists() ? progress.data() : {};
      const courses = coursesForCommunity(all as ClassroomCourse[], communityId, { userId: uid, communityIds: memberCommunityIds });
      setState({
        status: 'ready',
        courses,
        completed: new Set<string>(Array.isArray(data.completedLessons) ? data.completedLessons : []),
        quizAttempts: (data.quizAttempts ?? {}) as Record<string, QuizAttempt>,
      });
    })().catch(() => setState({ status: 'error' }));
  }, [communityId, memberCommunityIds]);

  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') {
    return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-60 w-full rounded-xl" />)}</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3" data-classroom-error>
        <ErrorNote>The Classroom could not be loaded, so this is not an empty list.</ErrorNote>
        <Button type="button" variant="outline" className="min-h-11" onClick={load}>Try again</Button>
      </div>
    );
  }
  return <ClassroomTab courses={state.courses} completed={state.completed} quizAttempts={state.quizAttempts} onOpenCourse={onOpenCourse} communityName={communityName} />;
}
