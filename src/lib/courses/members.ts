import { collection, query, where } from 'firebase/firestore';
import { db } from '@/firebase';
import { getTenantScope } from '@/utils/tenant-scope';
import { readBoundedList } from '@/utils/bounded-list-read';

export interface MemberRef {
  uid: string;
  name: string;
  email: string;
}

export const MEMBER_PICKER_LIMIT = 200;

export interface MemberList {
  members: MemberRef[];
  total: number;
  truncated: boolean;
}

/**
 * The people an admin can put on a course's access list: this ministry's users.
 *
 * Tenant-filtered on the server because the users rule is not a filter. A read
 * that fails THROWS, so the picker can say it could not load rather than
 * present a ministry with nobody in it.
 */
export async function loadTenantMembers(): Promise<MemberList> {
  const tenantId = await getTenantScope();
  const base = tenantId
    ? query(collection(db, 'users'), where('tenantId', '==', tenantId))
    : collection(db, 'users');
  const read = await readBoundedList(base, MEMBER_PICKER_LIMIT, (uid, data): MemberRef => ({
    uid,
    name: String(data.displayName || data.name || '').trim(),
    email: String(data.email || '').trim(),
  }));
  return { members: read.rows, total: read.total, truncated: read.truncated };
}
