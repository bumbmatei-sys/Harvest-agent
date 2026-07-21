import { db, auth } from '../firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore';
import { OperationType, handleFirestoreError } from './firestore-errors';
import { getWriteTenantScope } from './tenant-scope';

// ─────────────────────────────────────────────
// HARVEST — AI Knowledge (RAG) ingest helpers
//
// The chunk → embed → save pipeline, lifted verbatim out of AdminRAG so more
// than one surface can feed the SAME tenant-scoped write path (the AI Knowledge
// page AND the course builder's "Generate with AI → add to AI Knowledge"). The
// internals here are the stabilized owner-read pipeline (own-DocumentReference
// finalize, concrete tenantId on every doc) — reuse them as-is, don't fork them.
// ─────────────────────────────────────────────

/** Short id generator for a rag_sources.sourceId (matches AdminRAG's original). */
export const newRagSourceId = (): string => Math.random().toString(36).slice(2, 9);

// ── Chunk text into ~500 char pieces ──────────
export function chunkText(text: string, size = 500) {
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
// Returns how many chunks were ACTUALLY embedded and written (not just the
// intended count) plus the first error encountered, so the caller can reflect a
// real success/failure state instead of leaving a source stuck on "Processing…".
export async function chunkAndEmbed(
 text: string, sourceId: string, title: string, type: string, tenantId?: string | null
): Promise<{ written: number; total: number; error: string | null }> {
 const chunks = chunkText(text);
 let written = 0;
 let firstError: string | null = null;

 for (const chunk of chunks) {
   try {
     const res = await fetch('/api/gemini', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`,
       },
       // `purpose: 'ingest'` marks this as a KB-document embed so the server
       // meters it against the tenant's persistent ingest ceiling. The chat's
       // query-time embed omits it and is never charged to that ceiling.
       body: JSON.stringify({ action: 'embed', text: chunk, purpose: 'ingest' }),
     });
     const data = await res.json().catch(() => ({}));
     if (!res.ok) {
       // Ingest ceiling reached → the KB is full. Stop here: every remaining
       // chunk of this doc would fail identically. Surface the server's
       // "delete something or upgrade" message so the caller can show the CTA.
       if (res.status === 403 && data.code === 'ingest_ceiling_reached') {
         if (!firstError) firstError = data.error || 'Knowledge base is full — delete sources or upgrade your plan.';
         break;
       }
       throw new Error(data.error || `Embed request failed (HTTP ${res.status})`);
     }

     const vector = data.vector;
     if (!vector) throw new Error('Embedding returned no vector');

     await addDoc(collection(db, "rag_chunks"), {
       sourceId,
       title,
       type,
       chunk,
       vector,
       createdAt: serverTimestamp(),
       // Carry the source's concrete tenantId so the chunk passes the
       // rag_chunks create rule (requestHasCorrectTenant + uploadRag) and is
       // readable by the tenant's admins.
       tenantId: tenantId ?? null
     });
     written++;
   } catch (error) {
     if (!firstError) firstError = error instanceof Error ? error.message : String(error);
     try { handleFirestoreError(error, OperationType.WRITE, `rag_chunks`); } catch (e) { console.error(e); }
   }
 }

 return { written, total: chunks.length, error: firstError };
}

// Reflect the real embedding outcome on the source doc so the row leaves
// "Processing…" for a definite Embedded (real chunk count) or Failed state.
//
// We updateDoc the source's OWN DocumentReference (returned by the addDoc that
// created it) instead of looking it up again. A `where('sourceId','==',…)`
// lookup is NOT tenant-scoped, so Firestore's "rules are not filters" analysis
// rejects it for everyone but a super admin (the rag_sources read rule keys off
// resource.data.tenantId) — that denied read was what surfaced as "Failed to
// add knowledge source" for a tenant owner. Writing straight to the ref needs
// no read and passes the update rule (hasPermission('uploadRag')).
export async function finalizeSource(sourceRef: DocumentReference, written: number, error: string | null) {
 if (written > 0) {
   await updateDoc(sourceRef, { status: "processed", chunks: written, error: null });
 } else {
   await updateDoc(sourceRef, { status: "error", chunks: 0, error: error || 'Embedding failed' });
 }
}

// Best-effort: flip a created source row to a failed state so a thrown error
// never leaves it hanging on "Processing…" with no signal to the user. Uses the
// source's own ref (see finalizeSource) — null when the source was never
// created (the addDoc itself threw), in which case there is nothing to mark.
export async function markSourceError(sourceRef: DocumentReference | null, message: string) {
 if (!sourceRef) return;
 try {
   await updateDoc(sourceRef, { status: "error", error: message });
 } catch (e) { console.error(e); }
}

/** Outcome of {@link ingestTextSource}. `ok` is true only if ≥1 chunk embedded. */
export interface IngestResult {
  ok: boolean;
  written: number;
  total: number;
  error: string | null;
}

/**
 * Full "add a text source to AI Knowledge" flow, mirroring AdminRAG's paste
 * handler so callers share ONE tenant-scoped write path:
 *   getWriteTenantScope → addDoc(rag_sources) → chunkAndEmbed → finalizeSource,
 * with markSourceError on a thrown failure. Never throws — returns the real
 * embed outcome so the caller can degrade gracefully (e.g. the course generator
 * still applies the lesson fields even if the AI-Knowledge part fails).
 */
export async function ingestTextSource(
  text: string,
  title: string,
  type: string = 'text',
): Promise<IngestResult> {
  const sourceId = newRagSourceId();
  // Hold the created source's ref so finalize/mark-error write straight to it
  // (no non-tenant-scoped lookup) — null until the addDoc succeeds.
  let sourceRef: DocumentReference | null = null;
  try {
    // A concrete tenantId is required — chunks written with a null tenantId are
    // rejected by the rag_chunks rule and are unreadable, so bail loudly.
    const tenantId = await getWriteTenantScope();
    if (!tenantId) {
      return { ok: false, written: 0, total: 0, error: 'No tenant context — sign in as a tenant admin.' };
    }

    sourceRef = await addDoc(collection(db, 'rag_sources'), {
      sourceId,
      title,
      type,
      status: 'processing',
      chunks: 0,
      addedAt: serverTimestamp(),
      tenantId,
    });

    const { written, total, error } = await chunkAndEmbed(text, sourceId, title, type, tenantId);
    await finalizeSource(sourceRef, written, error);
    return { ok: written > 0, written, total, error };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed';
    await markSourceError(sourceRef, message);
    return { ok: false, written: 0, total: 0, error: message };
  }
}
