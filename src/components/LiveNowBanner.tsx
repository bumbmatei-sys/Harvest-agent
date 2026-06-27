"use client";
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface LiveNowBannerProps {
  tenantId: string | null;
  onOpen: () => void;
}

/** Gold pulsing "Live Now" banner shown at the top of Home when a stream is active. */
const LiveNowBanner: React.FC<LiveNowBannerProps> = ({ tenantId, onOpen }) => {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    const unsub = onSnapshot(
      doc(db, 'tenants', tenantId, 'livestream', 'current'),
      (snap) => {
        const data = snap.data();
        setActive(!!data?.active);
        setTitle(data?.title || 'Live Now');
      },
      () => setActive(false),
    );
    return () => unsub();
  }, [tenantId]);

  if (!active) return null;

  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 mb-4 text-left text-white shadow-sm"
      style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
    >
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
      </span>
      <span className="font-bold text-sm">Live Now</span>
      <span className="text-sm/5 opacity-90 truncate flex-1">{title}</span>
      <span className="text-xs font-semibold bg-white/20 rounded-full px-2 py-0.5 shrink-0">Watch</span>
    </button>
  );
};

export default LiveNowBanner;
