'use client';

import { Check, FileText, Play, Type } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { describeAccess, type CourseAccessResult } from '@/lib/courses/access';
import { LESSON_TYPE_LABEL, lessonTypeOf, sectionsOf } from '@/lib/courses/lessons';
import { DEFAULT_INCLUDED, PAID_COMING_LATER, descriptionBlocks, priceHeadline } from '@/lib/courses/page';
import type { LessonType, ProductCourse, ProductLesson } from '@/types/course-product.types';

const TYPE_ICON: Record<LessonType, React.ReactNode> = { text: <Type />, video: <Play />, 'video-text': <FileText /> };

export interface CourseLandingProps {
  course: ProductCourse;
  /** `preview` is the builder's live pane and the admin's "preview as member". */
  mode: 'preview' | 'member';
  /** Required for `member`: whether this person may open it. */
  access?: CourseAccessResult;
  /** Lessons this person has finished, for the Continue wording. */
  doneCount?: number;
  onStart?: () => void;
}

/**
 * The course's own page: title, who teaches it, the offer card with what is
 * included, a description and what is inside. It is the member's first view of a
 * course and the builder's live preview, so the two cannot drift apart.
 */
export function CourseLanding({ course, mode, access, doneCount = 0, onStart }: CourseLandingProps) {
  const price = priceHeadline(course.price);
  const sections = sectionsOf(course.levels);
  const lessonTotal = sections.reduce((n, s) => n + s.lessons.length, 0);
  const author = course.author?.trim();
  const included = (course.included && course.included.length ? course.included : DEFAULT_INCLUDED).filter((i) => i.trim());
  const description = descriptionBlocks(course.description);
  const locked = mode === 'member' && access !== undefined && !access.allowed;
  const startLabel = course.buttonText?.trim()
    || (mode === 'preview' ? (price.amount === 'Free' ? 'Get it free' : `Get it for ${price.amount}`) : doneCount > 0 ? 'Continue' : 'Start course');

  return (
    <article className="mx-auto flex w-full max-w-[660px] flex-col gap-6 px-5 py-8" data-course-landing={mode}>
      {mode === 'preview' && (
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-center text-xs text-muted">Preview. Updates as you edit. Checkout is off.</p>
      )}

      {course.coverImage || course.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={course.coverImage || course.thumbnail} alt="" className="aspect-[16/9] w-full rounded-brand-lg border border-line object-cover" />
      ) : null}

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-strong break-words" data-landing-title>
          {course.title.trim() || 'Untitled course'}
        </h1>
        {course.tagline?.trim() && <p className="text-lg text-muted">{course.tagline.trim()}</p>}
        {author && <p className="text-sm text-muted">By <span className="font-medium text-strong">{author}</span></p>}
        <div className="pt-1">
          <Button
            type="button"
            className="min-h-11 rounded-full px-6 text-sm"
            disabled={mode === 'preview' || locked || lessonTotal === 0}
            onClick={onStart}
            data-landing-cta
          >
            {locked ? 'Not included' : startLabel}
          </Button>
        </div>
        {locked && access && <p className="text-sm text-muted" data-landing-locked>{describeAccess(access.reason)} Ask your ministry for access.</p>}
        {mode === 'member' && !locked && lessonTotal === 0 && <p className="text-sm text-muted">The lessons are still being written.</p>}
      </header>

      <Card className="gap-5 p-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-3xl font-semibold text-strong" data-landing-price>{price.amount}</span>
          <span className="text-sm text-muted">{price.note}</span>
        </div>
        {mode === 'preview' && course.price && course.price.mode !== 'free' && (
          <p className="text-xs text-muted" data-landing-checkout-note>{PAID_COMING_LATER}</p>
        )}
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-xs font-medium text-muted">What&apos;s included</p>
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-body">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-field-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        {author && <p className="border-t border-line pt-4 text-xs text-muted">By {author}</p>}
      </Card>

      {description && (
        <Card className="gap-3 p-6">
          <p className="text-xs font-medium text-muted">What this is</p>
          <h2 className="font-display text-2xl font-semibold text-strong">{author ? `This is ${author}'s course, ready to take.` : 'A course, ready to take.'}</h2>
          {'html' in description ? (
            <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: description.html }} />
          ) : (
            <div className="flex flex-col gap-3 text-base leading-7 text-body">
              {description.paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
            </div>
          )}
        </Card>
      )}

      {lessonTotal > 0 && (
        <Card className="gap-4 p-6" data-landing-curriculum>
          <p className="text-xs font-medium text-muted">What&apos;s inside · {lessonTotal} {lessonTotal === 1 ? 'lesson' : 'lessons'}</p>
          <ol className="flex flex-col gap-5">
            {sections.filter((s) => s.lessons.length > 0).map((section, si) => (
              <li key={section.id}>
                <p className="flex items-center gap-2.5 text-sm font-semibold text-strong">
                  <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted">{si + 1}</span>
                  {section.title.trim() || `Section ${si + 1}`}
                </p>
                <ul className="mt-2 flex flex-col">
                  {section.lessons.map((lesson) => {
                    const type = lessonTypeOf(lesson as ProductLesson);
                    return (
                      <li key={lesson.id} className="flex items-center gap-3 border-t border-line py-2.5 text-sm text-body first:border-t-0">
                        <span aria-hidden className="text-muted [&_svg]:size-4">{TYPE_ICON[type]}</span>
                        <span className="min-w-0 flex-1 truncate">{lesson.title.trim() || 'Untitled lesson'}</span>
                        {type !== 'text' && <Badge variant="outline">{LESSON_TYPE_LABEL[type]}</Badge>}
                        {lesson.duration && <span className="text-xs text-muted">{lesson.duration}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {course.signOff?.trim() && <p className="text-center text-sm text-muted">{course.signOff.trim()}</p>}
    </article>
  );
}
