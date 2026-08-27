import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicCampaign from '@/components/PublicCampaign';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { tenantFeatures } from '@/lib/tenant-features';
import { readGivingLinks } from '@/components/donations/giving-providers';

export const dynamic = 'force-dynamic';

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

const isValidHex = (value: string | undefined): value is string =>
  !!value && /^#[0-9a-fA-F]{6}$/.test(value);

async function loadCampaign(campaignId: string, host: string) {
  const tenant = await getTenantFromHost(host);
  if (!tenant) return null;

  // 🔴 A TIER WITHOUT `fundraising` HAS NO DONATE PAGE — THE-213.
  //
  // THIS IS THAT PAGE. It renders a campaign with an amount picker and a Donate
  // button posting to /api/stripe/donate, and it is public, `force-dynamic` and
  // read through the Admin SDK, so firestore.rules never sees it. `free` is the
  // only tier carrying `fundraising: false`, and the whole premise of that cell
  // — "they get a public subdomain… but not a donate page" — is false while
  // this route answers. The donate ROUTE already refuses (THE-202), but a
  // refusal one click later is a giving surface that 403s, not an absent one,
  // and the CRM's "no donor can exist on free" claim is only true if the page
  // that could create one is gone too.
  //
  // Every priced tier has `fundraising: true`, so Individual, Small Team and
  // Ministry are untouched — free is the only tier this answers differently.
  //
  // Refused as the same `null` the missing/foreign/inactive-campaign branches
  // below return (both callers turn it into `notFound()` / "Campaign Not
  // Found"), not an explanatory error: the reader is an anonymous visitor and a
  // church's subscription tier is not theirs to be told.
  //
  // ⚠️ REFUSES THE SURFACE, NOT THE DATA. The campaign document, its totals and
  // every gift already recorded against it are untouched, and no rule changed —
  // a tenant that upgrades gets this page back with its history intact.
  if (!tenantFeatures(tenant).fundraising) return null;

  // Server-side read via the Admin SDK (bypasses client rules). Mirrors the
  // pledge page's proven-safe pattern — no client Firestore for logged-out visitors.
  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb.collection('campaigns').doc(campaignId).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  // Verify the campaign belongs to THIS tenant and is publicly viewable.
  if (data.tenantId !== tenant.id) return null;
  // Pledge campaigns have their own public page (/pledge/[id]); this page serves
  // regular (fundraising) donation campaigns.
  if (data.campaignType === 'pledge') return null;
  if (!data.isActive) return null;

  return { tenant, data };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}): Promise<Metadata> {
  const { campaignId } = await params;
  const headersList = await headers();
  const host = headersList.get('host') || '';

  const loaded = await loadCampaign(campaignId, host);
  if (!loaded) return { title: 'Campaign Not Found' };

  const { tenant, data } = loaded;
  const isWhiteLabel = tenant.id !== PLATFORM_TENANT_ID;
  const siteName = isWhiteLabel ? tenant.name : 'Harvest';
  const title = data.title || 'Fundraising Campaign';
  const description = String(data.description || '').replace(/\s+/g, ' ').slice(0, 160).trim();

  return {
    title: `${title} · ${siteName}`,
    description: description || undefined,
    openGraph: {
      title,
      description: description || undefined,
      type: 'website',
      siteName,
      ...(data.coverImage ? { images: [data.coverImage] } : {}),
    },
    twitter: {
      card: data.coverImage ? 'summary_large_image' : 'summary',
      title,
      description: description || undefined,
      ...(data.coverImage ? { images: [data.coverImage] } : {}),
    },
  };
}

export default async function PublicCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';

  const loaded = await loadCampaign(campaignId, host);
  if (!loaded) notFound();

  const { tenant, data } = loaded;

  const campaign = {
    id: campaignId,
    title: data.title || 'Fundraising Campaign',
    description: data.description || '',
    coverImage: data.coverImage || null,
    goal: data.goal || 0,
    raised: data.raised || 0,
    endDate: data.endDate || null,
  };

  const branding = (tenant as any).config || {};

  // THE-251 — the church's OWN payment links, on the campaign a member is
  // actually looking at. Someone who wants to support THIS appeal should be
  // able to use the provider their church already told them about, without
  // hunting for the Give page.
  //
  // 🔴 THE GATE IS UNTOUCHED. `loadCampaign` above already refused a free
  // tenant, a foreign tenant, a pledge campaign and an inactive one, and this
  // reads nothing it did not already read — `tenant.config` is the same object
  // the logo and the brand colour come from, three lines up. No new document,
  // no new query, and nothing here can make a page render that would not have
  // rendered before: these links only ever ADD to a page already cleared.
  //
  // `readGivingLinks` re-derives every URL against its provider's host
  // allow-list on READ (THE-246), so a link that no longer passes stops being a
  // link rather than being trusted because it was accepted once. That matters
  // more here than anywhere: this page is public and unauthenticated, so the
  // reader is a stranger with no account and no way to judge a bad href.
  const givingLinks = readGivingLinks(branding);

  return (
    <>
      <PublicRouteAnalytics route="/campaign/[campaignId]" />
      <PublicCampaign
        tenantId={tenant.id}
        tenantName={tenant.name}
        logo={branding.logo || null}
        primaryColor={isValidHex(branding.primaryColor) ? branding.primaryColor : '#B8962E'}
        campaign={campaign}
        links={givingLinks}
      />
    </>
  );
}
