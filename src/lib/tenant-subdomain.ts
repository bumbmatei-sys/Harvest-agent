import { adminDb } from '@/lib/firebase-admin';
import { NON_TENANT_SUBDOMAINS } from '@/utils/non-tenant-subdomains';

/**
 * Turn a ministry name into a unique, free tenant subdomain.
 *
 * 🔴 PROCESSOR-NEUTRAL BY NECESSITY (THE-203). This lived in
 * `src/lib/dodo/provisioning.ts`, which was fine while every tenant arrived
 * through a processor. Forever Free tenants do not: they have no Dodo customer,
 * no subscription and no product, and `src/lib/free-provisioning.ts` reaching
 * into the Dodo module to name one would be exactly the coupling the import
 * fence in `dodo-billing-flag.test.ts` exists to prevent — and that fence held
 * this to account rather than being widened for it.
 *
 * Moved, not copied. `provisioning.ts` re-exports it, so every existing
 * importer and every existing test keeps the name it had, and there is still
 * ONE implementation on the Dodo path rather than two that can drift.
 *
 * The Stripe webhook keeps its own private copy, deliberately and as before:
 * that copy is character-for-character identical, the id it produces IS the
 * church's public address, and two processors that named churches differently
 * would be visible to customers. Collapsing it into this module is a money-path
 * refactor and does not ride along with a signup path.
 *
 * The shared reserved-label set comes from `NON_TENANT_SUBDOMAINS`, so a new
 * non-tenant subdomain is automatically unassignable on every path at once.
 */
export async function generateUniqueSubdomain(ministryName: string): Promise<string> {
  const RESERVED = new Set([...NON_TENANT_SUBDOMAINS, 'api', 'harvest', 'nations', 'platform']);
  const base = (ministryName || 'ministry')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'ministry';

  let candidate = base;
  for (let i = 0; i < 10; i++) {
    const exists = (await adminDb.collection('tenants').doc(candidate).get()).exists;
    if (!RESERVED.has(candidate) && !exists) return candidate;
    const suffix = Math.random().toString(36).slice(2, 6);
    candidate = `${base}-${suffix}`.slice(0, 40);
  }
  return candidate;
}
