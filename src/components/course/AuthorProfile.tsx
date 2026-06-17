"use client";
import React from "react";
import { Author, Course } from "../../types/course.types";
import { GOLD, GOLD_LIGHT } from "../../utils/course.constants";

interface AuthorProfileProps {
  author: Author;
  onBack: () => void;
  courses?: Course[];
  onSelectCourse?: (course: Course) => void;
}

export function AuthorProfile({ author, onBack, courses, onSelectCourse }: AuthorProfileProps) {
  const authorCourses = courses?.filter((c) => c.authorIds?.includes(author.id)) || [];
  const totalLessons = authorCourses.reduce(
    (sum, c) => sum + (c.levels?.reduce((s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0), 0) || 0),
    0
  );

  return (
    <div className="max-w-[480px] mx-auto pb-24">
      {/* Hero */}
      <div className="relative bg-gradient-to-br from-[#fdf7ec] to-[#f5ead0] px-5 pt-4 pb-8 text-center">
        <button
          onClick={onBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/5 border-none flex items-center justify-center cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>

        {author.picture ? (
          <img
            src={author.picture}
            alt={author.name}
            className="w-24 h-24 rounded-full object-cover border-[3px] border-white shadow-lg mx-auto mb-4"
          />
        ) : (
          <div
            className="w-24 h-24 rounded-full border-[3px] border-white shadow-lg mx-auto mb-4 flex items-center justify-center text-2xl font-bold"
            style={{ background: GOLD_LIGHT, color: GOLD }}
          >
            {author.name?.charAt(0) || "?"}
          </div>
        )}

        <div className="text-2xl font-extrabold tracking-tight mb-1">{author.name}</div>
        <div className="text-sm text-gray-500 font-medium mb-4">{author.title || "Instructor"}</div>

        <div className="flex justify-center gap-8">
          <div className="text-center">
            <div className="text-xl font-extrabold">{authorCourses.length}</div>
            <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Courses</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold">{totalLessons}</div>
            <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Lessons</div>
          </div>
        </div>
      </div>

      <div className="px-5">
        {/* Bio */}
        {author.bio && (
          <p className="text-sm leading-7 text-gray-500 py-5 border-b border-gray-100">
            {author.bio}
          </p>
        )}

        {/* Courses */}
        {authorCourses.length > 0 && (
          <div className="py-5">
            <h3 className="text-base font-bold mb-3.5">Courses by {author.name.split(" ")[0]}</h3>
            {authorCourses.map((course) => {
              const lessonCount = course.levels?.reduce(
                (s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0),
                0
              ) || 0;

              return (
                <div
                  key={course.id}
                  className="flex gap-3 p-3 border border-gray-100 rounded-xl mb-2.5 cursor-pointer hover:shadow-md transition-all"
                  onClick={() => onSelectCourse?.(course)}
                >
                  <div className="w-20 h-[60px] rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                    {course.thumbnail ? (
                      <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="m8 21 4-4 4 4" /></svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                    <div className="text-sm font-bold mb-0.5">{course.title}</div>
                    <div className="text-xs text-gray-400">{lessonCount} lessons</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Social links */}
        {author.links && author.links.length > 0 && (
          <div className="flex gap-2.5 pt-3 pb-5">
            {author.links.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center cursor-pointer transition-all hover:bg-gray-900 hover:text-white hover:border-gray-900 text-gray-500"
                title={link.platform}
              >
                {link.platform === "youtube" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></svg>
                ) : link.platform === "instagram" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="5" /><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
