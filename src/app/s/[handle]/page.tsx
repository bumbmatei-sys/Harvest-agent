import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { PublicSignupForm } from '@/components/signup-pages/PublicSignupForm';
import { getPublicSignupPage } from '@/lib/signup-pages/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function SignupPage({ params }: { params: { handle: string } }) {
  const host = headers().get('host')?.toLowerCase().replace(/:\d+$/, '');
  if (host !== 'theharvest.app' && host !== 'www.theharvest.app' && host !== 'app.theharvest.app') notFound();
  const page = await getPublicSignupPage(params.handle);
  if (!page) notFound();
  return <><PublicRouteAnalytics route="/s/[handle]" /><PublicSignupForm handle={params.handle} {...page} /></>;
}
