import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireStorefrontEditor } from '@/lib/storefront/access';
import { currentHandle } from '@/lib/storefront/handle-server';
import { captureHandledError } from '@/lib/money-path-sentry';
import { isTenantIdParam, loadCommunities } from '@/lib/community/communities-server';
import { readStorefront } from '@/lib/storefront/storefront';
import { loadStorefront, loadStorefrontArticles, loadStorefrontEvents, saveStorefront } from '@/lib/storefront/server';

export const dynamic = 'force-dynamic';

const titleOf = (data: Record<string, unknown>, fallback: string) =>
  (typeof data.title === 'string' && data.title) || (typeof data.name === 'string' && data.name) || fallback;

/** The storefront and what its picker blocks can point at: communities, courses and forms. */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!isTenantIdParam(tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  try {
    const admin = await requireStorefrontEditor(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    const tenant = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenant.exists) return NextResponse.json({ error: 'Ministry not found.' }, { status: 404 });
    const name = typeof tenant.data()?.name === 'string' ? tenant.data()!.name as string : '';
    const [storefront, communities, courses, forms, articles, events] = await Promise.all([
      loadStorefront(tenantId, name),
      loadCommunities(tenantId),
      adminDb.collection('courses').where('tenantId', '==', tenantId).limit(200).get(),
      adminDb.collection('tenants').doc(tenantId).collection('forms').limit(200).get(),
      // For the live preview only: what the Blog and Events blocks would show today.
      loadStorefrontArticles(tenantId).then((list) => list.slice(0, 3)),
      loadStorefrontEvents(tenantId, 6),
    ]);
    return NextResponse.json({
      storefront,
      subdomain: tenantId,
      handle: currentHandle(tenantId, tenant.data()),
      articles,
      events,
      choices: {
        community: (communities?.communities ?? []).filter((c) => c.status === 'published').map((c) => ({ id: c.id, title: c.name })),
        course: courses.docs.filter((d) => d.data().status === 'published').map((d) => ({ id: d.id, title: titleOf(d.data(), 'Course') })),
        form: forms.docs.filter((d) => d.data().active !== false).map((d) => ({ id: d.id, title: titleOf(d.data(), 'Form') })),
      },
    });
  } catch (error) {
    captureHandledError(error, { step: 'storefront-load', tenantId });
    return NextResponse.json({ error: 'Could not load your Storefront. Please try again.' }, { status: 503 });
  }
}

/** Saves the whole storefront, read back through the same reader the public page uses. */
export async function PUT(request: NextRequest) {
  let body: { tenantId?: unknown; storefront?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const tenantId = body?.tenantId;
  if (!isTenantIdParam(tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  try {
    const admin = await requireStorefrontEditor(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    const storefront = readStorefront(body.storefront);
    await saveStorefront(tenantId, storefront, admin.uid);
    return NextResponse.json({ storefront });
  } catch (error) {
    captureHandledError(error, { step: 'storefront-save', tenantId });
    return NextResponse.json({ error: 'Could not save your Storefront. Please try again.' }, { status: 503 });
  }
}
