import { NextRequest, NextResponse } from 'next/server';
import { authorizePage } from '@/lib/signup-pages/server';

export async function GET(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const access = await authorizePage(request, params.pageId);
    if (access instanceof NextResponse) return access;
    const submissions = await access.ref.collection('submissions').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ submissions: submissions.docs.map((doc) => ({ ...doc.data(), id: doc.id })) });
  } catch { return NextResponse.json({ error: 'Could not load submissions' }, { status: 503 }); }
}
