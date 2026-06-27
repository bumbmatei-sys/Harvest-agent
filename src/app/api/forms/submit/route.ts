import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * Public (no-auth) custom form submission endpoint.
 *
 * Writes the submission to tenants/{tenantId}/forms/{formId}/submissions and runs
 * the CRM auto-match pipeline:
 *   1. email matches an existing contact → log an activity on that contact
 *   2. no match but name + email present → create a Member contact + activity
 *   3. no name/email → store the submission only
 *
 * All writes use the admin SDK, so this stays secure without opening Firestore
 * rules to anonymous writes.
 */

interface FormField {
  id: string;
  type: string;
  label?: string;
}

function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || '';
}

/** Find an answer whose field type matches, or whose label hints at the role. */
function findByType(fields: FormField[], answers: Record<string, any>, type: string, labelHints: string[]): string {
  const byType = fields.find((f) => f.type === type);
  if (byType && answers[byType.id]) return String(answers[byType.id]).trim();
  const byLabel = fields.find((f) => labelHints.some((h) => (f.label || '').toLowerCase().includes(h)));
  if (byLabel && answers[byLabel.id]) return String(answers[byLabel.id]).trim();
  return '';
}

function answersToText(fields: FormField[], answers: Record<string, any>): string {
  return fields
    .map((f) => {
      const v = answers[f.id];
      if (v === undefined || v === null || v === '') return null;
      return `${f.label || f.id}: ${Array.isArray(v) ? v.join(', ') : v}`;
    })
    .filter(Boolean)
    .join('\n');
}

export async function POST(request: NextRequest) {
  let body: { tenantId?: string; formId?: string; answers?: Record<string, any> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, formId, answers } = body;
  if (!tenantId || !formId || !answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'tenantId, formId and answers are required' }, { status: 400 });
  }

  try {
    const formRef = adminDb.collection('tenants').doc(tenantId).collection('forms').doc(formId);
    const formSnap = await formRef.get();
    if (!formSnap.exists) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }
    const formData = formSnap.data()!;
    if (formData.active === false) {
      return NextResponse.json({ error: 'This form is no longer accepting responses.' }, { status: 410 });
    }
    const fields: FormField[] = Array.isArray(formData.fields) ? formData.fields : [];
    const formName: string = formData.title || 'Form';

    const email = findByType(fields, answers, 'email', ['email']).toLowerCase();
    const fullName = findByType(fields, answers, 'name', ['name', 'full name']);
    const summary = answersToText(fields, answers);

    let crmContactId: string | null = null;

    if (email) {
      // Auto-match: query by single field, filter tenant client-side (no compound query).
      const matchSnap = await adminDb.collection('contacts').where('email', '==', email).limit(20).get();
      const match = matchSnap.docs.find((d) => (d.data().tenantId || null) === tenantId);

      if (match) {
        crmContactId = match.id;
        await adminDb.collection('contactActivities').add({
          contactId: match.id,
          tenantId,
          type: 'note',
          description: `Form submission: ${formName}\n${summary}`,
          amount: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'form',
        });
      } else if (fullName) {
        // Create a new Member contact from name + email.
        const [firstName, ...rest] = fullName.split(' ');
        const ref = await adminDb.collection('contacts').add({
          firstName: firstName || fullName,
          lastName: rest.join(' '),
          email,
          phone: findByType(fields, answers, 'phone', ['phone', 'mobile', 'tel']),
          type: 'member',
          notes: `Created from form: ${formName}`,
          tags: ['form'],
          totalDonated: 0,
          lastDonationAt: null,
          memberSince: FieldValue.serverTimestamp(),
          tenantId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'form',
        });
        crmContactId = ref.id;
        await adminDb.collection('contactActivities').add({
          contactId: ref.id,
          tenantId,
          type: 'note',
          description: `Form submission: ${formName}\n${summary}`,
          amount: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'form',
        });
      }
    }

    await formRef.collection('submissions').add({
      answers,
      submittedAt: FieldValue.serverTimestamp(),
      crmContactId,
      ipAddress: getClientIp(request),
    });

    await formRef.set({ submissionCount: FieldValue.increment(1) }, { merge: true });

    return NextResponse.json({ success: true, crmContactId });
  } catch (e) {
    console.error('Form submit error:', e);
    return NextResponse.json({ error: 'Failed to submit form' }, { status: 500 });
  }
}
