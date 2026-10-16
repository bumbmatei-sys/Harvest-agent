import { notFound } from 'next/navigation';
import { SocialSchedulerPreview } from './preview';

export const dynamic = 'force-dynamic';

/**
 * Screenshot harness for the social scheduler. Production, including a Vercel
 * preview, answers 404. The committed shots in docs/redesign/phase-2 are the
 * proof; this page only exists so a local dev server can render the real
 * components.
 */
export default function SocialSchedulerDevPage({
  searchParams,
}: {
  searchParams: { view?: string; theme?: string };
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SocialSchedulerPreview view={searchParams.view} theme={searchParams.theme} />;
}
