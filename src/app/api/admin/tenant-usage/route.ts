import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getUsageSnapshot } from '@/lib/rag-usage';
import { getSmsUsageSnapshot } from '@/lib/sms-usage';
import { getSmsCredentialSource } from '@/lib/twilio';
import { getPlatformTwilioConfig } from '@/lib/twilio-platform';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/tenant-usage?tenantId=<id>
 *
 * SUPER-ADMIN ONLY. Consumption for ONE named tenant — RAG query/ingest tokens,
 * knowledge-base size, and SMS segments — for the per-tenant detail view in the
 * super-admin Tenants screen.
 *
 * WHY A SEPARATE ROUTE, not a `tenantId` parameter on /api/sms-usage and
 * /api/rag-usage: those two deliberately resolve the tenant from the caller's
 * OWN token and never from the client. The usage subcollection has no client
 * Firestore rule (default-DENY to every client), so those routes are its only
 * read path — adding a client-supplied tenant id to them would turn each into a
 * cross-tenant read path guarded by nothing but its gate, on a route whose gate
 * is `requireAuth` because it is supposed to be self-scoped. This route accepts
 * a tenant id precisely because being cross-tenant is its job, and it is gated
 * accordingly.
 *
 * THE GATE IS requireSuperAdmin, NOT requireAdmin. requireAdmin passes for
 * `isAdmin || isSuperAdmin`, i.e. every church admin — which on a route that
 * reads an arbitrary tenant id means any tenant admin could read every other
 * tenant's consumption. There is no second scoping step here to catch that, so
 * the gate is the whole defence.
 *
 * READ-ONLY. Nothing here writes; the metering counters are owned by the send
 * and ingest paths.
 */

/** Cap the knowledge-base count queries so one enormous tenant can't hang the
 * request. Firestore's count() aggregation reads no documents, so this is a
 * latency bound, not a cost one — and `truncated` tells the UI when it bit. */
const COUNT_LIMIT = 100_000;

async function countFor(collection: string, tenantId: string): Promise<{ count: number; truncated: boolean }> {
  // Single-field equality → served by the automatic index, no composite needed.
  const snap = await adminDb
    .collection(collection)
    .where('tenantId', '==', tenantId)
    .limit(COUNT_LIMIT)
    .count()
    .get();
  const count = snap.data().count;
  return { count, truncated: count >= COUNT_LIMIT };
}

export async function GET(request: NextRequest) {
  const userOrErr = await requireSuperAdmin(request);
  if (userOrErr instanceof Response) return userOrErr;

  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  try {
    const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenant = tenantSnap.data() || {};

    // A tenant with no usage docs is the NORMAL case, not an error: every
    // snapshot reads a missing doc as 0, and the count aggregations return 0 for
    // an empty result set. This renders zeros, never a crash.
    const [rag, sms, credentialSource, sources, chunks] = await Promise.all([
      getUsageSnapshot(tenantId),
      getSmsUsageSnapshot(tenantId),
      getSmsCredentialSource(tenantId),
      countFor('rag_sources', tenantId),
      countFor('rag_chunks', tenantId),
    ]);

    return NextResponse.json({
      tenantId,
      name: tenant.name || tenantId,
      plan: rag.plan,
      month: rag.month,
      rag: {
        queryTokensUsed: rag.queryTokensUsed,
        queryTokensCap: rag.queryTokensCap,
        ingestTokensUsed: rag.ingestTokensUsed,
        ingestTokensCeiling: rag.ingestTokensCeiling,
      },
      knowledgeBase: {
        sources: sources.count,
        sourcesTruncated: sources.truncated,
        chunks: chunks.count,
        chunksTruncated: chunks.truncated,
      },
      // TWO SMS COUNTERS, TWO MEANINGS — never add them together.
      //   platformSegments: segments HARVEST paid for (Harvest's Twilio account).
      //                     This is the only field the plan cap is checked against.
      //   byoSegments:      segments on the TENANT'S OWN Twilio account. Twilio
      //                     bills the church directly; no cap applies, ever.
      // `platformAvailable` is false while Harvest has no Twilio account at all
      // (twilio-platform.ts returns null), which is the situation today: every
      // tenant is BYO and platformSegments is 0 for everyone. The UI must say
      // that rather than draw an empty meter against a cap nobody can consume.
      sms: {
        platformSegments: sms.smsSegmentsUsed,
        platformCap: sms.smsSegmentsCap,
        platformAvailable: getPlatformTwilioConfig() !== null,
        byoSegments: sms.smsSegmentsByoUsed,
        // 'byo' = own credentials on file; 'platform' = falling back to Harvest's
        // account; null = neither, so this tenant cannot send at all.
        credentialSource,
      },
    });
  } catch (e) {
    console.error('admin tenant-usage error:', e);
    return NextResponse.json({ error: 'Failed to load tenant usage.' }, { status: 500 });
  }
}
