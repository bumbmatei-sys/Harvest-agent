import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import type { TenantPlan } from '../../types/tenant.types';

export interface AppUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'user' | 'admin' | 'church_admin' | 'super_admin';
  tenantId?: string;
  plan?: TenantPlan;
  onboardingCompleted?: boolean;
  permissions?: Record<string, boolean>;
  adminNavConfig?: {
    primaryTabIds?: string[];
    moreTabIds?: string[];
  };
  claimsUpdatedAt?: number;
}

export const useCurrentUser = (uid: string | null | undefined) =>
  useQuery({
    queryKey: ['user', uid],
    queryFn: async (): Promise<AppUser | null> => {
      if (!uid) return null;
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) return null;
      return { id: snap.id, uid, ...snap.data() } as AppUser;
    },
    enabled: !!uid,
    staleTime: 1000 * 60 * 5,
  });

export const useTenantUsers = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['tenantUsers', tenantId],
    queryFn: async (): Promise<AppUser[]> => {
      if (!tenantId) return [];
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        limit(500),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }) as AppUser);
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });
