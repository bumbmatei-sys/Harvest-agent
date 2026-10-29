import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { checkRateLimit, rateLimiters } from '@/lib/rate-limit';
import { isValidSignupHandle, parseSignupAnswers } from '@/lib/signup-pages/model';
import { fromStoredFields, validId } from '@/lib/signup-pages/server';

export async function POST(request: NextRequest) {
  try {
    if (!rateLimiters.signupSubmit) return NextResponse.json({ error: 'Submission temporarily unavailable' }, { status: 503 });
    const limited = await checkRateLimit(request, 'signupSubmit');
    if (limited) return limited;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'answers,handle,website' || !isValidSignupHandle(body.handle) || typeof body.website !== 'string') return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
    if (body.website) return NextResponse.json({ ok: true });
    const reservation = adminDb.collection('signup_handles').doc(body.handle);
    const result = await adminDb.runTransaction(async (tx) => {
      const handle = await tx.get(reservation);
      const pageId = handle.data()?.pageId;
      if (!validId(pageId)) return 'missing';
      const ref = adminDb.collection('signup_pages').doc(pageId);
      const page = (await tx.get(ref)).data();
      if (!page || page.active !== true || page.handle !== body.handle) return 'missing';
      const fields = fromStoredFields(page.fields);
      if (!fields || !validId(page.tenantId)) return 'invalidData';
      const answers = parseSignupAnswers(body.answers, fields);
      if (!answers) return 'invalid';
      tx.create(ref.collection('submissions').doc(), { answers, tenantId: page.tenantId, createdAt: new Date().toISOString() });
      return 'ok';
    });
    if (result !== 'ok') return NextResponse.json({ error: result === 'invalid' ? 'Invalid answers' : result === 'missing' ? 'Page not found' : 'Invalid page data' }, { status: result === 'invalid' ? 400 : result === 'missing' ? 404 : 503 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    return NextResponse.json({ error: 'Could not submit' }, { status: 503 });
  }
}
