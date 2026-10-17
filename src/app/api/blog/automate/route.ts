import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin, requireTenantAdmin, type AuthenticatedUser } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import firebaseConfig from '../../../../firebase-applet-config.json';
import {
  automationSettingsJson,
  decodeFirestoreRestFields,
  isAutomationTenantId,
} from '@/lib/blog/automation-settings-json';
import { computeNextScheduled } from '../generate/route';

/**
 * The token's ministry, or the ministry the screen is actually showing.
 * A super admin on a preview host has no tenant on the token. Calling this
 * route anyway is what returned 400 "No tenant" in the console. A caller who
 * names a different ministry still has to pass the tenant-admin check.
 */
async function resolveMinistry(
  request: NextRequest,
  user: AuthenticatedUser,
  requested: string,
): Promise<string | NextResponse> {
  const own = user.tenantId || '';
  const named = requested.trim();
  const tenantId = named || own;
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 });
  if (named && named !== own) {
    const allowed = await requireTenantAdmin(request, named);
    if (allowed instanceof NextResponse) return allowed;
  }
  return tenantId;
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;
    const tenantIdOrErr = await resolveMinistry(
      request,
      userOrErr,
      request.nextUrl?.searchParams.get('tenantId') || '',
    );
    if (tenantIdOrErr instanceof NextResponse) return tenantIdOrErr;
    const tenantId = tenantIdOrErr;

    // The admin SDK is what production uses. A preview deployment often has no
    // service-account credential, and that read throws. The signed-in admin's
    // own token can still read the same document through the Firestore REST
    // API, under the rules that already allow a tenant admin to read it.
    let raw: unknown;
    try {
      const snap = await adminDb
        .collection('tenants').doc(tenantId)
        .collection('blogAutomation').doc('settings').get();
      raw = snap.exists ? (snap.data() ?? { enabled: false }) : { enabled: false };
    } catch {
      const fallback = await readSettingsWithUserToken(request, tenantId);
      if (fallback instanceof NextResponse) return fallback;
      raw = fallback;
    }

    return NextResponse.json(automationSettingsJson(raw));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

async function readSettingsWithUserToken(
  request: NextRequest,
  tenantId: string,
): Promise<Record<string, unknown> | NextResponse> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !isAutomationTenantId(tenantId)) {
    return NextResponse.json({ error: 'Automation settings could not be loaded.' }, { status: 500 });
  }
  const database = encodeURIComponent(firebaseConfig.firestoreDatabaseId);
  const project = encodeURIComponent(firebaseConfig.projectId);
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/tenants/${tenantId}/blogAutomation/settings`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 404) return { enabled: false };
  if (!resp.ok) {
    return NextResponse.json({ error: 'Automation settings could not be loaded.' }, { status: 500 });
  }
  const body = await resp.json() as { fields?: unknown };
  return decodeFirestoreRestFields(body.fields);
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;
    const body = await request.json();
    const requested = typeof body?.tenantId === 'string' ? body.tenantId : '';
    const tenantIdOrErr = await resolveMinistry(request, userOrErr, requested);
    if (tenantIdOrErr instanceof NextResponse) return tenantIdOrErr;
    const tenantId = tenantIdOrErr;

    const { enabled, frequency, dayOfWeek, hour, timezone, topicHint } = body;

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
        // Saving the settings is the admin acting on the problem, so the failure
        // streak starts over. Without this, automation that the cron disabled
        // after N failures would be re-disabled by the very next failure, and
        // the stale "we turned this off" banner would outlive the fix.
        consecutiveFailures: 0,
        lastFailureAt: FieldValue.delete(),
        lastFailureMessage: FieldValue.delete(),
        automationDisabledAt: FieldValue.delete(),
        automationDisabledReason: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: userOrErr.uid,
      }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
