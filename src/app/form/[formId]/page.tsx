import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicForm, { type PublicFormField } from '@/components/PublicForm';

export const dynamic = 'force-dynamic';

interface FormDoc {
  title?: string;
  description?: string;
  successMessage?: string;
  active?: boolean;
  fields?: PublicFormField[];
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);

  if (!tenant) {
    notFound();
  }

  // Lazy import to keep adminDb server-only.
  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb
    .collection('tenants').doc(tenant.id)
    .collection('forms').doc(formId)
    .get();

  if (!snap.exists) {
    notFound();
  }
  const data = snap.data() as FormDoc;
  if (data.active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <h1 className="text-lg font-bold text-gray-900 mb-2">{tenant.name}</h1>
          <p className="text-gray-600">This form is no longer accepting responses.</p>
        </div>
      </div>
    );
  }

  const branding = (tenant as any).config || {};

  return (
    <PublicForm
      tenantId={tenant.id}
      tenantName={tenant.name}
      logo={branding.logo || null}
      primaryColor={branding.primaryColor || '#B8962E'}
      formId={formId}
      title={data.title || 'Form'}
      description={data.description || ''}
      successMessage={data.successMessage || "Thank you! We'll be in touch."}
      fields={Array.isArray(data.fields) ? data.fields : []}
    />
  );
}
