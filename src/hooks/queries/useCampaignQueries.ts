import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, getDoc, doc, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { sortByNumber } from '../../utils/query-helpers';

export interface Campaign {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  goal: number;
  raised: number;
  endDate?: string;
  isActive: boolean;
  tenantId?: string;
  campaignType?: 'fundraising' | 'pledge'; // default 'fundraising'
  pledgeDeadline?: string | null;          // ISO date — pledge campaigns only
}

export const useCampaigns = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['campaigns', tenantId],
    queryFn: async (): Promise<Campaign[]> => {
      const q = tenantId
        ? query(collection(db, 'campaigns'), where('tenantId', '==', tenantId), limit(100))
        : query(collection(db, 'campaigns'), limit(100));
      const snap = await getDocs(q);
      return sortByNumber(
        snap.docs.map(d => ({ id: d.id, ...d.data() }) as Campaign),
        'isActive',
        'desc',
      );
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useActiveCampaign = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['activeCampaign', tenantId],
    queryFn: async (): Promise<Campaign | null> => {
      const q = tenantId
        ? query(
            collection(db, 'campaigns'),
            where('tenantId', '==', tenantId),
            where('isActive', '==', true),
            limit(1),
          )
        : query(collection(db, 'campaigns'), where('isActive', '==', true), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as Campaign;
    },
    enabled: tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });
