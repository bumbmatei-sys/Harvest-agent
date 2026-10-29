import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export const dynamic = 'force-dynamic';
/** Only published public metadata leaves the server. Files and entitlements stay in the member flow. */
export default async function PublicDigitalProduct({ params }: { params: { id: string } }) {
  const tenant = await getTenantFromHost(headers().get('host') || '');
  if (!tenant) notFound();
  let item;
  try { item = await validateFollowUp(tenant.id, { type: 'product', productKind: 'digital', id: params.id }); }
  catch (error) { if (error instanceof InvalidFollowUp) notFound(); throw error; }
  if (!item) notFound();
  return <main className="min-h-screen bg-background px-4 py-8"><PublicRouteAnalytics route="/products/[id]" /><Card className="mx-auto max-w-xl overflow-hidden">
    {item.listing.coverUrl && <img src={item.listing.coverUrl} alt="" className="aspect-video w-full object-cover" />}
    <CardHeader><CardTitle><h1 className="break-words font-display text-2xl">{item.listing.name}</h1></CardTitle></CardHeader>
    <CardContent className="space-y-5"><p className="break-words whitespace-pre-wrap text-body">{item.listing.shortDescription}</p><p className="text-sm text-muted">Find this product in {tenant.name}’s Products tab.</p><Button className="min-h-11 w-full" render={<a href={`https://${item.listing.slug}.theharvest.app`} />}>Open ministry</Button></CardContent>
  </Card></main>;
}
