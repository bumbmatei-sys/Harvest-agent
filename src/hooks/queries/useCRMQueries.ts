import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, getDoc, doc, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Timestamp } from 'firebase/firestore';
import { sortByString, sortByTime } from '../../utils/query-helpers';
import { PLATFORM_TENANT_ID } from '../../utils/tenant-scope';

/** CRM pipeline stages, from first contact through to deeply-invested leader. */
export type PipelineStage =
  | 'new'         // Just added / first contact
  | 'connected'   // Reached out, in conversation
  | 'active'      // Regular attender / member
  | 'giving'      // Active donor
  | 'champion';   // Deeply invested, volunteer, leader

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: 'donor' | 'member' | 'both';
  stage?: PipelineStage; // defaults to 'new' if missing
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  notes: string;
  tags: string[];
  totalDonated: number;
  lastDonationAt: Timestamp | null;
  memberSince: Timestamp | null;
  createdAt: Timestamp | null;
  createdBy: string;
  updatedAt: Timestamp | null;
  tenantId?: string;
}

export interface ContactActivity {
  id: string;
  contactId: string;
  type: 'note' | 'donation' | 'email' | 'call' | 'meeting';
  description: string;
  amount: number | null;
  createdAt: Timestamp | null;
  createdBy: string;
  tenantId?: string;
}

export const useContacts = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['contacts', tenantId],
    queryFn: async (): Promise<Contact[]> => {
      let rows: Contact[];
      if (!tenantId || tenantId === PLATFORM_TENANT_ID) {
        // Platform / super-admin CRM. The platform's own contacts can carry
        // tenantId: 'harvest', null, '', OR no tenantId field at all (legacy rows
        // written before multi-tenancy). Firestore can't match a missing field and
        // an equality query can't union all those, so — as a super admin who may
        // read the whole collection — fetch and keep only the platform-owned rows,
        // dropping any that belong to a *named* tenant (no cross-tenant leakage).
        // NOTE: at larger scale, replace this scan with a one-time migration that
        // stamps every legacy/null contact with tenantId 'harvest'.
        const snap = await getDocs(query(collection(db, 'contacts'), limit(1000)));
        rows = snap.docs
          .map(d => ({ id: d.id, stage: 'new', ...d.data() }) as Contact)
          .filter(c => c.tenantId == null || c.tenantId === '' || c.tenantId === PLATFORM_TENANT_ID);
      } else {
        const snap = await getDocs(
          query(collection(db, 'contacts'), where('tenantId', '==', tenantId), limit(500))
        );
        rows = snap.docs.map(d => ({ id: d.id, stage: 'new', ...d.data() }) as Contact);
      }
      return sortByString(rows, 'lastName', 'asc');
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useContact = (tenantId: string | null | undefined, contactId: string | null | undefined) =>
  useQuery({
    queryKey: ['contact', tenantId, contactId],
    queryFn: async (): Promise<Contact | null> => {
      if (!contactId) return null;
      const snap = await getDoc(doc(db, 'contacts', contactId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Contact;
    },
    enabled: !!contactId,
    staleTime: 1000 * 60 * 5,
  });

export const useContactActivities = (
  tenantId: string | null | undefined,
  contactId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['contactActivities', tenantId, contactId],
    queryFn: async (): Promise<ContactActivity[]> => {
      if (!contactId) return [];
      const q = query(
        collection(db, 'contactActivities'),
        where('contactId', '==', contactId),
        limit(200),
      );
      const snap = await getDocs(q);
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContactActivity);
      if (tenantId) rows = rows.filter(r => r.tenantId === tenantId);
      return sortByTime(rows, 'createdAt', 'desc');
    },
    enabled: !!contactId,
    staleTime: 1000 * 60 * 2,
  });

export const useContactOnboardingAnswers = (email: string | null | undefined) =>
  useQuery({
    queryKey: ['contactOnboardingAnswers', email],
    queryFn: async (): Promise<Record<string, string> | null> => {
      if (!email) return null;
      const q = query(collection(db, 'users'), where('email', '==', email), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return (snap.docs[0].data().onboardingAnswers as Record<string, string>) ?? null;
    },
    enabled: !!email,
    staleTime: 1000 * 60 * 10,
  });
