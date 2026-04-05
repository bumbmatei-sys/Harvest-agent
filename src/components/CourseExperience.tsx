import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { collection, getDocs, query, where, doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Bookmark, ArrowLeft, Clock, User, List, ChevronUp, ChevronDown, BookOpen, CheckCircle, ArrowRight, Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
import ReactPlayer from 'react-player';

// ─────────────────────────────────────────────
// HARVEST — Course Experience (Mobile-First)
// Optimized for phone screens. Desktop still works.
// Library → Course Overview → Lesson View
// ─────────────────────────────────────────────

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
  youtubeUrl?: string;
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

function extractYouTubeId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : undefined;
}

const formatTime = (seconds: number) => {
  const date = new Date(seconds * 1000);
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  if (hh) {
    return `${hh}:${mm.toString().padStart(2, '0')}:${ss}`;
  }
  return `${mm}:${ss}`;
};

function BrandedVideoPlayer({ lesson }: BrandedVideoPlayerProps) {
  const videoId = lesson.youtubeId || extractYouTubeId(lesson.youtubeUrl);
  
  const [playing, setPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [played, setPlayed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [seeking, setSeeking] = useState(false);
  
  const playerRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePlayPause = () => setPlaying(!playing);
  const handleToggleMuted = () => setMuted(!muted);
  
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!seeking && duration > 0) {
      setPlayed(e.currentTarget.currentTime / duration);
    }
  };
  
  const handleDurationChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setDuration(e.currentTarget.duration);
  };
  
  const handleSeekMouseDown = () => setSeeking(true);
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => setPlayed(parseFloat(e.target.value));
  const handleSeekMouseUp = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    setSeeking(false);
    const target = e.target as HTMLInputElement;
    const newTime = parseFloat(target.value) * duration;
    if (playerRef.current) {
      playerRef.current.currentTime = newTime;
    }
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  };

  const handleMouseLeave = () => {
    if (playing) setShowControls(false);
  };

  if (!videoId) {
    return (
      <div style={{ background: "#000", width: "100%", aspectRatio: "16/9", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
        No Video Content
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      style={{ background: "#000", width: "100%", aspectRatio: "16/9", position: "relative", overflow: "hidden" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={() => setShowControls(true)}
    >
      <div style={{ width: "100%", height: "100%", pointerEvents: hasStarted ? "none" : "auto" }}>
        <ReactPlayer
          ref={playerRef}
          url={`https://www.youtube.com/watch?v=${videoId}`}
          width="100%"
          height="100%"
          playing={playing}
          volume={volume}
          muted={muted}
          light={true}
          playIcon={
            <div 
              style={{
                width: 64, height: 64,
                borderRadius: '50%',
                background: GOLD_BTN,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <Play fill="#fff" color="#fff" size={32} style={{ marginLeft: 4 }} />
            </div>
          }
          onClickPreview={() => {
            setHasStarted(true);
            setPlaying(true);
          }}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onPlay={() => {
            setHasStarted(true);
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          config={{
            youtube: {
              playerVars: { 
                showinfo: 0, 
                controls: 0, 
                modestbranding: 1, 
                rel: 0,
                disablekb: 1,
                fs: 0
              }
            }
          }}
        />
      </div>
      
      {/* Overlay Controls */}
      {hasStarted && (
        <div 
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            background: showControls && !playing ? 'rgba(0,0,0,0.4)' : (showControls ? 'rgba(0,0,0,0.1)' : 'transparent'),
            transition: 'background 0.3s, opacity 0.3s',
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
          }}
        >
          {/* Click area to play/pause */}
          <div style={{ flex: 1, cursor: 'pointer' }} onClick={handlePlayPause} />

          {/* Big Play Button in Center (when paused) */}
          {!playing && (
            <div 
              onClick={handlePlayPause}
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 64, height: 64,
                borderRadius: '50%',
                background: GOLD_BTN,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                pointerEvents: 'auto'
              }}
            >
              <Play fill="#fff" color="#fff" size={32} style={{ marginLeft: 4 }} />
            </div>
          )}

        {/* Bottom Control Bar */}
        <div style={{ padding: '12px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', display: 'flex', alignItems: 'center', gap: 16, pointerEvents: 'auto' }}>
          <button onClick={handlePlayPause} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
            {playing ? <Pause fill="#fff" size={20} /> : <Play fill="#fff" size={20} />}
          </button>
          
          <div style={{ color: '#fff', fontSize: 13, fontFamily: 'monospace', minWidth: 80 }}>
            {formatTime(played * duration)} / {formatTime(duration)}
          </div>

          {/* Custom Range Slider for Progress */}
          <input
            type="range"
            min={0}
            max={1}
            step="any"
            value={played}
            onMouseDown={handleSeekMouseDown}
            onChange={handleSeekChange}
            onMouseUp={handleSeekMouseUp}
            onTouchStart={handleSeekMouseDown}
            onTouchEnd={handleSeekMouseUp}
            style={{
              flex: 1,
              accentColor: GOLD,
              height: 4,
              cursor: 'pointer'
            }}
          />

          <button onClick={handleToggleMuted} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
            {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>

          <button onClick={handleFullscreen} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
            <Maximize size={20} />
          </button>
        </div>
        </div>
      )}
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
              fill sizes="(max-width: 768px) 100vw, 600px" priority style={{ objectFit: "cover", display: "block" }} referrerPolicy="no-referrer" />
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
                  <Image src={course.thumbnail || `https://picsum.photos/seed/${course.id}/600/400`} alt={course.title} fill sizes="110px" style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
                </div>
                <div style={{ flex: 1, padding: "12px 14px 12px" }}>
                  <span style={{ background: GOLD_LIGHT, color: GOLD, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>{course.category}</span>
                  <div style={{ fontFamily: "'Lora', serif", fontWeight: 700, fontSize: 14, color: TEXT, lineHeight: 1.3, margin: "6px 0 4px" }}>{course.title}</div>
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
          {pct > 0 ? `Continue Learning` : "Start Course"}
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
            {courseAuthors.length > 0 && (
              <div>
                <h2 style={{ fontFamily: "'Lora', serif", fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 16 }}>Instructors</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {courseAuthors.map(author => (
                    <div key={author.id} style={{ background: CARD, borderRadius: 14, padding: 16, border: `1px solid ${BORDER}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: author.bio ? 12 : 0 }}>
                        <div style={{ position: "relative", width: 48, height: 48, borderRadius: "50%", overflow: "hidden", border: `2px solid ${GOLD_LIGHT}` }}>
                          <Image src={author.picture || `https://i.pravatar.cc/150?u=${author.id}`} alt={author.name} fill sizes="48px" style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
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
            
            <div style={{ fontSize: 15, color: TEXT2, lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: course.description }} />
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
  const [activeTab, setActiveTab] = useState<"overview" | "outline" | "sources">("overview");
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<boolean>(false);
  
  const isDone = completed.has(lesson.id);
  const author = getAuthor(lesson.authorId, authors);
  const allLessons = getAllLessons(course);
  const currentIndex = allLessons.findIndex(l => l.id === lesson.id);
  const prevLesson = allLessons[currentIndex - 1];
  const nextLesson = allLessons[currentIndex + 1];
  const pct = getProgress(course, completed);

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
        <button
          onClick={() => setBookmarked(b => !b)}
          className="p-2 -mr-2 text-gray-500 hover:text-[#d4a017] dark:text-gray-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Bookmark size={20} className={bookmarked ? 'fill-current text-[#d4a017]' : ''} />
        </button>
      </div>

      <BrandedVideoPlayer lesson={lesson} />

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
          <button style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: GOLD, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 13 }}><User size={14} /> {author?.name}</button>
        </div>

        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, marginBottom: 24, position: "sticky", top: 50, background: CARD, zIndex: 10 }}>
          {([] as const).concat([["overview", "Overview"], ["outline", "Teaching Outline"], ["sources", "Sources"]]).map(([id, label]) => (
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

// ═══════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════
export default function CourseApp({ 
  onOpenCourse, 
  onBack, 
  initialCourseId, 
  initialLessonId 
}: { 
  onOpenCourse?: (courseId: string, lessonId?: string) => void;
  onBack?: () => void;
  initialCourseId?: string;
  initialLessonId?: string;
}) {
  const [screen, setScreen] = useState<"library" | "overview" | "lesson">(
    initialLessonId ? "lesson" : initialCourseId ? "overview" : "library"
  );
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchUserData = async () => {
      if (!auth.currentUser) return;
      try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          if (data.completedLessons) {
            setCompleted(new Set(data.completedLessons));
          }
        }
      } catch (error) {
        console.error("Error fetching user data", error);
      }
    };
    fetchUserData();
  }, []);

  const updateLastWatched = async (course: Course, lesson: Lesson) => {
    if (!auth.currentUser) return;
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      await updateDoc(userRef, {
        lastWatchedVideo: {
          courseId: course.id,
          courseTitle: course.title,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          thumbnail: course.thumbnail || '',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error("Error updating last watched video", error);
    }
  };

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
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "authors");
      }

      try {
        const catsSnap = await getDocs(collection(db, "categories"));
        const fetchedCats: string[] = ["All"];
        catsSnap.forEach((doc) => {
          fetchedCats.push(doc.data().name);
        });
        setCategories(fetchedCats);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "categories");
      }

      try {
        const coursesSnap = await getDocs(query(collection(db, "courses"), where("status", "==", "published")));
        const fetchedCourses: Course[] = [];
        coursesSnap.forEach((doc) => {
          fetchedCourses.push({ id: doc.id, ...doc.data() } as Course);
        });
        setCourses(fetchedCourses);

        if (initialCourseId) {
          const course = fetchedCourses.find(c => c.id === initialCourseId);
          if (course) {
            setSelectedCourse(course);
            if (initialLessonId) {
              const allLessons = getAllLessons(course);
              const lesson = allLessons.find(l => l.id === initialLessonId);
              if (lesson) setSelectedLesson(lesson);
            }
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "courses");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [initialCourseId, initialLessonId]);

  const goToCourse = (course: Course) => { 
    if (onOpenCourse) {
      onOpenCourse(course.id);
    } else {
      setSelectedCourse(course); 
      setScreen("overview"); 
      window.scrollTo(0, 0); 
    }
  };
  
  const goToLesson = (course: Course, lesson: Lesson) => { 
    if (onOpenCourse) {
      onOpenCourse(course.id, lesson.id);
      updateLastWatched(course, lesson);
    } else {
      setSelectedCourse(course); 
      setSelectedLesson(lesson); 
      setScreen("lesson"); 
      window.scrollTo(0, 0); 
      updateLastWatched(course, lesson);
    }
  };
  
  const toggleComplete = async (id: string) => {
    const newCompleted = new Set(completed);
    if (newCompleted.has(id)) {
      newCompleted.delete(id);
    } else {
      newCompleted.add(id);
    }
    setCompleted(newCompleted);
    if (auth.currentUser) {
      try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
          completedLessons: Array.from(newCompleted)
        });
      } catch (error) {
        console.error("Error updating completed lessons", error);
      }
    }
  };
  
  const selectLesson = (lesson: Lesson) => { 
    setSelectedLesson(lesson); 
    window.scrollTo(0, 0); 
    if (selectedCourse) {
      updateLastWatched(selectedCourse, lesson);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: BG }}>
        <div style={{ color: GOLD, fontFamily: "'Nunito', sans-serif", fontWeight: 700 }}>Loading courses...</div>
      </div>
    );
  }

  return (
    <div className={`max-w-4xl mx-auto ${onBack ? "bg-[#f8f9fa] dark:bg-[#1a1d27] min-h-screen" : ""}`} style={onBack ? {} : { minHeight: "calc(100vh - 120px)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Lora:wght@400;600;700&display=swap');
      `}</style>
      {screen === "library" && <CourseLibrary courses={courses} authors={authors} categories={categories} onSelectCourse={goToCourse} completed={completed} />}
      {screen === "overview" && selectedCourse && <CourseOverview course={selectedCourse} authors={authors} onBack={onBack || (() => setScreen("library"))} onStartLesson={goToLesson} completed={completed} />}
      {screen === "lesson" && selectedCourse && selectedLesson && <LessonView course={selectedCourse} lesson={selectedLesson} authors={authors} onBack={() => setScreen("overview")} onComplete={toggleComplete} completed={completed} onSelectLesson={selectLesson} />}
    </div>
  );
}
