import type { EffectiveFeatures } from '@/utils/plan-features';
import { getEffectiveFeatures, readTenantAddons, toTenantPlan } from '@/utils/plan-features';

/**
 * A tenant's EFFECTIVE feature set, server side — the one place a route,
 * a page or a webhook asks "may this tenant reach this surface?".
 *
 * 🔴 EXISTS BECAUSE THE-213 FOUND FOUR SURFACES THAT NEVER ASKED. The flags
 * were right; the surfaces rendered anyway. A hidden nav item is not a gate
 * (precedent THE-193), and a surface that writes — check-in records an
 * attendee, a donate page takes money — is only actually refused on the
 * server, where the Admin SDK bypasses firestore.rules entirely.
 *
 * 🔴 `getEffectiveFeatures`, NEVER `getPlanFeatures`. A gate answers a question
 * about a TENANT ("what does this church hold"), not about a TIER ("what does
 * this plan publish"), and the two differ the moment an add-on is bought. Only
 * four cells move today (contacts, admins, campuses, AI assistants), so for the
 * boolean surfaces this reads identically — which is exactly why a base-matrix
 * gate survives review and then answers wrongly the first time a boolean
 * becomes add-on-liftable. Ask the tenant question everywhere so the answer
 * cannot depend on which cell someone happened to gate on.
 *
 * ⚠️ GATES A SURFACE, NEVER DATA. Nothing here deletes, hides or rewrites a
 * document. A tenant that upgrades gets every refused surface back with its
 * history intact — the `checkinSessions`, `attendees`, `campaigns` and
 * `community_posts` a refusal walks past are untouched, and so are
 * firestore.rules.
 */

/** Effective features for a tenant document already in hand. */
export function tenantFeatures(
  tenant: { plan?: unknown; addons?: unknown } | null | undefined,
): EffectiveFeatures {
  // `toTenantPlan` fails closed to 'plus' for an absent or unrecognised plan —
  // the same coercion every other reader of an untrusted plan field applies, so
  // a corrupt document cannot invent a tier. `readTenantAddons` does the same
  // for the add-on record, resolving an absent field to "owns nothing" rather
  // than throwing mid-request.
  return getEffectiveFeatures(toTenantPlan(tenant?.plan as string | null | undefined), readTenantAddons(tenant?.addons));
}

/**
 * Effective features for a tenant id, read through the Admin SDK.
 *
 * Returns `null` when the tenant does not exist — the caller decides what an
 * unknown tenant means (a public page 404s, an authenticated route 400s). A
 * READ FAILURE is not caught here: it propagates, so the caller's own error
 * handling refuses the request rather than a swallowed error silently resolving
 * to "unknown plan → 'plus' → allowed".
 */
export async function tenantFeaturesById(tenantId: string): Promise<EffectiveFeatures | null> {
  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb.collection('tenants').doc(tenantId).get();
  if (!snap.exists) return null;
  return tenantFeatures(snap.data());
}
