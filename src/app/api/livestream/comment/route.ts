import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Live comments are short chat lines, not prayer requests — cap tighter than the
// 2000-char prayer body (community_posts comments cap at 280; a live chat line
// sits in the same ballpark).
const MAX_COMMENT_LENGTH = 500;

/**
 * Post a live comment during a stream. Mirrors /api/livestream/pray exactly:
 * requireAuth → verify the tenant's `livestream/current` is active with a
 * sessionId → write to the active session's `comments` subcollection via the
 * admin SDK → increment `commentCount` on both the session and `current`.
 *
 * Members NEVER write this subcollection from the client (the read rule allows
 * member reads only; writes stay admin/permission-gated). Routing the write
 * through this authed route is what keeps the rules surface small. Any
 * authenticated viewer may post; the global middleware rate-limits /api/* per IP.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  let body: { tenantId?: string; name?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId } = body;
  const name = (body.name || 'Anonymous').trim().slice(0, 120);
  const text = (body.text || '').trim();
  if (!tenantId || !text) {
    return NextResponse.json({ error: 'tenantId and text are required' }, { status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json({ error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.` }, { status: 400 });
  }

  try {
    const currentRef = adminDb.collection('tenants').doc(tenantId).collection('livestream').doc('current');
    const current = await currentRef.get();
    const sessionId = current.data()?.sessionId;
    if (!current.exists || current.data()?.active !== true || !sessionId) {
      return NextResponse.json({ error: 'No live stream is active.' }, { status: 410 });
    }

    const sessionRef = adminDb.collection('tenants').doc(tenantId).collection('livestreamSessions').doc(sessionId);
    await sessionRef.collection('comments').add({
      name,
      text,
      authorId: authResult.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await sessionRef.set({ commentCount: FieldValue.increment(1) }, { merge: true });
    await currentRef.set({ commentCount: FieldValue.increment(1) }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Comment submit error:', e);
    return NextResponse.json({ error: 'Failed to submit comment' }, { status: 500 });
  }
}
