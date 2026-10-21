'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Segmented, type Option } from '@/components/email/kit';
import { LessonBodyEditor } from '@/components/courses/builder/LessonBodyEditor';
import { LESSON_TYPE_HINT, LESSON_TYPE_LABEL, lessonProblem, lessonTypeOf, newId } from '@/lib/courses/lessons';
import { LESSON_TYPES, type LessonType, type ProductLesson } from '@/types/course-product.types';
import type { QuizQuestion } from '@/types/course.types';

const TYPE_OPTIONS: readonly Option<LessonType>[] = LESSON_TYPES.map((t) => ({ value: t, label: LESSON_TYPE_LABEL[t] }));

const newQuestion = (): QuizQuestion => ({
  id: newId(),
  q: '',
  options: [
    { id: newId(), text: '', correct: true },
    { id: newId(), text: '', correct: false },
  ],
});

function QuizEditor({ quiz, onChange }: { quiz: QuizQuestion[]; onChange: (next: QuizQuestion[]) => void }) {
  const setQuestion = (id: string, patch: Partial<QuizQuestion>) => onChange(quiz.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  return (
    <div className="flex flex-col gap-4">
      {quiz.map((q, qi) => (
        <div key={q.id} className="flex flex-col gap-3 rounded-lg border border-line p-3" data-quiz-question>
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor={`q-${q.id}`}>Question {qi + 1}</Label>
              <Input id={`q-${q.id}`} value={q.q} onChange={(e) => setQuestion(q.id, { q: e.target.value })} placeholder="What did we learn today?" />
            </div>
            <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 mt-6" aria-label={`Remove question ${qi + 1}`} onClick={() => onChange(quiz.filter((x) => x.id !== q.id))}><Trash2 /></Button>
          </div>
          <RadioGroup
            value={q.options.find((o) => o.correct)?.id ?? ''}
            onValueChange={(id: unknown) => setQuestion(q.id, { options: q.options.map((o) => ({ ...o, correct: o.id === String(id) })) })}
            aria-label={`Correct answer for question ${qi + 1}`}
            className="gap-2"
          >
            {q.options.map((o, oi) => (
              <div key={o.id} className="flex items-center gap-2">
                <RadioGroupItem value={o.id} aria-label={`Option ${oi + 1} is correct`} />
                <Input
                  value={o.text}
                  aria-label={`Option ${oi + 1}`}
                  onChange={(e) => setQuestion(q.id, { options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                  placeholder={`Answer ${oi + 1}`}
                />
              </div>
            ))}
          </RadioGroup>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 w-fit gap-1.5" onClick={() => setQuestion(q.id, { options: [...q.options, { id: newId(), text: '', correct: false }] })}>
            <Plus aria-hidden />Add an answer
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="min-h-11 w-fit gap-1.5" onClick={() => onChange([...quiz, newQuestion()])}>
        <Plus aria-hidden />Add a quiz question
      </Button>
    </div>
  );
}

/**
 * One lesson, edited in a side sheet. The type decides what is asked for: a
 * Text lesson never shows a video field and never needs one, a Video lesson
 * needs a YouTube link, Video + text takes both. Changes are held until Done so
 * closing the sheet with Cancel leaves the lesson as it was.
 */
export function LessonSheet({ lesson, onDone, onClose }: { lesson: ProductLesson | null; onDone: (lesson: ProductLesson) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<ProductLesson | null>(lesson);
  useEffect(() => { setDraft(lesson); }, [lesson]);

  const type = draft ? lessonTypeOf(draft) : 'text';
  const problem = draft ? lessonProblem(draft) : null;
  const set = (patch: Partial<ProductLesson>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <Sheet open={lesson !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl" data-lesson-sheet>
        <SheetHeader className="border-b border-line">
          <SheetTitle className="font-display text-lg text-strong">{draft?.title.trim() || 'New lesson'}</SheetTitle>
          <SheetDescription>{LESSON_TYPE_HINT[type]}</SheetDescription>
        </SheetHeader>
        {draft && (
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lesson-title">Title</Label>
              <Input id="lesson-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Find your angle" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Segmented
                label="Lesson type"
                value={type}
                options={TYPE_OPTIONS}
                onChange={(next) => set({ type: next, body: next === 'video' ? draft.body : draft.body || '<p></p>' })}
              />
            </div>
            {type !== 'text' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lesson-video">YouTube link</Label>
                <Input id="lesson-video" value={draft.youtubeUrl ?? ''} onChange={(e) => set({ youtubeUrl: e.target.value, youtubeId: undefined })} placeholder="https://www.youtube.com/watch?v=…" inputMode="url" />
                <p className="text-xs text-muted">Paste the address of an unlisted or public video.</p>
              </div>
            )}
            {type !== 'video' && (
              <div className="flex flex-col gap-1.5">
                <Label>{type === 'text' ? 'Lesson' : 'Lesson text'}</Label>
                <LessonBodyEditor html={draft.body ?? '<p></p>'} onChange={(html) => set({ body: html })} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lesson-duration">Length (optional)</Label>
              <Input id="lesson-duration" value={draft.duration} onChange={(e) => set({ duration: e.target.value })} placeholder="10 min" className="sm:max-w-40" />
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-semibold text-strong">Quiz</p>
                <p className="text-xs text-muted">Optional. Members see it under the lesson.</p>
              </div>
              <QuizEditor quiz={draft.quiz ?? []} onChange={(quiz) => set({ quiz })} />
            </div>
          </div>
        )}
        <SheetFooter className="flex-row items-center justify-between gap-3 border-t border-line">
          <span className="text-xs text-muted" data-lesson-problem>{problem ? `This lesson ${problem}.` : ''}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>Cancel</Button>
            <Button type="button" className="min-h-11 px-5" disabled={!draft || !draft.title.trim()} onClick={() => draft && onDone(draft)}>Done</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
