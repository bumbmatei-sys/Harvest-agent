import React, { useState, useEffect } from "react";
import Image from "next/image";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

// ─────────────────────────────────────────────
// HARVEST — Course Experience (Mobile-First)
// Optimized for phone screens. Desktop still works.
// Library → Course Overview → Lesson View
// ─────────────────────────────────────────────

const GOLD = "#C9963A";
const GOLD_LIGHT = "#FBF3E4";
const GOLD_BTN = "linear-gradient(135deg, #C9963A, #D4A843)";
const BG = "transparent";
const CARD = "#FFFFFF";
const TEXT = "#111111";
const TEXT2 = "#6B7280";
const BORDER = "#E8E8E8";
const GREEN = "#16A34A";
const GREEN_BG = "#F0FDF4";

// ── TYPES & INTERFACES ─────────────────────────

export interface LinkData {
  id?: string;
  platform: string;
  url: string;
}

export interface Author {
  id: string;
  name: string;
  title?: string;
  picture?: string;
  bio?: string;
  links?: LinkData[];
}

export interface OutlineItem {
  id: string;
  title: string;
  text: string;
}

export interface Lesson {
  id: string;
  youtubeId?: string;
  title: string;
  duration: string;
  authorId: string;
  summary: string;
  outline?: OutlineItem[];
  sources?: string;
}

export interface Section {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Level {
  id: string;
  title: string;
  sections: Section[];
}

export interface Course {
  id: string;
  featured: boolean;
  title: string;
  description: string;
  category: string;
  thumbnail: string;
  authorIds: string[];
  levels: Level[];
}

// ── Helpers ────────────────────────────────────
const getAuthor = (id: string, authors: Author[]): Author | undefined => authors.find(a => a.id === id);
const getAllLessons = (course: Course): Lesson[] => course.levels.flatMap(lv => lv.sections.flatMap(sec => sec.lessons));
const getTotalDuration = (course: Course): string => {
  let mins = getAllLessons(course).reduce((a, l) => a + (parseInt(l.duration) || 0), 0);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
};
const getTotalLessons = (course: Course): number => getAllLessons(course).length;
const getProgress = (course: Course, completed: Set<string>): number => {
  const total = getTotalLessons(course);
  if (total === 0) return 0;
  return Math.round((getAllLessons(course).filter(l => completed.has(l.id)).length / total) * 100);
};

// ── Progress Bar ───────────────────────────────
interface ProgressBarProps {
  pct: number;
  height?: number;
}

function ProgressBar({ pct, height = 5 }: ProgressBarProps) {
  return (
    <div style={{ background: BORDER, borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: GOLD_BTN, borderRadius: 99, transition: "width 0.4s" }} />
    </div>
  );
}

// ── BRANDED VIDEO PLAYER ───────────────────────
interface BrandedVideoPlayerProps {
  lesson: Lesson;
}

function BrandedVideoPlayer({ lesson }: BrandedVideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [speed, setSpeed] = useState("1x");
  const [quality, setQuality] = useState("Auto");

  return (
    <div style={{ background: "#000", width: "100%", aspectRatio: "16/9", position: "relative", overflow: "hidden" }}>
      
      {/* Background YouTube iframe with default controls disabled */}
      {lesson.youtubeId ? (
        <iframe
          src={`https://www.youtube.com/embed/${lesson.youtubeId}?controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3`}
          style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
          title={lesson.title}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
          No Video Content
        </div>
      )}

      {/* Custom UI Overlay */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", zIndex: 10 }}>
        
        {/* Top shadow gradient */}
        <div style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)", padding: "12px 16px", height: 60 }} />

        {/* Big Play Button (Center) */}
        <div 
          onClick={() => setIsPlaying(!isPlaying)}
          style={{ alignSelf: "center", width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", border: `2px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: GOLD, fontSize: 24, paddingLeft: isPlaying ? 0 : 4, transition: "transform 0.2s" }}
        >
          {isPlaying ? "❚❚" : "▶"}
        </div>

        {/* Bottom Controls */}
        <div style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)", padding: "20px 16px 12px", position: "relative" }}>
          
          {/* Timeline / Progress Bar */}
          <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 99, marginBottom: 12, cursor: "pointer", position: "relative" }}>
            <div style={{ width: "35%", height: "100%", background: GOLD, borderRadius: 99 }} />
            <div style={{ position: "absolute", left: "35%", top: "50%", transform: "translate(-50%, -50%)", width: 12, height: 12, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#fff", fontWeight: 600, fontFamily: "'Nunito', sans-serif" }}>11:04 / {lesson.duration}</div>
            
            <div style={{ display: "flex", gap: 16 }}>
              {/* Settings Toggle */}
              <button onClick={() => setShowSettings(!showSettings)} style={{ background: "none", border: "none", color: showSettings ? GOLD : "#fff", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", transition: "color 0.2s" }}>
                ⚙️
              </button>
              {/* Fullscreen Toggle */}
              <button style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center" }}>
                ⛶
              </button>
            </div>
          </div>

          {/* Settings Popup Menu */}
          {showSettings && (
            <div style={{ position: "absolute", bottom: 50, right: 16, background: "rgba(20, 20, 20, 0.95)", backdropFilter: "blur(10px)", borderRadius: 12, border: `1px solid rgba(201,150,58,0.3)`, padding: 8, minWidth: 140, color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
               <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4, padding: "0 8px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 800 }}>Speed</div>
               {["0.75x", "1x", "1.25x", "1.5x", "2x"].map(s => (
                  <button key={s} onClick={() => { setSpeed(s); setShowSettings(false); }} style={{ display: "block", width: "100%", textAlign: "left", background: speed === s ? "rgba(201,150,58,0.2)" : "transparent", color: speed === s ? GOLD : "#fff", border: "none", padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: speed === s ? 700 : 500, fontFamily: "'Nunito', sans-serif" }}>
                    {speed === s && <span style={{ marginRight: 6 }}>✓</span>}{s}
                  </button>
               ))}
               
               <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "8px 0" }} />
               
               <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4, padding: "0 8px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 800 }}>Quality</div>
               {["Auto", "1080p", "720p", "480p"].map(q => (
                  <button key={q} onClick={() => { setQuality(q); setShowSettings(false); }} style={{ display: "block", width: "100%", textAlign: "left", background: quality === q ? "rgba(201,150,58,0.2)" : "transparent", color: quality === q ? GOLD : "#fff", border: "none", padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: quality === q ? 700 : 500, fontFamily: "'Nunito', sans-serif" }}>
                    {quality === q && <span style={{ marginRight: 6 }}>✓</span>}{q}
                  </button>
               ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SCREEN 1 — COURSE LIBRARY
// ═══════════════════════════════════════════════
interface CourseLibraryProps {
  courses: Course[];
  authors: Author[];
  categories: string[];
  onSelectCourse: (course: Course) => void;
  completed: Set<string>;
}

function CourseLibrary({ courses, authors, categories, onSelectCourse, completed }: CourseLibraryProps) {
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
              fill style={{ objectFit: "cover", display: "block" }} referrerPolicy="no-referrer" />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.75) 100%)" }} />
            <div style={{ position: "absolute", top: 12, left: 12 }}>
              <span style={{ background: GOLD, color: "#fff", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, letterSpacing: "0.08em" }}>⭐ FEATURED</span>
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{featured.category}</div>
              <div style={{ fontFamily: "'Lora', serif", fontSize: 19, fontWeight: 700, color: "#fff", lineHeight: 1.25, marginBottom: 8 }}>{featured.title}</div>
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
          {rest.map(course => {
            const pct = getProgress(course, completed);
            const courseAuthors = course.authorIds.map(id => getAuthor(id, authors)).filter((a): a is Author => a !== undefined);
            return (
              <div key={course.id} onClick={() => onSelectCourse(course)}
                style={{ background: CARD, borderRadius: 16, overflow: "hidden", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", display: "flex", gap: 0 }}>
                <div style={{ width: 110, flexShrink: 0, position: "relative", overflow: "hidden" }}>
                  <Image src={course.thumbnail || `https://picsum.photos/seed/${course.id}/600/400`} alt={course.title} fill style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
                  {pct === 100 && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(22,163,74,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>✓</div>
                  )}
                </div>
                <div style={{ flex: 1, padding: "12px 14px 12px" }}>
                  <span style={{ background: GOLD_LIGHT, color: GOLD, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>{course.category}</span>
                  <div style={{ fontFamily: "'Lora', serif", fontWeight: 700, fontSize: 14, color: TEXT, lineHeight: 1.3, margin: "6px 0 4px" }}>{course.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <div style={{ display: "flex" }}>
                      {courseAuthors.slice(0, 2).map((a, i) => (
                        <div key={a.id} style={{ position: "relative", width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #fff", marginLeft: i > 0 ? -6 : 0, overflow: "hidden" }}>
                          <Image src={a.picture || `https://i.pravatar.cc/150?u=${a.id}`} alt={a.name} fill style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
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
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SCREEN 2 — COURSE OVERVIEW
// ═══════════════════════════════════════════════
interface CourseOverviewProps {
  course: Course;
  authors: Author[];
  onBack: () => void;
  onStartLesson: (course: Course, lesson: Lesson) => void;
  completed: Set<string>;
}

function CourseOverview({ course, authors, onBack, onStartLesson, completed }: CourseOverviewProps) {
  const courseAuthors = course.authorIds.map(id => getAuthor(id, authors)).filter((a): a is Author => a !== undefined);
  const pct = getProgress(course, completed);
  const allLessons = getAllLessons(course);
  const nextLesson = allLessons.find(l => !completed.has(l.id)) || allLessons[0];
  const [expandedLevel, setExpandedLevel] = useState<string | null>(course.levels[0]?.id || null);
  const [tab, setTab] = useState<"about" | "curriculum">("about"); 

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ position: "relative", height: 240, overflow: "hidden" }}>
        <Image src={course.thumbnail || `https://picsum.photos/seed/${course.id}/600/400`} alt={course.title} fill style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)" }} />
        <button onClick={onBack} style={{ position: "absolute", top: 16, left: 16, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 99, padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13 }}>← Back</button>
        <div style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
          <span style={{ background: GOLD, color: "#fff", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99 }}>{course.category}</span>
          <div style={{ fontFamily: "'Lora', serif", fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 6, lineHeight: 1.2 }}>{course.title}</div>
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
          {pct > 0 ? `Continue Learning →` : "Start Course →"}
        </button>

        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}` }}>
          {([] as const).concat([["about", "About"], ["curriculum", "Curriculum"]]).map(([id, label]) => (
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
            <div style={{ fontSize: 15, color: TEXT2, lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: course.description }} />
            
            {courseAuthors.length > 0 && (
              <div>
                <h2 style={{ fontFamily: "'Lora', serif", fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 16 }}>Instructors</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {courseAuthors.map(author => (
                    <div key={author.id} style={{ background: CARD, borderRadius: 14, padding: 16, border: `1px solid ${BORDER}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: author.bio ? 12 : 0 }}>
                        <div style={{ position: "relative", width: 48, height: 48, borderRadius: "50%", overflow: "hidden", border: `2px solid ${GOLD_LIGHT}` }}>
                          <Image src={author.picture || `https://i.pravatar.cc/150?u=${author.id}`} alt={author.name} fill style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
                        </div>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{author.name}</div>
                          <div style={{ fontSize: 13, color: GOLD }}>{author.title}</div>
                        </div>
                      </div>
                      {author.bio && (
                        <div style={{ fontSize: 14, color: TEXT2, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: author.bio }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
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

// ═══════════════════════════════════════════════
// SCREEN 3 — LESSON VIEW
// ═══════════════════════════════════════════════
interface LessonViewProps {
  course: Course;
  lesson: Lesson;
  authors: Author[];
  onBack: () => void;
  onComplete: (id: string) => void;
  completed: Set<string>;
  onSelectLesson: (lesson: Lesson) => void;
}

function LessonView({ course, lesson, authors, onBack, onComplete, completed, onSelectLesson }: LessonViewProps) {
  const [showCurriculum, setShowCurriculum] = useState<boolean>(false);
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState<boolean>(false);
  const [likeCount, setLikeCount] = useState<number>(14);
  const [bookmarked, setBookmarked] = useState<boolean>(false);
  
  const isDone = completed.has(lesson.id);
  const author = getAuthor(lesson.authorId, authors);
  const allLessons = getAllLessons(course);
  const currentIndex = allLessons.findIndex(l => l.id === lesson.id);
  const prevLesson = allLessons[currentIndex - 1];
  const nextLesson = allLessons[currentIndex + 1];
  const pct = getProgress(course, completed);

  const toggleOutline = (id: string) => {
    setExpandedOutline(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Nunito', sans-serif" }}>
      
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: GOLD, fontWeight: 700, cursor: "pointer", fontSize: 20, padding: 0, lineHeight: 1 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lesson.title}</div>
          <div style={{ fontSize: 11, color: TEXT2 }}>⏱ {lesson.duration}</div>
        </div>
        <button onClick={() => setBookmarked(b => !b)}
          style={{ background: bookmarked ? GOLD_LIGHT : "#F5F5F5", border: `1px solid ${bookmarked ? GOLD : BORDER}`, color: bookmarked ? GOLD : TEXT2, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
          🔖 {bookmarked ? "Saved" : "Save"}
        </button>
      </div>

      <BrandedVideoPlayer lesson={lesson} />

      <div style={{ background: CARD, borderRadius: "20px 20px 0 0", marginTop: -12, position: "relative", padding: "20px 16px 0" }}>
        <h1 style={{ fontFamily: "'Lora', serif", fontSize: 22, fontWeight: 700, color: TEXT, lineHeight: 1.3, marginBottom: 8 }}>{lesson.title}</h1>
        
        {author && (
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: author.bio ? 12 : 0 }}>
              <div style={{ position: "relative", width: 38, height: 38, borderRadius: "50%", overflow: "hidden", border: `2px solid ${GOLD_LIGHT}` }}>
                <Image src={author.picture || `https://i.pravatar.cc/150?u=${author.id}`} alt={author.name} fill style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{author.name}</div>
                <div style={{ fontSize: 11, color: GOLD }}>{author.title}</div>
              </div>
            </div>
            {author.bio && (
              <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: author.bio }} />
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <button onClick={() => setLiked(!liked)}
            style={{ flex: 1, background: liked ? "#FFF0F0" : BG, border: `1.5px solid ${liked ? "#E74C3C" : BORDER}`, borderRadius: 10, padding: "10px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: liked ? "#E74C3C" : TEXT2, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <span>{liked ? "❤️" : "🤍"}</span>
            <span>{liked ? likeCount + 1 : likeCount}</span>
          </button>
          {!isDone ? (
            <button onClick={() => onComplete(lesson.id)}
              style={{ flex: 2, background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 800, padding: "10px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
              ✓ Mark Complete
            </button>
          ) : (
            <div style={{ flex: 2, background: GREEN_BG, border: `1.5px solid ${GREEN}`, color: GREEN, fontWeight: 800, padding: "10px", borderRadius: 10, fontSize: 13, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
              ✓ Completed
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "0 16px 20px" }}>
        {lesson.summary && (
          <div style={{ background: GOLD_LIGHT, border: `1px solid ${GOLD}33`, borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
            <p style={{ fontSize: 14, color: "#7A5C1E", lineHeight: 1.75, margin: 0 }}>{lesson.summary}</p>
          </div>
        )}

        {lesson.outline && lesson.outline.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "'Lora', serif", fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Teaching Outline</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lesson.outline.map((item, i) => (
                <div key={item.id} style={{ border: `1.5px solid ${expandedOutline.has(item.id) ? GOLD : BORDER}`, borderRadius: 12, overflow: "hidden", background: expandedOutline.has(item.id) ? GOLD_LIGHT : CARD }}>
                  <div onClick={() => toggleOutline(item.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 14px", cursor: "pointer" }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: expandedOutline.has(item.id) ? GOLD : GOLD_LIGHT, border: `2px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: expandedOutline.has(item.id) ? "#fff" : GOLD, flexShrink: 0 }}>{i + 1}</div>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: TEXT }}>{item.title}</span>
                    <span style={{ fontSize: 11, color: TEXT2 }}>{expandedOutline.has(item.id) ? "▲" : "▼"}</span>
                  </div>
                  {expandedOutline.has(item.id) && (
                    <div style={{ padding: "0 14px 14px 52px", fontSize: 14, color: "#5C4A1E", lineHeight: 1.75 }}>{item.text}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {lesson.sources && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "'Lora', serif", fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Sources & References</h2>
            <div style={{ fontSize: 14, color: TEXT2, lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: lesson.sources }} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
          {prevLesson && (
            <button onClick={() => onSelectLesson(prevLesson)}
              style={{ flex: 1, background: CARD, border: `1.5px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
              <div style={{ fontSize: 11, color: TEXT2, marginBottom: 3 }}>← Previous</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prevLesson.title}</div>
            </button>
          )}
          {nextLesson && (
            <button onClick={() => onSelectLesson(nextLesson)}
              style={{ flex: 1, background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "right", fontFamily: "inherit" }}>
              <div style={{ fontSize: 11, color: GOLD, marginBottom: 3 }}>Next →</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextLesson.title}</div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════
export default function CourseApp() {
  const [screen, setScreen] = useState<"library" | "overview" | "lesson">("library");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const [courses, setCourses] = useState<Course[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const authorsSnap = await getDocs(collection(db, "authors"));
        const fetchedAuthors: Author[] = [];
        authorsSnap.forEach((doc) => {
          fetchedAuthors.push({ id: doc.id, ...doc.data() } as Author);
        });
        setAuthors(fetchedAuthors);

        const catsSnap = await getDocs(collection(db, "categories"));
        const fetchedCats: string[] = ["All"];
        catsSnap.forEach((doc) => {
          fetchedCats.push(doc.data().name);
        });
        setCategories(fetchedCats);

        const coursesSnap = await getDocs(query(collection(db, "courses"), where("status", "==", "published")));
        const fetchedCourses: Course[] = [];
        coursesSnap.forEach((doc) => {
          fetchedCourses.push({ id: doc.id, ...doc.data() } as Course);
        });
        setCourses(fetchedCourses);
      } catch (error) {
        console.error("Error fetching course data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const goToCourse = (course: Course) => { setSelectedCourse(course); setScreen("overview"); window.scrollTo(0, 0); };
  const goToLesson = (course: Course, lesson: Lesson) => { setSelectedCourse(course); setSelectedLesson(lesson); setScreen("lesson"); window.scrollTo(0, 0); };
  const markComplete = (id: string) => setCompleted(prev => new Set([...prev, id]));
  const selectLesson = (lesson: Lesson) => { setSelectedLesson(lesson); window.scrollTo(0, 0); };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: BG }}>
        <div style={{ color: GOLD, fontFamily: "'Nunito', sans-serif", fontWeight: 700 }}>Loading courses...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto" style={{ minHeight: "calc(100vh - 120px)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Lora:wght@400;600;700&display=swap');
      `}</style>
      {screen === "library" && <CourseLibrary courses={courses} authors={authors} categories={categories} onSelectCourse={goToCourse} completed={completed} />}
      {screen === "overview" && selectedCourse && <CourseOverview course={selectedCourse} authors={authors} onBack={() => setScreen("library")} onStartLesson={goToLesson} completed={completed} />}
      {screen === "lesson" && selectedCourse && selectedLesson && <LessonView course={selectedCourse} lesson={selectedLesson} authors={authors} onBack={() => setScreen("overview")} onComplete={markComplete} completed={completed} onSelectLesson={selectLesson} />}
    </div>
  );
}
