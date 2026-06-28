import React, { useState, useRef, useEffect } from "react";
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, getDoc, deleteDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';


// Gemini API calls are proxied through /api/gemini to keep the API key server-side

// ─────────────────────────────────────────────
// HARVEST — AI Knowledge Base (RAG)
// Admin page to feed content into Firebase vector DB
// ─────────────────────────────────────────────

const GOLD = "var(--brand-color, #C9963A)";
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

const uid = () => Math.random().toString(36).slice(2, 9);

const TYPE_META: Record<string, any> = {
 text: { label:"Text", icon:"📝", color:"#6366F1", bg:"#EEF2FF" },
 txt: { label:"TXT File", icon:"📄", color:"#0891B2", bg:"#ECFEFF" },
 pdf: { label:"PDF", icon:"📕", color:"#DC2626", bg:"#FEF2F2" },
 sheet: { label:"Spreadsheet", icon:"📊", color:"#16A34A", bg:"#F0FDF4" },
};

// ── Chunk text into ~500 char pieces ──────────
function chunkText(text: string, size = 500) {
 const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
 const chunks = [];
 let current = "";
 for (const sentence of sentences) {
 if ((current + sentence).length > size && current.length > 0) {
 chunks.push(current.trim());
 current = sentence;
 } else {
 current += sentence;
 }
 }
 if (current.trim()) chunks.push(current.trim());
 return chunks.filter(c => c.length > 10);
}

// ── Chunking + embedding + Firebase save
async function chunkAndEmbed(text: string, sourceId: string, title: string, type: string, tenantId?: string | null) {
 const chunks = chunkText(text);
 
 for (const chunk of chunks) {
   try {
     const res = await fetch('/api/gemini', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`,
       },
       body: JSON.stringify({ action: 'embed', text: chunk }),
     });
     const data = await res.json();
     if (!res.ok) throw new Error(data.error || 'Embed request failed');
     
     const vector = data.vector;
     if (vector) {
       await addDoc(collection(db, "rag_chunks"), {
         sourceId,
         title,
         type,
         chunk,
         vector,
         createdAt: serverTimestamp(),
         tenantId: tenantId || null
       });
     }
   } catch (error) {
     try { handleFirestoreError(error, OperationType.WRITE, `rag_chunks`); } catch (e) { console.error(e); }
   }
 }
 
 return chunks.length;
}

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
 <span style={{ display:"inline-flex", alignItems:"center", gap:5, background:meta.bg, color:meta.color, border:`1px solid ${meta.color}22`, borderRadius:99, padding:"3px 10px", fontSize:12, fontWeight:700 }}>
 {meta.icon} {meta.label}
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
 <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>🗑️</div>
 <div style={{ fontWeight:800, fontSize:18, textAlign:"center", marginBottom:8 }}>Delete Source?</div>
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

 // Add to Firestore rag_sources
 const tenantId = await getWriteTenantScope();
 await addDoc(collection(db, "rag_sources"), {
   sourceId,
   title,
   type: "text",
   status: "processing",
   chunks: 0,
   addedAt: serverTimestamp(),
   tenantId
 });

 const chunks = await chunkAndEmbed(pasteText, sourceId, title, "text", tenantId);
    
 // Update status to processed
 // Single-field filter only (sourceId is unique); avoids a composite index.
 const q = query(collection(db, 'rag_sources'), where('sourceId', '==', sourceId));
 const snap = await getDocs(q);
 if (!snap.empty) {
 await updateDoc(snap.docs[0].ref, {
 status: "processed",
 chunks
 });
 }
 
 setPasteLoading(false);
 };

 // ── Handle file upload ──
 const handleFiles = async (files: File[]) => {
 for (const file of files) {
 const ext = file.name.split(".").pop()?.toLowerCase() || "";
 const type = ext === "pdf" ? "pdf" : ext === "txt" ? "txt" : (ext === "csv" || ext === "xlsx" || ext === "xls") ? "sheet" : "txt";
 const sourceId = uid();
 
 setTab("sources");

 // Add to Firestore rag_sources
 const tenantId = await getWriteTenantScope();
 await addDoc(collection(db, "rag_sources"), {
   sourceId,
   title: file.name,
   type,
   status: "processing",
   chunks: 0,
   addedAt: serverTimestamp(),
   tenantId
 });

 let text = "";
 try {
 if (type === "pdf") {
 // 🔌 For PDF: use pdf.js or send to a backend parser
 // For now we simulate with placeholder text
 text = `[PDF content of ${file.name} — wire up pdf.js or a backend parser to extract text]`;
 } else {
 text = await readFileAsText(file);
 }
 const chunks = await chunkAndEmbed(text, sourceId, file.name, type, tenantId);
    
 // Update status to processed
 // Single-field filter only (sourceId is unique); avoids a composite index.
 const q = query(collection(db, 'rag_sources'), where('sourceId', '==', sourceId));
 const snap = await getDocs(q);
 if (!snap.empty) {
 await updateDoc(snap.docs[0].ref, {
 status: "processed",
 chunks
 });
 }
 } catch (err) {
   // Update status to error
   // Single-field filter only (sourceId is unique); avoids a composite index.
   const q = query(collection(db, 'rag_sources'), where('sourceId', '==', sourceId));
 const snap = await getDocs(q);
 if (!snap.empty) {
 await updateDoc(snap.docs[0].ref, {
 status: "error"
 });
 }
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

   // Delete from rag_sources
   await deleteDoc(doc(db, "rag_sources", deleteTarget.id));
    
   // Delete chunks from Firestore
   // Single-field filter only (sourceId is unique); avoids a composite index.
   const q = query(collection(db, "rag_chunks"), where("sourceId", "==", deleteTarget.sourceId));
 const snap = await getDocs(q);
 const deletePromises = snap.docs.map(document => deleteDoc(document.ref));
 await Promise.all(deletePromises);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.DELETE, `rag_sources/${deleteTarget.id}`); } catch (e) { console.error(e); }
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
 @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
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

 {/* Stats bar */}
 <div style={{ ...s.topBar, justifyContent:"flex-end" }}>
 {/* Stats */}
 <div style={{ display:"flex", gap:16, alignItems:"center", flexShrink: 0 }}>
 <div style={{ textAlign:"right" }}>
 <div style={{ fontSize:11, color:TEXT2 }}>Total Sources</div>
 <div style={{ fontSize:18, fontWeight:800, color:TEXT }}>{sources.length}</div>
 </div>
 <div style={{ width:1, height:32, background:BORDER }} />
 <div style={{ textAlign:"right" }}>
 <div style={{ fontSize:11, color:TEXT2 }}>Chunks Embedded</div>
 <div style={{ fontSize:18, fontWeight:800, color:GOLD }}>{totalChunks}</div>
 </div>
 </div>
 </div>

 {/* Page description */}
 <div style={{ padding:"16px 20px 0" }}>
 <p style={{ fontSize:13, color:TEXT2 }}>
 Add content to train the AI. All sources are chunked and embedded into Firebase automatically.
 </p>
 </div>

 {/* Tabs */}
 <div style={s.tabBar}>
 <button style={{ ...s.tab, ...(tab==="add"?s.tabActive:{}) }} onClick={()=>setTab("add")}>+ Add Knowledge</button>
 <button style={{ ...s.tab, ...(tab==="sources"?s.tabActive:{}) }} onClick={()=>setTab("sources")}>
 Sources ({sources.length})
 </button>
 </div>

 <div style={s.content}>

 {/* ── ADD TAB ── */}
 {tab === "add" && (
 <div style={s.panel}>

 {/* Paste text */}
 <div style={s.card}>
 <div style={s.sectionHeading}>📝 Paste Text</div>
 <div style={s.cardBody}>
 <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
 <label style={s.label}>Source Title (optional)</label>
 <input style={s.input} value={pasteTitle} onChange={e=>setPasteTitle(e.target.value)}
 placeholder="e.g. Romans Commentary, Sermon Notes..." />
 </div>
 <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
 <label style={s.label}>Content</label>
 <textarea
 style={{ ...s.textarea, minHeight:200, fontSize:14, lineHeight:1.7 }}
 value={pasteText}
 onChange={e=>setPasteText(e.target.value)}
 placeholder="Paste your text here — sermons, Bible commentary, theology articles, study notes, anything you want the AI to know..." />
 </div>
 {pasteText.trim() && (
 <div style={{ fontSize:12, color:TEXT2 }}>
 ~{pasteText.trim().split(/\s+/).length} words · ~{chunkText(pasteText).length} chunks will be created
 </div>
 )}
 <button style={{ ...s.publishBtn, padding:"13px", fontSize:14, borderRadius:12 }}
 onClick={handlePasteSubmit} disabled={!pasteText.trim() || pasteLoading}>
 {pasteLoading ? "⏳ Processing..." : "⚡ Chunk & Embed"}
 </button>
 </div>
 </div>

 {/* File upload */}
 <div style={s.card}>
 <div style={s.sectionHeading}>📁 Upload Files</div>
 <div style={s.cardBody}>
 <p style={{ fontSize:13, color:TEXT2, marginTop:-6 }}>Supports TXT, PDF, CSV, and Excel files.</p>

 {/* Drop zone */}
 <div
 onDragOver={e=>{e.preventDefault();setDragOver(true);}}
 onDragLeave={()=>setDragOver(false)}
 onDrop={handleDrop}
 onClick={()=>fileInputRef.current?.click()}
 style={{
 border:`2px dashed ${dragOver?GOLD:BORDER}`,
 borderRadius:16, padding:"40px 20px",
 textAlign:"center", cursor:"pointer",
 background:dragOver?GOLD_LIGHT:"#FAFAFA",
 transition:"all 0.2s",
 }}>
 <div style={{ fontSize:40, marginBottom:10 }}>📂</div>
 <div style={{ fontWeight:700, fontSize:15, color:TEXT, marginBottom:6 }}>
 Drop files here or click to browse
 </div>
 <div style={{ fontSize:12, color:TEXT2 }}>TXT · PDF · CSV · XLSX</div>
 <input ref={fileInputRef} type="file" multiple
 accept=".txt,.pdf,.csv,.xlsx,.xls"
 style={{ display:"none" }} onChange={handleFileInput} />
 </div>

 {/* Quick upload buttons */}
 <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
 {[
 { label:"📄 TXT File", accept:".txt" },
 { label:"📕 PDF", accept:".pdf" },
 { label:"📊 Spreadsheet", accept:".csv,.xlsx,.xls" },
 ].map(btn => (
 <button key={btn.accept} style={s.uploadTypeBtn} onClick={()=>{
 const inp = document.createElement("input");
 inp.type="file"; inp.accept=btn.accept; inp.multiple=true;
 inp.onchange=(e: any)=>handleFiles(Array.from(e.target.files));
 inp.click();
 }}>{btn.label}</button>
 ))}
 </div>
 </div>
 </div>

 {/* Tips */}
 <div style={{ background:GOLD_LIGHT, border:`1.5px solid ${GOLD}`, borderRadius:14, padding:"14px 16px" }}>
 <div style={{ fontWeight:700, color:GOLD, fontSize:13, marginBottom:8 }}>💡 Tips for better AI results</div>
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
 )}

 {/* ── SOURCES TAB ── */}
 {tab === "sources" && (
 <div style={s.panel}>

 {/* Search + filter */}
 <div style={{ display:"flex", gap:10 }}>
 <div style={{ flex:1, position:"relative" }}>
 <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:TEXT2, fontSize:16 }}>🔍</span>
 <input style={{ ...s.input, paddingLeft:38 }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search sources..." />
 </div>
 <select style={{ ...s.select, width:160 }} value={filterType} onChange={e=>setFilterType(e.target.value)}>
 <option value="all">All Types</option>
 {Object.entries(TYPE_META).map(([k,v])=>(
 <option key={k} value={k}>{v.icon} {v.label}</option>
 ))}
 </select>
 </div>

 {/* Table */}
 <div style={{ ...s.card, overflowX:"auto" }}>
 <div style={{ minWidth: 650 }}>
 {/* Header */}
 <div style={{ display:"grid", gridTemplateColumns:"1.5fr 100px 100px 100px 120px 80px", gap:10, padding:"11px 18px", borderBottom:`1px solid ${BORDER}`, background:"#FAFAFA" }}>
 {["TITLE","TYPE","CHUNKS","DATE","STATUS",""].map((h,i)=>(
 <div key={i} style={{ fontSize:11, fontWeight:700, color:TEXT2, letterSpacing:"0.08em" }}>{h}</div>
 ))}
 </div>

 {/* Rows */}
 {filtered.length === 0 && (
 <div style={{ padding:"48px 20px", textAlign:"center" }}>
 <div style={{ fontSize:36, marginBottom:10 }}>🧠</div>
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
 onMouseEnter={e=>e.currentTarget.style.background="#FAFAFA"}
 onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

 {/* Title */}
 <div style={{ fontWeight:600, fontSize:14, color:TEXT }} title={source.title || "Untitled"}>
 {(source.title || "Untitled").length > 15 ? (source.title || "Untitled").substring(0, 15) + "..." : (source.title || "Untitled")}
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
 <span style={{ fontSize:12, color:GREEN, fontWeight:600 }}>Embedded ✓</span>
 </div>
 )}
 {source.status === "error" && (
 <div style={{ display:"flex", alignItems:"center", gap:6 }}>
 <div style={{ width:8, height:8, borderRadius:"50%", background:RED }} />
 <span style={{ fontSize:12, color:RED, fontWeight:600 }}>Error</span>
 </div>
 )}
 </div>

 {/* Delete */}
 <div style={{ display:"flex", justifyContent:"flex-end" }}>
 <button
 onClick={()=>setDeleteTarget(source)}
 style={{ background:RED_BG, border:`1px solid ${RED}22`, color:RED, borderRadius:8, padding:"5px 11px", cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:600 }}>
 Delete
 </button>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Summary footer */}
 {sources.length > 0 && (
 <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
 {Object.entries(TYPE_META).map(([type, meta]) => {
 const count = sources.filter(s=>s.type===type).length;
 if (!count) return null;
 return (
 <div key={type} style={{ background:meta.bg, border:`1px solid ${meta.color}33`, borderRadius:99, padding:"5px 14px", fontSize:12, fontWeight:700, color:meta.color }}>
 {meta.icon} {count} {meta.label}{count!==1?"s":""}
 </div>
 );
 })}
 <div style={{ background:GOLD_LIGHT, border:`1px solid color-mix(in srgb, var(--brand-color) 20%, transparent)`, borderRadius:99, padding:"5px 14px", fontSize:12, fontWeight:700, color:GOLD }}>
 🧠 {totalChunks} total chunks
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
 root: { fontFamily:"'Nunito',sans-serif", background:BG, minHeight:"100vh", color:TEXT },
 topBar: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", background:CARD, borderBottom:`1px solid ${BORDER}`, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" },
 logoCircle: { width:36, height:36, borderRadius:"50%", background:GOLD_LIGHT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, border:`1.5px solid ${GOLD}`, marginRight:10, flexShrink:0 },
 pageTitle: { fontSize:26, fontWeight:800, color:TEXT, letterSpacing:"-0.3px" },
 tabBar: { display:"flex", padding:"16px 20px 0", borderBottom:`1px solid ${BORDER}` },
 tab: { background:"none", border:"none", color:TEXT2, cursor:"pointer", padding:"10px 16px 12px", fontSize:14, fontWeight:600, fontFamily:"inherit", borderBottom:"2.5px solid transparent" },
 tabActive: { color:GOLD, borderBottom:`2.5px solid ${GOLD}` },
 content: { padding:"20px", maxWidth:820, margin:"0 auto" },
 panel: { display:"flex", flexDirection:"column", gap:14 },
 card: { background:CARD, borderRadius:16, boxShadow:"0 1px 6px rgba(0,0,0,0.07)", overflow:"hidden" },
 cardBody: { padding:"16px", display:"flex", flexDirection:"column", gap:14 },
 sectionHeading: { padding:"12px 16px", fontSize:11, fontWeight:700, color:TEXT2, letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:`1px solid ${BORDER}` },
 label: { fontSize:12, fontWeight:700, color:TEXT2, letterSpacing:"0.04em", textTransform:"uppercase" },
 input: { background:"#FAFAFA", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, width:"100%", fontFamily:"inherit" },
 textarea: { background:"#FAFAFA", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, width:"100%", resize:"vertical", fontFamily:"inherit", lineHeight:1.6 },
 select: { background:"#FAFAFA", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, cursor:"pointer", fontFamily:"inherit" },
 draftBtn: { background:"transparent", border:`1.5px solid ${BORDER}`, color:TEXT2, padding:"10px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, flex:1 },
 publishBtn: { background:GOLD_BTN, border:"none", color:"#fff", fontWeight:700, padding:"7px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontFamily:"inherit", boxShadow:"0 2px 8px rgba(201,150,58,0.35)", width:"100%" },
 uploadTypeBtn: { background:"#FAFAFA", border:`1.5px solid ${BORDER}`, color:TEXT, padding:"11px 8px", borderRadius:12, cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, textAlign:"center" },
};
