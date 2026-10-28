import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { parseSignupPageInput } from '@/lib/signup-pages/model';
import { authorizePage, toStoredFields, validId } from '@/lib/signup-pages/server';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (user instanceof NextResponse) return user;
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (tenantId !== null && !validId(tenantId)) return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 });
    if (tenantId !== null) {
      const permitted = await requireTenantPermission(request, tenantId, 'manageForms');
      if (permitted instanceof NextResponse) return permitted;
    }
    const pages = await adminDb.collection('signup_pages').where(tenantId !== null ? 'tenantId' : 'ownerUid', '==', tenantId !== null ? tenantId : user.uid).get();
    return NextResponse.json({ pages: pages.docs.map((doc) => ({ ...doc.data(), id: doc.id })) });
  } catch { return NextResponse.json({ error: 'Could not load pages' }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (user instanceof NextResponse) return user;
    if (!validId(user.tenantId)) return NextResponse.json({ error: 'Tenant required' }, { status: 403 });
    const permitted = await requireTenantPermission(request, user.tenantId, 'manageForms');
    if (permitted instanceof NextResponse) return permitted;
    const input = parseSignupPageInput(await request.json());
    if (!input) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
    const ref = adminDb.collection('signup_pages').doc();
    const reservation = adminDb.collection('signup_handles').doc(input.handle);
    const now = new Date().toISOString();
    const created = await adminDb.runTransaction(async (tx) => {
      if ((await tx.get(reservation)).exists) return false;
      tx.create(reservation, { pageId: ref.id, tenantId: user.tenantId, ownerUid: user.uid });
      tx.create(ref, { ...input, fields: toStoredFields(input.fields), tenantId: user.tenantId, ownerUid: user.uid, active: true, createdAt: now, updatedAt: now });
      return true;
    });
    if (!created) return NextResponse.json({ error: 'Handle already in use' }, { status: 409 });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    return NextResponse.json({ error: 'Could not create page' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'active,fields,handle,message,pageId,title' || typeof body.active !== 'boolean' || !validId(body.pageId)) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
    const { pageId, active, ...data } = body;
    const input = parseSignupPageInput(data);
    if (!input) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
    const access = await authorizePage(request, pageId);
    if (access instanceof NextResponse) return access;
    const result = await adminDb.runTransaction(async (tx) => {
      const current = await tx.get(access.ref);
      if (!current.exists) return 'missing';
      const page = current.data()!;
      // Recheck authorization-relevant data inside the transaction.
      if (page.ownerUid !== access.page.ownerUid || page.tenantId !== access.page.tenantId) return 'changed';
      const newRef = adminDb.collection('signup_handles').doc(input.handle);
      const oldRef = adminDb.collection('signup_handles').doc(page.handle);
      if (input.handle !== page.handle) {
        const [next, old] = await Promise.all([tx.get(newRef), tx.get(oldRef)]);
        if (next.exists) return 'taken';
        if (!old.exists || old.data()?.pageId !== pageId) return 'changed';
        tx.create(newRef, { pageId, tenantId: page.tenantId, ownerUid: page.ownerUid });
        tx.delete(oldRef);
      }
      tx.update(access.ref, { ...input, fields: toStoredFields(input.fields), active, updatedAt: new Date().toISOString() });
      return 'ok';
    });
    if (result !== 'ok') return NextResponse.json({ error: result === 'taken' ? 'Handle already in use' : 'Page changed or missing' }, { status: result === 'missing' ? 404 : 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    return NextResponse.json({ error: 'Could not update page' }, { status: 503 });
  }
}
