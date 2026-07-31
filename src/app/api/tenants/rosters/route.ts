import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireSuperAdmin } from '@/lib/api-auth';
import { TENANT_PRIVATE_COLLECTION } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tenants/rosters — super-admin only.
 *
 * Returns every tenant's admin roster ({ [tenantId]: string[] }) for the
 * AdminTenants screen, which displays and edits the roster. The roster lives
 * on the server-only tenant_private/{id} docs, so the super-admin client
 * cannot read it from Firestore directly.
 */
export async function GET(request: NextRequest) {
  const callerOrErr = await requireSuperAdmin(request);
  if (callerOrErr instanceof NextResponse) return callerOrErr;

  const snap = await adminDb.collection(TENANT_PRIVATE_COLLECTION).get();
  const rosters: Record<string, string[]> = {};
  for (const doc of snap.docs) {
    const emails = doc.data().adminEmails;
    rosters[doc.id] = Array.isArray(emails) ? emails : [];
  }
  return NextResponse.json({ rosters });
}
