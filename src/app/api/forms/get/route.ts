import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * Public (no-auth) fetch of an active custom form's configuration so the public
 * form page at /form/{formId} can render it. Returns 404 for missing or
 * inactive forms. Only non-sensitive form config is returned.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const formId = searchParams.get('formId');

  if (!tenantId || !formId) {
    return NextResponse.json({ error: 'tenantId and formId are required' }, { status: 400 });
  }

  try {
    const snap = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('forms').doc(formId)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.active === false) {
      return NextResponse.json({ error: 'This form is no longer accepting responses.' }, { status: 410 });
    }

    return NextResponse.json({
      id: snap.id,
      title: data.title || 'Form',
      description: data.description || '',
      successMessage: data.successMessage || "Thank you! We'll be in touch.",
      fields: Array.isArray(data.fields) ? data.fields : [],
    });
  } catch (e) {
    console.error('Form get error:', e);
    return NextResponse.json({ error: 'Failed to load form' }, { status: 500 });
  }
}
