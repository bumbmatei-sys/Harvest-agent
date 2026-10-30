import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedAdmin, seedDoc, teardownEnv, owner, member, asUid, permsOnly,
  TENANT_A, MEMBER_UID,
} from './helpers';

/**
 * #556 follow-up. Event schedule and status changes belong to the server
 * routes that protect registrations and send cancellation notices, and a
 * member-created registration cannot claim a seat, a payment or a refund.
 */
const T = TENANT_A;
const sub = (rest: string) => `tenants/${T}/${rest}`;
const EVENTS_ADMIN = 'events-admin-uid';

beforeAll(async () => {
  await getEnv();
  await seedBase();
  await seedAdmin(EVENTS_ADMIN, T, permsOnly('manageEvents'));
});
afterAll(async () => { await teardownEnv(); });

describe('client event updates cannot bypass the edit and cancel routes', () => {
  const seed = (id: string) => seedDoc(sub(`events/${id}`), {
    title: 'Series', status: 'published', startDate: new Date('2031-03-16T18:00:00Z'),
    endDate: new Date('2031-03-16T20:00:00Z'), timeZone: 'Europe/Berlin', recurrence: { freq: 'weekly', count: 4 }, pinned: false,
  });

  it('an events admin can still pin, retitle, create and delete', async () => {
    await seed('ok-1');
    const db = (await asUid(EVENTS_ADMIN)).firestore();
    await assertSucceeds(db.doc(sub('events/ok-1')).update({ pinned: true, title: 'Renamed' }));
    await assertSucceeds(db.doc(sub('events/ok-new')).set({ title: 'New', status: 'draft', startDate: new Date('2031-04-01T18:00:00Z') }));
    await assertSucceeds(db.doc(sub('events/ok-new')).delete());
  });

  it.each([
    ['startDate', { startDate: new Date('2031-03-17T18:00:00Z') }],
    ['endDate', { endDate: new Date('2031-03-16T21:00:00Z') }],
    ['timeZone', { timeZone: 'UTC' }],
    ['recurrence', { recurrence: { freq: 'weekly', count: 2 } }],
    ['status', { status: 'cancelled' }],
  ])('even the owner cannot change %s from a client', async (field, update) => {
    await seed(`deny-${field}`);
    const db = (await owner()).firestore();
    await assertFails(db.doc(sub(`events/deny-${field}`)).update(update));
  });

  it('a non-events admin still cannot update an event at all', async () => {
    await seed('plain-1');
    const db = (await member()).firestore();
    await assertFails(db.doc(sub('events/plain-1')).update({ pinned: true }));
  });
});

describe('a member-created registration cannot claim a seat, payment or refund', () => {
  it('a bare self registration is still accepted', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('registrations/bare')).set({ userId: MEMBER_UID, eventId: 'e1', email: 'm@test.com' }));
  });

  it.each([
    ['status', { status: 'confirmed' }],
    ['waitlisted', { waitlisted: true }],
    ['quantity', { quantity: 400 }],
    ['runDate', { runDate: '2031-03-23' }],
    ['ticketCode', { ticketCode: 'FORGED01' }],
    ['amount', { amount: 5000 }],
    ['amountPaid', { amountPaid: 5000 }],
    ['paymentStatus', { paymentStatus: 'confirmed' }],
    ['paymentClaimToken', { paymentClaimToken: 'tok' }],
    ['stripePaymentIntentId', { stripePaymentIntentId: 'pi_forged' }],
    ['refundStatus', { refundStatus: 'pending_manual' }],
    ['refunded', { refunded: true }],
    ['cancellationReason', { cancellationReason: 'event_cancelled' }],
    ['cancelledAt', { cancelledAt: 'now' }],
    ['confirmedAt', { confirmedAt: 'now' }],
  ])('refuses a client registration carrying %s', async (field, extra) => {
    const db = (await member()).firestore();
    await assertFails(db.doc(sub(`registrations/forged-${field}`)).set({ userId: MEMBER_UID, eventId: 'e1', ...extra }));
  });
});
