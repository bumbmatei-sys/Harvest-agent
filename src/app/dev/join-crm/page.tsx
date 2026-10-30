import { notFound } from 'next/navigation';
import { JoinCRMPreview } from './preview';
export const dynamic = 'force-dynamic';
export default function JoinCRMDevPage({ searchParams }: { searchParams: { view?: string; theme?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <JoinCRMPreview view={searchParams.view} theme={searchParams.theme} />;
}
