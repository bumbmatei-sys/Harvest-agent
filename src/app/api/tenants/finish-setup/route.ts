import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { setCustomClaims } from '@/lib/set-custom-claims';

export const dynamic = 'force-dynamic';

const RESERVED = new Set(['www', 'app', 'admin', 'api', 'harvest', 'nations', 'platform']);

function normalizeSubdomain(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * POST /api/tenants/finish-setup
 * Completes the one-time first-run setup for the caller's (just-created) tenant.
 *
 * Body: { subdomain?: string }
 *  - If a new subdomain is supplied (and free), the tenant is renamed: because the
 *    tenant doc id IS the routing key (`<id>.theharvest.app`), a rename moves the
 *    doc to the new id and re-points the admin's user doc + claims. This is safe
 *    only during first-run — the tenant was just created, so it has no
 *    subcollections to migrate.
 *  - Always flips `setupCompleted` to true so the first-run gate lets the admin in.
 *
 * Auth: Bearer token. Caller must own the tenant (their own tenantId) and it must
 * still be in first-run (`setupCompleted !== true`) to rename.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAuth(request);
    if (caller instanceof Response) return caller;

    const oldId = caller.tenantId;
    if (!oldId) {
      return NextResponse.json({ error: 'No tenant to finish setting up.' }, { status: 400 });
    }

    const tenantRef = adminDb.collection('tenants').doc(oldId);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant not found.' }, { status: 404 });
    }
    const tenantData = tenantSnap.data() || {};

    // Authorize: super admin, an admin claim, or listed in the tenant's adminEmails.
    const callerEmail = (caller.email || '').toLowerCase();
    const adminEmails: string[] = Array.isArray(tenantData.adminEmails) ? tenantData.adminEmails : [];
    const isOwner =
      caller.isSuperAdmin ||
      caller.isAdmin ||
      adminEmails.some((e) => (e || '').toLowerCase() === callerEmail);
    if (!isOwner) {
      return NextResponse.json({ error: 'Not authorized for this tenant.' }, { status: 403 });
    }

    // Already finished → idempotent no-op.
    if (tenantData.setupCompleted === true) {
      return NextResponse.json({ tenantId: oldId, alreadyCompleted: true });
    }

    const body = await request.json().catch(() => ({}));
    const desired = normalizeSubdomain(body?.subdomain || '');
    const now = new Date().toISOString();

    // No rename (kept the auto subdomain, or invalid/too-short input) → just finish.
    if (!desired || desired.length < 3 || desired === oldId) {
      await tenantRef.update({ subdomain: oldId, setupCompleted: true, updatedAt: now });
      return NextResponse.json({ tenantId: oldId });
    }

    if (RESERVED.has(desired)) {
      return NextResponse.json({ error: 'That subdomain is reserved. Try another.' }, { status: 409 });
    }

    const desiredRef = adminDb.collection('tenants').doc(desired);

    // Write the new tenant doc with create() (not set()) so a concurrent claim of
    // the same subdomain fails with ALREADY_EXISTS instead of silently clobbering
    // another tenant — this closes the read-then-write race. If the target already
    // exists but is OUR OWN in-progress rename (same subscription, retry after a
    // crash), resume instead of erroring.
    try {
      await desiredRef.create({
        ...tenantData,
        subdomain: desired,
        setupCompleted: true,
        updatedAt: now,
      });
    } catch (createErr: any) {
      const existing = await desiredRef.get();
      const ours = existing.exists
        && existing.data()?.stripeSubscriptionId === tenantData.stripeSubscriptionId;
      if (!ours) {
        return NextResponse.json({ error: 'That subdomain is already taken.' }, { status: 409 });
      }
      // Our own partially-applied rename — make sure it's marked complete.
      await desiredRef.set({ subdomain: desired, setupCompleted: true, updatedAt: now }, { merge: true });
    }

    // Re-point every user on the old tenant (just the admin at this stage) + claims.
    const usersSnap = await adminDb.collection('users').where('tenantId', '==', oldId).get();
    if (!usersSnap.empty) {
      const batch = adminDb.batch();
      usersSnap.docs.forEach((d) => batch.update(d.ref, { tenantId: desired, updatedAt: now }));
      await batch.commit();
      await Promise.all(usersSnap.docs.map((d) => setCustomClaims(d.id)));
    }

    // Migrate the custom-domain lookup doc(s) so a domain saved during first-run
    // keeps resolving after the rename (domains/{domain} = { tenantId }).
    try {
      const domainsSnap = await adminDb.collection('domains').where('tenantId', '==', oldId).get();
      if (!domainsSnap.empty) {
        const dbatch = adminDb.batch();
        domainsSnap.docs.forEach((d) => dbatch.update(d.ref, { tenantId: desired }));
        await dbatch.commit();
      }
    } catch (domErr) {
      console.error('finish-setup: failed to migrate domain lookup docs:', domErr);
    }

    // Keep the Stripe subscription pointed at the new tenant id so future
    // lifecycle events (cancellation, payment failure) resolve to this tenant.
    const subId = tenantData.stripeSubscriptionId;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (subId && stripeKey) {
      try {
        const stripe = new Stripe(stripeKey);
        await stripe.subscriptions.update(subId, { metadata: { tenantId: desired } });
      } catch (subErr) {
        console.error('finish-setup: failed to update subscription metadata:', subErr);
      }
    }

    // Delete the old tenant doc LAST, so a crash earlier leaves the old (still
    // routable) doc intact rather than stranding the user with no tenant.
    await tenantRef.delete().catch((delErr) => {
      console.error('finish-setup: failed to delete old tenant doc:', delErr);
    });

    return NextResponse.json({ tenantId: desired });
  } catch (error: any) {
    console.error('finish-setup error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to finish setup' }, { status: 500 });
  }
}
