import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getReceiptsBucket } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const userOrErr = await requireAdmin(request);
  if (userOrErr instanceof NextResponse) return userOrErr;

  const { path } = await request.json().catch(() => ({ path: '' }));
  if (!path || typeof path !== 'string' || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Files live under tenants/{tid}/... or receipts/{tid}/... — pull the owning tenant
  // out of the path and confirm this admin owns it.
  const m = path.match(/^(?:tenants|receipts)\/([^/]+)\//);
  if (!m) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  const pathTenantId = m[1];
  if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== pathTenantId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    // Same admin storage bucket the Cloud Functions write to (functions getBucket()).
    const bucket = getReceiptsBucket();
    const [url] = await bucket.file(path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });
    return NextResponse.json({ url });
  } catch (e: any) {
    console.error('signed-url error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 });
  }
}
