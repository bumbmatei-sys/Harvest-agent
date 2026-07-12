"use client";
import React, { useState } from "react";
import { Course, Lesson, Author, Level, QuizAttempt } from "../../types/course.types";
import { getAllLessons, verifyCourseCompletion } from "../../utils/course.utils";
import { GOLD, GOLD_LIGHT, GREEN, GREEN_BG } from "../../utils/course.constants";
import { sanitizeHtml, stripHtml } from "../../utils/sanitize";
import { auth } from "../../firebase";
import { usePublicShareUrl } from "../../utils/share-url";
import ShareButton from "../ShareButton";

interface CourseOverviewProps {
  course: Course;
  authors: Author[];
  onBack: () => void;
  onStartLesson: (course: Course, lesson: Lesson) => void;
  completed?: Set<string>;
  quizAttempts?: Record<string, QuizAttempt>;
  onSelectAuthor?: (author: Author) => void;
}

export function CourseOverview({ course, authors, onBack, onStartLesson, completed, quizAttempts, onSelectAuthor }: CourseOverviewProps) {
  const [activeTab, setActiveTab] = useState<"about" | "curriculum">("about");
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set(course.levels?.map((l) => l.id) || []));
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const shareUrl = usePublicShareUrl(`/courses/${course.id}`);

  const allLessons = getAllLessons(course);
  const totalLessons = allLessons.length;
  const completedCount = completed ? allLessons.filter((l) => completed.has(l.id)).length : 0;

  // Same completion check the server recomputes before issuing — the button is
  // only offered when genuinely earned. The server enforces it regardless
  // (defense in depth); the UI just avoids offering an action that would 403.
  const certEligible =
    course.issueCertificate === true &&
    verifyCourseCompletion(course, completed ?? new Set(), quizAttempts ?? {}).complete;

  const downloadCertificate = async () => {
    if (certLoading) return;
    setCertLoading(true);
    setCertError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Please sign in to download your certificate.");
      const res = await fetch("/api/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ courseId: course.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not generate your certificate.");
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setCertError(e?.message || "Could not generate your certificate.");
    } finally {
      setCertLoading(false);
    }
  };

  const totalMinutes = allLessons.reduce((sum, l) => {
    const match = l.duration?.match(/(\d+)/);
    return sum + (match ? parseInt(match[1]) : 0);
  }, 0);
  const durationStr = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : `${totalMinutes}m`;

  // Find first incomplete lesson for CTA
  const nextLesson = allLessons.find((l) => !completed?.has(l.id)) || allLessons[0];

  const plainDescription = stripHtml(course.description || "");

  // Resolve authors
  const courseAuthors = course.authorIds
    ?.map((id) => authors.find((a) => a.id === id))
    .filter(Boolean) as Author[];
  const primaryAuthor = courseAuthors?.[0];

  const toggleLevel = (id: string) => {
    const next = new Set(expandedLevels);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedLevels(next);
  };

  const getLessonNumber = (lessonId: string) => {
    const idx = allLessons.findIndex((l) => l.id === lessonId);
    return idx >= 0 ? idx + 1 : 0;
  };

  return (
    <div className="max-w-[480px] lg:max-w-[720px] mx-auto pb-24 lg:pb-10">
      {/* Hero */}
      <div className="relative w-full lg:rounded-[var(--ds-radius-card)] lg:overflow-hidden" style={{ aspectRatio: "16/10" }}>
        {course.thumbnail ? (
          <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2e4057] to-[#1a2a3a]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-end px-5 pb-6">
          <button
            onClick={onBack}
            className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm border-none flex items-center justify-center cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div className="absolute top-4 right-4">
            <ShareButton url={shareUrl} title={course.title} />
          </div>
          <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: GOLD }}>
            {course.category || "Course"}
          </div>
          <div className="text-2xl lg:text-[28px] font-extrabold lg:font-light text-white tracking-tight lg:tracking-[-0.01em] leading-tight mb-2 font-display">
            {course.title}
          </div>
          <div className="text-sm font-medium text-white/60">
            {plainDescription.slice(0, 100)}{plainDescription.length > 100 ? "..." : ""}
          </div>
        </div>
      </div>

      <div className="px-5">
        {/* Author strip */}
        {primaryAuthor && (
          <div
            className="flex items-center gap-3 py-4 border-b border-stone-200 cursor-pointer"
            onClick={() => onSelectAuthor?.(primaryAuthor)}
          >
            {primaryAuthor.picture ? (
              <img src={primaryAuthor.picture} alt={primaryAuthor.name} className="w-10 h-10 rounded-full object-cover border-2" style={{ borderColor: GOLD_LIGHT }} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-sm font-bold text-[color:var(--text-faint)]">
                {primaryAuthor.name?.charAt(0) || "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">{primaryAuthor.name}</div>
              <div className="text-xs text-[color:var(--text-faint)]">{primaryAuthor.title || "Instructor"}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A89A87" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
          </div>
        )}

        {/* Stats row */}
        <div className="flex py-4 border-b border-stone-200">
          <div className="flex-1 text-center border-r border-stone-200">
            <div className="text-lg font-extrabold">{totalLessons}</div>
            <div className="text-[11px] text-[color:var(--text-faint)] font-semibold uppercase tracking-wider">Lessons</div>
          </div>
          <div className="flex-1 text-center border-r border-stone-200">
            <div className="text-lg font-extrabold">{durationStr}</div>
            <div className="text-[11px] text-[color:var(--text-faint)] font-semibold uppercase tracking-wider">Duration</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-lg font-extrabold">{completedCount}/{totalLessons}</div>
            <div className="text-[11px] text-[color:var(--text-faint)] font-semibold uppercase tracking-wider">Complete</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200 -mx-5 px-5">
          {(["about", "curriculum"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3.5 mr-6 text-sm font-semibold capitalize cursor-pointer border-b-2 transition-colors ${
                activeTab === tab ? "text-earth border-amber-600" : "text-[color:var(--text-faint)] border-transparent hover:text-warm-brown"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* About tab */}
        {activeTab === "about" && (
          <div className="py-5">
            <h3 className="text-base font-bold mb-2.5 font-display">About This Course</h3>
            {course.description ? (
              <div className="prose max-w-none text-sm leading-7 text-warm-brown">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(course.description) }} />
              </div>
            ) : (
              <p className="text-sm leading-7 text-warm-brown">No description available.</p>
            )}
          </div>
        )}

        {/* Curriculum tab */}
        {activeTab === "curriculum" && (
          <div className="py-5">
            {course.levels?.map((level) => {
              const levelLessons = level.sections?.flatMap((s) => s.lessons || []) || [];
              const isExpanded = expandedLevels.has(level.id);

              return (
                <div key={level.id}>
                  <div
                    className="flex items-center justify-between py-3.5 cursor-pointer"
                    onClick={() => toggleLevel(level.id)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                        style={{ background: GOLD_LIGHT, color: GOLD }}
                      >
                        {level.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-[color:var(--text-faint)] font-medium">{levelLessons.length} lessons</span>
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A89A87" strokeWidth="2" strokeLinecap="round"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>

                  {isExpanded && level.sections?.map((section) => (
                    <div key={section.id}>
                      {section.title && (
                        <div className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider pt-2 pb-1 pl-1">
                          {section.title}
                        </div>
                      )}
                      {section.lessons?.map((lesson) => {
                        const isCompleted = completed?.has(lesson.id);
                        const isCurrent = nextLesson?.id === lesson.id;
                        const num = getLessonNumber(lesson.id);

                        return (
                          <div
                            key={lesson.id}
                            className="flex items-center gap-3 py-3 border-t border-gray-50 cursor-pointer hover:bg-stone-100 -mx-5 px-5 transition-colors"
                            onClick={() => onStartLesson(course, lesson)}
                          >
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border-[1.5px] ${
                                isCompleted
                                  ? "border-green-500 bg-green-50 text-green-600"
                                  : isCurrent
                                  ? "border-amber-600 bg-amber-50 text-amber-700"
                                  : "border-stone-200 bg-stone-100 text-warm-brown"
                              }`}
                            >
                              {isCompleted ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="m5 13 4 4L19 7" /></svg>
                              ) : (
                                num
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm ${isCurrent ? "font-bold text-earth" : "font-semibold text-[color:var(--text-body)]"}`}>
                                {lesson.title}
                              </div>
                              <div className="text-xs text-[color:var(--text-faint)] mt-0.5">
                                {lesson.duration || "~"}{isCurrent ? " · Current" : ""}
                              </div>
                            </div>
                            {isCurrent && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-gold">
                                <polygon points="8,5 19,12 8,19" />
                              </svg>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CTA — fixed action bar on mobile; on desktop it sits inline at the
          bottom of the 720px column (a viewport-wide fixed bar would overlap
          the desktop shell). */}
      <div className="fixed lg:static bottom-0 left-0 right-0 bg-white lg:bg-transparent border-t border-stone-200 lg:border-t-0 px-5 lg:px-5 py-4 lg:py-0 lg:mt-4 z-50" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        {certEligible ? (
          <>
            <button
              onClick={downloadCertificate}
              disabled={certLoading}
              className="w-full py-3.5 rounded-lg lg:rounded-xl text-white text-[15px] font-bold cursor-pointer transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait"
              style={{ background: GOLD }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--brand-color, #C9963A) 85%, black)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
              </svg>
              {certLoading ? "Preparing…" : "Download certificate"}
            </button>
            {certError && (
              <div className="text-xs text-center text-red-600 mt-2">{certError}</div>
            )}
          </>
        ) : (
          <button
            onClick={() => nextLesson && onStartLesson(course, nextLesson)}
            className="w-full py-3.5 rounded-lg lg:rounded-xl text-white text-[15px] font-bold cursor-pointer transition-colors"
            style={{ background: GOLD }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--brand-color, #C9963A) 85%, black)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
          >
            {completedCount > 0 ? `Continue — ${nextLesson?.title || "Next Lesson"}` : `Start Course`}
          </button>
        )}
      </div>
    </div>
  );
}
