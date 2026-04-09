import React from "react";
import Image from "next/image";
import { Course, Author } from "../../types/course.types";
import { getProgress, getAuthor, getTotalLessons, getTotalDuration } from "../../utils/course.utils";
import { CARD, GOLD_LIGHT, GOLD, TEXT, TEXT2 } from "../../utils/course.constants";
import { ProgressBar } from "./ProgressBar";

interface CourseCardProps {
  course: Course;
  authors: Author[];
  completed: Set<string>;
  onSelectCourse: (course: Course) => void;
}

export function CourseCard({ course, authors, completed, onSelectCourse }: CourseCardProps) {
  const pct = getProgress(course, completed);
  const courseAuthors = course.authorIds.map(id => getAuthor(id, authors)).filter((a): a is Author => a !== undefined);
  
  return (
    <div onClick={() => onSelectCourse(course)}
      style={{ background: CARD, borderRadius: 16, overflow: "hidden", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", display: "flex", gap: 0 }}>
      <div style={{ width: 110, flexShrink: 0, position: "relative", overflow: "hidden" }}>
        <Image src={course.thumbnail || `https://picsum.photos/seed/${course.id}/600/400`} alt={course.title} fill sizes="110px" style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
      </div>
      <div style={{ flex: 1, padding: "12px 14px 12px" }}>
        <span style={{ background: GOLD_LIGHT, color: GOLD, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>{course.category}</span>
        <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 800, fontSize: 14, color: TEXT, lineHeight: 1.3, margin: "6px 0 4px" }}>{course.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <div style={{ display: "flex" }}>
            {courseAuthors.slice(0, 2).map((a, i) => (
              <div key={a.id} style={{ position: "relative", width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #fff", marginLeft: i > 0 ? -6 : 0, overflow: "hidden" }}>
                <Image src={a.picture || `https://i.pravatar.cc/150?u=${a.id}`} alt={a.name} fill sizes="18px" style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
              </div>
            ))}
          </div>
          <span style={{ fontSize: 11, color: TEXT2 }}>{courseAuthors[0]?.name || "Unknown Author"}</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: pct > 0 ? 8 : 0 }}>
          <span style={{ fontSize: 11, color: TEXT2 }}>📚 {getTotalLessons(course)}</span>
          <span style={{ fontSize: 11, color: TEXT2 }}>⏱ {getTotalDuration(course)}</span>
        </div>
        {pct > 0 && (
          <div>
            <ProgressBar pct={pct} height={4} />
            <span style={{ fontSize: 10, color: TEXT2, marginTop: 2, display: "block" }}>{pct}% complete</span>
          </div>
        )}
      </div>
    </div>
  );
}
