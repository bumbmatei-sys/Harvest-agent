import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const { uid } = await request.json();
    if (!uid || typeof uid !== 'string') {
      return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
    }

    if (userOrErr.uid !== uid && !userOrErr.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await adminDb.collection('users').doc(uid).update({
      aiAssistantConnected: false,
      telegramChatId: null,
      telegramUsername: null,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Disconnect error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
