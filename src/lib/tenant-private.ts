import { adminDb } from '@/lib/firebase-admin';

/**
 * Private per-tenant document: tenant_private/{tenantId}.
 *
 * The public tenants/{id} doc is world-readable by design (`allow read: if
 * true` in firestore.rules) — pre-auth subdomain resolution needs name/
 * subdomain/branding before any sign-in. But it also carried the adminEmails
 * roster (a per-church phishing target list) and the Stripe identifiers.
 * Those fields are moving here, where the rules are `allow read, write: if
 * false` (server-only, Admin SDK): a rules-level get() can still read a doc
 * the client cannot, so inTenantAdminEmails keeps working off this doc.
 *
 * Top-level collection (not a tenants/{id} subcollection) on purpose: the
 * Stripe webhook and Connect callback resolve tenants by
 * where('stripeCustomerId'/'stripeConnectAccountId', '==', …). A subcollection
 * would force collection-group queries, which need index fieldOverrides that
 * the rules deploy workflow never ships; a top-level collection keeps those
 * money-path lookups on built-in single-field indexes.
 *
 * Rollout: dual-written since PR 1; rules roster read switches after backfill
 * in PR 2; the public copies are removed in PR 3.
 */
export const TENANT_PRIVATE_COLLECTION = 'tenant_private';

/**
 * The tenant-doc fields being moved off the public document.
 *
 * ⚠️ THIS LIST IS WHAT SURVIVES A SUBDOMAIN RENAME. `/api/tenants/finish-setup`
 * moves the private doc to the new tenant id with `pickTenantPrivateFields`,
 * which copies EXACTLY these keys and silently drops everything else. First-run
 * setup is where a brand-new church renames itself, so a billing identifier that
 * is not on this list is an identifier that disappears the first time the owner
 * picks their own subdomain — the tenant still looks provisioned and its
 * subscription can no longer be resolved.
 *
 * The `dodo*` identifiers are therefore listed here from the moment anything
 * writes them (REP-4 PR 2), not later.
 */
export const TENANT_PRIVATE_FIELDS = [
  'adminEmails',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'stripePriceId',
  'stripeConnectAccountId',
  // ─── Dodo Payments subscription identifiers ────────────────────────────────
  // ⚠️ ADDITIONAL TO the stripe* fields above, never a replacement for them.
  // Existing test tenants still carry Stripe ids, the Stripe path is the
  // rollback, and `stripeConnectAccountId` is DONATIONS — a different processor
  // relationship entirely that this migration does not touch.
  'dodoCustomerId',
  'dodoSubscriptionId',
  /** The Dodo product the subscription sells. Dodo puts the price on the product. */
  'dodoProductId',
  /**
   * 🔴 WHICH PROCESSOR OWNS THE SUBSCRIPTION — 'stripe' | 'dodo'.
   *
   * Every billing write path routes on this (see `@/lib/billing-processor`). It
   * is on this list for the same reason the identifiers are: a rename that
   * dropped it would leave the tenant's ownership to be re-derived from its ids,
   * and a tenant whose ownership cannot be determined has its billing actions
   * BLOCKED. Losing it is losing the ability to change or cancel a plan.
   */
  'billingProcessor',
] as const;

export type TenantPrivateField = (typeof TENANT_PRIVATE_FIELDS)[number];

export function tenantPrivateRef(tenantId: string) {
  return adminDb.collection(TENANT_PRIVATE_COLLECTION).doc(tenantId);
}

/**
 * Read the private doc's data ({} when missing). Server-side only — clients
 * can never read this collection; they go through an API route.
 */
export async function getTenantPrivate(tenantId: string): Promise<Record<string, any>> {
  const snap = await tenantPrivateRef(tenantId).get();
  return snap.exists ? (snap.data() as Record<string, any>) : {};
}

/**
 * The subset of `data` that belongs on the private doc — exactly the moved
 * fields, and only when the write actually carries them. Writers pass their
 * public-doc payload through this so the two locations can never disagree on
 * a field the write touched.
 */
export function pickTenantPrivateFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of TENANT_PRIVATE_FIELDS) {
    if (field in data && data[field] !== undefined) out[field] = data[field];
  }
  return out;
}
