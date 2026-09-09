"use client";
import React, { useState } from "react";
import { Search } from "lucide-react";
import { Course, Author, QuizAttempt } from "../../types/course.types";
import { getAllLessons } from "../../utils/course.utils";
import { CourseCard } from "./CourseCard";
import { GOLD } from "../../utils/course.constants";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

interface CourseLibraryProps {
  courses: Course[];
  authors: Author[];
  categories: string[];
  onSelectCourse: (course: Course) => void;
  completed?: Set<string>;
  /** Forwarded to each card for the `requireQuiz` half of completeness. */
  quizAttempts?: Record<string, QuizAttempt | undefined>;
  /**
   * THE-342 — the course read was REJECTED, which is not the same fact as "this
   * church has published nothing".
   *
   * When this is true the screen must NOT render its empty state. A member
   * whose tenant scope resolved to null runs an unfiltered /courses query that
   * Firestore rejects wholesale (rules are not filters), and for weeks that
   * rejection was shown to them as "No courses found" — a confident lie about
   * their church. The two states now render differently, always.
   */
  readFailed?: boolean;
  /**
   * "Showing N of M …" lines for whichever reads hit their ceiling, plus any
   * pool that failed to load. Empty in the normal case and renders nothing.
   */
  notices?: string[];
}

export function CourseLibrary({ courses, authors, categories, onSelectCourse, completed, quizAttempts, readFailed = false, notices = [] }: CourseLibraryProps) {
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
      <h1 className="hidden lg:block text-[28px] font-light tracking-[-0.02em] text-strong mb-5 font-display">Courses</h1>

      {/*
        THE-342 — a truncated or partial read SAYS SO, above the list it
        describes. "Showing 200 of 250 courses" is honest; showing 200 silently
        is the quiet lie this ticket exists to remove.

        The `alert` primitive carries the role="alert" and the token-based
        surface. Rejected here: `badge` (a chip cannot hold a sentence and is
        not announced), and a hand-rolled div (the primitive exists, so a
        substitute would be a defect).
      */}
      {notices.length > 0 && (
        <Alert data-courses-truncated className="mb-5">
          <AlertTitle>Some of this list is missing</AlertTitle>
          <AlertDescription>
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <div className="absolute inset-y-0 left-0 pl-3 lg:pl-4 flex items-center pointer-events-none">
          <Search size={16} className="text-faint" />
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses..."
          className="w-full h-[44px] pl-9 lg:pl-11 pr-3 py-0 bg-surface-raised border border-line rounded-lg lg:rounded-xl text-sm text-strong focus:ring-2 focus:ring-gold focus:border-transparent outline-hidden transition-all"
        />
      </div>

      {/* Category pills */}
      <div className="flex overflow-x-auto lg:flex-wrap gap-1.5 lg:gap-2 pb-2 mb-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            data-category-pill={cat}
            aria-pressed={activeCategory === cat}
            className={`h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center px-4 lg:px-[15px] py-0 rounded-full text-xs lg:text-[12.5px] font-medium lg:font-semibold whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? "bg-gold text-white"
                : "bg-surface-raised text-muted lg:text-body border border-line lg:border-line-strong hover:border-gold"
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
          <span className="lg:hidden block text-[11px] font-bold uppercase tracking-[0.14em] text-faint mb-4">Continue Learning</span>
          <h2 className="hidden lg:block text-lg font-bold tracking-tight mb-4 font-display">Continue Learning</h2>
          <div className="lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5">
          {continueLearning.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              authors={authors}
              onClick={() => onSelectCourse(course)}
              completed={completed}
              quizAttempts={quizAttempts}
            />
          ))}
          </div>
        </div>
      )}

      {/* All courses — the heading belongs to the list, so it goes when the
          list does rather than captioning nothing. */}
      {allCourses.length > 0 && (
        <>
          <span className="lg:hidden block text-[11px] font-bold uppercase tracking-[0.14em] text-faint mb-4">
            {continueLearning.length > 0 ? "All Courses" : "Courses"}
          </span>
          <h2 className="hidden lg:block text-lg font-bold tracking-tight mb-4 font-display">
            {continueLearning.length > 0 ? "All Courses" : "Courses"}
          </h2>
        </>
      )}
      {/*
        The empty state keys off `filtered`, not `allCourses`.

        `allCourses` is what is LEFT after Continue Learning takes its share, so
        a category holding only part-finished courses emptied it and printed
        "No courses found" directly beneath a populated list. Nothing matched is
        a question about the filter, and `filtered` is the filter's answer.
      */}
      {readFailed ? (
        /*
          THE-342 — the FAILURE state, and it is checked FIRST so it can
          never be out-competed by the empty state below.

          `courses` is [] in both cases and that is precisely the trap: an empty
          list and an unreadable one are indistinguishable in the data, so the
          distinction has to be carried separately and rendered separately.
          AGENTS.md: "keep the distinction between 'empty' and 'could not
          load'".

          `alert` with variant="destructive" rather than `empty`: this is not an
          empty collection, and dressing a fault as an empty state is the bug.
        */
        <Alert data-courses-read-failed variant="destructive" className="my-16">
          <AlertTitle>We could not load this church&apos;s courses</AlertTitle>
          <AlertDescription>
            Something went wrong reading the course library, so this list is not
            showing what is actually here. Please try again in a moment.
          </AlertDescription>
        </Alert>
      ) : filtered.length === 0 ? (
        <Empty data-courses-empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              </svg>
            </EmptyMedia>
            <EmptyTitle>No courses found</EmptyTitle>
            <EmptyDescription>
              Nothing in {activeCategory === "All" ? "the library" : activeCategory} matches yet. Try another category.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : allCourses.length === 0 ? null : (
        <div className="lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5">
        {allCourses.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            authors={authors}
            onClick={() => onSelectCourse(course)}
            completed={completed}
            quizAttempts={quizAttempts}
          />
        ))}
        </div>
      )}
    </div>
  );
}
