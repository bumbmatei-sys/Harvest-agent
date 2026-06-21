import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/migrate-integrations
 * One-time migration: moves flat integrations/{provider} docs to {uid}_{provider} naming.
 * Protected by CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { migrated: 0, skipped: 0, errors: 0 };

  try {
    const tenantsSnap = await adminDb.collection('tenants').get();

    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      const tenantData = tenantDoc.data();
      const integrationsRef = adminDb.collection('tenants').doc(tenantId).collection('integrations');

      for (const provider of ['mailchimp', 'instagram'] as const) {
        try {
          const legacyDoc = await integrationsRef.doc(provider).get();
          if (!legacyDoc.exists || legacyDoc.data()?._migrated) {
            results.skipped++;
            continue;
          }

          const legacyData = legacyDoc.data()!;
          const connectedBy = legacyData.connectedBy as string | undefined;

          if (!connectedBy) {
            results.skipped++;
            continue;
          }

          const newDocId = `${connectedBy}_${provider}`;
          const existingNew = await integrationsRef.doc(newDocId).get();
          if (!existingNew.exists) {
            await integrationsRef.doc(newDocId).set({ ...legacyData, connectedBy });
          }

          const primaryField = provider === 'mailchimp' ? 'primaryMailchimpAdmin' : 'primaryInstagramAdmin';
          if (!tenantData[primaryField]) {
            await adminDb.collection('tenants').doc(tenantId).update({ [primaryField]: connectedBy });
          }

          await legacyDoc.ref.update({ _migrated: true });
          results.migrated++;
        } catch (e) {
          console.error(`Migration error for tenant ${tenantId}/${provider}:`, e);
          results.errors++;
        }
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Migration failed:', error);
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
