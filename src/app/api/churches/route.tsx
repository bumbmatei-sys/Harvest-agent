import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth, requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userOrErr = await requireAuth(request as any);
    if (userOrErr instanceof Response) return userOrErr;

    if (!userOrErr.isSuperAdmin && !userOrErr.tenantId) {
      return NextResponse.json({ error: 'No tenant associated with this user' }, { status: 400 });
    }

    // Super admins see all churches; everyone else is scoped to their own tenant
    const ref = adminDb.collection('churches');
    const query = userOrErr.isSuperAdmin
      ? ref
      : ref.where('tenantId', '==', userOrErr.tenantId);

    const snapshot = await query.get();
    const churches = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ churches });
  } catch (error) {
    console.error('Error fetching churches:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userOrErr = await requireAdmin(request as any);
    if (userOrErr instanceof Response) return userOrErr;

    const body = await request.json();

    const allowedFields: Record<string, unknown> = {
      createdAt: new Date().toISOString(),
      createdBy: userOrErr.uid,
    };
    const safeFields = ['name', 'address', 'lat', 'lng', 'denomination', 'website', 'phone', 'email', 'tenantId'];
    for (const field of safeFields) {
      if (body[field] !== undefined && (typeof body[field] === 'string' || typeof body[field] === 'number')) {
        allowedFields[field] = body[field];
      }
    }

    const docRef = await adminDb.collection('churches').add(allowedFields);

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creating church:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
