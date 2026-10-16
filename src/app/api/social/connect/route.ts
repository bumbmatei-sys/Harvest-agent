import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSocialAccess } from '@/lib/social/access';
import { parseConnectPlatform } from '@/lib/social/draft';
import { connectSocialAccount } from '@/lib/social/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const access = await requireSocialAccess(request);
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => null);
  const platform = parseConnectPlatform(body);
  if (!platform) {
    return NextResponse.json({ error: 'platform_not_offered' }, { status: 400 });
  }
  const result = await connectSocialAccount(access.tenantId, platform);
  if (!result.ok) {
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }
  return NextResponse.json({
    platform,
    authUrl: result.authUrl,
    sample: result.sample,
  });
}
