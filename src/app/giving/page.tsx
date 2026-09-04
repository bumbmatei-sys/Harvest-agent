import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicGiving from '@/components/PublicGiving';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { readGivingLinks } from '@/components/donations/giving-providers';

/**
 * THE-303 — 🔴 THE PUBLIC GIVING PAGE. The destination every shared giving link,
 * printed QR and Text-to-Give reply now carries (`GIVING_PATH`).
 *
 * ─── Why it is a route and not a query parameter ─────────────────────────────
 *
 * `/?giving=1` was the app root: the optional catch-all serves the SPA there,
 * the SPA requires a session, and a member who is not signed in was bounced to
 * auth. Every other QR type AdminQR prints — event, check-in, form — already
 * points at a real public route. This is the fourth, and the last one that did
 * not have one.
 *
 * ─── 🔴 NO `firestore.rules` CHANGE, AND NONE IS NEEDED ─────────────────────
 *
 * The tenant document is read through the ADMIN SDK, server-side, exactly as
 * `/pledge/[campaignId]`, `/campaign/[campaignId]`, `/event/[eventId]` and
 * `/calendar` read theirs. The Admin SDK bypasses rules entirely, so no rule is
 * consulted, none is added, and `firestore.rules` is untouched by this ticket.
 * The browser makes no Firestore call on this page at all.
 *
 * ─── 🔴 WHAT IT EXPOSES ─────────────────────────────────────────────────────
 *
 * Three fields of `tenants/{id}`: `name`, `config.logo` and the validated
 * `config.givingLinks`. Nothing else is read and nothing else is passed down.
 * All three are ALREADY public — `tenants/{id}` carries `allow read: if true`
 * (that is what lets a signed-out visitor resolve a subdomain), and
 * AdminDonations tells an admin in as many words that everything typed into the
 * links editor, the email addresses included, is shown publicly on the Give
 * page. So this changes who has to sign in to see them, not who can see them.
 *
 * ⚠️ NO CAMPAIGN, NO MEMBER, NO GIFT AND NO TOTAL is read here. There is no
 * `raised`, no donor, no contact and no admin action on this page.
 *
 * ─── The plan gate, and why this page does not carry one ────────────────────
 *
 * `/campaign/[campaignId]` refuses a tenant without `fundraising` because it is
 * a DONATE PAGE — an amount picker posting to `/api/stripe/donate`. This page
 * has no form, no endpoint and no Harvest money path: it lists accounts that
 * belong to the church, which Harvest is not in and takes no fee from. A church
 * that has published links has already been shown them on its own Give page and
 * on its campaigns; a page that refused to show a stranger the same links would
 * be withholding the church's own bank details from the church's own members.
 *
 * `notFound()` for an unresolvable host is the same answer every other public
 * route gives, and for the same reason: an anonymous visitor is not told
 * whether a subdomain exists.
 */
export const dynamic = 'force-dynamic';

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

async function loadTenant() {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  return getTenantFromHost(host);
}

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await loadTenant();
  if (!tenant) return { title: 'Giving' };
  const isWhiteLabel = tenant.id !== PLATFORM_TENANT_ID;
  const siteName = isWhiteLabel ? tenant.name : 'Harvest';
  return {
    title: `Give · ${siteName}`,
    description: `Ways to give to ${siteName}.`,
    openGraph: { title: `Give to ${siteName}`, type: 'website', siteName },
  };
}

export default async function PublicGivingPage() {
  const tenant = await loadTenant();
  if (!tenant) notFound();

  // The same read the pledge, campaign, event and calendar routes make of the
  // same document — `config` is the branding blob, and `givingLinks` is a field
  // on it that `TenantConfig` does not yet name.
  const branding = ((tenant as any).config || {}) as {
    logo?: string | null;
    givingLinks?: unknown;
  };

  // 🔴 VALIDATED HERE, AT THE BOUNDARY, and exactly once — the same place the
  // campaign route validates. `readGivingLinks` re-derives every stored URL
  // against its provider's host allow-list on READ, so a link that no longer
  // passes stops being a link rather than being trusted because it was accepted
  // once. That matters more here than anywhere else in the app: the reader is a
  // stranger with no account, arriving from a printed QR, with no way to judge
  // a bad href on a page carrying their church's name.
  const links = readGivingLinks(branding);

  return (
    <>
      <PublicRouteAnalytics route="/giving" />
      <PublicGiving tenantName={tenant.name} logo={branding.logo || null} links={links} />
    </>
  );
}
