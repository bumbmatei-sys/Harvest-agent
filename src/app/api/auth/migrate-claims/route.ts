import { NextRequest, NextResponse } from 'next/server';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

/**
 * POST /api/auth/migrate-claims
 * One-time migration: sets custom claims for ALL existing users.
 * Only callable by super admin.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);

    // Allow super admin claim OR matching super admin email (for bootstrapping)
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || 'bumbmatei@gmail.com';
    if (!decodedToken.superAdmin && decodedToken.email !== superAdminEmail) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    // Fetch all users from Firestore
    const usersSnap = await adminDb.collection('users').get();
    let success = 0;
    let failed = 0;

    for (const userDoc of usersSnap.docs) {
      try {
        await setCustomClaims(userDoc.id);
        success++;
      } catch (err) {
        console.error(`Failed for ${userDoc.id}:`, err);
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      total: usersSnap.size,
      migrated: success,
      failed,
    });
  } catch (error: any) {
    console.error('migrate-claims error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
