import { auth } from '@/firebase';

/**
 * Asks the server for a completion certificate and returns its address. The
 * server re-checks completion itself, so this only ever succeeds for a person
 * who actually finished. It THROWS with a sentence the member can read.
 */
export async function requestCertificate(courseId: string): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in to download your certificate.');
  const res = await fetch('/api/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ courseId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not generate your certificate.');
  return data.url as string;
}
