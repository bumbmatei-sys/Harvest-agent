/**
 * Upload size caps, shared by the browser and the API routes.
 *
 * These live outside the routes because both ends need the same number: the
 * client checks it before spending a round-trip uploading, and the server
 * re-checks it against the size storage actually reports. Two copies of a
 * constant is exactly the kind of thing that drifts.
 *
 * No server-only imports here — this module is pulled into the client bundle.
 */

/** Cover art, logos, avatars. Enforced in /api/storage/presign. */
export const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB

/**
 * Sermon / study PDFs for the AI Knowledge base.
 *
 * This is only enforceable because the bytes go browser → R2 directly. Posting
 * a file through a Vercel Function caps the body at 4.5MB (413
 * FUNCTION_PAYLOAD_TOO_LARGE, raised by the platform before the handler runs),
 * so the route could advertise 15MB but never honour it.
 */
export const MAX_PDF_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB

/** "15" — for building limit messages that name the real number. */
export function limitMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
