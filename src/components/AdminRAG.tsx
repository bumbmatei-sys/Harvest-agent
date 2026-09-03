import React, { useState, useRef, useEffect } from "react";
import { Upload, Search, Trash2, Sparkles, Database } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, getDoc, deleteDoc, onSnapshot, doc, type DocumentReference } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';
// Chunk → embed → save pipeline lives in one place so the course builder's
// "add to AI Knowledge" reuses this EXACT tenant-scoped write path.
import { chunkText, chunkAndEmbed, finalizeSource, markSourceError } from '../utils/rag-ingest';
import { MAX_PDF_UPLOAD_BYTES, limitMb } from '../utils/upload-limits';
// Rules 1 and 2 (form-layout.ts). This screen is a data-dense PAGE — a sources
// table and a two-column add grid — so it takes FORM_CONTAINER's 1120px page
// measure, not FORM_MEASURE's 940px form measure.
//
// Every rule below arrives as a `className`, and an inline `style` beats a
// class in the cascade, so each width these rules now own had to be REMOVED
// from its `style` object first rather than layered over. The three removals
// are marked at their call sites; nothing else in this file's 88 inline style
// objects is touched.
//
// Rule 4 (desktop control density) applies here too, and for the same reason
// the widths did: measured at 1440px this screen drew a 41px text input and a
// 47px submit, against the module's 38px/40px band whose top is 40px. It is
// spent on the four controls that are genuinely form controls, and it SHRINKS
// them — which is exactly what it is for, and safe here because every token in
// it is `sm:`-gated, so a phone keeps the 41px and 47px it has today.
//
// Three things are deliberately left alone:
//   • the paste TEXTAREA — it is a 220px composer, and a 38px composing box is
//     not a density fix, it is a broken control;
//   • the "+ Add Knowledge"/"Sources" underline TABS (45px) — navigation, not a
//     text-entry control or a primary action, so outside what Rule 4 names;
//   • the 32px row delete button — already under the band, and nothing here may
//     make a target smaller than it already is.
//
// `s.publishBtn` and `s.draftBtn` are NOT edited, because the delete-confirm
// modal spells them too and that modal renders at every width — changing the
// shared object would reach a phone. The one desktop caller overrides its own
// padding at the call site instead.
import { FORM_CONTAINER, FIELD_WIDTH, CONTROL_DENSITY } from './layout/form-layout';


// Gemini API calls are proxied through /api/gemini to keep the API key server-side

// ─────────────────────────────────────────────
// HARVEST — AI Knowledge Base (RAG)
// Admin page to feed content into Firebase vector DB
// ─────────────────────────────────────────────

const GOLD = "var(--brand-color, #C9963A)";
const GOLD_LIGHT = "color-mix(in srgb, var(--brand-color, #C9963A) 12%, var(--surface-raised))";
const GOLD_BTN = "linear-gradient(135deg, var(--brand-color, #C9963A), color-mix(in srgb, var(--brand-color, #C9963A) 82%, #ffffff))";
const BG = "var(--surface)";
const CARD = "var(--surface-raised)";
const TEXT = "var(--text-strong)";
const TEXT2 = "var(--text-muted)";
const BORDER = "var(--border-default)";
const GREEN = "#27AE60";
const GREEN_BG = "#EAFAF1";
const RED = "#E74C3C";
const RED_BG = "#FDECEA";

const uid = () => Math.random().toString(36).slice(2, 9);

// Debranded, muted warm badge palette — labels differentiate types (no emoji/bright colors)
const STONE_100 = "var(--surface-sunken)";
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

// ── Server-side PDF extraction ──────────────────────────
// A PDF is a binary format that readFileAsText turns into garbage, so it's
// parsed server-side (pdf.js kept out of the bundle; large files parsed off the
// phone's main thread).
//
// The bytes do NOT go through /api/rag/extract. Vercel caps a function's request
// body at 4.5MB and rejects anything larger with a 413 raised before the handler
// runs — no JSON body, so the route's own "max 15MB" message never reached the
// admin and the cap was pure fiction. Instead: presign → PUT straight to R2 →
// post only the object key. Same path for every PDF, big or small; a second
// branch for small files would just be a second thing to break.
//
// On any non-OK response we THROW so the caller's catch marks the source failed
// and embeds nothing (an embedded error string is the very bug this replaces).
async function extractFileViaServer(file: File): Promise<string> {
 const token = await auth.currentUser?.getIdToken();
 if (!token) throw new Error("You must be signed in to upload files.");

 // Checked here so a 40MB file is never uploaded at all. This is UX, not
 // enforcement — the route re-checks the real size R2 reports for the object.
 if (file.size > MAX_PDF_UPLOAD_BYTES) {
   throw new Error(`"${file.name}" is too large (max ${limitMb(MAX_PDF_UPLOAD_BYTES)}MB).`);
 }

 // 1. Short-lived presigned R2 PUT URL. The key is minted server-side under the
 // caller's own tenant prefix — we just carry it to step 3.
 let presignRes: Response;
 try {
   presignRes = await fetch("/api/storage/presign", {
     method: "POST",
     headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
     body: JSON.stringify({
       fileName: file.name,
       contentType: "application/pdf",
       fileSize: file.size,
     }),
   });
 } catch {
   throw new Error("Couldn't reach the server. Check your connection and try again.");
 }
 if (!presignRes.ok) {
   const data = await presignRes.json().catch(() => ({}));
   throw new Error(data?.error || `Upload could not be prepared (error ${presignRes.status}).`);
 }
 const { uploadUrl, key } = await presignRes.json();

 // 2. Upload the bytes directly to R2 — no Vercel body limit involved. The
 // Content-Type must match the one that was signed, or R2 rejects the PUT.
 let putRes: Response;
 try {
   putRes = await fetch(uploadUrl, {
     method: "PUT",
     body: file,
     headers: { "Content-Type": "application/pdf" },
   });
 } catch {
   throw new Error(`Couldn't reach the storage server to upload "${file.name}". Please try again.`);
 }
 if (!putRes.ok) {
   throw new Error(`The storage server rejected the upload (error ${putRes.status}).`);
 }

 // 3. Extract from storage. This body is a few dozen bytes, so the platform no
 // longer swallows the response — a 413/422 now arrives with the route's own
 // message intact. The route deletes the temp object either way.
 const res = await fetch("/api/rag/extract", {
   method: "POST",
   headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
   body: JSON.stringify({ r2Key: key }),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(data.error || `Could not extract text from "${file.name}" (HTTP ${res.status})`);
 const text = (data.text || "").trim();
 if (!text) throw new Error(`No readable text found in "${file.name}".`);
 return text;
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
// USAGE INDICATOR — surfaces the RAG caps BEFORE the wall (query tokens this
// month vs cap; ingest used vs ceiling), with an 80% warning and a "full"/
// "limit reached" state carrying the delete-or-upgrade CTA. Reads the snapshot
// from /api/rag-usage (server-side, Admin SDK). Renders nothing for a super
// admin / non-tenant account (unmetered) so no empty card shows.
// ═══════════════════════════════════════════════
function formatTokens(n: number): string {
 if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
 if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
 return `${Math.round(n)}`;
}

interface UsageData {
 metered: boolean;
 queryTokensUsed?: number; queryTokensCap?: number;
 ingestTokensUsed?: number; ingestTokensCeiling?: number;
 month?: string;
}

function UsageMeter({ label, used, limit, kind }: { label: string; used: number; limit: number; kind: 'query' | 'ingest' }) {
 const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
 const over = limit > 0 && used >= limit;
 const warn = pct >= 80 && !over;
 const barColor = over ? RED : warn ? "#E67E22" : GOLD;
 return (
 <div style={{ display:"flex", flexDirection:"column", gap:5, flex:1, minWidth:180 }}>
 <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8 }}>
 <span style={{ fontSize:11.5, color:TEXT2, fontWeight:600 }}>{label}</span>
 <span style={{ fontSize:11.5, fontWeight:700, color: over ? RED : TEXT }}>
 {formatTokens(used)} / {formatTokens(limit)}
 </span>
 </div>
 <div style={{ height:6, borderRadius:99, background:STONE_100, overflow:"hidden" }}>
 <div style={{ width:`${pct}%`, height:"100%", background:barColor, borderRadius:99, transition:"width 0.3s" }} />
 </div>
 {over && (
 <span style={{ fontSize:10.5, color:RED, fontWeight:600 }}>
 {kind === "ingest" ? "Full — delete sources or upgrade to add more" : "Limit reached — upgrade to keep asking"}
 </span>
 )}
 {warn && (
 <span style={{ fontSize:10.5, color:"#B9770E", fontWeight:600 }}>{pct}% used — nearing your plan limit</span>
 )}
 </div>
 );
}

function UsageIndicator({ refreshKey }: { refreshKey: number }) {
 const [usage, setUsage] = useState<UsageData | null>(null);
 useEffect(() => {
 let cancelled = false;
 (async () => {
 try {
 const token = await auth.currentUser?.getIdToken();
 if (!token) return;
 const res = await fetch('/api/rag-usage', { headers: { Authorization: `Bearer ${token}` } });
 if (!res.ok) return;
 const data = await res.json();
 if (!cancelled) setUsage(data);
 } catch (e) { console.warn('Failed to load RAG usage:', e); }
 })();
 return () => { cancelled = true; };
 }, [refreshKey]);

 if (!usage || !usage.metered) return null; // super admin / no tenant → unmetered

 return (
 <div style={{ ...s.card, padding:"14px 16px", display:"flex", flexDirection:"column", gap:12 }}>
 <div style={{ fontSize:11, fontWeight:700, color:GOLD, letterSpacing:"0.14em", textTransform:"uppercase" }}>Plan usage</div>
 <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
 <UsageMeter label="AI queries · this month" used={usage.queryTokensUsed ?? 0} limit={usage.queryTokensCap ?? 0} kind="query" />
 <UsageMeter label="Knowledge base · total" used={usage.ingestTokensUsed ?? 0} limit={usage.ingestTokensCeiling ?? 0} kind="ingest" />
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

 // Bumped after each ingest so the usage meter re-reads its snapshot.
 const [usageRefresh, setUsageRefresh] = useState(0);

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
   setUsageRefresh(k => k + 1); // ingest done → refresh the usage meter
 }
 };

 // ── Handle file upload ──
 const handleFiles = async (files: File[]) => {
 for (const file of files) {
 const ext = file.name.split(".").pop()?.toLowerCase() || "";

 // Excel workbooks are ZIP archives: readFileAsText would embed binary noise,
 // and we don't parse them server-side (the only npm-installable SheetJS build
 // carries unpatched CVEs). Reject them honestly with a clear message and a
 // usable alternative — better than storing garbage that bills against the
 // tenant's ingest ceiling. CSV/TXT plain text still upload fine.
 if (ext === "xlsx" || ext === "xls") {
   notifyError(
     `Can't read "${file.name}"`,
     "Excel files aren't supported. Export the sheet to CSV and upload that, or paste the content as text.",
   );
   continue;
 }

 const type = ext === "pdf" ? "pdf" : ext === "txt" ? "txt" : ext === "csv" ? "sheet" : "txt";
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

   // PDF is a binary format — parse it server-side. CSV and TXT are plain text
   // and read fine in the browser. A failed extraction throws, dropping to the
   // catch below (source marked failed, nothing embedded).
   let text = "";
   if (type === "pdf") {
     text = await extractFileViaServer(file);
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
 setUsageRefresh(k => k + 1); // ingest done → refresh the usage meter
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
 <div data-rag-root style={s.root}>
 {/* ── This block is UNLAYERED, so every selector in it beats every Tailwind
     utility in the app — not just this screen's. Tailwind v4 puts utilities in
     `@layer utilities`, and an unlayered rule outranks any layer whatever its
     specificity, so the `* { margin: 0; padding: 0 }` that used to head this
     block silently stripped the padding and margin off the ENTIRE admin shell,
     the nav rail included, for as long as this tab was mounted. That is why
     opening this screen moved the sidebar.

     It was also redundant: Tailwind's preflight already sets box-sizing and
     zeroes margins, so removing it changes nothing about how this screen
     renders and gives the rest of the app its padding back.

     Everything left is scoped to this screen's own root. Keep it that way. */}
 <style>{`
 [data-rag-root] textarea::placeholder,[data-rag-root] input::placeholder{color:#BBBBBB;}
 [data-rag-root] textarea,[data-rag-root] input,[data-rag-root] select{outline:none;}
 [data-rag-root] ::-webkit-scrollbar{width:5px;}
 [data-rag-root] ::-webkit-scrollbar-thumb{background:#DDD;border-radius:4px;}
 [data-rag-root] button:disabled{opacity:0.5;cursor:not-allowed;}
 @keyframes ragSpin{to{transform:rotate(360deg)}}
 @keyframes ragPulse{0%,100%{opacity:1}50%{opacity:0.4}}
 `}</style>

 {deleteTarget && <DeleteModal source={deleteTarget} onConfirm={confirmDelete} onClose={()=>setDeleteTarget(null)} />}

 {/* Header — desktop only. On mobile the shell's AdminScreenHeader already
     renders the "AI Knowledge" screen title, so this in-page title band is
     hidden to avoid a duplicate; the mobile view starts at the tabs below. */}
 <div className="hidden lg:block">
 {/* Rule 1: `maxWidth:1160, margin:"0 auto"` removed from this style object —
     an inline width would shadow FORM_CONTAINER entirely. */}
 <div className={FORM_CONTAINER} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, padding:"18px 20px 0", width:"100%" }}>
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
 {/* Rule 1: `maxWidth:1160, margin:"0 auto"` removed — see the header band above. */}
 <div className={`hidden lg:block ${FORM_CONTAINER}`} style={{ width:"100%", padding:"0 20px" }}>
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
 <div className="flex bg-surface-sunken rounded-full p-1">
 <button
 onClick={()=>setTab("add")}
 className={`flex-1 rounded-full py-2 text-[13px] font-semibold transition-colors ${tab==="add" ? "bg-surface-raised text-gold shadow-[var(--ds-sh-sm)]" : "text-muted"}`}
 >Add Knowledge</button>
 <button
 onClick={()=>setTab("sources")}
 className={`flex-1 rounded-full py-2 text-[13px] font-semibold transition-colors ${tab==="sources" ? "bg-surface-raised text-gold shadow-[var(--ds-sh-sm)]" : "text-muted"}`}
 >Sources ({sources.length})</button>
 </div>
 </div>

 <div className={FORM_CONTAINER} style={s.content}>

 {/* Usage meter — always visible above the tabs so admins see the caps
     before they hit them. Renders nothing for unmetered (super-admin) accounts. */}
 <div style={{ marginBottom:14 }}>
 <UsageIndicator refreshKey={usageRefresh} />
 </div>

 {/* ── ADD TAB ── */}
 {tab === "add" && (
 <div style={s.panel}>

 {/* Shared hidden file input — clicked by BOTH the mobile and desktop upload
     drop zones. One element/ref, so the two zones never fight over fileInputRef. */}
 <input ref={fileInputRef} type="file" multiple
 accept=".txt,.pdf,.csv"
 style={{ display:"none" }} onChange={handleFileInput} />

 {/* Mobile add view — mockup S.knowledge_new: a single-column stack of cards
     (Paste text · Upload files) + a gold tips note. Reuses the SAME paste
     (pasteTitle/pasteText/handlePasteSubmit/pasteLoading) and upload
     (handleDrop/dragOver/fileInputRef) wiring as the desktop grid below. */}
 <div className="lg:hidden flex flex-col gap-3.5">

 {/* Paste text */}
 <div className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-4 flex flex-col gap-3">
 <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Paste text</div>
 <input value={pasteTitle} onChange={e=>setPasteTitle(e.target.value)}
 placeholder="Source title (optional)"
 className="w-full rounded-brand border border-line bg-surface px-3.5 py-2.5 text-[14px] text-strong" />
 <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)}
 placeholder="Paste sermons, commentary, study notes — anything the AI should know…"
 className="w-full min-h-[150px] rounded-brand border border-line bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed text-strong resize-y" />
 {pasteText.trim() && (
 <div className="text-[12px] text-muted">
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
 <div className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-4 flex flex-col gap-3">
 <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Upload files</div>
 <div onClick={()=>fileInputRef.current?.click()}
 onDragOver={e=>{e.preventDefault();setDragOver(true);}}
 onDragLeave={()=>setDragOver(false)}
 onDrop={handleDrop}
 className={`flex flex-col items-center justify-center gap-2 rounded-brand-lg border-2 border-dashed px-5 py-10 text-center cursor-pointer transition-colors ${dragOver ? "border-gold bg-[var(--surface-gold)]" : "border-line bg-surface-sunken"}`}>
 <Upload size={26} strokeWidth={1.5} className={dragOver ? "text-gold" : "text-muted"} />
 <div className="text-[14px] font-semibold text-strong">Drop files or tap to browse</div>
 <div className="text-[12px] text-muted tracking-wide">TXT · PDF · CSV</div>
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
 <input className={`${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} style={s.input} value={pasteTitle} onChange={e=>setPasteTitle(e.target.value)}
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
 <button className={CONTROL_DENSITY.action} style={{ ...s.publishBtn, padding:"0 13px", fontSize:14, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
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
 <div style={{ fontSize:12, color:TEXT2, letterSpacing:"0.02em" }}>TXT · PDF · CSV</div>
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
 <div className={FIELD_WIDTH.long} style={{ flex:1, position:"relative", display:"flex", alignItems:"center" }}>
 <Search size={16} color={TEXT2} style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)" }} />
 <input className={CONTROL_DENSITY.control} style={{ ...s.input, paddingLeft:38 }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search sources..." />
 </div>
 {/* Rule 2: inline `width:160` removed — `sm:w-full` + the `short` cap render
     the same 160px through the rule instead of around it. */}
 <select className={`sm:w-full ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} style={s.select} value={filterType} onChange={e=>setFilterType(e.target.value)}>
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
 <div className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] px-5 py-14 text-center">
 <div className="w-[52px] h-[52px] rounded-full bg-[var(--surface-gold)] text-gold flex items-center justify-center mx-auto mb-3.5">
 <Database size={22} strokeWidth={1.5} />
 </div>
 <div className="font-semibold text-strong mb-1.5">
 {sources.length === 0 ? "No knowledge added yet" : "No sources match your search"}
 </div>
 <div className="text-[13px] text-muted">
 {sources.length === 0 ? "Go to \"Add Knowledge\" to get started." : "Try a different search or filter."}
 </div>
 </div>
 ) : (
 <div className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
 {filtered.map((source, i) => (
 <div key={source.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? "border-t border-line" : ""}`}>
 <div className="w-[34px] h-[34px] rounded-[9px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
 <Sparkles size={15} />
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-[13.5px] font-semibold text-strong truncate" title={source.title || "Untitled"}>{source.title || "Untitled"}</div>
 <div className="text-[11.5px] text-faint truncate">
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
 className="shrink-0 w-8 h-8 flex items-center justify-center rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors"
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
 <div style={{ width:8, height:8, borderRadius:"50%", background:GOLD, animation:"ragPulse 1.2s infinite" }} />
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
 // Rule 1: `maxWidth:1160, margin:"0 auto"` removed — the cap and the centring
 // are FORM_CONTAINER's now, applied as a className where `s.content` is spread.
 content: { padding:"20px", width:"100%" },
 panel: { display:"flex", flexDirection:"column", gap:14 },
 addGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, alignItems:"stretch" },
 card: { background:CARD, borderRadius:16, boxShadow:"0 1px 6px rgba(0,0,0,0.07)", overflow:"hidden" },
 cardBody: { padding:"16px", display:"flex", flexDirection:"column", gap:14 },
 sectionHeading: { padding:"14px 16px", fontSize:11, fontWeight:700, color:GOLD, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`1px solid ${BORDER}` },
 label: { fontSize:12, fontWeight:700, color:TEXT2, letterSpacing:"0.04em", textTransform:"uppercase" },
 // Rule 4: vertical padding removed so `CONTROL_DENSITY.control` can own the
 // height honestly — an inline `padding` shorthand would shadow `sm:py-0`.
 // Desktop-only object: every caller sits inside a `hidden lg:*` wrapper.
 input: { background:"var(--surface)", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, paddingLeft:13, paddingRight:13, fontSize:14, width:"100%", fontFamily:"inherit" },
 textarea: { background:"var(--surface)", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, padding:"10px 13px", fontSize:14, width:"100%", resize:"vertical", fontFamily:"inherit", lineHeight:1.6 },
 // Rule 4: same removal as `input` above, and the same desktop-only caller.
 select: { background:"var(--surface)", border:`1.5px solid ${BORDER}`, borderRadius:10, color:TEXT, paddingLeft:13, paddingRight:13, fontSize:14, cursor:"pointer", fontFamily:"inherit" },
 draftBtn: { background:"transparent", border:`1.5px solid ${BORDER}`, color:TEXT2, padding:"10px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, flex:1 },
 publishBtn: { background:GOLD_BTN, border:"none", color:"var(--surface-raised)", fontWeight:700, padding:"7px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontFamily:"inherit", boxShadow:"0 2px 8px rgba(201,150,58,0.35)", width:"100%" },
 uploadTypeBtn: { background:"var(--surface)", border:`1.5px solid ${BORDER}`, color:TEXT, padding:"11px 8px", borderRadius:12, cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, textAlign:"center" },
};
