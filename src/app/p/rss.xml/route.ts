import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { renderBlogRss } from '@/lib/blog/feeds';
import { createBlogService } from '@/lib/blog/service';
import { firestoreBlogStore } from '@/lib/blog/firestore-store';
import { getTenantFromHost } from '@/lib/server-tenant';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) return new NextResponse('Not found', { status: 404 });

  const listed = await createBlogService({ store: firestoreBlogStore }).listPublic(tenant.id);
  if (!listed.ok) {
    return NextResponse.json({ ok: false, error: listed.error, message: listed.message }, { status: 500 });
  }
  if (listed.skipped > 0) {
    return NextResponse.json(
      { ok: false, error: 'incomplete', message: 'Some posts could not be read.' },
      { status: 500 },
    );
  }

  const proto = headersList.get('x-forwarded-proto') || 'https';
  const xml = renderBlogRss({
    churchName: tenant.name,
    origin: `${proto}://${host}`,
    posts: listed.posts,
  });
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
