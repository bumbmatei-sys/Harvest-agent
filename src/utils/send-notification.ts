import { auth } from '../firebase';
import { getTenantScope } from './tenant-scope';

/**
 * Send a push notification to all users in the current tenant.
 * Calls the /api/send-notification endpoint.
 * Fire-and-forget — errors are logged but don't block the caller.
 */
export async function sendPushNotification(title: string, body: string): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();

    const response = await fetch('/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ title, body }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      console.error(`Push notification failed (${response.status}):`, text);
    }
  } catch (error) {
    console.error('Failed to send push notification:', error);
  }
}
