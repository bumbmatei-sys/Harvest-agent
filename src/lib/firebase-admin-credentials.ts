/**
 * Whether this process should call Firebase Admin.
 *
 * Preview deployments usually have no service account. The first Admin RPC
 * then throws Google's "Could not load the default credentials" error, and
 * that sentence must never be sent to a browser. Production and local dev
 * may still use application default credentials.
 */
export function firebaseAdminCredentialsAvailable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const serviceAccount = env.FIREBASE_SERVICE_ACCOUNT;
  if (typeof serviceAccount === 'string' && serviceAccount.trim()) {
    try {
      const parsed = JSON.parse(serviceAccount) as { client_email?: unknown; private_key?: unknown };
      if (
        typeof parsed.client_email === 'string' && parsed.client_email
        && typeof parsed.private_key === 'string' && parsed.private_key
      ) {
        return true;
      }
    } catch {
      // A present but unreadable value is not a credential.
    }
  }
  const file = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof file === 'string' && file.trim()) return true;
  if (env.VERCEL_ENV === 'preview') return false;
  return true;
}
