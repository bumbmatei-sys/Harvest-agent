import type { Metadata } from 'next';
import { headers } from 'next/headers';
import dynamic from 'next/dynamic';
import { getTenantFromHost } from '@/lib/server-tenant';

const App = dynamic(() => import('../App'), { ssr: false });

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);

  if (!tenant) {
    return {
      title: 'Harvest',
      description: 'The ministry platform that grows with your community.',
      openGraph: {
        title: 'Harvest',
        description: 'The ministry platform that grows with your community.',
      },
    };
  }

  const description =
    tenant.config.description || `Welcome to ${tenant.name}. Join our community.`;

  return {
    title: `${tenant.name} | Harvest`,
    description,
    openGraph: {
      title: tenant.name,
      description,
      ...(tenant.config.logo ? { images: [tenant.config.logo] } : {}),
    },
    twitter: {
      card: 'summary',
      title: tenant.name,
      description,
    },
  };
}

export default function Page() {
  return <App />;
}
