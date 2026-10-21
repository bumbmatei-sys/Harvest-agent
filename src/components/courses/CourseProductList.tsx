'use client';

import { ArrowRight, BookOpen, Library, MoreVertical, PenLine, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { lessonsOf } from '@/lib/courses/lessons';
import { priceHeadline } from '@/lib/courses/page';
import type { LibraryCourse } from '@/types/course.types';
import type { ProductCourse } from '@/types/course-product.types';
import { cn } from '@/lib/utils';

function Cover({ src, icon }: { src?: string; icon: React.ReactNode }) {
  return (
    <div className="relative h-28 bg-surface-gold">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : null}
      <span aria-hidden className="absolute -bottom-6 left-4 flex size-12 items-center justify-center rounded-full border border-line bg-surface-raised text-muted [&_svg]:size-5">{icon}</span>
    </div>
  );
}

function OwnCard({ course, onEdit, onDelete }: { course: ProductCourse; onEdit: () => void; onDelete: () => void }) {
  const lessons = lessonsOf(course.levels ?? []).length;
  const published = course.status === 'published';
  const meta = [priceHeadline(course.price).amount, `${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}`].join(' · ');
  return (
    <li data-course-card={course.id}>
      <Card className="h-full gap-0 py-0">
        <div className="relative">
          <Cover src={course.coverImage || course.thumbnail} icon={<BookOpen />} />
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <Badge variant="secondary" data-course-status={published ? 'published' : 'draft'}>{published ? 'Published' : 'Draft'}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={`Actions for ${course.title || 'untitled course'}`} className={cn(buttonVariants({ variant: 'secondary', size: 'icon-sm' }), 'min-h-11 min-w-11')}>
                <MoreVertical />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}><PenLine />Edit</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={onDelete} data-delete-course={course.id}><Trash2 />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-9">
          <h3 className="line-clamp-1 text-base font-semibold text-strong">{course.title.trim() || 'Untitled course'}</h3>
          <p className="text-sm text-muted">Course · {meta}</p>
        </div>
        <div className="border-t border-line px-2 py-1">
          <Button type="button" variant="ghost" className="min-h-11 w-full justify-start gap-1.5 px-2 text-sm font-semibold text-strong" onClick={onEdit} data-edit-course={course.id}>
            {published ? 'Edit course' : 'Finish setup'}<ArrowRight aria-hidden />
          </Button>
        </div>
      </Card>
    </li>
  );
}

function AdoptedCard({ course, busy, onView, onRemove }: { course: LibraryCourse; busy: boolean; onView: () => void; onRemove: () => void }) {
  return (
    <li data-adopted-course-card={course.id}>
      <Card className="h-full gap-0 py-0">
        <div className="relative">
          <Cover src={course.thumbnail} icon={<Library />} />
          <Badge variant="secondary" className="absolute right-3 top-3">Adopted</Badge>
        </div>
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-9">
          <h3 className="line-clamp-1 text-base font-semibold text-strong">{course.title}</h3>
          <p className="text-sm text-muted">From the Harvest library</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1">
          <Button type="button" variant="ghost" className="min-h-11 gap-1.5 px-2 text-sm font-semibold text-strong" onClick={onView} title={`Preview ${course.title}`}>
            View &amp; settings<ArrowRight aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11" disabled={busy} onClick={onRemove} aria-label={`Remove ${course.title} from your courses`} title="Remove from your courses">
            <Trash2 />
          </Button>
        </div>
      </Card>
    </li>
  );
}

/**
 * The products list: one card per course, a Draft or Published badge, its price
 * and lesson count, and "Finish setup" until it is live. Adopted library courses
 * sit beside the ministry's own and stay read-only, as before.
 */
export function CourseProductList({ courses, adopted, loading, adoptingId, onEdit, onDelete, onViewAdopted, onRemoveAdopted }: {
  courses: readonly ProductCourse[];
  adopted: readonly LibraryCourse[];
  loading: boolean;
  adoptingId: string | null;
  onEdit: (course: ProductCourse) => void;
  onDelete: (id: string) => void;
  onViewAdopted: (id: string) => void;
  onRemoveAdopted: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy aria-label="Loading courses">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full rounded-xl" />)}
      </div>
    );
  }
  if (courses.length === 0 && adopted.length === 0) {
    return (
      <Empty className="border border-dashed border-line py-14" data-courses-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><BookOpen /></EmptyMedia>
          <EmptyTitle>No courses found</EmptyTitle>
          <EmptyDescription>Get started by creating a new course, or adopt one from the library.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Courses">
      {courses.map((c) => (
        <OwnCard key={c.id} course={c} onEdit={() => onEdit(c)} onDelete={() => c.id && onDelete(c.id)} />
      ))}
      {adopted.map((c) => (
        <AdoptedCard key={`adopted-${c.id}`} course={c} busy={adoptingId === c.id} onView={() => onViewAdopted(c.id)} onRemove={() => onRemoveAdopted(c.id)} />
      ))}
    </ul>
  );
}
