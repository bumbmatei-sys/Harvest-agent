import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHostOrId } from '@/lib/server-tenant';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export const dynamic = 'force-dynamic';
/** Only published public metadata leaves the server. Files and entitlements stay in the member flow. */
export default async function PublicDigitalProduct({ params, searchParams }: { params: { id: string }; searchParams: { t?: string } }) {
  // A hostless tenant (no subdomain — no published website) carries its own
  // id as `?t=` instead of a host segment; see AdminForms.tsx's formUrl.
  const tenant = await getTenantFromHostOrId(headers().get('host') || '', searchParams.t);
  if (!tenant) notFound();
  let item;
  try { item = await validateFollowUp(tenant.id, { type: 'product', productKind: 'digital', id: params.id }); }
  catch (error) { if (error instanceof InvalidFollowUp) notFound(); throw error; }
  if (!item) notFound();
  return <main className="min-h-screen bg-background px-4 py-8"><PublicRouteAnalytics route="/products/[id]" /><Card className="mx-auto max-w-xl overflow-hidden">
    {item.listing.coverUrl && <img src={item.listing.coverUrl} alt="" className="aspect-video w-full object-cover" />}
    <CardHeader><CardTitle><h1 className="break-words font-display text-2xl">{item.listing.name}</h1></CardTitle></CardHeader>
    <CardContent className="space-y-5"><p className="break-words whitespace-pre-wrap text-body">{item.listing.shortDescription}</p><p className="text-sm text-muted">Find this product in {tenant.name}’s Products tab.</p><Button className="min-h-11 w-full" render={<a href={item.listing.slug ? `https://${item.listing.slug}.theharvest.app` : 'https://theharvest.app'} />}>Open ministry</Button></CardContent>
  </Card></main>;
}
