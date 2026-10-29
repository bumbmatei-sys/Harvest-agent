import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { sendTransactionalEmail } from '@/lib/transactional-email';
import { expandRuns } from './recurrence';

export const CANCELLATION_EMAIL_BATCH_SIZE = 20;

export class CancellationError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}

const affected = (row: FirebaseFirestore.DocumentData, runDate: string | null) =>
  (!runDate || row.runDate === runDate)
  && (row.status === 'confirmed' || row.status === 'waitlisted'
    || (row.status === 'cancelled' && row.cancellationReason === 'event_cancelled'));

async function context(tenantId: string, eventId: string, runDate: string | null) {
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const eventRef = tenantRef.collection('events').doc(eventId);
  const snapshot = await eventRef.get();
  if (!snapshot.exists) throw new CancellationError('Event not found', 404);
  const event = snapshot.data()!;
  if (runDate) {
    if (!event.recurrence || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new CancellationError('Invalid run date', 400);
    const day = Date.parse(`${runDate}T00:00:00Z`);
    const start = event.startDate?.toDate();
    if (!Number.isFinite(day) || !start || !expandRuns({ startDate: start, endDate: event.endDate?.toDate() || start,
      timeZone: event.timeZone, recurrence: { ...event.recurrence, cancelledRuns: [] } },
    new Date(day - 2 * 86400000), new Date(day + 2 * 86400000)).some(run => run.runDate === runDate)) {
      throw new CancellationError('That date does not belong to this series', 400);
    }
  }
  // Complete single-field read: a capped attendee list cannot drive notices or the preview count.
  const registrations = await tenantRef.collection('registrations').where('eventId', '==', eventId).get();
  const rows = registrations.docs.filter(row => affected(row.data(), runDate));
  return { tenantRef, eventRef, event, rows };
}

export async function previewCancellation(tenantId: string, eventId: string, runDate: string | null) {
  const { rows } = await context(tenantId, eventId, runDate);
  return { count: rows.filter(row => !row.data().cancellationNotice?.sentAt).length };
}

async function organizerContact(tenantId: string, event: FirebaseFirestore.DocumentData): Promise<string> {
  if (typeof event.organizerEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.organizerEmail.trim())) return event.organizerEmail.trim();
  if (event.createdBy) {
    const creator = await adminDb.collection('users').doc(event.createdBy).get();
    const data = creator.data();
    if (data?.tenantId === tenantId && data.email) return data.email;
  }
  const tenant = await adminDb.collection('tenants').doc(tenantId).get();
  const ownerId = tenant.data()?.ownerId;
  if (ownerId) {
    const owner = await adminDb.collection('users').doc(ownerId).get();
    if (owner.data()?.email) return owner.data()!.email;
  }
  throw new CancellationError('Set an organizer contact email before cancelling. No notices were sent.', 409);
}

/** Persist each notice before sending. Sent markers survive repeats; Resend keys cover a lost response. */
export async function cancelEventRegistrations(tenantId: string, eventId: string, runDate: string | null) {
  const { eventRef, event } = await context(tenantId, eventId, runDate);
  const replyTo = await organizerContact(tenantId, event);
  await adminDb.runTransaction(async tx => {
    const current = await tx.get(eventRef);
    if (!current.exists) throw new CancellationError('Event not found', 404);
    const data = current.data()!;
    tx.update(eventRef, runDate ? {
      recurrence: { ...data.recurrence, cancelledRuns: [...new Set([...(data.recurrence?.cancelledRuns || []), runDate])] },
      updatedAt: FieldValue.serverTimestamp(),
    } : { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
  });
  // Read after the gate closes so registrations created before cancellation are included.
  const { rows } = await context(tenantId, eventId, runDate);
  let emailed = 0;
  const failures: string[] = [];
  const queued: FirebaseFirestore.DocumentReference[] = [];
  for (const row of rows) {
    try {
      const notice = await adminDb.runTransaction(async tx => {
        const snapshot = await tx.get(row.ref);
        const reg = snapshot.data();
        if (!reg || !affected(reg, runDate) || reg.cancellationNotice?.sentAt) return null;
        const date = reg.runDate || (event.startDate?.toDate()
          ? new Intl.DateTimeFormat('en-GB', { timeZone: event.timeZone || 'UTC', dateStyle: 'full', timeStyle: 'short' }).format(event.startDate.toDate()) : 'the scheduled date');
        const stored = reg.cancellationNotice || {
          to: reg.email,
          subject: `Cancelled: ${event.title} — ${date}`,
          text: `${event.title} on ${date} is cancelled. Your registration has been cancelled.\n\nContact the event owner/organizer at ${replyTo} about any refund. Refunds are handled manually by the ministry; Harvest does not issue an automatic refund.`,
          replyTo,
          idempotencyKey: `event-cancel-${createHash('sha256').update(`${tenantId}/${eventId}/${row.id}`).digest('hex')}`,
        };
        tx.update(row.ref, {
          status: 'cancelled', waitlisted: false, cancellationReason: 'event_cancelled',
          cancelledAt: reg.cancelledAt || FieldValue.serverTimestamp(),
          ...(reg.amount > 0 ? { refundStatus: 'pending_manual' } : {}),
          cancellationNotice: stored,
        });
        return stored;
      });
      if (notice) queued.push(row.ref);
    } catch (error) {
      failures.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Mark everyone cancelled before sending; finish large lists over bounded requests.
  for (const ref of queued.slice(0, CANCELLATION_EMAIL_BATCH_SIZE)) {
    try {
      const notice = await adminDb.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const stored = snapshot.data()?.cancellationNotice;
        if (stored?.sentAt) return null;
        if (!stored) throw new Error('Cancellation notice is missing');
        if (stored.firstAttemptAt) return stored;
        const attempt = { ...stored, firstAttemptAt: new Date().toISOString() };
        tx.update(ref, { cancellationNotice: attempt });
        return attempt;
      });
      if (!notice) { emailed += 1; continue; }
      // Resend retains keys for 24h: https://resend.com/docs/dashboard/emails/idempotency-keys
      // Provider deduplication is time-limited. An ambiguous old attempt requires human review,
      // rather than risking a second email after the provider has forgotten its key.
      if (Date.now() - Date.parse(notice.firstAttemptAt) >= 23 * 3600000) {
        throw new Error('Notice retry window elapsed; review delivery before resending manually');
      }
      const result = await sendTransactionalEmail(notice);
      if (!result.ok) throw new Error(result.error || 'Cancellation email failed');
      await ref.update({ 'cancellationNotice.sentAt': FieldValue.serverTimestamp() });
      emailed += 1;
    } catch (error) {
      failures.push(`${ref.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new CancellationError(`Event cancelled, but ${failures.length} notice(s) need attention. Retry cancellation to finish unsent notices. ${failures.join('; ')}`);
  return { emailed, remaining: queued.length - emailed };
}
