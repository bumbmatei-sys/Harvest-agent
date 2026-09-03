import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, type AuthenticatedUser } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { hasFeature } from '@/utils/plan-features';
import type { TenantPlan } from '@/types/tenant.types';
import { captureHandledError } from '@/lib/money-path-sentry';
import { CUSTOM_DOMAIN_ENABLED, CUSTOM_DOMAIN_HIDDEN_MESSAGE } from '@/lib/custom-domain-feature';

/**
 * Custom domain provisioning via the Vercel API.
 *
 * POST  — add the tenant's custom domain to the Vercel project, persist it to
 *         `tenants/{tenantId}.config.customDomain` + the `domains/{domain}`
 *         lookup collection, and return the verification challenge.
 * GET    — poll Vercel for verification status and mirror it onto the tenant doc
 *         as `config.customDomainVerified` + `config.customDomainStatus`.
 *
 * Requires VERCEL_API_TOKEN and VERCEL_PROJECT_ID env vars (set in Vercel).
 *
 * Custom domains are a Community-plan (max) feature and above. The entitlement
 * is enforced HERE, server-side, by `requireCustomDomainPlan` — not only in the
 * UI. It previously was not: this comment used to claim gating was enforced "in
 * the UI and by Firestore rules", but firestore.rules contains no `customDomain`
 * reference at all, so an authenticated tenant admin on ANY plan could attach an
 * arbitrary domain to the shared Vercel project by calling this route directly.
 */

const VERCEL_API = 'https://api.vercel.com';

function vercelConfig() {
  const token = process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID; // optional
  return { token, projectId, teamId };
}

function teamQuery(teamId?: string) {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

async function resolveTenantId(request: NextRequest, user: { tenantId: string | null }): Promise<string> {
  if (user.tenantId) return user.tenantId;
  return PLATFORM_TENANT_ID;
}

/**
 * Plan entitlement gate for custom domains.
 *
 * Resolves the tenant's plan SERVER-SIDE from `tenants/{tenantId}.plan` — never
 * from anything the client sends — and refuses with 403 unless that plan has
 * `customDomain`. Mirrors the established pattern in
 * `api/newsletter/generate/route.ts`: super admins bypass, and an absent/unknown
 * plan falls back to 'plus' so the gate fails closed.
 *
 * Returns a NextResponse to return to the caller, or null when the caller is
 * entitled and the handler should continue.
 */
async function requireCustomDomainPlan(
  user: AuthenticatedUser,
  tenantId: string
): Promise<NextResponse | null> {
  // Super admins operate across tenants (and on the platform tenant, which has
  // no plan doc of its own) — preserve the bypass requireAdmin already grants.
  if (user.isSuperAdmin) return null;

  const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const plan = (tenantDoc.data()?.plan as TenantPlan) || 'plus';
  if (!hasFeature(plan, 'customDomain')) {
    return NextResponse.json(
      { error: 'Custom domains require the Community plan or higher.' },
      { status: 403 }
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!CUSTOM_DOMAIN_ENABLED) {
    // THE-280 — refuses FIRST: before authenticating, before resolving a tenant
    // and before any Vercel or Firestore call, so no stored domain is touched.
    return NextResponse.json({ error: CUSTOM_DOMAIN_HIDDEN_MESSAGE }, { status: 503 });
  }

  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const tenantId = await resolveTenantId(request, authResult);

  // Entitlement before anything else: an unentitled tenant gets 403 whether or
  // not Vercel is configured on this deployment, and no Vercel mutation or
  // Firestore write can happen ahead of the check.
  const planGate = await requireCustomDomainPlan(authResult, tenantId);
  if (planGate) return planGate;

  const { token, projectId, teamId } = vercelConfig();
  if (!token || !projectId) {
    return NextResponse.json(
      { error: 'Domain provisioning is not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID.' },
      { status: 501 }
    );
  }

  let body: { domain?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain || '');
  if (!domain || !domain.includes('.')) {
    return NextResponse.json({ error: 'A valid domain is required' }, { status: 400 });
  }

  // Ownership guard: never let one tenant claim a domain another tenant already owns.
  const existingClaim = await adminDb.collection('domains').doc(domain).get();
  const claimedBy = existingClaim.exists ? existingClaim.data()?.tenantId : null;
  if (claimedBy && claimedBy !== tenantId) {
    return NextResponse.json(
      { error: 'This domain is already connected to another account.' },
      { status: 409 }
    );
  }

  try {
    const resp = await fetch(`${VERCEL_API}/v10/projects/${projectId}/domains${teamQuery(teamId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    });
    const data = await resp.json();

    const alreadyInUse = resp.status === 409 || data?.error?.code === 'domain_already_in_use';
    if (!resp.ok && !alreadyInUse) {
      return NextResponse.json(
        { error: data?.error?.message || 'Failed to add domain to Vercel' },
        { status: 502 }
      );
    }
    // "Already in use" is only safe if WE already own this domain in Firestore
    // (idempotent re-save). If we don't own it yet, it's attached to another
    // project/account — refuse instead of silently claiming it.
    if (alreadyInUse && !claimedBy) {
      return NextResponse.json(
        { error: 'This domain is already in use elsewhere and cannot be connected.' },
        { status: 409 }
      );
    }

    const verified = data?.verified === true;

    // Persist on the tenant doc + the fast-lookup domains collection.
    await adminDb.collection('tenants').doc(tenantId).set(
      {
        config: {
          customDomain: domain,
          customDomainVerified: verified,
          customDomainStatus: verified ? 'verified' : 'pending',
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    await adminDb.collection('domains').doc(domain).set({ tenantId });

    return NextResponse.json({
      domain,
      verified,
      status: verified ? 'verified' : 'pending',
      // DNS challenge records the admin must add (if any).
      verification: data?.verification || [],
    });
  } catch (e) {
    console.error('Domain provision error:', e);
    // Vercel and Firestore can end up disagreeing here: the domain may already be
    // attached to the project while the tenant doc and/or the `domains` lookup row
    // never got written, so the custom domain resolves to nothing.
    captureHandledError(e, { step: 'domain-provision', tenantId, ids: { domain } });
    return NextResponse.json({ error: 'Failed to provision domain' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!CUSTOM_DOMAIN_ENABLED) {
    // Gated too, and not for symmetry: this handler also WRITES, mirroring
    // customDomainVerified / customDomainStatus onto the tenant doc below.
    return NextResponse.json({ error: CUSTOM_DOMAIN_HIDDEN_MESSAGE }, { status: 503 });
  }

  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const tenantId = await resolveTenantId(request, authResult);

  // Same gate as POST — GET is separately reachable and also writes to the
  // tenant doc (config.customDomainVerified / customDomainStatus below).
  const planGate = await requireCustomDomainPlan(authResult, tenantId);
  if (planGate) return planGate;

  const { token, projectId, teamId } = vercelConfig();
  if (!token || !projectId) {
    return NextResponse.json(
      { error: 'Domain provisioning is not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID.' },
      { status: 501 }
    );
  }

  const domain = normalizeDomain(request.nextUrl.searchParams.get('domain') || '');
  if (!domain) {
    return NextResponse.json({ error: 'A domain query param is required' }, { status: 400 });
  }

  try {
    const resp = await fetch(
      `${VERCEL_API}/v9/projects/${projectId}/domains/${domain}${teamQuery(teamId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      if (resp.status === 404) {
        return NextResponse.json({ domain, verified: false, status: 'failed' });
      }
      return NextResponse.json({ error: 'Failed to check domain status' }, { status: 502 });
    }
    const data = await resp.json();
    const verified = data?.verified === true;
    const status = verified ? 'verified' : 'pending';

    await adminDb.collection('tenants').doc(tenantId).set(
      {
        config: { customDomainVerified: verified, customDomainStatus: status },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      domain,
      verified,
      status,
      verification: data?.verification || [],
    });
  } catch (e) {
    console.error('Domain status error:', e);
    return NextResponse.json({ error: 'Failed to check domain status' }, { status: 500 });
  }
}
