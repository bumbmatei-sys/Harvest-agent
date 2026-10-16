import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSocialAccess } from '@/lib/social/access';
import { parseSocialDraft } from '@/lib/social/draft';
import { cancelSocialPost, updateSocialPost } from '@/lib/social/session';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } },
) {
  const access = await requireSocialAccess(request);
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => null);
  const parsed = parseSocialDraft(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const post = await updateSocialPost(access.tenantId, context.params.id, parsed.draft);
  if (!post) {
    return NextResponse.json({ error: 'post_not_editable' }, { status: 404 });
  }
  return NextResponse.json({ post, sample: access.sample });
}

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } },
) {
  const access = await requireSocialAccess(request);
  if (access instanceof NextResponse) return access;
  const removed = await cancelSocialPost(access.tenantId, context.params.id);
  if (!removed) {
    return NextResponse.json({ error: 'post_not_editable' }, { status: 404 });
  }
  return NextResponse.json({ cancelled: true, sample: access.sample });
}
