import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

/**
 * GET /api/canvas/[id]
 * Get a single canvas with elements.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;
    const docRef = adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('canvases')
      .doc(id);

    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { error: 'Canvas not found' },
        { status: 404 }
      );
    }

    const data = docSnap.data()!;

    return NextResponse.json({
      id: docSnap.id,
      name: data.name || 'Untitled',
      elements: data.elements || [],
      appState: data.appState || {},
      createdBy: data.createdBy || '',
      createdByName: data.createdByName || 'Unknown',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
    });
  } catch (error) {
    console.error('Canvas get error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch canvas' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/canvas/[id]
 * Update canvas elements and appState.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;
    const body = await request.json();
    const { elements, appState } = body;

    if (!Array.isArray(elements)) {
      return NextResponse.json(
        { error: 'elements must be an array' },
        { status: 400 }
      );
    }

    // Fix 3: Elements size validation
    const serialized = JSON.stringify(elements);
    if (serialized.length > 900_000) {
      return NextResponse.json(
        { error: 'Canvas data too large (max 900KB)' },
        { status: 413 }
      );
    }

    const docRef = adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('canvases')
      .doc(id);

    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json(
        { error: 'Canvas not found' },
        { status: 404 }
      );
    }

    // Use .update() to preserve other fields
    const updateData: Record<string, any> = {
      elements,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (appState && typeof appState === 'object') {
      updateData.appState = appState;
    }

    await docRef.update(updateData);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Canvas update error:', error);
    return NextResponse.json(
      { error: 'Failed to update canvas' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/canvas/[id]
 * Delete a canvas.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;

    const docRef = adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('canvases')
      .doc(id);

    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json(
        { error: 'Canvas not found' },
        { status: 404 }
      );
    }

    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Canvas delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete canvas' },
      { status: 500 }
    );
  }
}
