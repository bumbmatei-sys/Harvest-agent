import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;
    const { tenantId } = userOrErr;
    if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

    const snap = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('blogAutomation').doc('settings').get();

    return NextResponse.json(snap.exists ? snap.data() : { enabled: false });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;
    const { tenantId } = userOrErr;
    if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });

    const { enabled, frequency, dayOfWeek, hour, topicHint } = await request.json();

    await adminDb
      .collection('tenants').doc(tenantId)
      .collection('blogAutomation').doc('settings')
      .set({
        enabled: !!enabled,
        frequency: frequency || 'weekly',
        dayOfWeek: dayOfWeek ?? 1,
        hour: hour ?? 8,
        topicHint: topicHint || '',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: userOrErr.uid,
      }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
