import { notFound } from 'next/navigation';

import { AdminShellPreview } from '@/components/admin-shell/AdminShellPreview';

/** Dev-only chrome for the phase-1 before/after shots. Production answers 404. */
export default function AdminShellPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AdminShellPreview />;
}
