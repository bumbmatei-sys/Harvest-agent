import { notFound } from 'next/navigation';
import { EmailThemesPreview } from './preview';

export const dynamic = 'force-dynamic';

/**
 * Screenshot harness for the newsletter email themes. Production, including a
 * Vercel preview, answers 404. This page only exists so a local dev server can
 * render the real components with mock data and a fake api — no network, no
 * Firebase — and every state can be screenshotted directly:
 *
 *   ?view=picker   the design dialog with the ThemePicker (5 presets + 2 saved)
 *   ?view=panels   the theme settings panels, expanded
 *   ?view=brand    Email settings: logo, footer note, social links
 *   ?view=editor   the composer with an Issue header and a Box
 *   ?view=preview  the preview dialog (add &mode=computer|phone|dark)
 */
export default function EmailThemesDevPage({
  searchParams,
}: {
  searchParams: { view?: string; mode?: string };
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <EmailThemesPreview view={searchParams.view} mode={searchParams.mode} />;
}
