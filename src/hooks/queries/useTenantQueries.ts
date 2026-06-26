import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Tenant } from '../../types/tenant.types';

export type { Tenant };

export interface TenantAdmin {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

export const useTenant = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: async (): Promise<Tenant | null> => {
      if (!tenantId) return null;
      const snap = await getDoc(doc(db, 'tenants', tenantId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Tenant;
    },
    enabled: tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useTenantAdmins = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['tenantAdmins', tenantId],
    queryFn: async (): Promise<TenantAdmin[]> => {
      if (!tenantId) return [];
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        limit(200),
      );
      const snap = await getDocs(q);
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as TenantAdmin)
        .filter(u => ['admin', 'church_admin', 'super_admin'].includes(u.role));
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });
