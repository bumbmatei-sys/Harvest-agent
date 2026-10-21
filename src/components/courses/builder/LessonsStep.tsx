'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, FileText, MoreVertical, PenLine, Play, Plus, Trash2, Type } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LessonSheet } from '@/components/courses/builder/LessonSheet';
import { Card, StepSection } from '@/components/courses/builder/kit';
import {
  addLesson, addSection, emptyLesson, lessonProblem, lessonTypeOf, moveLesson, removeLesson, removeSection,
  sectionsOf, updateLesson, updateSection, LESSON_TYPE_LABEL,
} from '@/lib/courses/lessons';
import { LESSON_TYPES, type LessonType, type ProductCourse, type ProductLesson } from '@/types/course-product.types';
import { cn } from '@/lib/utils';

const TYPE_ICON: Record<LessonType, React.ReactNode> = {
  text: <Type />,
  video: <Play />,
  'video-text': <FileText />,
};

const EXAMPLES = ['Find your angle', 'Write the first draft'];

function AddLessonMenu({ onPick, label }: { onPick: (type: LessonType) => void; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-11 gap-1.5 px-2')} aria-label={label}>
        <Plus aria-hidden />{label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {LESSON_TYPES.map((t) => (
          <DropdownMenuItem key={t} onClick={() => onPick(t)} data-new-lesson={t}>
            <span aria-hidden className="[&_svg]:size-4">{TYPE_ICON[t]}</span>{LESSON_TYPE_LABEL[t]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LessonRow({ lesson, number, onEdit, onMove, onDelete }: {
  lesson: ProductLesson;
  number: number;
  onEdit: () => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const type = lessonTypeOf(lesson);
  const problem = lessonProblem(lesson);
  return (
    <li className="flex items-center gap-1 border-t border-line first:border-t-0" data-lesson-row={lesson.id}>
      <Button type="button" variant="ghost" onClick={onEdit} className="min-h-11 h-auto flex-1 justify-start gap-3 rounded-none px-3 py-2 text-left font-normal">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted [&_svg]:size-4">{TYPE_ICON[type]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-strong">{lesson.title.trim() || `Lesson ${number}`}</span>
          <span className="block text-xs text-muted">
            {LESSON_TYPE_LABEL[type]}{problem ? ` · ${problem}` : ''}
          </span>
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Actions for ${lesson.title.trim() || `lesson ${number}`}`} className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'min-h-11 min-w-11')}>
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}><PenLine />Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(-1)}><ArrowUp />Move up</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(1)}><ArrowDown />Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete} data-delete-lesson><Trash2 />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * The course's own step: numbered sections holding lessons, each lesson Text,
 * Video or Video + text. A course made only of text lessons is complete here;
 * nothing on this step asks for a video.
 */
export function LessonsStep({ course, onChange }: { course: ProductCourse; onChange: (patch: Partial<ProductCourse>) => void }) {
  const [editing, setEditing] = useState<ProductLesson | null>(null);
  const sections = sectionsOf(course.levels);
  const lessonCount = sections.reduce((n, s) => n + s.lessons.length, 0);
  const setLevels = (levels: ProductCourse['levels']) => onChange({ levels });

  const createLesson = (sectionId: string, type: LessonType) => {
    const lesson = emptyLesson(type);
    setLevels(addLesson(course.levels, sectionId, lesson));
    setEditing(lesson);
  };

  let counter = 0;
  return (
    <>
      <StepSection
        title="Lessons"
        description="What people read or watch, in this order, with a checkmark on each one they finish. Add sections when there is enough to go in order."
      >
        <div className="flex flex-col gap-4">
          {lessonCount === 0 && (
            <Card className="opacity-60"><ul aria-label="Example lessons" data-example-lessons>
              {EXAMPLES.map((title) => (
                <li key={title} className="flex items-center gap-3 border-t border-line px-3 py-3 first:border-t-0">
                  <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-surface-sunken text-muted [&_svg]:size-4"><FileText /></span>
                  <span>
                    <span className="block text-sm font-medium text-strong">{title}</span>
                    <span className="block text-xs text-muted">Example lesson</span>
                  </span>
                </li>
              ))}
            </ul></Card>
          )}

          {sections.map((section, si) => (
            <Card key={section.id} className="divide-y-0"><div data-section={section.id}>
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted">{si + 1}</span>
                <Label htmlFor={`section-${section.id}`} className="sr-only">Section {si + 1} title</Label>
                <Input
                  id={`section-${section.id}`}
                  value={section.title}
                  onChange={(e) => setLevels(updateSection(course.levels, section.id, { title: e.target.value }))}
                  placeholder="Section title"
                  className="h-11 border-transparent bg-transparent font-semibold shadow-none"
                />
                <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11" aria-label={`Delete section ${si + 1}`} onClick={() => setLevels(removeSection(course.levels, section.id))}>
                  <Trash2 />
                </Button>
              </div>
              {section.lessons.length > 0 && (
                <ul>
                  {section.lessons.map((lesson) => {
                    counter += 1;
                    return (
                      <LessonRow
                        key={lesson.id}
                        lesson={lesson as ProductLesson}
                        number={counter}
                        onEdit={() => setEditing(lesson as ProductLesson)}
                        onMove={(d) => setLevels(moveLesson(course.levels, lesson.id, d))}
                        onDelete={() => setLevels(removeLesson(course.levels, lesson.id))}
                      />
                    );
                  })}
                </ul>
              )}
              <div className="border-t border-line px-2 py-1">
                <AddLessonMenu label="New lesson" onPick={(t) => createLesson(section.id, t)} />
              </div>
            </div></Card>
          ))}

          <Button type="button" variant="outline" className="min-h-11 w-full gap-1.5 border-dashed font-normal text-muted" onClick={() => setLevels(addSection(course.levels))}>
            <Plus aria-hidden />Add section
          </Button>
        </div>
      </StepSection>

      <StepSection title="When members finish" description="What happens after the last lesson.">
        <Card>
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div>
              <Label htmlFor="issue-certificate" className="text-sm font-medium text-strong">Give a certificate</Label>
              <p className="text-xs text-muted">Members can download one when every lesson is done.</p>
            </div>
            <Switch id="issue-certificate" checked={course.issueCertificate === true} onCheckedChange={(v) => onChange({ issueCertificate: v })} />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div>
              <Label htmlFor="require-quiz" className="text-sm font-medium text-strong">Require passing the quizzes</Label>
              <p className="text-xs text-muted">A lesson with a quiz is only done once the quiz is passed.</p>
            </div>
            <Switch id="require-quiz" checked={course.requireQuiz === true} onCheckedChange={(v) => onChange({ requireQuiz: v })} />
          </div>
        </Card>
      </StepSection>

      <LessonSheet
        lesson={editing}
        onClose={() => setEditing(null)}
        onDone={(lesson) => { setLevels(updateLesson(course.levels, lesson.id, lesson)); setEditing(null); }}
      />
    </>
  );
}
