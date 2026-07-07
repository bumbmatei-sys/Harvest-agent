'use client';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';

interface LiveNowState {
  active: boolean;
  title: string;
}

/**
 * Subscribes to the tenant's current livestream doc. Shared by LiveNowBanner
 * (the top-of-feed banner) and the desktop rail's "Live Now" card so both
 * reflect the same live state without duplicating the Firestore listener.
 */
export function useLiveNow(tenantId: string | null): LiveNowState {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!tenantId) {
      setActive(false);
      return;
    }
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

  return { active, title };
}
