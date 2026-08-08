import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  generateAndSavePost,
  computeNextScheduled,
  BlogGenerationError,
} from '../generate/route';
import { captureHandledError } from '@/lib/money-path-sentry';
import { MAX_CONSECUTIVE_FAILURES } from '@/lib/blog-automation';
import { hasFeature, toTenantPlan } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';

/**
 * How long to wait before retrying after a failure.
 *
 * A failure must move the schedule — leaving it in the past is what turns one
 * broken tenant into a retry every time the cron fires. The choice is between
 * the tenant's normal next slot and something shorter; shorter wins, because a
 * weekly tenant losing a whole week's post to one transient hiccup is a worse
 * outcome than retrying the SAME missed post a few hours later.
 */
const RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

/** Keep a stored error message short — it is surfaced in the admin UI. */
const MAX_STORED_ERROR_CHARS = 300;

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

      // The tenant's normal next slot. Computed up front because BOTH paths need
      // it: success advances to it, and a failure's retry is clamped by it.
      const nextDate = computeNextScheduled(
        data.frequency || 'weekly',
        data.dayOfWeek ?? 1,
        data.hour ?? 8,
        data.timezone ?? 'UTC',
      );

      try {
        const result = await generateAndSavePost(tenantId, data.topicHint || '');

        // Advance to the next slot AND clear the failure state. Without the
        // reset a tenant accumulates failures across unrelated blips months
        // apart and eventually trips the cap despite publishing fine all along.
        await settingDoc.ref.set(
          {
            nextScheduledAt: nextDate,
            consecutiveFailures: 0,
            lastFailureAt: FieldValue.delete(),
            lastFailureMessage: FieldValue.delete(),
            automationDisabledAt: FieldValue.delete(),
            automationDisabledReason: FieldValue.delete(),
          },
          { merge: true },
        );

        results.push({ tenantId, status: 'generated', title: result.title });
      } catch (genErr: any) {
        // Unattended cron: the `results` array goes back to Vercel Cron and no
        // human reads it. The schedule must therefore be advanced HERE as well
        // as on success — a tenant left with a `nextScheduledAt` in the past is
        // permanently due, so it is not that they quietly stop publishing, it is
        // that they never stop *trying*: every cron run re-runs the same failing
        // generation, at real token cost, until something outside changes.
        console.error(`Failed to generate post for ${tenantId}:`, genErr?.message);
        captureHandledError(genErr, {
          step: 'blog-auto-generate-tenant',
          tenantId,
          diagnostics:
            genErr instanceof BlogGenerationError ? genErr.diagnostics : undefined,
        });

        const failures = (typeof data.consecutiveFailures === 'number'
          ? data.consecutiveFailures
          : 0) + 1;
        const reason = String(genErr?.message || 'Unknown error').slice(
          0,
          MAX_STORED_ERROR_CHARS,
        );

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          // Give up — but never silently. The reason is written to the settings
          // doc, which AdminBlog reads, so the tenant can see that automation
          // stopped and why. Clearing nextScheduledAt matches how the settings
          // endpoint disables, so a stale timestamp can't fire on re-enable.
          await settingDoc.ref.set(
            {
              enabled: false,
              nextScheduledAt: FieldValue.delete(),
              consecutiveFailures: failures,
              lastFailureAt: FieldValue.serverTimestamp(),
              lastFailureMessage: reason,
              automationDisabledAt: FieldValue.serverTimestamp(),
              automationDisabledReason: `Automatic posting was turned off after ${failures} failed attempts in a row. Last error: ${reason}`,
            },
            { merge: true },
          );
          results.push({
            tenantId,
            status: `disabled — ${failures} consecutive failures: ${reason}`,
          });
          continue;
        }

        // Retry sooner than the normal cadence, but never LATER than it: a
        // tenant's own next slot always wins, so moving the schedule on failure
        // cannot skip a post that was legitimately due before the retry.
        const retryAt = new Date(
          Math.min(now.getTime() + RETRY_DELAY_MS, nextDate.getTime()),
        );
        await settingDoc.ref.set(
          {
            nextScheduledAt: retryAt,
            consecutiveFailures: failures,
            lastFailureAt: FieldValue.serverTimestamp(),
            lastFailureMessage: reason,
          },
          { merge: true },
        );

        results.push({
          tenantId,
          status: `error (attempt ${failures}/${MAX_CONSECUTIVE_FAILURES}, retrying ${retryAt.toISOString()}): ${reason}`,
        });
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
