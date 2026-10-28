import { NextRequest, NextResponse } from 'next/server';
import { authorizePage } from '@/lib/signup-pages/server';
import { SIGNUP_FIELDS, signupRowsToCsv } from '@/lib/signup-pages/model';

export async function GET(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const access = await authorizePage(request, params.pageId);
    if (access instanceof NextResponse) return access;
    const submissions = await access.ref.collection('submissions').orderBy('createdAt', 'desc').get();
    const rows = submissions.docs.map((doc) => {
      const data = doc.data();
      if (typeof data.createdAt !== 'string' || !data.answers || typeof data.answers !== 'object' || SIGNUP_FIELDS.some((field) => data.answers[field] !== undefined && typeof data.answers[field] !== 'string')) throw new Error('Invalid submission');
      return [data.createdAt, ...SIGNUP_FIELDS.map((field) => data.answers[field] ?? '')];
    });
    return new Response(signupRowsToCsv([['createdAt', ...SIGNUP_FIELDS], ...rows]), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="signups.csv"', 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not export submissions' }, { status: 503 }); }
}
