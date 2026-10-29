import { adminDb } from '@/lib/firebase-admin';
import { registrationClosed } from './registration-cutoff';

export class RegistrationClosedError extends Error {}

/** Reading the event in this transaction serializes signup against cancellation and schedule edits. */
export async function createEventRegistration(tenantId: string, eventId: string, data: FirebaseFirestore.DocumentData) {
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const eventRef = tenantRef.collection('events').doc(eventId);
  const regRef = tenantRef.collection('registrations').doc();
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(eventRef);
    const event = snapshot.data();
    if (!snapshot.exists || !event || event.status !== 'published' || !event.registrationEnabled
      || registrationClosed(event, data.runDate)) {
      throw new RegistrationClosedError('Registration for this date has closed.');
    }
    tx.create(regRef, data);
  });
  return regRef;
}
