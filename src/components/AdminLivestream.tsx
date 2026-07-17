"use client";
import React, { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, setDoc, getDocs, deleteDoc,
  serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import { Radio, Eye, HandHeart, Check, Loader2, Video, Play, MessageCircle, Trash2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { useAppStore } from '../store/useAppStore';

const GOLD = 'var(--brand-color, #B8962E)';

/** Extract a YouTube video id from a URL or accept a raw id. */
function parseYouTubeId(input: string): string {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/embed\/)([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return '';
}

interface CurrentStream {
  active?: boolean;
  youtubeVideoId?: string;
  title?: string;
  startedAt?: Timestamp | null;
  viewerCount?: number;
  prayerCount?: number;
  sessionId?: string;
  sermonNote?: {
    docId: string;
    title: string;
    contentHtml: string;
    sharedAt: Timestamp | null;
    sharedBy: string;
  } | null;
}

interface Prayer {
  id: string;
  name: string;
  prayerText: string;
  submittedAt: Timestamp | null;
  prayed: boolean;
}

interface Comment {
  id: string;
  name: string;
  text: string;
  createdAt: Timestamp | null;
}

interface PastSession {
  id: string;
  title: string;
  youtubeVideoId: string;
  startedAt: Timestamp | null;
  endedAt: Timestamp | null;
  peakViewers?: number;
  prayerCount?: number;
}

const AdminLivestream: React.FC = () => {
  // Use the store's already-resolved tenant (matches AdminCRM). App.tsx resolves
  // currentTenantId with an APEX-ONLY platform fallback: on a tenant subdomain it
  // is the subdomain tenant (e.g. `bumb`), and only on the apex domain does a
  // super admin fall back to the platform tenant. Re-applying a naive
  // `isSuperAdmin ? PLATFORM_TENANT_ID` fallback here was the bug — before the
  // store hydrated, a super admin on a tenant subdomain resolved to `harvest`
  // and read tenants/harvest/livestream/current instead of the subdomain's doc,
  // so admin saw nothing while the user app (which reads tenants/{tenantId}/…)
  // showed the stream. Waiting for currentTenantId to hydrate makes admin read
  // the SAME doc the user app reads for the same subdomain.
  const { currentTenantId: tenantId, isAuthReady } = useAppStore();

  const [current, setCurrent] = useState<CurrentStream | null>(null);
  const [prayers, setPrayers] = useState<Prayer[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [loading, setLoading] = useState(true);

  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [starting, setStarting] = useState(false);

  // Subscribe to current stream
  useEffect(() => {
    if (!isAuthReady || !tenantId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'tenants', tenantId, 'livestream', 'current'), snap => {
      setCurrent(snap.exists() ? (snap.data() as CurrentStream) : null);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [tenantId, isAuthReady]);

  // Subscribe to prayers of the active session
  useEffect(() => {
    if (!tenantId || !current?.active || !current.sessionId) { setPrayers([]); return; }
    const q = query(
      collection(db, 'tenants', tenantId, 'livestreamSessions', current.sessionId, 'prayers'),
      orderBy('submittedAt', 'desc'), limit(500),
    );
    const unsub = onSnapshot(q, snap => setPrayers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Prayer)));
    return () => unsub();
  }, [tenantId, current?.active, current?.sessionId]);

  // Subscribe to live comments of the active session (mirrors the prayers panel).
  useEffect(() => {
    if (!tenantId || !current?.active || !current.sessionId) { setComments([]); return; }
    const q = query(
      collection(db, 'tenants', tenantId, 'livestreamSessions', current.sessionId, 'comments'),
      orderBy('createdAt', 'desc'), limit(500),
    );
    const unsub = onSnapshot(q, snap => setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Comment)));
    return () => unsub();
  }, [tenantId, current?.active, current?.sessionId]);

  // Load past sessions
  useEffect(() => {
    if (!tenantId) return;
    getDocs(query(collection(db, 'tenants', tenantId, 'livestreamSessions'), orderBy('startedAt', 'desc'), limit(50)))
      .then(snap => setPastSessions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as PastSession)))
      .catch(() => setPastSessions([]));
  }, [tenantId, current?.active]);

  const startStream = async () => {
    if (!tenantId) { alert('Could not determine your workspace. Please refresh and try again.'); return; }
    const videoId = parseYouTubeId(urlInput);
    if (!videoId) { alert('Enter a valid YouTube URL or video ID.'); return; }
    setStarting(true);
    try {
      const sessionRef = await addDoc(collection(db, 'tenants', tenantId, 'livestreamSessions'), {
        youtubeVideoId: videoId,
        title: titleInput.trim() || 'Live Service',
        startedAt: serverTimestamp(),
        endedAt: null,
        peakViewers: 0,
        prayerCount: 0,
        createdBy: auth.currentUser?.uid || '',
      });
      await setDoc(doc(db, 'tenants', tenantId, 'livestream', 'current'), {
        active: true,
        youtubeVideoId: videoId,
        title: titleInput.trim() || 'Live Service',
        startedAt: serverTimestamp(),
        viewerCount: 0,
        prayerCount: 0,
        sessionId: sessionRef.id,
      });
      setUrlInput(''); setTitleInput('');
    } catch (e) {
      console.error('Failed to start stream:', e);
      alert('Failed to start stream. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const endStream = async () => {
    if (!tenantId || !current?.sessionId) return;
    if (!confirm('End the stream? The live banner will disappear for all viewers.')) return;
    try {
      // Stamp the session's endedAt FIRST, then flip the stream inactive.
      // The Past Streams list refetches when `current.active` changes, so the
      // ended session must already carry endedAt or it gets filtered out and
      // never reappears (it only shows once it has an endedAt).
      await updateDoc(doc(db, 'tenants', tenantId, 'livestreamSessions', current.sessionId), { endedAt: serverTimestamp() });
      // Clear any shared sermon note so it doesn't linger past the stream.
      await updateDoc(doc(db, 'tenants', tenantId, 'livestream', 'current'), { active: false, sermonNote: null });
    } catch (e) {
      console.error('Failed to end stream:', e);
    }
  };

  const markPrayed = async (prayerId: string) => {
    if (!tenantId || !current?.sessionId) return;
    await updateDoc(doc(db, 'tenants', tenantId, 'livestreamSessions', current.sessionId, 'prayers', prayerId), { prayed: true });
  };

  // Delete-only moderation: the comments subcollection write rule
  // (hasPermission('manageLivestream')) already covers deletes — the same gate
  // that authorizes markPrayed — so no new permission is needed. No blocking,
  // muting, word filters, or approval queues: delete is the whole surface.
  const deleteComment = async (commentId: string) => {
    if (!tenantId || !current?.sessionId) return;
    if (!confirm('Delete this comment? It will disappear for all viewers.')) return;
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'livestreamSessions', current.sessionId, 'comments', commentId));
    } catch (e) {
      console.error('Failed to delete comment:', e);
    }
  };

  const fmtDate = (ts: Timestamp | null) =>
    ts?.toDate ? ts.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  const activePrayers = prayers.filter(p => !p.prayed);

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 size={28} className="animate-spin" style={{ color: GOLD }} /></div>;
  }

  const liveBadge = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-earth text-white text-[10px] font-bold uppercase tracking-[0.1em]">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      Live
    </span>
  );

  const pastStreamsBlock = pastSessions.filter(s => s.endedAt).length > 0 && (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-3">Past Streams</p>
      <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] divide-y divide-stone-200">
        {pastSessions.filter(s => s.endedAt).map(s => (
          <div key={s.id} className="flex items-center gap-3 px-5 py-3.5">
            <span className="w-8 h-8 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_10%,white)] flex items-center justify-center shrink-0">
              <Video size={15} className="text-gold" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-earth truncate">{s.title}</div>
              <div className="text-xs text-[color:var(--text-faint)]">{fmtDate(s.startedAt)}</div>
            </div>
            <div className="text-xs text-warm-brown text-right shrink-0 space-y-0.5">
              <div className="flex items-center gap-1 justify-end"><Eye size={12} /> {s.peakViewers || 0}</div>
              <div className="flex items-center gap-1 justify-end"><HandHeart size={12} /> {s.prayerCount || 0}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const prayerCard = (
    <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-earth">Prayer requests</h3>
        <span className="text-xs text-[color:var(--text-faint)]">{activePrayers.length} active</span>
      </div>
      {activePrayers.length === 0 ? (
        <p className="text-center py-12 text-[color:var(--text-faint)] text-sm">No active prayer requests.</p>
      ) : (
        <div className="divide-y divide-stone-200">
          {activePrayers.map(p => (
            <div key={p.id} className="flex items-start gap-3 px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-earth">{p.name}</div>
                <div className="text-sm text-warm-brown mt-0.5">{p.prayerText}</div>
                <div className="text-xs text-[color:var(--text-faint)] mt-1">{fmtDate(p.submittedAt)}</div>
              </div>
              <button onClick={() => markPrayed(p.id)} className="flex items-center gap-1 text-xs font-semibold text-[#40562F] hover:bg-[color-mix(in_srgb,#6E8E52_14%,white)] rounded-lg px-2 py-1 shrink-0 transition-colors">
                <Check size={14} /> Prayed
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const commentsCard = (
    <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-earth flex items-center gap-2">
          <MessageCircle size={16} className="text-gold" /> Live comments
        </h3>
        <span className="text-xs text-[color:var(--text-faint)]">{comments.length}</span>
      </div>
      {comments.length === 0 ? (
        <p className="text-center py-12 text-[color:var(--text-faint)] text-sm">No comments yet.</p>
      ) : (
        <div className="divide-y divide-stone-200 max-h-[28rem] overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="flex items-start gap-3 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-earth">{c.name}</div>
                <div className="text-sm text-warm-brown mt-0.5 break-words">{c.text}</div>
                <div className="text-xs text-[color:var(--text-faint)] mt-1">{fmtDate(c.createdAt)}</div>
              </div>
              <button
                onClick={() => deleteComment(c.id)}
                aria-label="Delete comment"
                className="flex items-center gap-1 text-xs font-semibold text-[#C4553B] hover:bg-[#F7E7E2] rounded-lg px-2 py-1 shrink-0 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto" style={{ paddingBottom: 120 }}>
      {current?.active ? (
        <>
          {/* Mobile — mockup design: dark 16:9 stream preview (LIVE badge + play),
              2-col Watching/Prayers stat cards, full-width End stream, then the same
              past-streams and prayer-request cards. Reuses current.* data, the endStream
              handler, liveBadge, pastStreamsBlock and prayerCard — no wiring changed. */}
          <div className="lg:hidden space-y-4">
            <div className="relative aspect-[16/9] rounded-brand-xl overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface-night)' }}>
              <div className="absolute top-2.5 left-2.5 z-10">{liveBadge}</div>
              <span className="relative w-14 h-14 rounded-full bg-white/90 flex items-center justify-center">
                <Play size={22} className="text-gold ml-0.5" />
              </span>
            </div>
            <div className="px-0.5">
              <h2 className="font-display text-xl font-light text-earth tracking-[-0.01em] truncate">{current.title}</h2>
              <p className="text-xs text-[color:var(--text-faint)] mt-1">Live since {fmtDate(current.startedAt || null)} · Video ID: {current.youtubeVideoId}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] p-3.5">
                <span className="w-7 h-7 rounded-lg bg-[var(--surface-gold)] text-gold flex items-center justify-center mb-2"><Eye size={14} /></span>
                <div className="font-display text-[1.375rem] font-normal leading-none tracking-[-0.02em] text-earth">{Math.max(0, current.viewerCount || 0)}</div>
                <div className="text-[11px] text-warm-brown mt-1">Watching now</div>
              </div>
              <div className="bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] p-3.5">
                <span className="w-7 h-7 rounded-lg bg-[var(--surface-gold)] text-gold flex items-center justify-center mb-2"><HandHeart size={14} /></span>
                <div className="font-display text-[1.375rem] font-normal leading-none tracking-[-0.02em] text-earth">{current.prayerCount || 0}</div>
                <div className="text-[11px] text-warm-brown mt-1">Prayers</div>
              </div>
            </div>
            <button onClick={endStream} className="w-full py-3 rounded-brand text-sm font-bold text-[#C4553B] bg-[#F7E7E2] hover:opacity-90 transition-opacity">
              End stream
            </button>
            {pastStreamsBlock}
            {prayerCard}
            {commentsCard}
          </div>

          {/* Desktop — existing approved layout, unchanged (now lg-only). */}
        <div className="hidden lg:grid lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* Left: stream info + past streams */}
          <div className="space-y-6">
            <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2">{liveBadge}</div>
                  <h2 className="font-display text-2xl font-light text-earth tracking-[-0.01em] truncate">{current.title}</h2>
                  <p className="text-xs text-[color:var(--text-faint)] mt-1.5">
                    Live since {fmtDate(current.startedAt || null)} · Video ID: {current.youtubeVideoId}
                  </p>
                </div>
                <button onClick={endStream} className="shrink-0 px-4 py-2 rounded-brand text-sm font-semibold text-[#C4553B] bg-[#F7E7E2] hover:opacity-90 transition-opacity">
                  End stream
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div className="rounded-brand border border-stone-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-faint)] flex items-center gap-1.5"><Eye size={13} /> Watching now</p>
                  <p className="font-display text-4xl font-light text-earth mt-1.5 leading-none">{Math.max(0, current.viewerCount || 0)}</p>
                </div>
                <div className="rounded-brand border border-stone-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-faint)] flex items-center gap-1.5"><HandHeart size={13} /> Prayers</p>
                  <p className="font-display text-4xl font-light text-earth mt-1.5 leading-none">{current.prayerCount || 0}</p>
                </div>
              </div>
            </div>
            {pastStreamsBlock}
          </div>

          {/* Right: prayer requests + live comments moderation */}
          <div className="space-y-6">
            {prayerCard}
            {commentsCard}
          </div>
        </div>
        </>
      ) : (
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Go Live form */}
          <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <Radio size={18} style={{ color: GOLD }} />
              <h3 className="font-display text-lg font-semibold text-earth">Go Live</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-earth mb-1.5">YouTube Live URL or Video ID</label>
                <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://youtube.com/watch?v=… or dQw4w9WgXcQ" className="w-full px-4 py-2.5 border border-stone-200 rounded-brand text-sm text-earth focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-earth mb-1.5">Title</label>
                <input value={titleInput} onChange={e => setTitleInput(e.target.value)} placeholder="Sunday Service — June 29" className="w-full px-4 py-2.5 border border-stone-200 rounded-brand text-sm text-earth focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent" />
              </div>
              <button onClick={startStream} disabled={starting} className="w-full py-2.5 rounded-brand text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
                {starting ? 'Starting…' : 'Start Stream'}
              </button>
            </div>
          </div>
          {pastStreamsBlock}
        </div>
      )}
    </div>
  );
};

export default AdminLivestream;
