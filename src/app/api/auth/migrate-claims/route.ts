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
    const superAdminEmails = ['bumbmatei@proton.me', 'bumbmatei@zohomail.eu'];
    const envEmails = process.env.SUPER_ADMIN_EMAILS;
    if (envEmails) {
      for (const e of envEmails.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (!superAdminEmails.includes(e)) superAdminEmails.push(e);
      }
    }
    if (!decodedToken.superAdmin && !superAdminEmails.includes((decodedToken.email || '').toLowerCase())) {
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
    return NextResponse.json({ error: 'Failed to migrate claims' }, { status: 500 });
  }
}
