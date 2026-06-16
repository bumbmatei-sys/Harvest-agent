import { NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split('Bearer ')[1];
    await adminAuth.verifyIdToken(token);

    const snapshot = await adminDb.collection('churches').get();
    const churches = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json({ churches });
  } catch (error) {
    console.error('Error fetching churches:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split('Bearer ')[1];
    const decoded = await adminAuth.verifyIdToken(token);

    const body = await request.json();
    
    // Whitelist allowed fields only
    const allowedFields: Record<string, unknown> = {
      createdAt: new Date().toISOString(),
      createdBy: decoded.uid,
    };
    const safeFields = ['name', 'address', 'lat', 'lng', 'denomination', 'website', 'phone', 'email', 'tenantId'];
    for (const field of safeFields) {
      if (body[field] !== undefined && typeof body[field] === 'string' || typeof body[field] === 'number') {
        allowedFields[field] = body[field];
      }
    }

    const docRef = await adminDb.collection('churches').add(allowedFields);

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Error creating church:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
