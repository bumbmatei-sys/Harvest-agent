"use client";
import React from "react";
import { Course, Author } from "../../types/course.types";
import { getAllLessons } from "../../utils/course.utils";
import { GOLD } from "../../utils/course.constants";

interface CourseCardProps {
  course: Course;
  authors: Author[];
  onClick: () => void;
  completed?: Set<string>;
}

export function CourseCard({ course, authors, onClick, completed }: CourseCardProps) {
  const allLessons = getAllLessons(course);
  const totalLessons = allLessons.length;
  const completedCount = completed
    ? allLessons.filter((l) => completed.has(l.id)).length
    : 0;
  const progress = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  // Resolve author names
  const courseAuthors = course.authorIds
    ?.map((id) => authors.find((a) => a.id === id))
    .filter(Boolean) as Author[];
  const authorName = courseAuthors?.[0]?.name || "";

  // Total duration
  const totalMinutes = allLessons.reduce((sum, l) => {
    const match = l.duration?.match(/(\d+)/);
    return sum + (match ? parseInt(match[1]) : 0);
  }, 0);
  const durationStr = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : `${totalMinutes}m`;

  return (
    <div
      onClick={onClick}
      className="flex gap-3.5 p-3.5 bg-white border border-stone-200 rounded-xl cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 mb-3"
    >
      {/* Thumbnail */}
      <div className="w-[100px] h-[75px] rounded-lg overflow-hidden flex-shrink-0 bg-stone-100">
        {course.thumbnail ? (
          <img
            src={course.thumbnail}
            alt={course.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-stone-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="m8 21 4-4 4 4" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div
          className="text-[10px] font-bold uppercase tracking-wider mb-1"
          style={{ color: GOLD }}
        >
          {course.category || "Course"}
        </div>
        <div className="text-[15px] font-bold tracking-tight leading-snug mb-1 line-clamp-2">
          {course.title}
        </div>
        <div className="flex items-center gap-3 text-xs text-[color:var(--text-faint)] font-medium">
          {totalLessons > 0 && (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
              {totalLessons} lessons
            </span>
          )}
          {totalMinutes > 0 && (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
              {durationStr}
            </span>
          )}
          {authorName && <span>{authorName}</span>}
        </div>
        {progress > 0 && (
          <div className="mt-2 h-[3px] bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: GOLD }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
