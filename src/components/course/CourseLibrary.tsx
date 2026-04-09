import React, { useState } from "react";
import Image from "next/image";
import { Course, Author } from "../../types/course.types";
import { getProgress, getTotalLessons, getTotalDuration } from "../../utils/course.utils";
import { BG, GOLD, CARD, TEXT2, GOLD_BTN, BORDER } from "../../utils/course.constants";
import { ProgressBar } from "./ProgressBar";
import { CourseCard } from "./CourseCard";

interface CourseLibraryProps {
  courses: Course[];
  authors: Author[];
  categories: string[];
  onSelectCourse: (course: Course) => void;
  completed: Set<string>;
}

export function CourseLibrary({ courses, authors, categories, onSelectCourse, completed }: CourseLibraryProps) {
  const [category, setCategory] = useState<string>("All");
  const featured = courses.find(c => c.featured);
  const rest = courses.filter(c => !c.featured && (category === "All" || c.category === category));
  const featuredPct = featured ? getProgress(featured, completed) : 0;

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ padding: "20px 16px 20px" }}>
        {/* Featured */}
        {featured && (
          <div onClick={() => onSelectCourse(featured)}
            style={{ borderRadius: 18, overflow: "hidden", position: "relative", height: 200, marginBottom: 24, cursor: "pointer", boxShadow: "0 6px 24px rgba(0,0,0,0.15)" }}>
            <Image src={featured.thumbnail || `https://picsum.photos/seed/${featured.id}/600/400`} alt={featured.title}
              fill sizes="(max-width: 768px) 100vw, 600px" priority style={{ objectFit: "cover", display: "block" }} referrerPolicy="no-referrer" />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.75) 100%)" }} />
            <div style={{ position: "absolute", top: 12, left: 12 }}>
              <span style={{ background: GOLD, color: "#fff", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, letterSpacing: "0.08em" }}>⭐ FEATURED</span>
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{featured.category}</div>
              <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 19, fontWeight: 800, color: "#fff", lineHeight: 1.25, marginBottom: 8 }}>{featured.title}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>📚 {getTotalLessons(featured)}</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>⏱ {getTotalDuration(featured)}</span>
                </div>
                <div style={{ background: GOLD_BTN, color: "#fff", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 99, boxShadow: "0 2px 10px rgba(201,150,58,0.5)" }}>
                  {featuredPct > 0 ? `Continue ${featuredPct}%` : "Start →"}
                </div>
              </div>
              {featuredPct > 0 && <ProgressBar pct={featuredPct} height={3} />}
            </div>
          </div>
        )}

        {/* Category chips */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 12, marginBottom: 16, scrollbarWidth: "none" }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              style={{ background: category === cat ? GOLD : CARD, color: category === cat ? "#fff" : TEXT2, border: `1.5px solid ${category === cat ? GOLD : BORDER}`, borderRadius: 99, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit", flexShrink: 0, transition: "all 0.2s" }}>
              {cat}
            </button>
          ))}
        </div>

        {/* Course cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rest.map(course => (
            <CourseCard key={course.id} course={course} authors={authors} completed={completed} onSelectCourse={onSelectCourse} />
          ))}
        </div>
      </div>
    </div>
  );
}
