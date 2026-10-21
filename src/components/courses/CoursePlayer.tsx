'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactPlayer from 'react-player/youtube';
import { ArrowLeft, ArrowRight, Check, Circle, ListChecks, MessageCircle, NotebookPen, Play, X } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { QuizPanel } from '@/components/course/QuizPanel';
import { requestCertificate } from '@/lib/courses/certificate';
import {
  bodyText, continueTarget, hasBody, hasVideo, positionsOf, sectionProgress, sectionsOf, videoUrlOf,
} from '@/lib/courses/lessons';
import type { ProductCourse, ProductLesson } from '@/types/course-product.types';
import type { Author, QuizAttempt } from '@/types/course.types';
import { applyCourseOverrides } from '@/utils/course-adoption';
import { verifyCourseCompletion } from '@/utils/course.utils';
import { sanitizeHtml } from '@/utils/sanitize';
import type { AdoptedCourse } from '@/types/course.types';

type RailTab = 'lessons' | 'chats' | 'notes';

export interface CoursePlayerProps {
  course: ProductCourse & { id: string };
  authors?: Author[];
  adoption?: Pick<AdoptedCourse, 'requireQuiz' | 'issueCertificate'> | null;
  lessonId: string;
  completed: ReadonlySet<string>;
  quizAttempts?: Record<string, QuizAttempt>;
  lessonNotes?: Record<string, string>;
  onSelectLesson: (lesson: ProductLesson) => void;
  onToggleComplete: (lessonId: string) => void;
  onQuizSubmit: (lessonId: string, attempt: QuizAttempt) => void;
  onSaveNote: (lessonId: string, text: string) => void;
  /** Leaves the player (the X, and the end of the last lesson). */
  onClose: () => void;
}

const RAIL_TABS: readonly { id: RailTab; label: string; icon: React.ReactNode }[] = [
  { id: 'lessons', label: 'Lessons', icon: <ListChecks /> },
  { id: 'chats', label: 'Chats', icon: <MessageCircle /> },
  { id: 'notes', label: 'Notes', icon: <NotebookPen /> },
];

function RailTabs({ tab, onTab, vertical }: { tab: RailTab; onTab: (t: RailTab) => void; vertical: boolean }) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(String(v) as RailTab)} className="gap-0">
      <TabsList
        aria-label="Course panels"
        variant="default"
        className={vertical ? 'h-auto w-full flex-col gap-1 bg-transparent p-0' : 'h-auto w-full bg-transparent p-0'}
      >
        {RAIL_TABS.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            data-rail-tab={t.id}
            className="h-auto min-h-11 flex-col gap-1 py-2 text-[11px] data-active:bg-surface-sunken data-active:text-strong"
          >
            {t.icon}
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function LessonsPanel({ course, current, completed, onSelect, onContinue, certificate }: {
  course: ProductCourse;
  current: string;
  completed: ReadonlySet<string>;
  onSelect: (l: ProductLesson) => void;
  onContinue: () => void;
  certificate: React.ReactNode;
}) {
  const sections = sectionsOf(course.levels);
  const all = positionsOf(course.levels);
  const done = all.filter((p) => completed.has(p.lesson.id)).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  const next = continueTarget(course.levels, completed);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <Avatar size="lg" className="size-10">
          {(course.coverImage || course.thumbnail) && <AvatarImage src={course.coverImage || course.thumbnail} alt="" />}
          <AvatarFallback className="bg-surface-gold font-semibold text-wheat-800">{course.title.trim().charAt(0).toUpperCase() || 'C'}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-strong" data-rail-title>{course.title}</p>
          {course.author && <p className="truncate text-xs text-muted">By {course.author}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-1">
        <Progress value={pct} aria-label="Course progress" />
        <div className="flex justify-between text-xs text-muted" data-rail-progress>
          <span>{done} of {all.length} lessons done</span>
          <span>{pct}%</span>
        </div>
      </div>
      {next && (
        <Button type="button" className="min-h-14 h-auto w-full justify-start gap-3 rounded-brand px-3 py-2 text-left" onClick={onContinue} data-continue>
          <Play aria-hidden className="size-5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{done === 0 ? 'Start' : done === all.length ? 'Review' : 'Continue'}</span>
            <span className="block truncate text-xs font-normal opacity-80">{next.title}</span>
          </span>
        </Button>
      )}
      {certificate}
      <ScrollArea className="min-h-0 flex-1">
        <ol className="flex flex-col gap-4 pr-2">
          {sections.map((section, si) => {
            const p = sectionProgress(section, completed);
            return (
              <li key={section.id} data-rail-section={section.id}>
                <div className="flex items-center gap-3 px-1 pb-1">
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted">{si + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-strong">{section.title.trim() || `Section ${si + 1}`}</p>
                    <p className="text-xs text-muted">{p.done} of {p.total} done</p>
                  </div>
                </div>
                <ul className="flex flex-col">
                  {section.lessons.map((lesson) => {
                    const active = lesson.id === current;
                    const isDone = completed.has(lesson.id);
                    return (
                      <li key={lesson.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          data-rail-lesson={lesson.id}
                          data-active={active ? 'true' : 'false'}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => onSelect(lesson as ProductLesson)}
                          className="min-h-11 w-full justify-start gap-3 rounded-brand px-3 text-left text-sm font-normal text-body data-[active=true]:bg-surface-sunken data-[active=true]:font-medium data-[active=true]:text-strong"
                        >
                          {isDone
                            ? <Check aria-hidden className="size-4 shrink-0 rounded-full bg-action p-0.5 text-action-foreground" />
                            : <Circle aria-hidden className="size-4 shrink-0 text-faint" />}
                          <span className="min-w-0 truncate">{lesson.title.trim() || 'Untitled lesson'}</span>
                          <span className="sr-only">{isDone ? ' (done)' : ''}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </ScrollArea>
    </div>
  );
}

function NotesPanel({ course, notes, onOpen }: { course: ProductCourse; notes: Record<string, string>; onOpen: (l: ProductLesson) => void }) {
  const withNotes = positionsOf(course.levels).filter((p) => (notes[p.lesson.id] ?? '').trim());
  if (withNotes.length === 0) {
    return (
      <Empty className="border-0 py-10" data-notes-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><NotebookPen /></EmptyMedia>
          <EmptyTitle>No notes yet</EmptyTitle>
          <EmptyDescription>Open Notes on any lesson to write something down. It is kept here, just for you.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="flex flex-col gap-1 pr-2" aria-label="Your notes">
        {withNotes.map((p) => (
          <li key={p.lesson.id}>
            <Button type="button" variant="ghost" className="h-auto min-h-11 w-full flex-col items-start gap-0.5 whitespace-normal rounded-brand px-3 py-2 text-left" onClick={() => onOpen(p.lesson)} data-note-item={p.lesson.id}>
              <span className="text-sm font-medium text-strong">{p.lesson.title}</span>
              <span className="line-clamp-2 text-xs font-normal text-muted">{notes[p.lesson.id]}</span>
            </Button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

function ChatsPanel() {
  return (
    <Empty className="border-0 py-10" data-chats-empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><MessageCircle /></EmptyMedia>
        <EmptyTitle>Chats are coming soon</EmptyTitle>
        <EmptyDescription>Asking questions about a lesson will live here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The member's reading and watching screen, laid out like Eden's player: a rail
 * with Lessons, Chats and Notes, a progress bar and a Continue card above
 * numbered sections, a centred reading column, and a footer of Previous and
 * "Mark done and next". A text lesson is just the reading column; a video lesson
 * puts the video above it.
 */
export function CoursePlayer({
  course: rawCourse, adoption, lessonId, completed, quizAttempts, lessonNotes = {}, onSelectLesson,
  onToggleComplete, onQuizSubmit, onSaveNote, onClose,
}: CoursePlayerProps) {
  const course = useMemo(() => applyCourseOverrides(rawCourse, adoption) as typeof rawCourse, [rawCourse, adoption]);
  const [tab, setTab] = useState<RailTab>('lessons');
  const [railOpen, setRailOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const all = useMemo(() => positionsOf(course.levels), [course.levels]);
  const index = Math.max(0, all.findIndex((p) => p.lesson.id === lessonId));
  const here = all[index];
  const lesson = here?.lesson;
  const previous = all[index - 1]?.lesson;
  const next = all[index + 1]?.lesson;
  const isDone = lesson ? completed.has(lesson.id) : false;

  useEffect(() => {
    setDraft(lesson ? lessonNotes[lesson.id] ?? '' : '');
    setNoteSaved(false);
    scroller.current?.scrollTo?.({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id]);

  if (!lesson || !here) {
    return (
      <Empty className="min-h-80" data-player-empty>
        <EmptyHeader><EmptyTitle>This lesson is not in the course</EmptyTitle><EmptyDescription>It may have been removed. Pick another from the list.</EmptyDescription></EmptyHeader>
        <Button type="button" className="min-h-11" onClick={onClose}>Back to the course</Button>
      </Empty>
    );
  }

  const section = sectionsOf(course.levels)[here.sectionIndex];
  const quiz = lesson.quiz ?? [];
  const attempt = quizAttempts?.[lesson.id];
  const quizGate = quiz.length > 0 && course.requireQuiz === true && !attempt?.passed && !isDone;
  const completion = verifyCourseCompletion(course, completed, quizAttempts ?? {});
  const certEligible = course.issueCertificate === true && completion.complete;
  const videoUrl = hasVideo(lesson) ? videoUrlOf(lesson) : '';
  const words = hasBody(lesson) && bodyText(lesson) ? sanitizeHtml(lesson.body ?? '') : '';

  const select = (l: ProductLesson) => { setRailOpen(false); onSelectLesson(l); };
  const markDoneAndNext = () => {
    if (quizGate) return;
    if (!isDone) onToggleComplete(lesson.id);
    if (next) select(next); else onClose();
  };
  const downloadCertificate = async () => {
    setCertBusy(true);
    setCertError(null);
    try {
      window.open(await requestCertificate(course.id), '_blank', 'noopener,noreferrer');
    } catch (e) {
      setCertError(e instanceof Error ? e.message : 'Could not generate your certificate.');
    } finally {
      setCertBusy(false);
    }
  };

  const certificate = certEligible ? (
    <div className="flex flex-col gap-2 rounded-brand bg-surface-gold p-3" data-certificate>
      <p className="text-sm font-semibold text-strong">You finished the course.</p>
      <Button type="button" variant="outline" className="min-h-11" disabled={certBusy} onClick={() => void downloadCertificate()}>
        {certBusy ? 'Preparing…' : 'Download certificate'}
      </Button>
      {certError && <p role="alert" className="text-xs text-danger">{certError}</p>}
    </div>
  ) : null;

  const panel = tab === 'lessons'
    ? <LessonsPanel course={course} current={lesson.id} completed={completed} onSelect={select} onContinue={() => { const t = continueTarget(course.levels, completed); if (t) select(t); }} certificate={certificate} />
    : tab === 'notes'
      ? <NotesPanel course={course} notes={lessonNotes} onOpen={(l) => { select(l); setNotesOpen(true); }} />
      : <ChatsPanel />;

  return (
    <div className="flex h-[100dvh] min-h-[560px] w-full gap-3 bg-surface p-3" data-course-player>
      <div className="hidden w-16 shrink-0 flex-col lg:flex">
        <RailTabs tab={tab} onTab={setTab} vertical />
      </div>
      <aside className="hidden w-[296px] shrink-0 flex-col rounded-brand-lg border border-line bg-surface-raised p-3 lg:flex" aria-label="Course contents">
        {panel}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-brand-lg border border-line bg-surface-raised" aria-label="Lesson">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-5">
          <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 lg:hidden" aria-label="Open the lesson list" onClick={() => setRailOpen(true)} data-open-rail>
            <ListChecks />
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm text-muted" data-player-crumb>
            {section?.title.trim() || `Section ${here.sectionIndex + 1}`} · Lesson {here.indexInSection + 1} of {section?.lessons.length ?? 1}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 gap-1.5 px-3 text-sm"
            aria-pressed={isDone}
            disabled={quizGate}
            onClick={() => onToggleComplete(lesson.id)}
            data-done-toggle
          >
            <Check aria-hidden className={isDone ? 'size-4 rounded-full bg-action p-0.5 text-action-foreground' : 'size-4'} />
            Done
          </Button>
          <Button type="button" variant="ghost" className="min-h-11 gap-1.5 px-3 text-sm" onClick={() => setNotesOpen(true)} data-open-notes>
            <NotebookPen aria-hidden />
            <span className="hidden sm:inline">Notes</span>
            <span className="sr-only sm:hidden">Notes</span>
          </Button>
          <Button type="button" variant="ghost" className="hidden min-h-11 gap-1.5 px-3 text-sm sm:inline-flex" disabled title="Chats are coming soon">
            <MessageCircle aria-hidden />Chat
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11" aria-label="Close the course" onClick={onClose} data-player-close>
            <X />
          </Button>
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <article className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-5 py-10 sm:px-8" data-reading-column data-lesson-kind={videoUrl ? (words ? 'video-text' : 'video') : 'text'}>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-strong" data-lesson-title>{lesson.title}</h1>
            {videoUrl && (
              <div className="relative aspect-video w-full overflow-hidden rounded-brand-lg border border-line bg-surface-night">
                <ReactPlayer url={videoUrl} width="100%" height="100%" controls playing={false} config={{ playerVars: { modestbranding: 1, rel: 0 } }} />
              </div>
            )}
            {words ? (
              <div className="prose prose-lg max-w-none prose-img:rounded-brand-lg" data-lesson-body dangerouslySetInnerHTML={{ __html: words }} />
            ) : !videoUrl ? (
              <p className="text-muted" data-lesson-blank>This lesson has no content yet.</p>
            ) : null}
            {quiz.length > 0 && (
              <section aria-label="Quiz" className="flex flex-col gap-3 border-t border-line pt-6" data-lesson-quiz>
                <h2 className="text-lg font-semibold text-strong">Check yourself</h2>
                <QuizPanel quiz={quiz} attempt={attempt} onSubmit={(result) => onQuizSubmit(lesson.id, result)} />
              </section>
            )}
          </article>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-3 py-3 sm:px-5" data-player-footer>
          {previous ? (
            <Button type="button" variant="outline" className="min-h-11 gap-1.5 rounded-full px-4" onClick={() => select(previous)} data-previous>
              <ArrowLeft aria-hidden />Previous
            </Button>
          ) : <span />}
          <div className="flex items-center gap-3">
            {quizGate && <span className="hidden text-xs text-muted sm:inline" data-quiz-gate>Pass the quiz to finish this lesson.</span>}
            <Button type="button" className="min-h-11 gap-1.5 rounded-full px-5" disabled={quizGate} onClick={markDoneAndNext} data-mark-next>
              {next ? 'Mark done and next' : 'Mark done and finish'}<ArrowRight aria-hidden />
            </Button>
          </div>
        </footer>
      </section>

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent side="left" className="w-[88%] gap-3 p-3 sm:max-w-sm" data-rail-sheet>
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Course contents</SheetTitle>
            <SheetDescription className="sr-only">Lessons, chats and notes for this course.</SheetDescription>
          </SheetHeader>
          <RailTabs tab={tab} onTab={setTab} vertical={false} />
          {panel}
        </SheetContent>
      </Sheet>

      <Sheet open={notesOpen} onOpenChange={setNotesOpen}>
        <SheetContent className="w-full gap-3 sm:max-w-md" data-notes-sheet>
          <SheetHeader>
            <SheetTitle className="font-display text-lg text-strong">Your notes</SheetTitle>
            <SheetDescription>{lesson.title}. Only you can see these.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 px-4">
            <Textarea
              aria-label="Notes for this lesson"
              rows={10}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setNoteSaved(false); }}
              placeholder="Write your notes for this lesson…"
            />
          </div>
          <SheetFooter className="flex-row items-center justify-between border-t border-line">
            <span role="status" className="text-xs text-muted">{noteSaved ? 'Saved' : ''}</span>
            <Button type="button" className="min-h-11 px-5" onClick={() => { onSaveNote(lesson.id, draft); setNoteSaved(true); }} data-save-note>Save</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

