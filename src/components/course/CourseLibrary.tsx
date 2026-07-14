"use client";
import React, { useState } from "react";
import { Search } from "lucide-react";
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
      {/* Header — desktop only; the mobile screen opens straight into search
          to match the member mockup (the tab bar supplies the section label). */}
      <h1 className="hidden lg:block text-[28px] font-light tracking-[-0.02em] text-earth mb-5 font-display">Courses</h1>

      {/* Search */}
      <div className="relative mb-5">
        <div className="absolute inset-y-0 left-0 pl-3 lg:pl-4 flex items-center pointer-events-none">
          <Search size={16} className="text-[color:var(--text-faint)]" />
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses..."
          className="w-full pl-9 lg:pl-11 pr-3 py-1.5 lg:py-2.5 bg-white border border-stone-200 rounded-lg lg:rounded-xl text-sm text-earth focus:ring-2 focus:ring-gold focus:border-transparent outline-none transition-all"
        />
      </div>

      {/* Category pills */}
      <div className="flex overflow-x-auto lg:flex-wrap gap-1.5 lg:gap-2 pb-2 mb-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 lg:px-[15px] lg:py-[7px] rounded-full text-xs lg:text-[12.5px] font-medium lg:font-semibold whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? "bg-gold text-white"
                : "bg-white text-warm-brown lg:text-[color:var(--text-body)] border border-stone-200 lg:border-stone-300 hover:border-gold"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Featured course hero */}
      {featured && activeCategory === "All" && !search && (
        <>
          {/* Mobile — mockup featured hero: 16:9 cover (else navy gradient),
              gradient wash, sparkle "Featured" chip, Fraunces title, meta.
              Same onSelectCourse handler + author/lesson data as desktop. */}
          <div
            className="lg:hidden relative rounded-brand-xl overflow-hidden mb-6 cursor-pointer"
            style={{ aspectRatio: "16/9" }}
            onClick={() => onSelectCourse(featured)}
          >
            {featured.thumbnail ? (
              <img src={featured.thumbnail} alt={featured.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#2e4057] to-[#1a2a3a]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent flex flex-col justify-end p-[18px]">
              <div
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9.5px] font-bold uppercase tracking-[0.08em] text-white mb-2 w-fit"
                style={{ background: GOLD }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.35 6.9L21 11l-6.65 2.1L12 20l-2.35-6.9L3 11l6.65-2.1z" /></svg>
                Featured
              </div>
              <div className="font-display font-light text-[22px] text-white tracking-[-0.01em] leading-tight">
                {featured.title}
              </div>
              <div className="text-xs font-medium text-white/70 mt-1">
                {featuredAuthor?.name || "Harvest"} · {featured.levels?.reduce((s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0), 0) || 0} lessons
              </div>
            </div>
          </div>

          {/* Desktop — existing approved hero, unchanged (now lg-only). */}
          <div
            className="hidden lg:block relative rounded-2xl overflow-hidden mb-7 cursor-pointer lg:max-w-[760px]"
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
              <div className="text-[26px] font-light text-white tracking-[-0.01em] mb-1">
                {featured.title}
              </div>
              <div className="text-[13px] font-medium text-white/70">
                {featuredAuthor?.name || "Harvest"} · {featured.levels?.reduce((s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0), 0) || 0} lessons
              </div>
            </div>
          </div>
        </>
      )}

      {/* Continue learning */}
      {continueLearning.length > 0 && (
        <div className="mb-7">
          <span className="lg:hidden block text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-faint)] mb-4">Continue Learning</span>
          <h2 className="hidden lg:block text-lg font-bold tracking-tight mb-4 font-display">Continue Learning</h2>
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
      <span className="lg:hidden block text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-faint)] mb-4">
        {continueLearning.length > 0 ? "All Courses" : "Courses"}
      </span>
      <h2 className="hidden lg:block text-lg font-bold tracking-tight mb-4 font-display">
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
