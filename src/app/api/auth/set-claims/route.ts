import { NextRequest, NextResponse } from 'next/server';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { adminAuth } from '@/lib/firebase-admin';

/**
 * POST /api/auth/set-claims
 * Sets custom claims on a user's Firebase Auth token.
 * Called after user registration or role change.
 * 
 * Body: { uid: string }
 * Auth: Bearer token required (the user themselves or a super admin)
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const { uid } = await request.json();

    // Users can only set their own claims, unless they're a super admin
    if (decodedToken.uid !== uid && !decodedToken.superAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await setCustomClaims(uid);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('set-claims error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
