import 'server-only';

import { communitySuppressionId, scrubSuppressionEmail, tenantAddressSuppressed } from '@/lib/community-privacy';

import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/render';
import {
  readCustomTheme,
  readSocialLinks,
  type CustomTheme,
  type EmailThemeTokens,
} from '@/lib/email/themes';
import {
  EMAIL_OPT_IN_AT_FIELD,
  EMAIL_OPT_IN_SOURCE_FIELD,
  EMAIL_STATUS_FIELD,
  isSuppressed,
  readEmailStatus,
  type EmailContact,
} from '@/lib/email/audience';
import { normalizeEmail } from '@/lib/donation-history';
import { contentHash, decideClaim, sendingMarkerId } from '@/lib/email/claim';
import { purgeWhereAtOrBefore } from '@/lib/email/firestore-purge';
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
/** Server-only, no client rule: one marker per send in flight, so a send that died can be found and closed. */
export const SENDING_QUEUE = 'email_sending';
/** Server-only, no client rule: email_domains/{domain} = { tenantId }. A sending domain belongs to one ministry. */
export const DOMAIN_CLAIMS = 'email_domains';
/** Server-only, no client rule: one document per bounce or complaint already counted, so a repeated webhook counts once. */
export const FEEDBACK_EVENTS = 'email_feedback_events';
const FEEDBACK_EVENT_TTL_MS = 62 * 24 * 60 * 60 * 1000;
/** Server-only, under tenants/{id}: the opt-out record. Outlives the CRM person it came from. */
export const SUPPRESSIONS = 'emailSuppressions';
/** Server-only, no client rule: one document of platform-wide limits a super admin edits. */
export const PLATFORM_CONFIG = 'platform_config';
export const LIMITS_DOC = 'email_limits';

const tenantDoc = (tenantId: string) => adminDb.collection('tenants').doc(tenantId);

/**
 * The ministry's saved themes. Server-only like its `settings` sibling (no
 * client rule exists anywhere under `emailConfig`, so browsers are denied by
 * default). One document, themes keyed by id.
 */
const themesDoc = (tenantId: string) => tenantDoc(tenantId).collection('emailConfig').doc('themes');

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function broadcastFrom(id: string, tenantId: string, data: Record<string, unknown>): Broadcast {
  return {
    id,
    tenantId,
    subject: str(data.subject),
    subjectB: typeof data.subjectB === 'string' ? data.subjectB : null,
    preheader: str(data.preheader),
    bodyHtml: str(data.bodyHtml),
    design: { ...DEFAULT_EMAIL_DESIGN, ...((data.design as object) ?? {}) },
    // Read back only when present: a broadcast saved before themes keeps the
    // exact shape it had, so its contentHash still compares with what a caller
    // computed from the in-memory draft.
    ...(typeof data.themeId === 'string' && data.themeId ? { themeId: data.themeId } : {}),
    ...(data.themeTokens && typeof data.themeTokens === 'object' ? { themeTokens: data.themeTokens as EmailThemeTokens } : {}),
    filters: Array.isArray(data.filters) ? (data.filters as Broadcast['filters']) : [],
    status: (str(data.status) || 'draft') as Broadcast['status'],
    scheduledAt: typeof data.scheduledAt === 'string' ? data.scheduledAt : null,
    sentAt: typeof data.sentAt === 'string' ? data.sentAt : null,
    stats: (data.stats as Broadcast['stats']) ?? null,
    error: typeof data.error === 'string' ? data.error : null,
    sendId: typeof data.sendId === 'string' ? data.sendId : null,
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
    const data = (snap.exists ? snap.data() ?? {} : {}) as Record<string, unknown>;
    return {
      ...EMPTY_SETTINGS,
      ...(data as Partial<EmailSettings>),
      // Untrusted storage: only validated shapes reach the renderer.
      logoUrl: str(data.logoUrl),
      footerNote: str(data.footerNote),
      socialLinks: readSocialLinks(data.socialLinks),
      defaultThemeId: typeof data.defaultThemeId === 'string' && data.defaultThemeId ? data.defaultThemeId : null,
    };
  },

  async saveSettings(tenantId, settings) {
    await tenantDoc(tenantId).collection('emailConfig').doc('settings').set(settings);
  },

  async listThemes(tenantId) {
    const snap = await themesDoc(tenantId).get();
    const raw = (snap.exists ? snap.data()?.themes ?? {} : {}) as Record<string, unknown>;
    return Object.values(raw)
      .map((v) => readCustomTheme(v))
      .filter((t): t is CustomTheme => t !== null)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  },

  async saveTheme(tenantId, theme) {
    // Map key = theme id. A whole-theme write is atomic and the service has
    // already enforced the 10-theme cap loudly before this lands.
    await themesDoc(tenantId).set({ themes: { [theme.id]: { ...theme } } }, { merge: true });
  },

  async deleteTheme(tenantId, id) {
    await themesDoc(tenantId).set({ themes: { [id]: FieldValue.delete() } }, { merge: true });
  },

  async getBroadcast(tenantId, id) {
    const snap = await tenantDoc(tenantId).collection('emailBroadcasts').doc(id).get();
    return snap.exists ? broadcastFrom(id, tenantId, snap.data() ?? {}) : null;
  },

  async saveBroadcast(broadcast) {
    await tenantDoc(broadcast.tenantId).collection('emailBroadcasts').doc(broadcast.id).set(broadcast);
  },

  async saveBroadcastIf(broadcast, statuses, expectedContentHash) {
    const ref = tenantDoc(broadcast.tenantId).collection('emailBroadcasts').doc(broadcast.id);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || !statuses.includes(str(snap.data()?.status) as Broadcast['status'])) return false;
      if (expectedContentHash !== undefined && contentHash(broadcastFrom(broadcast.id, broadcast.tenantId, snap.data() ?? {})) !== expectedContentHash) return false;
      tx.set(ref, broadcast);
      return true;
    });
  },

  async removeBroadcastIf(tenantId, id, statuses) {
    const ref = tenantDoc(tenantId).collection('emailBroadcasts').doc(id);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || !statuses.includes(str(snap.data()?.status) as Broadcast['status'])) return false;
      tx.delete(ref);
      return true;
    });
  },

  async claimForSend(request) {
    const broadcastRef = tenantDoc(request.tenantId).collection('emailBroadcasts').doc(request.broadcastId);
    const monthRef = tenantDoc(request.tenantId).collection('emailUsage').doc(request.month);
    const dayRef = tenantDoc(request.tenantId).collection('emailUsage').doc(request.day);
    const markerRef = adminDb.collection(SENDING_QUEUE).doc(sendingMarkerId(request.tenantId, request.broadcastId));
    return adminDb.runTransaction(async (tx) => {
      const [broadcast, month, day] = await Promise.all([tx.get(broadcastRef), tx.get(monthRef), tx.get(dayRef)]);
      const used = (snap: typeof month) => {
        const sent = snap.exists ? snap.data()?.sent : 0;
        return typeof sent === 'number' ? sent : 0;
      };
      const decision = decideClaim(broadcast.exists ? str(broadcast.data()?.status) : null, broadcast.exists ? contentHash(broadcastFrom(request.broadcastId, request.tenantId, broadcast.data() ?? {})) : null, used(month), used(day), request);
      if (!decision.ok) return decision;
      tx.update(broadcastRef, { status: 'sending', sendId: request.sendId, error: null, scheduledAt: null, updatedAt: request.nowIso });
      tx.set(monthRef, { sent: FieldValue.increment(request.requested) }, { merge: true });
      tx.set(dayRef, { sent: FieldValue.increment(request.requested) }, { merge: true });
      tx.set(markerRef, { tenantId: request.tenantId, broadcastId: request.broadcastId, sendId: request.sendId, claimedAt: request.nowIso });
      tx.delete(adminDb.collection(SCHEDULED_QUEUE).doc(`${request.tenantId}__${request.broadcastId}`));
      return decision;
    });
  },

  async settleSend({ broadcast, settlement }) {
    const broadcastRef = tenantDoc(broadcast.tenantId).collection('emailBroadcasts').doc(broadcast.id);
    const markerRef = adminDb.collection(SENDING_QUEUE).doc(sendingMarkerId(broadcast.tenantId, broadcast.id));
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(broadcastRef);
      const data = snap.exists ? snap.data() : null;
      if (!data || data.status !== 'sending' || data.sendId !== broadcast.sendId) return false;
      tx.set(broadcastRef, broadcast);
      tx.delete(markerRef);
      if (settlement && settlement.refund > 0) {
        for (const key of [settlement.month, settlement.day]) {
          tx.set(tenantDoc(broadcast.tenantId).collection('emailUsage').doc(key), { sent: FieldValue.increment(-settlement.refund) }, { merge: true });
        }
      }
      return true;
    });
  },

  async listStaleSending(cutoffIso) {
    const snap = await adminDb.collection(SENDING_QUEUE).where('claimedAt', '<=', cutoffIso).get();
    return snap.docs.map((d) => ({ tenantId: String(d.data().tenantId), broadcastId: String(d.data().broadcastId), sendId: String(d.data().sendId) }));
  },

  async claimDomain(tenantId, domain) {
    const ref = adminDb.collection(DOMAIN_CLAIMS).doc(domain);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, { tenantId, claimedAt: new Date().toISOString() });
        return 'fresh' as const;
      }
      const data = snap.data() ?? {};
      if (typeof data.tenantId === 'string' && data.tenantId) return data.tenantId === tenantId ? ('own' as const) : ('taken' as const);
      // A released claim is a placeholder. Only the ministry that released it may take it back.
      if (data.releasedBy !== tenantId) return 'released' as const;
      tx.set(ref, { tenantId, claimedAt: new Date().toISOString(), releasedBy: null, releasedAt: null });
      return 'own' as const;
    });
  },

  async releaseDomain(tenantId, domain) {
    const ref = adminDb.collection(DOMAIN_CLAIMS).doc(domain);
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data()?.tenantId === tenantId) {
        tx.set(ref, { tenantId: null, releasedBy: tenantId, releasedAt: new Date().toISOString() });
      }
    });
  },

  async discardClaim(tenantId, domain) {
    const ref = adminDb.collection(DOMAIN_CLAIMS).doc(domain);
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data()?.tenantId === tenantId) tx.delete(ref);
    });
  },

  async getDomainOwner(domain) {
    if (!domain) return null;
    const snap = await adminDb.collection(DOMAIN_CLAIMS).doc(domain).get();
    const owner = snap.exists ? snap.data()?.tenantId : null;
    return typeof owner === 'string' ? owner : null;
  },

  async isSuppressedNow(tenantId, email) {
    return tenantAddressSuppressed(tenantId, email);
  },

  async listSuppressed(tenantId) {
    const snap = await tenantDoc(tenantId).collection(SUPPRESSIONS).get();
    await Promise.all(snap.docs.map(scrubSuppressionEmail));
    return new Set(snap.docs.map(d => d.id));
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
        // #573: leaving a community no longer overrides a newsletter opt-in. A
        // leaver who never subscribed is unsubscribed and hash-blocked at departure.
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
    await recordSuppression(tenantId, email, 'unsubscribed', at, broadcastId);
    await markContacts(tenantId, email, {
      [EMAIL_STATUS_FIELD]: 'unsubscribed',
      emailUnsubscribedAt: at,
      emailUnsubscribedFrom: broadcastId,
    });
  },

  async claimFeedbackEvent(tenantId, key, at) {
    try {
      await adminDb.collection(FEEDBACK_EVENTS).doc(`${tenantId}__${key}`).create({ tenantId, at, expireAt: new Date(Date.parse(at) + FEEDBACK_EVENT_TTL_MS) });
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS
      throw error;
    }
  },

  async releaseFeedbackEvent(tenantId, key) {
    await adminDb.collection(FEEDBACK_EVENTS).doc(`${tenantId}__${key}`).delete();
  },

  async purgeExpiredFeedbackEvents(nowIso) {
    return purgeWhereAtOrBefore(FEEDBACK_EVENTS, 'expireAt', new Date(nowIso));
  },

  async markContactStatus(tenantId, email, status, at) {
    await recordSuppression(tenantId, email, status, at, '');
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

/**
 * The opt-out lives here as well as on the CRM person. Deleting the person (the
 * CRM does, from the browser) deletes the field, and an import could then
 * subscribe the address again; this record is what keeps the opt-out true.
 * Keyed by a hash of the address so the id is safe and the write is idempotent.
 */
async function recordSuppression(tenantId: string, email: string, status: string, at: string, from: string): Promise<void> {
  const emailHash = communitySuppressionId(email);
  // Replace the old shape so a legacy plaintext address cannot survive erasure.
  await tenantDoc(tenantId).collection(SUPPRESSIONS).doc(emailHash).set({ emailHash, status, at, from });
}
