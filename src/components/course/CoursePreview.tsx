"use client";
import React, { useState } from "react";
import ReactPlayer from "react-player/youtube";
import { ArrowLeft, Check, Library, PlayCircle } from "lucide-react";
import { Author, Lesson, LibraryCourse, AdoptedCourse } from "../../types/course.types";
import { sanitizeHtml } from "../../utils/sanitize";
import { courseHasQuiz } from "../../utils/course-adoption";
import { AdminBadge, AdminPrimaryButton, AdminSecondaryButton, AdminCard } from "../admin/AdminUI";
import { CourseCurriculum } from "./CourseCurriculum";

/**
 * Read-only preview of a catalogue course, opened from the Library tab before
 * adopting.
 *
 * ⚠️ STRICTLY READ-ONLY. THIS COMPONENT PERFORMS NO WRITES OF ANY KIND, and that
 * is a hard requirement rather than an implementation detail. It records no
 * progress, no completedLessons, no quiz attempts, no lesson notes, no
 * lastWatchedVideo and no certificate eligibility. An admin deciding whether to
 * spend one of 2 or 5 plan slots must be able to look without leaving a trace in
 * their members' data — a preview that quietly wrote `lastWatchedVideo` would
 * put a course the church has not adopted onto the admin's own "continue
 * learning" rail.
 *
 * The one write reachable from this screen is ADOPTION itself, and it is the
 * caller's `onAdopt` — the same handler, and therefore the same POST payload, as
 * the catalogue card's Adopt button. Previewing never touches maxCourses.
 *
 * It takes no Firestore handle and no auth handle deliberately: everything it
 * renders is passed in, so there is nothing here that COULD write. The
 * read-only guard is structural, not a flag someone can flip.
 *
 * Reuse: the level/section/lesson tree is the shared <CourseCurriculum>, the
 * same one CourseOverview renders. Only the lesson row differs — here it expands
 * to an inline player instead of navigating into the member course player (which
 * is a write path).
 */

interface CoursePreviewProps {
  course: LibraryCourse;
  /** Merged author pool; a library course's authorIds resolve against libraryAuthors. */
  authors: Author[];
  onClose: () => void;
  onAdopt: (course: LibraryCourse) => void;
  isAdopted: boolean;
  /** Busy/blocked state mirrors the catalogue card's, so the two agree. */
  adoptBusy?: boolean;
  adoptBlocked?: boolean;
  blockedReason?: string;
  /** This tenant's overrides for the course, when adopted. */
  adoption?: AdoptedCourse | null;
  /** Persist an override. Absent ⇒ the toggles are not offered. */
  onSetOverride?: (field: 'requireQuiz' | 'issueCertificate', value: boolean) => void;
  overrideBusy?: boolean;
}

/** A lesson row that expands to reveal its video. Expanding writes nothing. */
function PreviewLesson({ lesson, num }: { lesson: Lesson; num: number }) {
  const [open, setOpen] = useState(false);
  // Same resolution LessonView uses — the existing embed, not a second one.
  const videoUrl = lesson.youtubeUrl
    || (lesson.youtubeId ? `https://www.youtube.com/watch?v=${lesson.youtubeId}` : "");

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 py-3 text-left hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors"
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border-[1.5px] border-line bg-surface-sunken text-muted">
          {num}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-body">{lesson.title}</div>
          <div className="text-xs text-faint mt-0.5">{lesson.duration || "~"}</div>
        </div>
        {videoUrl && (
          <PlayCircle
            size={18}
            className="text-gold shrink-0"
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}
          />
        )}
      </button>

      {open && (
        <div className="pb-3">
          {videoUrl ? (
            <div
              className="relative w-full bg-black rounded-brand overflow-hidden"
              style={{ aspectRatio: "16/9" }}
              data-testid={`preview-video-${lesson.id}`}
            >
              <ReactPlayer
                url={videoUrl}
                width="100%"
                height="100%"
                controls
                playing={false}
                config={{ playerVars: { modestbranding: 1, rel: 0 } }}
              />
            </div>
          ) : (
            <p className="text-xs text-faint py-2">No video for this lesson.</p>
          )}
          {lesson.summary && (
            <p className="text-sm text-muted leading-6 mt-3">{lesson.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** A tenant-owned toggle. Everything else on this screen is read-only. */
function OverrideToggle({
  label, description, checked, disabled, disabledReason, onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-10 h-6 rounded-full shrink-0 transition-colors relative ${
          checked ? 'bg-gold' : 'bg-line-strong'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-surface-raised transition-all"
          style={{ left: checked ? '1.125rem' : '0.125rem' }}
        />
      </button>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-strong">{label}</div>
        <p className="text-xs text-muted mt-0.5">{disabled && disabledReason ? disabledReason : description}</p>
      </div>
    </div>
  );
}

export function CoursePreview({
  course, authors, onClose, onAdopt, isAdopted,
  adoptBusy, adoptBlocked, blockedReason,
  adoption, onSetOverride, overrideBusy,
}: CoursePreviewProps) {
  const courseAuthors = (course.authorIds || [])
    .map((id) => authors.find((a) => a.id === id))
    .filter(Boolean) as Author[];

  const lessonCount = (course.levels || []).reduce(
    (sum, lv) => sum + (lv.sections || []).reduce((n, sec) => n + (sec.lessons?.length || 0), 0),
    0,
  );

  const hasQuiz = courseHasQuiz(course);
  // Absent ⇒ the church has not chosen ⇒ the platform's value shows through.
  const effectiveRequireQuiz = typeof adoption?.requireQuiz === 'boolean'
    ? adoption.requireQuiz : course.requireQuiz === true;
  const effectiveIssueCertificate = typeof adoption?.issueCertificate === 'boolean'
    ? adoption.issueCertificate : course.issueCertificate === true;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-brand text-muted hover:text-strong hover:bg-surface-sunken transition-colors"
          title="Back to the library"
          aria-label="Back to the library"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Library preview</div>
          <h2 className="font-display text-xl text-strong truncate">{course.title}</h2>
        </div>
        {isAdopted ? (
          <AdminBadge tone="gold">Adopted</AdminBadge>
        ) : (
          <AdminPrimaryButton
            onClick={() => onAdopt(course)}
            icon={adoptBusy ? undefined : <Check size={16} />}
            disabled={adoptBusy || adoptBlocked}
            title={adoptBlocked ? blockedReason : undefined}
          >
            {adoptBusy ? 'Adopting…' : 'Adopt'}
          </AdminPrimaryButton>
        )}
      </div>

      <AdminCard className="p-5 space-y-5">
        {/* Cover + meta */}
        <div className="flex items-start gap-4">
          <div className="w-[120px] h-[90px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
            {course.thumbnail
              ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
              : <Library size={24} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">
              {[course.category, lessonCount ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null]
                .filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-faint mt-1.5">
              Published by Harvest. The content is read-only — Harvest keeps it up to date and
              every change reaches your church automatically.
            </p>
          </div>
        </div>

        {/* Description — sanitizeHtml, NOT stripHtml. This is a detail view, so
            the rich-text formatting is wanted; the two-line catalogue card is
            where a flattened summary belongs. Same call CourseOverview makes. */}
        <div>
          <h3 className="text-base font-bold mb-2 font-display text-strong">About this course</h3>
          {course.description ? (
            <div
              className="prose max-w-none text-sm leading-7 text-muted"
              data-testid="preview-description"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(course.description) }}
            />
          ) : (
            <p className="text-sm leading-7 text-muted">No description available.</p>
          )}
        </div>

        {/* Authors — name AND bio, resolved from libraryAuthors by the caller. */}
        {courseAuthors.length > 0 && (
          <div>
            <h3 className="text-base font-bold mb-2 font-display text-strong">
              {courseAuthors.length === 1 ? 'Teacher' : 'Teachers'}
            </h3>
            <div className="space-y-3">
              {courseAuthors.map((author) => (
                <div key={author.id} className="flex items-start gap-3">
                  {author.picture ? (
                    <img src={author.picture} alt={author.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-surface-sunken flex items-center justify-center text-sm font-bold text-faint shrink-0">
                      {author.name?.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-strong">{author.name}</div>
                    <div className="text-xs text-faint">{author.title || 'Instructor'}</div>
                    {author.bio && <p className="text-sm text-muted leading-6 mt-1">{author.bio}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Curriculum — shared tree, preview row (expands to the video). */}
        <div>
          <h3 className="text-base font-bold mb-1 font-display text-strong">Curriculum</h3>
          <p className="text-xs text-faint mb-1">
            Open a lesson to watch it. Nothing here is recorded against your account.
          </p>
          {lessonCount === 0 ? (
            <p className="text-sm text-muted py-2">This course has no lessons yet.</p>
          ) : (
            <CourseCurriculum
              levels={course.levels}
              renderLesson={(lesson, num) => <PreviewLesson lesson={lesson} num={num} />}
            />
          )}
        </div>
      </AdminCard>

      {/* ── Your church's settings ────────────────────────────────────────────
          The ONLY editable things on this screen, and only once adopted. There
          is deliberately no Edit control for anything else: #249 removed it
          because the tenant does not own the content. */}
      {isAdopted && onSetOverride && (
        <AdminCard className="p-5">
          <h3 className="text-base font-bold font-display text-strong">Your church&apos;s settings</h3>
          <p className="text-xs text-muted mt-1">
            These two are yours to decide for your own members. They do not affect any other
            church that has adopted this course, and Harvest&apos;s own value is only the default.
          </p>
          <div className="mt-2 divide-y divide-stone-200">
            <OverrideToggle
              label="Require the quiz"
              description="Members must pass every lesson quiz before the course counts as complete."
              checked={effectiveRequireQuiz}
              disabled={overrideBusy || (!hasQuiz && !effectiveRequireQuiz)}
              disabledReason={!hasQuiz
                ? 'This course has no quizzes, so requiring one would have no effect.'
                : undefined}
              onChange={(next) => onSetOverride('requireQuiz', next)}
            />
            <OverrideToggle
              label="Issue a certificate"
              description="Members who complete the course can download a certificate in your church's name."
              checked={effectiveIssueCertificate}
              disabled={overrideBusy}
              onChange={(next) => onSetOverride('issueCertificate', next)}
            />
          </div>
        </AdminCard>
      )}

      <div>
        <AdminSecondaryButton onClick={onClose}>Back to the library</AdminSecondaryButton>
      </div>
    </div>
  );
}
