import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, getDoc, doc, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Timestamp } from 'firebase/firestore';
import { sortByTime, sortByNumber } from '../../utils/query-helpers';

export interface Doc {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  isPrivate: boolean;
  sharedWith: string[];
  tenantId?: string;
  pinned?: boolean;
}

export interface DocFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  order: number;
  tenantId?: string;
}

export const useDocs = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['docs', tenantId],
    queryFn: async (): Promise<Doc[]> => {
      const q = tenantId
        ? query(collection(db, 'docs'), where('tenantId', '==', tenantId), limit(300))
        : query(collection(db, 'docs'), limit(300));
      const snap = await getDocs(q);
      return sortByTime(
        snap.docs.map(d => ({ id: d.id, ...d.data() }) as Doc),
        'updatedAt',
        'desc',
      );
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useDoc = (tenantId: string | null | undefined, docId: string | null | undefined) =>
  useQuery({
    queryKey: ['doc', tenantId, docId],
    queryFn: async (): Promise<Doc | null> => {
      if (!docId) return null;
      const snap = await getDoc(doc(db, 'docs', docId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Doc;
    },
    enabled: !!docId,
    staleTime: 1000 * 60 * 5,
  });

export const useDocFolders = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['docFolders', tenantId],
    queryFn: async (): Promise<DocFolder[]> => {
      const q = tenantId
        ? query(collection(db, 'docFolders'), where('tenantId', '==', tenantId), limit(200))
        : query(collection(db, 'docFolders'), limit(200));
      const snap = await getDocs(q);
      return sortByNumber(
        snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocFolder),
        'order',
        'asc',
      );
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useSharedDocs = (uid: string | null | undefined) =>
  useQuery({
    queryKey: ['sharedDocs', uid],
    queryFn: async (): Promise<Doc[]> => {
      if (!uid) return [];
      const q = query(
        collection(db, 'docs'),
        where('sharedWith', 'array-contains', uid),
        limit(50),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Doc);
    },
    enabled: !!uid,
    staleTime: 1000 * 60 * 5,
  });
