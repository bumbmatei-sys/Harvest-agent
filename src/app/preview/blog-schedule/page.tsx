import { notFound } from 'next/navigation';

import { BlogSchedulePreview } from '@/components/blog/BlogSchedulePreview';

/** Dev-only shots for scheduled publishing. Production answers 404. */
export default function BlogSchedulePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <BlogSchedulePreview />;
}
