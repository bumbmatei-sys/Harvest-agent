import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/render';
import {
  EMAIL_OPT_IN_AT_FIELD,
  EMAIL_OPT_IN_SOURCE_FIELD,
  EMAIL_STATUS_FIELD,
  isSuppressed,
  readEmailStatus,
  type EmailContact,
} from '@/lib/email/audience';
import { normalizeEmail } from '@/lib/donation-history';
import {
  EMPTY_SETTINGS,
  type Broadcast,
  type EmailSettings,
  type EmailStore,
} from '@/lib/email/service';

const contacts = () => adminDb.collection('contacts');

function contactName(d: Record<string, unknown>): string {
  return [d.firstName, d.lastName].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim();
}

function isoOrEmpty(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
}

async function tenantContactDocs(tenantId: string) {
  const snap = await contacts().where('tenantId', '==', tenantId).get();
  return snap.docs;
}

/**
 * ONE CRM. People are the existing top-level `contacts` documents; email
 * status, opt-in and opt-out are fields on them. Broadcasts, settings and the
 * monthly usage counter are the only new data, under tenants/{id}/email*, which
 * has no client rule and so is denied to browsers by default.
 */

export const SCHEDULED_QUEUE = 'email_scheduled';
/** Server-only, no client rule: one document of platform-wide limits a super admin edits. */
export const PLATFORM_CONFIG = 'platform_config';
export const LIMITS_DOC = 'email_limits';

const tenantDoc = (tenantId: string) => adminDb.collection('tenants').doc(tenantId);

function broadcastFrom(id: string, tenantId: string, data: Record<string, unknown>): Broadcast {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id,
    tenantId,
    subject: str(data.subject),
    subjectB: typeof data.subjectB === 'string' ? data.subjectB : null,
    preheader: str(data.preheader),
    bodyHtml: str(data.bodyHtml),
    design: { ...DEFAULT_EMAIL_DESIGN, ...((data.design as object) ?? {}) },
    filters: Array.isArray(data.filters) ? (data.filters as Broadcast['filters']) : [],
    status: (str(data.status) || 'draft') as Broadcast['status'],
    scheduledAt: typeof data.scheduledAt === 'string' ? data.scheduledAt : null,
    sentAt: typeof data.sentAt === 'string' ? data.sentAt : null,
    stats: (data.stats as Broadcast['stats']) ?? null,
    error: typeof data.error === 'string' ? data.error : null,
    createdBy: str(data.createdBy),
    createdAt: str(data.createdAt),
    updatedAt: str(data.updatedAt),
  };
}

export const firestoreEmailStore: EmailStore = {
  async getTenant(tenantId) {
    const snap = await tenantDoc(tenantId).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      name: typeof d.name === 'string' ? d.name : '',
      plan: d.plan,
      status: d.status,
      ownerId: typeof d.ownerId === 'string' ? d.ownerId : null,
      createdAt: d.createdAt,
    };
  },

  async getLimits() {
    const snap = await adminDb.collection(PLATFORM_CONFIG).doc(LIMITS_DOC).get();
    return snap.exists ? snap.data() : null;
  },

  async saveLimits(limits) {
    await adminDb.collection(PLATFORM_CONFIG).doc(LIMITS_DOC).set(limits);
  },

  async getSendingState(tenantId) {
    const snap = await tenantDoc(tenantId).collection('emailConfig').doc('sending').get();
    const d = snap.exists ? snap.data() : null;
    if (!d || typeof d.pausedAt !== 'string') return null;
    return {
      pausedAt: d.pausedAt,
      reason: d.reason === 'complaint' ? 'complaint' : 'bounce',
      rate: typeof d.rate === 'number' ? d.rate : 0,
      threshold: typeof d.threshold === 'number' ? d.threshold : 0,
    };
  },

  async setSendingState(tenantId, state) {
    const ref = tenantDoc(tenantId).collection('emailConfig').doc('sending');
    if (state) await ref.set(state);
    else await ref.delete();
  },

  async getAdminEmails(tenantId) {
    const data = await getTenantPrivate(tenantId);
    return Array.isArray(data.adminEmails) ? (data.adminEmails as string[]) : [];
  },

  async getPermissions(uid) {
    const snap = await adminDb.collection('users').doc(uid).get();
    return (snap.exists ? snap.data()?.permissions : null) ?? {};
  },

  async getSettings(tenantId) {
    const snap = await tenantDoc(tenantId).collection('emailConfig').doc('settings').get();
    return snap.exists ? { ...EMPTY_SETTINGS, ...(snap.data() as Partial<EmailSettings>) } : EMPTY_SETTINGS;
  },

  async saveSettings(tenantId, settings) {
    await tenantDoc(tenantId).collection('emailConfig').doc('settings').set(settings);
  },

  async getBroadcast(tenantId, id) {
    const snap = await tenantDoc(tenantId).collection('emailBroadcasts').doc(id).get();
    return snap.exists ? broadcastFrom(id, tenantId, snap.data() ?? {}) : null;
  },

  async saveBroadcast(broadcast) {
    await tenantDoc(broadcast.tenantId).collection('emailBroadcasts').doc(broadcast.id).set(broadcast);
  },

  async removeBroadcast(tenantId, id) {
    await tenantDoc(tenantId).collection('emailBroadcasts').doc(id).delete();
  },

  async listBroadcasts(tenantId) {
    const snap = await tenantDoc(tenantId).collection('emailBroadcasts').get();
    return snap.docs
      .map((d) => broadcastFrom(d.id, tenantId, d.data()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async listContacts(tenantId) {
    const docs = await tenantContactDocs(tenantId);
    const out: EmailContact[] = [];
    for (const d of docs) {
      const data = d.data();
      const email = typeof data.email === 'string' ? normalizeEmail(data.email) : '';
      if (!email) continue;
      const kind = data.type === 'donor' ? ['Donors'] : data.type === 'both' ? ['Members', 'Donors'] : ['Members'];
      const extra = Array.isArray(data.groups) ? (data.groups as unknown[]).filter((g): g is string => typeof g === 'string') : [];
      out.push({
        id: d.id,
        email,
        name: contactName(data),
        status: readEmailStatus(data[EMAIL_STATUS_FIELD]),
        tags: Array.isArray(data.tags) ? (data.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
        groups: [...kind, ...extra],
        source: typeof data[EMAIL_OPT_IN_SOURCE_FIELD] === 'string' ? (data[EMAIL_OPT_IN_SOURCE_FIELD] as string) : '',
        joinedAt: isoOrEmpty(data[EMAIL_OPT_IN_AT_FIELD]) || isoOrEmpty(data.createdAt),
      });
    }
    return out.sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
  },

  async createContacts(tenantId, rows, uid) {
    for (let i = 0; i < rows.length; i += 400) {
      const batch = adminDb.batch();
      for (const row of rows.slice(i, i + 400)) {
        batch.set(contacts().doc(), {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: '',
          type: 'member',
          notes: 'Added by email list import',
          tags: [...row.tags],
          totalDonated: 0,
          lastDonationAt: null,
          memberSince: null,
          tenantId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: uid,
          updatedAt: FieldValue.serverTimestamp(),
          [EMAIL_STATUS_FIELD]: 'subscribed',
          [EMAIL_OPT_IN_AT_FIELD]: row.at,
          [EMAIL_OPT_IN_SOURCE_FIELD]: row.source,
        });
      }
      await batch.commit();
    }
  },

  async updateContacts(tenantId, updates) {
    // Re-read inside the write path: a person who unsubscribed after the plan
    // was made must not be re-subscribed by it.
    const live = new Map((await tenantContactDocs(tenantId)).map((d) => [d.id, d.data()]));
    for (let i = 0; i < updates.length; i += 400) {
      const batch = adminDb.batch();
      for (const u of updates.slice(i, i + 400)) {
        const data = live.get(u.id);
        if (!data) continue;
        const current = readEmailStatus(data[EMAIL_STATUS_FIELD]);
        if (isSuppressed(current)) continue;
        const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
        if (u.subscribe) {
          patch[EMAIL_STATUS_FIELD] = 'subscribed';
          patch[EMAIL_OPT_IN_AT_FIELD] = u.at;
          patch[EMAIL_OPT_IN_SOURCE_FIELD] = u.source;
        }
        if (u.addTags.length > 0) patch.tags = FieldValue.arrayUnion(...u.addTags);
        batch.set(contacts().doc(u.id), patch, { merge: true });
      }
      await batch.commit();
    }
  },

  async usage(tenantId, key) {
    const snap = await tenantDoc(tenantId).collection('emailUsage').doc(key).get();
    const sent = snap.exists ? snap.data()?.sent : 0;
    return typeof sent === 'number' ? sent : 0;
  },

  async addUsage(tenantId, key, sent) {
    await tenantDoc(tenantId).collection('emailUsage').doc(key).set({ sent: FieldValue.increment(sent) }, { merge: true });
  },

  async health(tenantId, month) {
    const snap = await tenantDoc(tenantId).collection('emailUsage').doc(month).get();
    const d = snap.exists ? snap.data() ?? {} : {};
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    return { sent: n(d.sent), bounced: n(d.bounced), complained: n(d.complained) };
  },

  async addFeedback(tenantId, month, kind) {
    await tenantDoc(tenantId).collection('emailUsage').doc(month).set({ [kind]: FieldValue.increment(1) }, { merge: true });
  },

  async queueScheduled(tenantId, broadcastId, at) {
    await adminDb.collection(SCHEDULED_QUEUE).doc(`${tenantId}__${broadcastId}`).set({ tenantId, broadcastId, at });
  },

  async unqueueScheduled(tenantId, broadcastId) {
    await adminDb.collection(SCHEDULED_QUEUE).doc(`${tenantId}__${broadcastId}`).delete();
  },

  async listDue(nowIso) {
    const snap = await adminDb.collection(SCHEDULED_QUEUE).where('at', '<=', nowIso).get();
    return snap.docs.map((d) => ({ tenantId: String(d.data().tenantId), broadcastId: String(d.data().broadcastId) }));
  },

  async recordOptOut(tenantId, email, broadcastId, at) {
    await markContacts(tenantId, email, {
      [EMAIL_STATUS_FIELD]: 'unsubscribed',
      emailUnsubscribedAt: at,
      emailUnsubscribedFrom: broadcastId,
    });
  },

  async markContactStatus(tenantId, email, status, at) {
    await markContacts(tenantId, email, { [EMAIL_STATUS_FIELD]: status, emailSuppressedAt: at });
  },
};

async function markContacts(tenantId: string, email: string, fields: Record<string, unknown>): Promise<void> {
  const target = normalizeEmail(email);
  const docs = (await tenantContactDocs(tenantId)).filter((d) => normalizeEmail(String(d.data().email ?? '')) === target);
  if (docs.length === 0) return;
  const batch = adminDb.batch();
  for (const d of docs) batch.set(d.ref, { ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}
