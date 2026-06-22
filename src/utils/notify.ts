/**
 * Surface an operation error to the user instead of silently swallowing it.
 *
 * Many admin create/update handlers previously did `catch (e) { console.error(e) }`,
 * which meant a failed Firestore write (e.g. a permission error) looked like the
 * button "did nothing". This helper logs the error AND shows the real message so
 * failures are visible and debuggable.
 */
export function notifyError(context: string, error: unknown): void {
  const message =
    (error as { message?: string })?.message ||
    (typeof error === 'string' ? error : 'Unknown error');
  // Always log the full error for diagnostics.
  console.error(`${context}:`, error);
  if (typeof window !== 'undefined') {
    window.alert(`${context}\n\n${message}`);
  }
}
