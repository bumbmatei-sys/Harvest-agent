import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requireTenantPermission } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { changesSeriesIdentity, SERIES_LOCK_MESSAGE } from '@/lib/events/series-edit';
import { registrationCutoffHours } from '@/lib/events/registration-cutoff';
import type { RecurrenceRule } from '@/lib/events/recurrence';

export const dynamic = 'force-dynamic';

const EDIT_FIELDS = new Set([
  'title', 'description', 'coverImage', 'location', 'isOnline', 'onlineLink',
  'startDate', 'endDate', 'capacity', 'registrationDeadline', 'registrationCutoffHours', 'organizerEmail', 'price', 'currency',
  'status', 'registrationEnabled', 'ticketTypes', 'waitlistEnabled', 'discountCodes',
  'showOnPublicCalendar', 'paymentProviders', 'recurrence', 'timeZone', 'openToAnyone', 'registrationQuestions',
]);
const DATE_FIELDS = ['startDate', 'endDate', 'registrationDeadline'] as const;
class EditError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  const eventId = request.nextUrl.searchParams.get('eventId');
  if (!tenantId || !eventId) return NextResponse.json({ error: 'tenantId and eventId are required' }, { status: 400 });
  try {
    const auth = await requireTenantPermission(request, tenantId, 'manageEvents');
    if (auth instanceof NextResponse) return auth;
    const event = await adminDb.collection('tenants').doc(tenantId).collection('events').doc(eventId).get();
    if (!event.exists) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const count = await adminDb.collection('tenants').doc(tenantId).collection('registrations')
      .where('eventId', '==', eventId).count().get();
    return NextResponse.json({ locked: !!event.data()?.recurrence && count.data().count > 0 });
  } catch (error) {
    captureHandledError(error, { step: 'event-edit-lock', tenantId, ids: { eventId } });
    return NextResponse.json({ error: 'Could not check series registrations. Please try again.' }, { status: 503 });
  }
}

/** The save re-reads registrations, even if the editor opened before the first signup. */
export async function PATCH(request: NextRequest) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
  const { tenantId, eventId, data } = body || {};
  if (typeof tenantId !== 'string' || !tenantId || typeof eventId !== 'string' || !eventId
    || !data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !EDIT_FIELDS.has(key))) {
    return NextResponse.json({ error: 'Invalid event update' }, { status: 400 });
  }
  try {
    const auth = await requireTenantPermission(request, tenantId, 'manageEvents');
    if (auth instanceof NextResponse) return auth;
    const ref = adminDb.collection('tenants').doc(tenantId).collection('events').doc(eventId);
    await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new EditError('Event not found', 404);
      const before = snapshot.data()!;
      const update: Record<string, any> = { ...data };
      for (const key of DATE_FIELDS) {
        if (!(key in update)) continue;
        const value = update[key];
        if (value === null) continue;
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new EditError('Invalid event date', 400);
        // Keep nanoseconds and the original DST instant on untouched fields.
        update[key] = before[key]?.toDate?.().toISOString() === value
          ? before[key] : Timestamp.fromDate(new Date(value));
      }
      if ('registrationCutoffHours' in update) {
        try {
          if (typeof update.registrationCutoffHours !== 'number') throw new Error('Invalid offset');
          registrationCutoffHours(update.registrationCutoffHours);
        }
        catch { throw new EditError('Invalid registration cutoff hours', 400); }
      }
      if ('organizerEmail' in update && (typeof update.organizerEmail !== 'string' || (update.organizerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.organizerEmail.trim())))) {
        throw new EditError('Invalid organizer contact email', 400);
      }
      if (update.status === 'cancelled' && before.status !== 'cancelled') {
        throw new EditError('Use Cancel event to notify registrants.', 409);
      }
      if (update.recurrence && JSON.stringify(update.recurrence.cancelledRuns || []) !== JSON.stringify(before.recurrence?.cancelledRuns || [])) {
        throw new EditError('Use Cancel this date to notify registrants.', 409);
      }
      const after = { ...before, ...update };
      try { new Intl.DateTimeFormat('en-US', { timeZone: after.timeZone || 'UTC' }).format(); }
      catch { throw new EditError('Invalid time zone', 400); }
      if (after.recurrence && !['weekly', 'every_2_weeks', 'monthly'].includes(after.recurrence.freq)) {
        throw new EditError('Invalid repeat frequency', 400);
      }
      if (before.recurrence && changesSeriesIdentity(
        { startDate: before.startDate?.toDate() || null, timeZone: before.timeZone, recurrence: before.recurrence as RecurrenceRule },
        { startDate: after.startDate?.toDate() || null, timeZone: after.timeZone, recurrence: after.recurrence as RecurrenceRule | null },
      )) {
        // Single-field query, complete projection; no index or arbitrary list cap.
        const registrations = await transaction.get(adminDb.collection('tenants').doc(tenantId).collection('registrations')
          .where('eventId', '==', eventId).select());
        if (!registrations.empty) throw new EditError(SERIES_LOCK_MESSAGE, 409);
      }
      transaction.update(ref, { ...update, updatedAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EditError) return NextResponse.json({ error: error.message }, { status: error.status });
    captureHandledError(error, { step: 'event-edit-save', tenantId, ids: { eventId } });
    return NextResponse.json({ error: 'Could not save event. Please try again.' }, { status: 503 });
  }
}
