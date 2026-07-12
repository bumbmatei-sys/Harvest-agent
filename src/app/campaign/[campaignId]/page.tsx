import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicCampaign from '@/components/PublicCampaign';

export const dynamic = 'force-dynamic';

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

const isValidHex = (value: string | undefined): value is string =>
  !!value && /^#[0-9a-fA-F]{6}$/.test(value);

async function loadCampaign(campaignId: string, host: string) {
  const tenant = await getTenantFromHost(host);
  if (!tenant) return null;

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
  return (
    <PublicCampaign
      tenantId={tenant.id}
      tenantName={tenant.name}
      logo={branding.logo || null}
      primaryColor={isValidHex(branding.primaryColor) ? branding.primaryColor : '#B8962E'}
      campaign={campaign}
    />
  );
}
