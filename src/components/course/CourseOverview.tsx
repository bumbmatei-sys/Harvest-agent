import React, { useState } from "react";
import { sanitizeHtml } from "../../utils/sanitize";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Course, Author, Lesson } from "../../types/course.types";
import { getProgress, getAuthor, getTotalLessons, getTotalDuration, getAllLessons } from "../../utils/course.utils";
import { BG, CARD, BORDER, TEXT, GOLD, GOLD_LIGHT, GOLD_BTN, TEXT2, GREEN_BG, GREEN } from "../../utils/course.constants";
import { ProgressBar } from "./ProgressBar";

interface CourseOverviewProps {
  course: Course;
  authors: Author[];
  onBack: () => void;
  onStartLesson: (course: Course, lesson: Lesson) => void;
  completed: Set<string>;
  onSelectAuthor?: (author: Author) => void;
}

export function CourseOverview({ course, authors, onBack, onStartLesson, completed, onSelectAuthor }: CourseOverviewProps) {
  const courseAuthors = course.authorIds.map(id => getAuthor(id, authors)).filter((a): a is Author => a !== undefined);
  const pct = getProgress(course, completed);
  const allLessons = getAllLessons(course);
  const nextLesson = allLessons.find(l => !completed.has(l.id)) || allLessons[0];
  const [expandedLevel, setExpandedLevel] = useState<string | null>(course.levels[0]?.id || null);
  const [tab, setTab] = useState<"about" | "curriculum">("about"); 

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: TEXT, cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, textAlign: "center", padding: "0 12px" }}>
          {course.title}
        </div>
        <div style={{ width: 20 }} />
      </div>

      <div style={{ position: "relative", height: 240, overflow: "hidden" }}>
        <Image src={course.thumbnail || `https://picsum.photos/seed/${course.id}/600/400`} alt={course.title} fill sizes="(max-width: 768px) 100vw, 600px" priority style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)" }} />
        <div style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
          <span style={{ background: GOLD, color: "#fff", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99 }}>{course.category}</span>
          <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 800, color: "#fff", marginTop: 6, lineHeight: 1.2 }}>{course.title}</div>
        </div>
      </div>

      <div style={{ background: CARD, borderRadius: "20px 20px 0 0", marginTop: -16, position: "relative", zIndex: 1, padding: "20px 16px 0" }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
          {[["📚", `${getTotalLessons(course)} lessons`], ["⏱", getTotalDuration(course)], ["🏆", `${course.levels?.length || 0} levels`]].map(([icon, val]) => (
            <div key={val} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEXT2 }}>{val}</span>
            </div>
          ))}
        </div>

        {pct > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 12, color: TEXT2, fontWeight: 600 }}>Your Progress</span>
              <span style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>{pct}%</span>
            </div>
            <ProgressBar pct={pct} height={7} />
          </div>
        )}

        <button onClick={() => nextLesson && onStartLesson(course, nextLesson)}
          style={{ width: "100%", background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 800, padding: "16px", borderRadius: 14, cursor: "pointer", fontSize: 16, fontFamily: "inherit", boxShadow: "0 4px 16px rgba(201,150,58,0.4)", marginBottom: 20 }}>
          {pct > 0 ? `Continue Learning` : "Start Course"}
        </button>

        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}` }}>
          {([["about", "About"], ["curriculum", "Curriculum"]] as [string, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as "about" | "curriculum")}
              style={{ flex: 1, background: "none", border: "none", borderBottom: `2.5px solid ${tab === id ? GOLD : "transparent"}`, color: tab === id ? GOLD : TEXT2, fontWeight: 700, fontSize: 14, padding: "12px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 16px 20px" }}>
        {tab === "about" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {courseAuthors.length > 0 && (
              <div>
                <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 16 }}>Instructors</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {courseAuthors.map(author => (
                    <div 
                      key={author.id} 
                      onClick={() => onSelectAuthor?.(author)}
                      style={{ background: CARD, borderRadius: 14, padding: 16, border: `1px solid ${BORDER}`, cursor: onSelectAuthor ? 'pointer' : 'default' }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 0 }}>
                        <div style={{ position: "relative", width: 48, height: 48, borderRadius: "50%", overflow: "hidden", border: `2px solid ${GOLD_LIGHT}` }}>
                          <Image src={author.picture || `https://i.pravatar.cc/150?u=${author.id}`} alt={author.name} fill sizes="48px" style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
                        </div>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{author.name}</div>
                          <div style={{ fontSize: 13, color: GOLD }}>{author.title}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div style={{ fontSize: 15, color: TEXT2, lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(course.description) }} />
          </div>
        )}

        {tab === "curriculum" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {course.levels?.map(level => (
              <div key={level.id} style={{ background: CARD, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
                <div onClick={() => setExpandedLevel(expandedLevel === level.id ? null : level.id)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", cursor: "pointer" }}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: TEXT }}>📖 {level.title}</span>
                  <span style={{ fontSize: 11, color: TEXT2 }}>{expandedLevel === level.id ? "▲" : "▼"}</span>
                </div>
                {expandedLevel === level.id && level.sections?.map((sec, si) => (
                  <div key={sec.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: TEXT2, letterSpacing: "0.07em", textTransform: "uppercase" }}>{sec.title}</div>
                    {sec.lessons?.map((lesson, li) => {
                      const done = completed.has(lesson.id);
                      return (
                        <div key={lesson.id} onClick={() => onStartLesson(course, lesson)}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: `1px solid ${BORDER}`, cursor: "pointer", background: "transparent" }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: done ? GREEN_BG : GOLD_LIGHT, border: `2px solid ${done ? GREEN : GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>
                            {done ? <span style={{ color: GREEN }}>✓</span> : <span style={{ color: GOLD, fontWeight: 800, fontSize: 11 }}>{li + 1}</span>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{lesson.title}</div>
                          </div>
                          <span style={{ fontSize: 11, color: TEXT2, flexShrink: 0 }}>⏱ {lesson.duration}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
