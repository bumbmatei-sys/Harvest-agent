import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { isValidSignupHandle } from '@/lib/signup-pages/model';
import { fromStoredFields, toStoredFields, validId } from '@/lib/signup-pages/server';

export async function GET(_request: Request, { params }: { params: { handle: string } }) {
  if (!isValidSignupHandle(params.handle)) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  try {
    const reservation = await adminDb.collection('signup_handles').doc(params.handle).get();
    const id = reservation.data()?.pageId;
    if (!validId(id)) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    const page = (await adminDb.collection('signup_pages').doc(id).get()).data();
    if (!page || page.active !== true || page.handle !== params.handle) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    const fields = fromStoredFields(page.fields);
    if (!fields || typeof page.title !== 'string' || typeof page.message !== 'string') return NextResponse.json({ error: 'Invalid page data' }, { status: 503 });
    return NextResponse.json({ title: page.title, message: page.message, fields: toStoredFields(fields).filter((field) => field.enabled) });
  } catch { return NextResponse.json({ error: 'Could not load page' }, { status: 503 }); }
}
