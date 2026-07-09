"use client";
import React, { useState } from "react";
import { Course, Author } from "../../types/course.types";
import { getAllLessons } from "../../utils/course.utils";
import { CourseCard } from "./CourseCard";
import { GOLD } from "../../utils/course.constants";

interface CourseLibraryProps {
  courses: Course[];
  authors: Author[];
  categories: string[];
  onSelectCourse: (course: Course) => void;
  completed?: Set<string>;
}

export function CourseLibrary({ courses, authors, categories, onSelectCourse, completed }: CourseLibraryProps) {
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");

  const filtered = courses.filter((c) => {
    const matchesCategory = activeCategory === "All" || c.category === activeCategory;
    const matchesSearch = !search || c.title.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const featured = courses.find((c) => c.featured);

  const continueLearning = filtered.filter((c) => {
    if (!completed || completed.size === 0) return false;
    const allLessons = getAllLessons(c);
    const done = allLessons.filter((l) => completed.has(l.id)).length;
    return done > 0 && done < allLessons.length;
  });

  const allCourses = filtered.filter((c) => !continueLearning.includes(c));

  const featuredAuthor = featured
    ? (featured.authorIds?.map((id) => authors.find((a) => a.id === id)).filter(Boolean)[0] as Author | undefined)
    : null;

  return (
    <div className="max-w-[480px] mx-auto px-4 pt-5 pb-24 lg:max-w-none lg:px-8 lg:pt-6">
      {/* Header */}
      <h1 className="text-[28px] font-extrabold tracking-tight mb-5 font-display">Courses</h1>

      {/* Search */}
      <div className="relative mb-5">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses..."
          className="w-full py-3 pl-10 pr-4 bg-[#faf9f7] border border-stone-200 rounded-xl text-sm text-earth outline-none transition-colors focus:border-amber-600"
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-6" style={{ scrollbarWidth: "none" }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-[7px] rounded-full text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-all duration-200 border ${
              activeCategory === cat
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-warm-brown border-stone-200 hover:border-gray-400 hover:text-earth"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Featured course hero */}
      {featured && activeCategory === "All" && !search && (
        <div
          className="relative rounded-2xl overflow-hidden mb-7 cursor-pointer lg:max-w-[760px]"
          style={{ aspectRatio: "16/9" }}
          onClick={() => onSelectCourse(featured)}
        >
          {featured.thumbnail ? (
            <img src={featured.thumbnail} alt={featured.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#2e4057] to-[#1a2a3a]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-6">
            <div
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-white mb-2.5 w-fit"
              style={{ background: GOLD }}
            >
              ★ Featured
            </div>
            <div className="text-[22px] font-extrabold text-white tracking-tight mb-1">
              {featured.title}
            </div>
            <div className="text-[13px] font-medium text-white/70">
              {featuredAuthor?.name || "Harvest"} · {featured.levels?.reduce((s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0), 0) || 0} lessons
            </div>
          </div>
        </div>
      )}

      {/* Continue learning */}
      {continueLearning.length > 0 && (
        <div className="mb-7">
          <h2 className="text-lg font-bold tracking-tight mb-4 font-display">Continue Learning</h2>
          <div className="lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5">
          {continueLearning.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              authors={authors}
              onClick={() => onSelectCourse(course)}
              completed={completed}
            />
          ))}
          </div>
        </div>
      )}

      {/* All courses */}
      <h2 className="text-lg font-bold tracking-tight mb-4 font-display">
        {continueLearning.length > 0 ? "All Courses" : "Courses"}
      </h2>
      {allCourses.length === 0 ? (
        <div className="text-center py-16 text-[color:var(--text-faint)]">
          <svg className="mx-auto mb-3 text-stone-300" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          </svg>
          <p className="text-sm font-medium">No courses found</p>
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5">
        {allCourses.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            authors={authors}
            onClick={() => onSelectCourse(course)}
            completed={completed}
          />
        ))}
        </div>
      )}
    </div>
  );
}
