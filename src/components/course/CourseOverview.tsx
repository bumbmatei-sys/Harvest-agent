"use client";
import React, { useState } from "react";
import { Course, Lesson, Author, Level } from "../../types/course.types";
import { getAllLessons } from "../../utils/course.utils";
import { GOLD, GOLD_LIGHT, GREEN, GREEN_BG } from "../../utils/course.constants";

interface CourseOverviewProps {
  course: Course;
  authors: Author[];
  onBack: () => void;
  onStartLesson: (course: Course, lesson: Lesson) => void;
  completed?: Set<string>;
  onSelectAuthor?: (author: Author) => void;
}

export function CourseOverview({ course, authors, onBack, onStartLesson, completed, onSelectAuthor }: CourseOverviewProps) {
  const [activeTab, setActiveTab] = useState<"about" | "curriculum">("about");
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set(course.levels?.map((l) => l.id) || []));

  const allLessons = getAllLessons(course);
  const totalLessons = allLessons.length;
  const completedCount = completed ? allLessons.filter((l) => completed.has(l.id)).length : 0;

  const totalMinutes = allLessons.reduce((sum, l) => {
    const match = l.duration?.match(/(\d+)/);
    return sum + (match ? parseInt(match[1]) : 0);
  }, 0);
  const durationStr = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : `${totalMinutes}m`;

  // Find first incomplete lesson for CTA
  const nextLesson = allLessons.find((l) => !completed?.has(l.id)) || allLessons[0];

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
    <div className="max-w-[480px] mx-auto pb-24">
      {/* Hero */}
      <div className="relative w-full" style={{ aspectRatio: "16/10" }}>
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
          <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: GOLD }}>
            {course.category || "Course"}
          </div>
          <div className="text-2xl font-extrabold text-white tracking-tight leading-tight mb-2 font-display">
            {course.title}
          </div>
          <div className="text-sm font-medium text-white/60">
            {course.description?.slice(0, 100)}{course.description && course.description.length > 100 ? "..." : ""}
          </div>
        </div>
      </div>

      <div className="px-5">
        {/* Author strip */}
        {primaryAuthor && (
          <div
            className="flex items-center gap-3 py-4 border-b border-gray-100 cursor-pointer"
            onClick={() => onSelectAuthor?.(primaryAuthor)}
          >
            {primaryAuthor.picture ? (
              <img src={primaryAuthor.picture} alt={primaryAuthor.name} className="w-10 h-10 rounded-full object-cover border-2" style={{ borderColor: GOLD_LIGHT }} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-400">
                {primaryAuthor.name?.charAt(0) || "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">{primaryAuthor.name}</div>
              <div className="text-xs text-gray-400">{primaryAuthor.title || "Instructor"}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
          </div>
        )}

        {/* Stats row */}
        <div className="flex py-4 border-b border-gray-100">
          <div className="flex-1 text-center border-r border-gray-100">
            <div className="text-lg font-extrabold">{totalLessons}</div>
            <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Lessons</div>
          </div>
          <div className="flex-1 text-center border-r border-gray-100">
            <div className="text-lg font-extrabold">{durationStr}</div>
            <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Duration</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-lg font-extrabold">{completedCount}/{totalLessons}</div>
            <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Complete</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 -mx-5 px-5">
          {(["about", "curriculum"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3.5 mr-6 text-sm font-semibold capitalize cursor-pointer border-b-2 transition-colors ${
                activeTab === tab ? "text-gray-900 border-amber-600" : "text-gray-400 border-transparent hover:text-gray-600"
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
            <p className="text-sm leading-7 text-gray-500 whitespace-pre-wrap">
              {course.description || "No description available."}
            </p>
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
                      <span className="text-[13px] text-gray-400 font-medium">{levelLessons.length} lessons</span>
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>

                  {isExpanded && level.sections?.map((section) => (
                    <div key={section.id}>
                      {section.title && (
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider pt-2 pb-1 pl-1">
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
                            className="flex items-center gap-3 py-3 border-t border-gray-50 cursor-pointer hover:bg-gray-50 -mx-5 px-5 transition-colors"
                            onClick={() => onStartLesson(course, lesson)}
                          >
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border-[1.5px] ${
                                isCompleted
                                  ? "border-green-500 bg-green-50 text-green-600"
                                  : isCurrent
                                  ? "border-amber-600 bg-amber-50 text-amber-700"
                                  : "border-gray-200 bg-gray-50 text-gray-500"
                              }`}
                            >
                              {isCompleted ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="m5 13 4 4L19 7" /></svg>
                              ) : (
                                num
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm ${isCurrent ? "font-bold text-gray-900" : "font-semibold text-gray-700"}`}>
                                {lesson.title}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
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

      {/* CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-5 py-4 z-50" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <button
          onClick={() => nextLesson && onStartLesson(course, nextLesson)}
          className="w-full py-3.5 rounded-lg text-white text-[15px] font-bold cursor-pointer transition-colors"
          style={{ background: GOLD }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--brand-color, #C9963A) 85%, black)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
        >
          {completedCount > 0 ? `Continue — ${nextLesson?.title || "Next Lesson"}` : `Start Course`}
        </button>
      </div>
    </div>
  );
}
