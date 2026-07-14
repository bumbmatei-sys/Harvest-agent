import React, { useState, useRef, useEffect } from "react";
import { Upload, Search, Trash2, Sparkles, Database } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, getDoc, deleteDoc, onSnapshot, doc, type DocumentReference } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';
// Chunk → embed → save pipeline lives in one place so the course builder's
// "add to AI Knowledge" reuses this EXACT tenant-scoped write path.
import { chunkText, chunkAndEmbed, finalizeSource, markSourceError } from '../utils/rag-ingest';


// Gemini API calls are proxied through /api/gemini to keep the API key server-side

// ─────────────────────────────────────────────
// HARVEST — AI Knowledge Base (RAG)
// Admin page to feed content into Firebase vector DB
// ─────────────────────────────────────────────

const GOLD = "var(--brand-color, #C9963A)";
const GOLD_LIGHT = "color-mix(in srgb, var(--brand-color, #C9963A) 12%, white)";
const GOLD_BTN = "linear-gradient(135deg, var(--brand-color, #C9963A), color-mix(in srgb, var(--brand-color, #C9963A) 82%, #ffffff))";
const BG = "#FAF8F5";
const CARD = "#FFFFFF";
const TEXT = "#2D2519";
const TEXT2 = "#8B7355";
const BORDER = "#E8E2D9";
const GREEN = "#27AE60";
const GREEN_BG = "#EAFAF1";
const RED = "#E74C3C";
const RED_BG = "#FDECEA";

const uid = () => Math.random().toString(36).slice(2, 9);

// Debranded, muted warm badge palette — labels differentiate types (no emoji/bright colors)
const STONE_100 = "#F3EEE7";
const TYPE_META: Record<string, any> = {
 text: { label:"Text" },
 txt: { label:"TXT" },
 pdf: { label:"PDF" },
 sheet: { label:"Sheet" },
};

// ── Read file as text ──────────────────────────
function readFileAsText(file: File): Promise<string> {
 return new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = e => resolve(e.target?.result as string);
 reader.onerror = reject;
 reader.readAsText(file);
 });
}

// ═══════════════════════════════════════════════
// TYPE BADGE
// ═══════════════════════════════════════════════
function TypeBadge({ type }: { type: string }) {
 const meta = TYPE_META[type] || TYPE_META.text;
 return (
 <span style={{ display:"inline-flex", alignItems:"center", background:STONE_100, color:TEXT2, border:`1px solid ${BORDER}`, borderRadius:99, padding:"3px 11px", fontSize:12, fontWeight:600, letterSpacing:"0.01em" }}>
 {meta.label}
 </span>
 );
}

// ═══════════════════════════════════════════════
// DELETE CONFIRM MODAL
// ═══════════════════════════════════════════════
function DeleteModal({ source, onConfirm, onClose }: { source: any, onConfirm: () => void, onClose: () => void }) {
 return (
 <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
 <div style={{ background:CARD, borderRadius:20, width:"100%", maxWidth:400, padding:28, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
 <div style={{ width:52, height:52, borderRadius:"50%", background:RED_BG, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
 <Trash2 size={22} color={RED} strokeWidth={1.75} />
 </div>
 <div style={{ fontFamily:"var(--font-display), Georgia, serif", fontWeight:400, fontSize:20, textAlign:"center", marginBottom:8, color:TEXT }}>Delete Source?</div>
 <div style={{ color:TEXT2, fontSize:14, textAlign:"center", marginBottom:24, lineHeight:1.6 }}>
 &quot;<strong>{source.title}</strong>&quot; and all its embedded chunks will be permanently removed from the AI knowledge base.
 </div>
 <div style={{ display:"flex", gap:10 }}>
 <button style={s.draftBtn} onClick={onClose}>Cancel</button>
 <button style={{ ...s.publishBtn, background:`linear-gradient(135deg, ${RED}, #F87171)`, flex:2 }} onClick={onConfirm}>Yes, Delete</button>
 </div>
 </div>
 </div>
 );
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════
export default function AdminRAG() {
 const [sources, setSources] = useState<any[]>([]);
 const [tab, setTab] = useState("add"); // add | sources

 // Text paste state
 const [pasteTitle, setPasteTitle] = useState("");
 const [pasteText, setPasteText] = useState("");
 const [pasteLoading, setPasteLoading] = useState(false);

 // File upload state
 const [dragOver, setDragOver] = useState(false);
 const fileInputRef = useRef<HTMLInputElement>(null);

 // Delete modal
 const [deleteTarget, setDeleteTarget] = useState<any>(null);

 // Search
 const [search, setSearch] = useState("");
 const [filterType, setFilterType] = useState("all");

 // Load sources from Firestore (we can aggregate from rag_chunks or maintain a separate rag_sources collection)
 // For simplicity based on the provided design, we'll maintain a 'rag_sources' collection
 useEffect(() => {
   let unsubscribe: (() => void) | null = null;
   let unmounted = false;

   (async () => {
   const tenantId = await getTenantScope();
   if (unmounted) return;
   const q = tenantId
     ? query(collection(db, 'rag_sources'), where('tenantId', '==', tenantId))
     : query(collection(db, 'rag_sources'));
   unsubscribe = onSnapshot(q, (snapshot) => {
     const loadedSources = snapshot.docs.map(doc => ({
       id: doc.id,
       ...doc.data(),
       addedAt: doc.data().addedAt?.toDate?.() || new Date()
     }));
     loadedSources.sort((a: any, b: any) => b.addedAt.getTime() - a.addedAt.getTime());
     setSources(loadedSources);
   }, (error) => {
     try { handleFirestoreError(error, OperationType.GET, `rag_sources`); } catch (e) { console.error(e); }
   });
   })().catch(e => console.error('Failed to load RAG sources:', e));

   return () => { unmounted = true; if (unsubscribe) unsubscribe(); };
 }, []);

 // ── Handle paste text submit ──
 const handlePasteSubmit = async () => {
 if (!pasteText.trim()) return;
 const title = pasteTitle.trim() || `Text — ${new Date().toLocaleDateString()}`;
 const sourceId = uid();

 setPasteTitle(""); setPasteText(""); setTab("sources"); setPasteLoading(true);

 // Hold the created source's ref so finalize/mark-error write straight to it
 // (no non-tenant-scoped lookup) — null until the addDoc succeeds.
 let sourceRef: DocumentReference | null = null;
 try {
   // A concrete tenantId is required — chunks written with a null tenantId are
   // rejected by the rag_chunks rule and are unreadable, so bail loudly instead.
   const tenantId = await getWriteTenantScope();
   if (!tenantId) {
     notifyError('Cannot add knowledge', 'No tenant context — sign in as a tenant admin.');
     return;
   }

   // Add to Firestore rag_sources
   sourceRef = await addDoc(collection(db, "rag_sources"), {
     sourceId,
     title,
     type: "text",
     status: "processing",
     chunks: 0,
     addedAt: serverTimestamp(),
     tenantId
   });

   const { written, error } = await chunkAndEmbed(pasteText, sourceId, title, "text", tenantId);
   await finalizeSource(sourceRef, written, error);
   if (written === 0) notifyError(`Failed to embed "${title}"`, error || 'Embedding failed');
 } catch (err) {
   notifyError('Failed to add knowledge source', err);
   await markSourceError(sourceRef, err instanceof Error ? err.message : 'Processing failed');
 } finally {
   setPasteLoading(false);
 }
 };

 // ── Handle file upload ──
 const handleFiles = async (files: File[]) => {
 for (const file of files) {
 const ext = file.name.split(".").pop()?.toLowerCase() || "";
 const type = ext === "pdf" ? "pdf" : ext === "txt" ? "txt" : (ext === "csv" || ext === "xlsx" || ext === "xls") ? "sheet" : "txt";
 const sourceId = uid();

 setTab("sources");

 // See handlePasteSubmit — finalize/mark-error write straight to this ref.
 let sourceRef: DocumentReference | null = null;
 try {
   // A concrete tenantId is required (see handlePasteSubmit) — bail loudly
   // rather than write unreadable null-tenant chunks.
   const tenantId = await getWriteTenantScope();
   if (!tenantId) {
     notifyError('Cannot upload file', 'No tenant context — sign in as a tenant admin.');
     continue;
   }

   // Add to Firestore rag_sources
   sourceRef = await addDoc(collection(db, "rag_sources"), {
     sourceId,
     title: file.name,
     type,
     status: "processing",
     chunks: 0,
     addedAt: serverTimestamp(),
     tenantId
   });

   let text = "";
   if (type === "pdf") {
     // 🔌 For PDF: use pdf.js or send to a backend parser
     // For now we simulate with placeholder text
     text = `[PDF content of ${file.name} — wire up pdf.js or a backend parser to extract text]`;
   } else {
     text = await readFileAsText(file);
   }
   const { written, error } = await chunkAndEmbed(text, sourceId, file.name, type, tenantId);
   await finalizeSource(sourceRef, written, error);
   if (written === 0) notifyError(`Failed to embed "${file.name}"`, error || 'Embedding failed');
 } catch (err) {
   notifyError(`Failed to process "${file.name}"`, err);
   await markSourceError(sourceRef, err instanceof Error ? err.message : 'Processing failed');
 }
 }
 };

 const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
 if (e.target.files?.length) handleFiles(Array.from(e.target.files));
 e.target.value = "";
 };

 const handleDrop = (e: React.DragEvent) => {
 e.preventDefault(); setDragOver(false);
 if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
 };

 // ── Delete ──
 const confirmDelete = async () => {
 if (!deleteTarget) return;
  
 try {
   // Verify tenant ownership before deleting
   const tenantId = await getTenantScope();
   if (tenantId) {
     const docSnap = await getDoc(doc(db, "rag_sources", deleteTarget.id));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch — cannot modify another tenant\'s document');
       return;
     }
   }

   // Delete the embedded CHUNKS FIRST, then the source doc. Chunks are keyed by
   // the source's generated `sourceId` field — the SAME value chunkAndEmbed
   // writes onto every rag_chunk (NOT the Firestore doc id, which is `.id`).
   // Deleting chunks before the source means any failure here leaves the source
   // row visible and re-deletable instead of orphaning its chunks — orphaned
   // chunks are exactly what kept feeding the blog with deleted content.
   //
   // Scope by tenantId as well as sourceId: a sourceId-only query isn't
   // tenant-scoped, so Firestore's "rules are not filters" analysis rejects it
   // for a tenant owner/admin (the rag_chunks read rule keys off tenantId). Two
   // equality filters need no composite index; a super admin on the platform
   // domain (null tenant) reads unscoped.
   const sourceId = deleteTarget.sourceId;
   if (sourceId) {
     const chunksQ = tenantId
       ? query(collection(db, "rag_chunks"), where("tenantId", "==", tenantId), where("sourceId", "==", sourceId))
       : query(collection(db, "rag_chunks"), where("sourceId", "==", sourceId));
     const snap = await getDocs(chunksQ);
     // Await every delete and fail loudly if any rejects — a swallowed failure
     // here is precisely what left orphaned chunks behind before.
     const results = await Promise.allSettled(snap.docs.map(document => deleteDoc(document.ref)));
     const failed = results.filter(r => r.status === "rejected");
     if (failed.length) {
       throw new Error(`Deleted ${results.length - failed.length}/${snap.size} chunk(s); ${failed.length} failed — source left intact so it can be retried.`);
     }
   } else {
     // A legacy source doc with no sourceId can't have its chunks targeted by
     // sourceId — surface it (the cleanup script sweeps such orphans) rather
     // than silently deleting the source and stranding them.
     console.warn(`rag_sources/${deleteTarget.id} has no sourceId — deleting source only; run cleanup-orphaned-rag-chunks if chunks remain.`);
   }

   // Chunks gone (or none to target) → remove the source doc.
   await deleteDoc(doc(db, "rag_sources", deleteTarget.id));
 } catch (error) {
   try { handleFirestoreError(error, OperationType.DELETE, `rag_sources/${deleteTarget.id}`); } catch (e) { console.error(e); }
   notifyError('Failed to delete source', error);
 }

 setDeleteTarget(null);
 };

 // ── Filtered sources ──
 const filtered = sources.filter(s => {
 const matchSearch = s.title?.toLowerCase().includes(search.toLowerCase());
 const matchType = filterType === "all" || s.type === filterType;
 return matchSearch && matchType;
 });

 const totalChunks = sources.reduce((a, s) => a + (s.chunks || 0), 0);

 return (
 <div style={s.root}>
 <style>{`
 *{box-sizing:border-box;margin:0;padding:0;}
 textarea::placeholder,input::placeholder{color:#BBBBBB;}
 textarea,input,select{outline:none;}
 ::-webkit-scrollbar{width:5px;}
 ::-webkit-scrollbar-thumb{background:#DDD;border-radius:4px;}
 button:disabled{opacity:0.5;cursor:not-allowed;}
 @keyframes spin{to{transform:rotate(360deg)}}
 @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
 `}</style>

 {deleteTarget && <DeleteModal source={deleteTarget} onConfirm={confirmDelete} onClose={()=>setDeleteTarget(null)} />}

 {/* Header — desktop only. On mobile the shell's AdminScreenHeader already
     renders the "AI Knowledge" screen title, so this in-page title band is
     hidden to avoid a duplicate; the mobile view starts at the tabs below. */}
 <div className="hidden lg:block">
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, padding:"18px 20px 0", maxWidth:1160, margin:"0 auto", width:"100%" }}>
 <div style={{ minWidth:0 }}>
 <p style={{ fontSize:11, fontWeight:600, letterSpacing:"0.16em", textTransform:"uppercase", color:GOLD, marginBottom:6 }}>Content</p>
 <h1 style={{ fontFamily:"var(--font-display), Georgia, serif", fontSize:28, fontWeight:300, color:TEXT, letterSpacing:"-0.02em" }}>AI Knowledge Base</h1>
 <p style={{ fontSize:13, color:TEXT2, marginTop:6, maxWidth:560 }}>
 Add content to train the AI. All sources are chunked and embedded automatically — the assistant, chat, and blog draw from this.
 </p>
 </div>
 <div style={{ display:"flex", gap:16, alignItems:"center", flexShrink:0 }}>
 <div style={{ textAlign:"right" }}>
 <div style={{ fontSize:11, color:TEXT2 }}>Sources</div>
 <div style={{ fontSize:20, fontWeight:700, color:TEXT }}>{sources.length}</div>
 </div>
 <div style={{ width:1, height:32, background:BORDER }} />
 <div style={{ textAlign:"right" }}>
 <div style={{ fontSize:11, color:TEXT2 }}>Chunks</div>
 <div style={{ fontSize:20, fontWeight:700, color:GOLD }}>{totalChunks}</div>
 </div>
 </div>
 </div>
 </div>

 {/* Tabs — desktop underline tabs. On mobile the same add|sources modes render
     as the segmented control below (responsive split); tab/setTab is shared. */}
 <div className="hidden lg:block" style={{ maxWidth:1160, margin:"0 auto", width:"100%", padding:"0 20px" }}>
 <div style={s.tabBar}>
 <button style={{ ...s.tab, ...(tab==="add"?s.tabActive:{}) }} onClick={()=>setTab("add")}>+ Add Knowledge</button>
 <button style={{ ...s.tab, ...(tab==="sources"?s.tabActive:{}) }} onClick={()=>setTab("sources")}>
 Sources ({sources.length})
 </button>
 </div>
 </div>

 {/* Mobile segmented control — the add|sources tab modes styled as the mockup's
     segmented control (stone track, white/gold active pill). Same tab/setTab state. */}
 <div className="lg:hidden px-5 pt-3">
 <div className="flex bg-stone-100 rounded-full p-1">
 <button
 onClick={()=>setTab("add")}
 className={`flex-1 rounded-full py-2 text-[13px] font-semibold transition-colors ${tab==="add" ? "bg-white text-gold shadow-[var(--ds-sh-sm)]" : "text-warm-brown"}`}
 >Add Knowledge</button>
 <button
 onClick={()=>setTab("sources")}
 className={`flex-1 rounded-full py-2 text-[13px] font-semibold transition-colors ${tab==="sources" ? "bg-white text-gold shadow-[var(--ds-sh-sm)]" : "text-warm-brown"}`}
 >Sources ({sources.length})</button>
 </div>
 </div>

 <div style={s.content}>

 {/* ── ADD TAB ── */}
 {tab === "add" && (
 <div style={s.panel}>

 {/* Shared hidden file input — clicked by BOTH the mobile and desktop upload
     drop zones. One element/ref, so the two zones never fight over fileInputRef. */}
 <input ref={fileInputRef} type="file" multiple
 accept=".txt,.pdf,.csv,.xlsx,.xls"
 style={{ display:"none" }} onChange={handleFileInput} />

 {/* Mobile add view — mockup S.knowledge_new: a single-column stack of cards
     (Paste text · Upload files) + a gold tips note. Reuses the SAME paste
     (pasteTitle/pasteText/handlePasteSubmit/pasteLoading) and upload
     (handleDrop/dragOver/fileInputRef) wiring as the desktop grid below. */}
 <div className="lg:hidden flex flex-col gap-3.5">

 {/* Paste text */}
 <div className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] p-4 flex flex-col gap-3">
 <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Paste text</div>
 <input value={pasteTitle} onChange={e=>setPasteTitle(e.target.value)}
 placeholder="Source title (optional)"
 className="w-full rounded-brand border border-stone-200 bg-cream px-3.5 py-2.5 text-[14px] text-earth" />
 <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)}
 placeholder="Paste sermons, commentary, study notes — anything the AI should know…"
 className="w-full min-h-[150px] rounded-brand border border-stone-200 bg-cream px-3.5 py-2.5 text-[14px] leading-relaxed text-earth resize-y" />
 {pasteText.trim() && (
 <div className="text-[12px] text-warm-brown">
 ~{pasteText.trim().split(/\s+/).length} words · ~{chunkText(pasteText).length} chunks
 </div>
 )}
 <button onClick={handlePasteSubmit} disabled={!pasteText.trim() || pasteLoading}
 className="flex items-center justify-center gap-2 w-full rounded-brand-lg py-3 text-[14px] font-semibold text-white shadow-[var(--ds-sh-sm)]"
 style={{ background: GOLD_BTN }}>
 <Sparkles size={16} /> {pasteLoading ? "Processing…" : "Chunk & Embed"}
 </button>
 </div>

 {/* Upload files */}
 <div className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] p-4 flex flex-col gap-3">
 <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Upload files</div>
 <div onClick={()=>fileInputRef.current?.click()}
 onDragOver={e=>{e.preventDefault();setDragOver(true);}}
 onDragLeave={()=>setDragOver(false)}
 onDrop={handleDrop}
 className={`flex flex-col items-center justify-center gap-2 rounded-brand-lg border-2 border-dashed px-5 py-10 text-center cursor-pointer transition-colors ${dragOver ? "border-gold bg-[var(--surface-gold)]" : "border-stone-200 bg-stone-100"}`}>
 <Upload size={26} strokeWidth={1.5} className={dragOver ? "text-gold" : "text-warm-brown"} />
 <div className="text-[14px] font-semibold text-earth">Drop files or tap to browse</div>
 <div className="text-[12px] text-warm-brown tracking-wide">TXT · PDF · CSV · XLSX</div>
 </div>
 </div>

 {/* Tips */}
 <div className="rounded-brand-lg border border-gold bg-[var(--surface-gold)] p-4">
 <div className="text-[13px] font-bold text-gold mb-2">Tips for better AI results</div>
 <div className="flex flex-col gap-1.5">
 {[
 "Use clear, well-structured text — the AI reads it as-is",
 "Each source is split into ~500 character chunks automatically",
 "Bible content works best when grouped by book or topic",
 "PDFs require text — scanned image PDFs won't extract well",
 ].map((tip,i)=>(
 <div key={i} className="flex gap-2 text-[13px] text-wheat-700">
 <span className="shrink-0">•</span><span>{tip}</span>
 </div>
 ))}
 </div>
 </div>
 </div>

 {/* Desktop add view — two-column grid, hidden on mobile (mobile uses the
     stacked cards above). Wrapper reproduces s.panel's 14px column gap. */}
 <div className="hidden lg:flex lg:flex-col lg:gap-[14px]">

 {/* Two columns: Paste Text · Upload Files */}
 <div style={s.addGrid}>

 {/* Paste text */}
 <div style={{ ...s.card, display:"flex", flexDirection:"column" }}>
 <div style={s.sectionHeading}>Paste Text</div>
 <div style={{ ...s.cardBody, flex:1 }}>
 <input style={s.input} value={pasteTitle} onChange={e=>setPasteTitle(e.target.value)}
 placeholder="Source title (optional) — e.g. Romans Commentary" />
 <textarea
 style={{ ...s.textarea, flex:1, minHeight:220, fontSize:14, lineHeight:1.7 }}
 value={pasteText}
 onChange={e=>setPasteText(e.target.value)}
 placeholder="Paste sermons, Bible commentary, theology articles, study notes — anything you want the AI to know..." />
 {pasteText.trim() && (
 <div style={{ fontSize:12, color:TEXT2 }}>
 ~{pasteText.trim().split(/\s+/).length} words · ~{chunkText(pasteText).length} chunks will be created
 </div>
 )}
 <button style={{ ...s.publishBtn, padding:"13px", fontSize:14, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
 onClick={handlePasteSubmit} disabled={!pasteText.trim() || pasteLoading}>
 <Sparkles size={16} /> {pasteLoading ? "Processing…" : "Chunk & Embed"}
 </button>
 </div>
 </div>

 {/* File upload */}
 <div style={{ ...s.card, display:"flex", flexDirection:"column" }}>
 <div style={s.sectionHeading}>Upload Files</div>
 <div style={{ ...s.cardBody, flex:1 }}>

 {/* Drop zone */}
 <div
 onDragOver={e=>{e.preventDefault();setDragOver(true);}}
 onDragLeave={()=>setDragOver(false)}
 onDrop={handleDrop}
 onClick={()=>fileInputRef.current?.click()}
 style={{
 flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
 border:`2px dashed ${dragOver?GOLD:BORDER}`,
 borderRadius:16, padding:"40px 20px", minHeight:260,
 textAlign:"center", cursor:"pointer",
 background:dragOver?GOLD_LIGHT:STONE_100,
 transition:"all 0.2s",
 }}>
 <Upload size={30} color={dragOver?GOLD:TEXT2} strokeWidth={1.5} style={{ marginBottom:14 }} />
 <div style={{ fontWeight:700, fontSize:15, color:TEXT, marginBottom:6 }}>
 Drop files here or click to browse
 </div>
 <div style={{ fontSize:12, color:TEXT2, letterSpacing:"0.02em" }}>TXT · PDF · CSV · XLSX</div>
 </div>
 </div>
 </div>
 </div>

 {/* Tips */}
 <div style={{ background:GOLD_LIGHT, border:`1.5px solid ${GOLD}`, borderRadius:14, padding:"14px 16px" }}>
 <div style={{ fontWeight:700, color:GOLD, fontSize:13, marginBottom:8 }}>Tips for better AI results</div>
 <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
 {[
 "Use clear, well-structured text — the AI reads it as-is",
 "Each source is split into ~500 character chunks automatically",
 "Bible content works best when grouped by book or topic",
 "PDFs require text — scanned image PDFs won't extract well",
 ].map((tip,i)=>(
 <div key={i} style={{ display:"flex", gap:8, fontSize:13, color:"#92610A" }}>
 <span style={{ flexShrink:0 }}>•</span><span>{tip}</span>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 )}

 {/* ── SOURCES TAB ── */}
 {tab === "sources" && (
 <div style={s.panel}>

 {/* Mobile — gold eyebrow subhead + "Add source" primary CTA (mockup
     S.knowledge). "Add source" reuses the existing add flow via setTab. */}
 <div className="lg:hidden flex flex-col gap-3">
 <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
 {sources.length} {sources.length === 1 ? "source" : "sources"} · {totalChunks} chunks
 </div>
 <button
 onClick={()=>setTab("add")}
 className="flex items-center justify-center gap-2 w-full rounded-brand-xl py-3 text-[14px] font-semibold text-white shadow-[var(--ds-sh-sm)]"
 style={{ background: GOLD_BTN }}
 >
 <Sparkles size={16} /> Add source
 </button>
 </div>

 {/* Search + filter — desktop only. On mobile the mockup shows every source with
     no filter bar, so this is hidden (search/filterType stay at their defaults). */}
 <div className="hidden lg:flex" style={{ gap:10 }}>
 <div style={{ flex:1, position:"relative", display:"flex", alignItems:"center" }}>
 <Search size={16} color={TEXT2} style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)" }} />
 <input style={{ ...s.input, paddingLeft:38 }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search sources..." />
 </div>
 <select style={{ ...s.select, width:160 }} value={filterType} onChange={e=>setFilterType(e.target.value)}>
 <option value="all">All types</option>
 {Object.entries(TYPE_META).map(([k,v])=>(
 <option key={k} value={k}>{v.label}</option>
 ))}
 </select>
 </div>

 {/* Mobile sources list — mockup knowledge-source cards: gold AI disc, title,
     "N chunks · date", a status pill (field=Embedded / wheat=Processing /
     red=Failed) and a delete button. Same `filtered` data and the same
     setDeleteTarget handler as the desktop table below. */}
 <div className="lg:hidden">
 {filtered.length === 0 ? (
 <div className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] px-5 py-14 text-center">
 <div className="w-[52px] h-[52px] rounded-full bg-[var(--surface-gold)] text-gold flex items-center justify-center mx-auto mb-3.5">
 <Database size={22} strokeWidth={1.5} />
 </div>
 <div className="font-semibold text-earth mb-1.5">
 {sources.length === 0 ? "No knowledge added yet" : "No sources match your search"}
 </div>
 <div className="text-[13px] text-warm-brown">
 {sources.length === 0 ? "Go to \"Add Knowledge\" to get started." : "Try a different search or filter."}
 </div>
 </div>
 ) : (
 <div className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
 {filtered.map((source, i) => (
 <div key={source.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? "border-t border-stone-200" : ""}`}>
 <div className="w-[34px] h-[34px] rounded-[9px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
 <Sparkles size={15} />
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-[13.5px] font-semibold text-earth truncate" title={source.title || "Untitled"}>{source.title || "Untitled"}</div>
 <div className="text-[11.5px] text-[color:var(--text-faint)] truncate">
 {source.chunks} chunks{source.addedAt instanceof Date ? ` · ${source.addedAt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}` : ""}
 </div>
 </div>
 {source.status === "processing" && (
 <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-wheat-100 text-wheat-700 px-2.5 py-1 text-[11px] font-semibold">
 <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" /> Processing
 </span>
 )}
 {source.status === "processed" && (
 <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-field-100 text-field-700 px-2.5 py-1 text-[11px] font-semibold">
 <span className="w-1.5 h-1.5 rounded-full bg-field-500" /> Embedded
 </span>
 )}
 {source.status === "error" && (
 <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#FDECEA] text-[#C0392B] px-2.5 py-1 text-[11px] font-semibold" title={source.error || "Failed to process"}>
 <span className="w-1.5 h-1.5 rounded-full bg-[#E74C3C]" /> Failed
 </span>
 )}
 <button
 onClick={()=>setDeleteTarget(source)}
 title="Delete source"
 className="shrink-0 w-8 h-8 flex items-center justify-center rounded-brand text-[color:var(--text-faint)] hover:text-[#C4553B] hover:bg-[#F7E7E2] transition-colors"
 >
 <Trash2 size={15} strokeWidth={1.75} />
 </button>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Table — desktop only (mobile uses the card list above). */}
 <div className="hidden lg:block" style={{ ...s.card, overflowX:"auto" }}>
 <div style={{ minWidth: 650 }}>
 {/* Header */}
 <div style={{ display:"grid", gridTemplateColumns:"1.5fr 100px 100px 100px 120px 80px", gap:10, padding:"12px 18px", borderBottom:`1px solid ${BORDER}`, background:STONE_100 }}>
 {["TITLE","TYPE","CHUNKS","DATE","STATUS",""].map((h,i)=>(
 <div key={i} style={{ fontSize:11, fontWeight:700, color:GOLD, letterSpacing:"0.1em" }}>{h}</div>
 ))}
 </div>

 {/* Rows */}
 {filtered.length === 0 && (
 <div style={{ padding:"56px 20px", textAlign:"center" }}>
 <div style={{ width:52, height:52, borderRadius:"50%", background:GOLD_LIGHT, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
 <Database size={22} color={GOLD} strokeWidth={1.5} />
 </div>
 <div style={{ fontWeight:700, color:TEXT, marginBottom:6 }}>
 {sources.length === 0 ? "No knowledge added yet" : "No sources match your search"}
 </div>
 <div style={{ color:TEXT2, fontSize:13 }}>
 {sources.length === 0 ? "Go to \"Add Knowledge\" to get started." : "Try a different search or filter."}
 </div>
 </div>
 )}

 {filtered.map((source, i) => (
 <div key={source.id}
 style={{ display:"grid", gridTemplateColumns:"1.5fr 100px 100px 100px 120px 80px", gap:10, padding:"14px 18px", borderBottom: i<filtered.length-1?`1px solid ${BORDER}`:"none", alignItems:"center", transition:"background 0.15s" }}
 onMouseEnter={e=>e.currentTarget.style.background="#FAF8F5"}
 onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

 {/* Title */}
 <div style={{ fontWeight:600, fontSize:14, color:TEXT, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={source.title || "Untitled"}>
 {source.title || "Untitled"}
 </div>

 {/* Type */}
 <div><TypeBadge type={source.type} /></div>

 {/* Chunks */}
 <div style={{ fontSize:13, color:TEXT2 }}>
 {source.chunks} chunks
 </div>

 {/* Date */}
 <div style={{ fontSize:13, color:TEXT2 }}>
 {source.addedAt instanceof Date ? source.addedAt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : ''}
 </div>

 {/* Status */}
 <div>
 {source.status === "processing" && (
 <div style={{ display:"flex", alignItems:"center", gap:6 }}>
 <div style={{ width:8, height:8, borderRadius:"50%", background:GOLD, animation:"pulse 1.2s infinite" }} />
 <span style={{ fontSize:12, color:GOLD, fontWeight:600 }}>Processing...</span>
 </div>
 )}
 {source.status === "processed" && (
 <div style={{ display:"flex", alignItems:"center", gap:6 }}>
 <div style={{ width:8, height:8, borderRadius:"50%", background:GREEN }} />
 <span style={{ fontSize:12, color:GREEN, fontWeight:600 }}>Embedded</span>
 </div>
 )}
 {source.status === "error" && (
 <div style={{ display:"flex", flexDirection:"column", gap:2 }} title={source.error || "Failed to process"}>
 <div style={{ display:"flex", alignItems:"center", gap:6 }}>
 <div style={{ width:8, height:8, borderRadius:"50%", background:RED }} />
 <span style={{ fontSize:12, color:RED, fontWeight:600 }}>Failed</span>
 </div>
 {source.error && (
 <span style={{ fontSize:10, color:TEXT2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:110 }}>
 {source.error}
 </span>
 )}
 </div>
 )}
 </div>

 {/* Delete */}
 <div style={{ display:"flex", justifyContent:"flex-end" }}>
 <button
 onClick={()=>setDeleteTarget(source)}
 title="Delete source"
 style={{ display:"flex", alignItems:"center", justifyContent:"center", width:32, height:32, background:"transparent", border:`1px solid ${BORDER}`, color:TEXT2, borderRadius:8, cursor:"pointer" }}
 onMouseEnter={e=>{ e.currentTarget.style.background=RED_BG; e.currentTarget.style.borderColor=`${RED}44`; e.currentTarget.style.color=RED; }}
 onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor=BORDER; e.currentTarget.style.color=TEXT2; }}>
 <Trash2 size={15} strokeWidth={1.75} />
 </button>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Summary footer */}
 {sources.length > 0 && (
 <div className="hidden lg:flex" style={{ gap:10, flexWrap:"wrap" }}>
 {Object.entries(TYPE_META).map(([type, meta]) => {
 const count = sources.filter(s=>s.type===type).length;
 if (!count) return null;
 return (
 <div key={type} style={{ background:STONE_100, border:`1px solid ${BORDER}`, borderRadius:99, padding:"5px 14px", fontSize:12, fontWeight:600, color:TEXT2 }}>
 {count} {meta.label}{count!==1?"s":""}
 </div>
 );
 })}
 <div style={{ background:GOLD_LIGHT, border:`1px solid color-mix(in srgb, var(--brand-color) 20%, transparent)`, borderRadius:99, padding:"5px 14px", fontSize:12, fontWeight:700, color:GOLD }}>
 {totalChunks} total chunks
 </div>
 </div>
 )}
 </div>
 )}
 </div>
 </div>
 );
}

// ── Styles ─────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
 root: { fontFamily:"var(--font-sans), system-ui, sans-serif", background:BG, minHeight:"100vh", color:TEXT },
 topBar: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", background:CARD, borderBottom:`1px solid ${BORDER}`, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" },
 logoCircle: { width:36, height:36, borderRadius:"50%", background:GOLD_LIGHT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, border:`1.5px solid ${GOLD}`, marginRight:10, flexShrink:0 },
 pageTitle: { fontSize:26, fontWeight:800, color:TEXT, letterSpacing:"-0.3px" },
 tabBar: { display:"flex", paddingTop:16, borderBottom:`1px solid ${BORDER}` },
 tab: { background:"none", border:"none", color:TEXT2, cursor:"pointer", padding:"10px 4px 12px", marginRight:24, fontSize:14, fontWeight:600, fontFamily:"inherit", borderBottom:"2.5px solid transparent" },
 tabActive: { color:GOLD, borderBottom:`2.5px solid ${GOLD}` },
 content: { padding:"20px", maxWidth:1160, margin:"0 auto", width:"100%" },
 panel: { display:"flex", flexDirection:"column", gap:14 },
 addGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, alignItems:"stretch" },
 card: { background:CARD, borderRadius:16, boxShadow:"0 1px 6px rgba(0,0,0,0.07)", overflow:"hidden" },
 cardBody: { padding:"16px", display:"flex", flexDirection:"column", gap:14 },
 sectionHeading: { padding:"14px 16px", fontSize:11, fontWeight:700, color:GOLD, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`1px solid ${BORDER}` },
 label: { fontSize:12, fontWeight:700, color:TEXT2, letterSpacing:"0.04em", textTransform:"uppercase" },
 input: { background:"#FAF8F5", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, width:"100%", fontFamily:"inherit" },
 textarea: { background:"#FAF8F5", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, width:"100%", resize:"vertical", fontFamily:"inherit", lineHeight:1.6 },
 select: { background:"#FAF8F5", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, cursor:"pointer", fontFamily:"inherit" },
 draftBtn: { background:"transparent", border:`1.5px solid ${BORDER}`, color:TEXT2, padding:"10px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, flex:1 },
 publishBtn: { background:GOLD_BTN, border:"none", color:"#fff", fontWeight:700, padding:"7px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontFamily:"inherit", boxShadow:"0 2px 8px rgba(201,150,58,0.35)", width:"100%" },
 uploadTypeBtn: { background:"#FAF8F5", border:`1.5px solid ${BORDER}`, color:TEXT, padding:"11px 8px", borderRadius:12, cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, textAlign:"center" },
};
