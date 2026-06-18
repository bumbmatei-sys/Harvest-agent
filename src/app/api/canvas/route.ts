import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

/**
 * GET /api/canvas
 * List all canvases for the authenticated user's tenant.
 * Returns canvas metadata (without elements for performance).
 */
export async function GET(request: NextRequest) {
  try {
    const userOrResponse = await requireAuth(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with this user' },
        { status: 400 }
      );
    }

    const canvasesSnapshot = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('canvases')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const canvases = canvasesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || 'Untitled',
        createdBy: data.createdBy || '',
        createdByName: data.createdByName || 'Unknown',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    return NextResponse.json({ canvases });
  } catch (error) {
    console.error('Canvas list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch canvases' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/canvas
 * Create a new canvas for the authenticated user's tenant.
 */
export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAuth(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId, uid, email } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with this user' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Canvas name is required' },
        { status: 400 }
      );
    }

    // Fix 4: Canvas name length limit
    if (name.trim().length > 100) {
      return NextResponse.json(
        { error: 'Canvas name must be 100 characters or less' },
        { status: 400 }
      );
    }

    // Fix 9: Canvas name sanitization
    if (!/^[\w\s\-.']+$/.test(name.trim())) {
      return NextResponse.json(
        { error: 'Canvas name contains invalid characters' },
        { status: 400 }
      );
    }

    // Resolve display name from users collection
    let createdByName = email || 'Unknown';
    try {
      const userDoc = await adminDb.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        createdByName = userData?.displayName || userData?.name || email || 'Unknown';
      }
    } catch {
      // Fallback to email
    }

    const now = FieldValue.serverTimestamp();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const canvasData = {
      name: name.trim(),
      elements: [],
      appState: {},
      createdBy: uid,
      createdByName,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    const docRef = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('canvases')
      .add(canvasData);

    return NextResponse.json({
      id: docRef.id,
      name: name.trim(),
      createdBy: uid,
      createdByName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Canvas create error:', error);
    return NextResponse.json(
      { error: 'Failed to create canvas' },
      { status: 500 }
    );
  }
}
