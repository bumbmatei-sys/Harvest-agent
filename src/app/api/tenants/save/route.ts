import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireSuperAdmin } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { tenantPrivateRef, pickTenantPrivateFields } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tenants/save — super-admin tenant create/update (AdminTenants).
 *
 * This used to happen client-side (src/utils/tenant.utils.ts writing the
 * tenants doc directly with the client SDK). It moved server-side because the
 * adminEmails roster is dual-written to tenant_private/{id}, which is
 * server-only (`allow read, write: if false`) — a client cannot write it, and
 * the two locations must land in one atomic batch.
 *
 * Body:
 *  - create: { name, subdomain, plan, adminEmails, config? }
 *  - update: { id, name?, plan?, status?, adminEmails?, config? }
 *    (config subfields are merged with dot-notation, matching the old client
 *    helper; `plan` is accepted only on create — the Stripe webhook owns plan
 *    changes on live tenants, matching the old AdminTenants behavior.)
 */
export async function POST(request: NextRequest) {
  const callerOrErr = await requireSuperAdmin(request);
  if (callerOrErr instanceof NextResponse) return callerOrErr;

  try {
    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (body.id) {
      // ── Update ──────────────────────────────────────────────────────────
      const id = String(body.id);
      const ref = adminDb.collection('tenants').doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }

      const updateData: Record<string, unknown> = { updatedAt: now };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.adminEmails !== undefined) updateData.adminEmails = body.adminEmails;
      if (body.config) {
        for (const key of ['logo', 'primaryColor', 'description', 'customDomain'] as const) {
          if (body.config[key] !== undefined) updateData[`config.${key}`] = body.config[key];
        }
      }

      const batch = adminDb.batch();
      batch.update(ref, updateData);
      const privateFields = pickTenantPrivateFields(updateData);
      if (Object.keys(privateFields).length > 0) {
        batch.set(tenantPrivateRef(id), { ...privateFields, updatedAt: now }, { merge: true });
      }
      await batch.commit();
      return NextResponse.json({ id });
    }

    // ── Create ────────────────────────────────────────────────────────────
    const name = String(body.name || '').trim();
    const subdomain = String(body.subdomain || '').toLowerCase().trim();
    if (!name || !subdomain) {
      return NextResponse.json({ error: 'name and subdomain are required' }, { status: 400 });
    }
    const id = subdomain;

    const config: Record<string, unknown> = {};
    for (const key of ['logo', 'primaryColor', 'description', 'customDomain'] as const) {
      if (body.config?.[key]) config[key] = body.config[key];
    }

    const tenantData = {
      name,
      subdomain: id,
      plan: body.plan || 'plus',
      status: 'active',
      config,
      adminEmails: Array.isArray(body.adminEmails) ? body.adminEmails : [],
      createdAt: now,
      updatedAt: now,
    };

    // batch.create() keeps the old client-side availability check race-free:
    // a concurrent claim of the same subdomain fails with ALREADY_EXISTS
    // instead of clobbering the other tenant.
    const batch = adminDb.batch();
    batch.create(adminDb.collection('tenants').doc(id), tenantData);
    batch.set(tenantPrivateRef(id), {
      ...pickTenantPrivateFields(tenantData),
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return NextResponse.json({ id });
  } catch (error: any) {
    if (error?.code === 6 /* ALREADY_EXISTS */) {
      return NextResponse.json({ error: 'Subdomain is already taken.' }, { status: 409 });
    }
    console.error('tenant save error:', error?.message || error);
    captureHandledError(error, { step: 'tenant-save' });
    return NextResponse.json({ error: error?.message || 'Failed to save tenant' }, { status: 500 });
  }
}
