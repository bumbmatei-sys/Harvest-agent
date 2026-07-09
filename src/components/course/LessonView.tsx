"use client";
import React, { useState } from "react";
import ReactPlayer from "react-player/youtube";
import { Course, Lesson, Author } from "../../types/course.types";
import { getAllLessons } from "../../utils/course.utils";
import { GOLD, GREEN, GREEN_BG } from "../../utils/course.constants";

interface LessonViewProps {
  course: Course;
  lesson: Lesson;
  authors: Author[];
  onBack: () => void;
  onComplete: (id: string) => void;
  completed?: Set<string>;
  onSelectLesson: (lesson: Lesson) => void;
  onSelectAuthor?: (author: Author) => void;
}

export function LessonView({ course, lesson, authors, onBack, onComplete, completed, onSelectLesson, onSelectAuthor }: LessonViewProps) {
  const [activeTab, setActiveTab] = useState<"outline" | "notes" | "resources">("outline");

  const allLessons = getAllLessons(course);
  const currentIndex = allLessons.findIndex((l) => l.id === lesson.id);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;
  const isCompleted = completed?.has(lesson.id);
  const lessonNumber = currentIndex >= 0 ? currentIndex + 1 : 0;

  // Resolve video URL
  const videoUrl = lesson.youtubeUrl
    || (lesson.youtubeId ? `https://www.youtube.com/watch?v=${lesson.youtubeId}` : "");

  // Resolve author
  const author = authors.find((a) => a.id === lesson.authorId);

  return (
    <div className="max-w-[480px] mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-stone-200">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full bg-stone-100 border-none flex items-center justify-center cursor-pointer flex-shrink-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-[color:var(--text-faint)] font-semibold uppercase tracking-wider">{course.title}</div>
          <div className="text-[15px] font-bold truncate font-display">{lesson.title}</div>
        </div>
      </div>

      {/* Video player */}
      <div className="relative w-full bg-black" style={{ aspectRatio: "16/9" }}>
        {videoUrl ? (
          <ReactPlayer
            url={videoUrl}
            width="100%"
            height="100%"
            controls
            playing={false}
            config={{
              playerVars: {
                modestbranding: 1,
                rel: 0,
              },
            }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-warm-brown">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2 text-warm-brown">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="m8 21 4-4 4 4" />
            </svg>
            <span className="text-sm font-medium">No video content</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-5">
        <div className="text-xs text-[color:var(--text-faint)] font-semibold uppercase tracking-wider mt-5 mb-1">
          Lesson {lessonNumber} of {allLessons.length}
        </div>
        <div className="text-[22px] font-extrabold tracking-tight mb-4 font-display">{lesson.title}</div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200 -mx-5 px-5 mb-4">
          {(["outline", "notes", "resources"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 mr-5 text-[13px] font-semibold capitalize cursor-pointer border-b-2 transition-colors ${
                activeTab === tab ? "text-earth border-amber-600" : "text-[color:var(--text-faint)] border-transparent hover:text-warm-brown"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Outline tab */}
        {activeTab === "outline" && lesson.outline && lesson.outline.length > 0 && (
          <div>
            {lesson.outline.map((item, idx) => (
              <div key={item.id || idx} className="flex gap-3.5 py-3.5 border-b border-gray-50">
                <div className="text-xs font-semibold w-[42px] flex-shrink-0 pt-0.5" style={{ color: GOLD }}>
                  {item.text?.match(/\d+:\d+/)?.[0] || `${idx * 3}:00`}
                </div>
                <div className="text-sm text-warm-brown leading-6">
                  <strong className="text-earth font-semibold">{item.title}</strong>
                  {item.text ? ` — ${item.text}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Notes tab */}
        {activeTab === "notes" && (
          <div className="py-5">
            <p className="text-sm leading-7 text-warm-brown">
              {lesson.summary || "No notes available for this lesson."}
            </p>
          </div>
        )}

        {/* Resources tab */}
        {activeTab === "resources" && (
          <div className="py-5">
            {lesson.sources ? (
              <div className="text-sm leading-7 text-warm-brown whitespace-pre-wrap">{lesson.sources}</div>
            ) : (
              <p className="text-sm text-[color:var(--text-faint)]">No additional resources.</p>
            )}
          </div>
        )}

        {/* Author link */}
        {author && onSelectAuthor && (
          <div
            className="flex items-center gap-3 py-4 border-t border-stone-200 mt-2 cursor-pointer"
            onClick={() => onSelectAuthor(author)}
          >
            {author.picture ? (
              <img src={author.picture} alt={author.name} className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold text-[color:var(--text-faint)]">
                {author.name?.charAt(0)}
              </div>
            )}
            <div className="flex-1">
              <div className="text-sm font-bold">{author.name}</div>
              <div className="text-xs text-[color:var(--text-faint)]">{author.title || "Instructor"}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 space-y-3">
          <button
            onClick={() => onComplete(lesson.id)}
            className={`w-full py-3.5 rounded-lg text-sm font-bold cursor-pointer flex items-center justify-center gap-2 transition-all ${
              isCompleted
                ? "bg-green-50 text-green-600 border border-green-500 hover:bg-green-600 hover:text-white"
                : "bg-green-50 text-green-600 border border-green-500 hover:bg-green-600 hover:text-white"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m5 13 4 4L19 7" /></svg>
            {isCompleted ? "Completed ✓" : "Mark as Completed"}
          </button>

          <div className="flex gap-3">
            {prevLesson && (
              <button
                onClick={() => onSelectLesson(prevLesson)}
                className="flex-1 py-3 rounded-lg bg-stone-100 border border-stone-200 text-warm-brown text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-1.5 hover:bg-stone-100 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
                Previous
              </button>
            )}
            {nextLesson && (
              <button
                onClick={() => onSelectLesson(nextLesson)}
                className="flex-1 py-3 rounded-lg text-white text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                style={{ background: GOLD }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--brand-color, #C9963A) 85%, black)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
              >
                Next
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
