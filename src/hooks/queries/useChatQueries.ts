import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Timestamp } from 'firebase/firestore';

export interface Channel {
  id: string;
  name: string;
  description: string;
  createdAt: Timestamp | null;
  createdBy: string;
  type: 'announcement';
  members?: string[];
  lastMessage?: string;
  lastMessageAt?: Timestamp | null;
}

export interface DirectMessage {
  id: string;
  participants: string[];
  participantRoles: Record<string, string>;
  lastMessage: string;
  lastMessageAt: Timestamp | null;
  initiatedBy: string;
  participantNames?: Record<string, string>;
}

export const useChannels = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['channels', tenantId],
    queryFn: async (): Promise<Channel[]> => {
      if (!tenantId) return [];
      const q = query(
        collection(db, 'tenants', tenantId, 'channels'),
        orderBy('createdAt', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Channel);
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });

export const useDirectMessages = (
  tenantId: string | null | undefined,
  userId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['directMessages', tenantId, userId],
    queryFn: async (): Promise<DirectMessage[]> => {
      if (!tenantId || !userId) return [];
      const q = query(
        collection(db, 'tenants', tenantId, 'directMessages'),
        where('participants', 'array-contains', userId),
        limit(100),
      );
      const snap = await getDocs(q);
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DirectMessage);
      return all.sort(
        (a, b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0),
      );
    },
    enabled: !!tenantId && !!userId,
    staleTime: 1000 * 60 * 2,
  });
