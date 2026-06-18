import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/composio/mailchimp/audiences
 * Fetches available Mailchimp audiences/lists for the connected account
 * Supports ?selectedId=... to update the selected audience
 */
export async function GET(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with this user' },
        { status: 400 }
      );
    }

    const integrationDoc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('mailchimp')
      .get();

    // Fix 7: Null guard on Firestore data()
    if (!integrationDoc.exists) {
      return NextResponse.json(
        { error: 'Mailchimp is not connected' },
        { status: 400 }
      );
    }

    const data = integrationDoc.data();
    if (!data || data.status !== 'active') {
      return NextResponse.json(
        { error: 'Mailchimp is not connected' },
        { status: 400 }
      );
    }

    const connectedAccountId = data.connectedAccountId;

    if (!connectedAccountId) {
      return NextResponse.json(
        { error: 'No connected account found' },
        { status: 400 }
      );
    }

    // Fetch fresh audiences from Mailchimp via Composio
    let audiences: Array<{ id: string; name: string; memberCount: number }> = [];

    try {
      const audienceResult = await executeComposioAction(
        'MAILCHIMP_GET_LISTS',
        { count: 100 },
        connectedAccountId
      );
      const lists = audienceResult?.data?.lists || audienceResult?.lists || [];
      audiences = lists.map((list: any) => ({
        id: list.id,
        name: list.name,
        memberCount: list.stats?.member_count || 0,
      }));
    } catch (actionError) {
      // Fix 8: Don't leak error details; log server-side only
      console.error('Could not fetch Mailchimp audiences:', actionError);
      return NextResponse.json(
        { error: 'Failed to fetch audiences from Mailchimp' },
        { status: 502 }
      );
    }

    // Check if a selection was requested
    const { searchParams } = new URL(request.url);
    const selectedId = searchParams.get('selectedId');

    if (selectedId) {
      // Validate the selected audience exists
      const validAudience = audiences.find((a) => a.id === selectedId);
      if (!validAudience) {
        return NextResponse.json(
          { error: 'Selected audience ID not found in your Mailchimp lists' },
          { status: 400 }
        );
      }

      // Update the stored audiences and selection
      await integrationDoc.ref.update({
        audiences,
        selectedAudienceId: selectedId,
        updatedAt: new Date().toISOString(),
      });

      return NextResponse.json({
        audiences,
        selectedAudienceId: selectedId,
      });
    }

    // Update stored audiences (no selection change)
    await integrationDoc.ref.update({
      audiences,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      audiences,
      selectedAudienceId: data.selectedAudienceId || null,
    });
  } catch (error) {
    // Fix 8: Don't leak error details; log server-side only
    console.error('Mailchimp audiences error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
