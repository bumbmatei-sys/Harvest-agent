import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { requireTenantAdmin, requireCommunityMember } from '@/lib/api-auth';
import { isActiveCommunityMember } from '@/lib/community-membership-server';
import { adminDb } from '@/lib/firebase-admin';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { isTenantAdminRole } from '@/lib/roles';
import { readReviewAggregate, updateReviewAggregate } from '@/lib/community/review-aggregate';

export const dynamic = 'force-dynamic';
const validId = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('/');
const failure = () => NextResponse.json({ error: 'Could not process reviews.' }, { status: 500 });

async function write(request: NextRequest, deleting: boolean) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (!body || !validId(body.tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  const tenantId = body.tenantId;
  if (!deleting && (!Number.isInteger(body.rating) || (body.rating as number) < 1 || (body.rating as number) > 5 || typeof body.text !== 'string' || body.text.length > 1000)) {
    return NextResponse.json({ error: 'Invalid review.' }, { status: 400 });
  }
  try {
    const user = await requireCommunityMember(request, tenantId);
    if (user instanceof NextResponse) return user;
    if (body.uid !== undefined && body.uid !== user.uid) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    const admin = await requireTenantAdmin(request, tenantId);
    if (!(admin instanceof NextResponse)) return NextResponse.json({ error: "Admins can't review their own community" }, { status: 403 });
    if (admin.status !== 403) return admin;
    const settings = adminDb.collection('tenants').doc(tenantId).collection('settings').doc('community');
    const review = settings.collection('reviews').doc(user.uid);
    const listing = adminDb.collection('discovery_listings').doc(tenantId);
    const person = adminDb.collection('users').doc(user.uid);
    const tenant = adminDb.collection('tenants').doc(tenantId);
    const aggregate = await adminDb.runTransaction(async tx => {
      const [old, saved, published, profile, tenantDoc] = await Promise.all([tx.get(review), tx.get(settings), tx.get(listing), tx.get(person), tx.get(tenant)]);
      if (!tenantDoc.exists || !profile.exists || !(await isActiveCommunityMember(user.uid, tenantId, tx))) throw new Error('Membership unavailable');
      if ((profile.data()?.tenantId === tenantId && isTenantAdminRole(profile.data()?.role)) || tenantDoc.data()?.ownerId === user.uid) throw new Error('Owner cannot review');
      if (deleting && !old.exists) return readReviewAggregate(saved.data());
      const aggregate = updateReviewAggregate(readReviewAggregate(saved.data()), old.exists ? old.data()!.rating : null, deleting ? null : body.rating as number);
      if (deleting) tx.delete(review);
      else {
        const data = profile.data()!;
        const name = typeof data.displayName === 'string' && data.displayName.trim() && !data.displayName.includes('@') ? data.displayName.trim().slice(0, 120) : 'Member';
        const joined = typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt?.toDate?.();
        const memberSince = joined instanceof Date && Number.isFinite(joined.getTime()) ? Timestamp.fromDate(joined) : undefined;
        const photo = typeof data.photoURL === 'string' && /^https:\/\//.test(data.photoURL) ? data.photoURL : undefined;
        tx.set(review, { uid: user.uid, rating: body.rating, text: body.text, authorName: name, ...(photo ? { authorPhotoURL: photo } : {}), ...(memberSince ? { memberSince } : {}), createdAt: old.exists ? old.data()!.createdAt : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      }
      tx.set(settings, saved.exists ? aggregate : { ...defaultCommunitySettings(), ...aggregate }, { merge: true });
      if (published.exists) tx.set(listing, aggregate, { merge: true });
      return aggregate;
    });
    return NextResponse.json({ ok: true, aggregate });
  } catch (error) {
    if (error instanceof Error && error.message === 'Membership unavailable') return NextResponse.json({ error: 'Community membership required.' }, { status: 403 });
    if (error instanceof Error && error.message === 'Owner cannot review') return NextResponse.json({ error: "Admins can't review their own community" }, { status: 403 });
    return failure();
  }
}

export const POST = (request: NextRequest) => write(request, false);
export const DELETE = (request: NextRequest) => write(request, true);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tenantId = params.get('tenantId');
  const sort = params.get('sort') || 'newest';
  const rawLimit = params.get('limit') || '20';
  const limit = Number(rawLimit);
  const offsetText = params.get('offset') || '0';
  const offset = Number(offsetText);
  if (!validId(tenantId) || !['newest', 'highest', 'lowest'].includes(sort) || !/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 50 || (!/^\d+$/.test(offsetText) || !Number.isSafeInteger(offset))) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    if (params.get('mine') === '1') {
      const member = await requireCommunityMember(request, tenantId);
      if (member instanceof NextResponse) return member;
      const admin = await requireTenantAdmin(request, tenantId);
      if (!(admin instanceof NextResponse)) return NextResponse.json({ canReview: false, review: null });
      if (admin.status !== 403) return admin;
      const [profile, tenant, review] = await Promise.all([
        adminDb.collection('users').doc(member.uid).get(),
        adminDb.collection('tenants').doc(tenantId).get(),
        adminDb.collection('tenants').doc(tenantId).collection('settings').doc('community').collection('reviews').doc(member.uid).get(),
      ]);
      if (!profile.exists || !tenant.exists || !(await isActiveCommunityMember(member.uid, tenantId))) return NextResponse.json({ error: 'Membership unavailable.' }, { status: 403 });
      const canReview = !(profile.data()?.tenantId === tenantId && isTenantAdminRole(profile.data()?.role)) && tenant.data()?.ownerId !== member.uid;
      const data = review.data();
      return NextResponse.json({ canReview, review: canReview && review.exists ? { rating: data!.rating, text: data!.text } : null });
    }
    const listing = await adminDb.collection('discovery_listings').doc(tenantId).get();
    if (!listing.exists) {
      const member = await requireCommunityMember(request, tenantId);
      if (member instanceof NextResponse) return member;
    }
    const reviews = adminDb.collection('tenants').doc(tenantId).collection('settings').doc('community').collection('reviews');
    let query: FirebaseFirestore.Query = reviews.orderBy(sort === 'newest' ? 'createdAt' : 'rating', sort === 'lowest' ? 'asc' : 'desc');
    query = query.offset(offset);
    const snapshot = await query.limit(limit + 1).get();
    const page = snapshot.docs.slice(0, limit);
    const result = page.map(doc => {
      const data = doc.data();
      const names = typeof data.authorName === 'string' && !data.authorName.includes('@') ? data.authorName.trim().split(/\s+/) : ['Member'];
      const authorName = names.length > 1 ? `${names[0]} ${names[names.length - 1][0]}.` : names[0];
      return { authorName, authorPhotoURL: data.authorPhotoURL || null, rating: data.rating, text: data.text, memberSince: data.memberSince || null, createdAt: data.createdAt, updatedAt: data.updatedAt };
    });
    return NextResponse.json({ reviews: result, nextOffset: snapshot.docs.length > limit ? offset + limit : null });
  } catch { return failure(); }
}
