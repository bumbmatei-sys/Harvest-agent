import { useEffect, useState } from 'react';
import { collection, getCountFromServer, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/firebase';

export interface FeedComment {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorLevel?: number;
  content: string;
  createdAt: string;
}

/** Summaries stay bounded; full comment streams exist only for expanded posts. */
export function usePostComments(postIds: string[], open: Record<string, boolean>) {
  const [comments, setComments] = useState<Record<string, FeedComment[]>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [latest, setLatest] = useState<Record<string, FeedComment | undefined>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const idsKey = JSON.stringify(postIds);
  const openKey = JSON.stringify(postIds.filter(id => open[id]));

  useEffect(() => {
    let active = true;
    const ids: string[] = JSON.parse(idsKey);
    const unsubs = ids.map(id => {
      const ref = collection(db, 'community_posts', id, 'comments');
      let revision = 0;
      return onSnapshot(query(ref, orderBy('createdAt', 'desc'), limit(1)), snapshot => {
        const current = ++revision;
        const last = snapshot.docs[0];
        setLatest(prev => ({ ...prev, [id]: last ? { id: last.id, ...last.data() } as FeedComment : undefined }));
        getCountFromServer(ref).then(result => {
          if (!active || current !== revision) return;
          setCounts(prev => ({ ...prev, [id]: result.data().count }));
          setErrors(prev => ({ ...prev, [id]: false }));
        }).catch(() => { if (active && current === revision) setErrors(prev => ({ ...prev, [id]: true })); });
      }, () => setErrors(prev => ({ ...prev, [id]: true })));
    });
    return () => { active = false; unsubs.forEach(unsub => unsub()); };
  }, [idsKey]);

  useEffect(() => {
    const ids: string[] = JSON.parse(openKey);
    const unsubs = ids.map(id => onSnapshot(
      query(collection(db, 'community_posts', id, 'comments'), orderBy('createdAt', 'asc')),
      snapshot => {
        setComments(prev => ({ ...prev, [id]: snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FeedComment)) }));
        setCounts(prev => ({ ...prev, [id]: snapshot.docs.length }));
        setErrors(prev => ({ ...prev, [id]: false }));
      }, () => setErrors(prev => ({ ...prev, [id]: true }))
    ));
    return () => unsubs.forEach(unsub => unsub());
  }, [openKey]);
  return { comments, counts, latest, errors };
}
