"use client";
import React, { useEffect, useRef, useState } from 'react';
import { doc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Heart, Eye, BookOpen, ChevronDown, MessageCircle } from 'lucide-react';
import { db, auth } from '../firebase';
import { authFetch } from '../utils/auth-fetch';
import TipTapReadOnly from './TipTapReadOnly';

interface LivestreamViewProps {
  tenantId: string | null;
  onBack: () => void;
  onDonate: () => void;
}

const GOLD = 'var(--brand-color, #B8962E)';

const LivestreamView: React.FC<LivestreamViewProps> = ({ tenantId, onBack, onDonate }) => {
  const [active, setActive] = useState<boolean | null>(null);
  const [videoId, setVideoId] = useState('');
  const [title, setTitle] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [sermonNote, setSermonNote] = useState<{ title: string; contentHtml: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showPrayer, setShowPrayer] = useState(false);
  const [prayerName, setPrayerName] = useState(auth.currentUser?.displayName || '');
  const [prayerText, setPrayerText] = useState('');
  const [prayerSubmitting, setPrayerSubmitting] = useState(false);
  const [prayerDone, setPrayerDone] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [comments, setComments] = useState<{ id: string; name: string; text: string }[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const countedRef = useRef(false);
  const commentListRef = useRef<HTMLDivElement>(null);

  // Subscribe to the current stream doc
  useEffect(() => {
    if (!tenantId) { setActive(false); return; }
    const unsub = onSnapshot(
      doc(db, 'tenants', tenantId, 'livestream', 'current'),
      (snap) => {
        const data = snap.data();
        const isActive = !!data?.active;
        setActive(isActive);
        setSessionId(data?.sessionId || '');
        setVideoId(data?.youtubeVideoId || '');
        setTitle(data?.title || '');
        setViewerCount(Math.max(0, data?.viewerCount || 0));
        setSermonNote(
          data?.sermonNote
            ? { title: data.sermonNote.title || '', contentHtml: data.sermonNote.contentHtml || '' }
            : null,
        );
      },
      () => setActive(false),
    );
    return () => unsub();
  }, [tenantId]);

  // Increment viewer count on open, decrement on close (best-effort).
  useEffect(() => {
    if (!tenantId || active !== true || countedRef.current) return;
    countedRef.current = true;
    authFetch('/api/livestream/viewer', { method: 'POST', body: JSON.stringify({ tenantId, delta: 1 }) }).catch(() => {});
    return () => {
      authFetch('/api/livestream/viewer', { method: 'POST', body: JSON.stringify({ tenantId, delta: -1 }) }).catch(() => {});
    };
  }, [tenantId, active]);

  // Live comments — the one member-readable livestream surface. Realtime via
  // onSnapshot on the active session's comments (see firestore.rules: member read
  // is belongsToTenant-scoped). Query newest-first, then reverse so the freshest
  // sits at the bottom like a chat log.
  useEffect(() => {
    if (!tenantId || active !== true || !sessionId) { setComments([]); return; }
    const q = query(
      collection(db, 'tenants', tenantId, 'livestreamSessions', sessionId, 'comments'),
      orderBy('createdAt', 'desc'), limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => setComments(
        snap.docs
          .map((d) => ({ id: d.id, name: d.data().name || 'Anonymous', text: d.data().text || '' }))
          .reverse(),
      ),
      () => setComments([]),
    );
    return () => unsub();
  }, [tenantId, active, sessionId]);

  // Keep the newest comment in view without scrolling the whole page.
  useEffect(() => {
    const el = commentListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);

  const submitComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed || !tenantId) return;
    setCommentSubmitting(true);
    try {
      const resp = await authFetch('/api/livestream/comment', {
        method: 'POST',
        body: JSON.stringify({ tenantId, name: auth.currentUser?.displayName || 'Anonymous', text: trimmed }),
      });
      if (resp.ok) setCommentText('');
    } catch { /* ignore */ }
    finally { setCommentSubmitting(false); }
  };

  const submitPrayer = async () => {
    if (!prayerText.trim() || !tenantId) return;
    setPrayerSubmitting(true);
    try {
      const resp = await authFetch('/api/livestream/pray', {
        method: 'POST',
        body: JSON.stringify({ tenantId, name: prayerName || 'Anonymous', prayerText }),
      });
      if (resp.ok) {
        setPrayerDone(true);
        setPrayerText('');
        setTimeout(() => { setShowPrayer(false); setPrayerDone(false); }, 1500);
      }
    } catch { /* ignore */ }
    finally { setPrayerSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#0b1121] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 text-white">
        <button onClick={onBack} aria-label="Back" className="p-1 hover:opacity-70">
          <ChevronLeft size={26} strokeWidth={2.5} className="text-gold" />
        </button>
        <span className="font-bold truncate flex-1 font-display">{title || 'Livestream'}</span>
        {active && (
          <span className="flex items-center gap-1 text-xs bg-white/10 rounded-full px-2 py-1">
            <Eye size={13} /> {viewerCount}
          </span>
        )}
      </div>

      {active === false ? (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-white/70">No stream is live right now. Check back soon.</p>
        </div>
      ) : active === true && videoId ? (
        <div className="flex-1 overflow-y-auto">
          {/* Desktop (lg:+) only: a centered two-column stage — video + title +
              actions in the main column, the sermon-notes card in a right rail.
              With no sermon note there's nothing for the rail, so the wrapper
              stays a single centered column. Every grid/placement class is
              lg:-gated and the DOM order (video → notes → actions) is the current
              mobile order, so mobile renders byte-identically. */}
          <div className={`lg:mx-auto lg:px-6 lg:py-6 ${sermonNote ? 'lg:max-w-[1280px] lg:grid lg:grid-cols-[1fr_360px] lg:gap-x-6 lg:items-start' : 'lg:max-w-3xl'}`}>
          {/* 16:9 responsive embed */}
          <div className="w-full bg-black lg:col-start-1 lg:row-start-1 lg:rounded-[var(--ds-radius-card)] lg:overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              className="w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
              title={title || 'Livestream'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {/* Desktop-only title + meta below the video. Real data only: the
              stream title and the live viewer count — no fabricated speaker/date. */}
          <div className="hidden lg:block lg:col-start-1 lg:row-start-2 lg:mt-4">
            {title && <h1 className="font-display text-xl font-bold text-white">{title}</h1>}
            {active && (
              <div className="flex items-center gap-1.5 text-sm text-white/60 mt-1">
                <Eye size={14} /> <span>{viewerCount} watching</span>
              </div>
            )}
          </div>

          {sermonNote && (
            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mx-4 mt-3 max-w-2xl md:mx-auto lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:mx-0 lg:mt-0 lg:max-w-none lg:w-full lg:rounded-[var(--ds-radius-card)]">
              <button
                onClick={() => setNotesOpen(p => !p)}
                className="flex items-center justify-between w-full px-4 py-3 text-white lg:cursor-default"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen size={15} className="text-gold" /> Sermon Notes
                </span>
                <ChevronDown
                  size={16}
                  className="transition-transform lg:hidden"
                  style={{ transform: notesOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: GOLD }}
                />
              </button>
              {/* Body: collapsible on mobile (hidden until notesOpen), always
                  expanded on desktop (lg:block) — a rail card needs no toggle. */}
              <div className={`px-4 pb-4 text-white/80 text-sm leading-relaxed ${notesOpen ? '' : 'hidden'} lg:block`}>
                {sermonNote.title && (
                  <h3 className="text-white font-semibold text-base mb-2 font-display">{sermonNote.title}</h3>
                )}
                <TipTapReadOnly contentHtml={sermonNote.contentHtml} />
              </div>
            </div>
          )}

          <div className="p-4 space-y-3 max-w-2xl mx-auto lg:col-start-1 lg:row-start-3 lg:flex lg:gap-3 lg:space-y-0 lg:max-w-none lg:mx-0 lg:p-0 lg:mt-4">
            <button
              onClick={onDonate}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white lg:flex-1"
              style={{ backgroundColor: GOLD }}
            >
              <Heart size={18} /> Support This Message
            </button>
            <button
              onClick={() => setShowPrayer(true)}
              className="w-full py-3 rounded-xl font-semibold text-white bg-white/10 hover:bg-white/15 lg:flex-1"
            >
              🙏 Submit Prayer Request
            </button>
          </div>

          {/* Live chat — members read the live comment feed and post to it.
              Moderation (delete) lives in the ADMIN dashboard, never here: no
              delete, report, or block controls for members. */}
          <div className="p-4 max-w-2xl mx-auto lg:col-start-1 lg:row-start-4 lg:max-w-none lg:mx-0 lg:p-0 lg:mt-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 text-white">
                <MessageCircle size={15} className="text-gold" />
                <span className="text-sm font-semibold">Live Chat</span>
              </div>
              <div ref={commentListRef} className="max-h-72 overflow-y-auto px-4 py-3 space-y-2.5">
                {comments.length === 0 ? (
                  <p className="text-white/50 text-sm text-center py-4">Be the first to comment.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="text-sm leading-snug">
                      <span className="font-semibold text-gold">{c.name}</span>
                      <span className="text-white/85 ml-2 break-words">{c.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-3 border-t border-white/10">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !commentSubmitting) submitComment(); }}
                  maxLength={500}
                  placeholder="Say something…"
                  className="flex-1 px-3 py-2 rounded-xl bg-white/10 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <button
                  onClick={submitComment}
                  disabled={commentSubmitting || !commentText.trim()}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50 shrink-0"
                  style={{ backgroundColor: GOLD }}
                >
                  {commentSubmitting ? '…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-white/50">Loading…</div>
      )}

      {/* Prayer bottom sheet */}
      {showPrayer && (
        <div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/50" onClick={() => setShowPrayer(false)}>
          <div className="w-full max-w-lg bg-white rounded-t-2xl p-5" style={{ paddingBottom: 32 }} onClick={(e) => e.stopPropagation()}>
            {prayerDone ? (
              <div className="text-center py-6">
                <p className="text-lg font-bold text-earth font-display">🙏 Prayer received</p>
                <p className="text-sm text-warm-brown mt-1">Our team will be praying for you.</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold text-earth mb-3 font-display">Submit Prayer Request</h3>
                <input
                  value={prayerName}
                  onChange={(e) => setPrayerName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <textarea
                  value={prayerText}
                  onChange={(e) => setPrayerText(e.target.value)}
                  placeholder="How can we pray for you?"
                  rows={3}
                  className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <button
                  onClick={submitPrayer}
                  disabled={prayerSubmitting || !prayerText.trim()}
                  className="w-full mt-3 py-3 rounded-xl text-white font-semibold disabled:opacity-50"
                  style={{ backgroundColor: GOLD }}
                >
                  {prayerSubmitting ? 'Sending…' : 'Send Prayer'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LivestreamView;
