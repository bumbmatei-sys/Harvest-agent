import React, { useState } from "react";
import ReactPlayer from "react-player";
import { ArrowLeft, Clock, User, List, ChevronUp, ChevronDown, BookOpen, CheckCircle, ArrowRight } from "lucide-react";
import { Course, Lesson, Author, Level, Section } from "../../types/course.types";
import { getAuthor, getAllLessons, getProgress, extractYouTubeId } from "../../utils/course.utils";
import { BG, CARD, BORDER, TEXT, GOLD, GOLD_LIGHT, TEXT2, GREEN_BG, GREEN } from "../../utils/course.constants";

function YouTubePlayer({ lesson }: { lesson: Lesson }) {
  const videoId = lesson.youtubeId || extractYouTubeId(lesson.youtubeUrl);
  
  if (!videoId) {
    return (
      <div style={{ background: "#000", width: "100%", aspectRatio: "16/9", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
        No Video Content
      </div>
    );
  }

  return (
    <div style={{ background: "#000", width: "100%", aspectRatio: "16/9", position: "relative", overflow: "hidden" }}>
      <ReactPlayer
        url={`https://www.youtube.com/watch?v=${videoId}`}
        width="100%"
        height="100%"
        controls={true}
      />
    </div>
  );
}

interface LessonViewProps {
  course: Course;
  lesson: Lesson;
  authors: Author[];
  onBack: () => void;
  onComplete: (id: string) => void;
  completed: Set<string>;
  onSelectLesson: (lesson: Lesson) => void;
  onSelectAuthor?: (author: Author) => void;
}

export function LessonView({ course, lesson, authors, onBack, onComplete, completed, onSelectLesson, onSelectAuthor }: LessonViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "outline" | "sources">("overview");
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  
  const isDone = completed.has(lesson.id);
  const author = getAuthor(lesson.authorId, authors);
  const allLessons = getAllLessons(course);
  const currentIndex = allLessons.findIndex(l => l.id === lesson.id);
  const prevLesson = allLessons[currentIndex - 1];
  const nextLesson = allLessons[currentIndex + 1];
  const pct = getProgress(course, completed);
  const hasSources = lesson.sources && lesson.sources.replace(/<[^>]*>?/gm, '').trim().length > 0;

  let currentLevel: Level | undefined;
  let currentSection: Section | undefined;
  for (const lvl of course.levels || []) {
    for (const sec of lvl.sections || []) {
      if (sec.lessons.some(l => l.id === lesson.id)) {
        currentLevel = lvl;
        currentSection = sec;
        break;
      }
    }
    if (currentLevel) break;
  }

  const toggleOutline = (id: string) => {
    setExpandedOutline(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleTabClick = (tab: "overview" | "outline" | "sources") => {
    setActiveTab(tab);
    if (tab === "overview") {
      setTimeout(() => {
        document.getElementById("section-overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } else if (tab === "outline") {
      setTimeout(() => {
        document.getElementById("section-outline")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  };

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Nunito', sans-serif", paddingBottom: 150 }}>
      
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: TEXT, cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, textAlign: "center", padding: "0 12px" }}>
          {currentLevel?.title || course.title}
        </div>
        <div style={{ width: 36 }} />
      </div>

      <YouTubePlayer lesson={lesson} />

      <div style={{ background: CARD, borderRadius: "20px 20px 0 0", marginTop: -12, position: "relative", padding: "20px 16px 0" }}>
        {currentSection && (
          <div style={{ display: "inline-block", border: `1px solid ${GOLD}40`, background: GOLD_LIGHT, color: GOLD, fontSize: 10, fontWeight: 800, padding: "4px 10px", borderRadius: 99, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {currentSection.title}
          </div>
        )}
        <h1 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 24, fontWeight: 800, color: TEXT, lineHeight: 1.3, marginBottom: 12 }}>{lesson.title}</h1>
        
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT2, marginBottom: 24 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={14} /> {lesson.duration}</span>
          <span>•</span>
          <button onClick={() => author && onSelectAuthor && onSelectAuthor(author)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: GOLD, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 13 }}><User size={14} /> {author?.name}</button>
        </div>

        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, marginBottom: 24, position: "sticky", top: 50, background: CARD, zIndex: 10 }}>
          {([["overview", "Overview"], ["outline", "Teaching Outline"]] as [string, string][]).concat(hasSources ? [["sources", "Sources"]] : []).map(([id, label]) => (
            <button key={id} onClick={() => handleTabClick(id as any)}
              style={{ flex: 1, background: "none", border: "none", borderBottom: `2.5px solid ${activeTab === id ? GOLD : "transparent"}`, color: activeTab === id ? GOLD : TEXT2, fontWeight: 700, fontSize: 14, padding: "12px 4px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", whiteSpace: "nowrap" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 16px 20px" }}>
        {(activeTab === "overview" || activeTab === "outline") && (
          <>
            {lesson.summary && (
              <div id="section-overview" style={{ scrollMarginTop: 120, marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: GOLD, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>i</div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: TEXT, margin: 0 }}>Overview</h2>
                </div>
                <div style={{ fontSize: 15, color: TEXT2, lineHeight: 1.7 }}>
                  {lesson.summary}
                </div>
              </div>
            )}

            {lesson.outline && lesson.outline.length > 0 && (
              <div id="section-outline" style={{ scrollMarginTop: 120, marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <List size={20} color={GOLD} />
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: TEXT, margin: 0 }}>Teaching Outline</h2>
                </div>
                
                <div style={{ position: "relative", paddingLeft: 16 }}>
                  <div style={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 3, background: GOLD, borderRadius: 3 }} />
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {lesson.outline.map((item, i) => {
                      const isExpanded = expandedOutline.has(item.id);
                      return (
                        <div key={item.id} style={{ position: "relative" }}>
                          <div style={{ position: "absolute", left: -21, top: 4, width: 14, height: 14, borderRadius: "50%", background: isExpanded ? GOLD : "#E5E7EB", border: isExpanded ? `3px solid ${GOLD_LIGHT}` : "3px solid #fff", zIndex: 2, boxSizing: "border-box" }} />
                          
                          <div onClick={() => toggleOutline(item.id)} style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", paddingLeft: 8 }}>
                            <span style={{ flex: 1, fontWeight: 800, fontSize: 15, color: TEXT, lineHeight: 1.4 }}>{item.title}</span>
                            <span style={{ color: TEXT2, marginTop: 2 }}>{isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                          </div>
                          
                          {isExpanded && (
                            <div style={{ padding: "8px 0 8px 8px", fontSize: 14, color: TEXT2, lineHeight: 1.7 }}>
                              {item.text}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "sources" && (
          <div id="section-sources" style={{ scrollMarginTop: 120, marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <BookOpen size={20} color={GOLD} />
              <h2 style={{ fontSize: 18, fontWeight: 800, color: TEXT, margin: 0 }}>Sources</h2>
            </div>
            <div style={{ fontSize: 15, color: TEXT2, lineHeight: 1.7 }}>
              {lesson.sources ? (
                <div dangerouslySetInnerHTML={{ __html: lesson.sources }} />
              ) : (
                <p>No sources provided for this lesson.</p>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 12 }}>
          {!isDone ? (
            <button onClick={() => onComplete(lesson.id)}
              style={{ width: "100%", background: "#D4A017", border: "none", color: "#fff", fontWeight: 800, padding: "14px", borderRadius: 12, cursor: "pointer", fontSize: 15, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <CheckCircle size={20} /> Mark as Completed
            </button>
          ) : (
            <>
              <button onClick={() => onComplete(lesson.id)}
                style={{ width: "100%", background: "#E8F5E9", border: `1px solid #4CAF50`, color: "#2E7D32", fontWeight: 800, padding: "14px", borderRadius: 12, cursor: "pointer", fontSize: 15, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <CheckCircle size={20} /> Completed
              </button>
              <div style={{ display: "flex", justifyContent: prevLesson ? "space-between" : "flex-end", gap: 12 }}>
                {prevLesson && (
                  <button onClick={() => onSelectLesson(prevLesson)}
                    style={{ background: CARD, border: `1px solid ${BORDER}`, color: TEXT, fontWeight: 700, padding: "10px 16px", borderRadius: 99, cursor: "pointer", fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                    <ArrowLeft size={16} /> Previous
                  </button>
                )}
                {nextLesson && (
                  <button onClick={() => onSelectLesson(nextLesson)}
                    style={{ background: CARD, border: `1px solid ${GOLD}`, color: GOLD, fontWeight: 700, padding: "10px 16px", borderRadius: 99, cursor: "pointer", fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                    Next Lesson <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
