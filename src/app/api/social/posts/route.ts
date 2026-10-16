import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSocialAccess } from '@/lib/social/access';
import { parseSocialDraft } from '@/lib/social/draft';
import { createSocialPost } from '@/lib/social/session';

export const dynamic = 'force-dynamic';

/** Schedule, save a draft, or publish. The allow-list runs before any provider call. */
export async function POST(request: NextRequest) {
  const access = await requireSocialAccess(request);
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => null);
  const parsed = parseSocialDraft(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const post = await createSocialPost(access.tenantId, parsed.draft);
  if (!post) {
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }
  return NextResponse.json({ post, sample: access.sample });
}
