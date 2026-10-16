import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSocialAccess } from '@/lib/social/access';
import { loadSocialWorkspace } from '@/lib/social/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const access = await requireSocialAccess(request);
  if (access instanceof NextResponse) return access;
  const workspace = await loadSocialWorkspace(access.tenantId);
  if (!workspace) {
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }
  return NextResponse.json({
    entitled: access.entitled,
    sample: access.sample,
    timezone: workspace.timezone,
    accounts: workspace.accounts,
    posts: workspace.posts,
  });
}
