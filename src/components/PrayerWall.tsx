"use client";
import React, { useState, useEffect } from 'react';
import {
 collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, addDoc,
 arrayUnion, arrayRemove, limit, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Trash2 } from 'lucide-react';
import { getTenantScope } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { sortByTime } from '../utils/query-helpers';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

interface PrayerRequest {
 id: string;
 tenantId: string;
 authorId: string;
 authorName: string;
 request: string;
 prayedBy: string[];
 createdAt: string;
}

type RangeFilter = 'all' | 'today' | 'week' | 'month';

const FILTERS: { id: RangeFilter; label: string }[] = [
 { id: 'all', label: 'All' },
 { id: 'today', label: 'Today' },
 { id: 'week', label: 'This Week' },
 { id: 'month', label: 'This Month' },
];

/** Relative "2h ago" style label. */
const relativeTime = (iso: string): string => {
 const ms = Date.now() - new Date(iso).getTime();
 const mins = Math.floor(ms / 60000);
 if (mins < 1) return 'just now';
 if (mins < 60) return `${mins}m ago`;
 const hrs = Math.floor(mins / 60);
 if (hrs < 24) return `${hrs}h ago`;
 const days = Math.floor(hrs / 24);
 if (days < 7) return `${days}d ago`;
 return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Earliest createdAt (ms) that passes the active range filter. */
const filterStart = (filter: RangeFilter): number => {
 if (filter === 'all') return 0;
 if (filter === 'today') {
 const d = new Date();
 d.setHours(0, 0, 0, 0);
 return d.getTime();
 }
 if (filter === 'week') return Date.now() - 7 * 24 * 60 * 60 * 1000;
 return Date.now() - 30 * 24 * 60 * 60 * 1000; // month (last 30 days)
};

const PrayerWall: React.FC = () => {
 const [prayers, setPrayers] = useState<PrayerRequest[]>([]);
 const [loading, setLoading] = useState(true);
 const [name, setName] = useState(auth.currentUser?.displayName ?? '');
 const [request, setRequest] = useState('');
 const [submitting, setSubmitting] = useState(false);
 const [filter, setFilter] = useState<RangeFilter>('all');
 const [isAdmin, setIsAdmin] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Determine admin status (author OR admin may delete). Mirrors Profile's check.
 useEffect(() => {
 let cancelled = false;
 (async () => {
 const user = auth.currentUser;
 if (!user) return;
 if (isSuperAdminEmail(user.email)) { setIsAdmin(true); return; }
 try {
 const { getDoc } = await import('firebase/firestore');
 const snap = await getDoc(doc(db, 'users', user.uid));
 if (!cancelled && snap.exists()) {
 const role = snap.data().role;
 if (role === 'admin' || role === 'church_admin' || role === 'super_admin') setIsAdmin(true);
 }
 } catch { /* non-fatal — falls back to author-only delete */ }
 })();
 return () => { cancelled = true; };
 }, []);

 // Tenant-scoped feed. Single-field where(tenantId); sort + date-filter client-side
 // to avoid a composite index (same pattern as community_posts / NewsTab).
 useEffect(() => {
 let unsubscribe: (() => void) | null = null;
 let cancelled = false;
 (async () => {
 const tenantId = await getTenantScope();
 if (cancelled) return;
 const q = tenantId
 ? query(collection(db, 'prayer_requests'), where('tenantId', '==', tenantId), limit(200))
 : query(collection(db, 'prayer_requests'), limit(200));

 unsubscribe = onSnapshot(q, (snapshot) => {
 const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as PrayerRequest[];
 setPrayers(sortByTime(items, 'createdAt', 'desc'));
 setLoading(false);
 }, (err) => {
 try { handleFirestoreError(err, OperationType.GET, 'prayer_requests'); } catch (e) { console.error(e); }
 setLoading(false);
 });
 })();
 return () => { cancelled = true; if (unsubscribe) unsubscribe(); };
 }, []);

 const handleSubmit = async () => {
 if (!request.trim() || submitting) return;
 const user = auth.currentUser;
 if (!user) {
 setError('Please sign in to share a prayer request.');
 setTimeout(() => setError(null), 3000);
 return;
 }
 setSubmitting(true);
 try {
 const tenantId = await getTenantScope();
 if (!tenantId) { // prayer wall only meaningful inside a tenant
 setError('Prayer requests are only available within a ministry.');
 setTimeout(() => setError(null), 3000);
 return;
 }
 const now = new Date();
 const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
 await addDoc(collection(db, 'prayer_requests'), {
 tenantId,
 authorId: user.uid,
 authorName: name.trim() || 'Anonymous',
 request: request.trim().slice(0, 200),
 prayedBy: [],
 createdAt: now.toISOString(),
 expiresAt: Timestamp.fromDate(expires),
 });
 setRequest('');
 } catch (err) {
 try { handleFirestoreError(err, OperationType.WRITE, 'prayer_requests'); } catch (e) { console.error(e); }
 setError('Could not submit your request. Please try again.');
 setTimeout(() => setError(null), 3000);
 } finally {
 setSubmitting(false);
 }
 };

 const handlePray = async (prayer: PrayerRequest) => {
 const user = auth.currentUser;
 if (!user) {
 setError('Please sign in to pray for requests.');
 setTimeout(() => setError(null), 3000);
 return;
 }
 try {
 const tenantId = await getTenantScope();
 if (tenantId && prayer.tenantId && prayer.tenantId !== tenantId) {
 console.error('Tenant mismatch');
 return;
 }
 const ref = doc(db, 'prayer_requests', prayer.id);
 if ((prayer.prayedBy || []).includes(user.uid)) {
 await updateDoc(ref, { prayedBy: arrayRemove(user.uid) });
 } else {
 await updateDoc(ref, { prayedBy: arrayUnion(user.uid) });
 }
 } catch (err) {
 try { handleFirestoreError(err, OperationType.UPDATE, `prayer_requests/${prayer.id}`); } catch (e) { console.error(e); }
 }
 };

 const handleDelete = async (prayer: PrayerRequest) => {
 try {
 await deleteDoc(doc(db, 'prayer_requests', prayer.id));
 } catch (err) {
 try { handleFirestoreError(err, OperationType.DELETE, `prayer_requests/${prayer.id}`); } catch (e) { console.error(e); }
 }
 };

 const visible = prayers.filter((p) => new Date(p.createdAt).getTime() >= filterStart(filter));
 const uid = auth.currentUser?.uid;

 return (
 <div className="space-y-5 pb-8 w-full">
 {error && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">
 {error}
 </div>
 )}

 {/* Header — Fraunces title on desktop; the auto-clear note shows on both. */}
 <div className="flex items-baseline justify-between">
 <h1 className="hidden lg:block text-[26px] font-light tracking-[-0.02em] text-earth font-display">Prayer wall</h1>
 <span className="text-[13px] text-[color:var(--text-faint)] ml-auto">Requests auto-clear after 30 days</span>
 </div>

 {/* Share bar (mockup): avatar + inline input + Post — mobile & desktop. */}
 <div className="flex items-center gap-3 bg-white rounded-2xl border p-3" style={{ borderColor: 'var(--ds-border)' }}>
 <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-sm font-bold text-warm-brown shrink-0">{(name || 'A').charAt(0).toUpperCase()}</div>
 <input value={request} onChange={(e) => setRequest(e.target.value.slice(0, 200))} onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }} placeholder="Share a prayer request with the community…" className="flex-1 bg-transparent outline-none text-sm text-[color:var(--text-body)] placeholder:text-[color:var(--text-faint)]" />
 <button onClick={handleSubmit} disabled={submitting || !request.trim()} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0" style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}>{submitting ? 'Posting…' : 'Post'}</button>
 </div>

 {/* Range filter — dropdown (cleaner than pills) */}
 <div className="flex justify-end">
 <div className="relative">
 <select
 value={filter}
 onChange={(e) => setFilter(e.target.value as RangeFilter)}
 className="appearance-none bg-white border border-stone-200 rounded-xl pl-4 pr-9 py-2 text-sm font-medium text-[color:var(--text-body)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)]"
 >
 {FILTERS.map((f) => (
 <option key={f.id} value={f.id}>{f.label}</option>
 ))}
 </select>
 <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[color:var(--text-faint)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
 </div>
 </div>

 {/* Feed */}
 {loading ? (
 <div className="flex justify-center py-12">
 <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin"></div>
 </div>
 ) : visible.length === 0 ? (
 <div className="text-center py-12 text-[color:var(--text-faint)] bg-white rounded-2xl border border-stone-200">
 <p className="text-sm font-medium">No prayer requests {filter === 'today' ? 'today' : 'in this range'} yet.</p>
 <p className="text-xs mt-1">Be the first to share one.</p>
 </div>
 ) : (
 <div className="space-y-5 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-5">
 {visible.map((p) => {
 const prayed = !!uid && (p.prayedBy || []).includes(uid);
 const canDelete = (!!uid && p.authorId === uid) || isAdmin;
 return (
 <div key={p.id} className="bg-white rounded-2xl border border-stone-200 p-4">
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2 min-w-0">
 <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold text-warm-brown shrink-0">
 {(p.authorName || 'A').charAt(0).toUpperCase()}
 </div>
 <div className="min-w-0">
 <p className="text-sm font-bold text-earth truncate">{p.authorName || 'Anonymous'}</p>
 <p className="text-[11px] text-[color:var(--text-faint)]">{relativeTime(p.createdAt)}</p>
 </div>
 </div>
 {canDelete && (
 <button
 onClick={() => handleDelete(p)}
 className="text-[color:var(--text-faint)] hover:text-red-500 transition-colors p-1 shrink-0"
 aria-label="Delete prayer request"
 >
 <Trash2 size={15} />
 </button>
 )}
 </div>

 <p className="text-sm text-[color:var(--text-body)] whitespace-pre-wrap mb-3">{p.request}</p>

 <div className="flex items-center pt-2 border-t border-stone-100">
 <button
 onClick={() => handlePray(p)}
 className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${
 prayed ? 'bg-[color-mix(in_srgb,var(--brand-color)_15%,white)]' : 'bg-stone-100 hover:bg-stone-100'
 }`}
 style={prayed ? { color: 'var(--brand-color, #d4a017)' } : { color: 'var(--text-muted)' }}
 aria-pressed={prayed}
 >
 <span className="text-base leading-none">🙏</span>
 <span>{prayed ? 'Prayed' : 'Pray'}</span>
 <span className="opacity-70">· {(p.prayedBy || []).length}</span>
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 );
};

export default PrayerWall;
