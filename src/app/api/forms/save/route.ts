import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { validId } from '@/lib/signup-pages/server';
import { parseFollowUp } from '@/lib/form-follow-up/model';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || !validId(body.tenantId) || (body.formId !== null && !validId(body.formId)) ||
        typeof body.title !== 'string' || !body.title.trim() || typeof body.description !== 'string' || !Array.isArray(body.fields)) return NextResponse.json({ error: 'Invalid form' }, { status: 400 });
    const user = await requireTenantPermission(request, body.tenantId, 'manageForms');
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
