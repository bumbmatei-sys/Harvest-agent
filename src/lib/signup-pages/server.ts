import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { SIGNUP_FIELDS, isValidSignupFieldSettings, type SignupFieldSettings } from './model';

export function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 150 && !id.includes('/');
}

export function toStoredFields(fields: SignupFieldSettings) {
  return SIGNUP_FIELDS.map((key) => ({ key, ...fields[key] }));
}

export function fromStoredFields(value: unknown): SignupFieldSettings | null {
  if (!Array.isArray(value) || value.length !== SIGNUP_FIELDS.length) return null;
  const map: Record<string, unknown> = {};
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !SIGNUP_FIELDS.includes(entry.key) || map[entry.key] ||
        Object.keys(entry).sort().join(',') !== 'enabled,key,required') return null;
    map[entry.key] = { enabled: entry.enabled, required: entry.required };
  }
  return isValidSignupFieldSettings(map) ? map : null;
}

export async function authorizePage(request: NextRequest, pageId: string) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  if (!validId(pageId)) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
  const ref = adminDb.collection('signup_pages').doc(pageId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  const page = snapshot.data()!;
  if (!validId(page.tenantId)) return NextResponse.json({ error: 'Invalid page data' }, { status: 503 });
  const [currentUser, tenant] = await Promise.all([
    adminDb.collection('users').doc(user.uid).get(),
    adminDb.collection('tenants').doc(page.tenantId).get(),
  ]);
  if (!user.isSuperAdmin && (!currentUser.exists || currentUser.data()?.tenantId !== page.tenantId)) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }
  if (!tenant.exists || tenant.data()?.ownerId !== user.uid) {
    const permitted = await requireTenantPermission(request, page.tenantId, 'manageForms');
    if (permitted instanceof NextResponse) return permitted;
  }
  return { ref, page, user };
}

/** Resolve a public handle without exposing owner or submission data. Throws on read or data failures. */
export async function getPublicSignupPage(handle: string) {
  const { isValidSignupHandle } = await import('./model');
  if (!isValidSignupHandle(handle)) return null;
  const reservation = await adminDb.collection('signup_handles').doc(handle).get();
  if (!reservation.exists) return null;
  const id = reservation.data()?.pageId;
  if (!validId(id)) throw new Error('Invalid signup handle data');
  const page = (await adminDb.collection('signup_pages').doc(id).get()).data();
  if (!page || page.active !== true || page.handle !== handle) return null;
  const fields = fromStoredFields(page.fields);
  if (!fields || typeof page.title !== 'string' || typeof page.message !== 'string') throw new Error('Invalid signup page data');
  return { title: page.title, message: page.message, fields };
}
