import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { authorizeForms } from '@/lib/form-follow-up/authorize';
import { MAX_FORM_BYTES, validFormContent } from '@/lib/form-follow-up/form-input';
import { adminDb } from '@/lib/firebase-admin';
import { validId } from '@/lib/signup-pages/server';
import { parseFollowUp } from '@/lib/form-follow-up/model';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_FORM_BYTES) return NextResponse.json({ error: 'Form is too large (maximum 256 KiB).' }, { status: 413 });
    const body = JSON.parse(raw);
    if (!body || !validId(body.tenantId) || (body.formId !== null && !validId(body.formId)) ||
        !validFormContent(body)) return NextResponse.json({ error: 'Invalid form. Use at most 200 title characters, 10,000 description characters, 100 fields, 100 options per field, and 500 characters per field label, placeholder, option or scale label.' }, { status: 400 });
    const user = await authorizeForms(request, body.tenantId);
    if (user instanceof NextResponse) return user;
    await validateFollowUp(body.tenantId, body.followUp);
    const forms = adminDb.collection('tenants').doc(body.tenantId).collection('forms');
    const ref = body.formId ? forms.doc(body.formId) : forms.doc();
    const payload = { title: body.title.trim(), description: body.description, fields: body.fields, followUp: parseFollowUp(body.followUp), updatedAt: FieldValue.serverTimestamp() };
    if (body.formId) {
      if (!(await ref.get()).exists) return NextResponse.json({ error: 'Form not found' }, { status: 404 });
      await ref.update(payload);
    } else await ref.create({ ...payload, active: true, submissionCount: 0, createdAt: FieldValue.serverTimestamp(), createdBy: user.uid });
    return NextResponse.json({ id: ref.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InvalidFollowUp ? error.message : 'Could not save form. Please retry.' }, { status: error instanceof InvalidFollowUp || error instanceof SyntaxError ? 400 : 503 });
  }
}
