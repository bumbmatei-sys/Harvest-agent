import { authFetch } from './auth-fetch';

/**
 * Open a stored financial PDF (receipt, giving statement, or invoice) in a new
 * tab. The files are private; admins reach them only through a short-lived,
 * authenticated signed URL from /api/storage/signed-url. No-ops when the record
 * predates pdfPath (older rows stored a now-revoked public pdfUrl instead).
 */
export async function openStatementPdf(pdfPath?: string | null): Promise<void> {
  if (!pdfPath) return;
  try {
    const res = await authFetch('/api/storage/signed-url', {
      method: 'POST',
      body: JSON.stringify({ path: pdfPath }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    console.error('Failed to open statement PDF:', e);
  }
}
