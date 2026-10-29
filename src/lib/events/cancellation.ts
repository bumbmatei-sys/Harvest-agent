import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { sendTransactionalEmail } from '@/lib/transactional-email';
import { expandRuns } from './recurrence';

export const CANCELLATION_EMAIL_BATCH_SIZE = 20;

export class CancellationError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}

function runStart(event: FirebaseFirestore.DocumentData, runDate: string | null | undefined): Date | null {
  const start = event.startDate?.toDate();
  if (!start) throw new CancellationError('Event start date is missing', 409);
  if (!event.recurrence) return start;
  if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return null;
  const day = Date.parse(`${runDate}T00:00:00Z`);
  if (!Number.isFinite(day)) return null;
  return expandRuns({ startDate: start, endDate: event.endDate?.toDate() || start,
    timeZone: event.timeZone, recurrence: { ...event.recurrence, cancelledRuns: [] } },
  new Date(day - 2 * 86400000), new Date(day + 2 * 86400000))
    .find(run => run.runDate === runDate)?.start || null;
}

const affected = (row: FirebaseFirestore.DocumentData, runDate: string | null, event: FirebaseFirestore.DocumentData) => {
  const start = runStart(event, row.runDate);
  return (!runDate || row.runDate === runDate) && !!start && start.getTime() > Date.now()
    && (row.status === 'confirmed' || row.status === 'waitlisted'
      || (row.status === 'cancelled' && row.cancellationReason === 'event_cancelled'));
};

async function context(tenantId: string, eventId: string, runDate: string | null) {
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const eventRef = tenantRef.collection('events').doc(eventId);
  const snapshot = await eventRef.get();
  if (!snapshot.exists) throw new CancellationError('Event not found', 404);
  const event = snapshot.data()!;
  if (runDate && !event.recurrence) throw new CancellationError('Invalid run date', 400);
  if (runDate || !event.recurrence) {
    const start = runStart(event, runDate);
    if (!start) throw new CancellationError('That date does not belong to this series', 400);
    if (start.getTime() <= Date.now()) throw new CancellationError('Cannot cancel an event that has already started', 409);
  }
  // Complete single-field read: a capped attendee list cannot drive notices or the preview count.
  const registrations = await tenantRef.collection('registrations').where('eventId', '==', eventId).get();
  const rows = registrations.docs.filter(row => affected(row.data(), runDate, event));
  return { tenantRef, eventRef, event, rows };
}

export async function previewCancellation(tenantId: string, eventId: string, runDate: string | null) {
  const { tenantRef, rows } = await context(tenantId, eventId, runDate);
  const notices = await Promise.all(rows.map(row => tenantRef.collection('eventCancellationNotices').doc(row.id).get()));
  return { count: notices.filter(notice => !notice.data()?.sentAt).length };
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
  const { tenantRef, eventRef, event } = await context(tenantId, eventId, runDate);
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
        const noticeRef = tenantRef.collection('eventCancellationNotices').doc(row.id);
        const savedNotice = await tx.get(noticeRef);
        const reg = snapshot.data();
        if (!reg || !affected(reg, runDate, event) || savedNotice.data()?.sentAt) return null;
        const date = reg.runDate || (event.startDate?.toDate()
          ? new Intl.DateTimeFormat('en-GB', { timeZone: event.timeZone || 'UTC', dateStyle: 'full', timeStyle: 'short' }).format(event.startDate.toDate()) : 'the scheduled date');
        // Only this server-only collection can supply a frozen retry payload.
        // Registrations are member-creatable; never trust their cancellationNotice.
        const stored = savedNotice.data() || {
          to: reg.email,
          subject: `Cancelled: ${event.title} — ${date}`,
          text: `${event.title} on ${date} is cancelled. Your registration has been cancelled.\n\nContact the event owner/organizer at ${replyTo} about any refund. Refunds are handled manually by the ministry; Harvest does not issue an automatic refund.`,
          replyTo,
          idempotencyKey: `event-cancel-${createHash('sha256').update(`${tenantId}/${eventId}/${row.id}`).digest('hex')}`,
        };
        tx.update(row.ref, {
          status: 'cancelled', waitlisted: false, cancellationReason: 'event_cancelled',
          cancelledAt: reg.cancelledAt || FieldValue.serverTimestamp(),
          ...((reg.stripePaymentIntentId || reg.paymentStatus === 'confirmed' || reg.amountPaid > 0)
            ? { refundStatus: 'pending_manual' } : {}),
        });
        if (!savedNotice.exists) tx.set(noticeRef, stored);
        return noticeRef;
      });
      if (notice) queued.push(notice);
    } catch (error) {
      failures.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Mark everyone cancelled before sending; finish large lists over bounded requests.
  for (const ref of queued.slice(0, CANCELLATION_EMAIL_BATCH_SIZE)) {
    try {
      const notice = await adminDb.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const stored = snapshot.data();
        if (stored?.sentAt) return null;
        if (!stored) throw new Error('Cancellation notice is missing');
        const attempt: FirebaseFirestore.DocumentData = { ...stored, firstAttemptAt: stored.firstAttemptAt || new Date().toISOString(),
          attempts: (stored.attempts || 0) + 1 };
        tx.update(ref, attempt);
        return attempt;
      });
      if (!notice) { emailed += 1; continue; }
      // Resend retains keys for 24h: https://resend.com/docs/dashboard/emails/idempotency-keys
      // Provider deduplication is time-limited. An ambiguous old attempt requires human review,
      // rather than risking a second email after the provider has forgotten its key.
      if (Date.now() - Date.parse(notice.firstAttemptAt) >= 23 * 3600000) {
        throw new Error('Notice retry window elapsed; review delivery before resending manually');
      }
      const { to, subject, text, replyTo, idempotencyKey } = notice;
      const result = await sendTransactionalEmail({ to, subject, text, replyTo, idempotencyKey });
      if (!result.ok) throw new Error(result.error || 'Cancellation email failed');
      await ref.update({ sentAt: FieldValue.serverTimestamp() });
      emailed += 1;
    } catch (error) {
      failures.push(`${ref.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new CancellationError(`Event cancelled, but ${failures.length} notice(s) need attention. Retry cancellation to finish unsent notices. ${failures.join('; ')}`);
  return { emailed, remaining: queued.length - emailed };
}
