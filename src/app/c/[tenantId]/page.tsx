import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { notFound } from 'next/navigation';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/**
 * The public community page for a tenant with no subdomain — every tenant
 * without a published website, which is every Free tenant by default. A
 * tenant that HAS a subdomain is reached at `{slug}.theharvest.app` instead
 * (see form-follow-up/server.ts); this route exists only for the other case,
 * so it is validated through the exact same function either way.
 */
export default async function PublicCommunityPage({ params }: { params: { tenantId: string } }) {
  const { tenantId } = params;
  if (!tenantId || tenantId.length > 150 || tenantId.includes('/')) notFound();
  let item;
  try { item = await validateFollowUp(tenantId, { type: 'community', id: tenantId }); }
  catch (error) { if (error instanceof InvalidFollowUp) notFound(); throw error; }
  if (!item) notFound();
  return <main className="min-h-screen bg-background px-4 py-8">
    <PublicRouteAnalytics route="/c/[tenantId]" />
    <Card className="mx-auto max-w-xl overflow-hidden">
      {item.listing.coverUrl && <img src={item.listing.coverUrl} alt="" className="aspect-video w-full object-cover" />}
      <CardHeader><CardTitle><h1 className="break-words font-display text-2xl">{item.listing.name}</h1></CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <p className="break-words whitespace-pre-wrap text-body">{item.listing.shortDescription}</p>
        <Button className="min-h-11 w-full" render={<a href="https://theharvest.app" />}>Join on Harvest</Button>
      </CardContent>
    </Card>
  </main>;
}
