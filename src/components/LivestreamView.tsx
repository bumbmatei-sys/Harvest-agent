"use client";
import React, { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Heart, Eye, BookOpen, ChevronDown } from 'lucide-react';
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
  const countedRef = useRef(false);

  // Subscribe to the current stream doc
  useEffect(() => {
    if (!tenantId) { setActive(false); return; }
    const unsub = onSnapshot(
      doc(db, 'tenants', tenantId, 'livestream', 'current'),
      (snap) => {
        const data = snap.data();
        const isActive = !!data?.active;
        setActive(isActive);
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
          {/* 16:9 responsive embed */}
          <div className="w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              className="w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
              title={title || 'Livestream'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {sermonNote && (
            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mx-4 mt-3 max-w-2xl md:mx-auto">
              <button
                onClick={() => setNotesOpen(p => !p)}
                className="flex items-center justify-between w-full px-4 py-3 text-white"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen size={15} className="text-gold" /> Sermon Notes
                </span>
                <ChevronDown
                  size={16}
                  className="transition-transform"
                  style={{ transform: notesOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: GOLD }}
                />
              </button>
              {notesOpen && (
                <div className="px-4 pb-4 text-white/80 text-sm leading-relaxed">
                  {sermonNote.title && (
                    <h3 className="text-white font-semibold text-base mb-2 font-display">{sermonNote.title}</h3>
                  )}
                  <TipTapReadOnly contentHtml={sermonNote.contentHtml} />
                </div>
              )}
            </div>
          )}

          <div className="p-4 space-y-3 max-w-2xl mx-auto">
            <button
              onClick={onDonate}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white"
              style={{ backgroundColor: GOLD }}
            >
              <Heart size={18} /> Support This Message
            </button>
            <button
              onClick={() => setShowPrayer(true)}
              className="w-full py-3 rounded-xl font-semibold text-white bg-white/10 hover:bg-white/15"
            >
              🙏 Submit Prayer Request
            </button>
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
                <p className="text-lg font-bold text-gray-900 font-display">🙏 Prayer received</p>
                <p className="text-sm text-gray-500 mt-1">Our team will be praying for you.</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-900 mb-3 font-display">Submit Prayer Request</h3>
                <input
                  value={prayerName}
                  onChange={(e) => setPrayerName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <textarea
                  value={prayerText}
                  onChange={(e) => setPrayerText(e.target.value)}
                  placeholder="How can we pray for you?"
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold"
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
