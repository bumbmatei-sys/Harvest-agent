import { useState, useRef, useEffect, CSSProperties, KeyboardEvent, MouseEvent } from "react";
import Image from 'next/image';
import { ArrowLeft } from "lucide-react";
import { collection, addDoc, doc, updateDoc, getDocs, deleteDoc, setDoc, getDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { ImageUpload } from './ImageUpload';
import RichTextEditor from './RichTextEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';



// ─────────────────────────────────────────────
// HARVEST — Admin Course Builder v2 (TypeScript)
// React + TypeScript (not Next.js)
// Features:
// • Custom categories (create & delete)
// • Global authors library (reuse across courses)
// • 3-tier curriculum: Level → Section → Lesson
// • Teaching outline: expandable title + text blocks
// • Multiple links per social platform
// • Video duration field per lesson
// • Featured course toggle
// • Per-lesson author assignment
// Wire handleSave() to Firebase Firestore
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════
const GOLD = "#C9963A";
const GOLD_LIGHT = "#FBF3E4";
const GOLD_BTN = "linear-gradient(135deg, #C9963A, #D4A843)";
const BG = "#F2F4F7";
const CARD = "#FFFFFF";
const TEXT = "#111111";
const TEXT2 = "#888888";
const BORDER = "#E8E8E8";
const GREEN = "#27AE60";
const GREEN_BG = "#EAFAF1";
const RED = "#E74C3C";
const RED_BG = "#FDECEA";

const SOCIAL_PLATFORMS: string[] = [
 "Website", "YouTube", "Instagram", "Twitter / X",
 "Facebook", "LinkedIn", "TikTok", "Podcast", "Other",
];

// ═══════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════
interface AuthorLink {
 id: string;
 platform: string;
 url: string;
}

interface Author {
 id: string;
 name: string;
 title: string;
 picture: string;
 bio: string;
 links: AuthorLink[];
}

interface OutlineItem {
 id: string;
 title: string;
 text: string;
}

interface Lesson {
 id: string;
 title: string;
 summary: string;
 youtubeUrl: string;
 duration: string;
 outline: OutlineItem[];
 sources: string;
 teacherNote: string;
 authorId: string;
}

interface Section {
 id: string;
 title: string;
 lessons: Lesson[];
}

interface Level {
 id: string;
 title: string;
 sections: Section[];
}

type CourseStatus = "draft" | "published";

export interface Course {
 id?: string;
 title: string;
 description: string;
 category: string;
 thumbnail: string;
 status: CourseStatus;
 featured: boolean;
 authorIds: string[];
 levels: Level[];
 author?: string; // For compatibility with AdminCourses list
}

// ═══════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════
const uid = (): string => crypto.randomUUID().slice(0, 7);
const emptyLink = (platform = ""): AuthorLink => ({ id: uid(), platform, url: "" });
const emptyAuthor = (): Author => ({ id: uid(), name: "", title: "", picture: "", bio: "", links: [emptyLink("Website")] });
const emptyOutlineItem = (): OutlineItem => ({ id: uid(), title: "", text: "" });
const emptyLesson = (): Lesson => ({ id: uid(), title: "", summary: "", youtubeUrl: "", duration: "", outline: [emptyOutlineItem()], sources: "", teacherNote: "", authorId: "" });
const emptySection = (): Section => ({ id: uid(), title: "", lessons: [emptyLesson()] });
const emptyLevel = (): Level => ({ id: uid(), title: "", sections: [emptySection()] });
const emptyCourse = (): Course => ({ title: "", description: "", category: "", thumbnail: "", status: "draft", featured: false, authorIds: [], levels: [emptyLevel()] });

// ═══════════════════════════════════════════════
// STYLE HELPERS
// ═══════════════════════════════════════════════
const btnStyle = (fw: number): CSSProperties => ({
 background: "#fff", border: `1px solid ${BORDER}`, color: TEXT, borderRadius: 6,
 padding: "2px 9px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: fw,
});

// ═══════════════════════════════════════════════
// FIELD
// ═══════════════════════════════════════════════
interface FieldProps {
 label?: string;
 value: string;
 onChange: (val: string) => void;
 placeholder?: string;
 textarea?: boolean;
 type?: string;
}

function Field({ label, value, onChange, placeholder, textarea, type = "text" }: FieldProps) {
 return (
 <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
 {label && <label style={s.label}>{label}</label>}
 {textarea
 ? <textarea style={s.textarea} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} />
 : <input type={type} style={s.input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
 </div>
 );
}

// ═══════════════════════════════════════════════
// OUTLINE EDITOR
// ═══════════════════════════════════════════════
interface OutlineEditorProps {
 items: OutlineItem[];
 onChange: (items: OutlineItem[]) => void;
}

function OutlineEditor({ items, onChange }: OutlineEditorProps) {
 const update = (i: number, key: keyof OutlineItem, val: string): void => {
 const next = [...items]; next[i] = { ...next[i], [key]: val }; onChange(next);
 };
 return (
 <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
 {items.map((item, i) => (
 <div key={item.id} style={{ background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
 <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
 <div style={{ width: 22, height: 22, borderRadius: "50%", background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: GOLD, flexShrink: 0 }}>{i + 1}</div>
 <input style={{ flex: 1, border: "none", outline: "none", fontWeight: 700, fontSize: 14, color: TEXT, background: "transparent", fontFamily: "inherit" }}
 value={item.title} onChange={(e) => update(i, "title", e.target.value)} placeholder="Outline point title..." />
 {items.length > 1 && (
 <button style={{ background: "none", border: "none", color: "#CCC", cursor: "pointer", fontSize: 15 }}
 onClick={() => onChange(items.filter((_, idx) => idx !== i))}>✕</button>
 )}
 </div>
 <textarea style={{ ...s.textarea, border: "none", borderRadius: 0, background: "transparent", minHeight: 60 }}
 value={item.text} onChange={(e) => update(i, "text", e.target.value)}
 placeholder="Elaboration, scripture, notes..." rows={2} />
 </div>
 ))}
 <button style={s.addLessonBtn} onClick={() => onChange([...items, emptyOutlineItem()])}>+ Add Outline Point</button>
 </div>
 );
}

// ═══════════════════════════════════════════════
// LINKS EDITOR
// ═══════════════════════════════════════════════
interface LinksEditorProps {
 links: AuthorLink[];
 onChange: (links: AuthorLink[]) => void;
}

function LinksEditor({ links, onChange }: LinksEditorProps) {
 const update = (i: number, key: keyof AuthorLink, val: string): void => {
 const next = [...links]; next[i] = { ...next[i], [key]: val }; onChange(next);
 };
 return (
 <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
 <label style={s.label}>Online Presence</label>
 {links.map((link, i) => (
 <div key={link.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 32px", gap: 8, alignItems: "center" }}>
 <select style={s.select} value={link.platform} onChange={(e) => update(i, "platform", e.target.value)}>
 {SOCIAL_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
 </select>
 <input style={s.input} value={link.url} onChange={(e) => update(i, "url", e.target.value)} placeholder="https://..." />
 {links.length > 1 && (
 <button style={{ background: "none", border: "none", color: "#CCC", cursor: "pointer", fontSize: 15 }}
 onClick={() => onChange(links.filter((_, idx) => idx !== i))}>✕</button>
 )}
 </div>
 ))}
 <button style={{ ...s.addLessonBtn, marginTop: 0 }} onClick={() => onChange([...links, emptyLink()])}>+ Add Link</button>
 </div>
 );
}

// ═══════════════════════════════════════════════
// AUTHOR CARD
// ═══════════════════════════════════════════════
interface AuthorCardProps {
 author: Author;
 onChange: (author: Author) => void;
 onRemove?: () => void;
 selectable?: boolean;
 selected?: boolean;
 onToggleSelect?: () => void;
}

function AuthorCard({ author, onChange, onRemove, selectable = false, selected = false, onToggleSelect }: AuthorCardProps) {
 const [open, setOpen] = useState<boolean>(false);
 const set = <K extends keyof Author>(k: K, v: Author[K]): void => onChange({ ...author, [k]: v });
 return (
 <div style={{ ...s.card, border: selected ? `2px solid ${GOLD}` : `1.5px solid ${BORDER}`, marginBottom: 12 }}>
 <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", borderBottom: open ? `1px solid ${BORDER}` : "none" }}>
 {selectable && (
 <div onClick={onToggleSelect} style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${selected ? GOLD : BORDER}`, background: selected ? GOLD : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
 {selected && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
 </div>
 )}
 <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
 {author.picture
 ? <div style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', overflow: 'hidden' }}><Image src={author.picture} alt="" fill sizes="40px" style={{ objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /></div>
 : <div style={s.avatarEmpty}>👤</div>}
 <div>
 <div style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{author.name || "New Author"}</div>
 {author.title && <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>{author.title}</div>}
 </div>
 </div>
 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
 <span style={{ fontSize: 11, color: TEXT2 }} onClick={() => setOpen((o) => !o)}>{open ? "▲" : "▼"}</span>
 {onRemove && <button style={s.removeBtn} onClick={(e: MouseEvent) => { e.stopPropagation(); onRemove(); }}>✕</button>}
 </div>
 </div>
 {open && (
 <div style={s.cardBody}>
 <div style={s.row2}>
 <Field label="Full Name" value={author.name} onChange={(v) => set("name", v)} placeholder="John Smith" />
 <Field label="Title / Role" value={author.title} onChange={(v) => set("title", v)} placeholder="Lead Pastor" />
 </div>
 <div style={{ marginTop: 12 }}>
 <label style={s.label}>Profile Picture</label>
 <div style={{ marginTop: 8 }}>
 <ImageUpload value={author.picture} onChange={(v) => set("picture", v)} placeholder="Upload or paste image URL" />
 </div>
 </div>
 <div>
 <label style={s.label}>Bio</label>
 <RichTextEditor content={author.bio} onChange={(v) => set("bio", v)} minHeight="80px" placeholder="Author biography..." />
 </div>
 <LinksEditor links={author.links} onChange={(v) => set("links", v)} />
 </div>
 )}
 </div>
 );
}

// ═══════════════════════════════════════════════
// LESSON CARD
// ═══════════════════════════════════════════════
interface LessonCardProps {
 lesson: Lesson;
 onChange: (lesson: Lesson) => void;
 onRemove: () => void;
 authorsLibrary?: Author[];
}

function LessonCard({ lesson, onChange, onRemove, authorsLibrary = [] }: LessonCardProps) {
 const [open, setOpen] = useState<boolean>(false);
 const set = <K extends keyof Lesson>(k: K, v: Lesson[K]): void => onChange({ ...lesson, [k]: v });
 const lessonAuthor = authorsLibrary.find((a) => a.id === lesson.authorId);
 return (
 <div style={{ background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
 <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
 <span style={{ color: "#CCC", fontSize: 18, cursor: "grab", userSelect: "none" }}>⠿</span>
 <div style={{ flex: 1 }}>
 <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{lesson.title || "Untitled Lesson"}</div>
 <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
 {lesson.youtubeUrl && <span style={{ fontSize: 11, color: GOLD }}>▶ YouTube linked</span>}
 {lesson.duration && <span style={{ fontSize: 11, color: TEXT2 }}>⏱ {lesson.duration}</span>}
 {lessonAuthor && <span style={{ fontSize: 11, color: TEXT2 }}>👤 {lessonAuthor.name}</span>}
 </div>
 </div>
 <span style={{ fontSize: 11, color: TEXT2 }}>{open ? "▲" : "▼"}</span>
 <button style={s.removeBtn} onClick={(e: MouseEvent) => { e.stopPropagation(); onRemove(); }}>✕</button>
 </div>
 {open && (
 <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 16 }}>
 <div style={{ height: 10 }} />
 <div style={s.row2}>
 <Field label="Lesson Title" value={lesson.title} onChange={(v) => set("title", v)} placeholder="e.g. The Power of Grace" />
 <Field label="Video Duration" value={lesson.duration} onChange={(v) => set("duration", v)} placeholder="e.g. 45 min" />
 </div>
 <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
 <label style={s.label}>Lesson Author</label>
 <select style={s.select} value={lesson.authorId} onChange={(e) => set("authorId", e.target.value)}>
 <option value="">— Use course authors —</option>
 {authorsLibrary.map((a) => (
 <option key={a.id} value={a.id}>{a.name}{a.title ? ` · ${a.title}` : ""}</option>
 ))}
 </select>
 {authorsLibrary.length === 0 && <div style={{ fontSize: 12, color: TEXT2 }}>No authors on this course yet — add them in the Authors tab.</div>}
 </div>
 <Field label="YouTube URL" value={lesson.youtubeUrl} onChange={(v) => set("youtubeUrl", v)} placeholder="https://youtube.com/watch?v=..." />
 <Field label="Summary" value={lesson.summary} onChange={(v) => set("summary", v)} textarea placeholder="Brief summary of this lesson..." />
 <div>
 <label style={s.label}>Teaching Outline</label>
 <p style={{ fontSize: 12, color: TEXT2, marginBottom: 10, marginTop: -4 }}>Each point shows as an expandable title in the lesson view.</p>
 <OutlineEditor items={lesson.outline} onChange={(v) => set("outline", v)} />
 </div>
 <div>
 <label style={s.label}>Sources & References</label>
 <RichTextEditor content={lesson.sources} onChange={(v) => set("sources", v)} minHeight="60px" placeholder="Books, articles, Bible verses — add links with 🔗" />
 </div>
 <Field label="Teacher Notes" value={lesson.teacherNote} onChange={(v) => set("teacherNote", v)} textarea placeholder="Private notes for this session..." />
 </div>
 )}
 </div>
 );
}

// ═══════════════════════════════════════════════
// SECTION CARD
// ═══════════════════════════════════════════════
interface SectionCardProps {
 section: Section;
 onChange: (section: Section) => void;
 onRemove: () => void;
 authorsLibrary?: Author[];
}

function SectionCard({ section, onChange, onRemove, authorsLibrary = [] }: SectionCardProps) {
 const [open, setOpen] = useState<boolean>(true);
 const dragging = useRef<number | null>(null);
 const dragOver = useRef<number | null>(null);

 const setLesson = (i: number, l: Lesson): void => { const ls = [...section.lessons]; ls[i] = l; onChange({ ...section, lessons: ls }); };
 const removeLesson = (i: number): void => onChange({ ...section, lessons: section.lessons.filter((_, idx) => idx !== i) });
 const onDragEnd = (): void => {
 if (dragging.current === null || dragOver.current === null) return;
 const ls = [...section.lessons];
 const [moved] = ls.splice(dragging.current, 1);
 ls.splice(dragOver.current, 0, moved);
 onChange({ ...section, lessons: ls });
 dragging.current = null; dragOver.current = null;
 };
 return (
 <div style={{ background: "#F7F8FA", border: `1.5px solid ${BORDER}`, borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
 <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: open ? `1px solid ${BORDER}` : "none" }}>
 <span style={{ color: "#CCC", fontSize: 16, cursor: "grab", userSelect: "none" }}>⠿</span>
 <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, flexShrink: 0 }} />
 <input style={{ flex: 1, border: "none", outline: "none", fontWeight: 700, fontSize: 14, color: TEXT, background: "transparent", fontFamily: "inherit" }}
 value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} placeholder="Section Title..." />
 <span style={{ fontSize: 10, color: TEXT2, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>{open ? "▲" : "▼"}</span>
 <button style={s.removeBtn} onClick={onRemove}>✕</button>
 </div>
 {open && (
 <div style={{ padding: "10px 12px 12px" }}>
 {section.lessons.map((lesson, i) => (
 <div key={lesson.id} draggable
 onDragStart={() => { dragging.current = i; }}
 onDragEnter={() => { dragOver.current = i; }}
 onDragEnd={onDragEnd}>
 <LessonCard lesson={lesson} onChange={(l) => setLesson(i, l)} onRemove={() => removeLesson(i)} authorsLibrary={authorsLibrary} />
 </div>
 ))}
 <button style={s.addLessonBtn} onClick={() => onChange({ ...section, lessons: [...section.lessons, emptyLesson()] })}>+ Add Lesson</button>
 </div>
 )}
 </div>
 );
}

// ═══════════════════════════════════════════════
// LEVEL CARD
// ═══════════════════════════════════════════════
interface LevelCardProps {
 level: Level;
 onChange: (level: Level) => void;
 onRemove: () => void;
 authorsLibrary?: Author[];
}

function LevelCard({ level, onChange, onRemove, authorsLibrary = [] }: LevelCardProps) {
 const [open, setOpen] = useState<boolean>(true);
 const dragging = useRef<number | null>(null);
 const dragOver = useRef<number | null>(null);

 const setSection = (i: number, sec: Section): void => { const ss = [...level.sections]; ss[i] = sec; onChange({ ...level, sections: ss }); };
 const removeSection = (i: number): void => onChange({ ...level, sections: level.sections.filter((_, idx) => idx !== i) });
 const onDragEnd = (): void => {
 if (dragging.current === null || dragOver.current === null) return;
 const ss = [...level.sections];
 const [moved] = ss.splice(dragging.current, 1);
 ss.splice(dragOver.current, 0, moved);
 onChange({ ...level, sections: ss });
 dragging.current = null; dragOver.current = null;
 };
 return (
 <div style={{ ...s.card, marginBottom: 14, border: `2px solid ${BORDER}` }}>
 <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", background: "#FDFCF8", borderBottom: open ? `1px solid ${BORDER}` : "none" }}>
 <span style={{ color: "#CCC", fontSize: 18, cursor: "grab", userSelect: "none" }}>⠿</span>
 <div style={{ width: 10, height: 10, borderRadius: "50%", background: GOLD, border: `2px solid ${GOLD_LIGHT}`, flexShrink: 0 }} />
 <input style={{ flex: 1, border: "none", outline: "none", fontWeight: 800, fontSize: 16, color: TEXT, background: "transparent", fontFamily: "inherit" }}
 value={level.title} onChange={(e) => onChange({ ...level, title: e.target.value })} placeholder="Level Title (e.g. Beginner, Week 1)..." />
 <span style={{ fontSize: 11, color: TEXT2, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>{open ? "▲" : "▼"}</span>
 <button style={s.removeBtn} onClick={onRemove}>✕</button>
 </div>
 {open && (
 <div style={{ padding: "12px 14px 14px" }}>
 {level.sections.map((sec, i) => (
 <div key={sec.id} draggable
 onDragStart={() => { dragging.current = i; }}
 onDragEnter={() => { dragOver.current = i; }}
 onDragEnd={onDragEnd}>
 <SectionCard section={sec} onChange={(updated) => setSection(i, updated)} onRemove={() => removeSection(i)} authorsLibrary={authorsLibrary} />
 </div>
 ))}
 <button style={{ ...s.addLessonBtn, borderColor: "#D0D0D0", color: TEXT2 }} onClick={() => onChange({ ...level, sections: [...level.sections, emptySection()] })}>+ Add Section</button>
 </div>
 )}
 </div>
 );
}

// ═══════════════════════════════════════════════
// CATEGORIES MANAGER
// ═══════════════════════════════════════════════
interface CategoriesManagerProps {
 categories: string[];
 onUpdate: (cats: string[]) => void;
}

function CategoriesManager({ categories, onUpdate }: CategoriesManagerProps) {
 const [newCat, setNewCat] = useState<string>("");
 const add = (): void => {
 const trimmed = newCat.trim();
 if (!trimmed || categories.includes(trimmed)) return;
 onUpdate([...categories, trimmed]); setNewCat("");
 };
 return (
 <div style={s.card}>
 <div style={s.sectionHeading}>Manage Categories</div>
 <div style={s.cardBody}>
 <div style={{ display: "flex", gap: 8 }}>
 <input style={{ ...s.input, flex: 1 }} value={newCat} onChange={(e) => setNewCat(e.target.value)}
 placeholder="New category name..." onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && add()} />
 <button style={{ ...s.publishBtn, padding: "10px 18px", borderRadius: 10 }} onClick={add}>Add</button>
 </div>
 <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
 {categories.map((cat) => (
 <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6, background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, borderRadius: 99, padding: "5px 12px" }}>
 <span style={{ fontSize: 13, fontWeight: 600, color: GOLD }}>{cat}</span>
 <button onClick={() => onUpdate(categories.filter((c) => c !== cat))}
 style={{ background: "none", border: "none", color: GOLD, cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1, fontWeight: 700 }}>✕</button>
 </div>
 ))}
 </div>
 {categories.length === 0 && <div style={{ color: TEXT2, fontSize: 13 }}>No categories yet. Add one above.</div>}
 </div>
 </div>
 );
}

// ═══════════════════════════════════════════════
// AUTHOR PICKER MODAL
// ═══════════════════════════════════════════════
interface AuthorPickerModalProps {
 authorsLibrary: Author[];
 selectedIds: string[];
 onConfirm: (ids: string[]) => void;
 onClose: () => void;
}

function AuthorPickerModal({ authorsLibrary, selectedIds, onConfirm, onClose }: AuthorPickerModalProps) {
 const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
 const toggle = (id: string): void => {
 const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); setSelected(next);
 };
 return (
 <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
 <div style={{ background: CARD, borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
 <div style={{ padding: "18px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
 <div style={{ fontWeight: 800, fontSize: 17 }}>Select Authors</div>
 <button style={{ background: "none", border: "none", color: TEXT2, cursor: "pointer", fontSize: 20 }} onClick={onClose}>✕</button>
 </div>
 <div style={{ overflowY: "auto", padding: 16, flex: 1 }}>
 {authorsLibrary.length === 0 && <div style={{ color: TEXT2, textAlign: "center", padding: 30 }}>No authors in library yet.</div>}
 {authorsLibrary.map((author) => (
 <div key={author.id} onClick={() => toggle(author.id)}
 style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, cursor: "pointer", marginBottom: 8, border: `1.5px solid ${selected.has(author.id) ? GOLD : BORDER}`, background: selected.has(author.id) ? GOLD_LIGHT : CARD }}>
 <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${selected.has(author.id) ? GOLD : BORDER}`, background: selected.has(author.id) ? GOLD : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
 {selected.has(author.id) && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
 </div>
 {author.picture
 ? <div style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', overflow: 'hidden' }}><Image src={author.picture} alt="" fill sizes="40px" style={{ objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /></div>
 : <div style={s.avatarEmpty}>👤</div>}
 <div>
 <div style={{ fontWeight: 700, fontSize: 14 }}>{author.name || "Unnamed"}</div>
 {author.title && <div style={{ fontSize: 12, color: TEXT2 }}>{author.title}</div>}
 </div>
 </div>
 ))}
 </div>
 <div style={{ padding: "14px 20px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10 }}>
 <button style={{ ...s.draftBtn, flex: 1 }} onClick={onClose}>Cancel</button>
 <button style={{ ...s.publishBtn, flex: 2 }} onClick={() => onConfirm(Array.from(selected))}>Confirm Selection</button>
 </div>
 </div>
 </div>
 );
}

// ═══════════════════════════════════════════════
// MAIN COURSE BUILDER
// ═══════════════════════════════════════════════
interface CourseBuilderProps {
 course?: Course | null;
 onClose: () => void;
}

export default function CourseBuilder({ course: initialCourse, onClose }: CourseBuilderProps) {
 const [course, setCourse] = useState<Course>(initialCourse || emptyCourse());
 const [tab, setTab] = useState<"info" | "authors" | "curriculum">("info");
 const [saving, setSaving] = useState<boolean>(false);
 const [saved, setSaved] = useState<boolean>(false);
 const [authorsLibrary, setAuthorsLibrary] = useState<Author[]>([]);
 const [showAuthorPicker, setShowAuthorPicker] = useState<boolean>(false);
 const [categories, setCategories] = useState<string[]>([]);
 const [showCatManager, setShowCatManager] = useState<boolean>(false);

 useEffect(() => {
 const fetchData = async () => {
 try {
 const authorsSnap = await getDocs(collection(db, "authors"));
 const fetchedAuthors: Author[] = [];
 authorsSnap.forEach((doc) => {
 fetchedAuthors.push({ id: doc.id, ...doc.data() } as Author);
 });
 setAuthorsLibrary(fetchedAuthors);

 const catsSnap = await getDocs(collection(db, "categories"));
 const fetchedCats: string[] = [];
 catsSnap.forEach((doc) => {
 fetchedCats.push(doc.data().name);
 });
 setCategories(fetchedCats);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.GET, `courses`); } catch (e) { console.error(e); }
 }
 };
 fetchData();
 }, []);

 const dragLevel = useRef<number | null>(null);
 const handleUpdateCategories = async (newCats: string[]) => {
 setCategories(newCats);
 try {
 // Find added categories
 const added = newCats.filter(c => !categories.includes(c));
 // Find removed categories
 const removed = categories.filter(c => !newCats.includes(c));

 for (const cat of added) {
 await setDoc(doc(db, "categories", cat), { name: cat });
 }
 for (const cat of removed) {
 await deleteDoc(doc(db, "categories", cat));
 }
 } catch (e) {
 try { handleFirestoreError(e, OperationType.WRITE, `categories`); } catch (e) { console.error(e); }
 }
 };
 const dragOverLevel = useRef<number | null>(null);

 const set = <K extends keyof Course>(k: K, v: Course[K]): void => setCourse((c) => ({ ...c, [k]: v }));

 const addAuthorToLibrary = async (): void => {
 const newAuthor = emptyAuthor();
 setAuthorsLibrary((lib) => [...lib, newAuthor]);
 try {
 await setDoc(doc(db, "authors", newAuthor.id), newAuthor);
 } catch (e) {
 try { handleFirestoreError(e, OperationType.WRITE, `authors`); } catch (e) { console.error(e); }
 }
 };

 const updateLibraryAuthor = async (i: number, a: Author): Promise<void> => {
 setAuthorsLibrary((lib) => { const next = [...lib]; next[i] = a; return next; });
 try {
 await setDoc(doc(db, "authors", a.id), a);
 } catch (e) {
 try { handleFirestoreError(e, OperationType.UPDATE, `authors`); } catch (e) { console.error(e); }
 }
 };

 const removeLibraryAuthor = async (i: number): Promise<void> => {
 const removed = authorsLibrary[i].id;
 setAuthorsLibrary((lib) => lib.filter((_, idx) => idx !== i));
 set("authorIds", course.authorIds.filter((id) => id !== removed));
 try {
 await deleteDoc(doc(db, "authors", removed));
 } catch (e) {
 try { handleFirestoreError(e, OperationType.DELETE, `authors`); } catch (e) { console.error(e); }
 }
 };

 const addLevel = (): void => set("levels", [...course.levels, emptyLevel()]);
 const updateLevel = (i: number, lv: Level): void => { const ls = [...course.levels]; ls[i] = lv; set("levels", ls); };
 const removeLevel = (i: number): void => set("levels", course.levels.filter((_, idx) => idx !== i));

 const onLevelDragEnd = (): void => {
 if (dragLevel.current === null || dragOverLevel.current === null) return;
 const ls = [...course.levels];
 const [moved] = ls.splice(dragLevel.current, 1);
 ls.splice(dragOverLevel.current, 0, moved);
 set("levels", ls);
 dragLevel.current = null; dragOverLevel.current = null;
 };

 const handleSave = async (status: CourseStatus): Promise<void> => {
 setSaving(true);
 // Populate author name for the list view
 const mainAuthor = authorsLibrary.find(a => course.authorIds.includes(a.id));
 const authorName = mainAuthor ? mainAuthor.name : "No Author";
 const payload: any = { ...course, status, author: authorName, updatedAt: new Date().toISOString() };
 if (!course.id) {
     payload.createdAt = new Date().toISOString();
   }
   console.log("SAVE →", payload);
   try {
     const tenantId = await getTenantScope();
     if (course.id) {
       if (tenantId) {
         const docSnap = await getDoc(doc(db, "courses", course.id));
         if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
           console.error('Tenant mismatch');
           return;
         }
       }
       await updateDoc(doc(db, "courses", course.id), payload as any);
     } else {
       const docRef = await addDoc(collection(db, "courses"), { ...payload, tenantId: tenantId || null });
       setCourse(c => ({ ...c, id: docRef.id }));
     }
 setSaved(true);
 setTimeout(() => setSaved(false), 2500);
 } catch (e) {
 try { handleFirestoreError(e, OperationType.WRITE, `courses`); } catch (e) { console.error(e); }
 alert("Error saving course. Please try again.");
 } finally {
 setSaving(false);
 }
 };

 const selectedAuthors = authorsLibrary.filter((a) => course.authorIds.includes(a.id));
 const totalSections = course.levels.reduce((a, lv) => a + lv.sections.length, 0);
 const totalLessons = course.levels.reduce((a, lv) => a + lv.sections.reduce((b, sec) => b + sec.lessons.length, 0), 0);

 const tabs: { id: "info" | "authors" | "curriculum"; label: string }[] = [
 { id: "info", label: "Course Info" },
 { id: "authors", label: `Authors (${selectedAuthors.length})` },
 { id: "curriculum", label: `Curriculum (${course.levels.length})` },
 ];

 return (
 <div style={s.root}>
 <style>{`
 @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
 *{box-sizing:border-box;margin:0;padding:0;}
 [contenteditable]:empty:before{content:attr(data-placeholder);color:#BBB;pointer-events:none;}
 textarea::placeholder,input::placeholder{color:#BBBBBB;}
 textarea,input,select{outline:none;}
 ::-webkit-scrollbar{width:5px;}
 ::-webkit-scrollbar-thumb{background:#DDD;border-radius:4px;}
 button:disabled{opacity:0.6;cursor:not-allowed;}
 `}</style>

 {showAuthorPicker && (
 <AuthorPickerModal
 authorsLibrary={authorsLibrary}
 selectedIds={course.authorIds}
 onConfirm={(ids) => { set("authorIds", ids); setShowAuthorPicker(false); }}
 onClose={() => setShowAuthorPicker(false)}
 />
 )}

 {/* Top bar */}
 <div style={s.topBar}>
 <div style={s.row}>
 <button style={s.backBtn} onClick={onClose}>
 <ArrowLeft size={20} color={TEXT} />
 </button>
 </div>
 <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
 <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, fontWeight: 600, background: course.status === "published" ? GREEN_BG : GOLD_LIGHT, color: course.status === "published" ? GREEN : GOLD }}>
 {course.status === "published" ? "● Published" : "○ Draft"}
 </div>
 <button style={s.draftBtn} onClick={() => handleSave("draft")} disabled={saving}>Save Draft</button>
 <button style={s.publishBtn} onClick={() => handleSave("published")} disabled={saving}>
 {saved ? "✓ Saved!" : saving ? "Saving..." : "Publish"}
 </button>
 </div>
 </div>

 {/* Page title */}
 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 20px 0" }}>
 <div>
 <h1 style={s.pageTitle}>{course.title || "New Course"}</h1>
 <p style={{ fontSize: 13, color: TEXT2, marginTop: 4 }}>
 {course.levels.length} level{course.levels.length !== 1 ? "s" : ""} · {totalSections} section{totalSections !== 1 ? "s" : ""} · {totalLessons} lesson{totalLessons !== 1 ? "s" : ""}
 </p>
 </div>
 {course.thumbnail && (
 <div style={{ position: 'relative', width: 58, height: 58, borderRadius: 10, overflow: 'hidden', border: `1.5px solid ${BORDER}` }}>
 <Image src={course.thumbnail} alt="" fill sizes="58px" style={{ objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
 </div>
 )}
 </div>

 {/* Tabs */}
 <div style={s.tabBar}>
 {tabs.map((t) => (
 <button key={t.id} style={{ ...s.tab, ...(tab === t.id ? s.tabActive : {}) }} onClick={() => setTab(t.id)}>{t.label}</button>
 ))}
 </div>

 <div style={s.content}>

 {/* ── INFO ── */}
 {tab === "info" && (
 <div style={s.panel}>
 <div style={s.card}>
 <div style={s.sectionHeading}>Basic Information</div>
 <div style={s.cardBody}>
 <Field label="Course Title" value={course.title} onChange={(v) => set("title", v)} placeholder="e.g. The Gospel of John" />
 <div>
 <label style={s.label}>Course Description</label>
 <RichTextEditor content={course.description} onChange={(v) => set("description", v)} minHeight="120px" placeholder="What will students learn?" />
 </div>
 <div style={s.row2}>
 <div>
 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
 <label style={{ ...s.label, marginBottom: 0 }}>Category</label>
 <button onClick={() => setShowCatManager((v) => !v)}
 style={{ background: "none", border: "none", color: GOLD, fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
 {showCatManager ? "Hide" : "Manage"}
 </button>
 </div>
 <select style={s.select} value={course.category} onChange={(e) => set("category", e.target.value)}>
 <option value="">Select category...</option>
 {categories.map((c) => <option key={c}>{c}</option>)}
 </select>
 </div>
 <div>
 <label style={s.label}>Status</label>
 <select style={s.select} value={course.status} onChange={(e) => set("status", e.target.value as CourseStatus)}>
 <option value="draft">Draft</option>
 <option value="published">Published</option>
 </select>
 </div>
 </div>
 <div onClick={() => set("featured", !course.featured)}
 style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${course.featured ? GOLD : BORDER}`, background: course.featured ? GOLD_LIGHT : CARD, cursor: "pointer", transition: "all 0.2s" }}>
 <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
 <span style={{ fontSize: 22 }}>⭐</span>
 <div>
 <div style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>Featured Course</div>
 <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>Pinned at the top of the course library for all users</div>
 </div>
 </div>
 <div style={{ width: 44, height: 24, borderRadius: 99, background: course.featured ? GOLD : BORDER, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
 <div style={{ position: "absolute", top: 3, left: course.featured ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
 </div>
 </div>
 {showCatManager && <CategoriesManager categories={categories} onUpdate={handleUpdateCategories} />}
 </div>
 </div>
 <div style={s.card}>
 <div style={s.sectionHeading}>Thumbnail</div>
 <div style={s.cardBody}>
 <div style={{ padding: "0 0 20px" }}>
 <label style={s.label}>Thumbnail Image</label>
 <div style={{ marginTop: 8 }}>
 <ImageUpload value={course.thumbnail} onChange={(v) => set("thumbnail", v)} placeholder="Upload or paste thumbnail URL" />
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* ── AUTHORS ── */}
 {tab === "authors" && (
 <div style={s.panel}>
 <div style={s.card}>
 <div style={s.sectionHeading}>Authors on this Course</div>
 <div style={s.cardBody}>
 {selectedAuthors.length === 0
 ? <div style={{ color: TEXT2, fontSize: 13 }}>No authors selected. Pick from the library or create a new one.</div>
 : selectedAuthors.map((a) => (
 <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: GOLD_LIGHT, borderRadius: 12, border: `1.5px solid ${GOLD}`, marginBottom: 8 }}>
 {a.picture ? <div style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', overflow: 'hidden' }}><Image src={a.picture} alt="" fill sizes="40px" style={{ objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /></div> : <div style={s.avatarEmpty}>👤</div>}
 <div style={{ flex: 1 }}>
 <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
 {a.title && <div style={{ fontSize: 12, color: TEXT2 }}>{a.title}</div>}
 </div>
 <button style={{ background: RED_BG, border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}
 onClick={() => set("authorIds", course.authorIds.filter((id) => id !== a.id))}>Remove</button>
 </div>
 ))}
 <button style={s.publishBtn} onClick={() => setShowAuthorPicker(true)}>
 {selectedAuthors.length > 0 ? "+ Change / Add Authors" : "+ Select Authors"}
 </button>
 </div>
 </div>
 <div style={s.card}>
 <div style={{ ...s.sectionHeading, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
 <span>Authors Library</span>
 <button onClick={addAuthorToLibrary} style={{ background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>+ New Author</button>
 </div>
 <div style={{ padding: 16 }}>
 {authorsLibrary.length === 0 && <div style={{ color: TEXT2, fontSize: 13, textAlign: "center", padding: "20px 0" }}>No authors in library yet. Create one to reuse across courses.</div>}
 {authorsLibrary.map((author, i) => (
 <AuthorCard key={author.id} author={author}
 onChange={(a) => updateLibraryAuthor(i, a)}
 onRemove={() => removeLibraryAuthor(i)}
 selectable={false} />
 ))}
 </div>
 </div>
 </div>
 )}

 {/* ── CURRICULUM ── */}
 {tab === "curriculum" && (
 <div style={s.panel}>
 <div style={{ background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, borderRadius: 12, padding: "10px 14px", fontSize: 13, color: GOLD, fontWeight: 600 }}>
 Structure: <strong>Level</strong> → Section → Lesson &nbsp;·&nbsp; Drag ⠿ to reorder anything
 </div>
 <button style={s.newBtn} onClick={addLevel}>+ Add Level</button>
 {course.levels.length === 0 && (
 <div style={{ ...s.card, padding: "40px 20px", textAlign: "center" }}>
 <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
 <div style={{ fontWeight: 700, color: TEXT, marginBottom: 4 }}>No levels yet</div>
 <div style={{ color: TEXT2, fontSize: 13 }}>Add your first level to get started.</div>
 </div>
 )}
 {course.levels.map((level, i) => (
 <div key={level.id} draggable
 onDragStart={() => { dragLevel.current = i; }}
 onDragEnter={() => { dragOverLevel.current = i; }}
 onDragEnd={onLevelDragEnd}>
 <LevelCard level={level} onChange={(lv) => updateLevel(i, lv)} onRemove={() => removeLevel(i)} authorsLibrary={selectedAuthors} />
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
}

// ═══════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════
const s: Record<string, CSSProperties> = {
 root: { position: "fixed", inset: 0, zIndex: 50, fontFamily: "'Nunito',sans-serif", background: BG, minHeight: "100vh", color: TEXT, overflowY: "auto" },
 topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", background: CARD, borderBottom: `1px solid ${BORDER}`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
 backBtn: { width: 36, height: 36, borderRadius: "50%", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", marginRight: 10, transition: "background 0.2s" },
 row: { display: "flex", alignItems: "center" },
 draftBtn: { background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "7px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 600 },
 publishBtn: { background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "7px 20px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "inherit", boxShadow: "0 2px 8px rgba(201,150,58,0.35)" },
 pageTitle: { fontSize: 26, fontWeight: 800, color: TEXT, letterSpacing: "-0.3px" },
 tabBar: { display: "flex", padding: "16px 20px 0", borderBottom: `1px solid ${BORDER}` },
 tab: { background: "none", border: "none", color: TEXT2, cursor: "pointer", padding: "10px 16px 12px", fontSize: 14, fontWeight: 600, fontFamily: "inherit", borderBottom: "2.5px solid transparent" },
 tabActive: { color: GOLD, borderBottom: `2.5px solid ${GOLD}` },
 content: { padding: "20px", maxWidth: 820, margin: "0 auto" },
 panel: { display: "flex", flexDirection: "column", gap: 14 },
 card: { background: CARD, borderRadius: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", overflow: "hidden" },
 cardBody: { padding: "16px", display: "flex", flexDirection: "column", gap: 14 },
 sectionHeading: { padding: "12px 16px", fontSize: 11, fontWeight: 700, color: TEXT2, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: `1px solid ${BORDER}` },
 label: { fontSize: 12, fontWeight: 700, color: TEXT2, letterSpacing: "0.04em", textTransform: "uppercase", display: "block", marginBottom: 6 },
 input: { background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: "10px 13px", fontSize: 14, width: "100%", fontFamily: "inherit" },
 textarea: { background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: "10px 13px", fontSize: 14, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 },
 select: { background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: "10px 13px", fontSize: 14, width: "100%", cursor: "pointer", fontFamily: "inherit" },
 row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
 avatar: { width: 40, height: 40, borderRadius: "50%", objectFit: "cover", border: `2px solid ${BORDER}`, flexShrink: 0 },
 avatarEmpty: { width: 40, height: 40, borderRadius: "50%", background: GOLD_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 },
 removeBtn: { background: "none", border: "none", color: "#CCC", cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1, fontFamily: "inherit", marginLeft: 4 },
 newBtn: { background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "13px", borderRadius: 12, cursor: "pointer", fontSize: 14, width: "100%", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(201,150,58,0.3)" },
 addLessonBtn: { background: "transparent", border: `1.5px dashed ${BORDER}`, color: TEXT2, padding: "10px", borderRadius: 10, cursor: "pointer", fontSize: 13, width: "100%", fontFamily: "inherit", fontWeight: 600, marginTop: 4 },
};
