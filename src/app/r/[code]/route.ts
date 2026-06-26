import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: { code: string } }
) {
  const { code } = context.params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  if (!code || !/^[a-zA-Z0-9_-]{4,20}$/.test(code)) {
    return NextResponse.redirect(new URL('/', baseUrl), { status: 302 });
  }

  try {
    const snap = await adminDb
      .collection('users')
      .where('affiliateCode', '==', code)
      .limit(1)
      .get();

    if (!snap.empty) {
      snap.docs[0].ref
        .update({ affiliateClicks: FieldValue.increment(1), updatedAt: new Date().toISOString() })
        .catch((err: unknown) => console.error('Affiliate click increment failed:', err));
    }
  } catch (err) {
    console.error('Affiliate click tracking error:', err);
  }

  return NextResponse.redirect(
    new URL(`/?ref=${encodeURIComponent(code)}`, baseUrl),
    { status: 302 }
  );
}
