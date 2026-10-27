import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { PublicDiscover } from '@/components/community/PublicDiscover';
import { adminDb } from '@/lib/firebase-admin';
import { readPublicListing } from '@/lib/community/public-listing';

export const metadata: Metadata = {
  title: 'Discover communities | Harvest',
  description: 'Discover public communities on Harvest.',
};

// The index changes when an admin makes a community private. Do not cache it.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DiscoverPage() {
  const host = headers().get('host')?.toLowerCase().replace(/:\d+$/, '');
  if (host !== 'theharvest.app' && host !== 'www.theharvest.app' && host !== 'app.theharvest.app') notFound();

  try {
    const snapshot = await adminDb.collection('discovery_listings').get();
    const listings = snapshot.docs.map(doc => readPublicListing(doc.data()));
    listings.sort((a, b) => a.name.localeCompare(b.name));
    return <><PublicRouteAnalytics route="/discover" /><PublicDiscover state={{ status: 'ready', data: listings }} /></>;
  } catch {
    return <><PublicRouteAnalytics route="/discover" /><PublicDiscover state={{ status: 'error', message: 'Could not load communities. Please try again later.' }} /></>;
  }
}
