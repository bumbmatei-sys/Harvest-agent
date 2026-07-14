import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { computeNextScheduled } from '../generate/route';

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

    // Normalize Firestore Timestamp fields to ISO strings before returning.
    // Through NextResponse.json a Firestore Timestamp serializes to
    // {_seconds, _nanoseconds}, which the client can't parse — new Date(...) on
    // that shape is Invalid Date, so AdminBlog's "Next:" line stays hidden.
    // Converting the two known Timestamp fields keeps the JSON contract clean;
    // null / already-string / absent values pass through untouched.
    const raw = snap.exists ? snap.data()! : { enabled: false };
    const toIso = (v: any) =>
      v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v;
    const data = {
      ...raw,
      nextScheduledAt: toIso((raw as any).nextScheduledAt),
      updatedAt: toIso((raw as any).updatedAt),
    };

    return NextResponse.json(data);
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

    const { enabled, frequency, dayOfWeek, hour, timezone, topicHint } = await request.json();

    // Seed nextScheduledAt on save so the cron honors the admin-picked schedule.
    // Use the SAME helper the cron reschedules with, so the save path and the
    // cron path can't drift. When disabling, clear the field so a stale future
    // timestamp can't linger and get picked up if automation is re-enabled.
    const nextScheduledAt = enabled
      ? computeNextScheduled(
          frequency || 'weekly',
          dayOfWeek ?? 1,
          hour ?? 8,
          timezone || 'UTC',
        )
      : FieldValue.delete();

    await adminDb
      .collection('tenants').doc(tenantId)
      .collection('blogAutomation').doc('settings')
      .set({
        enabled: !!enabled,
        frequency: frequency || 'weekly',
        dayOfWeek: dayOfWeek ?? 1,
        hour: hour ?? 8,
        // IANA zone the admin picked the hour in (e.g. "America/Los_Angeles").
        // Defaults to UTC so existing tenants with no stored timezone keep
        // today's behavior unchanged.
        timezone: timezone || 'UTC',
        topicHint: topicHint || '',
        // A JS Date is stored as a Firestore Timestamp (the cron reads it back
        // via .toDate()); FieldValue.delete() removes any prior schedule.
        nextScheduledAt,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: userOrErr.uid,
      }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
