import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { isValidSignupHandle } from '@/lib/signup-pages/model';
import { validId } from '@/lib/signup-pages/server';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    let tenantId = params.get('tenantId');
    let page;
    const handle = params.get('handle');
    if (handle !== null) {
      if (!isValidSignupHandle(handle)) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
      const reservation = await adminDb.collection('signup_handles').doc(handle).get();
      const pageId = reservation.data()?.pageId;
      if (!validId(pageId)) return NextResponse.json({ error: 'Page unavailable' }, { status: 404 });
      page = (await adminDb.collection('signup_pages').doc(pageId).get()).data();
      if (page?.handle !== handle) return NextResponse.json({ error: 'Page unavailable' }, { status: 404 });
      tenantId = page.tenantId;
    } else {
      const formId = params.get('formId');
      if (!validId(tenantId) || !validId(formId)) return NextResponse.json({ error: 'Invalid form' }, { status: 400 });
      page = (await adminDb.collection('tenants').doc(tenantId).collection('forms').doc(formId).get()).data();
    }
    if (!page || page.active === false || !validId(tenantId)) return NextResponse.json({ error: 'Page unavailable' }, { status: 404 });
    const item = await validateFollowUp(tenantId, page.followUp);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InvalidFollowUp ? 'The suggested item is no longer available.' : 'Could not load the suggested item. Please retry.' }, { status: error instanceof InvalidFollowUp ? 410 : 503 });
  }
}
