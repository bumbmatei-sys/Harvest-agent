import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { readEmailStatus, EMAIL_OPT_IN_AT_FIELD, EMAIL_OPT_IN_SOURCE_FIELD, EMAIL_STATUS_FIELD } from '@/lib/email/audience';
import type { SubscribeStore } from '@/lib/email/subscribe';

const TOKEN_HASH = 'emailConfirmTokenHash';
const TOKEN_EXPIRES = 'emailConfirmExpiresAt';

const contacts = () => adminDb.collection('contacts');

/** A suspended or cancelled ministry takes no sign-ups. Anything else, including a doc with no status, does. */
const NOT_TAKING = new Set(['suspended', 'cancelled', 'canceled', 'deleted']);

/**
 * Firestore-backed subscribe store. Admin SDK only, so `firestore.rules` is
 * neither consulted nor changed: the browser never reads or writes a contact.
 */
export const firestoreSubscribeStore: SubscribeStore = {
  async getTenant(tenantId) {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (typeof data.status === 'string' && NOT_TAKING.has(data.status.toLowerCase())) return null;
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : typeof data.config?.name === 'string' ? data.config.name : 'this ministry';
    return { name };
  },

  async findContacts(tenantId, email) {
    // Single-field filter, tenant checked here: no composite index is needed.
    const snap = await contacts().where('email', '==', email).limit(20).get();
    return snap.docs
      .filter((d) => (d.data().tenantId || null) === tenantId)
      .map((d) => {
        const data = d.data();
        return { id: d.id, status: readEmailStatus(data[EMAIL_STATUS_FIELD]), pending: typeof data[TOKEN_HASH] === 'string' };
      });
  },

  async createPending(tenantId, input) {
    const ref = await contacts().add({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: '',
      type: 'member',
      notes: 'Signed up through the newsletter form',
      tags: ['newsletter'],
      totalDonated: 0,
      lastDonationAt: null,
      memberSince: null,
      tenantId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'newsletter-form',
      updatedAt: FieldValue.serverTimestamp(),
      [TOKEN_HASH]: input.tokenHash,
      [TOKEN_EXPIRES]: input.expiresAt,
    });
    return ref.id;
  },

  async refreshPending(tenantId, contactId, input) {
    const ref = contacts().doc(contactId);
    const snap = await ref.get();
    if (!snap.exists || (snap.data()?.tenantId || null) !== tenantId) return;
    await ref.update({ [TOKEN_HASH]: input.tokenHash, [TOKEN_EXPIRES]: input.expiresAt, updatedAt: FieldValue.serverTimestamp() });
  },

  async getPending(tenantId, contactId) {
    const snap = await contacts().doc(contactId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if ((data.tenantId || null) !== tenantId) return null;
    return {
      status: readEmailStatus(data[EMAIL_STATUS_FIELD]),
      tokenHash: typeof data[TOKEN_HASH] === 'string' ? data[TOKEN_HASH] : null,
      expiresAt: typeof data[TOKEN_EXPIRES] === 'string' ? data[TOKEN_EXPIRES] : null,
    };
  },

  async confirm(tenantId, contactId, at) {
    const ref = contacts().doc(contactId);
    await ref.update({
      [EMAIL_STATUS_FIELD]: 'subscribed',
      [EMAIL_OPT_IN_AT_FIELD]: at,
      [EMAIL_OPT_IN_SOURCE_FIELD]: 'form',
      [TOKEN_HASH]: FieldValue.delete(),
      [TOKEN_EXPIRES]: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await adminDb.collection('contactActivities').add({
      contactId,
      tenantId,
      type: 'note',
      description: 'Confirmed their subscription to the newsletter',
      amount: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'newsletter-form',
    });
  },
};
