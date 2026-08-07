import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { generateAndSavePost, computeNextScheduled } from '../generate/route';
import { captureHandledError } from '@/lib/money-path-sentry';
import { hasFeature, toTenantPlan } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';

// Called daily by Vercel Cron. Checks all tenants with automation enabled
// and due for their next post, then generates.
export async function GET(request: NextRequest) {
  // Verify request is from Vercel Cron (or internal). Reject if the secret is
  // not configured, so an unset CRON_SECRET can't be matched by "Bearer undefined".
  const authHeader = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const results: { tenantId: string; status: string; title?: string }[] = [];

  try {
    // Find all tenants with automation enabled
    // Single-field filter only (no composite index needed)
    const settingsSnap = await adminDb
      .collectionGroup('blogAutomation')
      .where('enabled', '==', true)
      .get();

    for (const settingDoc of settingsSnap.docs) {
      const tenantId = settingDoc.ref.parent.parent?.id;
      if (!tenantId) continue;

      const data = settingDoc.data();
      const nextScheduled: Date | null = data.nextScheduledAt?.toDate?.() || null;

      // Skip if not yet due
      if (nextScheduled && nextScheduled > now) {
        results.push({ tenantId, status: 'skipped — not due yet' });
        continue;
      }

      // Check tenant plan gate
      const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
      const plan = tenantDoc.data()?.plan || 'plus';
      if (!hasFeature(toTenantPlan(plan), 'automatedBlog')) {
        // Disable automation for downgraded tenants
        await settingDoc.ref.set({ enabled: false }, { merge: true });
        results.push({ tenantId, status: 'disabled — plan downgraded' });
        continue;
      }

      try {
        const result = await generateAndSavePost(tenantId, data.topicHint || '');

        // Compute next scheduled time
        const nextDate = computeNextScheduled(
          data.frequency || 'weekly',
          data.dayOfWeek ?? 1,
          data.hour ?? 8,
          data.timezone ?? 'UTC',
        );
        await settingDoc.ref.set(
          { nextScheduledAt: nextDate },
          { merge: true },
        );

        results.push({ tenantId, status: 'generated', title: result.title });
      } catch (genErr: any) {
        // Unattended cron: the `results` array goes back to Vercel Cron and no
        // human reads it. A tenant whose scheduled post keeps failing just stops
        // publishing, and nothing anywhere says so.
        console.error(`Failed to generate post for ${tenantId}:`, genErr?.message);
        captureHandledError(genErr, { step: 'blog-auto-generate-tenant', tenantId });
        results.push({ tenantId, status: `error: ${genErr?.message}` });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (err: any) {
    console.error('Auto-generate cron error:', err?.message);
    // The whole daily run died — every tenant with automation enabled silently
    // skips their post, and only a 500 in a cron log records it.
    captureHandledError(err, { step: 'blog-auto-generate-cron' });
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
