import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/community/comments/delete
 * Admin-moderation delete for another member's comment on a community post.
 * firestore.rules scopes comments/{commentId} delete to the comment's own
 * author only (community_posts/{postId} itself allows authorId == uid OR
 * hasPermission('createPosts', tenantId), but the comment subrule has no such
 * admin branch), so cross-author moderation goes through the Admin SDK here
 * instead of loosening that rule. Gated on the same 'createPosts' permission
 * the post-level delete rule uses.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const postId = body?.postId;
    const commentId = body?.commentId;
    if (typeof postId !== 'string' || !postId || typeof commentId !== 'string' || !commentId) {
      return NextResponse.json({ error: 'postId and commentId are required' }, { status: 400 });
    }

    const postRef = adminDb.collection('community_posts').doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    const tenantId = postSnap.data()?.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Post has no tenant' }, { status: 400 });
    }

    const userOrResponse = await requireTenantPermission(request, tenantId, 'createPosts');
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const commentRef = postRef.collection('comments').doc(commentId);
    const commentSnap = await commentRef.get();
    if (!commentSnap.exists) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    await commentRef.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin comment delete error:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
