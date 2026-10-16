import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSocialAccess } from '@/lib/social/access';
import { isIdempotencyKey, parseSocialDraft } from '@/lib/social/draft';
import { createSocialPost } from '@/lib/social/session';

export const dynamic = 'force-dynamic';

function mutationStatus(error: 'account_not_owned' | 'social_unavailable' | 'post_not_editable'): number {
  if (error === 'account_not_owned') return 403;
  if (error === 'post_not_editable') return 404;
  return 503;
}

/** Schedule, save a draft, or publish. The allow-list runs before any provider call. */
export async function POST(request: NextRequest) {
  const access = await requireSocialAccess(request);
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => null);
  const parsed = parseSocialDraft(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const headerKey = request.headers.get('idempotency-key');
  if (parsed.draft.publishNow && !isIdempotencyKey(headerKey)) {
    return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400 });
  }
  const draft = {
    ...parsed.draft,
    idempotencyKey: parsed.draft.publishNow ? headerKey : null,
  };
  const result = await createSocialPost(access.tenantId, draft, access.mockOnly);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: mutationStatus(result.error) });
  }
  return NextResponse.json({ post: result.post, sample: access.sample });
}
